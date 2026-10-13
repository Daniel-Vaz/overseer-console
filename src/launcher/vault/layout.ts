/**
 * Where everything in the vault stands.
 *
 * The console hides the middle of the room, and how much shows around it
 * depends on the window. So the room is laid out from the console's edges
 * outwards: what matters most stands closest to it, where even a narrow
 * margin shows it, and a larger window uncovers more of the hall.
 *
 * All measures are in the coarse pixels the room is painted in.
 */
import type { Ink } from './raster';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Depth of the strip of floor along the bottom. */
export const FLOOR = 38;
/** From one walkway up to the next. Four rows of wall plates. */
export const STOREY = 132;
/** The band under the ceiling that the pipes run through. */
export const CEILING = 46;
/** Wall plates. */
export const PLATE_WIDTH = 48;
export const PLATE_HEIGHT = 33;
/** Radius of the great door, teeth included. */
export const GEAR = 58;
/** How far the great door rolls aside while the vault is not sealed: far enough to walk in past it. */
export const ROLL = 62;

/**
 * How a lamp behaves. Some are not lamps at all: a screen is lit by whatever
 * it happens to be showing, the garden by how far it has grown, and daylight
 * comes in by the great door while that stands open.
 */
export type Mood = 'steady' | 'failing' | 'beacon' | 'screen' | 'garden' | 'daylight' | 'dead';

export interface Lamp {
  x: number;
  y: number;
  /** How far its light carries. */
  reach: number;
  ink: Ink;
  mood: Mood;
  /** A lamp on the wall throws its light downwards; a screen lights evenly around itself. */
  shape: 'down' | 'round';
  /** How wide the part of it that glows is, where that is not the six pixels of a door lamp. */
  span?: number;
}

export interface Doorway {
  /** Left edge. */
  x: number;
  /** The walkway it opens onto: 0 is the floor. */
  level: number;
  state: 'shut' | 'ajar' | 'open';
  lit: Mood;
}

/** The wall monitor: its casing, and the glass inside it. */
export const MONITOR = { width: 42, height: 32, screen: { x: 4, y: 4, width: 34, height: 24 } };

export interface Layout {
  width: number;
  height: number;
  /** The part of the room the console hides. */
  console: Box;
  /** Where the wall meets the floor. */
  floor: number;
  /** The galleries above the floor: the height of each deck, lowest first. */
  decks: number[];
  /** Centre of the great door, where it stands when it is shut. */
  gear: { x: number; y: number };
  /** Where the floor is crossed by whatever comes in past the great door when it stands open. */
  portal: number;
  doorways: Doorway[];
  lamps: Lamp[];
  /** Emergency lights low on the wall, of which some still burn: where each one is. */
  footlights: number[];
  /** Words somebody left on the wall: where they start, and how large they are written. */
  graffiti: { x: number; y: number; scale: number } | null;
  /** Top left corner of the monitor hanging from the pipes, where there is room for one. */
  monitor: { x: number; y: number } | null;
  /** A joint in the pipes that drips: where, from what height, and onto what. */
  drip: { x: number; from: number; to: number };
  /** Left edge of whoever never left, sitting against the wall. */
  skeleton: number;
  /** Left edges of a stack of crates and of a row of lockers, further out. */
  lockers: number;
  crates: number;
  /** Top left corner of the purifier's fault panel, and of the lamp on it. */
  panel: { x: number; y: number };
}

export const DOOR_WIDTH = 34;
export const DOOR_HEIGHT = 62;

const AMBER = 0xffb45a;
const TUBE = 0xcfe8d8;

/** The height at which feet stand on a level. */
export function footing(layout: Layout, level: number): number {
  return level === 0 ? layout.floor + 10 : layout.decks[level - 1]!;
}

/**
 * Lays the room out around the console. On the anniversary of the day the
 * bombs fell, the warning lamp over the great door burns red.
 */
export function arrange(width: number, height: number, console: Box, anniversary = false): Layout {
  const floor = height - FLOOR;
  const decks: number[] = [];
  // A gallery needs room for its doors under the pipes.
  for (let deck = floor - STOREY; deck - DOOR_HEIGHT - 12 >= CEILING; deck -= STOREY) decks.push(deck);

  const left = console.x;
  const right = console.x + console.width;
  const gear = { x: left - 56, y: floor - GEAR - 2 };

  const doorways: Doorway[] = [];
  const lamps: Lamp[] = [];

  // The way out of the hall on the right, where things come and go.
  doorways.push({ x: right + 30, level: 0, state: 'open', lit: 'steady' });
  for (let x = right + 30 + 96 * 2; x < width + DOOR_WIDTH; x += 96 * 2) {
    doorways.push({ x, level: 0, state: 'shut', lit: 'dead' });
  }

  // Quarters along the galleries: a door every other plate, most of them dark. The ones nearest the
  // console show in the narrowest margin: on one side a door somebody still keeps lit, on the other
  // one that stands ajar under a failing tube.
  decks.forEach((_, index) => {
    const level = index + 1;
    for (let n = 0, x = left - 12 - DOOR_WIDTH - (index % 2) * 20; x > -DOOR_WIDTH; x -= 96, n++) {
      doorways.push({ x, level, state: n % 3 === 1 ? 'ajar' : n % 3 === 2 ? 'open' : 'shut', lit: n === 0 ? (index ? 'dead' : 'steady') : n % 4 === 2 ? 'failing' : 'dead' });
    }
    for (let n = 0, x = right + 26 + (index % 2) * 20; x < width; x += 96, n++) {
      doorways.push({ x, level, state: n % 3 === 0 ? 'ajar' : n % 3 === 2 ? 'open' : 'shut', lit: n === 0 ? 'failing' : n % 3 === 1 ? 'steady' : 'dead' });
    }
  });

  for (const door of doorways) {
    if (door.lit === 'dead') continue;
    const base = door.level === 0 ? floor : decks[door.level - 1]!;
    lamps.push({ x: door.x + DOOR_WIDTH / 2, y: base - DOOR_HEIGHT - 6, reach: 88, ink: door.lit === 'failing' ? TUBE : AMBER, mood: door.lit, shape: 'down' });
  }

  // The warning lamp over the great door.
  lamps.push({ x: gear.x + 8, y: gear.y - GEAR - 8, reach: 150, ink: anniversary ? 0xff4a32 : AMBER, mood: 'beacon', shape: 'down' });

  // Emergency lights along the foot of the wall, wherever nothing stands in front of it.
  const skeleton = right + 8;
  const crates = right + 76;
  const lockers = right + 142;
  const footlights: number[] = [];
  const middle = Math.round(width / 2);
  for (let x = ((middle + 60) % 240) - 240; x < width; x += 240) {
    const taken =
      (x > gear.x - ROLL - GEAR - 8 && x < gear.x + GEAR + 18) ||
      (x > skeleton - 8 && x < skeleton + 34) ||
      (x > lockers - 8 && x < lockers + 56) ||
      (x > crates - 8 && x < crates + 63) ||
      doorways.some((door) => door.level === 0 && x > door.x - 8 && x < door.x + DOOR_WIDTH + 8);
    if (taken) continue;
    footlights.push(x);
    lamps.push({ x, y: floor - 14, reach: 46, ink: 0xd9903c, mood: 'steady', shape: 'down', span: 4 });
  }

  // Between the pipes and the lamps of the topmost doors the wall is bare.
  const bare = (decks.at(-1) ?? floor) - DOOR_HEIGHT - 14 - CEILING;
  const scale = bare >= 44 ? 2 : 1;
  const graffiti = bare >= 22 ? { x: left - 8 - 27 * scale, y: CEILING + Math.min(8, Math.floor((bare - 18 * scale) / 2)), scale } : null;
  // A tube over the words that cannot make up its mind, so that they are there one moment and gone the next.
  if (graffiti) lamps.push({ x: graffiti.x + 14 * scale, y: graffiti.y - 6, reach: 34 + 22 * scale, ink: TUBE, mood: 'failing', shape: 'down', span: 14 });
  // The monitor hangs from the big pipe, in front of the smaller ones.
  const monitor = bare >= 14 ? { x: right + 16, y: 27 } : null;
  if (monitor) lamps.push({ x: monitor.x + MONITOR.width / 2, y: monitor.y + MONITOR.height / 2, reach: 58, ink: 0xbfe6d2, mood: 'screen', shape: 'round' });
  // What a case full of promise does for the place once somebody opens it; and the daylight at the far end of the way out.
  lamps.push({ x: crates + 15, y: floor - 14, reach: 48, ink: 0xb9f08a, mood: 'garden', shape: 'round' });
  lamps.push({ x: gear.x + 24, y: gear.y + 4, reach: 40, ink: 0xe8d2a6, mood: 'daylight', shape: 'round' });

  return {
    width,
    height,
    console,
    floor,
    decks,
    gear,
    portal: gear.x + 26,
    doorways,
    lamps,
    footlights,
    graffiti,
    monitor,
    drip: { x: left - 5, from: 34, to: decks.at(-1) ?? floor + 6 },
    skeleton,
    lockers,
    crates,
    panel: { x: right + 78, y: floor - 92 },
  };
}

/** Something in the room that answers to being touched. */
export type Spot =
  | { kind: 'monitor' | 'skeleton' | 'panel' | 'case' | 'drip' | 'door' }
  | { kind: 'lamp'; lamp: Lamp }
  | { kind: 'room'; door: Doorway };

/** The lamp over a doorway, if it has one that still works. */
export function lampOver(layout: Layout, door: Doorway): Lamp | undefined {
  const base = door.level === 0 ? layout.floor : layout.decks[door.level - 1]!;
  return layout.lamps.find((lamp) => lamp.x === door.x + DOOR_WIDTH / 2 && lamp.y === base - DOOR_HEIGHT - 6);
}

/** What stands at a place in the room, if it is something that answers to being touched. */
export function spotAt(layout: Layout, x: number, y: number): Spot | null {
  for (const lamp of layout.lamps) {
    if (lamp.shape !== 'down') continue;
    if (Math.abs(x - lamp.x) <= Math.max(5, (lamp.span ?? 6) / 2 + 2) && y >= lamp.y - 3 && y <= lamp.y + 6) return { kind: 'lamp', lamp };
  }
  const within = (left: number, top: number, width: number, height: number) => x >= left && x < left + width && y >= top && y < top + height;
  if (layout.monitor && within(layout.monitor.x, layout.monitor.y, MONITOR.width, MONITOR.height)) return { kind: 'monitor' };
  if (within(layout.panel.x, layout.panel.y, 46, 17)) return { kind: 'panel' };
  if (within(layout.crates + 2, layout.floor - 30, 26, 17)) return { kind: 'case' };
  if (within(layout.skeleton - 8, layout.floor - 16, 35, 26)) return { kind: 'skeleton' };
  if (within(layout.drip.x - 3, layout.drip.from - 8, 7, layout.drip.to - layout.drip.from + 8)) return { kind: 'drip' };
  for (const door of layout.doorways) {
    // The way out on the floor is nobody's room.
    if (door.level === 0 && door.state === 'open') continue;
    const base = door.level === 0 ? layout.floor : layout.decks[door.level - 1]!;
    if (within(door.x, base - DOOR_HEIGHT, DOOR_WIDTH, DOOR_HEIGHT)) return { kind: 'room', door };
  }
  if (Math.hypot(x - layout.gear.x, y - layout.gear.y) <= GEAR + 4) return { kind: 'door' };
  return null;
}
