/**
 * Small facts the console borrows from an installed game to describe saves:
 * the colour palette (a save's picture is stored as palette indices), the
 * names of perks, traits and skills, and the names of places, all in the
 * game's own words.
 *
 * They are read out of the player's MASTER.DAT once per install and then
 * remembered, so that saves can still be described after a game is ejected.
 */
import { findInDat, readDatEntry } from './dat';
import { GAMES, GAME_IDS, type EngineId, type GameId } from './games';
import { loadInstall, openInstalled } from './storage/opfs';

const KEY = 'overseer-console:facts';

/**
 * What a game calls the places a save can be made in. The games' own list of
 * saves shows "Vault 13 Living Quarters": the area a map belongs to, then the
 * level of that map the player stood on.
 */
export interface Places {
  /** The area each map belongs to, by the map's number. '' where the game names none. */
  areas: string[];
  /** The name of each level of each map, at the map's number times three plus the level. '' where there is none. */
  levels: string[];
}

export interface GameFacts {
  /** The install these were read from. */
  install: string;
  /** 256 colours, three bytes each. */
  palette: Uint8Array;
  /** By index. Empty when the game's text files were not found. */
  perks: string[];
  traits: string[];
  skills: string[];
  /** Missing in facts remembered from before the console read them. */
  places?: Places;
}

interface StoredFacts {
  install: string;
  palette: string;
  perks: string[];
  traits: string[];
  skills: string[];
  places?: Places;
}

const PALETTE = 'color.pal';
const TEXT = { perks: 'text/english/game/perk.msg', traits: 'text/english/game/trait.msg', skills: 'text/english/game/skill.msg' };
/** Message number of the first name in each file, and how many names follow it: as many as the engine has slots for. */
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

// ---------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------

/** Where the names of places are kept: MAP.MSG has the words, the other two say which map lies in which area. */
const PLACE_FILES = { names: 'text/english/game/map.msg', maps: 'data/maps.txt', areas: 'data/city.txt' };

/** Every map has room for three levels. */
const LEVELS = 3;
/** MAP.MSG: where the names of levels start, and (for the engine of Fallout 2) those of areas. */
const FIRST_LEVEL_NAME = 200;
const FIRST_AREA_NAME = 1500;

/**
 * The engine of Fallout knows its maps by heart, and for each of them which
 * message of MAP.MSG names its area ("Vault 13", "Hub"...). In map order.
 */
const FALLOUT_AREA_NAMES = [
  100, 100, 100, 505, 505, 505, 500, 501, 501, 505, 503, 503, 503, 507, 507, 507, 116, 511, 511, 119, 120, 120,
  100, 100, 504, 502, 502, 509, 510, 510, 508, 508, 508, 511, 511, 500, 506, 506, 506, 506, 506, 506, 509, 509,
  510, 510, 510, 511, 508, 149, 149, 100, 100, 100, 100, 507, 100, 100, 149, 149, 160, 100, 149, 100, 149, 506,
];

/** Every message of one of the games' .msg files, by its number. */
export function messages(file: Uint8Array): Map<number, string> {
  const found = new Map<number, string>();
  for (const match of new TextDecoder('windows-1252').decode(file).matchAll(/\{(\d+)\}\{[^}]*\}\{([^}]*)\}/g)) {
    found.set(Number(match[1]), match[2]!.replace(/\s+/g, ' ').trim());
  }
  return found;
}

/**
 * Reads one of the games' lists of sections: [Section], then key=value lines.
 * As the engines do it: a line ends at its first ";" (or "#" where it has
 * none), and names are matched without regard to case.
 */
export function sections(file: Uint8Array): Map<string, Map<string, string>> {
  const found = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of new TextDecoder('windows-1252').decode(file).split(/\r?\n/)) {
    const comment = raw.includes(';') ? raw.indexOf(';') : raw.indexOf('#');
    const line = (comment < 0 ? raw : raw.slice(0, comment)).trim();
    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      if (end < 0) continue;
      const name = line.slice(1, end).trim().toLowerCase();
      current = found.get(name);
      if (!current) found.set(name, (current = new Map()));
      continue;
    }
    const equals = line.indexOf('=');
    if (equals > 0) current?.set(line.slice(0, equals).trim().toLowerCase(), line.slice(equals + 1).trim());
  }
  return found;
}

/**
 * Works out the names of places the way the engine of a game does.
 *
 * Fallout 2: MAPS.TXT lists the maps ([Map 000], [Map 001]...), each with the
 * name it is looked up by; CITY.TXT lists the areas ([Area 00]...), each with
 * the maps one can enter it by. A map belongs to the first area that names
 * it, and that area is called what message 1500 + its number says.
 * Fallout: the engine carries that table itself.
 */
export function readPlaces(engine: EngineId, files: { names?: Uint8Array; maps?: Uint8Array; areas?: Uint8Array }): Places {
  const places: Places = { areas: [], levels: [] };
  if (!files.names) return places;
  const names = messages(files.names);

  if (engine === 'fo1') {
    places.areas = FALLOUT_AREA_NAMES.map((message) => names.get(message) ?? '');
  } else if (files.maps && files.areas) {
    const maps = sections(files.maps);
    const lookups: string[] = [];
    for (let map = 0; map < 5000; map++) {
      const lookup = maps.get(`map ${String(map).padStart(3, '0')}`)?.get('lookup_name');
      if (lookup === undefined) break;
      lookups.push(lookup.toLowerCase());
    }
    const areas = sections(files.areas);
    const entered: string[][] = [];
    for (let area = 0; area < 5000; area++) {
      const section = areas.get(`area ${String(area).padStart(2, '0')}`);
      if (!section?.has('townmap_art_idx')) break;
      const by: string[] = [];
      // "On,214,309,V13ENT,0,25936,0": the fourth word is the map.
      for (let entrance = 0; section.has(`entrance_${entrance}`); entrance++) {
        by.push(section.get(`entrance_${entrance}`)!.split(',')[3]?.trim().toLowerCase() ?? '');
      }
      entered.push(by);
    }
    places.areas = lookups.map((lookup) => {
      const area = entered.findIndex((by) => by.includes(lookup));
      return area < 0 ? '' : (names.get(FIRST_AREA_NAME + area) ?? '');
    });
  }

  places.levels = Array.from({ length: places.areas.length * LEVELS }, (_, at) => names.get(FIRST_LEVEL_NAME + at) ?? '');
  return places;
}

/** A place as the game itself would name it on its list of saves, or null when its names are not at hand. */
export function placeName(places: Places | undefined, mapIndex: number, elevation: number): string | null {
  // (Versions of a save kept before the console read these numbers have none.)
  if (!places || !Number.isInteger(mapIndex) || !Number.isInteger(elevation)) return null;
  if (mapIndex < 0 || mapIndex >= places.areas.length || elevation < 0 || elevation >= LEVELS) return null;
  const name = `${places.areas[mapIndex]} ${places.levels[mapIndex * LEVELS + elevation] ?? ''}`.trim();
  return name || null;
}

/** Where a save was made, in the game's words; the name of the map file where those are not at hand. */
export function whereabouts(places: Places | undefined, save: { map: string; mapIndex: number; elevation: number }): string {
  return placeName(places, save.mapIndex, save.elevation) ?? save.map;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

function remembered(game: GameId): GameFacts | null {
  try {
    const stored = JSON.parse(localStorage.getItem(`${KEY}:${game}`) ?? 'null') as StoredFacts | null;
    if (!stored || typeof stored.palette !== 'string') return null;
    const palette = fromBase64(stored.palette);
    if (palette.length !== 768) return null;
    const places = stored.places && Array.isArray(stored.places.areas) && Array.isArray(stored.places.levels) ? stored.places : undefined;
    return { install: stored.install, palette, perks: stored.perks ?? [], traits: stored.traits ?? [], skills: stored.skills ?? [], places };
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
  // A conversion keeps its own words in its own archive, not in the MASTER.DAT it runs on.
  const def = GAMES[game];
  const archive = await openInstalled(install, def.factsArchive);
  if (!archive) return null;
  const format = def.datFormat;
  const found = await findInDat(archive, format, [PALETTE, ...Object.values(TEXT), ...Object.values(PLACE_FILES)]);

  const paletteEntry = found.get(PALETTE);
  const palette = paletteEntry ? decodePalette(await readDatEntry(archive, format, paletteEntry)) : null;
  if (!palette) return null;

  const names = async (kind: keyof typeof TEXT): Promise<string[]> => {
    const entry = found.get(TEXT[kind]);
    if (!entry) return [];
    try {
      return messageNames(await readDatEntry(archive, format, entry), NAMES[kind].first, NAMES[kind].count[def.engine.id]);
    } catch {
      return [];
    }
  };
  const file = async (path: string): Promise<Uint8Array | undefined> => {
    const entry = found.get(path);
    try {
      return entry ? await readDatEntry(archive, format, entry) : undefined;
    } catch {
      return undefined;
    }
  };
  let places: Places = { areas: [], levels: [] };
  try {
    places = readPlaces(def.engine.id, { names: await file(PLACE_FILES.names), maps: await file(PLACE_FILES.maps), areas: await file(PLACE_FILES.areas) });
  } catch {
    // A save is then described by the name of its map file, as before.
  }
  return {
    install: install.manifest.install,
    palette,
    perks: await names('perks'),
    traits: await names('traits'),
    skills: await names('skills'),
    places,
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
        // Facts remembered from before the console read the names of places are read once more.
        if (known?.install === install.manifest.install && known.places) return known;
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
