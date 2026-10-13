/** Console preferences, kept in localStorage. */
import { GAME_IDS, type GameId } from './games';

const KEY = 'overseer-console:settings';

/**
 * classic: the original 640x480 picture, scaled up.
 * wide: the game renders at the shape of the window, showing more map.
 * high: wider and taller (720 lines), showing far more map, smaller.
 */
export type Picture = 'classic' | 'wide' | 'high';

/** The pictures a game can be played at, in the order the console steps through them. */
export const PICTURES: readonly Picture[] = ['classic', 'wide', 'high'];

export interface Settings {
  /** The picture each game is played at: every deck has its own. */
  picture: Record<GameId, Picture>;
  /**
   * fill: as large as the window allows, hard-edged pixels.
   * integer: whole-number zoom only; every pixel the same size, possibly
   *   with a border around the picture.
   * smooth: as large as the window allows, pixels blended.
   */
  scaling: 'fill' | 'integer' | 'smooth';
  /** Ask for fullscreen when a game starts. */
  fullscreen: boolean;
  /** Go straight to the game's main menu instead of playing its intro movies. */
  skipIntro: boolean;
  /**
   * Fallout 2 with what its engine adds to the original (items lit up on a
   * key, a wider inventory, doors that open as you walk into them...), or as
   * the original played. The other games are not changed by it.
   */
  improvements: boolean;
  /** How many times as fast as normal a game runs while fast forward is on. */
  fastForward: number;
  /** Scanlines, glow and flicker on the console itself. */
  crt: boolean;
  /** Key clicks and beeps on the console itself. */
  sound: boolean;
  /**
   * The abandoned vault around the console, where the window is large enough
   * to show any of it, and what comes out of it onto the console's own glass.
   */
  vault: boolean;
  /** Megabytes of game data kept in memory once read. */
  cacheMb: number;
  /**
   * buffered: sound is queued a fraction of a second ahead and played from
   *   its own thread, which rides out hiccups of the page.
   * direct: the engine feeds the sound card itself; lowest delay.
   */
  audio: 'buffered' | 'direct';
  /**
   * Touch screens only.
   * direct: the pointer goes where the finger is.
   * trackpad: the picture works like a laptop's trackpad.
   */
  touchPointer: 'direct' | 'trackpad';
}

/** The speeds fast forward can be set to. */
export const FAST_FORWARD_SPEEDS = [2, 3, 4];

const isPicture = (value: unknown): value is Picture => PICTURES.includes(value as Picture);

/** The same picture for every game. */
const everyGame = (picture: Picture): Record<GameId, Picture> =>
  Object.fromEntries(GAME_IDS.map((game) => [game, picture])) as Record<GameId, Picture>;

/** Where the one picture for all games stood until a player moved it, while there was only that one. */
const ONE_FOR_ALL: Picture = 'classic';

export const DEFAULT_SETTINGS: Settings = {
  // The two originals start at the picture they were drawn for, Fallout Et Tu at the one it is laid out for.
  picture: { ...everyGame('classic'), ettu: 'high' },
  scaling: 'fill',
  fullscreen: false,
  skipIntro: false,
  improvements: true,
  fastForward: 3,
  crt: true,
  sound: true,
  vault: true,
  cacheMb: 192,
  audio: 'buffered',
  touchPointer: 'direct',
};

const defaults = (): Settings => ({ ...DEFAULT_SETTINGS, picture: { ...DEFAULT_SETTINGS.picture } });

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    // Until the picture became each game's own there was one for all of them, kept as `display`.
    const { display, ...parsed } = JSON.parse(raw) as Partial<Settings> & { display?: unknown };
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Guard against values from an older or hand-edited entry.
    // A picture the player had chosen for all games is each game's now, so that nothing changes unasked.
    // The original picture is where that setting stood untouched, and is not taken for a choice: each
    // game then starts as it does for a new player.
    const before = isPicture(display) && display !== ONE_FOR_ALL ? everyGame(display) : DEFAULT_SETTINGS.picture;
    const chosen = (parsed.picture && typeof parsed.picture === 'object' ? parsed.picture : {}) as Partial<Record<GameId, unknown>>;
    merged.picture = { ...before };
    for (const game of GAME_IDS) {
      if (isPicture(chosen[game])) merged.picture[game] = chosen[game];
    }
    if (!['fill', 'integer', 'smooth'].includes(merged.scaling)) merged.scaling = DEFAULT_SETTINGS.scaling;
    if (merged.audio !== 'buffered' && merged.audio !== 'direct') merged.audio = DEFAULT_SETTINGS.audio;
    if (merged.touchPointer !== 'direct' && merged.touchPointer !== 'trackpad') merged.touchPointer = DEFAULT_SETTINGS.touchPointer;
    if (!FAST_FORWARD_SPEEDS.includes(merged.fastForward)) merged.fastForward = DEFAULT_SETTINGS.fastForward;
    if (typeof merged.improvements !== 'boolean') merged.improvements = DEFAULT_SETTINGS.improvements;
    if (!Number.isFinite(merged.cacheMb)) merged.cacheMb = DEFAULT_SETTINGS.cacheMb;
    merged.cacheMb = Math.min(1024, Math.max(32, Math.round(merged.cacheMb)));
    return merged;
  } catch {
    return defaults();
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private windows may refuse storage; the settings still apply to this page.
  }
}

/** Small per-game facts the console shows (last played and so on). */
export interface GameStats {
  lastPlayed?: number;
  launches?: number;
}

export function loadGameStats(game: string): GameStats {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}:stats:${game}`) ?? '{}') as GameStats;
  } catch {
    return {};
  }
}

export function recordLaunch(game: string): void {
  const stats = loadGameStats(game);
  stats.lastPlayed = Date.now();
  stats.launches = (stats.launches ?? 0) + 1;
  try {
    localStorage.setItem(`${KEY}:stats:${game}`, JSON.stringify(stats));
  } catch {
    // See saveSettings.
  }
}

/** How many radroaches have met their end on this console. */
export function loadSquashed(): number {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(`${KEY}:squashed`)) || 0));
  } catch {
    return 0;
  }
}

export function saveSquashed(count: number): void {
  try {
    localStorage.setItem(`${KEY}:squashed`, String(count));
  } catch {
    // See saveSettings.
  }
}
