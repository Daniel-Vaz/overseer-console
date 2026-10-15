/**
 * Where everything the save editor changes lies in a SAVE.DAT, to the byte.
 *
 * savefile.ts reads a save without the game at hand, and has to try every
 * size an inventory item could take. The editor has the game's prototypes,
 * which say what each item is, and so how many words it stores: it knows.
 * It refuses a save it cannot account for, item by item and section by
 * section, rather than write into a guess.
 *
 * Both engines write, in order (loadsave.cc): the header; the player's combat
 * id; the global variables; the list of map files; the global variables again;
 * the player as an object, with everything carried; the centre of the view;
 * the character sheet (sneaking, flags, base and bonus statistics, skill
 * points, body type, experience value, kill type, Fallout 2 its damage type);
 * kills by type; the tagged skills; the perks (Fallout 2: one block for every
 * possible companion, the player's first); combat; (Fallout 2) companions'
 * combat settings; the player's statistics; (Fallout 1) the queue of timed
 * events; the traits; the automap's flags; the game's preferences; and the
 * character screen's last level and perks owed. What comes after is never
 * touched.
 */
import { HEADER_SIZE, LAYOUT, OBJECT_BYTES, PREFERENCE_WORDS, SKILLS, STATS, Words, locateGlobals, locateTail, looksLikeSheet, parseSaveHeader, validPreferences, type SaveLayout } from '../savefile';

/** What an item is, as far as how it is stored: the words that follow its flags. */
export type ItemKind = 'armor' | 'container' | 'drug' | 'weapon' | 'ammo' | 'misc' | 'key';

/** Words an item of a kind stores after its flags (proto.cc, objectDataRead). */
export const EXTRA_WORDS: Record<ItemKind, number> = { armor: 0, container: 0, drug: 0, weapon: 2, ammo: 1, misc: 1, key: 1 };

/** The words of an object, from its id up to and including its flags. */
export const OBJECT = {
  id: 0,
  tile: 1,
  fid: 8,
  flags: 9,
  pid: 11,
  /** Things it holds: how many, room for how many, and a pointer the engine ignores. */
  held: 18,
  capacity: 19,
  /** For an item: its own flags word. For a critter: its reaction, then combat data and its state. */
  data: 21,
} as const;

/** The player's state words, as a critter object stores them. */
export const DUDE = { hitPoints: 29, radiation: 30, poison: 31, words: 32 } as const;

/** Items in hand or worn. */
export const EQUIPPED = 0x07000000;

export interface MappedItem {
  /** Where its entry starts (the quantity) and ends (after whatever it holds). */
  start: number;
  end: number;
  /** Where its object starts. */
  object: number;
  quantity: number;
  pid: number;
  id: number;
  flags: number;
  /** The words stored after its flags: ammunition, charges, a key's code. */
  extra: number[];
  contents: MappedItem[];
}

export interface SaveMap {
  layout: SaveLayout;
  /** The first copy of the global variables, and how many there are. */
  globals: { at: number; count: number };
  /** The player's object. */
  dude: number;
  /** Everything the player carries, and where that ends. */
  items: MappedItem[];
  itemsEnd: number;
  /** Base statistics; the bonus ones, the skill points, the tagged skills and the player's perk ranks follow. */
  base: number;
  bonus: number;
  skills: number;
  kills: number;
  tags: number;
  perks: number;
  perkCount: number;
  /** Unspent skill points, level, experience, reputation, karma. */
  stats: number;
  traits: number;
  preferences: number;
  /** The character screen's last level (a word) and perks owed (a byte). */
  lastLevel: number;
  perksOwed: number;
}

export class SaveMapError extends Error {}

/**
 * Reads the inventory starting at `at`: `count` entries, each a quantity and
 * an object, followed by the objects it holds.
 */
function readItems(words: Words, at: number, count: number, kindOf: (pid: number) => ItemKind | undefined, out: MappedItem[]): number {
  for (let index = 0; index < count; index++) {
    if (!words.has(at, 4 + OBJECT_BYTES)) throw new SaveMapError('the inventory runs past the end of the save');
    const object = at + 4;
    const quantity = words.int(at);
    const tile = words.int(object + OBJECT.tile * 4);
    const pid = words.uint(object + OBJECT.pid * 4);
    const held = words.int(object + OBJECT.held * 4);
    const capacity = words.int(object + OBJECT.capacity * 4);
    if (quantity < 1 || tile !== -1 || pid >>> 24 !== 0 || held < 0 || held > 4096 || capacity < held) {
      throw new SaveMapError('the inventory does not read as items');
    }
    const kind = kindOf(pid);
    if (!kind) throw new SaveMapError(`the game's data does not describe item ${pid}`);
    const extraAt = object + OBJECT_BYTES;
    const extra = words.ints(extraAt, EXTRA_WORDS[kind]);
    const contents: MappedItem[] = [];
    const end = readItems(words, extraAt + extra.length * 4, held, kindOf, contents);
    out.push({
      start: at,
      end,
      object,
      quantity,
      pid,
      id: words.int(object + OBJECT.id * 4),
      flags: words.uint(object + OBJECT.flags * 4),
      extra,
      contents,
    });
    at = end;
  }
  return at;
}

/**
 * Maps a SAVE.DAT. `kindOf` says what each item is, from the game's
 * prototypes. Throws SaveMapError, saying why, when the save cannot be
 * accounted for.
 */
export function mapSave(data: Uint8Array, layout: SaveLayout, kindOf: (pid: number) => ItemKind | undefined): SaveMap {
  if (!parseSaveHeader(data) || data.length <= HEADER_SIZE) throw new SaveMapError('this is not a saved game');
  const words = new Words(data);
  const shape = LAYOUT[layout];
  try {
    const globalsAt = HEADER_SIZE + 4;
    const globals = locateGlobals(words, globalsAt, shape.globalsTail);
    if (!globals) throw new SaveMapError("the save's global variables could not be found");

    const dude = globals.end;
    if (words.uint(dude + OBJECT.pid * 4) !== 0x01000000) throw new SaveMapError('the player is not where the save keeps them');
    const carried = words.int(dude + OBJECT.held * 4);
    if (carried < 0 || carried > 4096) throw new SaveMapError('the inventory does not read as items');
    const items: MappedItem[] = [];
    const itemsEnd = readItems(words, dude + DUDE.words * 4, carried, kindOf, items);
    if (!looksLikeSheet(words, itemsEnd)) throw new SaveMapError('the character sheet is not where the inventory ends');

    // The centre of the view, sneaking, the prototype's flags: then the sheet.
    const base = itemsEnd + 12;
    const bonus = base + STATS * 4;
    const skills = bonus + STATS * 4;
    const kills = skills + SKILLS * 4 + shape.protoTail * 4;
    const tags = kills + shape.killTypes * 4;
    const perks = tags + 16;
    const tail = locateTail(words, layout, perks + shape.perks * 4);
    if (!tail || tail.traits === undefined) throw new SaveMapError("the player's level and traits could not be found");

    // After the traits: the automap's flags, the preferences, then the character screen's own two.
    const preferences = tail.traits + 8 + 4;
    if (!validPreferences(words, preferences)) throw new SaveMapError("the game's preferences are not where they should be");
    const lastLevel = preferences + PREFERENCE_WORDS * 4;
    const perksOwed = lastLevel + 4;
    if (!words.has(perksOwed, 1)) throw new SaveMapError('the save ends too soon');
    const last = words.int(lastLevel);
    if (last < 0 || last > 99) throw new SaveMapError("the character screen's record does not read");

    return {
      layout,
      globals: { at: globalsAt, count: globals.count },
      dude,
      items,
      itemsEnd,
      base,
      bonus,
      skills,
      kills,
      tags,
      perks,
      perkCount: shape.perks,
      stats: tail.stats,
      traits: tail.traits,
      preferences,
      lastLevel,
      perksOwed,
    };
  } catch (err) {
    if (err instanceof SaveMapError) throw err;
    throw new SaveMapError('the save ends before everything in it was read');
  }
}
