/**
 * Folder paths inside the console's own folder in the player's cloud: the
 * app folder of their Dropbox app, or the folder the console made in their
 * Google Drive. '' is that folder itself.
 */

/**
 * Tidies a folder path as the player typed it: "/Games/Fallout 2", or '' for
 * the console's folder itself. Throws when the path tries to climb out.
 */
export function normaliseFolder(text: string): string {
  const parts = text
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.');
  if (parts.includes('..')) throw new Error('A folder path cannot contain "..".');
  return parts.length ? `/${parts.join('/')}` : '';
}

/** A folder path as the console shows it: the console's folder itself is "/". */
export function showFolder(folder: string): string {
  return folder || '/';
}

/** Whether `path` is `folder` or lies inside it. Case does not matter, as in Dropbox. */
export function isWithin(path: string, folder: string): boolean {
  const inner = path.toLowerCase();
  const outer = folder.toLowerCase();
  return !outer || inner === outer || inner.startsWith(`${outer}/`);
}
