/** The games this console can run. */

export type GameId = 'fo1' | 'fo2' | 'ettu';

/** The engines the console ships: one build per original game. */
export type EngineId = 'fo1' | 'fo2';

export type DatFormat = 'dat1' | 'dat2';

export interface GameDef {
  id: GameId;
  /** The game's commercial name. Used descriptively only. */
  title: string;
  year: number;
  /** How the console's fiction refers to it. */
  label: string;
  /** The letter of the holodisk deck it is loaded into. */
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
  /** The archive the names of perks, traits and skills are read from. */
  factsArchive: string;
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
  /**
   * Set for a conversion: a game that is not sold, and plays from the data
   * of the games that are.
   */
  conversion?: {
    /** The game whose engine and archives it runs on. Must be loaded to play. */
    base: GameId;
    /** The game whose own files it borrows when it is put together. */
    donor: GameId;
    project: string;
    /** Where its package is downloaded from. */
    download: string;
  };
}

export const GAMES: Record<GameId, GameDef> = {
  fo1: {
    id: 'fo1',
    title: 'Fallout',
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
    factsArchive: 'master.dat',
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
    factsArchive: 'master.dat',
    engineData: 'improved',
    steamFolder: 'Fallout 2',
    stores: [
      { name: 'GOG', url: 'https://www.gog.com/game/fallout_2' },
      { name: 'Steam', url: 'https://store.steampowered.com/app/38410' },
      { name: 'Epic Games', url: 'https://store.epicgames.com/p/fallout-2' },
    ],
  },
  ettu: {
    id: 'ettu',
    title: 'Fallout Et Tu',
    year: 2019,
    label: 'SIMULATION 03',
    deck: 'C',
    blurb: 'Vault 13 again, on the machinery of Fallout 2.',
    engine: {
      id: 'fo2',
      name: 'Fallout 2 Community Edition',
      project: 'https://github.com/fallout2-ce/fallout2-ce',
      factory: 'fallout2ce',
    },
    datFormat: 'dat2',
    world: 'fo1',
    requiredFiles: ['mods/mods_order.txt'],
    configFile: 'fallout2.cfg',
    musicDirs: ['data/sound/music'],
    factsArchive: 'mods/fo1_base',
    engineData: 'always',
    steamFolder: 'Fallout 2/Fallout1in2',
    stores: [],
    conversion: {
      base: 'fo2',
      donor: 'fo1',
      project: 'https://github.com/rotators/Fo1in2',
      download: 'https://github.com/rotators/Fo1in2/releases',
    },
  },
};

export const GAME_IDS: readonly GameId[] = ['fo1', 'fo2', 'ettu'];

export function isGameId(value: unknown): value is GameId {
  return value === 'fo1' || value === 'fo2' || value === 'ettu';
}

/** The stock game an archive of this format belongs to. */
export function gameForDatFormat(format: DatFormat): GameId {
  return format === 'dat1' ? 'fo1' : 'fo2';
}
