/** Console preferences, kept in localStorage. */

const KEY = 'overseer-console:settings';

export interface Settings {
  /**
   * classic: the original 640x480 picture, scaled up.
   * wide: the game renders at the shape of the window, showing more map.
   */
  display: 'classic' | 'wide';
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

export const DEFAULT_SETTINGS: Settings = {
  display: 'classic',
  scaling: 'fill',
  fullscreen: false,
  skipIntro: false,
  crt: true,
  sound: true,
  vault: true,
  cacheMb: 192,
  audio: 'buffered',
  touchPointer: 'direct',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Guard against values from an older or hand-edited entry.
    if (merged.display !== 'classic' && merged.display !== 'wide') merged.display = DEFAULT_SETTINGS.display;
    if (!['fill', 'integer', 'smooth'].includes(merged.scaling)) merged.scaling = DEFAULT_SETTINGS.scaling;
    if (merged.audio !== 'buffered' && merged.audio !== 'direct') merged.audio = DEFAULT_SETTINGS.audio;
    if (merged.touchPointer !== 'direct' && merged.touchPointer !== 'trackpad') merged.touchPointer = DEFAULT_SETTINGS.touchPointer;
    if (!Number.isFinite(merged.cacheMb)) merged.cacheMb = DEFAULT_SETTINGS.cacheMb;
    merged.cacheMb = Math.min(1024, Math.max(32, Math.round(merged.cacheMb)));
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
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
