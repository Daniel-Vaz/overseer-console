/**
 * Reading SAVE.DAT, the file at the heart of a saved game.
 *
 * Both games start it with the same big-endian header: who, when, where and a
 * small picture of the screen. Nothing here touches storage.
 */

const SIGNATURE = 'FALLOUT SAVE FILE';

export const THUMBNAIL_WIDTH = 224;
export const THUMBNAIL_HEIGHT = 133;
const THUMBNAIL_OFFSET = 0x83;

/** Size of the header: everything before the first section of game state. */
export const HEADER_SIZE = THUMBNAIL_OFFSET + THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT + 128;

export interface SaveHeader {
  character: string;
  description: string;
  /** In-game date. */
  gameDate: string;
  /** In-game time of day, "0824". */
  gameClock: string;
  /** Map file the save was made on, without extension. */
  map: string;
  /** The number the game knows that map by, and the level of it the player was on (0 to 2). */
  mapIndex: number;
  elevation: number;
  /** 224x133 palette indices, when present. */
  thumbnail?: Uint8Array;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function text(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const code = bytes[offset + i] ?? 0;
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

/** Reads the header of a SAVE.DAT. Returns null when it is not one. */
export function parseSaveHeader(data: Uint8Array): SaveHeader | null {
  if (data.length < THUMBNAIL_OFFSET || text(data, 0, 24) !== SIGNATURE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const month = view.getInt16(0x65, false);
  const day = view.getInt16(0x67, false);
  const year = view.getInt16(0x69, false);
  const ticks = view.getUint32(0x6b, false);
  const minutes = Math.floor(ticks / 600);
  const clock = 100 * (Math.floor(minutes / 60) % 24) + (minutes % 60);
  const thumbnailEnd = THUMBNAIL_OFFSET + THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT;
  return {
    character: text(data, 0x1d, 32),
    description: text(data, 0x3d, 30),
    gameDate: `${String(day).padStart(2, '0')} ${MONTHS[month - 1] ?? '???'} ${year}`,
    gameClock: String(clock).padStart(4, '0'),
    map: text(data, 0x73, 16).replace(/\.sav$/i, ''),
    elevation: view.getInt16(0x6f, false),
    mapIndex: view.getInt16(0x71, false),
    thumbnail: data.length >= thumbnailEnd ? data.subarray(THUMBNAIL_OFFSET, thumbnailEnd) : undefined,
  };
}

const SAVE_PREFIX = 'data/savegame/';

/** The slot a path inside the game folder belongs to, if it is part of a save. */
export function slotOf(key: string): number | null {
  const match = /^data\/savegame\/slot(\d+)\//.exec(key);
  return match ? Number(match[1]) : null;
}

/** Lower-cased folder of a slot, with a trailing slash. */
export function slotPrefix(slot: number): string {
  return `${SAVE_PREFIX}slot${String(slot).padStart(2, '0')}/`;
}

export function isSaveData(key: string): boolean {
  return /^data\/savegame\/slot\d+\/save\.dat$/.test(key);
}

export { SAVE_PREFIX };

// ---------------------------------------------------------------------
// The character behind a save
// ---------------------------------------------------------------------

/**
 * What a save says about the player character.
 *
 * After the header SAVE.DAT is a run of sections without lengths or markers;
 * each can only be found by reading everything before it. The sections up to
 * the character sheet are read exactly. Two things need care:
 *
 *  - the list of global variables has no count, but is written twice with
 *    the list of map files in between, which pins its length down;
 *  - how many bytes an inventory item takes depends on its kind, which only
 *    the game data knows. Each item is tried at every possible size and the
 *    one after which the file makes sense again is taken.
 *
 * Whatever cannot be read with certainty is left out rather than guessed.
 */
export interface Character {
  hitPoints: number;
  maxHitPoints: number;
  poisoned: boolean;
  irradiated: boolean;
  /** Strength, Perception, Endurance, Charisma, Intelligence, Agility, Luck. */
  special: number[];
  /** Indices of the tagged skills. */
  tagged: number[];
  kills: number;
  /** Caps (Fallout) or money (Fallout 2) carried. */
  money: number;
  /** Things carried, counting stacks as one. */
  items: number;
  /** Karma (Fallout 2) or general reputation (Fallout). */
  karma: number;
  /** Indices of the perks taken, repeated for every rank. */
  perks: number[];
  level?: number;
  experience?: number;
  /** Indices of the chosen traits. */
  traits?: number[];
}

/**
 * Which engine wrote a save: the two lay the file out differently. A game is
 * saved in the layout of the engine it runs on, whatever world it is set in.
 */
export type SaveLayout = 'fo1' | 'fo2';
type Game = SaveLayout;

const LAYOUT = {
  fo1: {
    /** Bytes that follow the global variables in their section. */
    globalsTail: 1,
    /** Words after the skills in the character's prototype. */
    protoTail: 3,
    killTypes: 15,
    perks: 64,
    /** Perk slots that are not perks: addictions and effects of worn items. */
    pseudoPerks: [53, 63],
    karmaVariable: 155,
  },
  fo2: { globalsTail: 0, protoTail: 4, killTypes: 19, perks: 119, pseudoPerks: [53, 72], karmaVariable: 0 },
} as const;

const STATS = 35;
const SKILLS = 18;
const TRAITS = 16;
const MONEY_PID = 41;
/** Everything of an object up to and including its flags word. */
const OBJECT_BYTES = 18 * 4 + 3 * 4 + 4;
/** Words in a companion's combat settings (Fallout 2 writes a set per companion). */
const AI_PACKET_WORDS = 45;
/** Extra words stored for each kind of queued event in Fallout 1. */
const FO1_EVENT_WORDS = [6, 0, 3, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0];

class Words {
  private readonly view: DataView;
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  has(offset: number, bytes: number): boolean {
    return offset >= 0 && offset + bytes <= this.data.length;
  }
  int(offset: number): number {
    if (!this.has(offset, 4)) throw new RangeError('read past the end of the save');
    return this.view.getInt32(offset, false);
  }
  uint(offset: number): number {
    return this.int(offset) >>> 0;
  }
  float(offset: number): number {
    if (!this.has(offset, 4)) throw new RangeError('read past the end of the save');
    return this.view.getFloat32(offset, false);
  }
  ints(offset: number, count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(this.int(offset + 4 * i));
    return out;
  }
  same(a: number, b: number, length: number): boolean {
    if (!this.has(a, length) || !this.has(b, length)) return false;
    for (let i = 0; i < length; i++) if (this.data[a + i] !== this.data[b + i]) return false;
    return true;
  }
}

/**
 * Finds the end of the map list, and with it the number of global variables:
 * the variables, then "n map files" with their names, then the same
 * variables again.
 */
function locateGlobals(words: Words, start: number, tail: number): { count: number; end: number } | null {
  for (let count = 1; count <= 8192; count++) {
    const length = 4 * count + tail;
    const list = start + length;
    if (!words.has(list, 8)) return null;
    const maps = words.int(list);
    if (maps < 1 || maps > 2000) continue;
    let at = list + 4;
    let valid = true;
    for (let i = 0; i < maps && valid; i++) {
      let end = at;
      while (end < words.data.length && end - at <= 16 && words.data[end] !== 0) end++;
      const name = String.fromCharCode(...words.data.subarray(at, end));
      valid = end < words.data.length && words.data[end] === 0 && /^[\x21-\x7e]{1,12}\.sav$/i.test(name);
      at = end + 1;
    }
    if (!valid) continue;
    at += 4; // size of the automap file
    if (words.same(start, at, length)) return { count, end: at + length };
  }
  return null;
}

interface Carried {
  pid: number;
  quantity: number;
}

/** Whether an inventory entry (a count, then an object) could start here. */
function looksLikeItem(words: Words, at: number): boolean {
  if (!words.has(at, 4 + OBJECT_BYTES)) return false;
  const quantity = words.int(at);
  const tile = words.int(at + 8);
  const fid = words.uint(at + 4 + 8 * 4);
  const pid = words.uint(at + 4 + 11 * 4);
  const held = words.int(at + 4 + 18 * 4);
  // Something carried is on no tile, and both its picture and its prototype are of the "item" kind.
  return quantity >= 1 && tile === -1 && pid !== 0 && pid >>> 24 === 0 && fid >>> 24 === 0 && held >= 0 && held < 4096;
}

/** Whether the character sheet could start here: view centre, sneak flag, flags, then seven stats of 1 to 10. */
function looksLikeSheet(words: Words, at: number): boolean {
  if (!words.has(at, 12 + 7 * 4)) return false;
  const sneak = words.int(at + 4);
  return (sneak === 0 || sneak === 1) && words.ints(at + 12, 7).every((stat) => stat >= 1 && stat <= 10);
}

/**
 * Reads `count` inventory entries starting at `at` and returns where they
 * end. `endsWell` judges what follows the last of them: for the player's own
 * inventory that is the character sheet, for the contents of a bag whatever
 * must follow the bag.
 */
function readItems(
  words: Words,
  at: number,
  count: number,
  out: Carried[],
  multiplier: number,
  endsWell: (end: number) => boolean,
): number {
  for (let index = 0; index < count; index++) {
    if (!looksLikeItem(words, at)) throw new RangeError('unexpected inventory data');
    const quantity = words.int(at);
    const pid = words.uint(at + 4 + 11 * 4);
    const held = words.int(at + 4 + 18 * 4);
    const fixed = at + 4 + OBJECT_BYTES;
    const follows = index === count - 1 ? endsWell : (end: number) => looksLikeItem(words, end);
    let next = -1;
    // A weapon stores two more words; ammunition, keys and powered things one; the rest none.
    for (const extra of [0, 4, 8]) {
      const inside: Carried[] = [];
      let end: number;
      try {
        end = held ? readItems(words, fixed + extra, held, inside, multiplier * quantity, follows) : fixed + extra;
      } catch {
        continue;
      }
      if (!follows(end)) continue;
      out.push({ pid, quantity: quantity * multiplier }, ...inside);
      next = end;
      break;
    }
    if (next < 0) throw new RangeError('could not tell where an inventory item ends');
    at = next;
  }
  return at;
}

function readInventory(words: Words, at: number, count: number): { items: Carried[]; end: number } {
  const items: Carried[] = [];
  const sheetFollows = (end: number) => looksLikeSheet(words, end);
  const end = readItems(words, at, count, items, 1, sheetFollows);
  if (!sheetFollows(end)) throw new RangeError('the character sheet is not where the inventory ends');
  return { items, end };
}

function levelAndTraits(words: Words, game: Game, at: number): Pick<Character, 'level' | 'experience' | 'traits'> {
  const validStats = (offset: number): boolean => {
    if (!words.has(offset, 20)) return false;
    const [points, level, experience] = words.ints(offset, 3) as [number, number, number];
    return points >= 0 && points < 10_000 && level >= 1 && level <= 99 && experience >= 0;
  };
  const validTraits = (offset: number): boolean => {
    if (!words.has(offset, 8)) return false;
    const [first, second] = words.ints(offset, 2) as [number, number];
    const ok = (trait: number) => trait >= -1 && trait < TRAITS;
    return ok(first) && ok(second) && (first !== second || first === -1);
  };
  const traitsAt = (offset: number): number[] => words.ints(offset, 2).filter((trait) => trait >= 0);
  /** Length of the combat section starting at `offset`, or -1. */
  const combatLength = (offset: number): number => {
    if (!words.has(offset, 4)) return -1;
    const state = words.uint(offset);
    if (state > 0xff) return -1;
    if ((state & 1) === 0) return 4;
    // In combat: three words, three counts, the player's id, then per combatant one id (Fallout 2: four more).
    if (!words.has(offset, 32)) return -1;
    const total = words.int(offset + 24);
    if (total < 0 || total > 500) return -1;
    return 32 + total * 4 * (game === 'fo2' ? 5 : 1);
  };

  if (game === 'fo1') {
    const combat = combatLength(at);
    if (combat < 0 || !validStats(at + combat)) return {};
    const stats = at + combat;
    const result: Pick<Character, 'level' | 'experience' | 'traits'> = { level: words.int(stats + 4), experience: words.int(stats + 8) };
    // The traits follow the queue of timed events.
    try {
      let queue = stats + 20;
      const events = words.int(queue);
      if (events < 0 || events > 5000) return result;
      queue += 4;
      for (let i = 0; i < events; i++) {
        const extra = FO1_EVENT_WORDS[words.int(queue + 4)];
        if (extra === undefined) return result;
        queue += 12 + 4 * extra;
      }
      if (validTraits(queue)) result.traits = traitsAt(queue);
    } catch {
      // Level and experience stand on their own.
    }
    return result;
  }

  // Fallout 2 writes a block of perks and, for some, combat settings for every
  // possible companion. How many there are depends on the game data, so the
  // one arrangement after which the file reads as statistics, traits and
  // game preferences is looked for. The preferences are a good landmark:
  // thirteen small numbers, then volumes and three floating point settings.
  const PREFERENCE_LIMITS = [2, 2, 3, 3, 1, 1, 1, 1, 1, 1, 1, 50, 1];
  const PREFERENCE_WORDS = 20;
  const validPreferences = (offset: number): boolean => {
    if (!words.has(offset, PREFERENCE_WORDS * 4)) return false;
    if (!words.ints(offset, 13).every((value, index) => value >= 0 && value <= PREFERENCE_LIMITS[index]!)) return false;
    const within = (value: number, low: number, high: number) => value >= low && value <= high;
    return (
      within(words.float(offset + 13 * 4), 0.5, 20) && // text delay
      words.ints(offset + 14 * 4, 4).every((volume) => within(volume, 0, 0x7fff)) &&
      within(words.float(offset + 18 * 4), 0.5, 2) && // brightness
      within(words.float(offset + 19 * 4), 0.25, 8) // mouse sensitivity
    );
  };
  const perkBlock = 4 * LAYOUT.fo2.perks;
  let found: number | null = null;
  for (let companions = 0; companions <= 150; companions++) {
    const combatAt = at + companions * perkBlock;
    const combat = combatLength(combatAt);
    if (combat < 0) continue;
    for (let packets = 0; packets <= companions; packets++) {
      const stats = combatAt + combat + packets * AI_PACKET_WORDS * 4;
      if (!words.has(stats, 20 + 8 + 4 + PREFERENCE_WORDS * 4)) break;
      if (validStats(stats) && validTraits(stats + 20) && validPreferences(stats + 32)) {
        if (found !== null && found !== stats) return {}; // ambiguous: say nothing
        found = stats;
      }
    }
  }
  if (found === null) return {};
  return { level: words.int(found + 4), experience: words.int(found + 8), traits: traitsAt(found + 20) };
}

/** Reads the character out of a SAVE.DAT. Null when the save does not follow the expected layout. */
export function parseCharacter(data: Uint8Array, game: Game): Character | null {
  if (!parseSaveHeader(data) || data.length <= HEADER_SIZE) return null;
  const layout = LAYOUT[game];
  try {
    const words = new Words(data);
    const globalsAt = HEADER_SIZE + 4;
    const globals = locateGlobals(words, globalsAt, layout.globalsTail);
    if (!globals) return null;

    // The player: an object of the "critter" kind with prototype number 0.
    const dude = globals.end;
    if (words.uint(dude + 11 * 4) !== 0x01000000) return null;
    const carried = words.int(dude + 18 * 4);
    if (carried < 0 || carried > 4096) return null;
    const hitPoints = words.int(dude + 29 * 4);
    const radiation = words.int(dude + 30 * 4);
    const poison = words.int(dude + 31 * 4);
    const inventory = readInventory(words, dude + 32 * 4, carried);

    // View centre, sneak flag and prototype flags, then the sheet itself.
    let at = inventory.end + 12;
    const base = words.ints(at, STATS);
    const bonus = words.ints(at + 4 * STATS, STATS);
    at += 8 * STATS + 4 * SKILLS + 4 * layout.protoTail;
    const kills = words.ints(at, layout.killTypes);
    at += 4 * layout.killTypes;
    const tagged = words.ints(at, 4).filter((skill) => skill >= 0 && skill < SKILLS);
    at += 16;
    const ranks = words.ints(at, layout.perks);
    at += 4 * layout.perks;
    if (kills.some((count) => count < 0) || ranks.some((rank) => rank < 0 || rank > 100)) return null;

    const perks: number[] = [];
    ranks.forEach((rank, perk) => {
      if (perk >= layout.pseudoPerks[0] && perk <= layout.pseudoPerks[1]) return;
      for (let i = 0; i < rank; i++) perks.push(perk);
    });

    return {
      hitPoints,
      maxHitPoints: base[7]! + bonus[7]!,
      poisoned: poison > 0,
      irradiated: radiation > 0,
      special: base.slice(0, 7).map((value, stat) => Math.min(10, Math.max(1, value + bonus[stat]!))),
      tagged,
      kills: kills.reduce((sum, count) => sum + count, 0),
      money: inventory.items.reduce((sum, item) => sum + (item.pid === MONEY_PID ? item.quantity : 0), 0),
      items: inventory.items.length,
      karma: globals.count > layout.karmaVariable ? words.int(globalsAt + 4 * layout.karmaVariable) : 0,
      perks,
      ...levelAndTraits(words, game, at),
    };
  } catch {
    return null;
  }
}

/** Names for what a character sheet refers to by number, in English. */
export const SPECIAL_NAMES = ['ST', 'PE', 'EN', 'CH', 'IN', 'AG', 'LK'];

export const SKILL_NAMES = [
  'Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons', 'Throwing', 'First Aid', 'Doctor', 'Sneak',
  'Lockpick', 'Steal', 'Traps', 'Science', 'Repair', 'Speech', 'Barter', 'Gambling', 'Outdoorsman',
];

/** The thirteenth trait differs between the games. */
export function traitNames(game: Game): string[] {
  return [
    'Fast Metabolism', 'Bruiser', 'Small Frame', 'One Hander', 'Finesse', 'Kamikaze', 'Heavy Handed', 'Fast Shot',
    'Bloody Mess', 'Jinxed', 'Good Natured', 'Chem Reliant', 'Chem Resistant', game === 'fo1' ? 'Night Person' : 'Sex Appeal',
    'Skilled', 'Gifted',
  ];
}
