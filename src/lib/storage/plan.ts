/** What an import is given, and what it works out before anything is copied. */
import type { DatArchive } from '../dat';
import type { BaseGameId, DatFormat, GameId } from '../games';
import type { AddonInstall, ModInstall } from './manifest';
import type { Install, SourceBlob } from './opfs';

export interface SourceFile {
  /** Path as the browser (or the player's cloud, or a zip archive) reported it, forward slashes. */
  path: string;
  file: SourceBlob;
  /** The name of the zip it came out of, if it came out of one. */
  zip?: string;
}

export class ImportError extends Error {
  override name = 'ImportError';
}

export interface ImportPlan {
  game: GameId;
  datFormat: DatFormat;
  /** Folder (inside the selection) the game was found in. */
  root: string;
  /** What is copied into storage, by the path the engine will find it under. */
  entries: SourceFile[];
  dirs: string[];
  totalBytes: number;
  /** How many files of the selection, and of other games, the entries are made of. Saved games are not counted. */
  sourceFiles: number;
  skipped: number;
  /** Saved games found in the install. */
  saves: SourceFile[];
  installConfig?: string;
  language?: string;
  hasMusic: boolean;
  warnings: string[];
  /** Things worth saying about what was put together, that are not warnings. */
  notes: string[];
  /** Other games the selection holds, besides the one planned here: the two by their ids, mods as 'mod'. */
  also: (GameId | 'mod')[];
  /** For a mod: what it is, and how it meets the game it is played on. */
  mod?: ModInstall;
  /** For an add-on: what it is. `game` is then its id, on the add-ons' shelf. */
  addon?: AddonInstall;
}

/** What planning may ask of the games already in this browser. */
export interface ImportContext {
  /** The MASTER.DAT of an installed game, or null when the game is not installed. */
  archiveOf?(game: GameId): Promise<DatArchive | null>;
  /** The installed copy of a game, or null. A mod is compared with the game it is played on. */
  installOf?(game: GameId): Promise<Install | null>;
  /** The files come from the player's cloud: each byte read is a download. */
  remote?: boolean;
  /** Says what planning is busy with, when that takes a while. */
  status?(text: string): void;
}

const JUNK = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

/** Files that operating systems leave lying around in folders. */
export function isJunk(name: string): boolean {
  return JUNK.has(name);
}

export function isSave(key: string): boolean {
  return /^data\/savegame\/slot\d+\//.test(key);
}

/**
 * State of whatever game was last played in an install: the maps, and in
 * Fallout 2 the item and critter protos, which its engine writes there and
 * wipes at each new game. Stale copies only cause trouble. Fallout's engine
 * leaves protos alone: there they are data, as a mod's lists are in both.
 */
export function isLeftoverState(key: string, game: BaseGameId): boolean {
  return /^data\/maps\/[^/]+\.sav$/.test(key) || (game === 'fo2' && /^data\/proto\/(critters|items)\/[^/]+\.pro$/.test(key));
}
