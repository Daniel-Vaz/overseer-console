/**
 * Small facts the console borrows from an installed game to describe saves:
 * the colour palette (a save's picture is stored as palette indices) and the
 * names of perks, traits and skills in the game's own words.
 *
 * They are read out of the player's MASTER.DAT once per install and then
 * remembered, so that saves can still be described after a game is ejected.
 */
import { findInDat, readDatEntry } from './dat';
import { GAMES, GAME_IDS, type GameId } from './games';
import { pathKey } from './storage/manifest';
import { loadInstall, openBlob } from './storage/opfs';

const KEY = 'overseer-console:facts';

export interface GameFacts {
  /** The install these were read from. */
  install: string;
  /** 256 colours, three bytes each. */
  palette: Uint8Array;
  /** By index. Empty when the game's text files were not found. */
  perks: string[];
  traits: string[];
  skills: string[];
}

interface StoredFacts {
  install: string;
  palette: string;
  perks: string[];
  traits: string[];
  skills: string[];
}

const PALETTE = 'color.pal';
const TEXT = { perks: 'text/english/game/perk.msg', traits: 'text/english/game/trait.msg', skills: 'text/english/game/skill.msg' };
/** Message number of the first name in each file, and how many names follow it. */
const NAMES = {
  perks: { first: 101, count: { fo1: 64, fo2: 119 } },
  traits: { first: 100, count: { fo1: 16, fo2: 16 } },
  skills: { first: 100, count: { fo1: 18, fo2: 18 } },
} as const;

/**
 * Turns the start of COLOR.PAL into 8-bit colours. The file holds 6-bit
 * components; entries with larger values are the ones the games never show.
 */
export function decodePalette(file: Uint8Array): Uint8Array | null {
  if (file.length < 768) return null;
  const palette = new Uint8Array(768);
  for (let color = 0; color < 256; color++) {
    const [r, g, b] = [file[color * 3]!, file[color * 3 + 1]!, file[color * 3 + 2]!];
    if (r > 63 || g > 63 || b > 63) continue;
    palette[color * 3] = Math.round((r * 255) / 63);
    palette[color * 3 + 1] = Math.round((g * 255) / 63);
    palette[color * 3 + 2] = Math.round((b * 255) / 63);
  }
  return palette;
}

/** Reads the names numbered first, first+1, ... out of one of the games' .msg files: lines of {number}{sound}{text}. */
export function messageNames(file: Uint8Array, first: number, count: number): string[] {
  const text = new TextDecoder('windows-1252').decode(file);
  const names = new Array<string>(count).fill('');
  for (const match of text.matchAll(/\{(\d+)\}\{[^}]*\}\{([^}]*)\}/g)) {
    const index = Number(match[1]) - first;
    if (index >= 0 && index < count) names[index] = match[2]!.trim();
  }
  // A list with holes is a different file than expected; better none than wrong names.
  return names.every(Boolean) ? names : [];
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

function remembered(game: GameId): GameFacts | null {
  try {
    const stored = JSON.parse(localStorage.getItem(`${KEY}:${game}`) ?? 'null') as StoredFacts | null;
    if (!stored || typeof stored.palette !== 'string') return null;
    const palette = fromBase64(stored.palette);
    if (palette.length !== 768) return null;
    return { install: stored.install, palette, perks: stored.perks ?? [], traits: stored.traits ?? [], skills: stored.skills ?? [] };
  } catch {
    return null;
  }
}

function remember(game: GameId, facts: GameFacts): void {
  try {
    const stored: StoredFacts = { ...facts, palette: toBase64(facts.palette) };
    localStorage.setItem(`${KEY}:${game}`, JSON.stringify(stored));
  } catch {
    // They are read again next time.
  }
}

async function readFacts(game: GameId): Promise<GameFacts | null> {
  const install = await loadInstall(game);
  if (!install) return null;
  const master = install.manifest.files.find((file) => pathKey(file.path) === 'master.dat');
  if (!master?.blob) return null;
  const archive = await openBlob(install, master.blob);
  const format = GAMES[game].datFormat;
  const found = await findInDat(archive, format, [PALETTE, ...Object.values(TEXT)]);

  const paletteEntry = found.get(PALETTE);
  const palette = paletteEntry ? decodePalette(await readDatEntry(archive, format, paletteEntry)) : null;
  if (!palette) return null;

  const names = async (kind: keyof typeof TEXT): Promise<string[]> => {
    const entry = found.get(TEXT[kind]);
    if (!entry) return [];
    try {
      return messageNames(await readDatEntry(archive, format, entry), NAMES[kind].first, NAMES[kind].count[game]);
    } catch {
      return [];
    }
  };
  return {
    install: install.manifest.install,
    palette,
    perks: await names('perks'),
    traits: await names('traits'),
    skills: await names('skills'),
  };
}

const pending = new Map<GameId, Promise<GameFacts | null>>();

/** The facts of a game: from memory, else from its installed data, else null. */
export function gameFacts(game: GameId): Promise<GameFacts | null> {
  let promise = pending.get(game);
  if (!promise) {
    promise = (async () => {
      const known = remembered(game);
      try {
        const install = await loadInstall(game);
        if (!install) return known;
        if (known?.install === install.manifest.install) return known;
        const fresh = await readFacts(game);
        if (fresh) remember(game, fresh);
        return fresh ?? known;
      } catch (err) {
        console.error('[facts] could not read game data', err);
        return known;
      }
    })();
    pending.set(game, promise);
    // An import or eject changes the answer; ask again next time.
    void promise.finally(() => setTimeout(() => pending.delete(game), 0));
  }
  return promise;
}

/**
 * A palette for drawing a save's picture. Both games use the same colours,
 * so the other game's palette does when this one's data is not around.
 */
export async function paletteFor(game: GameId): Promise<Uint8Array | null> {
  const own = await gameFacts(game);
  if (own) return own.palette;
  for (const other of GAME_IDS) {
    if (other === game) continue;
    const facts = await gameFacts(other);
    if (facts) return facts.palette;
  }
  return null;
}
