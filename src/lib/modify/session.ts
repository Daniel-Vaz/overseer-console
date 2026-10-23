/**
 * Everything the save editor works with for one save: the game's rules,
 * items, pictures and world, read out of the player's own copy of it, and the
 * save as it is in its slot, with the party that travels in it.
 */
import { openGameData, type GameData } from '../gamedata';
import { gameDef, type GameId } from '../games';
import { parseSaveHeader, slotPrefix } from '../savefile';
import { replaceInSlot } from '../storage/history';
import { listOverlay } from '../storage/overlay';
import { readCatalog, type Catalog } from './catalog';
import { PartyError, readParty, type CompanionMap } from './party';
import { Pictures } from './pictures';
import { readSave, type Original } from './record';
import { readRules, type Rules } from './rules';
import { SaveMapError } from './savemap';
import { readWorld, type World } from './world';

export interface EditorSession {
  game: GameId;
  slot: number;
  rules: Rules;
  catalog: Catalog;
  pictures: Pictures;
  world: World;
  original: Original;
  /** The path the slot's SAVE.DAT is stored under, as the game spelled it. */
  path: string;
  savedAt: number;
  /** The game's files, for what is read again when writing (the party's map). */
  data: GameData;
  /** Why the party cannot be changed, where it cannot; null where it can, or where no one travels with the player. */
  partyProblem: string | null;
}

/** Why a save cannot be changed, in words for the player. */
export class SessionError extends Error {}

interface Library {
  key: string;
  rules: Promise<Rules>;
  catalog: Promise<Catalog>;
  world: Promise<World>;
  pictures: Pictures;
}

const libraries = new Map<GameId, Library>();

/** What is read once per installed game, and kept while it stays installed. */
function library(data: GameData): Library {
  const known = libraries.get(data.game);
  if (known?.key === data.key) return known;
  const fresh: Library = { key: data.key, rules: readRules(data), catalog: readCatalog(data), world: readWorld(data), pictures: new Pictures(data) };
  fresh.rules.catch(() => libraries.delete(data.game));
  fresh.catalog.catch(() => libraries.delete(data.game));
  fresh.world.catch(() => libraries.delete(data.game));
  libraries.set(data.game, fresh);
  return fresh;
}

/** Opens a save for changing. Throws SessionError, saying why, when it cannot be. */
export async function openSession(game: GameId, slot: number): Promise<EditorSession> {
  const def = gameDef(game);
  const data = await openGameData(game);
  if (!data) {
    throw new SessionError(
      def.mod
        ? `${def.title} and ${gameDef(def.mod.base).title} must both be loaded: the editor reads the game's own items, pictures and rules.`
        : 'Load the holodisk first: the editor reads the game\'s own items, pictures and rules from it.',
    );
  }
  const { rules, catalog, world, pictures } = library(data);
  const [loadedRules, loadedCatalog, loadedWorld] = await Promise.all([rules, catalog, world]);
  if (!loadedCatalog.items.size || !loadedRules.perks.some((perk) => perk.name)) {
    throw new SessionError("The game's item list and character rules were not found in its data.");
  }

  const prefix = slotPrefix(slot);
  const entries = await listOverlay(game, prefix);
  const main = entries.find((entry) => entry.key === `${prefix}save.dat` && !entry.deleted && entry.data);
  if (!main?.data) throw new SessionError('This slot holds no save to change.');
  const kindOf = (pid: number) => loadedCatalog.items.get(pid)?.kind;
  let original: Original;
  try {
    original = readSave(main.data, def.engine.id, kindOf);
  } catch (err) {
    if (err instanceof SaveMapError) throw new SessionError(`This save cannot be changed safely: ${err.message}.`);
    throw err;
  }

  // The party, from the map the player was on.
  let party: CompanionMap | null = null;
  let partyProblem: string | null = null;
  const rest = original.map.rest;
  if (!rest) {
    partyProblem = 'the end of this save does not read as the editor knows it';
  } else if (rest.party.members.length) {
    const files = entries.filter((entry) => !entry.deleted && entry.data).map((entry) => ({ key: entry.key, path: entry.path, data: entry.data! }));
    try {
      party = await readParty(data, loadedCatalog, files, prefix, parseSaveHeader(main.data)?.map ?? '', rest.party.members);
    } catch (err) {
      if (!(err instanceof PartyError)) throw err;
      partyProblem = err.message;
    }
  }
  if (party) original = readSave(main.data, def.engine.id, kindOf, party);

  return {
    game,
    slot,
    rules: loadedRules,
    catalog: loadedCatalog,
    pictures,
    world: loadedWorld,
    original,
    path: main.path,
    savedAt: main.mtime,
    data,
    partyProblem,
  };
}

/**
 * Stores a changed SAVE.DAT in its slot, and the party's map when that
 * changed too. What the slot held is kept as an earlier version first.
 */
export async function storeSession(session: EditorSession, save: Uint8Array, partyMap: Uint8Array | null = null): Promise<number> {
  const mtime = Date.now();
  const puts = [{ key: `${slotPrefix(session.slot)}save.dat`, path: session.path, mtime, data: save }];
  const party = session.original.party;
  if (partyMap && party) puts.push({ key: party.key, path: party.path, mtime, data: partyMap });
  await replaceInSlot(session.game, session.slot, puts, 'edit', session.savedAt);
  return mtime;
}
