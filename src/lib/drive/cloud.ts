/**
 * The player's Google Drive, as the console's cloud: the folder the console
 * made there, and what it put in it.
 *
 * Dropbox refuses a write over a file that changed since it was looked at;
 * Drive has nothing of the kind. Here the file is looked at again just
 * before it is written, which leaves a moment for another device to come in
 * between where Dropbox leaves none.
 */
import type { Cloud, CloudFile } from '../cloud/provider';
import { DriveError, deleteForever, download, fromDriveTime, sendInPieces, storage, trash, write, type DriveFile } from './api';
import { loadConfig, loadLink, loadSynced, storeSynced } from './link';
import { ensureFolders, inFolders, segments, snapshot, type Tree } from './tree';

/** Noted on each file the console writes: when its contents were written, to the millisecond. */
const WRITTEN = 'writtenAt';

function cloudFile(file: DriveFile, path: string): CloudFile {
  const noted = Number(file.appProperties?.[WRITTEN]);
  return {
    id: file.id,
    name: file.name,
    path,
    size: Number(file.size ?? 0),
    rev: file.headRevisionId ?? file.modifiedTime ?? '',
    modified: noted > 0 ? noted : fromDriveTime(file.modifiedTime),
  };
}

function split(path: string): { folder: string; name: string } {
  const parts = segments(path);
  const name = parts.pop() ?? '';
  return { folder: parts.length ? `/${parts.join('/')}` : '', name };
}

function conflict(path: string): DriveError {
  return new DriveError(`${path} in Google Drive is not the file that was looked at a moment ago.`, 409, 'conflict');
}

/** The folders at a path, from the last listing unless that does not have them. */
async function foldersAt(path: string): Promise<{ tree: Tree; folders: DriveFile[] }> {
  let tree = await snapshot();
  let folders = tree.folders(path);
  if (!folders.length) {
    tree = await snapshot(true);
    folders = tree.folders(path);
  }
  return { tree, folders };
}

export const driveCloud: Cloud = {
  id: 'drive',
  name: 'Google Drive',
  home: 'the Overseer Console folder',
  cause: 'drive',
  link() {
    const link = loadLink();
    return link ? { account: { ...link.account }, linkedAt: link.linkedAt } : null;
  },
  folders() {
    const { gamesFolder, savesFolder } = loadConfig();
    return { gamesFolder, savesFolder };
  },

  async listFiles(folder, recursive = false) {
    const below = (await snapshot(true)).filesBelow(folder, recursive);
    if (!below) throw new DriveError(`There is no folder ${folder} in the Overseer Console folder.`, 404, 'notFound');
    return below.map(({ file, path }) => cloudFile(file, path));
  },

  download,

  async upload(path, data, { replaces, modified }) {
    const { folder, name } = split(path);
    const { tree, folders } = await ensureFolders(folder);
    const there = await inFolders(folders, name);
    // As in Dropbox: a file that is gone is no conflict.
    if (there && (replaces === null || there.headRevisionId !== replaces)) throw conflict(path);
    const stored = await write(there ? { id: there.id } : { name, parent: folders[0]!.id }, new Blob([data as Uint8Array<ArrayBuffer>]), modified, {
      [WRITTEN]: String(modified),
    });
    tree.add(stored);
    return cloudFile(stored, path);
  },

  async remove(path, rev) {
    const { folder, name } = split(path);
    const { tree, folders } = await foldersAt(folder);
    const there = await inFolders(folders, name);
    if (!there) throw new DriveError(`${path} is not in Google Drive.`, 404, 'notFound');
    if (there.headRevisionId !== rev) throw conflict(path);
    await trash(there.id);
    tree.drop(there.id);
  },

  async send(path, data, { modified, replace, onProgress, signal }) {
    const { folder, name } = split(path);
    const { tree, folders } = await ensureFolders(folder);
    const there = await inFolders(folders, name);
    if (there && !replace) throw conflict(path);
    // The new file goes up beside the old one, which is deleted only once the new one is whole.
    const stored = await sendInPieces({ name, parent: folders[0]!.id }, data, { modified, appProperties: { [WRITTEN]: String(modified) }, onProgress, signal });
    tree.add(stored);
    if (there) {
      await deleteForever(there.id).catch(() => undefined);
      tree.drop(there.id);
    }
    return cloudFile(stored, path);
  },

  space: storage,
  loadSynced,
  storeSynced,
};
