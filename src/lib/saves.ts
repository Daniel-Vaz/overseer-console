/**
 * Saved games, as the console sees them: slots read out of the overlay.
 *
 * A slot is a folder (data/SAVEGAME/SLOTnn) holding SAVE.DAT plus one file per
 * visited map. What SAVE.DAT says is read by savefile.ts; earlier versions of
 * a slot are kept by storage/history.ts.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { GameId } from './games';
import { SAVE_PREFIX, isSaveData, parseSaveHeader, slotOf, slotPrefix } from './savefile';
import { countVersions, deleteVersions, replaceSlot } from './storage/history';
import { pathKey } from './storage/manifest';
import { clearOverlay, listOverlay, type OverlayChanges, type OverlayEntry } from './storage/overlay';

export { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, parseSaveHeader } from './savefile';

export interface SaveSlot {
  /** 1-based slot number. */
  slot: number;
  valid: boolean;
  character: string;
  description: string;
  /** In-game date. */
  gameDate: string;
  /** In-game time of day, "0824". */
  gameClock: string;
  /** Map file the save was made on, without extension. */
  map: string;
  /** When the save was written (real time), if known. */
  savedAt?: number;
  bytes: number;
  files: number;
  /** Earlier versions of this slot kept in the save history. */
  versions: number;
  /** 224x133 palette indices, when present. */
  thumbnail?: Uint8Array;
}

async function saveEntries(game: GameId, slot?: number): Promise<OverlayEntry[]> {
  const entries = await listOverlay(game, slot === undefined ? SAVE_PREFIX : slotPrefix(slot));
  return entries.filter((entry) => !entry.deleted && entry.data && slotOf(entry.key) !== null);
}

/** Every slot that holds something, in slot order. */
export async function listSaves(game: GameId): Promise<SaveSlot[]> {
  const bySlot = new Map<number, OverlayEntry[]>();
  const [entries, versions] = await Promise.all([saveEntries(game), countVersions(game).catch(() => new Map<number, number>())]);
  for (const entry of entries) {
    const slot = slotOf(entry.key)!;
    let list = bySlot.get(slot);
    if (!list) bySlot.set(slot, (list = []));
    list.push(entry);
  }

  const slots: SaveSlot[] = [];
  for (const [slot, entries] of bySlot) {
    const main = entries.find((entry) => isSaveData(entry.key));
    const header = main?.data ? parseSaveHeader(main.data) : null;
    slots.push({
      slot,
      valid: header !== null,
      character: header?.character ?? '',
      description: header?.description ?? '',
      gameDate: header?.gameDate ?? '',
      gameClock: header?.gameClock ?? '',
      map: header?.map ?? '',
      thumbnail: header?.thumbnail,
      savedAt: main?.mtime,
      bytes: entries.reduce((sum, entry) => sum + (entry.data?.length ?? 0), 0),
      files: entries.length,
      versions: versions.get(slot) ?? 0,
    });
  }
  return slots.sort((a, b) => a.slot - b.slot);
}

export async function countSaves(game: GameId): Promise<number> {
  const slots = new Set<number>();
  for (const entry of await saveEntries(game)) {
    if (isSaveData(entry.key)) slots.add(slotOf(entry.key)!);
  }
  return slots.size;
}

/** Erases a slot together with its earlier versions. */
export async function deleteSave(game: GameId, slot: number): Promise<void> {
  await clearOverlay(game, slotPrefix(slot));
  await deleteVersions(game, slot);
}

/**
 * Packs saves into a zip laid out like the game's own SAVEGAME folder, so the
 * archive can be unpacked straight into a desktop install (data/SAVEGAME).
 */
export async function exportSaves(game: GameId, slot?: number): Promise<Blob> {
  const files: Zippable = {};
  for (const entry of await saveEntries(game, slot)) {
    // "data/SAVEGAME/SLOT01/SAVE.DAT" -> "SAVEGAME/SLOT01/SAVE.DAT"
    const inside = entry.path.replace(/\\/g, '/').split('/').slice(1).join('/');
    files[inside] = [entry.data!, { mtime: entry.mtime }];
  }
  files['README.txt'] = strToU8(
    `Saved games exported from Overseer Console (${game === 'fo1' ? 'Fallout' : 'Fallout 2'}).\r\n` +
      'To use them in a desktop install, copy the SLOTnn folders into the game\'s data\\SAVEGAME folder.\r\n',
  );
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
}

export interface SaveImport {
  /** Slots found in the archive. */
  slots: number[];
  /** Those that would replace a slot that already exists. */
  conflicts: number[];
  commit(): Promise<void>;
}

/**
 * Reads a zip of saves. Accepts the console's own exports as well as a
 * zipped SAVEGAME folder or bare SLOTnn folders from a desktop install.
 */
export async function readSaveArchive(game: GameId, archive: Blob): Promise<SaveImport> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  } catch {
    throw new Error('That file is not a zip archive.');
  }

  const puts: OverlayChanges['puts'] = [];
  const slots = new Set<number>();
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith('/')) continue;
    const parts = name.replace(/\\/g, '/').split('/');
    const at = parts.findIndex((part) => /^slot\d+$/i.test(part));
    if (at < 0 || at === parts.length - 1) continue;
    const slot = Number(parts[at]!.slice(4));
    if (!Number.isInteger(slot) || slot < 1 || slot > 999) continue;
    const path = `data/SAVEGAME/SLOT${String(slot).padStart(2, '0')}/${parts.slice(at + 1).join('/')}`;
    puts.push({ key: pathKey(path), path, mtime: Date.now(), data });
    slots.add(slot);
  }
  if (!slots.size) throw new Error('No saved games in that archive (expected SLOT01, SLOT02... folders).');

  // A slot is only worth importing with its SAVE.DAT, and of the right game.
  for (const slot of slots) {
    const main = puts.find((put) => put.key === `${slotPrefix(slot)}save.dat`);
    if (!main || !parseSaveHeader(main.data)) {
      throw new Error(`SLOT${String(slot).padStart(2, '0')} in that archive has no readable SAVE.DAT.`);
    }
  }

  const existing = new Set((await listSaves(game)).map((save) => save.slot));
  const found = [...slots].sort((a, b) => a - b);
  return {
    slots: found,
    conflicts: found.filter((slot) => existing.has(slot)),
    async commit() {
      // What a slot held before goes into its history, not into the void.
      for (const slot of found) {
        const prefix = slotPrefix(slot);
        await replaceSlot(game, slot, puts.filter((put) => put.key.startsWith(prefix)), 'import');
      }
    },
  };
}
