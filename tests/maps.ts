/**
 * Maps for the tests, written the way the engines write them (map.cc): a
 * header, no squares, no scripts, and objects: creatures with what they
 * carry, and the plainer kinds whose words the reader must count right.
 */
import { Writer, writeItem, type Item } from './saves';

export interface MapCritter {
  id: number;
  pid: number;
  hitPoints?: number;
  radiation?: number;
  poison?: number;
  team?: number;
  items?: Item[];
}

export interface MapSpec {
  /** 20 for Fallout 2's engine, 19 for Fallout 1's. */
  version?: 19 | 20;
  name?: string;
  critters?: MapCritter[];
  /** Also an exit grid (four more words) and a wall (none). */
  plain?: boolean;
}

function object(out: Writer, id: number, pid: number, held: number): void {
  // id, tile, x, y, sx, sy, frame, rotation, fid, flags, elevation, pid, cid, light distance, light intensity, outline, sid, script index
  out.int(id, 12345, 0, 0, 0, 0, 0, 2, (pid >>> 24) << 24, 0, 0, pid, -1, 0, 0, 0, -1, -1);
  out.int(held, held ? Math.max(10, held) : 0, 0);
}

export function buildMap(spec: MapSpec = {}): Uint8Array {
  const out = new Writer();
  const name = (spec.name ?? 'ARTEMPLE.MAP').padEnd(16, '\0').slice(0, 16);
  out.int(spec.version ?? 20);
  for (const char of name) out.byte(char.charCodeAt(0));
  // Entering tile, level and rotation; local variables; script; flags (no squares on any level); darkness; global variables; number; last visit.
  out.int(20100, 0, 0, 0, -1, 2 | 4 | 8, 1, 0, 0, 0);
  for (let i = 0; i < 44; i++) out.int(0);
  for (let type = 0; type < 5; type++) out.int(0);

  const critters = spec.critters ?? [];
  const total = critters.length + (spec.plain ? 2 : 0);
  out.int(total, total);
  if (spec.plain) {
    // An exit grid: map, tile, level, rotation after its flags.
    object(out, 7, 0x05000010, 0);
    out.int(0, 3, 15000, 0, 0);
    // A wall: its flags and nothing more.
    object(out, 8, 0x03000001, 0);
    out.int(0);
  }
  for (const critter of critters) {
    const items = critter.items ?? [];
    object(out, critter.id, critter.pid, items.length);
    // Reaction, then combat: damage last turn, maneuver, action points, results, AI packet, team, who hit it; then its state.
    out.int(0, 0, 0, 7, 0, 30, critter.team ?? 0, -1);
    out.int(critter.hitPoints ?? 40, critter.radiation ?? 0, critter.poison ?? 0);
    for (const item of items) writeItem(out, item);
  }
  out.int(0, 0); // the other two levels
  return out.done();
}

/** A critter prototype as the games store one (proto.cc): enough for its name and its hit points. */
export function critterProto(pid: number, message: number, maxHitPoints: number, bonus = 0): Uint8Array {
  const out = new Writer();
  // pid, message, fid, light distance and intensity, flags, more flags, script, head, AI packet, team, critter flags
  out.int(pid, message, 0x01000000 + (pid & 0xfff), 0, 0, 0, 0, -1, -1, 30, 1, 0);
  const base = new Array<number>(35).fill(5);
  base[7] = maxHitPoints;
  const bonuses = new Array<number>(35).fill(0);
  bonuses[7] = bonus;
  out.int(...base, ...bonuses, ...new Array<number>(18).fill(0));
  out.int(0, 50, 0, 0); // body, experience, kill type, damage type
  return out.done();
}
