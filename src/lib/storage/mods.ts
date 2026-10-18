/**
 * Putting a mod together: from the mod as it is downloaded, or from a game
 * folder it was installed in.
 *
 * A mod is laid over the game it is played on when it starts (see
 * mount.ts), so of what the console is handed it keeps what differs from
 * that game:
 *
 *  - A complete game folder (one that holds MASTER.DAT: a mod's installer
 *    ran in it, or the mod is a whole game of its own) is compared with the
 *    game in the deck, file by file. What is the same is not stored again:
 *    the mod is started with the deck's copy of it, and with nothing else of
 *    that game.
 *  - Files to unpack into a game folder, as a mod's zip holds them, are
 *    stored as they are, and the game's own files are used beside them, less
 *    whatever the mod's installer would have moved out of the way.
 *
 * What only a desktop needs (programs, libraries, installers) is left out.
 * Folders of many small files are packed into archives, as Fallout Et Tu's
 * are (see ettu.ts): the engine opens an archive wherever it would open a
 * folder, and an archive is read on demand where loose files are kept in
 * memory.
 */
import { bytesSource, readRange } from '../blobs';
import { MAX_ARCHIVE_BYTES, packDat2, type PackMember } from '../datpack';
import { GAMES, gameDef, newModId, type BaseGameId, type GameId, type ModRecord } from '../games';
import { Ini } from '../ini';
import { KNOWN_MODS, KNOWN_MOD_IDS, type KnownMod, type KnownModId } from '../mods/catalog';
import { LAZY_THRESHOLD, basename, dirname, formatBytes, pathKey, type ModInstall, type ReusedFile } from './manifest';
import { openInstalled, type SourceBlob } from './opfs';
import { ImportError, isJunk, isLeftoverState, isSave, type ImportContext, type ImportPlan, type SourceFile } from './plan';

/** A mod found in a selection. */
export interface FoundMod {
  /** Lower-cased path of its folder in the selection ('' for the selection itself). */
  root: string;
  /** What its folder, or the zip it came in, is called: the name of a mod the console does not know. */
  name: string;
  /** A complete game folder (it holds MASTER.DAT), or files to unpack into one. */
  complete: boolean;
  base: BaseGameId;
  known?: KnownModId;
  /** Known by a file only that mod has, not merely by the name of its folder. */
  byFile?: boolean;
}

/** A complete game folder found by its MASTER.DAT (see importer.ts). */
interface Candidate {
  root: string;
  format: 'dat1' | 'dat2';
  depth: number;
}

/** What only a desktop needs: programs, libraries, installers and their scripts. */
const DESKTOP = /\.(exe|dll|bat|cmd|com|sh|command|msi|lnk|url|ico|so|dylib|pdb|zip|7z|rar|ipa|apk|dmg)$/i;
/** Top-level folders of a game folder that a mod brings for the engine. */
const GAME_FOLDERS = new Set(['data', 'sound', 'mods', 'config', 'sfall']);
/** Files at the top of a game folder that the engine reads: archives, and settings. */
const GAME_FILES = /\.(dat|ini|cfg)$/i;
/** The archive of sfall, the original engine's extension: the Community Edition engine has its own. */
const SFALL_DATA = 'sfall.dat';
/** In the data folder these are read by plain path, not looked up like game data. */
const PLAIN = /\.(ini|cfg|txt)$/;
/** The archive that stands in for a mod's many small files in its data folder. */
export const MOD_DATA = 'mod-data.dat';
/** Fewer loose files than this are not worth an archive of their own. */
const PACK_FROM = 16;

/** Where a selection holds a folder (lower-cased): the part of `key` before `/<name>/`, or null. */
function parentOf(key: string, name: string): string | null {
  if (key.startsWith(`${name}/`)) return '';
  const at = key.indexOf(`/${name}/`);
  return at < 0 ? null : key.slice(0, at);
}

const depthOf = (root: string): number => (root ? root.split('/').length : 0);

/** The name a folder of the selection goes by: its own, or that of the zip it came in. */
function nameOf(sources: SourceFile[], root: string): string {
  const prefix = root ? `${root}/` : '';
  const source = sources.find((candidate) => pathKey(candidate.path).startsWith(prefix));
  if (root && source) {
    const spelled = source.path.replace(/\\/g, '/').split('/').slice(0, depthOf(root));
    return spelled[spelled.length - 1] ?? root;
  }
  return source?.zip?.replace(/\.zip$/i, '') ?? 'Mod';
}

/**
 * Which mod the console knows a folder to be: by a file only that mod has,
 * else by the folder's name. A complete game folder is a mod of the game its
 * MASTER.DAT belongs to; files to unpack may be a mod of either.
 */
function recognise(keys: Set<string>, root: string, names: string[], base?: BaseGameId): Pick<FoundMod, 'known' | 'byFile'> {
  const prefix = root ? `${root}/` : '';
  const others = KNOWN_MOD_IDS.filter((id) => id !== 'ettu' && (!base || KNOWN_MODS[id].base === base));
  const byFile = others.find((id) => KNOWN_MODS[id].files?.some((file) => keys.has(prefix + file)));
  if (byFile) return { known: byFile, byFile: true };
  return { known: others.find((id) => names.some((name) => KNOWN_MODS[id].names.test(name))) };
}

/**
 * Finds the mod in a selection: a complete game folder, else a folder that
 * holds what a mod unpacks into one (its mods or data folder). A mod the
 * console knows by a file of its own is preferred, then the outermost.
 */
export function findMod(sources: SourceFile[], candidates: Candidate[]): FoundMod | null {
  const keys = new Set(sources.map((source) => pathKey(source.path)));
  const zips = [...new Set(sources.map((source) => source.zip).filter((zip): zip is string => !!zip))];
  const found: FoundMod[] = [];
  const add = (root: string, complete: boolean, base: BaseGameId) => {
    if (found.some((other) => other.root === root)) return;
    const name = nameOf(sources, root);
    found.push({ root, name, complete, base, ...recognise(keys, root, [name, ...zips], complete ? base : undefined) });
  };
  for (const candidate of candidates) add(candidate.root.toLowerCase(), true, candidate.format === 'dat1' ? 'fo1' : 'fo2');
  for (const key of keys) {
    // A MASTER.DAT that is a folder, as some mods ship it: the Community Edition engine opens it like an archive.
    const folder = parentOf(key, 'master.dat');
    if (folder !== null) add(folder, true, 'fo2');
  }
  // Files to unpack into a game folder: else, in a game folder the console does not know as a mod, an
  // installer's own folder inside it that the console knows by a file of its own (Fixt's sits in Fallout's).
  const nested = found.length > 0;
  if (!found.length || !found.some((mod) => mod.known)) {
    for (const key of keys) {
      for (const name of ['mods', 'data']) {
        const root = parentOf(key, name);
        // The folders of a mod's own mods folder are not mods of their own.
        if (root === null || root.split('/').includes('mods') || found.some((other) => other.root === root)) continue;
        if (nested && !recognise(keys, root, []).byFile) continue;
        add(root, false, 'fo2');
      }
    }
  }
  found.sort((a, b) => Number(!a.known) - Number(!b.known) || Number(!a.complete) - Number(!b.complete) || depthOf(a.root) - depthOf(b.root));
  const best = found[0];
  if (!best) return null;
  // A mod the console knows is played on the game it was made for.
  if (best.known && !best.complete) best.base = KNOWN_MODS[best.known].base;
  return best;
}

/** What a mod's installer does to the game folder it is unpacked into, done here instead. */
interface Recipe {
  /** Files moved, by lower-cased path, to where the installer puts them. */
  moves?: Record<string, string>;
  /** What of the game underneath the installer moves out of the way, and what it leaves. */
  hides?: string[];
  keeps?: string[];
  /** What of the mod is left out besides what only a desktop needs, and why. */
  skips?: { pattern: RegExp; why: string };
  /** Its loose item and critter protos are its own, not what an engine left behind (see isLeftoverState). */
  protos?: boolean;
  /** Turns what the mod brings for sfall into what the Community Edition engine reads. */
  adapt?(items: Map<string, Item>): Promise<string[]>;
}

interface Item {
  /** As the selection spells it, below the mod's folder. */
  path: string;
  file: SourceBlob;
}

const RECIPES: Partial<Record<KnownModId, Recipe>> = {
  // rpu-install.sh, after the zip is unpacked into the game folder: the game's own patch and data
  // files are moved aside (the mod brings its own), its music path points at the mod's music.
  rpu: {
    moves: { 'mods_order.txt': 'mods/mods_order.txt', 'gl_ammomod.int': 'data/scripts/gl_ammomod.int' },
    hides: ['patch000.dat', 'f2_res.dat', 'data/'],
    keeps: ['data/savegame/', 'data/*.txt', 'data/*.gcd', 'data/sound/music/'],
    skips: { pattern: /^appearance\//, why: 'its Hero Appearance art, a feature the engine does not have' },
  },
  // Unzipped over Fallout 2, with the game's patch archive removed; its protos in proto/ are put into
  // master.dat with dat2.exe. The data folder, packed into an archive read before master.dat, does as well.
  megamod: {
    hides: ['patch000.dat'],
    // Shipped loose, and kept read-only on a desktop so that the original engine cannot wipe them.
    protos: true,
    async adapt(items) {
      let moved = 0;
      for (const [key, item] of [...items]) {
        const match = /^proto\/(critters|items)\/([^/]+\.pro)$/.exec(key);
        if (!match) continue;
        items.delete(key);
        const to = `data/proto/${match[1]}/${match[2]}`;
        if (items.has(to)) continue;
        items.set(to, { path: `data/proto/${match[1]}/${item.path.split('/').pop()}`, file: item.file });
        moved++;
      }
      return moved ? [`${count(moved, 'of its protos', 'of its protos')} put where its tool would have put them.`] : [];
    },
  },
  // Its installer puts it in a folder of its own inside the game's, whose settings name the game's archives
  // and music but its own data folder: the game's loose data is not read, its music is.
  fixt: {
    hides: ['data/'],
    keeps: ['data/sound/music/'],
  },
  // Made for sfall 5: its load order is an INI file, and its global scripts live in sfall's folder.
  // The engine reads mods/mods_order.txt, and global scripts from the scripts folder.
  olympus: {
    async adapt(items) {
      const notes: string[] = [];
      const order = items.get('mods/mods_order.ini');
      if (order && !items.has('mods/mods_order.txt')) {
        const lines: string[] = [];
        for (const raw of (await order.file.text()).split(/\r?\n/)) {
          const line = raw.replace(/[;#].*$/, '').trim();
          const equals = line.indexOf('=');
          if (equals <= 0) continue;
          const name = line.slice(0, equals).trim();
          lines.push(line.slice(equals + 1).trim() === '0' ? `;${name}` : name);
        }
        items.set('mods/mods_order.txt', { path: 'mods/mods_order.txt', file: bytesSource(new TextEncoder().encode(`${lines.join('\r\n')}\r\n`)) });
      }
      let moved = 0;
      for (const [key, item] of [...items]) {
        const match = /^sfall\/scripts\/([^/]+\.int)$/.exec(key);
        if (!match || items.has(`data/scripts/${match[1]}`)) continue;
        items.set(`data/scripts/${match[1]}`, { path: `data/scripts/${item.path.split('/').pop()}`, file: item.file });
        moved++;
      }
      if (moved) notes.push(`${moved} of its sfall scripts were put where the engine looks for them.`);
      return notes;
    },
  },
};

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * Whether two files hold the same bytes. A file in the player's cloud is
 * compared where a difference would show (its ends, and pieces spread over
 * it) rather than downloaded whole; a file on this device is read through.
 */
async function sameContents(a: SourceBlob, b: SourceBlob, remote: boolean): Promise<boolean> {
  if (a.size !== b.size) return false;
  const size = a.size;
  const ranges: [number, number][] = [];
  if (remote && size > LAZY_THRESHOLD) {
    const piece = 16 << 10;
    ranges.push([0, 64 << 10]);
    for (let n = 1; n <= 14; n++) {
      const at = Math.floor(((size - piece) * n) / 15);
      ranges.push([at, at + piece]);
    }
    ranges.push([size - (64 << 10), size]);
  } else {
    for (let at = 0; at < size; at += 4 << 20) ranges.push([at, Math.min(size, at + (4 << 20))]);
  }
  for (const [start, end] of ranges) {
    const [x, y] = await Promise.all([readRange(a, start, end), readRange(b, start, end)]);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

/** The settings file a mod brings: the game's own name for it, else one at its top that says where the archives are. */
async function settingsOf(items: Map<string, Item>, base: BaseGameId): Promise<string | undefined> {
  const own = items.get(gameDef(base).configFile);
  if (own) return own.file.text();
  for (const [key, item] of items) {
    if (key.includes('/') || !key.endsWith('.cfg') || item.file.size > 1 << 20) continue;
    const text = await item.file.text();
    if (Ini.parse(text).get('system', 'master_dat') !== undefined) return text;
  }
  return undefined;
}

/**
 * Works out how to store the mod `found` in a selection. `target` is the mod
 * whose files are being replaced, if any: it keeps its name.
 */
export async function planFoundMod(sources: SourceFile[], found: FoundMod, context: ImportContext, target?: GameId): Promise<ImportPlan> {
  const base = gameDef(found.base);
  const known = found.known ? KNOWN_MODS[found.known] : undefined;
  const replaced = target && GAMES[target]?.mod ? gameDef(target) : null;
  const title = replaced?.title ?? known?.title ?? found.name.replace(/_/g, ' ').trim();
  const record: ModRecord = {
    id: target ?? newModId(title, found.known),
    known: found.known,
    title,
    version: versionOf(sources, found, known),
    base: found.base,
  };
  if (replaced && replaced.mod?.base !== found.base) {
    throw new ImportError(`That is a mod of ${base.title}, not of ${gameDef(replaced.mod!.base).title} as ${replaced.title} is.`);
  }

  const installed = (await context.installOf?.(found.base)) ?? null;
  if (!installed) {
    throw new ImportError(`${known?.title ?? 'That mod'} is played on ${base.title}: load ${base.title} into deck ${base.deck} first. The mod is laid over it, and only what differs from it is stored.`);
  }

  // The mod's own files, by lower-cased path below its folder.
  const prefix = found.root ? `${found.root}/` : '';
  const items = new Map<string, Item>();
  let shownRoot = '';
  for (const source of sources) {
    const full = source.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const key = full.toLowerCase();
    if (!key.startsWith(prefix) || key.length === prefix.length) continue;
    shownRoot ||= full.slice(0, found.root.length);
    const relative = key.slice(prefix.length);
    if (!items.has(relative)) items.set(relative, { path: full.slice(prefix.length), file: source.file });
  }

  const recipe = found.known ? RECIPES[found.known] : undefined;
  const notes: string[] = [];
  const warnings: string[] = [];
  for (const [from, to] of Object.entries(recipe?.moves ?? {})) {
    const item = items.get(from);
    if (!item || items.has(to)) continue;
    items.delete(from);
    items.set(to, { path: to, file: item.file });
  }
  if (recipe?.adapt) notes.push(...(await recipe.adapt(items)));
  const installConfig = await settingsOf(items, found.base);

  // What is kept, what is a saved game, and what is left out.
  const kept: Item[] = [];
  const saves: SourceFile[] = [];
  let desktop = 0;
  let skipped = sources.length - items.size;
  let recipeSkipped = 0;
  for (const [key, item] of items) {
    const parts = key.split('/');
    const name = parts[parts.length - 1]!;
    const top = parts[0]!;
    if (isJunk(name) || name.startsWith('._') || parts.includes('__macosx')) skipped++;
    else if (recipe?.skips?.pattern.test(key)) recipeSkipped++;
    else if (isSave(key)) saves.push({ path: item.path, file: item.file });
    else if (isLeftoverState(key, found.base) && !(recipe?.protos && key.endsWith('.pro'))) skipped++;
    else if (DESKTOP.test(name)) desktop++;
    else if (parts.length === 1) {
      // Settings for the engine and archives stay; the game's own settings file is kept as the player's choices.
      if (GAME_FILES.test(name) && name !== SFALL_DATA && name !== base.configFile) kept.push(item);
      else if (name === base.configFile) skipped++;
      else skipped++;
    } else if (GAME_FOLDERS.has(top) || top.endsWith('.dat')) kept.push(item);
    else skipped++;
  }
  if (desktop) notes.push(`${count(desktop, 'file')} only a desktop needs (programs, installers) ${desktop === 1 ? 'was' : 'were'} left out.`);
  if (recipeSkipped && recipe?.skips) notes.push(`Left out: ${recipe.skips.why} (${count(recipeSkipped, 'file')}).`);

  // Against the game it is played on: what is the same is used from there.
  const theirs = new Map(installed.manifest.files.map((file) => [pathKey(file.path), file]));
  const bySize = new Map<number, string[]>();
  for (const [key, file] of theirs) if (file.size >= 64 << 10) bySize.set(file.size, [...(bySize.get(file.size) ?? []), key]);
  const reuses: ReusedFile[] = [];
  const own: Item[] = [];
  let reusedBytes = 0;
  for (const item of kept) {
    const key = pathKey(item.path);
    const same = theirs.get(key);
    const candidates = same && same.size === item.file.size ? [key] : (bySize.get(item.file.size) ?? []).filter((other) => other !== key);
    let match: string | null = null;
    for (const other of candidates.slice(0, 4)) {
      const blob = await openInstalled(installed, theirs.get(other)!.path);
      if (item.file.size > LAZY_THRESHOLD) context.status?.(`Comparing ${item.path} with ${base.title} in deck ${base.deck}.`);
      if (blob && (await sameContents(item.file, blob, !!context.remote))) {
        match = other;
        break;
      }
    }
    if (match === null) {
      own.push(item);
    } else {
      const theirFile = theirs.get(match)!;
      reuses.push({ path: item.path, size: item.file.size, ...(match === key ? {} : { from: theirFile.path }) });
      reusedBytes += item.file.size;
    }
  }
  context.status?.('');

  if (!own.length) {
    throw new ImportError(
      found.complete
        ? `That is ${base.title} as it was sold: everything in it is the same as the ${base.title} in deck ${base.deck}. There is no mod in it.`
        : 'Nothing in that selection is a mod for the console to load.',
    );
  }
  if (reuses.length) {
    notes.push(`${count(reuses.length, 'file')} (${formatBytes(reusedBytes)}) the same as your ${base.title} in deck ${base.deck} ${reuses.length === 1 ? 'is' : 'are'} not stored again.`);
  }

  // Many small files into archives, for the engine of Fallout 2: mods kept as folders, archives kept as
  // folders, and the bulk of the data folder. (Fallout's engine reads only the archives of Fallout.)
  const entries: SourceFile[] = [];
  const hides = new Set(found.complete ? [] : (recipe?.hides ?? []));
  const keeps = found.complete ? [] : (recipe?.keeps ?? []);
  let patches: string | undefined;
  const musicDirs = gameDef(found.base).musicDirs;
  if (found.base === 'fo2') {
    const folders = new Map<string, { name: string; members: PackMember[] }>();
    const data: PackMember[] = [];
    const loose: Item[] = [];
    for (const item of own) {
      const key = pathKey(item.path);
      const parts = item.path.split('/');
      const folder = key.startsWith('mods/') && parts.length > 2 ? `mods/${parts[1]}` : parts.length > 1 && parts[0]!.toLowerCase().endsWith('.dat') ? parts[0]! : null;
      if (folder) {
        const entry = folders.get(folder.toLowerCase()) ?? { name: folder, members: [] };
        entry.members.push({ name: parts.slice(folder.split('/').length).join('/'), file: item.file });
        folders.set(folder.toLowerCase(), entry);
      } else if (key.startsWith('data/') && !key.startsWith('data/config/') && !PLAIN.test(key) && item.file.size < LAZY_THRESHOLD && !musicDirs.some((dir) => key.startsWith(`${dir}/`))) {
        data.push({ name: item.path.slice(5), file: item.file });
      } else {
        loose.push(item);
      }
    }
    try {
      for (const { name, members } of folders.values()) entries.push({ path: name, file: packDat2(members) });
      if (data.length >= PACK_FROM && data.reduce((sum, member) => sum + member.file.size, 0) < MAX_ARCHIVE_BYTES) {
        entries.push({ path: MOD_DATA, file: packDat2(data) });
        patches = MOD_DATA;
        // The game's own loose copies of these would stand above the archive: they are put aside.
        for (const member of data) {
          const key = `data/${pathKey(member.name)}`;
          if (theirs.has(key) && !found.complete) hides.add(key);
        }
      } else {
        loose.push(...data.map((member) => ({ path: `data/${member.name}`, file: member.file })));
      }
    } catch (err) {
      if (err instanceof RangeError) throw new ImportError(`That mod holds more than the engine can open as one archive.`);
      throw err;
    }
    entries.push(...loose.map(({ path, file }) => ({ path, file })));
  } else {
    entries.push(...own.map(({ path, file }) => ({ path, file })));
  }

  if (known?.caveat) warnings.push(known.caveat);
  if (!known) notes.push('The console does not know this mod by name: it is loaded as it is, and nobody has said how well it plays on this engine.');
  if (!found.complete && !entries.some((entry) => /\.(dat|int|msg|frm|map|pro)$/i.test(entry.path)) && !hides.size) {
    warnings.push(`Nothing in it looks like game data. Is it the mod itself, as it is unpacked into the ${base.title} folder?`);
  }

  const mod: ModInstall = {
    record,
    layout: 'over',
    ...(found.complete ? { reuses } : { hides: [...hides], keeps }),
    ...(patches ? { patches } : {}),
  };
  const dirs = new Set<string>();
  for (const { path } of [...entries, ...saves]) for (let dir = dirname(path); dir; dir = dirname(dir)) dirs.add(dir);
  entries.sort((a, b) => b.file.size - a.file.size);

  return {
    game: record.id,
    datFormat: base.datFormat,
    root: shownRoot,
    entries,
    dirs: [...dirs].sort(),
    totalBytes: entries.reduce((sum, entry) => sum + entry.file.size, 0),
    sourceFiles: own.length,
    skipped,
    saves,
    installConfig,
    language: installConfig ? Ini.parse(installConfig).get('system', 'language') : undefined,
    hasMusic: entries.some((entry) => entry.path.toLowerCase().endsWith('.acm')) || reuses.some((reuse) => reuse.path.toLowerCase().endsWith('.acm')),
    warnings,
    notes,
    also: [],
    mod,
  };
}

/** The version of a known mod, as the name of its zip or folder gives it. */
function versionOf(sources: SourceFile[], found: FoundMod, known: KnownMod | undefined): string | undefined {
  if (!known?.version) return undefined;
  // The zip it is downloaded as says it best; the folder an installer made is often named without it.
  const names = [...new Set(sources.map((source) => source.zip).filter((zip): zip is string => !!zip)), found.name];
  for (const name of names) {
    const match = known.version.exec(name);
    if (match?.[1]) return match[1].replace(/_/g, '.');
  }
  return undefined;
}

/** Whether a file picked on its own is a Windows installer, which the console cannot run. */
export function isInstaller(sources: SourceFile[]): boolean {
  return sources.length > 0 && sources.every((source) => /\.(exe|msi)$/i.test(source.path)) && sources.some((source) => source.file.size > 4 << 20);
}

/** Whether a file picked on its own is an archive the console cannot open. */
export function isOtherArchive(sources: SourceFile[]): string | null {
  const other = sources.find((source) => /\.(7z|rar|tar|gz|bz2|xz)$/i.test(source.path));
  return other && sources.length === 1 ? basename(other.path) : null;
}

/** The known mod whose installer this is, going by its name. */
export function installerOf(sources: SourceFile[]): KnownMod | undefined {
  const name = sources[0] ? basename(sources[0].path) : '';
  return KNOWN_MOD_IDS.map((id) => KNOWN_MODS[id]).find((mod) => mod.names.test(name));
}
