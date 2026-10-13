/**
 * Putting Fallout Et Tu together.
 *
 * Et Tu is the first Fallout rebuilt as a game for the engine of the second.
 * On a desktop it is installed in three steps: unpack its package into a
 * folder inside Fallout 2, run a tool that copies several thousand files
 * (speech, movies, map tiles) out of Fallout's MASTER.DAT into that folder,
 * and start the engine from there. The console does the same from what it is
 * given: the package as a folder or as the zip it is downloaded as, and the
 * Fallout already loaded into its own deck.
 *
 * The package is some sixteen thousand loose files once complete. They are
 * stored as a handful of archives instead (see datpack.ts):
 *
 *   mods/<name>     one archive for each mod folder that mods_order.txt
 *                   switches on. The engine opens an archive wherever it
 *                   would open a folder, so the load order file stays as is.
 *   fallout1.dat    what the package keeps in its data folder, with the files
 *                   borrowed from Fallout. The engine is pointed at it as the
 *                   second of its two patch locations, directly below the
 *                   data folder itself, which is where these files rank on a
 *                   desktop too.
 *
 * What the engine or its scripts read by plain path stays as files: music,
 * settings, and everything in the config folders.
 */
import { dat1EntrySource, findInDat } from '../dat';
import { packDat2, type PackMember } from '../datpack';
import { GAMES } from '../games';
import { Ini } from '../ini';
import { basename, dirname, pathKey } from './manifest';
import type { SourceBlob } from './opfs';
import { ImportError, isJunk, isLeftoverState, isSave, type ImportContext, type ImportPlan, type SourceFile } from './plan';

const MODS_ORDER = 'mods/mods_order.txt';
/** The mod that is the game itself; a folder without it is not Et Tu. */
const BASE_MOD = 'mods/fo1_base/';
/** The list of files Et Tu's own tool copies out of Fallout's MASTER.DAT. Ships with the package. */
const BORROW_LIST = 'undat_files.txt';
/** Present in packages made since Et Tu's developers took up the Community Edition engine. */
const CE_MARKER = 'fallout2-ce.exe';

/** The archive that stands in for the bulk of Et Tu's data folder. */
export const BORROWED_ARCHIVE = 'fallout1.dat';

/** Files of the package's own folder that the engine reads. */
const ROOT_FILES = /^(ddraw\.ini|f2_res\.ini|f2_res\.dat|patch\d{3}\.dat)$/;
/** In the data folder these are read by plain path, not looked up like game data. */
const PLAIN_FILES = /\.(ini|cfg|txt)$/;

const DEF = GAMES.ettu;

/**
 * Where in a selection a copy of Et Tu lies: the lower-cased path of the
 * folder that holds its mods folder ('' for the selection itself). Null when
 * there is none.
 */
export function findEttu(sources: SourceFile[]): string | null {
  const keys = sources.map((source) => pathKey(source.path));
  let best: string | null = null;
  for (const key of keys) {
    if (key !== MODS_ORDER && !key.endsWith(`/${MODS_ORDER}`)) continue;
    const root = key.slice(0, Math.max(0, key.length - MODS_ORDER.length - 1));
    const prefix = root ? `${root}/` : '';
    if (!keys.some((other) => other.startsWith(prefix + BASE_MOD))) continue;
    // A selection with several (a backup inside the folder, say): the outermost.
    if (best === null || root.length < best.length) best = root;
  }
  return best;
}

/** The mods a load order file switches on, lower-cased, in order. */
export function enabledMods(text: string): string[] {
  const mods: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    // The engine passes over any line with a comment mark in it, wherever the mark is.
    if (/[;#]/.test(line)) continue;
    const name = pathKey(line.trim());
    if (name && !mods.includes(name)) mods.push(name);
  }
  return mods;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Works out how to store the copy of Et Tu found at `root` (as findEttu gave it). */
export async function planEttu(sources: SourceFile[], root: string, context: ImportContext = {}): Promise<ImportPlan> {
  const prefix = root ? `${root}/` : '';
  const items = new Map<string, { path: string; file: SourceBlob }>();
  let shownRoot = '';
  let skipped = 0;
  for (const source of sources) {
    const full = source.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const key = full.toLowerCase();
    if (!key.startsWith(prefix) || key.length === prefix.length || items.has(key.slice(prefix.length))) {
      skipped++;
      continue;
    }
    shownRoot ||= full.slice(0, root.length);
    items.set(key.slice(prefix.length), { path: full.slice(prefix.length), file: source.file });
  }

  const order = items.get(MODS_ORDER);
  if (!order) throw new ImportError('That copy of Fallout Et Tu has no mods/mods_order.txt.');
  const enabled = enabledMods(await order.file.text());

  const loose: SourceFile[] = [];
  const saves: SourceFile[] = [];
  const borrowed: PackMember[] = [];
  /** Lower-cased paths, relative to the data folder, of what the selection already holds there. */
  const inData = new Set<string>();
  const mods = new Map<string, { name: string; members: PackMember[] }>();
  const left = new Set<string>();
  let installConfig: string | undefined;
  let hasMusic = false;
  let madeForEngine = false;
  let packaged = 0;

  for (const [key, { path, file }] of items) {
    const parts = key.split('/');
    const name = parts[parts.length - 1]!;
    const top = parts[0]!;
    if (isJunk(name)) {
      skipped++;
    } else if (parts.length === 1) {
      if (key === DEF.configFile) installConfig = await file.text();
      else if (ROOT_FILES.test(key)) loose.push({ path, file });
      else {
        if (key === CE_MARKER) madeForEngine = true;
        skipped++;
      }
    } else if (top === 'config') {
      loose.push({ path, file });
    } else if (top === 'mods' && parts.length === 2) {
      // Settings of mods, and mods that already are archives.
      if (!/\.(dat|zip)$/.test(name) || enabled.includes(name)) loose.push({ path, file });
      else skipped++;
    } else if (top === 'mods') {
      const mod = parts[1]!;
      if (!enabled.includes(mod)) {
        left.add(mod);
        skipped++;
        continue;
      }
      let entry = mods.get(mod);
      if (!entry) mods.set(mod, (entry = { name: path.split('/')[1]!, members: [] }));
      entry.members.push({ name: path.split('/').slice(2).join('/'), file });
      packaged++;
    } else if (top === 'data') {
      if (isSave(key)) {
        saves.push({ path, file });
      } else if (isLeftoverState(key)) {
        skipped++;
      } else if (DEF.musicDirs.some((dir) => key.startsWith(`${dir}/`))) {
        if (key.endsWith('.acm')) hasMusic = true;
        loose.push({ path, file });
      } else if (parts[1] === 'config' || PLAIN_FILES.test(name)) {
        loose.push({ path, file });
      } else {
        borrowed.push({ name: path.slice(5), file });
        inData.add(key.slice(5));
        packaged++;
      }
    } else {
      // Programs, manuals, tools, and what only the original engine can use.
      skipped++;
    }
  }

  // What Et Tu needs out of Fallout itself.
  const warnings: string[] = [];
  const notes: string[] = [];
  const list = items.get(BORROW_LIST) ?? sources.find((source) => basename(pathKey(source.path)) === BORROW_LIST);
  if (list) {
    const wanted = new Map<string, string>();
    for (const line of (await list.file.text()).split(/\r?\n/)) {
      const name = line.trim();
      if (name && !inData.has(pathKey(name))) wanted.set(pathKey(name), name);
    }
    if (wanted.size) {
      const donor = GAMES[DEF.conversion!.donor];
      const archive = (await context.archiveOf?.(donor.id)) ?? null;
      if (!archive) {
        throw new ImportError(
          `Fallout Et Tu is built from ${donor.title} as well: ${count(wanted.size, 'file')} of it (speech, movies, map tiles) ` +
            `come out of ${donor.title}'s MASTER.DAT. Load ${donor.title} into deck ${donor.deck} first; the console takes them from there.`,
        );
      }
      const found = await findInDat(archive, donor.datFormat, [...wanted.keys()]);
      for (const [key, entry] of found) borrowed.push({ name: wanted.get(key)!, file: dat1EntrySource(archive, entry) });
      if (found.size) notes.push(`${count(found.size, 'file')} taken from your ${donor.title} in deck ${donor.deck}.`);
      const absent = wanted.size - found.size;
      if (absent) {
        warnings.push(
          `${count(absent, 'file')} that Et Tu asks for ${absent === 1 ? 'is' : 'are'} not in your ${donor.title}'s MASTER.DAT. ` +
            'Some speech or pictures may be missing in the game.',
        );
      }
    }
  } else if (!borrowed.length) {
    throw new ImportError(
      `That copy of Fallout Et Tu has no ${BORROW_LIST}, the list of the files it needs out of Fallout. ` +
        'Use the package as it is downloaded, or a folder its UNDAT tool has already been run in.',
    );
  }

  const entries = [...loose];
  try {
    // In load order, though nothing depends on it: each is found by its name.
    for (const mod of enabled) {
      const entry = mods.get(mod);
      if (entry) entries.push({ path: `mods/${entry.name}`, file: packDat2(entry.members) });
      else if (!items.has(`mods/${mod}`)) warnings.push(`mods_order.txt names ${mod}, which is not in the package.`);
    }
    if (borrowed.length) entries.push({ path: BORROWED_ARCHIVE, file: packDat2(borrowed) });
  } catch (err) {
    if (err instanceof RangeError) throw new ImportError('That copy of Fallout Et Tu holds more than the engine can open as one archive.');
    throw err;
  }

  if (!madeForEngine) {
    warnings.push(
      `This package has no ${CE_MARKER}. That suggests it was made before Et Tu took up the Community Edition engine, ` +
        'which is the one the console runs: parts of the game may not work. Newer packages are on the project page.',
    );
  }
  if (!hasMusic) warnings.push('No music files were found. The game will run without background music.');
  if (left.size) notes.push(`${count(left.size, 'optional mod')} switched off in mods_order.txt ${left.size === 1 ? 'was' : 'were'} left out.`);

  const dirs = new Set<string>(['mods', 'data', 'config']);
  for (const { path } of [...entries, ...saves]) {
    for (let dir = dirname(path); dir; dir = dirname(dir)) dirs.add(dir);
  }
  // Largest first is slightly friendlier to the progress bar.
  entries.sort((a, b) => b.file.size - a.file.size);

  return {
    game: 'ettu',
    datFormat: DEF.datFormat,
    root: shownRoot,
    entries,
    dirs: [...dirs].sort(),
    totalBytes: entries.reduce((sum, entry) => sum + entry.file.size, 0),
    sourceFiles: loose.length + packaged + borrowed.length - inData.size,
    skipped,
    saves,
    installConfig,
    language: installConfig ? Ini.parse(installConfig).get('system', 'language') : undefined,
    hasMusic,
    warnings,
    notes,
    also: [],
  };
}
