/**
 * A map as the engines write one (map.cc): a header, the map's own
 * variables, the floor and roof of every level that has any, the scripts,
 * and the objects, each followed by what it holds. A save keeps one of these
 * for every map visited, gzipped; the party travels in the one the player
 * was on.
 *
 * How many words an object stores depends on what it is, which only its
 * prototype says: an item's kind, a piece of scenery's (proto.cc,
 * objectDataRead). The map is read to the last byte or not at all.
 */
import { gunzipSync, gzipSync } from 'fflate';
import { Words } from '../savefile';
import { EXTRA_WORDS, OBJECT, type ItemKind, type MappedItem } from './savemap';

const HEADER = 236;
const SQUARES = 100 * 100;
const SCRIPT_TYPES = 5;
const EXTENT = 16;
/** Everything of an object up to and including its flags word (or, for a critter, its reaction). */
const OBJECT_WORDS = 22;
/** A critter keeps its combat data, hit points, radiation and poison after that. */
const CRITTER_WORDS = 32;

export const CRITTER = { hitPoints: 29, radiation: 30, poison: 31, team: 27 } as const;

/** What the object's prototype number says it is: its top byte. */
export const OBJECT_TYPE = { item: 0, critter: 1, scenery: 2, wall: 3, tile: 4, misc: 5 } as const;

/** Scenery kinds that store more than their flags: door, stairs, elevator, ladders (proto_types.h). */
const SCENERY_WORDS = [1, 2, 2, 2, 2, 0];

export interface MapObject {
  /** Where its words start, and where it ends, after everything it holds. */
  at: number;
  end: number;
  id: number;
  pid: number;
  elevation: number;
  /** Where what it holds starts: a quantity, then an object, for each. */
  inventoryAt: number;
  items: MappedItem[];
}

export interface MapFile {
  version: number;
  name: string;
  objects: MapObject[];
}

export class MapFileError extends Error {}

/** What the reader needs to know of prototypes: an item's kind, a piece of scenery's (0 door ... 5 generic). */
export interface Prototypes {
  item(pid: number): ItemKind | undefined;
  scenery(pid: number): number | undefined | Promise<number | undefined>;
}

/** A saved map's bytes: gzipped as a save keeps it, or not. */
export function unpackMap(file: Uint8Array): Uint8Array {
  return file[0] === 0x1f && file[1] === 0x8b ? gunzipSync(file) : file;
}

/** A map packed as the engine packs the ones it puts in a save. */
export function packMap(data: Uint8Array): Uint8Array {
  return gzipSync(data, { level: 6 });
}

/**
 * The words an object stores after its 18 own: what it holds (3), and its
 * flags and what its kind keeps, or a critter's state. Asks for a piece of
 * scenery's kind by yielding its prototype number.
 */
function* dataWords(words: Words, at: number, version: number, protos: Prototypes): Generator<number, number, number | undefined> {
  const pid = words.uint(at + OBJECT.pid * 4);
  switch (pid >>> 24) {
    case OBJECT_TYPE.critter:
      return CRITTER_WORDS - 18;
    case OBJECT_TYPE.item: {
      const kind = protos.item(pid);
      if (!kind) throw new MapFileError(`the game's data does not describe item ${pid}`);
      return 4 + EXTRA_WORDS[kind];
    }
    case OBJECT_TYPE.scenery: {
      const kind: number | undefined = yield pid;
      if (kind === undefined || kind < 0 || kind > 5) throw new MapFileError(`the game's data does not describe scenery ${pid}`);
      // A ladder of a map made for Fallout 1 keeps one word, not two.
      return 4 + (version === 19 && (kind === 3 || kind === 4) ? 1 : SCENERY_WORDS[kind]!);
    }
    case OBJECT_TYPE.misc:
      return 4 + ((pid & 0xffffff) >= 16 && (pid & 0xffffff) <= 23 ? 4 : 0);
    default:
      return 4;
  }
}

/** Reads one object at `at` and everything it holds. Returns where it ends. */
function* readObject(words: Words, at: number, version: number, protos: Prototypes, items: MappedItem[] | null): Generator<number, MapObject, number | undefined> {
  if (!words.has(at, OBJECT_WORDS * 4)) throw new MapFileError('an object runs past the end of the map');
  const held = words.int(at + OBJECT.held * 4);
  const capacity = words.int(at + OBJECT.capacity * 4);
  if (held < 0 || held > 10_000 || capacity < held) throw new MapFileError('an object does not read as one');
  const inventoryAt = at + 18 * 4 + (yield* dataWords(words, at, version, protos)) * 4;
  const inside: MappedItem[] = [];
  let next = inventoryAt;
  for (let index = 0; index < held; index++) {
    const quantity = words.int(next);
    if (quantity < 1) throw new MapFileError('something held does not read as an item');
    const object = yield* readObject(words, next + 4, version, protos, null);
    const pid = object.pid;
    const extraAt = next + 4 + 22 * 4;
    const kind = protos.item(pid);
    inside.push({
      start: next,
      end: object.end,
      object: next + 4,
      quantity,
      pid,
      id: object.id,
      flags: words.uint(next + 4 + OBJECT.flags * 4),
      extra: kind ? words.ints(extraAt, EXTRA_WORDS[kind]) : [],
      contents: object.items,
    });
    next = object.end;
  }
  if (items) items.push(...inside);
  return {
    at,
    end: next,
    id: words.int(at + OBJECT.id * 4),
    pid: words.uint(at + OBJECT.pid * 4),
    elevation: words.int(at + 10 * 4),
    inventoryAt,
    items: inside,
  };
}

function* readMapSteps(data: Uint8Array, protos: Prototypes): Generator<number, MapFile, number | undefined> {
  const words = new Words(data);
  if (!words.has(0, HEADER)) throw new MapFileError('the map ends in its header');
  const version = words.int(0);
  if (version !== 19 && version !== 20) throw new MapFileError(`map version ${version} is not one the engines write`);
  let name = '';
  for (let i = 4; i < 20 && data[i]; i++) name += String.fromCharCode(data[i]!);
  const locals = words.int(4 + 16 + 12);
  const flags = words.int(4 + 16 + 20);
  const globals = words.int(4 + 16 + 28);
  if (locals < 0 || locals > 100_000 || globals < 0 || globals > 100_000) throw new MapFileError('the map has no sensible count of variables');
  let at = HEADER + (globals + locals) * 4;
  // The squares of each level the map has: a level the header flags (2, 4, 8) is empty and not written.
  for (let elevation = 0; elevation < 3; elevation++) if ((flags & (2 << elevation)) === 0) at += SQUARES * 4;

  // The scripts: per kind a count, then whole extents of sixteen, each script as long as its kind's.
  for (let type = 0; type < SCRIPT_TYPES; type++) {
    const count = words.int(at);
    if (count < 0 || count > 100_000) throw new MapFileError('the map has no sensible count of scripts');
    at += 4;
    for (let extent = 0; extent < Math.ceil(count / EXTENT); extent++) {
      for (let slot = 0; slot < EXTENT; slot++) {
        const kind = words.int(at) >>> 24;
        at += 4 * (16 + (kind === 1 ? 2 : kind === 2 ? 1 : 0));
      }
      const length = words.int(at);
      if (length !== Math.min(EXTENT, count - extent * EXTENT)) throw new MapFileError('a list of scripts does not read as one');
      at += 8;
    }
  }

  // The objects: a total, then for each level its count and its objects.
  const total = words.int(at);
  at += 4;
  const objects: MapObject[] = [];
  for (let elevation = 0; elevation < 3; elevation++) {
    const count = words.int(at);
    if (count < 0 || count > 1_000_000) throw new MapFileError('the map has no sensible count of objects');
    at += 4;
    for (let index = 0; index < count; index++) {
      const object = yield* readObject(words, at, version, protos, null);
      objects.push(object);
      at = object.end;
    }
  }
  if (objects.length !== total) throw new MapFileError('the map counts its objects otherwise than it holds them');
  if (at !== data.length) throw new MapFileError('the map does not end where its objects do');
  return { version, name, objects };
}

/** Reads a map (not gzipped). Throws MapFileError, saying why, when it does not read to the last byte. */
export async function readMap(data: Uint8Array, protos: Prototypes): Promise<MapFile> {
  const steps = readMapSteps(data, protos);
  const known = new Map<number, number | undefined>();
  try {
    let step = steps.next();
    while (!step.done) {
      const pid = step.value;
      if (!known.has(pid)) known.set(pid, await protos.scenery(pid));
      step = steps.next(known.get(pid));
    }
    return step.value;
  } catch (err) {
    if (err instanceof MapFileError) throw err;
    if (err instanceof RangeError) throw new MapFileError('the map ends before everything in it was read');
    throw err;
  }
}
