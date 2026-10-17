/**
 * Game files in the player's Dropbox.
 *
 * The player puts their game folder into the app folder with Dropbox's own
 * app or website, and their mods into a Mods folder inside it; the console
 * only ever reads them. To the importer a file there is like a file on disk,
 * except that reading it is a download.
 */
import { buffered } from '../blobs';
import { gameDef, type BaseGameId } from '../games';
import { ImportError, openArchives, type SourceFile } from '../storage/importer';
import type { SourceBlob } from '../storage/opfs';
import { looksLikeZip } from '../zip';
import { DropboxError, download, fromDropboxTime, listFiles, type DropboxFile } from './api';
import { loadConfig, showFolder } from './link';

class DropboxBlob implements SourceBlob {
  constructor(
    private readonly file: string,
    readonly size: number,
    readonly lastModified: number,
  ) {}

  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } {
    const from = Math.max(0, Math.min(start, this.size));
    const to = Math.max(from, Math.min(end, this.size));
    return {
      // Nothing is asked of Dropbox for an empty range: it would refuse one.
      arrayBuffer: () => (to > from ? download(this.file, { start: from, end: to }) : Promise.resolve(new ArrayBuffer(0))),
    };
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.slice(0, this.size).arrayBuffer();
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }
}

/** Where mods are kept, inside the games folder: each zip or folder in it is one mod. */
export const MODS_FOLDER = 'Mods';

/** The Mods folder, as a path below the app folder. */
export function modsFolder(): string {
  return `${loadConfig().gamesFolder}/${MODS_FOLDER}`;
}

function source(file: DropboxFile, folder: string): SourceFile {
  const blob = new DropboxBlob(file.id ?? file.path_lower, file.size, fromDropboxTime(file.client_modified));
  return {
    // Relative to the folder that was listed.
    path: file.path_display.slice(folder.length + 1),
    // A zip is walked through file by file: read ahead, or every one of them is a request.
    file: looksLikeZip(file.name) ? buffered(blob) : blob,
  };
}

/** Lists a folder of the app folder and everything below it; the error says where it was looked for. */
async function listed(folder: string, missing: string): Promise<SourceFile[]> {
  try {
    return (await listFiles(folder, true)).map((file) => source(file, folder));
  } catch (err) {
    if (err instanceof DropboxError && err.notFound) throw new ImportError(missing);
    throw err;
  }
}

/**
 * Everything below the games folder but the mods, for the importer to find
 * a game in. Throws an ImportError when there is plainly nothing to find.
 */
export async function dropboxGameFiles(game: BaseGameId): Promise<SourceFile[]> {
  const folder = loadConfig().gamesFolder;
  const where = folder ? `the folder ${showFolder(folder)} of the console's app folder` : "the console's app folder";
  const files = (
    await listed(
      folder,
      `There is no folder ${showFolder(folder)} in the console's app folder in your Dropbox. Create it, or change the games folder under Dropbox link in Terminal settings.`,
    )
  ).filter((file) => !file.path.toLowerCase().startsWith(`${MODS_FOLDER.toLowerCase()}/`));

  if (!files.some((file) => /(^|\/)master\.dat$/i.test(file.path))) {
    throw new ImportError(
      `No MASTER.DAT in ${where} in your Dropbox. Upload the folder ${gameDef(game).title} is installed in ` +
        '(the one that contains MASTER.DAT and CRITTER.DAT) there, wait until Dropbox has finished, then try again.',
    );
  }
  return files;
}

/** A mod in the Mods folder: a zip, or a folder. */
export interface CloudMod {
  /** Its name in the Mods folder. */
  name: string;
  zip: boolean;
  bytes: number;
  files: number;
}

/** What the Mods folder holds. None when there is no such folder yet. */
export async function listDropboxMods(): Promise<CloudMod[]> {
  const folder = modsFolder();
  let files: DropboxFile[];
  try {
    files = await listFiles(folder, true);
  } catch (err) {
    if (err instanceof DropboxError && err.notFound) return [];
    throw err;
  }
  const mods = new Map<string, CloudMod>();
  for (const file of files) {
    const rest = file.path_display.slice(folder.length + 1);
    const slash = rest.indexOf('/');
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const zip = slash < 0 && looksLikeZip(name);
    // A loose file among the mods is none of them.
    if (slash < 0 && !zip) continue;
    const mod = mods.get(name.toLowerCase()) ?? { name, zip, bytes: 0, files: 0 };
    mod.bytes += file.size;
    mod.files += 1;
    mods.set(name.toLowerCase(), mod);
  }
  return [...mods.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The files of one mod of the Mods folder (`name` as listDropboxMods gives it), for the importer. */
export async function dropboxModFiles(name: string): Promise<SourceFile[]> {
  const folder = modsFolder();
  const missing = `There is no ${name} in the Mods folder of your Dropbox (${showFolder(folder)} in the console's app folder) any more.`;
  if (looksLikeZip(name)) {
    const file = (await listed(folder, missing)).find((entry) => entry.path.toLowerCase() === name.toLowerCase());
    if (!file) throw new ImportError(missing);
    // The zip as if it had been picked: what it holds.
    return openArchives([file]);
  }
  // A folder: as if it had been picked, its name and all.
  return (await listed(`${folder}/${name}`, missing)).map((file) => ({ ...file, path: `${name}/${file.path}` }));
}
