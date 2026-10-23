/**
 * The folder a game is started in: which stored file the engine finds at
 * which path.
 *
 * A game's own install is the whole of it. A mod is played over the game it
 * was made for, and this is where the two meet (see ModInstall): over that
 * game's files, less those the mod does without, as a mod installed into a
 * game folder is on a desktop; or in a folder of its own with the game's
 * archives in a folder below it, as Fallout Et Tu and Resurrection are.
 *
 * Add-ons switched on for a game or mod are laid over all of that (see
 * storage/addons.ts), the later over the earlier.
 *
 * The player puts exactly this in front of the engine, and the save editor
 * reads exactly this: what one sees, the other does.
 */
import { gameDef, type GameId } from '../games';
import { enabledMods } from './ettu';
import { basename, pathKey, type AddonInstall, type Manifest, type ManifestFile, type ModInstall } from './manifest';

export interface MountedFile {
  /** Where the engine finds it, below the game folder. */
  path: string;
  /** Whose install holds it: the game's (or mod's) own, the game a mod is played on, or an add-on laid over them. */
  from: 'own' | 'base' | 'addon';
  /** For an add-on's file: which add-on's. */
  addon?: string;
  file: ManifestFile;
}

export interface Mounted {
  /** By lower-cased path. */
  files: Map<string, MountedFile>;
  /** Every folder, including empty ones. */
  dirs: string[];
  /** For a mod: how it meets the game it is played on. */
  mod?: ModInstall;
  /** The add-ons laid over it, the one under the others first. */
  addons: AddonInstall[];
  /** Files of the game underneath that the mod was loaded with and that are not there any more. */
  missing: string[];
}

/** The archive Fallout Et Tu's own data folder was stored as before mods had a manifest of their own (see storage/ettu.ts). */
const ETTU_DATA = 'fallout1.dat';

/**
 * The folder, inside a nested mod's own, where the files of the game it runs
 * on are put. (On a desktop the mod sits inside that game's folder and reaches
 * up; here everything a game may touch is below its own folder.)
 */
export function baseFolder(base: GameId): string {
  return base;
}

/** How a mod meets the game it is played on, also for one loaded before that was written down. */
export function modInstall(game: GameId, own: Manifest): ModInstall | undefined {
  const def = gameDef(game);
  if (own.mod) return own.mod;
  if (!def?.mod) return undefined;
  // Fallout Et Tu as the console stored it before mods were more than one.
  const keys = new Set(own.files.map((file) => pathKey(file.path)));
  return {
    record: { id: game, known: def.mod.known, title: def.title, base: def.mod.base, donor: def.mod.donor },
    layout: 'nested',
    patches: keys.has(ETTU_DATA) ? ETTU_DATA : undefined,
  };
}

/**
 * Whether a path is one of those listed: a file by its path, a folder (ending
 * in '/') with all it holds, or files by a pattern whose '*' stands for any
 * name in one folder ("data/*.txt").
 */
export function listed(key: string, list: readonly string[] | undefined): boolean {
  return !!list?.some((entry) => {
    if (entry.includes('*')) {
      const pattern = entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
      return new RegExp(`^${pattern}${entry.endsWith('/') ? '' : '$'}`).test(key);
    }
    return entry.endsWith('/') ? key.startsWith(entry) : key === entry;
  });
}

/** The music of a game's install: what a nested mod is given of the game it runs on, besides its archives. */
function musicOf(manifest: Manifest, dirs: readonly string[]): string | null {
  for (const dir of dirs) {
    if (manifest.files.some((file) => pathKey(file.path).startsWith(`${dir}/`) && pathKey(file.path).endsWith('.acm'))) return dir;
  }
  return null;
}

/** Where the games keep their music, whichever game an add-on's music was made for. */
const MUSIC_DIRS = ['data/sound/music', 'sound/music'];

/**
 * Works out the folder `game` is started in, from its install, (for a mod)
 * that of the game it is played on, and those of the add-ons laid over it.
 */
export function mountGame(game: GameId, own: Manifest, base?: Manifest, addons: readonly Manifest[] = []): Mounted {
  const def = gameDef(game);
  const files = new Map<string, MountedFile>();
  const missing: string[] = [];
  // One spelling for each folder, the first one met: the engines find files without regard to case, and two
  // folders whose names differ only in case ("DATA" of the game, "data" of a mod) would hide each other's files.
  const spelled = new Map<string, string>();
  const folder = (dir: string): string => {
    const key = pathKey(dir);
    const known = spelled.get(key);
    if (known) return known;
    const slash = dir.lastIndexOf('/');
    const name = slash < 0 ? dir : `${folder(dir.slice(0, slash))}/${dir.slice(slash + 1)}`;
    spelled.set(key, name);
    return name;
  };
  const respell = (path: string): string => {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? path : `${folder(path.slice(0, slash))}/${path.slice(slash + 1)}`;
  };
  const put = (path: string, from: MountedFile['from'], file: ManifestFile, addon?: string) => {
    const shown = respell(path);
    files.set(pathKey(shown), { path: shown, from, file, ...(addon ? { addon } : {}) });
  };

  const mod = modInstall(game, own);
  if (mod && base) {
    const baseDef = gameDef(mod.record.base);
    // What the mod's own copies were identical to, where the mod has them.
    const reuse = (reuses: NonNullable<ModInstall['reuses']>) => {
      const byKey = new Map(base.files.map((file) => [pathKey(file.path), file]));
      for (const reused of reuses) {
        const file = byKey.get(pathKey(reused.from ?? reused.path));
        if (!file || file.size !== reused.size) {
          missing.push(reused.from ?? reused.path);
          continue;
        }
        put(reused.path, 'base', file);
      }
    };
    if (mod.layout === 'nested') {
      // The game's archives and its music, in a folder of their own.
      const under = baseFolder(mod.record.base);
      const music = musicOf(base, baseDef.musicDirs);
      for (const file of base.files) {
        const key = pathKey(file.path);
        if (key === 'master.dat' || key === 'critter.dat' || (music && key.startsWith(`${music}/`))) put(`${under}/${file.path}`, 'base', file);
      }
      if (mod.reuses) reuse(mod.reuses);
    } else if (mod.reuses) {
      // A complete game folder: only what its own copies were identical to.
      reuse(mod.reuses);
    } else {
      // Files to unpack into a game folder: the whole game, less what the mod does without.
      for (const file of base.files) {
        const key = pathKey(file.path);
        if (!listed(key, mod.hides) || listed(key, mod.keeps)) put(file.path, 'base', file);
      }
      for (const dir of base.dirs) folder(dir);
    }
  }

  // The game's own files, over whatever of the game underneath shares their paths.
  for (const file of own.files) put(file.path, 'own', file);
  for (const dir of own.dirs) folder(dir);

  // The add-ons, each over all that is under it. Their music goes where the game keeps its own; a settings file
  // at the top of the folder (sfall's ddraw.ini) only where the game has none.
  const laid: AddonInstall[] = [];
  const music = addons.length ? musicHome(files, def.musicDirs, mod?.layout === 'nested' ? baseFolder(mod.record.base) : null) : null;
  for (const addon of addons) {
    if (!addon.addon) continue;
    laid.push(addon.addon);
    for (const file of addon.files) {
      const key = pathKey(file.path);
      if (!key.includes('/') && files.has(key)) continue;
      const track = music && MUSIC_DIRS.some((dir) => key.startsWith(`${dir}/`)) && key.endsWith('.acm');
      put(track ? `${music}/${basename(file.path)}` : file.path, 'addon', file, addon.game);
    }
    for (const dir of addon.dirs) if (!music || !MUSIC_DIRS.includes(pathKey(dir))) folder(dir);
  }
  return { files, dirs: [...new Set(spelled.values())].sort(), mod, addons: laid, missing };
}

/** The folder a mounted game keeps its music in, as spelled: its own, else that of the game below a nested mod. */
function musicHome(files: Map<string, MountedFile>, dirs: readonly string[], under: string | null): string | null {
  const places = [...dirs, ...(under ? MUSIC_DIRS.map((dir) => `${under}/${dir}`) : [])];
  for (const dir of places) {
    for (const [key, { path }] of files) if (key.startsWith(`${dir}/`) && key.endsWith('.acm')) return path.slice(0, dir.length);
  }
  return null;
}

/**
 * The load order of Fallout 2's mods folder (mods/mods_order.txt) a game is
 * started with when add-ons are laid over it: its own as the engine would
 * read it, with each add-on's archives and folders after it, the later
 * add-on's last, which the engine reads above the rest. `text` is the game's
 * own, as the player left it or as it came; undefined where it has none, and
 * the engine would make one of the archives in its mods folder. Null when no
 * add-on adds to it.
 */
export function addonModsOrder(mounted: Mounted, text: string | undefined): string | null {
  const added = new Map<string, string>();
  for (const name of mounted.addons.flatMap((addon) => addon.order ?? [])) {
    added.delete(pathKey(name));
    added.set(pathKey(name), name);
  }
  if (!added.size) return null;
  const lines =
    text?.split(/\r?\n/) ??
    [...mounted.files.entries()]
      .filter(([key, file]) => /^mods\/[^/]+\.dat$/.test(key) && file.from !== 'addon')
      .map(([, file]) => basename(file.path))
      .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  // An add-on's archive that the game names as well is the add-on's now, read where the add-on's are.
  const kept = lines.filter((line) => {
    const named = pathKey(line.replace(/[;#].*$/, '').trim() || line.replace(/^[\s;#]+/, '').trim());
    return !added.has(named);
  });
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();
  return `${[...kept, ...added.values()].join('\r\n')}\r\n`;
}

/** The parts of the load order the engine opens, as `addonModsOrder` would have it where add-ons add any. */
export function openedMods(mounted: Mounted, text: string | undefined): string[] {
  return enabledMods(addonModsOrder(mounted, text) ?? text ?? '');
}

/** The music folder of a mounted game, as the settings file wants it ("sound\\music\\"), or null when it has no music. */
export function mountedMusic(mounted: Mounted, dirs: readonly string[], prefix = ''): string | null {
  for (const dir of dirs) {
    const at = prefix ? `${prefix}/${dir}/` : `${dir}/`;
    for (const key of mounted.files.keys()) {
      if (key.startsWith(at) && key.endsWith('.acm')) return `${(prefix ? `${prefix}/${dir}` : dir).replace(/\//g, '\\')}\\`;
    }
  }
  return null;
}
