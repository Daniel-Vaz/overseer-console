/**
 * A game's files for the tests, as the save editor reads them (see
 * src/lib/gamedata.ts): from folders and archives on disk, or from files made
 * up for a test, without the browser's storage.
 */
import { existsSync, openAsBlob } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { indexDat, readDatEntry, type DatArchive, type DatEntry } from '../src/lib/dat';
import type { GameData } from '../src/lib/gamedata';
import { GAMES, type GameId } from '../src/lib/games';

const key = (path: string) => path.replace(/\\/g, '/').toLowerCase();

async function walk(folder: string, root = folder, into = new Map<string, string>()): Promise<Map<string, string>> {
  if (!existsSync(folder)) return into;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await walk(path, root, into);
    else into.set(key(relative(root, path)), path);
  }
  return into;
}

/** One place files are looked up in: a folder of loose files, or an archive. */
export type Layer = { folder: string } | { archive: string };

/**
 * Game data out of folders and archives on disk, looked up in the order
 * given (the engine's: highest first). Plain files come from `root`.
 */
export async function layeredGameData(game: GameId, root: string, layers: Layer[]): Promise<GameData> {
  const format = GAMES[game].datFormat;
  const opened: ({ files: Map<string, string> } | { archive: DatArchive; index: Map<string, DatEntry> })[] = [];
  for (const layer of layers) {
    if ('folder' in layer) {
      opened.push({ files: await walk(layer.folder) });
    } else if (existsSync(layer.archive)) {
      const archive = (await openAsBlob(layer.archive)) as unknown as DatArchive;
      opened.push({ archive, index: await indexDat(archive, format) });
    }
  }
  const plain = await walk(root);
  return {
    game,
    key: root,
    async read(path) {
      for (const layer of opened) {
        if ('files' in layer) {
          const file = layer.files.get(key(path));
          if (file) return new Uint8Array(await readFile(file));
        } else {
          const entry = layer.index.get(key(path));
          if (entry) return readDatEntry(layer.archive, format, entry);
        }
      }
      return null;
    },
    async plain(path) {
      const file = plain.get(key(path));
      return file ? new Uint8Array(await readFile(file)) : null;
    },
  };
}

/** Game data out of an installed game's folder: its data folder, then its archives in the order given (highest first). */
export async function folderGameData(game: GameId, folder: string, archives: string[]): Promise<GameData> {
  const files = await walk(folder);
  const dataName = (await readdir(folder)).find((name) => name.toLowerCase() === 'data') ?? 'data';
  const dataFolder = join(folder, dataName);
  const archive = (name: string): Layer => ({ archive: files.get(key(name)) ?? join(folder, name) });
  return layeredGameData(game, folder, [{ folder: dataFolder }, ...archives.map(archive)]);
}

/** Game data made up for a test: files by their path inside the data folder, and plain files beside it. */
export function madeUpGameData(game: GameId, data: Record<string, Uint8Array>, plain: Record<string, Uint8Array> = {}): GameData {
  const files = new Map(Object.entries(data).map(([path, bytes]) => [key(path), bytes]));
  const beside = new Map(Object.entries(plain).map(([path, bytes]) => [key(path), bytes]));
  return {
    game,
    key: 'made-up',
    read: async (path) => files.get(key(path)) ?? null,
    plain: async (path) => beside.get(key(path)) ?? null,
  };
}
