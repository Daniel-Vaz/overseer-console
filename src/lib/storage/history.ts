/**
 * Save history: earlier versions of every save slot.
 *
 * Saving over a slot destroys what was in it, and these games are well known
 * for saves that turn out to be dead ends hours later. So before a slot is
 * overwritten - by the game, by restoring an archive, by a save fetched from
 * the player's cloud, or by rolling back - its previous contents are kept
 * as a version. Erasing a slot does the same, and leaves its versions where
 * they are for a week: an erased save can be put back.
 *
 * A save rewrites dozens of map files of which most did not change, so file
 * contents are stored once per slot under their hash and shared by the
 * versions that contain them.
 *
 * Kept in a database of its own: nothing here can damage the saves
 * themselves, and a failure to keep a version never stops a save.
 */
import type { GameId } from '../games';
import { SAVE_PREFIX, isSaveData, parseSaveHeader, slotOf, slotPrefix, type SaveHeader } from '../savefile';
import { clearOverlay, commitOverlay, listOverlay, listOverlayKeys, replaceOverlay, type OverlayChanges, type OverlayEntry } from './overlay';

const DB_NAME = 'overseer-console-history';
const DB_VERSION = 1;
const VERSIONS = 'versions';
const BLOBS = 'blobs';

/** 'cloud' is a save fetched from Dropbox (the only cloud there was when it was named), 'drive' one from Google Drive. */
export type VersionCause = 'save' | 'import' | 'restore' | 'cloud' | 'drive' | 'erase' | 'edit';

interface VersionFile {
  key: string;
  path: string;
  mtime: number;
  size: number;
  hash: string;
}

/** One earlier state of a slot. */
export interface SaveVersion {
  game: GameId;
  slot: number;
  /** When this state was saved; identifies the version within its slot. */
  id: number;
  /** When it was replaced, and by what. */
  replacedAt: number;
  cause: VersionCause;
  bytes: number;
  /** What SAVE.DAT says about it. */
  header: Omit<SaveHeader, 'thumbnail'>;
  files: VersionFile[];
}

interface StoredBlob {
  game: GameId;
  slot: number;
  hash: string;
  data: Uint8Array;
}

// ---------------------------------------------------------------------
// Which versions to keep
// ---------------------------------------------------------------------

/** The latest versions of a slot are always kept. */
export const KEEP_RECENT = 3;

/**
 * Older ones thin out with age: one per span of time, each span three times
 * as long as the one before (10 minutes, 30 minutes, ... 40 hours), and one
 * for everything older still. Together with the recent ones that is at most
 * ten versions per slot, reaching back from minutes to days.
 */
const SPAN_LIMITS_MS = [10, 30, 90, 270, 810, 2430].map((minutes) => minutes * 60_000);

export const MAX_VERSIONS = KEEP_RECENT + SPAN_LIMITS_MS.length + 1;

/**
 * Decides which versions survive, and returns their ids.
 *
 * Age is counted from the moment a version stopped being the slot's content
 * (`replacedAt`), not from when it was saved: after rolling back to an old
 * save and playing on, that old save is the freshest piece of history.
 */
export function versionsToKeep(versions: { id: number; replacedAt: number }[], now: number): Set<number> {
  const newestFirst = [...versions].sort((a, b) => b.replacedAt - a.replacedAt || b.id - a.id);
  const keep = new Set(newestFirst.slice(0, KEEP_RECENT).map((version) => version.id));
  const bySpan = new Map<number, { id: number; replacedAt: number }>();
  for (const version of newestFirst.slice(KEEP_RECENT)) {
    const age = now - version.replacedAt;
    let span = SPAN_LIMITS_MS.findIndex((limit) => age < limit);
    if (span < 0) span = SPAN_LIMITS_MS.length;
    const held = bySpan.get(span);
    // Within a span the oldest version stays, so that it lives long enough to
    // move on to the next span. The open-ended last span keeps its newest:
    // the far end of the trail moves forward instead of freezing forever.
    const wins =
      held === undefined ||
      (span < SPAN_LIMITS_MS.length ? version.replacedAt < held.replacedAt : version.replacedAt > held.replacedAt);
    if (wins) bySpan.set(span, version);
  }
  for (const version of bySpan.values()) keep.add(version.id);
  return keep;
}

// ---------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VERSIONS)) db.createObjectStore(VERSIONS, { keyPath: ['game', 'slot', 'id'] });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: ['game', 'slot', 'hash'] });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('could not open the save history'));
    };
    request.onblocked = () => reject(new Error('the save history is in use by an older page; close other tabs'));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('history transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('history transaction was aborted'));
  });
  // A failing request rejects its own promise first; this one must not then
  // surface as an unhandled rejection.
  finished.catch(() => undefined);
  return finished;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('history request failed'));
  });
}

/** Every version (or blob) of one slot, or of all slots of a game. */
function rangeFor(game: GameId, slot?: number): IDBKeyRange {
  return slot === undefined
    ? IDBKeyRange.bound([game], [game, []])
    : IDBKeyRange.bound([game, slot], [game, slot, []]);
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

// ---------------------------------------------------------------------
// Keeping versions
// ---------------------------------------------------------------------

function liveFiles(entries: OverlayEntry[]): OverlayEntry[] {
  return entries.filter((entry) => !entry.deleted && entry.data);
}

/**
 * Keeps what a slot holds right now as a version, and says whether it did:
 * nothing is kept of a slot that is empty or does not hold a readable save.
 * Safe to repeat: the same state is the same version.
 */
async function keepVersion(game: GameId, slot: number, cause: VersionCause, now: number): Promise<boolean> {
  const entries = liveFiles(await listOverlay(game, slotPrefix(slot)));
  const main = entries.find((entry) => isSaveData(entry.key));
  const header = main ? parseSaveHeader(main.data!) : null;
  if (!main || !header) return false;

  const files: VersionFile[] = await Promise.all(
    entries.map(async (entry) => ({
      key: entry.key,
      path: entry.path,
      mtime: entry.mtime,
      size: entry.data!.length,
      hash: await sha256(entry.data!),
    })),
  );
  const { thumbnail: _thumbnail, ...summary } = header;
  const version: SaveVersion = {
    game,
    slot,
    id: main.mtime,
    replacedAt: now,
    cause,
    bytes: files.reduce((sum, file) => sum + file.size, 0),
    header: summary,
    files,
  };

  const db = await openDb();
  const tx = db.transaction([VERSIONS, BLOBS], 'readwrite', { durability: 'strict' });
  const finished = done(tx);
  const versions = tx.objectStore(VERSIONS);
  const blobs = tx.objectStore(BLOBS);

  // Contents this slot's history does not hold yet. One request at a time
  // keeps the transaction alive between them.
  const stored = new Set((await result(blobs.getAllKeys(rangeFor(game, slot)))).map((key) => (key as [GameId, number, string])[2]));
  entries.forEach((entry, index) => {
    const hash = files[index]!.hash;
    if (stored.has(hash)) return;
    stored.add(hash);
    blobs.put({ game, slot, hash, data: entry.data! } satisfies StoredBlob);
  });
  versions.put(version);

  // Thin out, then drop contents no remaining version refers to.
  const all = (await result(versions.getAll(rangeFor(game, slot)))) as SaveVersion[];
  const keep = versionsToKeep(all, now);
  const needed = new Set<string>();
  for (const item of all) {
    if (keep.has(item.id)) {
      for (const file of item.files) needed.add(file.hash);
    } else {
      versions.delete([game, slot, item.id]);
    }
  }
  for (const hash of stored) {
    if (!needed.has(hash)) blobs.delete([game, slot, hash]);
  }
  await finished;
  return true;
}

/** Slots a batch of changes writes a new SAVE.DAT into. */
export function slotsSavedBy(changes: OverlayChanges): number[] {
  const slots = new Set<number>();
  for (const put of changes.puts) {
    if (isSaveData(put.key)) slots.add(slotOf(put.key)!);
  }
  return [...slots];
}

function historyFailed(err: unknown): void {
  // A version that could not be kept is a pity; a save that is lost because
  // of it would be a disaster. Report and carry on.
  console.error('[history] could not keep the previous version of a save', err);
}

/**
 * Commits a batch of changes the game made. When the batch saves over a slot,
 * the slot's previous contents are kept as a version first.
 */
export async function commitWithHistory(game: GameId, changes: OverlayChanges): Promise<void> {
  const now = Date.now();
  for (const slot of slotsSavedBy(changes)) {
    await keepVersion(game, slot, 'save', now).catch(historyFailed);
  }
  await commitOverlay(game, changes);
}

/**
 * Replaces everything in a slot with the given files, keeping the previous
 * contents as a version.
 */
export async function replaceSlot(
  game: GameId,
  slot: number,
  puts: OverlayChanges['puts'],
  cause: VersionCause,
): Promise<void> {
  await keepVersion(game, slot, cause, Date.now()).catch(historyFailed);
  await replaceOverlay(game, slotPrefix(slot), puts);
}

/**
 * Replaces one file of a slot (the save editor's SAVE.DAT), keeping what the
 * slot held before as a version. Unlike a save the game made, this one must
 * not go without its version: it fails when none could be kept.
 */
export async function replaceInSlot(
  game: GameId,
  slot: number,
  put: OverlayChanges['puts'][number] | OverlayChanges['puts'],
  cause: VersionCause,
): Promise<void> {
  if (!(await keepVersion(game, slot, cause, Date.now()))) throw new Error('the save as it was could not be kept as an earlier version');
  await commitOverlay(game, { puts: Array.isArray(put) ? put : [put], deletes: [] });
}

// ---------------------------------------------------------------------
// Erasing a slot, and putting it back
// ---------------------------------------------------------------------

/** For this long what an erased slot held can still be put back. */
export const ERASED_KEPT_MS = 7 * 24 * 60 * 60_000;

/**
 * Erases a slot. What it held is kept as a version and its earlier versions
 * stay where they are, so that the slot can be put back (see listErased).
 * False when nothing could be kept: the slot held no readable save, or the
 * history would not take it.
 */
export async function eraseSlot(game: GameId, slot: number): Promise<boolean> {
  const kept = await keepVersion(game, slot, 'erase', Date.now()).catch((err: unknown) => {
    historyFailed(err);
    return false;
  });
  await clearOverlay(game, slotPrefix(slot));
  return kept;
}

/** A slot that was erased and can still be put back. */
export interface ErasedSlot {
  slot: number;
  /** What it held when it was erased: restoreVersion puts this back. */
  version: SaveVersion;
  /** How many earlier versions of the slot come back with it. */
  earlier: number;
}

/**
 * The slots of a game that hold nothing now and have a history: erased ones.
 * Those erased longer ago than a week are forgotten here, for good.
 */
export async function listErased(game: GameId, now = Date.now()): Promise<ErasedSlot[]> {
  const db = await openDb();
  const all = (await result(db.transaction(VERSIONS).objectStore(VERSIONS).getAll(rangeFor(game)))) as SaveVersion[];
  if (!all.length) return [];
  const holding = new Set((await listOverlayKeys(game, SAVE_PREFIX)).filter(isSaveData).map((key) => slotOf(key)));
  const bySlot = new Map<number, SaveVersion[]>();
  for (const version of all) {
    if (holding.has(version.slot)) continue;
    const versions = bySlot.get(version.slot);
    if (versions) versions.push(version);
    else bySlot.set(version.slot, [version]);
  }

  const erased: ErasedSlot[] = [];
  for (const [slot, versions] of bySlot) {
    const last = versions.reduce((a, b) => (b.replacedAt > a.replacedAt ? b : a));
    if (now - last.replacedAt > ERASED_KEPT_MS) {
      await deleteVersions(game, slot).catch(historyFailed);
      continue;
    }
    erased.push({ slot, version: last, earlier: versions.length - 1 });
  }
  return erased.sort((a, b) => a.slot - b.slot);
}

// ---------------------------------------------------------------------
// Looking at versions and going back to one
// ---------------------------------------------------------------------

/** Earlier versions of a slot, newest first. */
export async function listVersions(game: GameId, slot: number): Promise<SaveVersion[]> {
  const db = await openDb();
  const all = (await result(db.transaction(VERSIONS).objectStore(VERSIONS).getAll(rangeFor(game, slot)))) as SaveVersion[];
  return all.sort((a, b) => b.id - a.id);
}

/** How many earlier versions each slot of a game has. */
export async function countVersions(game: GameId): Promise<Map<number, number>> {
  const db = await openDb();
  const keys = await result(db.transaction(VERSIONS).objectStore(VERSIONS).getAllKeys(rangeFor(game)));
  const counts = new Map<number, number>();
  for (const key of keys) {
    const slot = (key as [GameId, number, number])[1];
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  return counts;
}

async function versionFiles(version: SaveVersion, only?: (file: VersionFile) => boolean): Promise<OverlayChanges['puts']> {
  const db = await openDb();
  const blobs = db.transaction(BLOBS).objectStore(BLOBS);
  const wanted = version.files.filter((file) => !only || only(file));
  const stored = await Promise.all(
    wanted.map((file) => result(blobs.get([version.game, version.slot, file.hash]) as IDBRequest<StoredBlob | undefined>)),
  );
  return wanted.map((file, index) => {
    const blob = stored[index];
    if (!blob) throw new Error(`a file of this version is missing from browser storage (${file.path})`);
    return { key: file.key, path: file.path, mtime: file.mtime, data: blob.data };
  });
}

/** The SAVE.DAT of a version, for its picture and character summary. */
export async function readVersionSave(version: SaveVersion): Promise<Uint8Array | null> {
  const [main] = await versionFiles(version, (file) => isSaveData(file.key));
  return main?.data ?? null;
}

/**
 * Puts a version back into its slot. What the slot held until now becomes a
 * version in turn, so going back can itself be undone.
 */
export async function restoreVersion(game: GameId, slot: number, id: number): Promise<void> {
  const version = (await listVersions(game, slot)).find((item) => item.id === id);
  if (!version) throw new Error('that version is no longer in browser storage');
  // Read everything before touching the slot: an incomplete version must not
  // cost the player the save they have.
  const puts = await versionFiles(version);
  await replaceSlot(game, slot, puts, 'restore');
  // It is the slot's content again, no longer history.
  await deleteVersions(game, slot, id).catch(historyFailed);
}

/** Forgets one version, or the whole history of a slot or a game. */
export async function deleteVersions(game: GameId, slot?: number, id?: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([VERSIONS, BLOBS], 'readwrite', { durability: 'strict' });
  const finished = done(tx);
  const versions = tx.objectStore(VERSIONS);
  const blobs = tx.objectStore(BLOBS);
  if (slot === undefined || id === undefined) {
    versions.delete(rangeFor(game, slot));
    blobs.delete(rangeFor(game, slot));
  } else {
    versions.delete([game, slot, id]);
    const rest = (await result(versions.getAll(rangeFor(game, slot)))) as SaveVersion[];
    const needed = new Set(rest.flatMap((item) => item.files.map((file) => file.hash)));
    for (const key of await result(blobs.getAllKeys(rangeFor(game, slot)))) {
      if (!needed.has((key as [GameId, number, string])[2])) blobs.delete(key);
    }
  }
  await finished;
}
