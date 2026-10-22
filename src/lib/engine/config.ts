/**
 * Builds the settings files a game starts with.
 *
 * The player's own choices (difficulty, volumes, combat speed...) live in the
 * engine's settings file, which the engine rewrites and the console keeps.
 * A handful of keys describe the machine rather than the player - where the
 * archives are, how large the screen is - and those are set here on every
 * launch.
 */
import { gameDef, type GameId } from '../games';
import { Ini } from '../ini';
import type { Picture } from '../settings';
import { pathKey, type Manifest } from '../storage/manifest';
import { baseFolder, mountGame, mountedMusic, type Mounted } from '../storage/mount';

export interface ScreenSize {
  width: number;
  height: number;
}

export const CLASSIC_SCREEN: ScreenSize = { width: 640, height: 480 };

/** Lines of the "high resolution" picture: one and a half times the original's. */
const HIGH_HEIGHT = 720;

/** Widest picture the engines are asked to render. */
const MAX_WIDTH = 1280;

/** A picture `height` lines tall and as wide as the shape of the window allows, no narrower than 4:3. */
function shaped(height: number, viewportWidth: number, viewportHeight: number): ScreenSize {
  const aspect = viewportHeight > 0 ? viewportWidth / viewportHeight : 4 / 3;
  // Even widths keep the interface bar centred on a pixel boundary.
  const width = Math.round((height * aspect) / 2) * 2;
  return { width: Math.min(MAX_WIDTH, Math.max(Math.round((height * 4) / 3), width)), height };
}

/**
 * Picks the game's resolution for "wide" mode: as tall as the original, so
 * everything keeps its size, and as wide as the shape of the window allows.
 * The extra width shows more of the map.
 */
export function wideScreen(viewportWidth: number, viewportHeight: number): ScreenSize {
  return shaped(CLASSIC_SCREEN.height, viewportWidth, viewportHeight);
}

/**
 * "High resolution": taller as well as wider, so far more of the map is on
 * screen and everything on it is smaller. 1280 x 720 in a window of the
 * usual shape, which is what Fallout Et Tu is laid out for.
 */
export function highScreen(viewportWidth: number, viewportHeight: number): ScreenSize {
  return shaped(HIGH_HEIGHT, viewportWidth, viewportHeight);
}

/** The resolution a game is started at. */
export function chooseScreen(picture: Picture, viewport: { width: number; height: number }): ScreenSize {
  if (picture === 'classic') return CLASSIC_SCREEN;
  return picture === 'high' ? highScreen(viewport.width, viewport.height) : wideScreen(viewport.width, viewport.height);
}

/**
 * What the engine of Fallout 2 adds to the game, for whoever wants it: the
 * setting, its value with the console's improvements switched on, and the
 * value the engine itself starts with. Both are written, since the engine
 * keeps what it was last told.
 *
 * Left out on purpose: quick saves that rotate through the first slots
 * without asking (they would replace saves made by hand), and faster
 * interface animations (fast forward does that, when asked).
 */
const IMPROVEMENTS: readonly (readonly [section: string, key: string, improved: number, original: number])[] = [
  // A second column in the inventory, and companions' own inventories when looting.
  ['ui', 'inventory_columns', 2, 1],
  // Room for 16 action points on the interface bar.
  ['ui', 'extend_ap_bar', 1, 0],
  // A fourth row in the barter screen, where the picture is tall enough for it.
  ['ui', 'expand_barter_window', 1, 0],
  // An ammunition meter that shows how many bursts are left.
  ['ui', 'alternate_ammo_meter', 1, 0],
  // The weight of what is carried and of what is lying in a container, with its size.
  ['ui', 'loot_weight_indicator', 3, 1],
  // What a damage perk adds, shown with the weapon.
  ['ui', 'display_bonus_damage', 1, 0],
  // Doors that are neither locked nor special open as you walk into them.
  ['qol', 'auto_open_doors', 1, 0],
  // Trade and loot through a companion's own inventory.
  ['qol', 'party_loot_and_barter', 1, 0],
  // Asked to run while sneaking, walk on instead of standing up.
  ['qol', 'walk_when_sneaking', 1, 0],
];

/** Where the engine's own script for lighting things up looks for its settings. */
export const HIGHLIGHTING_FILE = 'mods/sfall-mods.ini';

/**
 * The key that lights things up, as that script numbers keys (the codes the
 * original game read from the keyboard, where 42 is the left SHIFT key).
 * It belongs to the console rather than to any one game: all three answer to
 * the same key, and the touch deck's HILITE switch holds it down for the
 * script (see `holdScriptKey`).
 */
export const HIGHLIGHT_KEY = 42;

/**
 * Whether a mod's sfall settings (ddraw.ini) have Fallout's engine light up
 * what lies on the ground at the console's key: Fallout Fixt's do. (Fallout
 * 2's engine does it with a script of its own, at any game.)
 */
export function sfallLightsAtKey(ddraw: string | undefined): boolean {
  const key = ddraw === undefined ? undefined : Ini.parse(ddraw).get('Input', 'ToggleItemHighlightsKey');
  // A DirectInput scan code, decimal or hexadecimal, as sfall reads it.
  return key !== undefined && Number(key) === HIGHLIGHT_KEY;
}

/**
 * What holding the key does: light up the items, containers and bodies lying
 * on the ground, wherever they are in the picture.
 *
 * The script's own line-of-sight test is off (CheckLOS=0). With it on - which
 * is what the script and Fallout Et Tu both ship - nothing is lit that the
 * player could not shoot at, and since what is worth finding is nearly always
 * inside a building the key appears to do nothing at all. Containers and
 * bodies are on for the same reason; critters are left to the games, which
 * light them up themselves in combat.
 */
const HIGHLIGHTING = [
  '[Highlighting]',
  `Key=${HIGHLIGHT_KEY}`,
  'Containers=1',
  'Corpses=1',
  'Critters=0',
  'CheckLOS=0',
  'OutlineColor=16',
  'OutlineColorContainers=32',
  'OutlineColorContainersEmpty=4',
  'OutlineColorCorpses=32',
  'OutlineColorCorpsesEmpty=4',
  'MotionScanner=0',
  '',
].join('\r\n');

/**
 * Puts the console's own [Highlighting] into a settings file the game brought
 * itself, and leaves every other section of it alone, comments and all: what
 * the console's key does is the console's to say, the rest of the file is the
 * game's. (Fallout Et Tu ships this file with the left CTRL key and with
 * containers and bodies switched off; a mod may bring anything.) Null when
 * the file already says what the console would say.
 */
export function withHighlighting(text: string): string | null {
  const header = /^[ \t]*\[Highlighting\][ \t]*$/im.exec(text);
  // No such section: the console's own, after what the file already says.
  if (!header) return `${text.replace(/\s*$/, '')}\r\n\r\n${HIGHLIGHTING}`;

  // The section runs from its header to the next one, or to the end of the file.
  const rest = text.slice(header.index + header[0].length);
  const length = /^[ \t]*\[/m.exec(rest)?.index ?? rest.length;
  const replaced = text.slice(0, header.index) + HIGHLIGHTING + rest.slice(length);
  return replaced === text ? null : replaced;
}

/** Whether a game is started with the engine's own data file beside it. */
export function wantsEngineData(game: GameId, improvements: boolean): boolean {
  const when = gameDef(game).engineData;
  return when === 'always' || (when === 'improved' && improvements);
}

const backslashes = (path: string): string => path.replace(/\//g, '\\');

/** The folders of a mounted game that hold music, in the order the game looks in them, as the settings file wants them. */
function musicFolders(game: GameId, mounted: Mounted): string[] {
  const found: string[] = [];
  for (const dir of gameDef(game).musicDirs) {
    const folder = mountedMusic(mounted, [dir]);
    if (folder) found.push(folder);
  }
  return found;
}

/** The folder holding the music, in the form the settings file wants it. */
export function musicPath(game: GameId, manifest: Manifest, base?: Manifest): string {
  return musicFolders(game, mountGame(game, manifest, base))[0] ?? `${backslashes(gameDef(game).musicDirs[0]!)}\\`;
}

export interface ConfigInputs {
  game: GameId;
  manifest: Manifest;
  /** For a mod: what is installed of the game it is played on. */
  base?: Manifest;
  /** The settings file as the engine last saved it, if it ever did. */
  savedConfig?: string;
  screen: ScreenSize;
  skipIntro: boolean;
  /** The console's improvements are switched on (see Settings). */
  improvements?: boolean;
  /** The settings the game brought for the engine's own scripts, if it brought any. */
  installMods?: string;
  /** The settings file the engine reads, where the game's sfall settings name another than its own (see settingsFileOf). */
  configFile?: string;
  /** The settings the game brought for the high resolution patch (f2_res.ini), if it brought any. */
  highRes?: string;
}

/**
 * The settings file the engine of Fallout 2 reads: its own, unless the
 * game's sfall settings (ddraw.ini) name another, as Olympus 2207 does with
 * olympus.cfg. The engine reads that one instead, so that is the one the
 * console writes. Only a file in the game folder is taken.
 */
export function settingsFileOf(game: GameId, ddraw: string | undefined): string {
  const def = gameDef(game);
  if (def.engine.id !== 'fo2' || ddraw === undefined) return def.configFile;
  const named = Ini.parse(ddraw).get('Misc', 'ConfigFile')?.trim().replace(/\\/g, '/');
  return named && /^[\w .-]+\.cfg$/i.test(named) ? named : def.configFile;
}

/** A path a game's settings give, when it names an archive (or a folder) the mounted game holds. */
function mountedArchive(value: string | undefined, mounted: Mounted): string | null {
  const path = value?.trim().replace(/\\/g, '/').replace(/^(\.\/)+|\/+$/g, '');
  if (!path || path.startsWith('..') || path.includes(':')) return null;
  const wanted = pathKey(path);
  return mounted.files.has(wanted) || mounted.dirs.some((dir) => pathKey(dir) === wanted) ? backslashes(path) : null;
}

/**
 * Where a mod's own settings file says one of its archives is, when that is
 * an archive (or a folder) the mounted game holds. Its files may be named
 * otherwise than the games' own.
 */
function ownArchive(config: Ini, key: string, mounted: Mounted): string | null {
  return mountedArchive(config.get('system', key), mounted);
}

/**
 * The engine's second patch location and the high resolution patch's art,
 * where a game keeps them under names of its own: what the settings file is
 * given, and what the save editor reads the same chain from (gamedata.ts).
 * Null where the engine's own names stand.
 */
export function namedArchives(mounted: Mounted, installConfig: string | undefined, highRes: string | undefined): { patches: string | null; art: string | null } {
  const mod = mounted.mod;
  // A mod's settings may name an archive of its own, as Resurrection does for its new critters.
  let patches = mod && installConfig ? ownArchive(Ini.parse(installConfig), 'critter_patches', mounted) : null;
  // The second patch location is free to be an archive: the bulk of a mod's data folder (see storage/mods.ts).
  if (mod?.patches && mounted.files.has(pathKey(mod.patches))) patches = mod.patches;
  // The art of the high resolution patch, where the game's settings for that patch put it (the Restoration
  // Project keeps its own in mods/, Resurrection all of itself in fores.dat).
  const art = highRes === undefined ? null : mountedArchive(Ini.parse(highRes).get('MAIN', 'f2_res_dat'), mounted);
  return { patches, art };
}

/** Settings files to place in the game folder, by name. */
export function buildConfigFiles({
  game,
  manifest,
  base,
  savedConfig,
  screen,
  skipIntro,
  improvements = false,
  installMods,
  configFile,
  highRes,
}: ConfigInputs): Record<string, string> {
  const def = gameDef(game);
  const settingsFile = configFile ?? def.configFile;
  const mounted = mountGame(game, manifest, base);
  const mod = mounted.mod;
  // The player's choices: as the engine last saved them, else as the game came. A mod
  // unpacked into a game folder keeps that game's settings file when it brings none.
  const shipped = manifest.installConfig ?? (mod?.layout === 'over' ? base?.installConfig : undefined);
  const ini = Ini.parse(savedConfig ?? shipped ?? '');
  const music = musicFolders(game, mounted);
  const fallback = `${backslashes(def.musicDirs[0]!)}\\`;

  ini.set('system', 'master_dat', 'master.dat');
  ini.set('system', 'critter_dat', 'critter.dat');
  ini.set('system', 'master_patches', 'data');
  ini.set('system', 'critter_patches', 'data');
  ini.setDefault('system', 'language', 'english');
  ini.set('sound', 'music_path1', music[0] ?? fallback);
  ini.set('sound', 'music_path2', music[1] ?? music[0] ?? fallback);

  if (mod?.layout === 'nested') {
    // The archives of the game underneath, and its music after the mod's own.
    const folder = baseFolder(mod.record.base);
    ini.set('system', 'master_dat', `${folder}\\master.dat`);
    ini.set('system', 'critter_dat', `${folder}\\critter.dat`);
    const theirs = mountedMusic(mounted, gameDef(mod.record.base).musicDirs, folder);
    if (theirs) {
      ini.set('sound', 'music_path1', music[0] ?? theirs);
      ini.set('sound', 'music_path2', theirs);
    }
  } else if (mod && manifest.installConfig) {
    // A mod may name its archives otherwise than the games do.
    const config = Ini.parse(manifest.installConfig);
    for (const key of ['master_dat', 'critter_dat']) {
      const path = ownArchive(config, key, mounted);
      if (path) ini.set('system', key, path);
    }
  }
  const named = namedArchives(mounted, manifest.installConfig, highRes);
  if (named.patches) ini.set('system', 'critter_patches', named.patches);

  if (def.engine.id === 'fo2') {
    ini.set('screen', 'resolution_x', screen.width);
    ini.set('screen', 'resolution_y', screen.height);
    ini.set('screen', 'scale', 1);
    ini.set('screen', 'windowed', 1);
    // The pointer belongs to the browser; the game reads its position.
    ini.set('screen', 'mouse_lock', 0);
    ini.set('ui', 'skip_opening_movies', skipIntro ? 1 : 0);
    // The engine takes the high resolution patch's settings over only when no picture size is set.
    if (named.art) ini.set('system', 'f2_res_dat', named.art);

    // A game that was made with the engine's additions brings its own choice of them.
    const files: Record<string, string> = {};
    if (def.engineData === 'improved') {
      for (const [section, key, improved, original] of IMPROVEMENTS) ini.set(section, key, improvements ? improved : original);
    }
    // Lighting things up comes with the engine's own script, wherever that is
    // loaded. Other settings a game or a mod brought for it stand.
    if (wantsEngineData(game, improvements)) {
      const settings = installMods === undefined ? HIGHLIGHTING : withHighlighting(installMods);
      if (settings !== null) files[HIGHLIGHTING_FILE] = settings;
    }
    return { [settingsFile]: ini.toString(), ...files };
  }

  ini.set('system', 'skip_opening_movies', skipIntro ? 1 : 0);

  const resolution = new Ini();
  resolution.set('MAIN', 'SCR_WIDTH', screen.width);
  resolution.set('MAIN', 'SCR_HEIGHT', screen.height);
  resolution.set('MAIN', 'WINDOWED', 1);
  resolution.set('MAIN', 'SCALE_2X', 0);
  return { [settingsFile]: ini.toString(), 'f1_res.ini': resolution.toString() };
}
