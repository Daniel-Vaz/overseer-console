/**
 * The rest of a SAVE.DAT, after the character screen's own record: the world
 * map, the movies seen, the skills used today, the party, the queue of timed
 * events and the interface bar (loadsave.cc, in each engine's order).
 *
 * The editor reads these to change what they hold (the towns known, the car's
 * fuel, the party's members, a withdrawal in progress), and only when the
 * whole of them reads exactly to the end of the file: a save that does not
 * is changed in none of them.
 *
 * Fallout 1 writes its queue of events earlier, between the player's
 * statistics and the traits; it is read by the same function from there.
 */
import { Words, type SaveLayout } from '../savefile';

/** Words stored after an event's time, kind and owner, for each kind of event (queue.cc's event table). */
const EVENT_WORDS: Record<SaveLayout, readonly number[]> = {
  fo1: [6, 0, 3, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0],
  fo2: [6, 0, 3, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
};

/** Kinds of timed event the editor deals with. */
export const EVENT = { drug: 0, withdrawal: 2 } as const;

export interface QueueEvent {
  /** Where it starts and ends. */
  at: number;
  end: number;
  time: number;
  type: number;
  /** The object it happens to: 18000 is the player. */
  owner: number;
  data: number[];
}

export interface Queue {
  at: number;
  end: number;
  events: QueueEvent[];
}

/** An area of Fallout 2's world map as the save holds it. */
export interface MapArea {
  /** Where its words start: x, y, state, visited state, entrances. */
  at: number;
  x: number;
  y: number;
  /** 1: the game lets it be shown. */
  state: number;
  /** 0 unknown, 1 known, 2 visited (3: known, the way Fallout 1 marks it). */
  visited: number;
}

/** Fallout 2's world map. */
export interface WorldMap2 {
  kind: 'fo2';
  at: number;
  end: number;
  /** Where the car's fuel is kept, and how much there is. */
  fuel: number;
  fuelAt: number;
  areas: MapArea[];
  /** The fog over the map: a state per subtile (0 unknown, 1 known, 2 visited), 7 x 6 of them per tile, row by row. */
  subtiles: number;
  tiles: number;
  across: number;
}

/** Fallout 1's world map: the fog, then which towns are known (as variables drive it, see world.ts). */
export interface WorldMap1 {
  kind: 'fo1';
  at: number;
  end: number;
}

export interface Party {
  at: number;
  /** The objects of the party's members other than the player, by number. */
  members: number[];
  /** Fallout 2: each possible companion's level, level-ups and whether early, three words each. */
  levels: number;
  end: number;
}

export interface SaveRest {
  world: WorldMap1 | WorldMap2;
  party: Party;
  /** Fallout 2's queue (Fallout 1's is earlier in the file). */
  queue?: Queue;
}

const MOVIES: Record<SaveLayout, number> = { fo1: 14, fo2: 17 };
/** Times each skill was used today: 18 skills, three each. */
const SKILL_USES = 18 * 3 * 4;
/** Fallout 1's world map: a byte per square of its 29 x 31 grid, a byte per town and entrance (15 x 7), and six words. */
const FO1_WORLD = 31 * 29 + 15 * 7 + 6 * 4;
/** The interface bar: shown, hidden, the hand in use, its end-of-turn buttons. */
const INTERFACE = 16;
const SUBTILES_PER_TILE = 7 * 6;

class Bad extends Error {}

const need = (ok: boolean): void => {
  if (!ok) throw new Bad();
};

/** Reads a queue of timed events starting at `at`. Null when it does not read as one. */
export function readQueue(words: Words, at: number, layout: SaveLayout): Queue | null {
  try {
    const count = words.int(at);
    if (count < 0 || count > 10_000) return null;
    const events: QueueEvent[] = [];
    let next = at + 4;
    for (let i = 0; i < count; i++) {
      const type = words.int(next + 4);
      const extra = EVENT_WORDS[layout][type];
      if (extra === undefined) return null;
      events.push({ at: next, end: next + 12 + 4 * extra, time: words.uint(next), type, owner: words.int(next + 8), data: words.ints(next + 12, extra) });
      next += 12 + 4 * extra;
    }
    return { at, end: next, events };
  } catch {
    return null;
  }
}

function worldMap2(words: Words, at: number): WorldMap2 {
  const fuelAt = at + 40;
  const fuel = words.int(fuelAt);
  const count = words.int(at + 44);
  need(count >= 1 && count <= 500 && fuel >= 0 && fuel <= 1_000_000);
  let next = at + 48;
  const areas: MapArea[] = [];
  for (let area = 0; area < count; area++) {
    const [x, y, state, visited, entrances] = words.ints(next, 5) as [number, number, number, number, number];
    need((state === 0 || state === 1) && ((visited >= 0 && visited <= 3) || visited === -66) && entrances >= 0 && entrances <= 10);
    areas.push({ at: next, x, y, state, visited });
    next += 20 + entrances * 4;
  }
  const tiles = words.int(next);
  const across = words.int(next + 4);
  need(tiles >= 1 && tiles <= 1000 && across >= 1 && tiles % across === 0);
  const subtiles = next + 8;
  for (let i = 0; i < tiles * SUBTILES_PER_TILE; i++) {
    const state = words.int(subtiles + i * 4);
    need(state >= 0 && state <= 2);
  }
  next = subtiles + tiles * SUBTILES_PER_TILE * 4;
  const counters = words.int(next);
  need(counters >= 0 && counters <= 10_000);
  next += 4 + counters * 12;
  need(words.has(next, 0));
  return { kind: 'fo2', at, end: next, fuel, fuelAt, areas, subtiles, tiles, across };
}

/**
 * Reads what follows the character screen's record, which ends at `at`.
 * `companions` is how many blocks of companions' perks the save has (Fallout
 * 2; see locateTail). Null unless every part of it reads, to the last byte.
 */
export function readRest(data: Uint8Array, layout: SaveLayout, at: number, companions = 0): SaveRest | null {
  const words = new Words(data);
  try {
    const world: WorldMap1 | WorldMap2 = layout === 'fo1' ? { kind: 'fo1', at, end: at + FO1_WORLD } : worldMap2(words, at);
    let next = world.end + MOVIES[layout] + SKILL_USES;
    const count = words.int(next);
    need(count >= 1 && count <= 100);
    const members = words.ints(next + 8, count - 1);
    const levels = next + 8 + (count - 1) * 4;
    const party: Party = { at: next, members, levels, end: levels + (layout === 'fo2' ? companions * 12 : 0) };
    next = party.end;
    let queue: Queue | undefined;
    if (layout === 'fo2') {
      const read = readQueue(words, next, layout);
      need(read !== null);
      queue = read!;
      next = queue.end;
    }
    // The interface bar's four switches, and nothing after them.
    need(next + INTERFACE === data.length);
    need(words.ints(next, 4).every((value) => value === 0 || value === 1));
    return { world, party, queue };
  } catch {
    return null;
  }
}

/**
 * The subtiles around the mark of an area, as the engine makes them known when
 * an area becomes known (wmAreaGetMarkWorldPos, wmSubTileMarkRadiusKnown): the
 * subtile of its mark and the eight around it, where they exist.
 */
export function subtilesAround(world: WorldMap2, area: MapArea, size: number): number[] {
  const half = size === 0 ? [7, 6] : size === 1 ? [12, 11] : [22, 21];
  const x = Math.max(area.x + half[0]! - 22, 0);
  const y = Math.max(area.y + half[1]! - 21, 0);
  const across = world.across * 7;
  const down = (world.tiles / world.across) * 6;
  const columnOf = Math.floor((x % 350) / 50) + (Math.floor(x / 350) % world.across) * 7;
  const rowOf = Math.floor((y % 300) / 50) + Math.floor(y / 300) * 6;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const column = columnOf + dx;
      const row = rowOf + dy;
      if (column < 0 || column >= across || row < 0 || row >= down) continue;
      const tile = Math.floor(row / 6) * world.across + Math.floor(column / 7);
      out.push(tile * SUBTILES_PER_TILE + (row % 6) * 7 + (column % 7));
    }
  }
  return out;
}
