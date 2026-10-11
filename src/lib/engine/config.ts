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
import { pathKey, type Manifest } from '../storage/manifest';

export interface ScreenSize {
  width: number;
  height: number;
}

export const CLASSIC_SCREEN: ScreenSize = { width: 640, height: 480 };

/** Widest picture the engines are asked to render in "wide" mode. */
const MAX_WIDE_WIDTH = 1280;

/**
 * Picks the game's resolution for "wide" mode: as tall as the original, so
 * everything keeps its size, and as wide as the shape of the window allows.
 * The extra width shows more of the map.
 */
export function wideScreen(viewportWidth: number, viewportHeight: number): ScreenSize {
  const aspect = viewportHeight > 0 ? viewportWidth / viewportHeight : 4 / 3;
  // Even widths keep the interface bar centred on a pixel boundary.
  const width = Math.round((CLASSIC_SCREEN.height * aspect) / 2) * 2;
  return {
    width: Math.min(MAX_WIDE_WIDTH, Math.max(CLASSIC_SCREEN.width, width)),
    height: CLASSIC_SCREEN.height,
  };
}

/** The folder holding the music, in the form the settings file wants it. */
export function musicPath(game: GameId, manifest: Manifest): string {
  const def = GAMES[game];
  for (const dir of def.musicDirs) {
    if (manifest.files.some((f) => pathKey(f.path).startsWith(`${dir}/`) && f.path.toLowerCase().endsWith('.acm'))) {
      return `${dir.replace(/\//g, '\\')}\\`;
    }
  }
  return `${def.musicDirs[0]!.replace(/\//g, '\\')}\\`;
}

export interface ConfigInputs {
  game: GameId;
  manifest: Manifest;
  /** The settings file as the engine last saved it, if it ever did. */
  savedConfig?: string;
  screen: ScreenSize;
  skipIntro: boolean;
}

/** Settings files to place in the game folder, by name. */
export function buildConfigFiles({ game, manifest, savedConfig, screen, skipIntro }: ConfigInputs): Record<string, string> {
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

  if (game === 'fo2') {
    ini.set('screen', 'resolution_x', screen.width);
    ini.set('screen', 'resolution_y', screen.height);
    ini.set('screen', 'scale', 1);
    ini.set('screen', 'windowed', 1);
    // The pointer belongs to the browser; the game reads its position.
    ini.set('screen', 'mouse_lock', 0);
    ini.set('ui', 'skip_opening_movies', skipIntro ? 1 : 0);
    return { [def.configFile]: ini.toString() };
  }

  ini.set('system', 'skip_opening_movies', skipIntro ? 1 : 0);

  const resolution = new Ini();
  resolution.set('MAIN', 'SCR_WIDTH', screen.width);
  resolution.set('MAIN', 'SCR_HEIGHT', screen.height);
  resolution.set('MAIN', 'WINDOWED', 1);
  resolution.set('MAIN', 'SCALE_2X', 0);
  return { [def.configFile]: ini.toString(), 'f1_res.ini': resolution.toString() };
}
