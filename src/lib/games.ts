/** The games this console can run. */

export type GameId = 'fo1' | 'fo2';

export type DatFormat = 'dat1' | 'dat2';

export interface GameDef {
  id: GameId;
  /** The game's commercial name. Used descriptively only. */
  title: string;
  year: number;
  /** How the console's fiction refers to it. */
  label: string;
  /** One line shown under the title. */
  blurb: string;
  engine: {
    name: string;
    project: string;
    /** Global function the engine script defines. */
    factory: string;
  };
  datFormat: DatFormat;
  /** Lower-cased paths that must be present for the game to start. */
  requiredFiles: string[];
  configFile: string;
  /** Where the music lives in a stock install, most likely first. */
  musicDirs: string[];
  /** Folder name of a stock Steam install, for the import instructions. */
  steamFolder: string;
  stores: { name: string; url: string }[];
}

export const GAMES: Record<GameId, GameDef> = {
  fo1: {
    id: 'fo1',
    title: 'Fallout',
    year: 1997,
    label: 'SIMULATION 01',
    blurb: 'Vault 13. The water chip has failed.',
    engine: {
      name: 'Fallout Community Edition',
      project: 'https://github.com/alexbatalov/fallout1-ce',
      factory: 'falloutce',
    },
    datFormat: 'dat1',
    requiredFiles: ['master.dat', 'critter.dat'],
    configFile: 'fallout.cfg',
    musicDirs: ['data/sound/music', 'sound/music'],
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
    blurb: 'Arroyo. The village is dying.',
    engine: {
      name: 'Fallout 2 Community Edition',
      project: 'https://github.com/fallout2-ce/fallout2-ce',
      factory: 'fallout2ce',
    },
    datFormat: 'dat2',
    requiredFiles: ['master.dat', 'critter.dat', 'patch000.dat'],
    configFile: 'fallout2.cfg',
    musicDirs: ['sound/music', 'data/sound/music'],
    steamFolder: 'Fallout 2',
    stores: [
      { name: 'GOG', url: 'https://www.gog.com/game/fallout_2' },
      { name: 'Steam', url: 'https://store.steampowered.com/app/38410' },
      { name: 'Epic Games', url: 'https://store.epicgames.com/p/fallout-2' },
    ],
  },
};

export const GAME_IDS: readonly GameId[] = ['fo1', 'fo2'];

export function isGameId(value: unknown): value is GameId {
  return value === 'fo1' || value === 'fo2';
}

export function gameForDatFormat(format: DatFormat): GameId {
  return format === 'dat1' ? 'fo1' : 'fo2';
}
