/**
 * Overseer Console - engine glue.
 *
 * An Emscripten JS library linked into both engines (`--js-library`). The
 * engines are 1990s desktop programs: they block, spin on the clock, read
 * whole archives from disk and assume files they wrote are safe. A browser tab
 * offers none of that, so this file provides it underneath the C library:
 *
 *   1. A clock that can stop. Game time freezes while the tab is hidden or the
 *      host pauses the engine, and stalls of the page are hidden from it.
 *   2. A watchdog that hands the thread back to the browser whenever the
 *      engine has kept it for longer than a slice. Rendering, input and audio
 *      share that thread; without this any long loop freezes all three.
 *   3. Lazy files. Game archives stay on disk and are read in cached blocks
 *      on demand, instead of being copied into memory at start-up.
 *   4. A file system type that tracks what changed and hands it to the host in
 *      one batch when the engine says it finished writing (saves, settings).
 *
 * The host page talks to it through `Module.overseer` (see `api()` below).
 * Everything here is engine agnostic.
 */
addToLibrary({
  $OVERSEER__deps: [
    '$FS', '$MEMFS', '$Asyncify', '$SYSCALLS', '$doReadv',
    '$callUserCallback', '$runtimeKeepalivePush', '$runtimeKeepalivePop',
  ],
  $OVERSEER__postset: 'OVERSEER.boot();',
  $OVERSEER: {
    // ---- tunables, exposed as Module.overseer.config ----
    config: {
      // Longest stretch of engine work before the browser gets the thread.
      sliceMs: 8,
      // Lazy files are read and cached in blocks of this many bytes.
      blockSize: 1 << 20,
      // Upper bound for cached blocks, in bytes.
      cacheBytes: 192 << 20,
      // A wake-up later than this is treated as a stall of the page and is
      // hidden from the engine's clock.
      stallMs: 250,
    },

    // ---- state ----
    armed: false,
    paused: false,
    pauseStart: 0,
    pausedMs: 0,
    lastYield: 0,
    ticksOrigin: null,
    waiters: [],
    queue: [],
    channel: null,
    populating: 0,
    lazySeq: 0,
    lru: null,
    cachedBytes: 0,
    onError: null,
    resumedAt: 0,
    counters: { yields: 0, sleeps: 0, stalls: 0, busyMs: 0, blockReads: 0, blockBytes: 0, blockMs: 0, evictions: 0, syncs: 0 },

    boot() {
      OVERSEER.lru = new Map();
      OVERSEER.channel = new MessageChannel();
      OVERSEER.channel.port1.onmessage = () => {
        var job = OVERSEER.queue.shift();
        runtimeKeepalivePop();
        if (job) OVERSEER.wake(job.fn, job.at, 0);
      };
      Module['overseer'] = OVERSEER.api();
    },

    // ------------------------------------------------------------------
    // Clock
    // ------------------------------------------------------------------

    // Milliseconds of time the engine has been allowed to see.
    now() {
      return (OVERSEER.paused ? OVERSEER.pauseStart : performance.now()) - OVERSEER.pausedMs;
    },

    pause() {
      if (OVERSEER.paused) return;
      OVERSEER.pauseStart = performance.now();
      OVERSEER.paused = true;
    },

    resume() {
      if (!OVERSEER.paused) return;
      OVERSEER.pausedMs += performance.now() - OVERSEER.pauseStart;
      OVERSEER.paused = false;
      var waiters = OVERSEER.waiters;
      OVERSEER.waiters = [];
      waiters.forEach((fn) => OVERSEER.run(fn));
    },

    // ------------------------------------------------------------------
    // Suspending the engine
    // ------------------------------------------------------------------

    // True when the code that called us is the engine's main stack, running
    // normally, i.e. it is safe to unwind it. Callbacks the browser delivers
    // (input, audio, timers) run while the main stack is already suspended
    // and must never try to suspend again.
    canSuspend() {
      return OVERSEER.armed && !ABORT &&
        Asyncify.state === Asyncify.State.Normal &&
        !Asyncify.currData &&
        Asyncify.exportCallStack.length > 0;
    },

    // Asyncify re-enters the import that suspended once the stack has been
    // rebuilt. Every suspending import must check this first, before doing
    // any work, and return the stored result.
    rewinding() {
      return Asyncify.state === Asyncify.State.Rewinding;
    },

    finishRewind() {
      return Asyncify.handleSleep(() => {});
    },

    // Unwinds the engine; `start` receives the function that resumes it.
    suspend(start) {
      return Asyncify.handleSleep((wakeUp) => {
        // Time the engine spent computing since it last had the thread.
        OVERSEER.counters.busyMs += performance.now() - OVERSEER.resumedAt;
        start((value) => {
          OVERSEER.lastYield = OVERSEER.now();
          OVERSEER.resumedAt = performance.now();
          wakeUp(value);
        });
      });
    },

    // Runs engine code from the event loop the way Emscripten's own timers do,
    // so that exit() and unwinds do not surface as uncaught exceptions.
    run(fn) {
      callUserCallback(fn);
    },

    // Delivers a wake-up: hides stalls of the page from the engine's clock and
    // holds the wake-up while the host has the engine paused.
    wake(fn, startedAt, expectedMs) {
      var late = performance.now() - startedAt - expectedMs;
      if (late > OVERSEER.config.stallMs && !OVERSEER.paused) {
        OVERSEER.pausedMs += late;
        OVERSEER.counters.stalls++;
      }
      if (OVERSEER.paused) {
        OVERSEER.waiters.push(fn);
      } else {
        OVERSEER.run(fn);
      }
    },

    // Gives the browser one turn of its event loop, then calls `fn`.
    // A message channel is not subject to the 4 ms clamp of nested timers.
    breathe(fn) {
      OVERSEER.counters.yields++;
      runtimeKeepalivePush();
      OVERSEER.queue.push({ fn, at: performance.now() });
      OVERSEER.channel.port2.postMessage(0);
    },

    timer(ms, fn) {
      OVERSEER.counters.sleeps++;
      var at = performance.now();
      runtimeKeepalivePush();
      setTimeout(() => {
        runtimeKeepalivePop();
        OVERSEER.wake(fn, at, ms);
      }, ms);
    },

    dueForYield() {
      return OVERSEER.now() - OVERSEER.lastYield >= OVERSEER.config.sliceMs;
    },

    fail(what, err) {
      err = err || new Error(what);
      console.error('[overseer] ' + what, err);
      if (OVERSEER.onError) {
        try { OVERSEER.onError(what, err); } catch (e) { console.error(e); }
      }
    },

    // ------------------------------------------------------------------
    // Lazy files
    // ------------------------------------------------------------------

    createLazy(size, read) {
      var id = ++OVERSEER.lazySeq;
      var lazy = {
        id,
        size,
        read,
        blocks: new Map(),
        lastBlock: -2,

        touch(index) {
          var key = id + ':' + index;
          var entry = OVERSEER.lru.get(key);
          if (entry) {
            OVERSEER.lru.delete(key);
            OVERSEER.lru.set(key, entry);
          }
        },

        // Returns null when [position, position + length) is in memory,
        // otherwise a promise that resolves once it is.
        ensure(position, length) {
          if (position >= size || length <= 0) return null;
          var B = OVERSEER.config.blockSize;
          var first = Math.floor(position / B);
          var last = Math.floor((Math.min(size, position + length) - 1) / B);
          var missFirst = -1;
          var missLast = -1;
          for (var i = first; i <= last; i++) {
            if (lazy.blocks.has(i)) {
              lazy.touch(i);
            } else {
              if (missFirst < 0) missFirst = i;
              missLast = i;
            }
          }
          var sequential = first === lazy.lastBlock || first === lazy.lastBlock + 1;
          lazy.lastBlock = last;
          if (missFirst < 0) return null;

          // Read ahead when the file is being streamed (movies, music).
          var lastBlockOfFile = Math.floor((size - 1) / B);
          if (sequential && missLast < lastBlockOfFile && !lazy.blocks.has(missLast + 1)) {
            missLast++;
          }

          var start = missFirst * B;
          var end = Math.min(size, (missLast + 1) * B);
          var t0 = performance.now();
          return Promise.resolve(read(start, end - start)).then((data) => {
            if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
            if (data.length !== end - start) {
              throw new Error('short read: wanted ' + (end - start) + ' bytes at ' + start + ', got ' + data.length);
            }
            OVERSEER.counters.blockReads++;
            OVERSEER.counters.blockBytes += data.length;
            OVERSEER.counters.blockMs += performance.now() - t0;
            for (var i = missFirst; i <= missLast; i++) {
              if (lazy.blocks.has(i)) continue;
              var from = i * B - start;
              var block = data.slice(from, Math.min(data.length, from + B));
              lazy.blocks.set(i, block);
              OVERSEER.lru.set(id + ':' + i, { lazy, index: i, bytes: block.length });
              OVERSEER.cachedBytes += block.length;
            }
            // Keep what this read needs, drop the least recently used rest.
            for (var j = first; j <= last; j++) lazy.touch(j);
            OVERSEER.trimCache();
          });
        },

        copy(buffer, offset, length, position) {
          if (position >= size) return 0;
          var B = OVERSEER.config.blockSize;
          var total = Math.min(size - position, length);
          var done = 0;
          while (done < total) {
            var at = position + done;
            var index = Math.floor(at / B);
            var block = lazy.blocks.get(index);
            if (!block) {
              // Only reachable when something read the file without going
              // through fd_read, or from a context that cannot wait.
              OVERSEER.fail('lazy block ' + index + ' was read before it was loaded');
              throw new FS.ErrnoError({{{ cDefs.EIO }}});
            }
            var inBlock = at - index * B;
            var n = Math.min(block.length - inBlock, total - done);
            buffer.set(block.subarray(inBlock, inBlock + n), offset + done);
            done += n;
          }
          return total;
        },

        drop() {
          lazy.blocks.forEach((block, index) => {
            OVERSEER.lru.delete(id + ':' + index);
            OVERSEER.cachedBytes -= block.length;
          });
          lazy.blocks.clear();
        },
      };
      return lazy;
    },

    trimCache() {
      var budget = Math.max(OVERSEER.config.cacheBytes, 4 * OVERSEER.config.blockSize);
      if (OVERSEER.cachedBytes <= budget) return;
      for (var [key, entry] of OVERSEER.lru) {
        if (OVERSEER.cachedBytes <= budget) break;
        OVERSEER.lru.delete(key);
        entry.lazy.blocks.delete(entry.index);
        OVERSEER.cachedBytes -= entry.bytes;
        OVERSEER.counters.evictions++;
      }
    },

    // ------------------------------------------------------------------
    // File system type: MEMFS plus lazy files, change tracking and fixes
    // for case-insensitive lookups.
    // ------------------------------------------------------------------

    ops: null,

    fsType: {
      mount(mount) {
        mount.ov = { dirty: new Set(), removed: new Map(), syncing: false };
        return OVERSEER.createNode(null, '/', {{{ cDefs.S_IFDIR | 0o777 }}}, 0);
      },

      // Called through FS.syncfs() by the engine when it finished writing a
      // saved game or its settings. Hands every change since the last call to
      // the host in one batch, so the host can commit it atomically.
      syncfs(mount, populate, done) {
        if (populate) return done(null);
        var ov = mount.ov;
        var persist = mount.opts && mount.opts.persist;
        if (!persist) return done(null);

        var puts = [];
        var sent = [];
        var alive = new Set();
        ov.dirty.forEach((node) => {
          var path = OVERSEER.pathIn(mount, node);
          if (path === null || node.ovLazy || !FS.isFile(node.mode)) return;
          sent.push(node);
          alive.add(path.toLowerCase());
          puts.push({
            key: path.toLowerCase(),
            path,
            mode: node.mode,
            mtime: node.mtime,
            // A copy: the engine keeps running while the host writes. MEMFS
            // holds small files as signed bytes (a slice of HEAP8); the host
            // gets plain bytes whatever the file was stored as.
            data: new Uint8Array(MEMFS.getFileDataAsTypedArray(node)),
          });
        });
        var deletes = [];
        var removedKeys = [];
        ov.removed.forEach((path, key) => {
          removedKeys.push(key);
          if (!alive.has(key) && !OVERSEER.existsIn(mount, path)) deletes.push({ key, path });
        });

        if (!puts.length && !deletes.length) {
          removedKeys.forEach((key) => ov.removed.delete(key));
          return done(null);
        }

        OVERSEER.counters.syncs++;
        Promise.resolve()
          .then(() => persist({ puts, deletes }))
          .then(() => {
            // Anything written again while the host was busy stays dirty.
            sent.forEach((node, i) => {
              if (node.mtime === puts[i].mtime) ov.dirty.delete(node);
            });
            removedKeys.forEach((key) => ov.removed.delete(key));
            done(null);
          }, (err) => {
            OVERSEER.fail('saving changes to browser storage failed', err);
            done(err || new Error('persist failed'));
          });
      },
    },

    createNode(parent, name, mode, dev) {
      var node = MEMFS.createNode(parent, name, mode, dev);
      if (!OVERSEER.ops) OVERSEER.ops = OVERSEER.makeOps();
      if (FS.isDir(node.mode)) {
        node.node_ops = OVERSEER.ops.dirNode;
      } else if (FS.isFile(node.mode)) {
        node.node_ops = OVERSEER.ops.fileNode;
        node.stream_ops = OVERSEER.ops.fileStream;
      }
      return node;
    },

    markDirty(node) {
      if (OVERSEER.populating) return;
      var ov = node.mount && node.mount.ov;
      if (ov) ov.dirty.add(node);
    },

    markRemoved(mount, path) {
      if (OVERSEER.populating || path === null) return;
      mount.ov.removed.set(path.toLowerCase(), path);
    },

    // Path of `node` relative to the root of `mount`, or null when the node is
    // no longer part of the tree.
    pathIn(mount, node) {
      var parts = [];
      while (node !== mount.root) {
        var parent = node.parent;
        if (!parent || parent === node || !parent.contents || parent.contents[node.name] !== node) return null;
        parts.push(node.name);
        node = parent;
      }
      return parts.reverse().join('/');
    },

    existsIn(mount, path) {
      var node = mount.root;
      var parts = path.split('/');
      for (var i = 0; i < parts.length; i++) {
        if (!node.contents) return false;
        try {
          node = FS.lookupNode(node, parts[i]);
        } catch (e) {
          return false;
        }
      }
      return true;
    },

    forEachFile(node, fn) {
      if (FS.isDir(node.mode)) {
        for (var name in node.contents) OVERSEER.forEachFile(node.contents[name], fn);
      } else if (FS.isFile(node.mode)) {
        fn(node);
      }
    },

    // A lazy file is read-only. Truncating it to zero is the one write that
    // needs no data from disk: it becomes an ordinary empty file.
    detachLazy(node) {
      node.ovLazy.drop();
      node.ovLazy = null;
      node.contents = null;
      node.usedBytes = 0;
    },

    makeOps() {
      var dir = MEMFS.ops_table.dir.node;
      var file = MEMFS.ops_table.file;
      return {
        dirNode: {
          getattr: dir.getattr,
          setattr: dir.setattr,
          lookup: dir.lookup,
          readdir: dir.readdir,
          symlink: dir.symlink,
          mknod(parent, name, mode, dev) {
            var node = OVERSEER.createNode(parent, name, mode, dev);
            if (FS.isFile(node.mode)) OVERSEER.markDirty(node);
            return node;
          },
          // MEMFS removes directory entries by the name the caller used. With
          // case-insensitive lookups that name may differ in case from the
          // stored one, which leaves a ghost entry behind in directory
          // listings. Remove by the node's real name instead.
          unlink(parent, name) {
            var node = FS.lookupNode(parent, name);
            OVERSEER.markRemoved(parent.mount, OVERSEER.pathIn(parent.mount, node));
            if (node.ovLazy) node.ovLazy.drop();
            parent.mount.ov.dirty.delete(node);
            delete parent.contents[node.name];
            parent.ctime = parent.mtime = Date.now();
          },
          rmdir(parent, name) {
            var node = FS.lookupNode(parent, name);
            for (var i in node.contents) {
              throw new FS.ErrnoError({{{ cDefs.ENOTEMPTY }}});
            }
            delete parent.contents[node.name];
            parent.ctime = parent.mtime = Date.now();
          },
          rename(old_node, new_dir, new_name) {
            var mount = old_node.mount;
            var moved = [];
            OVERSEER.forEachFile(old_node, (node) => moved.push([node, OVERSEER.pathIn(mount, node)]));

            var existing;
            try {
              existing = FS.lookupNode(new_dir, new_name);
            } catch (e) {}
            if (existing) {
              if (FS.isDir(old_node.mode)) {
                for (var i in existing.contents) {
                  throw new FS.ErrnoError({{{ cDefs.ENOTEMPTY }}});
                }
              }
              if (existing.ovLazy) existing.ovLazy.drop();
              mount.ov.dirty.delete(existing);
              FS.hashRemoveNode(existing);
              // Same ghost entry problem as unlink.
              delete new_dir.contents[existing.name];
            }
            delete old_node.parent.contents[old_node.name];
            new_dir.contents[new_name] = old_node;
            old_node.name = new_name;
            new_dir.ctime = new_dir.mtime = old_node.parent.ctime = old_node.parent.mtime = Date.now();

            moved.forEach(([node, oldPath]) => {
              OVERSEER.markRemoved(mount, oldPath);
              OVERSEER.markDirty(node);
            });
          },
        },

        fileNode: {
          getattr: file.node.getattr,
          setattr(node, attr) {
            if (attr.size !== undefined && node.ovLazy) {
              if (attr.size !== 0) throw new FS.ErrnoError({{{ cDefs.EROFS }}});
              OVERSEER.detachLazy(node);
            }
            file.node.setattr(node, attr);
            if (attr.size !== undefined) {
              node.mtime = node.ctime = Date.now();
              OVERSEER.markDirty(node);
            }
          },
        },

        fileStream: {
          llseek: file.stream.llseek,
          read(stream, buffer, offset, length, position) {
            var lazy = stream.node.ovLazy;
            if (lazy) return lazy.copy(buffer, offset, length, position);
            return file.stream.read(stream, buffer, offset, length, position);
          },
          write(stream, buffer, offset, length, position, canOwn) {
            if (stream.node.ovLazy) throw new FS.ErrnoError({{{ cDefs.EROFS }}});
            var written = file.stream.write(stream, buffer, offset, length, position, canOwn);
            if (written) OVERSEER.markDirty(stream.node);
            return written;
          },
          allocate(stream, offset, length) {
            if (stream.node.ovLazy) throw new FS.ErrnoError({{{ cDefs.EROFS }}});
            file.stream.allocate(stream, offset, length);
            OVERSEER.markDirty(stream.node);
          },
          mmap(stream, length, position, prot, flags) {
            if (stream.node.ovLazy) throw new FS.ErrnoError({{{ cDefs.ENODEV }}});
            return file.stream.mmap(stream, length, position, prot, flags);
          },
          msync(stream, buffer, offset, length, mmapFlags) {
            var rc = file.stream.msync(stream, buffer, offset, length, mmapFlags);
            OVERSEER.markDirty(stream.node);
            return rc;
          },
        },
      };
    },

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    // Decides whether a read can go ahead. Returns null (yes), true (yes, but
    // the browser is due a turn first) or a promise (data is still on disk).
    beforeRead(stream, iov, iovcnt) {
      var lazy = stream.node.ovLazy;
      var can = OVERSEER.canSuspend();
      if (lazy) {
        var total = 0;
        for (var i = 0; i < iovcnt; i++) {
          total += {{{ makeGetValue('iov', C_STRUCTS.iovec.__size__ + ' * i + ' + C_STRUCTS.iovec.iov_len, '*') }}};
        }
        var pending = lazy.ensure(stream.position, total);
        if (pending) {
          if (!can) {
            pending.catch(() => {});
            OVERSEER.fail('a lazy file was read from a context that cannot wait');
            throw new FS.ErrnoError({{{ cDefs.EIO }}});
          }
          return pending;
        }
      }
      return can && OVERSEER.dueForYield() ? true : null;
    },

    finishRead(stream, iov, iovcnt, pnum) {
      var num = doReadv(stream, iov, iovcnt);
      {{{ makeSetValue('pnum', 0, 'num', SIZE_TYPE) }}};
      return 0;
    },

    // ------------------------------------------------------------------
    // Host API (Module.overseer)
    // ------------------------------------------------------------------

    api() {
      var withPopulating = (fn) => {
        OVERSEER.populating++;
        try {
          return fn();
        } finally {
          OVERSEER.populating--;
        }
      };
      return {
        version: 1,
        config: OVERSEER.config,

        // Mounts the change-tracking file system at `path`. `persist` receives
        // `{ puts: [{key, path, mode, mtime, data}], deletes: [{key, path}] }`
        // (paths relative to the mount point) and returns a promise.
        mount(path, persist) {
          FS.mkdirTree(path);
          return FS.mount(OVERSEER.fsType, { persist }, path);
        },

        // Start-up population. None of this counts as a change to persist.
        mkdir(path) {
          withPopulating(() => FS.mkdirTree(path));
        },
        writeFile(path, data, mtime) {
          withPopulating(() => {
            var slash = path.lastIndexOf('/');
            if (slash > 0) FS.mkdirTree(path.substring(0, slash));
            FS.writeFile(path, data, { canOwn: true });
            if (mtime) {
              var node = FS.lookupPath(path).node;
              node.mtime = node.ctime = node.atime = mtime;
            }
          });
        },
        // `read(offset, length)` returns a promise of a Uint8Array.
        addLazyFile(path, size, read) {
          withPopulating(() => {
            var slash = path.lastIndexOf('/');
            if (slash > 0) FS.mkdirTree(path.substring(0, slash));
            var node = FS.create(path, 0o444);
            if (!node.mount || !node.mount.ov) {
              throw new Error('lazy files must live inside an overseer mount: ' + path);
            }
            node.ovLazy = OVERSEER.createLazy(size, read);
            node.usedBytes = size;
          });
        },

        // Arms the watchdog. Call right before callMain().
        start() {
          OVERSEER.lastYield = OVERSEER.now();
          OVERSEER.resumedAt = performance.now();
          OVERSEER.armed = true;
        },
        stop() {
          OVERSEER.armed = false;
        },

        pause: () => OVERSEER.pause(),
        resume: () => OVERSEER.resume(),
        isPaused: () => OVERSEER.paused,

        // Asks the file system to hand pending changes to the host now.
        flush: () => new Promise((resolve, reject) => {
          FS.syncfs(false, (err) => (err ? reject(err) : resolve()));
        }),

        onError(fn) {
          OVERSEER.onError = fn;
        },

        stats: () => ({
          ...OVERSEER.counters,
          cachedBytes: OVERSEER.cachedBytes,
          cachedBlocks: OVERSEER.lru.size,
          pausedMs: OVERSEER.pausedMs,
          paused: OVERSEER.paused,
        }),
      };
    },
  },

  // The engine's view of time: everything in libc and SDL that asks for a
  // monotonic clock ends up here.
  emscripten_get_now__deps: ['$OVERSEER'],
  emscripten_get_now: () => OVERSEER.now(),

  // Sleeping is how the engine paces its frames, and where it stays put while
  // the host has it paused.
  emscripten_sleep__deps: ['$OVERSEER'],
  emscripten_sleep__async: true,
  emscripten_sleep: (ms) => OVERSEER.suspend((wake) => OVERSEER.timer(ms, wake)),

  // The engines are compiled with -DSDL_GetTicks=overseer_ticks, so every
  // look at the clock passes through here. It is the one call that all of the
  // engine's waiting and polling loops have in common, which makes it the
  // place to give the browser its turn.
  // `_SDL_GetTicks` is the engine's own SDL2, exported by the build script.
  // (Listing it as a dependency instead would pull in Emscripten's legacy
  // JavaScript SDL 1.2 clock, which is a different clock.)
  overseer_ticks__deps: ['$OVERSEER'],
  overseer_ticks__async: true,
  overseer_ticks__sig: 'i',
  overseer_ticks: () => {
    if (OVERSEER.rewinding()) return OVERSEER.finishRewind();
    if (OVERSEER.ticksOrigin === null) {
      // Line up with SDL's own tick counter: the engine compares its ticks
      // with the timestamps SDL puts on input events.
      OVERSEER.ticksOrigin = OVERSEER.now() - (_SDL_GetTicks() >>> 0);
    }
    if (OVERSEER.dueForYield() && OVERSEER.canSuspend()) {
      return OVERSEER.suspend((wake) => {
        OVERSEER.breathe(() => wake((OVERSEER.now() - OVERSEER.ticksOrigin) | 0));
      });
    }
    return (OVERSEER.now() - OVERSEER.ticksOrigin) | 0;
  },

  // read(): waits for lazy blocks when they are not in memory yet, and gives
  // the browser its turn during long loads, which read files but never look
  // at the clock.
  fd_read__deps: ['$OVERSEER', '$SYSCALLS', '$doReadv'],
  fd_read__async: true,
  fd_read: (fd, iov, iovcnt, pnum) => {
    if (OVERSEER.rewinding()) return OVERSEER.finishRewind();
    try {
      var stream = SYSCALLS.getStreamFromFD(fd);
      var wait = OVERSEER.beforeRead(stream, iov, iovcnt);
      if (!wait) return OVERSEER.finishRead(stream, iov, iovcnt, pnum);

      return OVERSEER.suspend((wake) => {
        var finish = () => {
          var rc;
          try {
            rc = OVERSEER.finishRead(stream, iov, iovcnt, pnum);
          } catch (e) {
            if (e.name !== 'ErrnoError') throw e;
            rc = e.errno;
          }
          wake(rc);
        };
        if (wait === true) {
          OVERSEER.breathe(finish);
        } else {
          var at = performance.now();
          wait.then(
            () => OVERSEER.wake(finish, at, performance.now() - at),
            (err) => {
              OVERSEER.fail('reading game data failed', err);
              OVERSEER.wake(() => wake({{{ cDefs.EIO }}}), at, performance.now() - at);
            });
        }
      });
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
      return e.errno;
    }
  },
});
