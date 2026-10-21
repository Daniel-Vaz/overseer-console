/**
 * The player's Dropbox, as the console's cloud: the app folder of the app
 * they made for the console.
 */
import type { Cloud, CloudFile } from '../cloud/provider';
import { download, fromDropboxTime, listFiles, remove, saveUrl, sendLarge, spaceUsage, upload, type DropboxFile } from './api';
import { loadConfig, loadLink, loadSynced, storeSynced } from './link';

function cloudFile(file: DropboxFile): CloudFile {
  return {
    id: file.id ?? file.path_lower,
    name: file.name,
    path: file.path_display,
    size: file.size,
    rev: file.rev,
    modified: fromDropboxTime(file.client_modified),
  };
}

export const dropboxCloud: Cloud = {
  id: 'dropbox',
  name: 'Dropbox',
  home: "the console's app folder",
  cause: 'cloud',
  link() {
    const link = loadLink();
    return link ? { account: { name: link.account.name, email: link.account.email }, linkedAt: link.linkedAt } : null;
  },
  folders() {
    const { gamesFolder, savesFolder } = loadConfig();
    return { gamesFolder, savesFolder };
  },
  listFiles: async (folder, recursive) => (await listFiles(folder, recursive)).map(cloudFile),
  download,
  upload: async (path, data, options) => cloudFile(await upload(path, data, options)),
  remove,
  send: async (path, data, options) => cloudFile(await sendLarge(path, data, options)),
  saveUrl: async (path, url, signal) => cloudFile(await saveUrl(path, url, signal)),
  space: spaceUsage,
  loadSynced,
  storeSynced,
};
