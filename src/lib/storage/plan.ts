/** What an import is given, and what it works out before anything is copied. */
import type { DatArchive } from '../dat';
import type { DatFormat, GameId } from '../games';
import type { SourceBlob } from './opfs';

export interface SourceFile {
  /** Path as the browser (or the player's Dropbox, or a zip archive) reported it, forward slashes. */
  path: string;
  file: SourceBlob;
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
  /** Other games the selection holds, besides the one planned here. */
  also: GameId[];
}

/** What planning may ask of the games already in this browser. */
export interface ImportContext {
  /** The MASTER.DAT of an installed game, or null when the game is not installed. */
  archiveOf?(game: GameId): Promise<DatArchive | null>;
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
 * State of whatever game was last played in an install; the engine rebuilds
 * it and stale copies only cause trouble.
 */
export function isLeftoverState(key: string): boolean {
  return /^data\/maps\/[^/]+\.sav$/.test(key) || key.startsWith('data/proto/');
}
