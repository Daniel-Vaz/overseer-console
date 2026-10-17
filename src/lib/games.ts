/**
 * The games this console can run: the two that are sold, each in a deck of
 * its own, and the mods of them loaded in this browser.
 *
 * A mod is a game of its own as far as the console is concerned: its own
 * files, saves, picture and history, under its own id. It is played on the
 * engine of the game it was made for, from that game's deck, over that
 * game's files (see storage/mods.ts).
 */
import { KNOWN_MODS, isKnownMod, type KnownModId, type ModStatus } from './mods/catalog';

/** The games that are sold: one deck each. */
export type BaseGameId = 'fo1' | 'fo2';

/** A game the console starts: one of the two, or a mod of one of them by its id ('ettu', 'rpu', ...). */
export type GameId = string;

/** The engines the console ships: one build per original game. */
export type EngineId = 'fo1' | 'fo2';

export type DatFormat = 'dat1' | 'dat2';

export interface GameDef {
  id: GameId;
  /** The game's commercial name, or the mod's own. Used descriptively only. */
  title: string;
  /** What the console calls it where room is short. */
  short: string;
  year?: number;
  /** How the console's fiction refers to it: the simulation its deck runs. */
  label: string;
  /** The letter of the holodisk deck it is played from. */
  deck: string;
  /** One line shown under the title. */
  blurb: string;
  engine: {
    /** Which of the console's engine builds runs it. */
    id: EngineId;
    name: string;
    project: string;
    /** Global function the engine script defines. */
    factory: string;
  };
  datFormat: DatFormat;
  /**
   * Whose rules and words its saved games follow: how SAVE.DAT is laid out
   * comes with the engine, what a character sheet calls things with the game.
   */
  world: 'fo1' | 'fo2';
  /** Lower-cased paths that must be present for the game to start. */
  requiredFiles: string[];
  configFile: string;
  /** Where the music lives in a stock install, most likely first. */
  musicDirs: string[];
  /**
   * When the engine's own data file goes beside the game: the pictures and
   * words of what the engine adds to the originals. 'improved': while the
   * console's improvements are switched on, which are then this game's to
   * have. 'always': the game was made with them. 'never': its engine has none.
   */
  engineData: 'never' | 'improved' | 'always';
  /** Folder name of a stock Steam install, for the import instructions. */
  steamFolder: string;
  stores: { name: string; url: string }[];
  /** Set for a mod: the game it is played on, and what the console knows of it. */
  mod?: ModInfo;
}

export interface ModInfo {
  /** The game it is played on: its engine, its deck and its files. Must be loaded to play. */
  base: BaseGameId;
  /** The game whose own files it takes when it is put together (Et Tu: Fallout's speech and movies). */
  donor?: BaseGameId;
  /** The mod the console knows it to be, if it is one of those. */
  known?: KnownModId;
  version?: string;
  status: ModStatus;
  /** The fewest lines of picture it can be played at. */
  minHeight?: number;
}

const BASES: Record<BaseGameId, GameDef> = {
  fo1: {
    id: 'fo1',
    title: 'Fallout',
    short: 'FALLOUT',
    year: 1997,
    label: 'SIMULATION 01',
    deck: 'A',
    blurb: 'Vault 13. The water chip has failed.',
    engine: {
      id: 'fo1',
      name: 'Fallout Community Edition',
      project: 'https://github.com/alexbatalov/fallout1-ce',
      factory: 'falloutce',
    },
    datFormat: 'dat1',
    world: 'fo1',
    requiredFiles: ['master.dat', 'critter.dat'],
    configFile: 'fallout.cfg',
    musicDirs: ['data/sound/music', 'sound/music'],
    engineData: 'never',
    steamFolder: 'Fallout',
    stores: [
      { name: 'GOG', url: 'https://www.gog.com/game/fallout' },
      { name: 'Steam', url: 'https://store.steampowered.com/app/38400' },
      { name: 'Epic Games', url: 'https://store.epicgames.com/p/fallout' },
    ],
  },
  fo2: {
    id: 'fo2',
    title: 'Fallout 2',
    short: 'FALLOUT 2',
    year: 1998,
    label: 'SIMULATION 02',
    deck: 'B',
    blurb: 'Arroyo. The village is dying.',
    engine: {
      id: 'fo2',
      name: 'Fallout 2 Community Edition',
      project: 'https://github.com/fallout2-ce/fallout2-ce',
      factory: 'fallout2ce',
    },
    datFormat: 'dat2',
    world: 'fo2',
    requiredFiles: ['master.dat', 'critter.dat', 'patch000.dat'],
    configFile: 'fallout2.cfg',
    musicDirs: ['sound/music', 'data/sound/music'],
    engineData: 'improved',
    steamFolder: 'Fallout 2',
    stores: [
      { name: 'GOG', url: 'https://www.gog.com/game/fallout_2' },
      { name: 'Steam', url: 'https://store.steampowered.com/app/38410' },
      { name: 'Epic Games', url: 'https://store.epicgames.com/p/fallout-2' },
    ],
  },
};

export const BASE_GAMES: readonly BaseGameId[] = ['fo1', 'fo2'];

export function isBaseGame(value: unknown): value is BaseGameId {
  return value === 'fo1' || value === 'fo2';
}

/** The stock game an archive of this format belongs to. */
export function gameForDatFormat(format: DatFormat): BaseGameId {
  return format === 'dat1' ? 'fo1' : 'fo2';
}

// ---------------------------------------------------------------------
// Mods
// ---------------------------------------------------------------------

/**
 * What this browser remembers of a mod loaded in it: enough to name it and
 * its saves, also once its files are ejected. What the files themselves
 * are is in the manifest of its install (see storage/manifest.ts).
 */
export interface ModRecord {
  id: GameId;
  /** The mod the console knows it to be, if it is one of those. */
  known?: KnownModId;
  title: string;
  version?: string;
  base: BaseGameId;
  donor?: BaseGameId;
}

const REGISTER_KEY = 'overseer-console:mods';

/** A mod as the console runs it: the game it is played on, with what the mod brings of its own. */
function modDef(record: ModRecord): GameDef {
  const base = BASES[record.base];
  const known = record.known ? KNOWN_MODS[record.known] : undefined;
  return {
    ...base,
    id: record.id,
    title: record.title,
    short: known?.short ?? record.title.toUpperCase(),
    year: undefined,
    blurb: known?.blurb ?? `A mod of ${base.title}, loaded in this browser.`,
    world: known?.world ?? base.world,
    requiredFiles: [],
    // A mod may keep its music in either place, whichever its game does.
    musicDirs: ['data/sound/music', 'sound/music'],
    engineData: known?.engineData ?? base.engineData,
    stores: [],
    mod: {
      base: record.base,
      donor: record.donor ?? known?.donor,
      known: record.known,
      version: record.version,
      status: known?.status ?? 'unknown',
      minHeight: known?.minHeight,
    },
  };
}

function readRegister(): ModRecord[] {
  try {
    const stored = JSON.parse(localStorage.getItem(REGISTER_KEY) ?? '[]') as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (record): record is ModRecord =>
        !!record &&
        typeof record.id === 'string' &&
        /^[a-z0-9][a-z0-9-]{0,40}$/.test(record.id) &&
        !isBaseGame(record.id) &&
        typeof record.title === 'string' &&
        isBaseGame(record.base) &&
        (record.known === undefined || isKnownMod(record.known)),
    );
  } catch {
    return [];
  }
}

function writeRegister(records: ModRecord[]): void {
  try {
    localStorage.setItem(REGISTER_KEY, JSON.stringify(records));
  } catch {
    // A private window: the mods are remembered for this page only.
  }
}

let records: ModRecord[] = readRegister();

/**
 * Every game this console can run, by id: the two in their decks, and the
 * mods loaded in this browser. Mods come and go as they are loaded and
 * forgotten; ask `isGameId` before trusting an id from elsewhere.
 */
export const GAMES: Record<GameId, GameDef> = { ...BASES };
for (const record of records) GAMES[record.id] = modDef(record);

/** The two games, then the mods in the order they were first loaded. */
export function gameIds(): GameId[] {
  return [...BASE_GAMES, ...records.map((record) => record.id)];
}

/** The mods loaded in this browser, or remembered for their saves. */
export function modRecords(): readonly ModRecord[] {
  return records;
}

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && Object.hasOwn(GAMES, value);
}

/** The definition of a game known here. Ask `isGameId` first about an id from elsewhere. */
export function gameDef(id: GameId): GameDef {
  const def = GAMES[id];
  if (!def) throw new Error(`no game "${id}" is known here`);
  return def;
}

export function isModId(value: unknown): value is GameId {
  return isGameId(value) && !isBaseGame(value);
}

/** Remembers a mod, or what it now is when it was loaded again. */
export function registerMod(record: ModRecord): void {
  const index = records.findIndex((known) => known.id === record.id);
  records = index < 0 ? [...records, record] : records.map((known, at) => (at === index ? record : known));
  GAMES[record.id] = modDef(record);
  writeRegister(records);
}

/** Forgets a mod: it no longer has files or saves here. */
export function forgetMod(id: GameId): void {
  if (isBaseGame(id) || !records.some((record) => record.id === id)) return;
  records = records.filter((record) => record.id !== id);
  delete GAMES[id];
  writeRegister(records);
}

/** The id for a mod loaded anew: its own name where the console knows it, else one made from its title. */
export function newModId(title: string, known?: KnownModId): GameId {
  if (known) return known;
  const stem =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'mod';
  const taken = (id: string) => isBaseGame(id) || isKnownMod(id) || isGameId(id);
  let id = taken(stem) ? `${stem}-2` : stem;
  for (let n = 3; taken(id); n++) id = `${stem}-${n}`;
  return id;
}
