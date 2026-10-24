/**
 * What the console keeps beside a saved game, in a small file of its own in
 * the slot: the game or mod that made it, and the add-ons laid over that game
 * then. The engines never read it. It goes wherever the slot goes (exports,
 * the cloud, a slot's history), so a save says what it was made with when it
 * is loaded again: an add-on's scripts and items live on in the save, and a
 * game started without them can break on it.
 */
import { addonRecord, addonsOn, engineGame } from './addons';
import type { GameId } from './games';
import { slotPrefix } from './savefile';
import { readOverlay } from './storage/overlay';

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The file, beside SAVE.DAT. */
export const SAVE_META_NAME = 'OVERSEER.JSON';

export interface SaveAddon {
  id: string;
  title: string;
  version?: string;
}

export interface SaveMeta {
  /** The game or mod that made the save. */
  game: GameId;
  /** The add-ons laid over it, the one under the others first. */
  addons: SaveAddon[];
}

/** Where a slot keeps it, as the engines spell the folder, and its key. */
export function saveMetaPath(slot: number): { key: string; path: string } {
  const folder = `SLOT${String(slot).padStart(2, '0')}`;
  return { key: `${slotPrefix(slot)}${SAVE_META_NAME.toLowerCase()}`, path: `data/SAVEGAME/${folder}/${SAVE_META_NAME}` };
}

export function encodeSaveMeta(meta: SaveMeta): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(meta, null, 1)}\n`);
}

/** What a slot's file says, or null when it says nothing the console can use. */
export function parseSaveMeta(data: Uint8Array | undefined): SaveMeta | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as Partial<SaveMeta>;
    // A mod this browser no longer has is still the mod the save was made with.
    if (typeof parsed.game !== 'string' || !GAME_ID.test(parsed.game)) return null;
    const addons = (Array.isArray(parsed.addons) ? parsed.addons : []).filter(
      (addon): addon is SaveAddon => !!addon && typeof addon.id === 'string' && typeof addon.title === 'string',
    );
    return { game: parsed.game as GameId, addons: addons.map(({ id, title, version }) => ({ id, title, ...(typeof version === 'string' ? { version } : {}) })) };
  } catch {
    return null;
  }
}

/** What a stored slot's file says. */
export async function readSaveMeta(game: GameId, slot: number): Promise<SaveMeta | null> {
  const entry = await readOverlay(game, saveMetaPath(slot).key).catch(() => undefined);
  return entry && !entry.deleted ? parseSaveMeta(entry.data) : null;
}

/** The add-ons a save was made with that are not laid over the game now. */
export function addonsMissing(meta: SaveMeta | null, game: GameId): SaveAddon[] {
  if (!meta) return [];
  const on = new Set(addonsOn(game));
  return meta.addons.filter((addon) => !on.has(addon.id));
}

/** Of those, the ones still loaded in this browser for this game: they can be switched back on. */
export function addonsToSwitchOn(missing: readonly SaveAddon[], game: GameId): SaveAddon[] {
  return missing.filter((addon) => addonRecord(addon.id)?.base === engineGame(game));
}

/** The names of add-ons as a sentence says them: "A", "A and B", "A, B and C". */
export function addonList(addons: readonly SaveAddon[]): string {
  const names = addons.map((addon) => addon.title);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
