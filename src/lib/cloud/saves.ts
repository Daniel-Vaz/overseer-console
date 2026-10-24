/**
 * Saved games in the player's cloud.
 *
 * Each slot is one zip, <saves folder>/<game>/SLOTnn.zip, the same archive
 * the console exports: it can be unpacked into a desktop install as it is.
 * One file per slot means a save arrives whole or not at all.
 *
 * Nothing moves by itself. The player uploads and fetches; either way a save
 * only ever replaces an older one, and what it replaces in this browser goes
 * into the slot's history.
 */
import { gameDef, type GameId } from '../games';
import { briefSaves, packSlot, readSaveArchive } from '../saves';
import { activeCloud, requireCloud } from './clouds';
import { CloudError } from './errors';
import type { Cloud, CloudFile, SyncedSave } from './provider';

/** A save zip larger than this is not a save. */
const MAX_SAVE_BYTES = 256 << 20;

export interface CloudSave {
  slot: number;
  /** The zip, by an address that survives renaming. */
  file: string;
  rev: string;
  /** When the save was written, as its uploader said (Dropbox keeps whole seconds). */
  savedAt: number;
  bytes: number;
}

export interface LocalSave {
  slot: number;
  savedAt: number;
}

/**
 * How a slot here stands against the same slot in the cloud. "Newer" is the
 * side that changed since the two last matched; when that is unknown or both
 * did, the one saved later.
 */
export type Standing = 'same' | 'newer-here' | 'newer-there' | 'only-here' | 'only-there';

export interface SlotStanding {
  slot: number;
  standing: Standing;
  here?: LocalSave;
  there?: CloudSave;
}

/** The folder a game's saves are kept in. */
export function cloudSavesFolder(game: GameId, cloud: Cloud = requireCloud()): string {
  // Dropbox will not have some characters in a name, and a mod's may hold any.
  const name = gameDef(game).title.replace(/[\\/:*?"<>|]/g, '-').trim() || game;
  return `${cloud.folders().savesFolder}/${name}`;
}

function zipName(slot: number): string {
  return `SLOT${String(slot).padStart(2, '0')}.zip`;
}

/** The saves the cloud holds for a game. None when the folder is not there yet. */
export async function listCloudSaves(game: GameId, cloud: Cloud = requireCloud()): Promise<CloudSave[]> {
  let files: CloudFile[];
  try {
    files = await cloud.listFiles(cloudSavesFolder(game, cloud));
  } catch (err) {
    if (err instanceof CloudError && err.notFound) return [];
    throw err;
  }
  const saves: CloudSave[] = [];
  for (const file of files) {
    const match = /^slot(\d{1,3})\.zip$/i.exec(file.name);
    const slot = match ? Number(match[1]) : 0;
    if (slot < 1) continue;
    saves.push({ slot, file: file.id, rev: file.rev, savedAt: file.modified, bytes: file.size });
  }
  return saves.sort((a, b) => a.slot - b.slot);
}

function seconds(timestamp: number): number {
  return Math.floor(timestamp / 1000);
}

/** Works out, slot by slot, which side holds the save to keep. */
export function compareSaves(here: LocalSave[], there: CloudSave[], synced: Record<string, SyncedSave>): SlotStanding[] {
  const local = new Map(here.map((save) => [save.slot, save]));
  const cloud = new Map(there.map((save) => [save.slot, save]));
  const standings: SlotStanding[] = [];
  for (const slot of [...new Set([...local.keys(), ...cloud.keys()])].sort((a, b) => a - b)) {
    const mine = local.get(slot);
    const theirs = cloud.get(slot);
    let standing: Standing;
    if (!mine || !theirs) {
      standing = mine ? 'only-here' : 'only-there';
    } else {
      // Against the state both sides last shared, clocks do not matter.
      const last = synced[slot];
      const unchangedHere = last?.savedAt === mine.savedAt;
      const unchangedThere = last?.rev === theirs.rev;
      if (unchangedHere && unchangedThere) standing = 'same';
      else if (unchangedHere) standing = 'newer-there';
      else if (unchangedThere) standing = 'newer-here';
      else if (seconds(mine.savedAt) === seconds(theirs.savedAt)) standing = 'same';
      else standing = mine.savedAt > theirs.savedAt ? 'newer-here' : 'newer-there';
    }
    standings.push({ slot, standing, here: mine, there: theirs });
  }
  return standings;
}

/** Looks at this browser and at the cloud, and compares. */
export async function surveySaves(game: GameId, cloud: Cloud = requireCloud()): Promise<SlotStanding[]> {
  const [here, there] = await Promise.all([briefSaves(game), listCloudSaves(game, cloud)]);
  return compareSaves(here, there, cloud.loadSynced(game));
}

/** Whether a slot was ever uploaded from, or fetched into, this browser. */
export function isSynced(game: GameId, slot: number, cloud: Cloud | null = activeCloud()): boolean {
  return cloud !== null && cloud.loadSynced(game)[slot] !== undefined;
}

/**
 * Uploads a slot. The cloud refuses (a CloudError with `conflict`) when the
 * zip there is no longer the one that was compared against.
 */
export async function sendSave(game: GameId, { slot, there }: SlotStanding, cloud: Cloud = requireCloud()): Promise<void> {
  const packed = await packSlot(game, slot);
  if (!packed) throw new Error(`SLOT${String(slot).padStart(2, '0')} holds no readable save.`);
  const stored = await cloud.upload(`${cloudSavesFolder(game, cloud)}/${zipName(slot)}`, packed.data, {
    replaces: there?.rev ?? null,
    modified: packed.savedAt,
  });
  cloud.storeSynced(game, slot, { rev: stored.rev, savedAt: packed.savedAt });
}

/**
 * Fetches a slot and puts it in place. What the slot held goes into its
 * history. The zip is checked before anything here is touched.
 */
export async function fetchSave(game: GameId, { slot, there }: SlotStanding, cloud: Cloud = requireCloud()): Promise<void> {
  if (!there) return;
  const name = zipName(slot);
  if (there.bytes > MAX_SAVE_BYTES) throw new Error(`${name} in ${cloud.name} is far too large to be a saved game.`);
  const data = await cloud.download(there.file);
  let archive;
  try {
    archive = await readSaveArchive(game, new Blob([data]), { only: slot, keepTimes: true, writtenAt: there.savedAt, cause: cloud.cause, quick: true });
  } catch (err) {
    throw new Error(`${name} in ${cloud.name} could not be used. ${err instanceof Error ? err.message : String(err)}`);
  }
  await archive.commit();
  const fetched = (await briefSaves(game)).find((save) => save.slot === slot);
  if (fetched) cloud.storeSynced(game, slot, { rev: there.rev, savedAt: fetched.savedAt });
}

/**
 * After a slot was erased here: erases its zip in the cloud as well, provided
 * that is still the save this browser last synced. A save another device put
 * there since is left alone.
 */
export async function eraseCloudSave(game: GameId, slot: number, cloud: Cloud = requireCloud()): Promise<'erased' | 'kept'> {
  const last = cloud.loadSynced(game)[slot];
  cloud.storeSynced(game, slot, null);
  if (!last) return 'kept';
  try {
    await cloud.remove(`${cloudSavesFolder(game, cloud)}/${zipName(slot)}`, last.rev);
    return 'erased';
  } catch (err) {
    if (err instanceof CloudError && err.notFound) return 'erased';
    // Any other refusal of this request: the zip there is not the one we knew.
    if (err instanceof CloudError && err.status === 409) return 'kept';
    throw err;
  }
}
