/**
 * Game files in the player's cloud.
 *
 * The player puts their game folder, or a zip of it, into the console's
 * folder there, and their mods into a Mods folder inside it: with Put in
 * your cloud, or in Dropbox also with Dropbox's own app or website. The
 * console only reads them from there. To the importer a file there is like a
 * file on disk, except that reading it is a download.
 */
import { buffered } from '../blobs';
import { gameDef, type BaseGameId } from '../games';
import { ImportError, openArchives, type SourceFile } from '../storage/importer';
import type { SourceBlob } from '../storage/opfs';
import { looksLikeZip } from '../zip';
import { requireCloud } from './clouds';
import { CloudError } from './errors';
import { isWithin, showFolder } from './folders';
import type { Cloud, CloudFile } from './provider';

class CloudBlob implements SourceBlob {
  constructor(
    private readonly cloud: Cloud,
    private readonly file: string,
    readonly size: number,
    readonly lastModified: number,
  ) {}

  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } {
    const from = Math.max(0, Math.min(start, this.size));
    const to = Math.max(from, Math.min(end, this.size));
    return {
      // Nothing is asked of the cloud for an empty range: Dropbox would refuse one.
      arrayBuffer: () => (to > from ? this.cloud.download(this.file, { start: from, end: to }) : Promise.resolve(new ArrayBuffer(0))),
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

/** The Mods folder, as a path below the console's folder. */
export function modsFolder(cloud: Cloud = requireCloud()): string {
  return `${cloud.folders().gamesFolder}/${MODS_FOLDER}`;
}

/** A file in the cloud as the importer reads it. */
export function cloudSource(cloud: Cloud, file: CloudFile, folder: string): SourceFile {
  const blob = new CloudBlob(cloud, file.id, file.size, file.modified);
  return {
    // Relative to the folder that was listed.
    path: file.path.slice(folder.length + 1),
    // A zip is walked through file by file: read ahead, or every one of them is a request.
    file: looksLikeZip(file.name) ? buffered(blob) : blob,
  };
}

/** Lists a folder of the console's folder and everything below it; the error says where it was looked for. */
async function listed(cloud: Cloud, folder: string, missing: string): Promise<SourceFile[]> {
  try {
    return (await cloud.listFiles(folder, true)).map((file) => cloudSource(cloud, file, folder));
  } catch (err) {
    if (err instanceof CloudError && err.notFound) throw new ImportError(missing);
    throw err;
  }
}

/**
 * Everything below the games folder but the mods and the saves, for the
 * importer to find a game in. A zip at the top of the games folder is looked
 * into: that is how Put in your cloud keeps a game. Throws an ImportError
 * when there is plainly nothing to find.
 */
export async function cloudGameFiles(game: BaseGameId, cloud: Cloud = requireCloud()): Promise<SourceFile[]> {
  const { gamesFolder: folder, savesFolder } = cloud.folders();
  const where = folder ? `the folder ${showFolder(folder)} of ${cloud.home}` : cloud.home;
  const missing =
    cloud.id === 'drive'
      ? `There is no folder ${showFolder(folder)} in ${cloud.home} in your Google Drive. Put a game there with Put in Google Drive, or change the games folder, both under Cloud link in Terminal settings.`
      : `There is no folder ${showFolder(folder)} in ${cloud.home} in your Dropbox. Create it, or change the games folder under Cloud link in Terminal settings.`;
  // Saves kept inside the games folder (as they are by default) are no part of a game.
  const savesInside = savesFolder !== '' && savesFolder.toLowerCase() !== folder.toLowerCase() && isWithin(savesFolder, folder);
  const files = (await listed(cloud, folder, missing)).filter(
    (file) => !file.path.toLowerCase().startsWith(`${MODS_FOLDER.toLowerCase()}/`) && !(savesInside && isWithin(`${folder}/${file.path}`, savesFolder)),
  );

  const found: SourceFile[] = [];
  for (const file of files) {
    if (file.path.includes('/') || !looksLikeZip(file.path)) found.push(file);
    // A zip that is no zip after all is passed over.
    else found.push(...(await openArchives([file], true)));
  }

  if (!found.some((file) => /(^|\/)master\.dat$/i.test(file.path))) {
    const title = gameDef(game).title;
    throw new ImportError(
      cloud.id === 'drive'
        ? `No MASTER.DAT in ${where} in your Google Drive, of what the console can see there. Put ${title} there with Put in Google Drive, ` +
            'under Cloud link in Terminal settings: Google lets the console see only what it put there itself.'
        : `No MASTER.DAT in ${where} in your Dropbox. Upload the folder ${title} is installed in ` +
            '(the one that contains MASTER.DAT and CRITTER.DAT), or a zip of it, there, wait until Dropbox has finished, then try again.',
    );
  }
  return found;
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
export async function listCloudMods(cloud: Cloud = requireCloud()): Promise<CloudMod[]> {
  const folder = modsFolder(cloud);
  let files: CloudFile[];
  try {
    files = await cloud.listFiles(folder, true);
  } catch (err) {
    if (err instanceof CloudError && err.notFound) return [];
    throw err;
  }
  const mods = new Map<string, CloudMod>();
  for (const file of files) {
    const rest = file.path.slice(folder.length + 1);
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

/** The files of one mod of the Mods folder (`name` as listCloudMods gives it), for the importer. */
export async function cloudModFiles(name: string, cloud: Cloud = requireCloud()): Promise<SourceFile[]> {
  const folder = modsFolder(cloud);
  const missing = `There is no ${name} in the Mods folder of your ${cloud.name} (${showFolder(folder)} in ${cloud.home}) any more.`;
  if (looksLikeZip(name)) {
    const file = (await listed(cloud, folder, missing)).find((entry) => entry.path.toLowerCase() === name.toLowerCase());
    if (!file) throw new ImportError(missing);
    // The zip as if it had been picked: what it holds.
    return openArchives([file]);
  }
  // A folder: as if it had been picked, its name and all.
  return (await listed(cloud, `${folder}/${name}`, missing)).map((file) => ({ ...file, path: `${name}/${file.path}` }));
}
