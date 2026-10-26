/**
 * Putting an add-on together: from its zip, its folder, or the one archive
 * it is downloaded as.
 *
 * An add-on is unpacked into a game folder on a desktop, over whatever is
 * there: a game, or a mod installed in it. What it brings is one of these,
 * or a few of them together:
 *
 *  - archives and folders for Fallout 2's mods folder, and their settings
 *    beside them (FO2tweaks, Party Orders), or one such archive handed over
 *    on its own (Cassidy's talking head);
 *  - loose files for the data folder: in a data folder of their own, or in
 *    the folders of one (art, text, scripts...) to be put inside it;
 *  - music, as the tracks alone, to go where the game keeps its own.
 *
 * Here it is stored on its own, and laid over a game or mod when that starts
 * (see mount.ts), for as long as it is switched on for it (see addons.ts).
 * For Fallout 2 its loose data is kept as one archive in its mods folder,
 * read above that game's own and its mod's: on a desktop the archives of a
 * mod hide the loose files of the data folder, and the add-on would not be
 * seen under them. Fallout's engine reads only Fallout's own archives, so an
 * add-on of Fallout stays loose files.
 */
import { addonRecord, newAddonId, type AddonRecord } from '../addons';
import { packDat2, type PackMember } from '../datpack';
import { gameDef, type BaseGameId } from '../games';
import { checkFiles, summary } from '../sfall/check';
import { enabledMods } from './ettu';
import { detectDatFormat } from './importer';
import { basename, dirname, pathKey } from './manifest';
import type { SourceBlob } from './opfs';
import { ImportError, isJunk, isLeftoverState, isSave, type ImportPlan, type SourceFile } from './plan';

/** What only a desktop needs: programs, libraries (sfall's ddraw.dll among them), installers. */
const DESKTOP = /\.(exe|dll|bat|cmd|com|sh|command|msi|lnk|url|ico|so|dylib|pdb|zip|7z|rar)$/i;
/** What is there to be read by people: notes, pictures of the add-on, its licence. */
const DOCUMENT = /\.(txt|md|pdf|rtf|htm|html|png|jpg|jpeg|gif|webp|doc|docx)$/i;
/** The folders of a game folder that an add-on puts files in. */
const GAME_FOLDERS = ['mods', 'data', 'sound'];
/** The folders of the data folder, where an add-on's files are in those and not in a data folder of their own. */
const DATA_FOLDERS = new Set(['art', 'text', 'proto', 'scripts', 'maps', 'premade', 'font']);
/** Where the games keep their music. */
export const MUSIC_DIRS = ['data/sound/music', 'sound/music'];
/** In the data and mods folders these are read by plain path, not looked up like game data. */
const PLAIN = /\.(ini|cfg|txt)$/;
const ORDER = 'mods/mods_order.txt';

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const depthOf = (root: string): number => (root ? root.split('/').length : 0);

/** Where a selection holds a folder (lower-cased): the part of `key` before `/<name>/`, or null. */
function parentOf(key: string, name: string): string | null {
  if (key.startsWith(`${name}/`)) return '';
  const at = key.indexOf(`/${name}/`);
  return at < 0 ? null : key.slice(0, at);
}

/** A file of the add-on: where it goes in the game folder, as spelled, and its contents. */
interface Item {
  path: string;
  file: SourceBlob;
}

interface Found {
  /** By lower-cased path in the game folder. */
  items: Map<string, Item>;
  /** What it is called: its zip, its folder, or the one file it is. */
  name: string;
  /** Its folder in the selection, as spelled ('' for the selection itself). */
  root: string;
  desktop: number;
  skipped: number;
}

/** The name of a selection: the zip it came in, else the folder it is in, else its one file. */
function nameOf(sources: SourceFile[], root: string): string {
  const zip = sources.find((source) => source.zip)?.zip;
  if (zip) return zip.replace(/\.zip$/i, '');
  if (root) return basename(root);
  const first = sources[0]?.path.replace(/\\/g, '/') ?? '';
  return first.includes('/') ? first.split('/')[0]! : first.replace(/\.[^.]+$/, '');
}

/** Sorts a file of the selection into what is kept, and what is left out. */
function take(found: Found, key: string, item: Item): void {
  const name = basename(key);
  if (isJunk(name) || name.startsWith('._') || key.split('/').includes('__macosx')) found.skipped++;
  else if (DESKTOP.test(name)) found.desktop++;
  else if (!found.items.has(key)) found.items.set(key, item);
}

/**
 * Finds the add-on in a selection: the folder that holds its mods, data or
 * sound folder, as it is unpacked into a game folder; else the folders of a
 * data folder; else loose files, each put where its kind goes.
 */
function findAddon(sources: SourceFile[]): Found {
  const spelled = sources.map((source) => ({ ...source, path: source.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') }));
  const keys = spelled.map((source) => source.path.toLowerCase());

  let root: string | null = null;
  for (const key of keys) {
    for (const name of GAME_FOLDERS) {
      const at = parentOf(key, name);
      if (at !== null && (root === null || depthOf(at) < depthOf(root))) root = at;
    }
  }
  let inData = false;
  if (root === null) {
    for (const key of keys) {
      const parts = key.split('/');
      const at = parts.findIndex((part, index) => index < parts.length - 1 && DATA_FOLDERS.has(part));
      if (at < 0) continue;
      const folder = parts.slice(0, at).join('/');
      if (root === null || depthOf(folder) < depthOf(root)) root = folder;
      inData = true;
    }
  }

  const found: Found = { items: new Map(), name: '', root: '', desktop: 0, skipped: 0 };
  if (root !== null) {
    const prefix = root ? `${root}/` : '';
    for (const [index, source] of spelled.entries()) {
      const key = keys[index]!;
      if (!key.startsWith(prefix) || key.length === prefix.length) {
        found.skipped++;
        continue;
      }
      found.root ||= source.path.slice(0, root.length);
      const path = source.path.slice(prefix.length);
      const relative = key.slice(prefix.length);
      const top = relative.split('/')[0]!;
      if (inData) {
        if (DATA_FOLDERS.has(top)) take(found, `data/${relative}`, { path: `data/${path}`, file: source.file });
        else found.skipped++;
      } else if (!relative.includes('/')) {
        // At the top of the game folder: archives are for its mods folder, sfall's settings stay where they are.
        if (relative.endsWith('.dat')) take(found, `mods/${relative}`, { path: `mods/${path}`, file: source.file });
        else if (relative.endsWith('.ini') || DESKTOP.test(relative)) take(found, relative, { path, file: source.file });
        else found.skipped++;
      } else if (GAME_FOLDERS.includes(top)) {
        take(found, relative, { path, file: source.file });
      } else {
        found.skipped++;
      }
    }
  } else {
    // Loose files: archives for the mods folder, music for the game's, global scripts for the scripts folder.
    for (const source of spelled) {
      const name = basename(source.path);
      const key = name.toLowerCase();
      const into = key.endsWith('.dat') ? 'mods' : key.endsWith('.acm') ? 'data/sound/music' : key.endsWith('.int') ? 'data/scripts' : null;
      if (into) take(found, `${into}/${key}`, { path: `${into}/${name}`, file: source.file });
      else if (DESKTOP.test(name)) found.desktop++;
      else found.skipped++;
    }
  }
  found.name = nameOf(sources, found.root);
  return found;
}

/**
 * Whether a selection is plainly an add-on of Fallout 2: nothing in it but
 * what goes in the mods folder (besides programs and notes), or Fallout 2
 * archives on their own. What "Load a mod" is handed is loaded as one then.
 */
export function isAddonShaped(sources: SourceFile[]): boolean {
  const kept = sources
    .map((source) => pathKey(source.path))
    .filter((key) => !isJunk(basename(key)) && !basename(key).startsWith('._') && !DESKTOP.test(key) && !DOCUMENT.test(key) && !key.split('/').includes('__macosx'));
  if (!kept.length) return false;
  if (kept.every((key) => !key.includes('/') && key.endsWith('.dat') && !/^(master|critter|patch\d{3}|f2_res)\.dat$/.test(key))) return true;
  return kept.every((key) => /(^|\/)mods\/./.test(key));
}

/** Its version, as the name of its zip or folder gives it ("fo2tweaks_v14.7"), and its name without it. */
function versionOf(name: string): { title: string; version?: string } {
  const match = /(?:^|[_\s-])(?:v(\d+(?:\.\d+)*)|(\d+(?:\.\d+)+))$/i.exec(name);
  const bare = (match ? name.slice(0, match.index) : name).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || name;
  return { title: bare.charAt(0).toUpperCase() + bare.slice(1), version: match?.[1] ?? match?.[2] };
}

/** The archives and folders its mods folder holds, by the name the load order gives them, lower-cased. */
function modsEntries(items: Map<string, Item>): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, { path }] of items) {
    const match = /^mods\/([^/]+)(\/.)?/.exec(key);
    if (!match || (!match[2] && PLAIN.test(match[1]!))) continue;
    entries.set(match[1]!, path.split('/')[1]!);
  }
  return entries;
}

/**
 * Works out how to store the add-on in a selection, for `base`: the game it
 * is laid over, or that game's mods. Undefined where the console is to tell
 * by what is in it. `replacing`: the add-on whose files these are, if any; it
 * keeps its name.
 */
export async function planAddon(sources: SourceFile[], base: BaseGameId | undefined, replacing?: string): Promise<ImportPlan> {
  if (!sources.length) throw new ImportError('Nothing was selected.');
  const found = findAddon(sources);
  const { items } = found;
  const notes: string[] = [];
  const warnings: string[] = [];

  // What it is for: Fallout 2's archives and its mods folder are that game's alone.
  const archives = [...items.entries()].filter(([key]) => /^mods\/[^/]+\.dat$/.test(key));
  let made: BaseGameId | undefined;
  for (const [, { path, file }] of archives) {
    const format = await detectDatFormat(file);
    if (format === 'dat1') throw new ImportError(`${basename(path)} is an archive of Fallout. Fallout's engine reads only its own two archives: an add-on of Fallout is loose files, for its data folder.`);
    if (format === 'dat2') made = 'fo2';
  }
  if ([...items.keys()].some((key) => key.startsWith('mods/') || /^data\/scripts\/(gl|hs_)[^/]*\.int$/.test(key))) made = 'fo2';
  const old = replacing ? addonRecord(replacing) : undefined;
  const game = base ?? old?.base ?? made;
  if (!game) throw new ImportError('The console cannot tell by its files whether that add-on is for Fallout or for Fallout 2: load it from the Add-ons of the game or mod it is for.');
  if (made && made !== game) {
    throw new ImportError(`That add-on is made for ${gameDef(made).title}'s mods folder, which ${gameDef(game).title}'s engine does not have.`);
  }
  if (old && old.base !== game) throw new ImportError(`That is an add-on of ${gameDef(game).title}, not of ${gameDef(old.base).title} as ${old.title} is.`);

  // What is not the add-on's to bring: the player's saves, and the maps an engine leaves behind.
  let skipped = found.skipped;
  for (const key of [...items.keys()]) {
    if (!isSave(key) && !isLeftoverState(key, 'fo1')) continue;
    items.delete(key);
    skipped++;
  }
  if (found.desktop) notes.push(`${count(found.desktop, 'file')} only a desktop needs (programs, libraries) ${found.desktop === 1 ? 'was' : 'were'} left out.`);

  const { title, version } = old ? { title: old.title, version: versionOf(found.name).version } : versionOf(found.name);
  const record: AddonRecord = { id: replacing ?? newAddonId(title), title, ...(version ? { version } : {}), base: game };

  // Its load order, where it brings one: the parts it switches on, in its order. Otherwise all of them.
  const own = items.get(ORDER);
  items.delete(ORDER);
  const parts = modsEntries(items);
  const listed = own ? enabledMods(await own.file.text()).filter((name) => parts.has(name)) : [];
  const order = (own ? listed : [...parts.keys()].sort()).map((key) => parts.get(key)!);

  const entries: SourceFile[] = [];
  if (game === 'fo2') {
    // Its loose data as one archive, under its own archives and above everything else.
    const data: PackMember[] = [];
    for (const [key, item] of [...items]) {
      if (!key.startsWith('data/') || key.startsWith('data/config/') || PLAIN.test(key) || MUSIC_DIRS.some((dir) => key.startsWith(`${dir}/`))) continue;
      data.push({ name: item.path.slice('data/'.length), file: item.file });
      items.delete(key);
    }
    if (data.length) {
      let name = `${record.id}-data.dat`;
      for (let n = 2; parts.has(name); n++) name = `${record.id}-data-${n}.dat`;
      entries.push({ path: `mods/${name}`, file: packDat2(data) });
      order.unshift(name);
      notes.push(`Its ${count(data.length, 'file')} for the data folder ${data.length === 1 ? 'is' : 'are'} kept as one archive in the load order, read over the game's own.`);
    }
    // A folder of its mods folder as an archive: the engine opens one wherever it would open a folder.
    const folders = new Map<string, { name: string; members: PackMember[] }>();
    for (const [key, item] of [...items]) {
      const match = /^mods\/([^/]+)\/(.+)$/.exec(key);
      if (!match) continue;
      const folder = folders.get(match[1]!) ?? { name: item.path.split('/')[1]!, members: [] };
      folder.members.push({ name: item.path.split('/').slice(2).join('/'), file: item.file });
      folders.set(match[1]!, folder);
      items.delete(key);
    }
    for (const { name, members } of folders.values()) entries.push({ path: `mods/${name}`, file: packDat2(members) });
  } else if ([...items.keys()].some((key) => key.startsWith('mods/'))) {
    throw new ImportError(`That add-on is made for Fallout 2's mods folder, which Fallout's engine does not have.`);
  }
  for (const item of items.values()) entries.push({ path: item.path, file: item.file });

  if (!entries.length) {
    throw new ImportError(
      'Nothing in that selection is an add-on for the console to load. Pick the zip it is downloaded as, its folder, or the archive it is, as it would be unpacked into the game folder.',
    );
  }

  const music = entries.filter((entry) => MUSIC_DIRS.some((dir) => pathKey(entry.path).startsWith(`${dir}/`)) && pathKey(entry.path).endsWith('.acm'));
  if (order.length) notes.push(`It adds ${order.join(', ')} to the load order of whatever it is laid over.`);
  if (music.length) notes.push(`${count(music.length, 'music track')}: played in place of the game's own ${music.length === 1 ? 'track' : 'tracks'} of the same name, and beside them.`);
  if (entries.some((entry) => /^ddraw\.ini$/i.test(entry.path))) notes.push('Its sfall settings (ddraw.ini) are used only where what it is laid over has none of its own.');
  // Whether its scripts will work: what they ask of sfall that the engine lacks, and settings files not there.
  if (game === 'fo2') {
    const check = await checkFiles(entries.map((entry) => ({ path: entry.path, size: entry.file.size, open: async () => entry.file })));
    if (check.scripts) (check.findings.length ? warnings : notes).push(summary(check));
  }

  const dirs = new Set<string>();
  for (const { path } of entries) for (let dir = dirname(path); dir; dir = dirname(dir)) dirs.add(dir);
  entries.sort((a, b) => b.file.size - a.file.size);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);

  return {
    game: record.id,
    datFormat: gameDef(game).datFormat,
    root: found.root,
    entries,
    dirs: [...dirs].sort(),
    totalBytes,
    sourceFiles: entries.length,
    skipped,
    saves: [],
    hasMusic: music.length > 0,
    warnings,
    notes,
    also: [],
    addon: { record, ...(order.length ? { order } : {}) },
  };
}
