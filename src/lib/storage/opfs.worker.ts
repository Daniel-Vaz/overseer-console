/// <reference lib="webworker" />
/**
 * All writes to the origin private file system happen here.
 *
 * Synchronous access handles are the one way of writing OPFS files that every
 * current browser supports, and they only exist in workers.
 */
import { LAZY_THRESHOLD, STORE_ROOT, type ManifestFile } from './manifest';

export interface ImportEntry {
  path: string;
  file: File;
}

export type WorkerRequest =
  | { id: number; op: 'import'; dir: string[]; entries: ImportEntry[] }
  | { id: number; op: 'write'; dir: string[]; name: string; data: Uint8Array }
  | { id: number; op: 'remove'; dir: string[]; name: string };

export type WorkerResponse =
  | { id: number; type: 'progress'; doneBytes: number; totalBytes: number; path: string }
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

async function importFiles(id: number, dirPath: string[], entries: ImportEntry[]): Promise<ManifestFile[]> {
  const dir = await openDir(dirPath, true);
  const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0);
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
    for (const { path, file } of entries) {
      report(path);
      if (file.size < LAZY_THRESHOLD) {
        const data = new Uint8Array(await file.arrayBuffer());
        writeAll(pack, data, packOffset);
        files.push({ path, size: data.length, pack: [packOffset, data.length] });
        packOffset += data.length;
        doneBytes += data.length;
        continue;
      }

      const blob = `b${String(blobIndex++).padStart(4, '0')}.bin`;
      const access = await openForWriting(dir, blob);
      try {
        for (let offset = 0; offset < file.size; offset += CHUNK) {
          const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
          writeAll(access, chunk, offset);
          doneBytes += chunk.length;
          report(path);
        }
        access.flush();
        if (access.getSize() !== file.size) {
          throw new Error(`${path}: wrote ${access.getSize()} of ${file.size} bytes`);
        }
      } finally {
        access.close();
      }
      files.push({ path, size: file.size, blob });
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
