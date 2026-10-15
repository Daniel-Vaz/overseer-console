/**
 * A saved character as the save editor changes it, and the SAVE.DAT that
 * comes of the changes.
 *
 * The record holds what the player chooses. What follows from it by the
 * game's rules (the derived statistics, what perks add, the hit points that
 * levels bring) is worked out when the save is written, from the record and
 * from what the save held: never accumulated step by step, so that any
 * change can be taken back on its own.
 *
 * Writing changes the fields in place, where they are, and splices in the
 * inventory, the one part whose length changes. Every other byte stays as the
 * game wrote it, and before the result is handed back it is read again to
 * prove it: what was meant to change reads as changed, and nothing else did.
 */
import { HEADER_SIZE, SKILLS, STATS, Words, parseCharacter, type SaveLayout } from '../savefile';
import type { Catalog, ItemProto } from './catalog';
import {
  PERK,
  STAT,
  deriveBase,
  effectiveStat,
  experienceFor,
  hitPointsPerLevel,
  perkBonusChange,
  type Rules,
  type Sheet,
} from './rules';
import { DUDE, EQUIPPED, OBJECT, mapSave, type ItemKind, type MappedItem, type SaveMap } from './savemap';

export const NAME_LENGTH = 11;
export const DESCRIPTION_LENGTH = 28;
const NAME_AT = 0x1d;
const NAME_FIELD = 32;
const DESCRIPTION_AT = 0x3d;
const DESCRIPTION_FIELD = 30;
/** Most of any one thing a character can carry here. */
export const MAX_QUANTITY = 999_999;
/** The engines number the player 18000; carried things are numbered below. */
const PLAYER_ID = 18000;

export interface Carried {
  /** Stays the same while the item is on the list, for the screen to follow it by. */
  key: string;
  pid: number;
  quantity: number;
  /** The item as the save holds it; none for one the editor adds. */
  original?: MappedItem;
}

export interface SaveRecord {
  name: string;
  description: string;
  gender: number;
  age: number;
  /** Base S.P.E.C.I.A.L. */
  special: number[];
  /** Points spent on each skill. */
  skills: number[];
  /** Four slots, -1 where none. */
  tags: number[];
  /** Two slots, -1 where none. */
  traits: number[];
  perks: number[];
  level: number;
  experience: number;
  unspent: number;
  /**
   * Hit points before what levels gained here add (see hitPoints): so that
   * the level and the hit points can each be put back on their own.
   */
  hitPoints: number;
  poison: number;
  radiation: number;
  perksOwed: number;
  items: Carried[];
}

/** What the save held, read once: the record as it was, and what the record leaves out. */
export interface Original {
  layout: SaveLayout;
  data: Uint8Array;
  map: SaveMap;
  record: SaveRecord;
  base: number[];
  bonus: number[];
  lastLevel: number;
  difficulty: number;
  clock: number;
  globals: number[];
}

function latin1(data: Uint8Array, at: number, length: number): string {
  let text = '';
  for (let i = 0; i < length && data[at + i]; i++) text += String.fromCharCode(data[at + i]!);
  return text;
}

/** Reads a save into a record. Throws SaveMapError when the save cannot be accounted for. */
export function readSave(data: Uint8Array, layout: SaveLayout, kindOf: (pid: number) => ItemKind | undefined): Original {
  const map = mapSave(data, layout, kindOf);
  const words = new Words(data);
  const base = words.ints(map.base, STATS);
  const stats = words.ints(map.stats, 5);
  const ticks = words.uint(0x6b);
  const minutes = Math.floor(ticks / 600);
  let next = 0;
  const record: SaveRecord = {
    name: latin1(data, NAME_AT, NAME_FIELD),
    description: latin1(data, DESCRIPTION_AT, DESCRIPTION_FIELD),
    gender: base[STAT.gender]!,
    age: base[STAT.age]!,
    special: base.slice(0, 7),
    skills: words.ints(map.skills, SKILLS),
    tags: words.ints(map.tags, 4),
    traits: words.ints(map.traits, 2),
    perks: words.ints(map.perks, map.perkCount),
    level: stats[1]!,
    experience: stats[2]!,
    unspent: stats[0]!,
    hitPoints: words.int(map.dude + DUDE.hitPoints * 4),
    poison: words.int(map.dude + DUDE.poison * 4),
    radiation: words.int(map.dude + DUDE.radiation * 4),
    perksOwed: data[map.perksOwed]!,
    items: map.items.map((item) => ({ key: `i${next++}`, pid: item.pid, quantity: item.quantity, original: item })),
  };
  return {
    layout,
    data,
    map,
    record,
    base,
    bonus: words.ints(map.bonus, STATS),
    lastLevel: words.int(map.lastLevel),
    difficulty: words.int(map.preferences),
    clock: 100 * (Math.floor(minutes / 60) % 24) + (minutes % 60),
    globals: words.ints(map.globals.at, map.globals.count),
  };
}

/** A copy of a record, to change without touching the one it came from. */
export function copyRecord(record: SaveRecord): SaveRecord {
  return {
    ...record,
    special: record.special.slice(),
    skills: record.skills.slice(),
    tags: record.tags.slice(),
    traits: record.traits.slice(),
    perks: record.perks.slice(),
    items: record.items.map((item) => ({ ...item })),
  };
}

/** The hit points the levels gained here bring: those of a level-up, for each. Taking levels away takes none. */
export function levelHitPoints(rules: Rules, original: Original, record: SaveRecord): number {
  const gained = record.level - original.record.level;
  return gained > 0 ? gained * hitPointsPerLevel(rules, sheetOf(rules, original, record, false)) : 0;
}

/**
 * The character sheet a record makes: base statistics with the chosen
 * S.P.E.C.I.A.L. (and, unless `derived` is false, the statistics derived from
 * it worked out again), bonus statistics with what the perks now add and the
 * levels' hit points.
 */
export function sheetOf(rules: Rules, original: Original, record: SaveRecord, derived = true): Sheet {
  const base = original.base.slice();
  record.special.forEach((value, stat) => (base[stat] = value));
  base[STAT.age] = record.age;
  base[STAT.gender] = record.gender;
  const change = perkBonusChange(rules, original.record.perks, record.perks);
  const bonus = original.bonus.map((value, stat) => value + (change[stat] ?? 0));
  const sheet: Sheet = {
    base,
    bonus,
    skills: record.skills,
    tags: record.tags,
    perks: record.perks,
    traits: record.traits,
    level: record.level,
    difficulty: original.difficulty,
    clock: original.clock,
    globals: original.globals,
  };
  if (!derived) return sheet;
  sheet.bonus[STAT.maxHitPoints]! += levelHitPoints(rules, original, record);
  // Only what was changed is written: the statistics the game derived are left as it left them unless what they come from changed.
  const before = original.record;
  const same = (a: number[], b: number[]) => a.every((value, index) => value === b[index]);
  if (!same(record.special, before.special) || !same(record.traits, before.traits) || !same(record.perks, before.perks)) {
    sheet.base = deriveBase(rules, sheet);
  }
  return sheet;
}

/**
 * Hit points as the save will hold them: never more than the most there can
 * be, never none. What the save held is left as it was unless the changes
 * touch it.
 */
export function hitPoints(rules: Rules, original: Original, record: SaveRecord, sheet = sheetOf(rules, original, record)): number {
  const most = effectiveStat(rules, sheet, STAT.maxHitPoints);
  const value = record.hitPoints + levelHitPoints(rules, original, record);
  if (value === original.record.hitPoints && most >= effectiveStat(rules, sheetOf(rules, original, original.record), STAT.maxHitPoints)) return value;
  return Math.max(1, Math.min(most, value));
}

/** Whether an item is in a hand or worn, which the editor leaves alone. */
export function equipped(item: Carried): boolean {
  return !!item.original && (item.original.flags & EQUIPPED) !== 0;
}

/** Every object number the save's inventory uses, inside bags as well. */
function usedIds(items: MappedItem[], into = new Set<number>()): Set<number> {
  for (const item of items) {
    into.add(item.id);
    usedIds(item.contents, into);
  }
  return into;
}

/** The flags a new object takes from its prototype (objectCreateWithFrmIdProtoId). */
function newFlags(proto: number): number {
  let flags = proto & (0x08 | 0x10 | 0x800 | 0x1000 | 0x10000000 | 0x20000000 | 0x80000000);
  // Of the ways to be see-through, the first the prototype names.
  for (const trans of [0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x4000]) {
    if (proto & trans) {
      flags |= trans;
      break;
    }
  }
  return flags >>> 0;
}

/**
 * A new item, made as the engine makes one and puts it in an inventory:
 * nowhere on the map, its flags and light from its prototype, a new object
 * number, a weapon loaded, a box full, charges as the prototype has them.
 */
export function mintItem(proto: ItemProto, quantity: number, id: number): Uint8Array {
  const lit = proto.lightIntensity > 0;
  const values = [
    quantity,
    // id, tile, x, y, sx, sy, frame, rotation
    id, -1, 0, 0, 0, 0, 0, 0,
    // picture, flags, elevation, prototype, combat id
    proto.fid, newFlags(proto.flags), 0, proto.pid, -1,
    // light, outline, script, script index
    lit ? Math.min(proto.lightDistance, 8) : 0, lit ? proto.lightIntensity : 0, 0, -1, -1,
    // nothing held: count, room, pointer; then its own flags
    0, 0, 0, 0,
    ...proto.fresh,
  ];
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value | 0, false));
  return out;
}

class Patch {
  readonly view: DataView;
  /** Ranges, in the original's offsets, that writing may change. */
  readonly changed: [number, number][] = [];
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  int(at: number, value: number): void {
    this.view.setInt32(at, value | 0, false);
    this.changed.push([at, at + 4]);
  }
  ints(at: number, values: number[]): void {
    values.forEach((value, index) => this.view.setInt32(at + index * 4, value | 0, false));
    this.changed.push([at, at + values.length * 4]);
  }
  text(at: number, length: number, value: string): void {
    this.data.fill(0, at, at + length);
    for (let i = 0; i < Math.min(value.length, length - 1); i++) this.data[at + i] = value.charCodeAt(i) & 0xff;
    this.changed.push([at, at + length]);
  }
  byte(at: number, value: number): void {
    this.data[at] = value & 0xff;
    this.changed.push([at, at + 1]);
  }
}

export class WriteError extends Error {}

/** The tagged skills as the save keeps them: four slots, empty ones -1. */
function slots(list: number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => list[index] ?? -1);
}

/**
 * Writes a record into a copy of the save it came from, and proves the
 * result. Throws WriteError when the result would not read back as meant.
 */
export function writeSave(rules: Rules, catalog: Catalog, original: Original, record: SaveRecord): Uint8Array {
  const { map } = original;
  const patch = new Patch(original.data.slice());
  const sheet = sheetOf(rules, original, record);

  // The header: who.
  patch.text(NAME_AT, NAME_FIELD, record.name);
  patch.text(DESCRIPTION_AT, DESCRIPTION_FIELD, record.description);

  // The player as an object: hit points, poison, radiation.
  patch.int(map.dude + DUDE.hitPoints * 4, hitPoints(rules, original, record, sheet));
  patch.int(map.dude + DUDE.radiation * 4, Math.max(0, record.radiation));
  patch.int(map.dude + DUDE.poison * 4, Math.max(0, record.poison));

  // A new gender in armour wears that armour's other figure; out of armour the game sees to it itself.
  if (record.gender !== original.record.gender) {
    const worn = record.items.find((item) => item.original && item.original.flags & 0x04000000);
    const armor = worn ? catalog.items.get(worn.pid)?.armor : undefined;
    const figure = armor ? (record.gender === 1 ? armor.femaleFid : armor.maleFid) : -1;
    if (figure !== -1) {
      const at = map.dude + OBJECT.fid * 4;
      patch.int(at, (patch.view.getInt32(at, false) & ~0xfff) | (figure & 0xfff));
    }
  }

  // The character sheet.
  patch.ints(map.base, sheet.base);
  patch.ints(map.bonus, sheet.bonus);
  patch.ints(map.skills, record.skills);
  patch.ints(map.tags, slots(record.tags, 4));
  patch.ints(map.perks, record.perks);
  patch.ints(map.stats, [record.unspent, record.level, record.experience]);
  patch.ints(map.traits, slots(record.traits, 2));
  // The character screen hands out what levels bring from the last level it saw: never one above the level now.
  patch.int(map.lastLevel, Math.min(original.lastLevel, record.level));
  patch.byte(map.perksOwed, record.perksOwed);

  // The inventory, in the order of the list: what the save held as it was, with its new quantity; what is new, made.
  const ids = usedIds(map.items);
  let nextId = Math.max(0, ...[...ids].filter((id) => id < PLAYER_ID)) + 1;
  const pieces: Uint8Array[] = [];
  for (const item of record.items) {
    if (item.original) {
      const bytes = original.data.slice(item.original.start, item.original.end);
      new DataView(bytes.buffer).setInt32(0, item.quantity, false);
      pieces.push(bytes);
      continue;
    }
    const proto = catalog.items.get(item.pid);
    if (!proto) throw new WriteError(`the game's data does not describe item ${item.pid}`);
    while (ids.has(nextId) || nextId === PLAYER_ID) nextId++;
    ids.add(nextId);
    pieces.push(mintItem(proto, item.quantity, nextId));
  }
  const capacity = patch.view.getInt32(map.dude + OBJECT.capacity * 4, false);
  patch.int(map.dude + OBJECT.held * 4, record.items.length);
  if (record.items.length > capacity) patch.int(map.dude + OBJECT.capacity * 4, Math.ceil(record.items.length / 10) * 10);

  const start = map.dude + DUDE.words * 4;
  const inventory = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    inventory.set(piece, at);
    at += piece.length;
  }
  const out = new Uint8Array(patch.data.length - (map.itemsEnd - start) + inventory.length);
  out.set(patch.data.subarray(0, start), 0);
  out.set(inventory, start);
  out.set(patch.data.subarray(map.itemsEnd), start + inventory.length);

  prove(rules, catalog, original, record, out, patch.changed, inventory.length - (map.itemsEnd - start));
  return out;
}

/** Reads a written save back, and throws unless it holds what was meant and nothing else changed. */
function prove(rules: Rules, catalog: Catalog, original: Original, record: SaveRecord, out: Uint8Array, changed: [number, number][], shift: number): void {
  const fail = (what: string): never => {
    throw new WriteError(`the modified save did not read back as meant (${what})`);
  };
  let again: Original;
  try {
    again = readSave(out, original.layout, (pid) => catalog.items.get(pid)?.kind);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const expected = sheetOf(rules, original, record);
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);
  if (again.record.name !== record.name.slice(0, NAME_FIELD - 1)) fail('name');
  if (again.record.description !== record.description.slice(0, DESCRIPTION_FIELD - 1)) fail('description');
  if (!same(again.base, expected.base) || !same(again.bonus, expected.bonus)) fail('statistics');
  if (!same(again.record.skills, record.skills) || !same(again.record.perks, record.perks)) fail('skills or perks');
  if (!same(again.record.tags, slots(record.tags, 4)) || !same(again.record.traits, slots(record.traits, 2))) fail('tags or traits');
  if (again.record.level !== record.level || again.record.experience !== record.experience || again.record.unspent !== record.unspent) fail('level');
  if (again.record.perksOwed !== record.perksOwed) fail('perks owed');
  if (again.record.hitPoints !== hitPoints(rules, original, record)) fail('hit points');
  if (again.record.items.length !== record.items.length) fail('inventory');
  again.record.items.forEach((item, index) => {
    if (item.pid !== record.items[index]!.pid || item.quantity !== record.items[index]!.quantity) fail('inventory');
  });

  // Everything else as it was: before the inventory, and after it, shifted by what the inventory grew or shrank.
  const start = original.map.dude + DUDE.words * 4;
  const free = (offset: number) => changed.some(([from, to]) => offset >= from && offset < to);
  for (let i = 0; i < start; i++) if (out[i] !== original.data[i] && !free(i)) fail(`byte ${i}`);
  for (let i = original.map.itemsEnd; i < original.data.length; i++) {
    if (out[i + shift] !== original.data[i] && !free(i)) fail(`byte ${i}`);
  }
  if (out.length !== original.data.length + shift) fail('length');
  // And the console's own reader still makes sense of it.
  if (!parseCharacter(out, original.layout)) fail('character sheet');
  if (out.length <= HEADER_SIZE) fail('length');
}

/** The experience a level needs, for a record moving to it: what it has when that is enough, else the least. */
export function experienceAt(rules: Rules, record: SaveRecord, level: number): number {
  const least = experienceFor(rules, level);
  const next = level < rules.experience.length ? experienceFor(rules, level + 1) : Number.POSITIVE_INFINITY;
  return record.experience >= least && record.experience < next ? record.experience : least;
}

/** Whether the Tag! perk is taken, which allows a fourth tagged skill. */
export function hasTagPerk(record: SaveRecord): boolean {
  return (record.perks[PERK.tag] ?? 0) > 0;
}
