/**
 * Game files in the player's Dropbox.
 *
 * The player puts their game folder into the app folder with Dropbox's own
 * app or website; the console only ever reads it. To the importer a file
 * there is like a file on disk, except that reading it is a download.
 */
import { GAMES, type GameId } from '../games';
import { ImportError, type SourceFile } from '../storage/importer';
import type { SourceBlob } from '../storage/opfs';
import { DropboxError, download, fromDropboxTime, listFiles } from './api';
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

/**
 * Everything below the games folder, for the importer to find a game in.
 * Throws an ImportError when there is plainly nothing to find.
 */
export async function dropboxGameFiles(game: GameId): Promise<SourceFile[]> {
  const folder = loadConfig().gamesFolder;
  const where = folder ? `the folder ${showFolder(folder)} of the console's app folder` : "the console's app folder";
  let files;
  try {
    files = await listFiles(folder, true);
  } catch (err) {
    if (err instanceof DropboxError && err.notFound) {
      throw new ImportError(`There is no folder ${showFolder(folder)} in the console's app folder in your Dropbox. Create it, or change the games folder under Dropbox link in Terminal settings.`);
    }
    throw err;
  }
  const sources = files.map((file) => ({
    // Relative to the folder that was listed.
    path: file.path_display.slice(folder.length + 1),
    file: new DropboxBlob(file.id ?? file.path_lower, file.size, fromDropboxTime(file.client_modified)),
  }));
  if (!sources.some((source) => /(^|\/)master\.dat$/i.test(source.path))) {
    throw new ImportError(
      `No MASTER.DAT in ${where} in your Dropbox. Upload the folder ${GAMES[game].title} is installed in ` +
        '(the one that contains MASTER.DAT and CRITTER.DAT) there, wait until Dropbox has finished, then try again.',
    );
  }
  return sources;
}
