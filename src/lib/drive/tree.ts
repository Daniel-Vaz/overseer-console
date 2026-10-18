/**
 * Paths in the console's folder in Google Drive.
 *
 * Drive keeps files by id: a folder may hold two files of the same name, and
 * the player may move a folder anywhere. The rest of the console speaks of
 * paths all the same, as it does with Dropbox: "/Saves/Fallout 2/SLOT03.zip",
 * below the console's own folder, which it makes in My Drive and calls
 * "Overseer Console". With the drive.file scope Drive lists only what the
 * console made, so one listing of everything is the whole tree.
 *
 * Folders of the same name side by side (two devices each made one at the
 * same moment) count as one folder. Of two files of the same name, the one
 * written last is the file. Case does not matter, as in Dropbox.
 */
import { FOLDER_TYPE, createFolder, fromDriveTime, query, quoted, type DriveFile } from './api';
import { loadLink } from './link';

/** What the console's own folder is called when it makes it. The player may rename it. */
export const ROOT_NAME = 'Overseer Console';

/** Marks the console's own folder, so that it is found wherever it was moved and whatever it was renamed to. */
const MARK_KEY = 'overseerConsole';
const MARK_VALUE = 'root';

const isFolder = (file: DriveFile) => file.mimeType === FOLDER_TYPE;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function created(file: DriveFile): number {
  return fromDriveTime(file.createdTime);
}

/** Of files of the same name, the one written last: by the time its writer gave it, then by when Drive got it. */
function newest(files: DriveFile[]): DriveFile | null {
  let best: DriveFile | null = null;
  for (const file of files) {
    const order = fromDriveTime(file.modifiedTime) - fromDriveTime(best?.modifiedTime) || created(file) - (best ? created(best) : 0);
    if (!best || order > 0) best = file;
  }
  return best;
}

export function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** A file and where it lies, from the console's folder. */
export interface Placed {
  file: DriveFile;
  path: string;
}

/** Everything the console made in the Drive, as it stood when it was listed. */
export class Tree {
  private readonly byParent = new Map<string, DriveFile[]>();
  /** The console's own folders: one, unless two devices made theirs at once. Oldest first. */
  readonly roots: DriveFile[];

  constructor(files: DriveFile[]) {
    for (const file of files) this.place(file);
    this.roots = files.filter((file) => isFolder(file) && file.appProperties?.[MARK_KEY] === MARK_VALUE).sort((a, b) => created(a) - created(b));
  }

  private place(file: DriveFile): void {
    for (const parent of file.parents ?? []) {
      const list = this.byParent.get(parent) ?? [];
      const at = list.findIndex((other) => other.id === file.id);
      if (at >= 0) list[at] = file;
      else list.push(file);
      this.byParent.set(parent, list);
    }
  }

  /** Adds what the console just made, or replaces it with what it just became. */
  add(file: DriveFile): void {
    this.place(file);
    if (isFolder(file) && file.appProperties?.[MARK_KEY] === MARK_VALUE && !this.roots.some((root) => root.id === file.id)) this.roots.push(file);
  }

  /** Forgets a file that was put in the trash. */
  drop(id: string): void {
    for (const list of this.byParent.values()) {
      const at = list.findIndex((file) => file.id === id);
      if (at >= 0) list.splice(at, 1);
    }
  }

  childrenOf(folders: DriveFile[]): DriveFile[] {
    return folders.flatMap((folder) => this.byParent.get(folder.id) ?? []);
  }

  /** The folders a path names (several, where same-named ones stand side by side). None when there is no such folder. */
  folders(path: string): DriveFile[] {
    let current = this.roots;
    for (const name of segments(path)) {
      if (!current.length) return [];
      current = this.childrenOf(current).filter((file) => isFolder(file) && same(file.name, name)).sort((a, b) => created(a) - created(b));
    }
    return current;
  }

  /** The file at a path: of several of that name, the one written last. */
  file(path: string): DriveFile | null {
    const parts = segments(path);
    const name = parts.pop() ?? '';
    return newest(this.childrenOf(this.folders(parts.join('/'))).filter((file) => !isFolder(file) && same(file.name, name)));
  }

  /**
   * The files in a folder, and with `recursive` in every folder below it,
   * each with its path. Null when there is no such folder; the console's own
   * folder always counts as there, even before it is made.
   */
  filesBelow(path: string, recursive: boolean): Placed[] | null {
    const top = this.folders(path);
    if (!top.length && segments(path).length) return null;
    const out: Placed[] = [];
    const seen = new Set<string>();
    const walk = (folders: DriveFile[], at: string) => {
      const children = this.childrenOf(folders).filter((file) => !seen.has(file.id));
      for (const file of children) seen.add(file.id);
      const files = new Map<string, DriveFile[]>();
      const subfolders = new Map<string, DriveFile[]>();
      for (const child of children) {
        const group = isFolder(child) ? subfolders : files;
        const key = child.name.toLowerCase();
        group.set(key, [...(group.get(key) ?? []), child]);
      }
      for (const group of files.values()) {
        const file = newest(group)!;
        out.push({ file, path: `${at}/${file.name}` });
      }
      if (!recursive) return;
      for (const group of subfolders.values()) {
        const ordered = group.sort((a, b) => created(a) - created(b));
        walk(ordered, `${at}/${ordered[0]!.name}`);
      }
    };
    // Spelled as the folders are named, not as the path was typed.
    const spelled = segments(path).length ? this.spelling(path) : '';
    walk(top, spelled);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** A folder path as its folders spell it. */
  private spelling(path: string): string {
    let current = this.roots;
    let out = '';
    for (const name of segments(path)) {
      current = this.childrenOf(current).filter((file) => isFolder(file) && same(file.name, name)).sort((a, b) => created(a) - created(b));
      out += `/${current[0]?.name ?? name}`;
    }
    return out;
  }
}

/** The last listing, for as long as it is good: a run of requests made together shares one. Of one link only. */
let last: { tree: Tree; at: number; link: string } | null = null;
const GOOD_FOR_MS = 10_000;

/** Everything the console made in the Drive. `fresh` lists it anew. */
export async function snapshot(fresh = false): Promise<Tree> {
  const link = loadLink()?.refreshToken ?? '';
  if (!fresh && last && last.link === link && Date.now() - last.at < GOOD_FOR_MS) return last.tree;
  const tree = new Tree(await query('trashed = false'));
  last = { tree, at: Date.now(), link };
  return tree;
}

/** Forgets the last listing: the next one asks Drive again. */
export function forgetTree(): void {
  last = null;
}

/** The console's own folder, made at the top of My Drive when there is none yet. */
async function home(tree: Tree): Promise<DriveFile> {
  const [root] = tree.roots;
  if (root) return root;
  const made = await createFolder(ROOT_NAME, null, { [MARK_KEY]: MARK_VALUE });
  tree.add(made);
  return made;
}

/**
 * The folders at a path, those that are missing made on the way. The first
 * is where new files go; a file of the path may lie in any of them.
 */
export async function ensureFolders(path: string): Promise<{ tree: Tree; folders: DriveFile[] }> {
  let tree = await snapshot();
  // Something to make: another device may have made it since the last listing, so look again first.
  if (!tree.folders(path).length) tree = await snapshot(true);
  let folders = [await home(tree)];
  if (tree.roots.length > 1) folders = tree.roots;
  for (const name of segments(path)) {
    const found = tree
      .childrenOf(folders)
      .filter((file) => isFolder(file) && same(file.name, name))
      .sort((a, b) => created(a) - created(b));
    if (found.length) {
      folders = found;
      continue;
    }
    const made = await createFolder(name, folders[0]!.id);
    tree.add(made);
    folders = [made];
  }
  return { tree, folders };
}

/** What lies in some folders now, asked of Drive rather than taken from a listing that may be old. */
export async function inFolders(folders: DriveFile[], name: string): Promise<DriveFile | null> {
  if (!folders.length) return null;
  const parents = folders.map((folder) => `${quoted(folder.id)} in parents`).join(' or ');
  return newest((await query(`(${parents}) and trashed = false`)).filter((file) => !isFolder(file) && same(file.name, name)));
}
