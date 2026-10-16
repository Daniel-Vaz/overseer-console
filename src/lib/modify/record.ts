/**
 * A saved character as the save editor changes it, and the SAVE.DAT that
 * comes of the changes.
 *
 * The record holds what the player chooses. What follows from it by the
 * game's rules (the derived statistics, what perks add, the hit points that
 * levels bring, what curing an addiction takes back) is worked out when the
 * save is written, from the record and from what the save held: never
 * accumulated step by step, so that any change can be taken back on its own.
 *
 * Writing changes the fields in place, where they are, and splices in the
 * parts whose length changes: the inventory, and the queue of timed events
 * when an addiction is cured. Every other byte stays as the game wrote it,
 * and before the result is handed back it is read again to prove it: what
 * was meant to change reads as changed, and nothing else did.
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
import { Splicer, concat } from './splice';
import { FO1_DRUGS, FO2_DRUGS } from './tables';
import { EVENT, subtilesAround, type QueueEvent, type WorldMap2 } from './tail';
import type { CompanionMap } from './party';

export const NAME_LENGTH = 11;
export const DESCRIPTION_LENGTH = 28;
const NAME_AT = 0x1d;
const NAME_FIELD = 32;
const DESCRIPTION_AT = 0x3d;
const DESCRIPTION_FIELD = 30;
/** The header's date (three halfwords: month, day, year) and the game's clock. */
const DATE_AT = 0x65;
const CLOCK_AT = 0x6b;
/** Most of any one thing a character can carry here. */
export const MAX_QUANTITY = 999_999;
/** The engines number the player 18000; carried things are numbered below. */
export const PLAYER_ID = 18000;
/** The game's clock counts tenths of a second. */
export const TICKS_PER_DAY = 864_000;
/** The prototype's flag for an addiction (critter.cc, dudeEnableState). */
const ADDICTED = 0x10;

export interface Carried {
  /** Stays the same while the item is on the list, for the screen to follow it by. */
  key: string;
  pid: number;
  quantity: number;
  /** The item as the save holds it; none for one the editor adds. */
  original?: MappedItem;
}

/** A member of the party as the editor changes one. */
export interface Companion {
  /** Its object's number. */
  id: number;
  hitPoints: number;
  poison: number;
  radiation: number;
  items: Carried[];
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
  /** The game's global variables: quests, karma, reputations, towns known... */
  globals: number[];
  /** Kills of each kind of creature. */
  kills: number[];
  /** The player's statistic of that name (not karma, which is a global variable). */
  reputation: number;
  /** The game's clock, in tenths of a second since its start. */
  time: number;
  /** Fallout 2's engine: what the player knows of each area of the world map (0 nothing, 1 known, 2 visited). */
  areas: number[];
  /** Fallout 2's engine: the car's fuel. */
  fuel: number;
  party: Companion[];
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
  /** The date the save's header gives, for working out a new one from: month (1-12), day, year. */
  date: [number, number, number];
  /** The prototype's flags (sneaking, addicted...). */
  flags: number;
  /** The party's members, from the map they travel in; null where that map could not be read. */
  party: CompanionMap | null;
}

function latin1(data: Uint8Array, at: number, length: number): string {
  let text = '';
  for (let i = 0; i < length && data[at + i]; i++) text += String.fromCharCode(data[at + i]!);
  return text;
}

/** Reads a save into a record. Throws SaveMapError when the save cannot be accounted for. */
export function readSave(data: Uint8Array, layout: SaveLayout, kindOf: (pid: number) => ItemKind | undefined, party: CompanionMap | null = null): Original {
  const map = mapSave(data, layout, kindOf);
  const words = new Words(data);
  const base = words.ints(map.base, STATS);
  const stats = words.ints(map.stats, 5);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let next = 0;
  const world = map.rest?.world;
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
    globals: words.ints(map.globals.at, map.globals.count),
    kills: words.ints(map.kills, (map.tags - map.kills) / 4),
    reputation: stats[3]!,
    time: view.getUint32(CLOCK_AT, false),
    areas: world?.kind === 'fo2' ? world.areas.map((area) => area.visited) : [],
    fuel: world?.kind === 'fo2' ? world.fuel : 0,
    party: party ? party.members.map((member) => ({ ...member.record, items: member.record.items.map((item) => ({ ...item })) })) : [],
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
    date: [view.getInt16(DATE_AT, false), view.getInt16(DATE_AT + 2, false), view.getInt16(DATE_AT + 4, false)],
    flags: words.int(map.protoFlags),
    party,
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
    globals: record.globals.slice(),
    kills: record.kills.slice(),
    areas: record.areas.slice(),
    party: record.party.map((member) => ({ ...member, items: member.items.map((item) => ({ ...item })) })),
  };
}

/** In-game time of day as hours times 100 plus minutes. */
export function clockOf(time: number): number {
  const minutes = Math.floor(time / 600);
  return 100 * (Math.floor(minutes / 60) % 24) + (minutes % 60);
}

// ---------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------

/** The games' calendar: twelve months, no leap years (gameTimeGetDate). */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The date at a new reading of the clock, worked out from the date the save
 * gives for its own: the engines count days the same way from a starting
 * date the game may choose (Fallout Et Tu starts in 2161), and the header
 * already accounts for that.
 */
export function dateAt(original: Original, time: number): [month: number, day: number, year: number] {
  const [month, day, year] = original.date;
  const passed = Math.floor(time / TICKS_PER_DAY) - Math.floor(original.record.time / TICKS_PER_DAY);
  let count = year * 365 + MONTH_DAYS.slice(0, Math.max(0, month - 1)).reduce((sum, days) => sum + days, 0) + (day - 1) + passed;
  const newYear = Math.floor(count / 365);
  count -= newYear * 365;
  let newMonth = 0;
  while (count >= MONTH_DAYS[newMonth]!) count -= MONTH_DAYS[newMonth++]!;
  return [newMonth + 1, count + 1, newYear];
}

// ---------------------------------------------------------------------
// Addictions
// ---------------------------------------------------------------------

/** The addiction variable a drug leads to, in an engine's own table. */
export function addictionOf(layout: SaveLayout, pid: number): number | undefined {
  return (layout === 'fo1' ? FO1_DRUGS : FO2_DRUGS).find(([drug]) => drug === pid)?.[1];
}

/** Every addiction variable an engine knows. */
export function addictionVariables(layout: SaveLayout): number[] {
  return [...new Set((layout === 'fo1' ? FO1_DRUGS : FO2_DRUGS).map(([, gvar]) => gvar!))];
}

/**
 * The player's withdrawal events that curing addictions takes away: those
 * for a drug whose addiction the record no longer has. A withdrawal under
 * way (its event the one that ends it) has its effects taken back as well.
 */
export function curedWithdrawals(original: Original, record: SaveRecord): QueueEvent[] {
  const queue = original.map.queue;
  if (!queue) return [];
  // The player's object number, as the save gives it (18000 in both engines).
  const player = new Words(original.data).int(original.map.dude + OBJECT.id * 4);
  return queue.events.filter((event) => {
    if (event.type !== EVENT.withdrawal || event.owner !== player) return false;
    const gvar = addictionOf(original.layout, event.data[1]!);
    return gvar !== undefined && (original.record.globals[gvar] ?? 0) !== 0 && (record.globals[gvar] ?? 0) === 0;
  });
}

/** What taking back the withdrawals under way does to the bonus statistics (perkRemoveEffect). */
function withdrawalBonusChange(rules: Rules, events: QueueEvent[]): number[] {
  const change = new Array<number>(rules.stats.length).fill(0);
  for (const event of events) {
    if (event.data[0] !== 0) continue; // not yet begun: nothing to take back
    const perk = rules.perks[event.data[2]!];
    if (!perk) continue;
    if (perk.stat >= 0 && perk.stat < change.length) change[perk.stat]! -= perk.statModifier;
    if (perk.maxRank === -1) perk.special.forEach((value, stat) => (change[stat]! -= value));
  }
  return change;
}

/** Whether the queue of timed events can be changed: it must have been read. */
export function canCure(original: Original): boolean {
  return original.map.queue !== null;
}

// ---------------------------------------------------------------------
// The character sheet
// ---------------------------------------------------------------------

/** The hit points the levels gained here bring: those of a level-up, for each. Taking levels away takes none. */
export function levelHitPoints(rules: Rules, original: Original, record: SaveRecord): number {
  const gained = record.level - original.record.level;
  return gained > 0 ? gained * hitPointsPerLevel(rules, sheetOf(rules, original, record, false)) : 0;
}

/**
 * The character sheet a record makes: base statistics with the chosen
 * S.P.E.C.I.A.L. (and, unless `derived` is false, the statistics derived from
 * it worked out again), bonus statistics with what the perks now add, what
 * cured withdrawals no longer take, and the levels' hit points.
 */
export function sheetOf(rules: Rules, original: Original, record: SaveRecord, derived = true): Sheet {
  const base = original.base.slice();
  record.special.forEach((value, stat) => (base[stat] = value));
  base[STAT.age] = record.age;
  base[STAT.gender] = record.gender;
  const change = perkBonusChange(rules, original.record.perks, record.perks);
  const cured = withdrawalBonusChange(rules, curedWithdrawals(original, record));
  const bonus = original.bonus.map((value, stat) => value + (change[stat] ?? 0) + (cured[stat] ?? 0));
  const sheet: Sheet = {
    base,
    bonus,
    skills: record.skills,
    tags: record.tags,
    perks: record.perks,
    traits: record.traits,
    level: record.level,
    difficulty: original.difficulty,
    clock: clockOf(record.time),
    globals: record.globals,
  };
  if (!derived) return sheet;
  sheet.bonus[STAT.maxHitPoints]! += levelHitPoints(rules, original, record);
  // Only what was changed is written: the statistics the game derived are left as it left them unless what they come from changed.
  const before = original.record;
  const same = (a: number[], b: number[]) => a.every((value, index) => value === b[index]);
  if (!same(record.special, before.special) || !same(record.traits, before.traits) || !same(record.perks, before.perks) || cured.some(Boolean)) {
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

/** Every object number the given items use, inside bags as well. */
export function usedIds(items: MappedItem[], into = new Set<number>()): Set<number> {
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

/**
 * An inventory written out: the items it held as they were (with their new
 * quantities), the new ones made. `ids` are the object numbers already taken;
 * new ones are given the next free numbers below the player's.
 */
export function inventoryBytes(catalog: Catalog, data: Uint8Array, items: Carried[], ids: Set<number>): Uint8Array {
  let nextId = Math.max(0, ...[...ids].filter((id) => id < PLAYER_ID)) + 1;
  const pieces: Uint8Array[] = [];
  for (const item of items) {
    if (item.original) {
      const bytes = data.slice(item.original.start, item.original.end);
      new DataView(bytes.buffer).setInt32(0, item.quantity, false);
      pieces.push(bytes);
      continue;
    }
    const proto = catalog.items.get(item.pid);
    if (!proto) throw new WriteError(`the game's data does not describe item ${item.pid}`);
    while (ids.has(nextId) || nextId === PLAYER_ID) nextId = nextId >= PLAYER_ID - 1 ? 1 : nextId + 1;
    ids.add(nextId);
    pieces.push(mintItem(proto, item.quantity, nextId));
  }
  return concat(pieces);
}

export class WriteError extends Error {}

/** The tagged skills as the save keeps them: four slots, empty ones -1. */
function slots(list: number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => list[index] ?? -1);
}

const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** What the editor needs to know of the world map to reveal an area: the size of its circle, by area. */
export interface WriteContext {
  areaSizes?: number[];
  /** Object numbers the party's map already uses, which new items in the player's pack must not take. */
  takenIds?: Set<number>;
}

/**
 * Writes a record into a copy of the save it came from, and proves the
 * result. Throws WriteError when the result would not read back as meant.
 */
export function writeSave(rules: Rules, catalog: Catalog, original: Original, record: SaveRecord, context: WriteContext = {}): Uint8Array {
  const { map } = original;
  const patch = new Splicer(original.data);
  const sheet = sheetOf(rules, original, record);

  // The header: who, and when.
  patch.text(NAME_AT, NAME_FIELD, record.name);
  patch.text(DESCRIPTION_AT, DESCRIPTION_FIELD, record.description);
  if (record.time !== original.record.time) {
    const [month, day, year] = dateAt(original, record.time);
    patch.short(DATE_AT, month);
    patch.short(DATE_AT + 2, day);
    patch.short(DATE_AT + 4, year);
    patch.int(CLOCK_AT, record.time);
  }

  // The global variables, both copies the save keeps.
  if (!sameList(record.globals, original.record.globals)) {
    patch.ints(map.globals.at, record.globals);
    patch.ints(map.globals.again, record.globals);
  }

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
      patch.int(at, (patch.read(at) & ~0xfff) | (figure & 0xfff));
    }
  }

  // The character sheet.
  patch.ints(map.base, sheet.base);
  patch.ints(map.bonus, sheet.bonus);
  patch.ints(map.skills, record.skills);
  if (!sameList(record.kills, original.record.kills)) patch.ints(map.kills, record.kills);
  patch.ints(map.tags, slots(record.tags, 4));
  patch.ints(map.perks, record.perks);
  patch.ints(map.stats, [record.unspent, record.level, record.experience]);
  if (record.reputation !== original.record.reputation) patch.int(map.stats + 12, record.reputation);
  patch.ints(map.traits, slots(record.traits, 2));
  // The character screen hands out what levels bring from the last level it saw: never one above the level now.
  patch.int(map.lastLevel, Math.min(original.lastLevel, record.level));
  patch.byte(map.perksOwed, record.perksOwed);

  // Addictions: the engine's flag for them follows the variables, and cured ones take their withdrawals with them.
  const addictions = addictionVariables(original.layout);
  if (addictions.some((gvar) => (record.globals[gvar] ?? 0) !== (original.record.globals[gvar] ?? 0))) {
    const addicted = addictions.some((gvar) => (record.globals[gvar] ?? 0) !== 0);
    patch.int(map.protoFlags, addicted ? original.flags | ADDICTED : original.flags & ~ADDICTED);
  }
  const cured = curedWithdrawals(original, record);
  if (cured.length) {
    const queue = map.queue!;
    const kept = queue.events.filter((event) => !cured.includes(event));
    const count = new Uint8Array(4);
    new DataView(count.buffer).setInt32(0, kept.length, false);
    patch.splice(queue.at, queue.end, concat([count, ...kept.map((event) => original.data.subarray(event.at, event.end))]));
  }

  // The world map (Fallout 2's engine): areas made known, the car's fuel.
  const world = map.rest?.world;
  if (world?.kind === 'fo2') writeWorld(patch, world, original.record, record, context.areaSizes ?? []);

  // The inventory, in the order of the list: what the save held as it was, with its new quantity; what is new, made.
  const ids = usedIds(map.items, new Set(context.takenIds ?? []));
  const inventory = inventoryBytes(catalog, original.data, record.items, ids);
  const capacity = patch.read(map.dude + OBJECT.capacity * 4);
  patch.int(map.dude + OBJECT.held * 4, record.items.length);
  if (record.items.length > capacity) patch.int(map.dude + OBJECT.capacity * 4, Math.ceil(record.items.length / 10) * 10);
  patch.splice(map.dude + DUDE.words * 4, map.itemsEnd, inventory);

  const built = patch.build();
  prove(rules, catalog, original, record, built.data, patch, built);
  return built.data;
}

/** Areas made known on Fallout 2's world map, as the engine makes them known (wmAreaMarkVisitedState), and the car's fuel. */
function writeWorld(patch: Splicer, world: WorldMap2, was: SaveRecord, record: SaveRecord, sizes: number[]): void {
  if (record.fuel !== was.fuel) patch.int(world.fuelAt, Math.max(0, record.fuel));
  const marked = new Set<number>();
  world.areas.forEach((area, index) => {
    const visited = record.areas[index] ?? area.visited;
    if (visited === area.visited) return;
    patch.int(area.at + 12, visited);
    if (visited === 0) return;
    // Known now: shown on the map, and the fog lifted around its mark.
    if (area.state !== 1) patch.int(area.at + 8, 1);
    for (const subtile of subtilesAround(world, area, sizes[index] ?? 2)) {
      if (marked.has(subtile)) continue;
      const at = world.subtiles + subtile * 4;
      if (patch.read(at) === 0) {
        patch.int(at, 1);
        marked.add(subtile);
      }
    }
  });
}

/** Reads a written save back, and throws unless it holds what was meant and nothing else changed. */
function prove(rules: Rules, catalog: Catalog, original: Original, record: SaveRecord, out: Uint8Array, patch: Splicer, built: { data: Uint8Array; moved: (offset: number) => number }): void {
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
  if (again.record.name !== record.name.slice(0, NAME_FIELD - 1)) fail('name');
  if (again.record.description !== record.description.slice(0, DESCRIPTION_FIELD - 1)) fail('description');
  if (!sameList(again.base, expected.base) || !sameList(again.bonus, expected.bonus)) fail('statistics');
  if (!sameList(again.record.skills, record.skills) || !sameList(again.record.perks, record.perks)) fail('skills or perks');
  if (!sameList(again.record.tags, slots(record.tags, 4)) || !sameList(again.record.traits, slots(record.traits, 2))) fail('tags or traits');
  if (again.record.level !== record.level || again.record.experience !== record.experience || again.record.unspent !== record.unspent) fail('level');
  if (again.record.perksOwed !== record.perksOwed) fail('perks owed');
  if (again.record.hitPoints !== hitPoints(rules, original, record)) fail('hit points');
  if (again.record.items.length !== record.items.length) fail('inventory');
  again.record.items.forEach((item, index) => {
    if (item.pid !== record.items[index]!.pid || item.quantity !== record.items[index]!.quantity) fail('inventory');
  });
  if (!sameList(again.record.globals, record.globals)) fail('global variables');
  if (!sameList(new Words(out).ints(again.map.globals.again, again.map.globals.count), record.globals)) fail('global variables');
  if (!sameList(again.record.kills, record.kills) || again.record.reputation !== record.reputation) fail('kills or reputation');
  if (again.record.time !== record.time) fail('time');
  if (record.areas.length && (!sameList(again.record.areas, record.areas) || again.record.fuel !== Math.max(0, record.fuel))) fail('world map');
  // What follows the record reads as it did, where it did.
  if (!!original.map.rest !== !!again.map.rest) fail('the end of the save');
  if (original.map.queue && again.map.queue?.events.length !== original.map.queue.events.length - curedWithdrawals(original, record).length) fail('timed events');

  // Everything else as it was, where it now lies.
  const wrong = patch.untouched(built);
  if (wrong >= 0) fail(`byte ${wrong}`);
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
