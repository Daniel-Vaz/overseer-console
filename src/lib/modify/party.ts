/**
 * The party: who travels with the player, as a save keeps them.
 *
 * SAVE.DAT names the members by their objects' numbers; the objects
 * themselves, with everything they carry and their hit points, are saved in
 * the map the player was on, gzipped in the slot (loadsave.cc, _GameMap2Slot).
 * Their statistics are in their prototypes, which the slot keeps copies of as
 * they level up; their names in the game's pro_crit.msg.
 *
 * Changing a member changes that map: its hit points where they are, its
 * inventory spliced in, everything else as the game wrote it, proved by
 * reading the map again.
 */
import { messages } from '../gamefacts';
import type { GameData } from '../gamedata';
import { listNames, type Catalog } from './catalog';
import { CRITTER, MapFileError, OBJECT_TYPE, packMap, readMap, unpackMap, type MapFile, type MapObject } from './mapfile';
import { WriteError, inventoryBytes, usedIds, type Carried, type Companion } from './record';
import { OBJECT, type MappedItem } from './savemap';
import { Splicer } from './splice';

export interface Member {
  id: number;
  pid: number;
  name: string;
  /** The most hit points it can have: its prototype's, base and bonus. */
  maxHitPoints: number;
  object: MapObject;
  /** As the map holds it. */
  record: Companion;
}

export interface CompanionMap {
  /** The map's file in the slot, as the slot spells it. */
  key: string;
  path: string;
  /** Whether the slot keeps it gzipped, as the engines do. */
  packed: boolean;
  /** Its bytes, unpacked. */
  data: Uint8Array;
  file: MapFile;
  members: Member[];
  /** Every object number the map uses, inside things as well. */
  ids: Set<number>;
}

export interface SlotFile {
  key: string;
  path: string;
  data: Uint8Array;
}

export class PartyError extends Error {}

/** A critter prototype's message number, and its most hit points (base and bonus). */
function critterFacts(file: Uint8Array): { message: number; maxHitPoints: number } | null {
  if (file.length < 220) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  return { message: view.getInt32(4, false), maxHitPoints: view.getInt32(48 + 7 * 4, false) + view.getInt32(188 + 7 * 4, false) };
}

/** The scenery kind a prototype gives (0 door ... 5 generic), read as the map needs it. */
function sceneryReader(data: GameData): (pid: number) => Promise<number | undefined> {
  let list: Promise<string[]> | null = null;
  return async (pid) => {
    list ??= data.read('proto/scenery/scenery.lst').then((file) => (file ? listNames(file) : []));
    const name = (await list)[(pid & 0xffffff) - 1];
    const file = name ? await data.read(`proto/scenery/${name}`) : null;
    return file && file.length >= 36 ? new DataView(file.buffer, file.byteOffset, file.byteLength).getInt32(32, false) : undefined;
  };
}

/** Reads a map the way the party's is read. */
export function readMapWith(data: GameData, catalog: Catalog, map: Uint8Array): Promise<MapFile> {
  return readMap(map, { item: (pid) => catalog.items.get(pid)?.kind, scenery: sceneryReader(data) });
}

function itemsOf(object: MapObject): Carried[] {
  return object.items.map((item, index) => ({ key: `c${object.id}:${index}`, pid: item.pid, quantity: item.quantity, original: item }));
}

/**
 * Finds the party's members in the map the player was on (`mapName`, from
 * the save's header), in the slot's files. Null when no one travels with the
 * player. Throws PartyError, saying why, when they cannot be read.
 */
export async function readParty(data: GameData, catalog: Catalog, files: SlotFile[], prefix: string, mapName: string, members: number[]): Promise<CompanionMap | null> {
  if (!members.length) return null;
  const key = `${prefix}${mapName.toLowerCase()}.sav`;
  const stored = files.find((file) => file.key === key);
  if (!stored) throw new PartyError(`the map the party is in (${mapName}) is not in the slot`);
  const packed = stored.data[0] === 0x1f && stored.data[1] === 0x8b;
  let unpacked: Uint8Array;
  let file: MapFile;
  try {
    unpacked = unpackMap(stored.data);
    file = await readMapWith(data, catalog, unpacked);
  } catch (err) {
    throw new PartyError(err instanceof MapFileError ? err.message : `the map the party is in could not be read`);
  }

  const critters = await data.read('proto/critters/critters.lst');
  const names = critters ? listNames(critters) : [];
  const words = await data.read('text/english/game/pro_crit.msg');
  const said = words ? messages(words) : new Map<number, string>();
  const found: Member[] = [];
  for (const id of members) {
    // A member is numbered after its prototype, 18000 up (partyMemberAdd); the map's other objects may share
    // smaller numbers among themselves. One that is not a creature (Fallout 2's car trunk) is not one to change here.
    const object = file.objects.find((candidate) => candidate.id === id && candidate.pid >>> 24 === OBJECT_TYPE.critter);
    if (!object) continue;
    const protoName = names[(object.pid & 0xffffff) - 1];
    // The slot's copy of the prototype first: a member levels up in it.
    const own = protoName ? files.find((entry) => entry.key === `${prefix}proto/critters/${protoName.toLowerCase()}`) : undefined;
    const proto = own ? unpackMap(own.data) : protoName ? await data.read(`proto/critters/${protoName}`) : null;
    const facts = proto ? critterFacts(proto) : null;
    const view = new DataView(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength);
    const record: Companion = {
      id,
      hitPoints: view.getInt32(object.at + CRITTER.hitPoints * 4, false),
      radiation: view.getInt32(object.at + CRITTER.radiation * 4, false),
      poison: view.getInt32(object.at + CRITTER.poison * 4, false),
      items: itemsOf(object),
    };
    found.push({
      id,
      pid: object.pid,
      name: (facts ? said.get(facts.message) : undefined) || `Companion ${id}`,
      maxHitPoints: Math.max(facts?.maxHitPoints ?? record.hitPoints, record.hitPoints, 1),
      object,
      record,
    });
  }
  if (!found.length) return null;
  const ids = new Set<number>();
  for (const object of file.objects) {
    ids.add(object.id);
    usedIds(object.items, ids);
  }
  return { key, path: stored.path, packed, data: unpacked, file, members: found, ids };
}

const sameItems = (a: Carried[], b: Carried[]) => a.length === b.length && a.every((item, index) => item.pid === b[index]!.pid && item.quantity === b[index]!.quantity && item.key === b[index]!.key);

/** Whether the record changes a member of the party. */
export function partyChanged(party: CompanionMap | null, after: Companion[]): boolean {
  if (!party) return false;
  return party.members.some((member) => {
    const now = after.find((entry) => entry.id === member.id);
    return !!now && (now.hitPoints !== member.record.hitPoints || now.poison !== member.record.poison || now.radiation !== member.record.radiation || !sameItems(now.items, member.record.items));
  });
}

/**
 * Writes the party's changes into a copy of their map, proves it, and
 * returns it as the slot keeps it (gzipped where it was). `takenIds` are
 * object numbers the save uses elsewhere (the player's things), which new
 * items must not take.
 */
export async function writeParty(data: GameData, catalog: Catalog, party: CompanionMap, after: Companion[], takenIds: Set<number>): Promise<Uint8Array> {
  const patch = new Splicer(party.data);
  const ids = new Set([...party.ids, ...takenIds]);
  for (const member of party.members) {
    const now = after.find((entry) => entry.id === member.id);
    if (!now) continue;
    const at = member.object.at;
    patch.int(at + CRITTER.hitPoints * 4, Math.max(1, Math.min(member.maxHitPoints, now.hitPoints)));
    patch.int(at + CRITTER.radiation * 4, Math.max(0, now.radiation));
    patch.int(at + CRITTER.poison * 4, Math.max(0, now.poison));
    if (sameItems(now.items, member.record.items)) continue;
    const capacity = patch.read(at + OBJECT.capacity * 4);
    patch.int(at + OBJECT.held * 4, now.items.length);
    if (now.items.length > capacity) patch.int(at + OBJECT.capacity * 4, Math.ceil(now.items.length / 10) * 10);
    patch.splice(member.object.inventoryAt, member.object.end, inventoryBytes(catalog, party.data, now.items, ids));
  }
  const built = patch.build();

  // Read it back: every member as meant, and nothing else changed.
  const fail = (what: string): never => {
    throw new WriteError(`the party's map did not read back as meant (${what})`);
  };
  let again: MapFile;
  try {
    again = await readMapWith(data, catalog, built.data);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (again.objects.length !== party.file.objects.length) fail('objects');
  const view = new DataView(built.data.buffer);
  for (const member of party.members) {
    const now = after.find((entry) => entry.id === member.id);
    const object = again.objects.find((candidate) => candidate.id === member.id && candidate.pid >>> 24 === OBJECT_TYPE.critter);
    if (!now || !object) {
      if (!object) fail(member.name);
      continue;
    }
    const word = (index: number) => view.getInt32(object.at + index * 4, false);
    if (word(CRITTER.hitPoints) !== Math.max(1, Math.min(member.maxHitPoints, now.hitPoints)) || word(CRITTER.radiation) !== Math.max(0, now.radiation) || word(CRITTER.poison) !== Math.max(0, now.poison)) fail(member.name);
    const items: MappedItem[] = object.items;
    if (items.length !== now.items.length || items.some((item, index) => item.pid !== now.items[index]!.pid || item.quantity !== now.items[index]!.quantity)) fail(`${member.name}'s inventory`);
  }
  const wrong = patch.untouched(built);
  if (wrong >= 0) fail(`byte ${wrong}`);
  return party.packed ? packMap(built.data) : built.data;
}
