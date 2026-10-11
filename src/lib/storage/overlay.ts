/**
 * The overlay: every file a game created or changed, kept in IndexedDB.
 *
 * Imported game data is read-only. Saved games, settings and anything else
 * the engine writes land here, layered over the import when a game starts.
 * A batch of changes is committed in one transaction: a saved game (dozens of
 * files) is either stored completely or not at all.
 */
import type { GameId } from '../games';

const DB_NAME = 'overseer-console';
const DB_VERSION = 1;
const STORE = 'overlay';

export interface OverlayEntry {
  game: GameId;
  /** Lower-cased path relative to the game folder. */
  key: string;
  /** The same path as the engine spelled it. */
  path: string;
  mtime: number;
  /** A tombstone: the engine deleted a file that came with the import. */
  deleted: boolean;
  data?: Uint8Array;
}

export interface OverlayChanges {
  puts: { key: string; path: string; mtime: number; data: Uint8Array }[];
  deletes: { key: string; path: string }[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: ['game', 'key'] });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema must not be blocked by this one.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('could not open the save database'));
    };
    request.onblocked = () => reject(new Error('the save database is in use by an older page; close other tabs'));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('storage transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('storage transaction was aborted'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('storage request failed'));
  });
}

function rangeFor(game: GameId, prefix = ''): IDBKeyRange {
  return IDBKeyRange.bound([game, prefix], [game, `${prefix}￿`]);
}

/** Everything the given game has written, optionally below a path prefix. */
export async function listOverlay(game: GameId, prefix = ''): Promise<OverlayEntry[]> {
  const db = await openDb();
  return result(db.transaction(STORE).objectStore(STORE).getAll(rangeFor(game, prefix)) as IDBRequest<OverlayEntry[]>);
}

/** The paths of everything a game has written, without loading any contents. */
export async function listOverlayKeys(game: GameId, prefix = ''): Promise<string[]> {
  const db = await openDb();
  const keys = await result(db.transaction(STORE).objectStore(STORE).getAllKeys(rangeFor(game, prefix)));
  return keys.map((key) => (key as [GameId, string])[1]);
}

/** One file a game has written, or undefined. A tombstone counts as absent. */
export async function readOverlay(game: GameId, key: string): Promise<OverlayEntry | undefined> {
  const db = await openDb();
  const entry = await result(db.transaction(STORE).objectStore(STORE).get([game, key]) as IDBRequest<OverlayEntry | undefined>);
  return entry && !entry.deleted && entry.data ? entry : undefined;
}

/** Applies a batch of changes atomically and waits until it is on disk. */
export async function commitOverlay(game: GameId, changes: OverlayChanges): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
  const store = tx.objectStore(STORE);
  for (const put of changes.puts) {
    store.put({ game, key: put.key, path: put.path, mtime: put.mtime, deleted: false, data: put.data } satisfies OverlayEntry);
  }
  for (const del of changes.deletes) {
    store.put({ game, key: del.key, path: del.path, mtime: Date.now(), deleted: true } satisfies OverlayEntry);
  }
  await done(tx);
}

/**
 * Replaces everything below a path prefix with the given files, atomically:
 * the folder holds either all of the old files or all of the new ones.
 */
export async function replaceOverlay(game: GameId, prefix: string, puts: OverlayChanges['puts']): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
  const store = tx.objectStore(STORE);
  store.delete(rangeFor(game, prefix));
  for (const put of puts) {
    store.put({ game, key: put.key, path: put.path, mtime: put.mtime, deleted: false, data: put.data } satisfies OverlayEntry);
  }
  await done(tx);
}

/** Forgets overlay entries: all of a game's, or those below a path prefix. */
export async function clearOverlay(game: GameId, prefix = ''): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
  tx.objectStore(STORE).delete(rangeFor(game, prefix));
  await done(tx);
}

/** Number of entries, without loading their contents. */
export async function countOverlay(game: GameId, prefix = ''): Promise<number> {
  const db = await openDb();
  return result(db.transaction(STORE).objectStore(STORE).count(rangeFor(game, prefix)));
}
