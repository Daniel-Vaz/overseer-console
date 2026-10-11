/**
 * The game data store: imported game files in the origin private file system.
 *
 * Reading happens on the page (plain File objects, read on demand); every
 * write goes through opfs.worker.ts.
 */
import type { GameId } from '../games';
import { STORE_ROOT, type CurrentPointer, type Manifest, type ManifestFile } from './manifest';
import type { ImportEntry, WorkerRequest, WorkerResponse } from './opfs.worker';

type WorkerOp = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export interface ImportProgress {
  doneBytes: number;
  totalBytes: number;
  path: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (files?: ManifestFile[]) => void; reject: (err: Error) => void; onProgress?: (p: ImportProgress) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module', name: 'overseer-storage' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') {
      entry.onProgress?.(message);
    } else if (message.type === 'done') {
      pending.delete(message.id);
      entry.resolve(message.files);
    } else {
      pending.delete(message.id);
      entry.reject(new Error(message.message));
    }
  };
  worker.onerror = (event) => {
    const err = new Error(`storage worker failed: ${event.message}`);
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(op: WorkerOp, onProgress?: (p: ImportProgress) => void): Promise<ManifestFile[] | undefined> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...op, id });
  });
}

/** Whether this browser can hold game data at all. */
export function storageSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory && typeof indexedDB !== 'undefined';
}

async function gameDir(game: GameId, create = false): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const store = await root.getDirectoryHandle(STORE_ROOT, { create });
  const games = await store.getDirectoryHandle('games', { create });
  return games.getDirectoryHandle(game, { create });
}

async function readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T> {
  const file = await (await dir.getFileHandle(name)).getFile();
  return JSON.parse(await file.text()) as T;
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');
}

export interface Install {
  manifest: Manifest;
  dir: FileSystemDirectoryHandle;
}

/** The installed copy of a game, or null when there is none. */
export async function loadInstall(game: GameId): Promise<Install | null> {
  try {
    const dir = await gameDir(game);
    const current = await readJson<CurrentPointer>(dir, 'current.json');
    const installDir = await dir.getDirectoryHandle(current.install);
    const manifest = await readJson<Manifest>(installDir, 'manifest.json');
    if (manifest.game !== game || !Array.isArray(manifest.files)) return null;
    return { manifest, dir: installDir };
  } catch (err) {
    if (isNotFound(err) || err instanceof SyntaxError) return null;
    throw err;
  }
}

/** Opens a stored file. The File is a handle: nothing is read until asked. */
export async function openBlob(install: Install, name: string): Promise<File> {
  return (await install.dir.getFileHandle(name)).getFile();
}

/**
 * Copies `entries` into a new install directory and makes it current.
 * `describe` receives where each file ended up and returns the manifest.
 */
export async function writeInstall(
  game: GameId,
  entries: ImportEntry[],
  describe: (install: string, files: ManifestFile[]) => Manifest,
  onProgress?: (p: ImportProgress) => void,
): Promise<Manifest> {
  const install = `i${Date.now().toString(36)}`;
  const base = ['games', game];
  const previous = await loadInstall(game).catch(() => null);

  const files = await call({ op: 'import', dir: [...base, install], entries }, onProgress);
  const manifest = describe(install, files ?? []);
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  await call({ op: 'write', dir: [...base, install], name: 'manifest.json', data: encode(manifest) });
  // The switch: from here on the new copy is the installed one.
  await call({ op: 'write', dir: base, name: 'current.json', data: encode({ install } satisfies CurrentPointer) });

  // Drop the previous copy and anything an interrupted import left behind.
  const dir = await gameDir(game);
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory' && name !== install) {
      await call({ op: 'remove', dir: base, name }).catch(() => undefined);
    }
  }
  void previous;
  return manifest;
}

export async function removeInstall(game: GameId): Promise<void> {
  await call({ op: 'remove', dir: ['games'], name: game });
}

export interface StorageStatus {
  usage: number;
  quota: number;
  persisted: boolean;
}

export async function storageStatus(): Promise<StorageStatus> {
  const estimate = (await navigator.storage.estimate?.()) ?? {};
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
}

/**
 * Asks the browser not to evict this site's data under storage pressure.
 * Browsers decide on their own; some grant it silently, some never do.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage.persist?.()) ?? false;
  } catch {
    return false;
  }
}
