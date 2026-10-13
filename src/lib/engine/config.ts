/**
 * Builds the settings files a game starts with.
 *
 * The player's own choices (difficulty, volumes, combat speed...) live in the
 * engine's settings file, which the engine rewrites and the console keeps.
 * A handful of keys describe the machine rather than the player - where the
 * archives are, how large the screen is - and those are set here on every
 * launch.
 */
import { GAMES, type GameId } from '../games';
import { Ini } from '../ini';
import type { Picture } from '../settings';
import { BORROWED_ARCHIVE } from '../storage/ettu';
import { pathKey, type Manifest } from '../storage/manifest';

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
const HIGHLIGHTING_FILE = 'mods/sfall-mods.ini';

/**
 * Hold the left SHIFT key to light up what lies on the ground: items,
 * containers and bodies within sight. The values are those the script's
 * authors ship, with containers and bodies switched on.
 */
const HIGHLIGHTING = [
  '[Highlighting]',
  'Key=42',
  'Containers=1',
  'Corpses=1',
  'Critters=0',
  'CheckLOS=1',
  'OutlineColor=16',
  'OutlineColorContainers=32',
  'OutlineColorContainersEmpty=4',
  'OutlineColorCorpses=32',
  'OutlineColorCorpsesEmpty=4',
  'MotionScanner=0',
  '',
].join('\r\n');

/** Whether a game is started with the engine's own data file beside it. */
export function wantsEngineData(game: GameId, improvements: boolean): boolean {
  const when = GAMES[game].engineData;
  return when === 'always' || (when === 'improved' && improvements);
}

const backslashes = (path: string): string => path.replace(/\//g, '\\');

/** The folder holding the music, in the form the settings file wants it. */
export function musicPath(game: GameId, manifest: Manifest): string {
  const def = GAMES[game];
  for (const dir of def.musicDirs) {
    if (manifest.files.some((f) => pathKey(f.path).startsWith(`${dir}/`) && f.path.toLowerCase().endsWith('.acm'))) {
      return `${backslashes(dir)}\\`;
    }
  }
  return `${backslashes(def.musicDirs[0]!)}\\`;
}

/**
 * The folder, inside a conversion's own, where the files of the game it runs
 * on are put. (On a desktop the conversion sits inside that game's folder
 * and reaches up; here everything a game may touch is below its own folder.)
 */
export function baseFolder(base: GameId): string {
  return base;
}

/** The files of the game underneath that a conversion is started with: its archives and its music. */
export function baseFiles(base: GameId, manifest: Manifest): string[] {
  const music = pathKey(musicPath(base, manifest));
  return manifest.files
    .map((file) => file.path)
    .filter((path) => {
      const key = pathKey(path);
      return key === 'master.dat' || key === 'critter.dat' || key.startsWith(`${music}/`);
    });
}

export interface ConfigInputs {
  game: GameId;
  manifest: Manifest;
  /** For a conversion: what is installed of the game it runs on. */
  base?: Manifest;
  /** The settings file as the engine last saved it, if it ever did. */
  savedConfig?: string;
  screen: ScreenSize;
  skipIntro: boolean;
  /** The console's improvements are switched on (see Settings). */
  improvements?: boolean;
}

/** Settings files to place in the game folder, by name. */
export function buildConfigFiles({ game, manifest, base, savedConfig, screen, skipIntro, improvements = false }: ConfigInputs): Record<string, string> {
  const def = GAMES[game];
  const ini = Ini.parse(savedConfig ?? manifest.installConfig ?? '');
  const music = musicPath(game, manifest);

  ini.set('system', 'master_dat', 'master.dat');
  ini.set('system', 'critter_dat', 'critter.dat');
  ini.set('system', 'master_patches', 'data');
  ini.set('system', 'critter_patches', 'data');
  ini.setDefault('system', 'language', 'english');
  ini.set('sound', 'music_path1', music);
  ini.set('sound', 'music_path2', music);

  if (def.conversion && base) {
    // The archives of the game underneath, and its music where the conversion has none of its own.
    const folder = baseFolder(def.conversion.base);
    ini.set('system', 'master_dat', `${folder}\\master.dat`);
    ini.set('system', 'critter_dat', `${folder}\\critter.dat`);
    ini.set('sound', 'music_path2', `${folder}\\${musicPath(def.conversion.base, base)}`);
    // The second patch location is free to be an archive: see storage/ettu.ts.
    if (manifest.files.some((file) => pathKey(file.path) === BORROWED_ARCHIVE)) ini.set('system', 'critter_patches', BORROWED_ARCHIVE);
  }

  if (def.engine.id === 'fo2') {
    ini.set('screen', 'resolution_x', screen.width);
    ini.set('screen', 'resolution_y', screen.height);
    ini.set('screen', 'scale', 1);
    ini.set('screen', 'windowed', 1);
    // The pointer belongs to the browser; the game reads its position.
    ini.set('screen', 'mouse_lock', 0);
    ini.set('ui', 'skip_opening_movies', skipIntro ? 1 : 0);

    // A game that was made with the engine's additions brings its own choice of them.
    const files: Record<string, string> = {};
    if (def.engineData === 'improved') {
      for (const [section, key, improved, original] of IMPROVEMENTS) ini.set(section, key, improvements ? improved : original);
      // Mods the player installed may bring settings of their own for this: theirs stand.
      if (improvements && !manifest.files.some((file) => pathKey(file.path) === HIGHLIGHTING_FILE)) files[HIGHLIGHTING_FILE] = HIGHLIGHTING;
    }
    return { [def.configFile]: ini.toString(), ...files };
  }

  ini.set('system', 'skip_opening_movies', skipIntro ? 1 : 0);

  const resolution = new Ini();
  resolution.set('MAIN', 'SCR_WIDTH', screen.width);
  resolution.set('MAIN', 'SCR_HEIGHT', screen.height);
  resolution.set('MAIN', 'WINDOWED', 1);
  resolution.set('MAIN', 'SCALE_2X', 0);
  return { [def.configFile]: ini.toString(), 'f1_res.ini': resolution.toString() };
}
