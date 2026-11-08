/// <reference lib="webworker" />
/**
 * Fetches the Van Buren tech demo from the Internet Archive, and unpacks its
 * archive (F3_Demo.rar, that one or a copy from this device) into storage.
 *
 * The archive is RAR 2.9. RARLAB's own unrar, compiled to WebAssembly
 * (node-unrar-js), reads it here, in a worker, where a file can be read and
 * storage written synchronously, the way unrar asks for both: the archive is
 * read a piece at a time where it lies, and each file in it goes into storage
 * as it comes out. Neither is ever whole in memory.
 *
 * What it writes is laid out as an import writes a game (see storage/manifest.ts).
 */
import { Extractor, UnrarError, type FileHeader, type SeekMethod } from 'node-unrar-js/esm/js/Extractor.js';
import { getUnrar } from 'node-unrar-js/esm/js/unrar.singleton.js';
import wasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url';
import { LAZY_THRESHOLD, MANIFEST_VERSION, STORE_ROOT, dirname, type CurrentPointer, type Manifest, type ManifestFile } from '../storage/manifest';
import { DEMO, DEMO_ID, DEMO_SHELF, DOWNLOAD, demoPath, isReleaseFile, missingDemoFiles } from './demo';

export type UnpackRequest =
  /** The archive from the Internet Archive, into storage beside the demo's files. */
  | { id: number; op: 'fetch' }
  /** The archive fetched before, or this one, into a new copy of the demo's files, which then becomes the one played. */
  | { id: number; op: 'unpack'; archive?: File }
  /** The player has had enough: the job stops at its next piece. */
  | { id: number; op: 'stop' };

export type UnpackResponse =
  | { id: number; type: 'progress'; doneBytes: number; totalBytes: number; path: string }
  /** `release`: every file is the archive.org release's own. */
  | { id: number; type: 'done'; manifest?: Manifest; release?: boolean }
  /** `name`: AbortError when the player stopped it, DemoError when the archive is not the demo's. */
  | { id: number; type: 'error'; name: string; message: string };

type SyncHandle = FileSystemSyncAccessHandle;

/** How much of the archive is read at once, and how much unpacked data is written at once. */
const READ_WINDOW = 4 << 20;
const WRITE_BUFFER = 4 << 20;

const stopped = new Set<number>();
const downloads = new Map<number, AbortController>();

class DemoError extends Error {
  override name = 'DemoError';
}

function stoppedError(): Error {
  const err = new Error('stopped');
  err.name = 'AbortError';
  return err;
}

async function shelfDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const part of [STORE_ROOT, DEMO_SHELF, DEMO_ID]) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

async function openForWriting(dir: FileSystemDirectoryHandle, name: string): Promise<SyncHandle> {
  const access = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
  access.truncate(0);
  return access;
}

function writeAll(access: SyncHandle, data: Uint8Array, at: number): void {
  let written = 0;
  while (written < data.length) {
    const n = access.write(data.subarray(written), { at: at + written });
    if (n <= 0) throw new Error('the browser refused to write (storage full?)');
    written += n;
  }
}

async function writeJson(dir: FileSystemDirectoryHandle, name: string, value: unknown): Promise<void> {
  const access = await openForWriting(dir, name);
  try {
    writeAll(access, new TextEncoder().encode(JSON.stringify(value)), 0);
    access.flush();
  } finally {
    access.close();
  }
}

/** Reports how far a job is, at most ten times a second. */
function reporter(id: number, totalBytes: number): (doneBytes: number, path: string, force?: boolean) => void {
  let last = 0;
  return (doneBytes, path, force = false) => {
    const now = performance.now();
    if (!force && now - last < 100) return;
    last = now;
    postMessage({ id, type: 'progress', doneBytes, totalBytes, path } satisfies UnpackResponse);
  };
}

async function fetchArchive(id: number): Promise<void> {
  const shelf = await shelfDir(true);
  // One fetched before and not unpacked (the player stopped that, or the tab closed) is not fetched again.
  const earlier = await shelf.getFileHandle(DOWNLOAD).then((handle) => handle.getFile()).catch(() => null);
  if (earlier?.size === DEMO.archive.size) {
    reporter(id, earlier.size)(earlier.size, DEMO.archive.name, true);
    return;
  }
  const controller = new AbortController();
  downloads.set(id, controller);
  const access = await openForWriting(shelf, DOWNLOAD);
  try {
    // Not into the browser's cache as well: it is kept here until it is unpacked, and no longer.
    const response = await fetch(DEMO.archive.url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error(`the Internet Archive answered ${response.status} ${response.statusText}`.trim());
    const total = DEMO.archive.size;
    const report = reporter(id, total);
    const reader = response.body.getReader();
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > total) throw new DemoError(`The Internet Archive sent more than the ${total} bytes of ${DEMO.archive.name}: it is not the file the console knows.`);
      writeAll(access, value, at);
      at += value.length;
      report(at, DEMO.archive.name);
    }
    access.flush();
    report(at, DEMO.archive.name, true);
    if (at !== total) throw new Error(`the download broke off after ${at} of ${total} bytes`);
  } catch (err) {
    access.close();
    await shelf.removeEntry(DOWNLOAD).catch(() => undefined);
    throw controller.signal.aborted ? stoppedError() : err;
  } finally {
    downloads.delete(id);
  }
  access.close();
}

/** Where a file of the archive goes: into pack.bin at `base`, or into a blob of its own. */
interface Place {
  path: string;
  size: number;
  access: SyncHandle;
  base: number;
  /** The manifest's entry for it. */
  entry: ManifestFile;
}

/**
 * unrar's view of the files: the archive, read a piece at a time, and the
 * files it holds, each written where it was given a place.
 */
class Unpacker extends Extractor {
  protected _filePath = DEMO.archive.name;
  private readonly reader = new FileReaderSync();
  private archivePos = 0;
  /**
   * The part of the archive read last. unrar reads and writes 20 to 32 KB at a time, and every read of a file
   * and every write to storage costs about a millisecond however small it is: tens of thousands of them made
   * the unpacking ten times as slow as unrar itself.
   */
  private window = new Uint8Array(0);
  private windowAt = 0;
  /** What was unpacked and not yet written, of the one file unrar has open. */
  private readonly pending = new Uint8Array(WRITE_BUFFER);
  private pendingLength = 0;
  private pendingFd = 0;
  private readonly outputs = new Map<number, { place: Place; pos: number }>();
  private nextFd = 2;
  /** What went wrong where unrar does not ask (it closes a file without looking at the answer). */
  failure: Error | null = null;
  /** Told of every piece written: the file's path and how many bytes. */
  onWrite: (path: string, bytes: number) => void = () => undefined;

  constructor(
    unrar: unknown,
    private readonly archive: Blob,
    private readonly places: Map<string, Place> = new Map(),
  ) {
    super(unrar);
  }

  protected open(filename: string): number {
    if (filename !== this._filePath) return 0;
    this.archivePos = 0;
    return 1;
  }

  protected create(filename: string): number {
    const place = this.places.get(filename);
    if (!place) return 0;
    const fd = this.nextFd++;
    this.outputs.set(fd, { place, pos: 0 });
    return fd;
  }

  protected read(fd: number, buf: number, size: number): number {
    if (fd !== 1) return -1;
    const end = Math.min(this.archive.size, this.archivePos + size);
    if (end <= this.archivePos) return 0;
    if (this.archivePos < this.windowAt || end > this.windowAt + this.window.length) {
      this.windowAt = this.archivePos;
      this.window = new Uint8Array(this.reader.readAsArrayBuffer(this.archive.slice(this.archivePos, Math.min(this.archive.size, this.archivePos + Math.max(size, READ_WINDOW)))));
    }
    const data = this.window.subarray(this.archivePos - this.windowAt, end - this.windowAt);
    (this.unrar as { HEAPU8: Uint8Array }).HEAPU8.set(data, buf);
    this.archivePos += data.length;
    return data.length;
  }

  protected write(fd: number, buf: number, size: number): boolean {
    const out = this.outputs.get(fd);
    if (!out || out.pos + size > out.place.size) return false;
    if (this.pendingFd !== fd || this.pendingLength + size > WRITE_BUFFER) this.flushPending();
    const data = (this.unrar as { HEAPU8: Uint8Array }).HEAPU8.subarray(buf, buf + size);
    if (size > WRITE_BUFFER) {
      writeAll(out.place.access, data, out.place.base + out.pos);
    } else {
      this.pending.set(data, this.pendingLength);
      this.pendingLength += size;
      this.pendingFd = fd;
    }
    out.pos += size;
    this.onWrite(out.place.path, size);
    return true;
  }

  /** Writes what was unpacked of the open file and not written yet, where it goes. */
  private flushPending(): void {
    const out = this.outputs.get(this.pendingFd);
    if (out && this.pendingLength) writeAll(out.place.access, this.pending.subarray(0, this.pendingLength), out.place.base + out.pos - this.pendingLength);
    this.pendingLength = 0;
    this.pendingFd = 0;
  }

  protected tell(fd: number): number {
    if (fd === 1) return this.archivePos;
    return this.outputs.get(fd)?.pos ?? -1;
  }

  protected seek(fd: number, pos: number, method: SeekMethod): boolean {
    const size = fd === 1 ? this.archive.size : this.outputs.get(fd)?.place.size;
    if (size === undefined) return false;
    const now = fd === 1 ? this.archivePos : this.outputs.get(fd)!.pos;
    const to = method === 'SET' ? pos : method === 'END' ? size + pos : now + pos;
    if (to < 0 || to > size) return false;
    if (fd === 1) this.archivePos = to;
    else this.outputs.get(fd)!.pos = to;
    return true;
  }

  protected closeFile(fd: number): void {
    if (fd === this.pendingFd) this.flushPending();
    const out = this.outputs.get(fd);
    this.outputs.delete(fd);
    if (out && out.pos !== out.place.size) this.failure ??= new Error(`${out.place.path}: unpacked ${out.pos} of ${out.place.size} bytes`);
  }
}

let unrarModule: Promise<unknown> | null = null;

function loadUnrar(): Promise<unknown> {
  unrarModule ??= fetch(wasmUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`could not load the RAR reader (HTTP ${response.status})`);
      return response.arrayBuffer();
    })
    .then((wasmBinary) => getUnrar({ wasmBinary }));
  return unrarModule;
}

/** What unrar's complaints mean here. */
function unrarMessage(err: UnrarError): string {
  switch (err.reason) {
    case 'ERAR_BAD_DATA':
      return `${err.file ?? 'A file'} is damaged in the archive: it does not unpack to what the archive says it holds. Fetch or copy the archive again.`;
    case 'ERAR_BAD_ARCHIVE':
    case 'ERAR_UNKNOWN_FORMAT':
      return 'That is not a RAR archive the console can read.';
    case 'ERAR_EREAD':
      return 'The archive could not be read to its end: it is incomplete. Fetch or copy it again.';
    case 'ERAR_MISSING_PASSWORD':
    case 'ERAR_BAD_PASSWORD':
      return 'The archive is locked with a password.';
    default:
      return `The archive could not be unpacked (${err.reason}).`;
  }
}

async function unpack(id: number, given?: File): Promise<{ manifest: Manifest; release: boolean }> {
  const shelf = await shelfDir(true);
  const archive = given ?? (await (await shelf.getFileHandle(DOWNLOAD)).getFile());
  const unrar = await loadUnrar();

  // What it holds, first: whether it is the demo, and what of it is kept.
  const lister = new Unpacker(unrar, archive);
  (unrar as { extractor: unknown }).extractor = lister;
  let headers: FileHeader[];
  try {
    headers = [...lister.getFileList().fileHeaders];
  } catch (err) {
    throw err instanceof UnrarError ? new DemoError(unrarMessage(err)) : err;
  }
  const kept = headers.filter((header) => !header.flags.directory && demoPath(header.name) !== null);
  const missing = missingDemoFiles(kept.map((header) => header.name));
  if (missing.length) {
    throw new DemoError(`That archive is not the Van Buren tech demo: it has no ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' and more' : ''}.`);
  }
  if (kept.some((header) => header.flags.encrypted)) throw new DemoError('The archive is locked with a password.');
  const release = kept.every((header) => isReleaseFile(header.name, header.unpSize, header.crc));

  const install = `i${Date.now().toString(36)}`;
  const dir = await shelf.getDirectoryHandle(install, { create: true });
  const handles: SyncHandle[] = [];
  let manifest: Manifest;
  try {
    // Small files back to back in pack.bin, the large ones in blobs of their own: as an import lays out a game.
    const pack = await openForWriting(dir, 'pack.bin');
    handles.push(pack);
    const places = new Map<string, Place>();
    let packOffset = 0;
    let blobIndex = 0;
    for (const header of kept) {
      const path = demoPath(header.name)!;
      const size = header.unpSize;
      if (size < LAZY_THRESHOLD) {
        places.set(header.name, { path, size, access: pack, base: packOffset, entry: { path, size, pack: [packOffset, size] } });
        packOffset += size;
      } else {
        const blob = `b${String(blobIndex++).padStart(4, '0')}.bin`;
        const access = await openForWriting(dir, blob);
        handles.push(access);
        places.set(header.name, { path, size, access, base: 0, entry: { path, size, blob } });
      }
    }

    const totalBytes = kept.reduce((sum, header) => sum + header.unpSize, 0);
    const report = reporter(id, totalBytes);
    let doneBytes = 0;
    const extractor = new Unpacker(unrar, archive, places);
    extractor.onWrite = (path, bytes) => {
      doneBytes += bytes;
      report(doneBytes, path);
    };
    (unrar as { extractor: unknown }).extractor = extractor;
    try {
      const { files } = extractor.extract({ files: (header) => places.has(header.name) });
      // One file at a time; a stop the player asked for while it was unpacked gets in between.
      while (!files.next().done) {
        if (extractor.failure) throw extractor.failure;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (stopped.has(id)) throw stoppedError();
      }
    } catch (err) {
      throw err instanceof UnrarError ? new DemoError(unrarMessage(err)) : err;
    }
    if (extractor.failure) throw extractor.failure;
    report(doneBytes, '', true);
    for (const access of handles) access.flush();
    for (const place of places.values()) {
      if (place.access !== pack && place.access.getSize() !== place.size) throw new Error(`${place.path}: wrote ${place.access.getSize()} of ${place.size} bytes`);
    }
    for (const access of handles.splice(0)) access.close();

    const files = [...places.values()].map((place) => place.entry);
    const dirs = [...new Set(files.map((file) => dirname(file.path)).filter(Boolean)), 'Override'].sort();
    manifest = { version: MANIFEST_VERSION, game: DEMO_ID, install, importedAt: Date.now(), totalBytes, files, dirs };
    await writeJson(dir, 'manifest.json', manifest);
    // The switch: from here on this copy is the one played.
    await writeJson(shelf, 'current.json', { install } satisfies CurrentPointer);
  } catch (err) {
    for (const access of handles) access.close();
    await shelf.removeEntry(install, { recursive: true }).catch(() => undefined);
    throw err;
  }

  // Earlier copies, anything an interrupted job left behind, and the archive, once unpacked.
  for await (const [name] of shelf.entries()) {
    if (name !== install && name !== 'current.json') await shelf.removeEntry(name, { recursive: true }).catch(() => undefined);
  }
  return { manifest, release };
}

/** Unpacks; a fetched archive that turns out not to be the demo, or damaged, is not kept for another try. */
async function unpackOrDrop(id: number, given?: File): Promise<{ manifest: Manifest; release: boolean }> {
  try {
    return await unpack(id, given);
  } catch (err) {
    if (!given && err instanceof DemoError) await (await shelfDir(true)).removeEntry(DOWNLOAD).catch(() => undefined);
    throw err;
  }
}

self.onmessage = async (event: MessageEvent<UnpackRequest>) => {
  const request = event.data;
  if (request.op === 'stop') {
    stopped.add(request.id);
    downloads.get(request.id)?.abort();
    return;
  }
  try {
    if (request.op === 'fetch') {
      await fetchArchive(request.id);
      postMessage({ id: request.id, type: 'done' } satisfies UnpackResponse);
    } else {
      const { manifest, release } = await unpackOrDrop(request.id, request.archive);
      postMessage({ id: request.id, type: 'done', manifest, release } satisfies UnpackResponse);
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ id: request.id, type: 'error', name, message } satisfies UnpackResponse);
  } finally {
    stopped.delete(request.id);
  }
};
