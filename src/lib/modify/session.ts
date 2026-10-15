/**
 * Everything the save editor works with for one save: the game's rules,
 * items and pictures, read out of the player's own copy of it, and the save
 * as it is in its slot.
 */
import { openGameData, type GameData } from '../gamedata';
import { GAMES, type GameId } from '../games';
import { slotPrefix } from '../savefile';
import { replaceInSlot } from '../storage/history';
import { listOverlay } from '../storage/overlay';
import { readCatalog, type Catalog } from './catalog';
import { Pictures } from './pictures';
import { readSave, type Original } from './record';
import { readRules, type Rules } from './rules';
import { SaveMapError } from './savemap';

export interface EditorSession {
  game: GameId;
  slot: number;
  rules: Rules;
  catalog: Catalog;
  pictures: Pictures;
  original: Original;
  /** The path the slot's SAVE.DAT is stored under, as the game spelled it. */
  path: string;
  savedAt: number;
}

/** Why a save cannot be changed, in words for the player. */
export class SessionError extends Error {}

interface Library {
  key: string;
  rules: Promise<Rules>;
  catalog: Promise<Catalog>;
  pictures: Pictures;
}

const libraries = new Map<GameId, Library>();

/** What is read once per installed game, and kept while it stays installed. */
function library(data: GameData): Library {
  const known = libraries.get(data.game);
  if (known?.key === data.key) return known;
  const fresh: Library = { key: data.key, rules: readRules(data), catalog: readCatalog(data), pictures: new Pictures(data) };
  fresh.rules.catch(() => libraries.delete(data.game));
  fresh.catalog.catch(() => libraries.delete(data.game));
  libraries.set(data.game, fresh);
  return fresh;
}

/** Opens a save for changing. Throws SessionError, saying why, when it cannot be. */
export async function openSession(game: GameId, slot: number): Promise<EditorSession> {
  const def = GAMES[game];
  const data = await openGameData(game);
  if (!data) {
    throw new SessionError(
      def.conversion
        ? `${def.title} and ${GAMES[def.conversion.base].title} must both be loaded: the editor reads the game's own items, pictures and rules.`
        : 'Load the holodisk first: the editor reads the game\'s own items, pictures and rules from it.',
    );
  }
  const { rules, catalog, pictures } = library(data);
  const [loadedRules, loadedCatalog] = await Promise.all([rules, catalog]);
  if (!loadedCatalog.items.size || !loadedRules.perks.some((perk) => perk.name)) {
    throw new SessionError("The game's item list and character rules were not found in its data.");
  }

  const entries = await listOverlay(game, slotPrefix(slot));
  const main = entries.find((entry) => entry.key === `${slotPrefix(slot)}save.dat` && !entry.deleted && entry.data);
  if (!main?.data) throw new SessionError('This slot holds no save to change.');
  try {
    const original = readSave(main.data, def.engine.id, (pid) => loadedCatalog.items.get(pid)?.kind);
    return { game, slot, rules: loadedRules, catalog: loadedCatalog, pictures, original, path: main.path, savedAt: main.mtime };
  } catch (err) {
    if (err instanceof SaveMapError) throw new SessionError(`This save cannot be changed safely: ${err.message}.`);
    throw err;
  }
}

/** Stores a changed SAVE.DAT in its slot. What the slot held is kept as an earlier version first. */
export async function storeSession(session: EditorSession, data: Uint8Array): Promise<number> {
  const mtime = Date.now();
  await replaceInSlot(session.game, session.slot, { key: `${slotPrefix(session.slot)}save.dat`, path: session.path, mtime, data }, 'edit');
  return mtime;
}
