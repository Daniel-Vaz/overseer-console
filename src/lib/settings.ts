/** Console preferences, kept in localStorage. */
import { AUTOSAVE_MINUTES } from './autosave';
import { GAMES, isBaseGame, type BaseGameId, type GameId } from './games';
import { KNOWN_MODS } from './mods/catalog';

const KEY = 'overseer-console:settings';

/**
 * classic: the original 640x480 picture, scaled up.
 * wide: the game renders at the shape of the window, showing more map.
 * high: wider and taller (720 lines), showing far more map, smaller.
 */
export type Picture = 'classic' | 'wide' | 'high';

/** The pictures a game can be played at, in the order the console steps through them. */
export const PICTURES: readonly Picture[] = ['classic', 'wide', 'high'];

/** How many lines tall each picture is (see engine/config.ts). */
const PICTURE_LINES: Record<Picture, number> = { classic: 480, wide: 480, high: 720 };

export interface Settings {
  /**
   * The picture each game is played at, where the player chose one: every
   * game and every mod has its own. See pictureOf.
   */
  picture: Record<GameId, Picture>;
  /** The mod each deck plays, by the game in it. Without one, the game as it was sold. */
  decks: Partial<Record<BaseGameId, GameId>>;
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
  /** Minutes of play between autosaves, in the last three save slots. 0: none. */
  autosave: number;
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

/** The games there were while there was one picture for all of them: Fallout Et Tu had a deck of its own then. */
const ONE_PICTURE_GAMES = ['fo1', 'fo2', 'ettu'] as const;

/** The same picture for every game there was. */
const everyGame = (picture: Picture): Record<GameId, Picture> => Object.fromEntries(ONE_PICTURE_GAMES.map((game) => [game, picture]));

/** Where the one picture for all games stood until a player moved it, while there was only that one. */
const ONE_FOR_ALL: Picture = 'classic';

/** What an id of a game looks like (see games.ts), for values read back from storage. */
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const DEFAULT_SETTINGS: Settings = {
  // Nothing chosen: every game starts at the picture it was made for (see pictureOf).
  picture: {},
  decks: {},
  scaling: 'fill',
  fullscreen: false,
  skipIntro: false,
  improvements: true,
  fastForward: 3,
  autosave: 10,
  crt: true,
  sound: true,
  vault: true,
  cacheMb: 192,
  audio: 'buffered',
  touchPointer: 'direct',
};

const defaults = (): Settings => ({ ...DEFAULT_SETTINGS, picture: { ...DEFAULT_SETTINGS.picture }, decks: { ...DEFAULT_SETTINGS.decks } });

/** The pictures a game can be played at: those tall enough for it. */
export function picturesFor(game: GameId): readonly Picture[] {
  const least = GAMES[game]?.mod?.minHeight ?? 0;
  const fit = PICTURES.filter((picture) => PICTURE_LINES[picture] >= least);
  return fit.length ? fit : PICTURES;
}

/**
 * The picture a game is played at: the player's choice, or the one the game
 * was made for. The originals were drawn for the original picture; a mod the
 * console knows starts at the one its makers meant.
 */
export function pictureOf(settings: Settings, game: GameId): Picture {
  const allowed = picturesFor(game);
  const chosen = settings.picture[game];
  if (chosen && allowed.includes(chosen)) return chosen;
  const known = GAMES[game]?.mod?.known;
  const start = known ? KNOWN_MODS[known].picture : 'classic';
  return allowed.includes(start) ? start : allowed[0]!;
}

/** The mod a deck plays, while it is one loaded here; otherwise the game itself. */
export function deckGame(settings: Settings, deck: BaseGameId): GameId {
  const mod = settings.decks[deck];
  return mod && GAMES[mod]?.mod?.base === deck ? mod : deck;
}

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
    const before = isPicture(display) && display !== ONE_FOR_ALL ? everyGame(display) : {};
    const chosen = (parsed.picture && typeof parsed.picture === 'object' ? parsed.picture : {}) as Record<string, unknown>;
    merged.picture = { ...before };
    for (const [game, picture] of Object.entries(chosen)) {
      if (GAME_ID.test(game) && isPicture(picture)) merged.picture[game] = picture;
    }
    const decks = (parsed.decks && typeof parsed.decks === 'object' ? parsed.decks : {}) as Record<string, unknown>;
    merged.decks = {};
    for (const [deck, mod] of Object.entries(decks)) {
      if (isBaseGame(deck) && typeof mod === 'string' && GAME_ID.test(mod) && !isBaseGame(mod)) merged.decks[deck] = mod;
    }
    if (!['fill', 'integer', 'smooth'].includes(merged.scaling)) merged.scaling = DEFAULT_SETTINGS.scaling;
    if (merged.audio !== 'buffered' && merged.audio !== 'direct') merged.audio = DEFAULT_SETTINGS.audio;
    if (merged.touchPointer !== 'direct' && merged.touchPointer !== 'trackpad') merged.touchPointer = DEFAULT_SETTINGS.touchPointer;
    if (!FAST_FORWARD_SPEEDS.includes(merged.fastForward)) merged.fastForward = DEFAULT_SETTINGS.fastForward;
    if (!AUTOSAVE_MINUTES.includes(merged.autosave)) merged.autosave = DEFAULT_SETTINGS.autosave;
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
