import type { DatFormat, GameId, ModRecord } from '../games';

/**
 * How an imported game is laid out in the origin private file system:
 *
 *   overseer-console/games/<game>/current.json      -> { install: "<id>" }
 *   overseer-console/games/<game>/<id>/manifest.json
 *   overseer-console/games/<game>/<id>/pack.bin      small files, back to back
 *   overseer-console/games/<game>/<id>/b0000.bin ... one per large file
 *
 * An import writes a new <id> directory and only then points current.json at
 * it, so an interrupted import never leaves a half-installed game behind.
 */

export const STORE_ROOT = 'overseer-console';
export const MANIFEST_VERSION = 1;

/** Files at least this large stay on disk and are read on demand. */
export const LAZY_THRESHOLD = 1 << 20;

export interface ManifestFile {
  /** Path relative to the game folder, as found in the user's install. */
  path: string;
  size: number;
  /** Name of the file in the install directory holding the contents... */
  blob?: string;
  /** ...or where they sit inside pack.bin. */
  pack?: [offset: number, length: number];
}

export interface Manifest {
  version: number;
  game: GameId;
  install: string;
  importedAt: number;
  totalBytes: number;
  datFormat: DatFormat;
  files: ManifestFile[];
  /** Every directory of the install, including empty ones. */
  dirs: string[];
  /** The install's own settings file, kept as a reference for first launch. */
  installConfig?: string;
  /** Set for a mod: what it is, and how its files meet those of the game it is played on. */
  mod?: ModInstall;
}

/** A file of the game underneath that a mod is started with, unchanged. */
export interface ReusedFile {
  /** Where the mod has it, and where it is put when the mod starts. */
  path: string;
  size: number;
  /** Where the game underneath has it, when that is somewhere else. */
  from?: string;
}

export interface ModInstall {
  record: ModRecord;
  /**
   * How its files meet those of the game it is played on, when it starts.
   * over: laid over that game's folder, as a mod installed into it is on a desktop.
   * nested: in a folder of its own, with that game's archives and music in
   *   a folder below it (Fallout Et Tu, Resurrection; see engine/config.ts).
   */
  layout: 'over' | 'nested';
  /**
   * over: what of the game underneath it is started with. Either all of it
   * but `hides` (lower-case paths, or folders ending in '/') save `keeps`, as
   * for files to unpack into a game folder; or, for a complete game folder,
   * nothing but `reuses`: the files its own copies were identical to.
   * nested: `reuses` as well, in its own folder, besides the game's archives
   * and music below it.
   */
  hides?: string[];
  keeps?: string[];
  reuses?: ReusedFile[];
  /** The archive standing in for the bulk of its data folder: the engine's second patch location. */
  patches?: string;
}

export interface CurrentPointer {
  install: string;
}

/** Lower-cases a relative path and normalises its separators. */
export function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
