/**
 * The game data store: imported game files in the origin private file system.
 *
 * Reading happens on the page (plain File objects, read on demand); every
 * write goes through opfs.worker.ts.
 */
import { readRange, sourceOf } from '../blobs';
import type { GameId } from '../games';
import { STORE_ROOT, pathKey, type CurrentPointer, type Manifest, type ManifestFile } from './manifest';
import type { ImportEntry, WorkerRequest, WorkerResponse } from './opfs.worker';

type WorkerOp = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export interface ImportProgress {
  doneBytes: number;
  totalBytes: number;
  path: string;
}

/**
 * What can be copied into the store: a File from this device, or anything
 * that is read the same way, such as a file in the player's Dropbox or Google Drive.
 */
export interface SourceBlob {
  readonly size: number;
  readonly lastModified: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface SourceEntry {
  path: string;
  file: SourceBlob;
}

/** Reads part of an entry on the worker's behalf. */
type PageRead = (entry: number, offset: number, length: number) => Promise<Uint8Array>;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (files?: ManifestFile[]) => void; reject: (err: Error) => void; onProgress?: (p: ImportProgress) => void; read?: PageRead }
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
    } else if (message.type === 'read') {
      const { id } = message;
      const answer = (request: WorkerRequest, transfer: Transferable[] = []) => worker?.postMessage(request, transfer);
      (entry.read ? entry.read(message.entry, message.offset, message.length) : Promise.reject(new Error('nothing to read from'))).then(
        (data) => answer({ id, op: 'data', data }, [data.buffer]),
        (err: unknown) => answer({ id, op: 'no-data', message: err instanceof Error ? err.message : String(err) }),
      );
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

/** What an import that the player stopped ends with. */
function stoppedError(): DOMException {
  return new DOMException('the import was stopped', 'AbortError');
}

/** Whether something failed because the player stopped it, not because anything went wrong. */
export function wasStopped(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function call(op: WorkerOp, onProgress?: (p: ImportProgress) => void, read?: PageRead, signal?: AbortSignal): Promise<ManifestFile[] | undefined> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(stoppedError());
      return;
    }
    const id = nextId++;
    const stop = () => getWorker().postMessage({ id, op: 'stop' } satisfies WorkerRequest);
    signal?.addEventListener('abort', stop, { once: true });
    pending.set(id, {
      resolve: (files) => {
        signal?.removeEventListener('abort', stop);
        resolve(files);
      },
      reject: (err) => {
        signal?.removeEventListener('abort', stop);
        // Whatever the worker made of being stopped, the page knows why it ended.
        reject(signal?.aborted ? stoppedError() : err);
      },
      onProgress,
      read,
    });
    getWorker().postMessage({ ...op, id });
  });
}

/** Whether this browser has the storage interfaces at all. */
export function storageSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory && typeof indexedDB !== 'undefined';
}

/** The browser has the interfaces but refuses to open the file system. */
export class StorageUnavailableError extends Error {
  override name = 'StorageUnavailableError';
}

/**
 * Private windows are the usual case: Safari and Firefox keep the interface
 * there but reject every attempt to use it.
 */
async function storeRoot(): Promise<FileSystemDirectoryHandle> {
  try {
    return await navigator.storage.getDirectory();
  } catch (err) {
    throw new StorageUnavailableError(`this browser window cannot store game data (${err instanceof Error ? err.name : 'refused'})`);
  }
}

/** Whether game data can really be stored here, found out by trying. */
export async function probeStorage(): Promise<boolean> {
  if (!storageSupported()) return false;
  try {
    await storeRoot();
    return true;
  } catch {
    return false;
  }
}

/** Where installs are kept: the games and mods, or the add-ons laid over them (see addons.ts). */
export type Shelf = 'games' | 'addons';

async function gameDir(game: GameId, create = false, shelf: Shelf = 'games'): Promise<FileSystemDirectoryHandle> {
  const root = await storeRoot();
  const store = await root.getDirectoryHandle(STORE_ROOT, { create });
  const games = await store.getDirectoryHandle(shelf, { create });
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

/** The installed copy of a game (or on the add-ons' shelf, of an add-on), or null when there is none. */
export async function loadInstall(game: GameId, shelf: Shelf = 'games'): Promise<Install | null> {
  try {
    const dir = await gameDir(game, false, shelf);
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
 * A file of an install by its path in the game folder (any case), wherever
 * the import put its contents. Null when the install holds no such file.
 */
export async function openInstalled(install: Install, path: string): Promise<SourceBlob | null> {
  const key = pathKey(path);
  const file = install.manifest.files.find((candidate) => pathKey(candidate.path) === key);
  if (!file) return null;
  if (file.blob) return openBlob(install, file.blob);
  if (!file.pack) return null;
  const pack = await openBlob(install, 'pack.bin');
  const [offset] = file.pack;
  return sourceOf(file.size, install.manifest.importedAt, (start, end) => readRange(pack, offset + start, offset + end));
}

/**
 * Copies `entries` into a new install directory and makes it current.
 * `describe` receives where each file ended up and returns the manifest.
 *
 * `signal` stops the copy: it then ends with an error that wasStopped()
 * knows, and the game is as it was before.
 */
export async function writeInstall(
  game: GameId,
  entries: SourceEntry[],
  describe: (install: string, files: ManifestFile[]) => Manifest,
  onProgress?: (p: ImportProgress) => void,
  signal?: AbortSignal,
  shelf: Shelf = 'games',
): Promise<Manifest> {
  const install = `i${Date.now().toString(36)}`;
  const base = [shelf, game];
  const previous = await loadInstall(game, shelf).catch(() => null);

  // Files of this device go to the worker as they are. Anything else it asks
  // the page for, a piece at a time.
  const handed = entries.map(({ path, file }): ImportEntry => (file instanceof File ? { path, file } : { path, size: file.size }));
  let files: ManifestFile[] | undefined;
  try {
    files = await call(
      { op: 'import', dir: [...base, install], entries: handed },
      onProgress,
      async (entry, offset, length) => new Uint8Array(await entries[entry]!.file.slice(offset, offset + length).arrayBuffer()),
      signal,
    );
    // Stopped in the moment between the last byte and the switch: still stopped.
    if (signal?.aborted) throw stoppedError();
  } catch (err) {
    // Nothing points at what was copied so far; it would only take up room.
    await call({ op: 'remove', dir: base, name: install }).catch(() => undefined);
    throw err;
  }
  const manifest = describe(install, files ?? []);
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  await call({ op: 'write', dir: [...base, install], name: 'manifest.json', data: encode(manifest) });
  // The switch: from here on the new copy is the installed one.
  await call({ op: 'write', dir: base, name: 'current.json', data: encode({ install } satisfies CurrentPointer) });

  // Drop the previous copy and anything an interrupted import left behind.
  const dir = await gameDir(game, false, shelf);
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory' && name !== install) {
      await call({ op: 'remove', dir: base, name }).catch(() => undefined);
    }
  }
  void previous;
  return manifest;
}

/** The ids of every game (or add-on) that has a folder in the store, installed or half so. */
export async function storedGames(shelf: Shelf = 'games'): Promise<string[]> {
  try {
    const root = await storeRoot();
    const store = await root.getDirectoryHandle(STORE_ROOT);
    const games = await store.getDirectoryHandle(shelf);
    const names: string[] = [];
    for await (const [name, handle] of games.entries()) if (handle.kind === 'directory') names.push(name);
    return names.sort();
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

export async function removeInstall(game: GameId, shelf: Shelf = 'games'): Promise<void> {
  await call({ op: 'remove', dir: [shelf], name: game });
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
