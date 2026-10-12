/// <reference lib="webworker" />
/**
 * All writes to the origin private file system happen here.
 *
 * Synchronous access handles are the one way of writing OPFS files that every
 * current browser supports, and they only exist in workers.
 */
import { LAZY_THRESHOLD, STORE_ROOT, type ManifestFile } from './manifest';

/**
 * A file to copy in: one the worker reads itself, or (given by its size
 * alone) one the page reads for it, piece by piece. The second kind is how
 * files that are not on this device arrive.
 */
export type ImportEntry = { path: string; file: File } | { path: string; size: number };

export type WorkerRequest =
  | { id: number; op: 'import'; dir: string[]; entries: ImportEntry[] }
  | { id: number; op: 'write'; dir: string[]; name: string; data: Uint8Array }
  | { id: number; op: 'remove'; dir: string[]; name: string }
  /** The page's answer to a 'read': the bytes, or why there are none. */
  | { id: number; op: 'data'; data: Uint8Array }
  | { id: number; op: 'no-data'; message: string };

export type WorkerResponse =
  | { id: number; type: 'progress'; doneBytes: number; totalBytes: number; path: string }
  /** Asks the page for part of an entry the worker cannot read itself. */
  | { id: number; type: 'read'; entry: number; offset: number; length: number }
  | { id: number; type: 'done'; files?: ManifestFile[] }
  | { id: number; type: 'error'; message: string };

const CHUNK = 4 << 20;

type SyncHandle = FileSystemSyncAccessHandle;

async function openDir(path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  dir = await dir.getDirectoryHandle(STORE_ROOT, { create });
  for (const part of path) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

async function openForWriting(dir: FileSystemDirectoryHandle, name: string): Promise<SyncHandle> {
  const handle = await dir.getFileHandle(name, { create: true });
  const access = await handle.createSyncAccessHandle();
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

/** Reads the page is being waited on for, by the import that asked. */
const awaited = new Map<number, { resolve: (data: Uint8Array) => void; reject: (err: Error) => void }>();

function sizeOf(entry: ImportEntry): number {
  return 'file' in entry ? entry.file.size : entry.size;
}

/** `length` bytes of an entry from `offset`, wherever the entry lives. */
async function read(id: number, entries: ImportEntry[], index: number, offset: number, length: number): Promise<Uint8Array> {
  const entry = entries[index]!;
  if (length === 0) return new Uint8Array(0);
  if ('file' in entry) return new Uint8Array(await entry.file.slice(offset, offset + length).arrayBuffer());
  const data = await new Promise<Uint8Array>((resolve, reject) => {
    awaited.set(id, { resolve, reject });
    postMessage({ id, type: 'read', entry: index, offset, length } satisfies WorkerResponse);
  });
  if (data.length !== length) throw new Error(`${entry.path}: received ${data.length} of ${length} bytes`);
  return data;
}

async function importFiles(id: number, dirPath: string[], entries: ImportEntry[]): Promise<ManifestFile[]> {
  const dir = await openDir(dirPath, true);
  const totalBytes = entries.reduce((sum, e) => sum + sizeOf(e), 0);
  let doneBytes = 0;
  let lastReport = 0;
  const report = (path: string, force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 100) return;
    lastReport = now;
    postMessage({ id, type: 'progress', doneBytes, totalBytes, path } satisfies WorkerResponse);
  };

  const files: ManifestFile[] = [];
  const pack = await openForWriting(dir, 'pack.bin');
  let packOffset = 0;
  let blobIndex = 0;
  try {
    for (const [index, entry] of entries.entries()) {
      const { path } = entry;
      const size = sizeOf(entry);
      report(path);
      if (size < LAZY_THRESHOLD) {
        const data = await read(id, entries, index, 0, size);
        writeAll(pack, data, packOffset);
        files.push({ path, size: data.length, pack: [packOffset, data.length] });
        packOffset += data.length;
        doneBytes += data.length;
        continue;
      }

      const blob = `b${String(blobIndex++).padStart(4, '0')}.bin`;
      const access = await openForWriting(dir, blob);
      try {
        for (let offset = 0; offset < size; offset += CHUNK) {
          const chunk = await read(id, entries, index, offset, Math.min(CHUNK, size - offset));
          writeAll(access, chunk, offset);
          doneBytes += chunk.length;
          report(path);
        }
        access.flush();
        if (access.getSize() !== size) {
          throw new Error(`${path}: wrote ${access.getSize()} of ${size} bytes`);
        }
      } finally {
        access.close();
      }
      files.push({ path, size, blob });
    }
    pack.flush();
  } finally {
    pack.close();
  }
  report('', true);
  return files;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.op === 'data' || request.op === 'no-data') {
    const waiting = awaited.get(request.id);
    awaited.delete(request.id);
    if (request.op === 'data') waiting?.resolve(request.data);
    else waiting?.reject(new Error(request.message));
    return;
  }
  try {
    if (request.op === 'import') {
      const files = await importFiles(request.id, request.dir, request.entries);
      postMessage({ id: request.id, type: 'done', files } satisfies WorkerResponse);
    } else if (request.op === 'write') {
      const dir = await openDir(request.dir, true);
      const access = await openForWriting(dir, request.name);
      try {
        writeAll(access, request.data, 0);
        access.flush();
      } finally {
        access.close();
      }
      postMessage({ id: request.id, type: 'done' } satisfies WorkerResponse);
    } else {
      try {
        const dir = await openDir(request.dir, false);
        await dir.removeEntry(request.name, { recursive: true });
      } catch (err) {
        // Removing something that is not there is not an error.
        if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
      }
      postMessage({ id: request.id, type: 'done' } satisfies WorkerResponse);
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    postMessage({ id: request.id, type: 'error', message } satisfies WorkerResponse);
  }
};
