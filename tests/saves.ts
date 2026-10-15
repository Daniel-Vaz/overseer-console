/**
 * Saved games for the tests, written the way the engines write them (see
 * loadsave.cc in both): far enough for everything the console reads from a
 * save and the save editor changes in one.
 */
import { HEADER_SIZE } from '../src/lib/savefile';

/** Writes a SAVE.DAT, a word or a byte at a time, big-endian. */
export class Writer {
  private bytes: number[] = [];
  int(...values: number[]): this {
    for (const value of values) this.bytes.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
    return this;
  }
  byte(value: number): this {
    this.bytes.push(value & 255);
    return this;
  }
  text(value: string): this {
    for (const char of value) this.bytes.push(char.charCodeAt(0));
    this.bytes.push(0);
    return this;
  }
  zeros(count: number): this {
    for (let i = 0; i < count; i++) this.bytes.push(0);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export type ItemKind = 'weapon' | 'ammo' | 'misc' | 'key' | 'armor' | 'drug' | 'container';

export interface Item {
  pid: number;
  quantity?: number;
  kind: ItemKind;
  holds?: Item[];
  /** The object's flags (in a hand, worn...). */
  flags?: number;
  /** What it stores after its flags, where not the usual. */
  extra?: number[];
}

export interface SaveSpec {
  game: 'fo1' | 'fo2';
  globals?: number[];
  maps?: string[];
  items?: Item[];
  hitPoints?: number;
  radiation?: number;
  poison?: number;
  special?: number[];
  bonus?: number[];
  maxHitPoints?: number;
  protoFlags?: number;
  sneaking?: boolean;
  kills?: number[];
  tagged?: number[];
  perks?: Record<number, number>;
  /** Combatants when the save was made mid-fight. */
  fighting?: number;
  /** Fallout 2: possible companions, and how many of them store combat settings. */
  companions?: number;
  companionPerks?: Record<number, number>;
  aiPackets?: number;
  stats?: [points: number, level: number, experience: number, reputation: number, karma: number];
  traits?: [number, number];
  /** Fallout 1: queued events as [type, extra words]. */
  events?: [type: number, words: number[]][];
  /** The game's difficulty (0 to 2). */
  difficulty?: number;
  /** The character screen's last level seen and perks owed. */
  lastLevel?: number;
  perksOwed?: number;
  /** The rest of the base statistics, after S.P.E.C.I.A.L., hit points and action points. */
  base?: Record<number, number>;
  /** The player's object's picture. */
  fid?: number;
}

let nextId = 20000;

function writeObject(out: Writer, pid: number, fid: number, tile: number, held: number, flags = 0x2000): void {
  // id, tile, x, y, sx, sy, frame, rotation, fid, flags, elevation, pid, cid, light distance, light intensity, outline, sid, script index
  out.int(nextId++, tile, 0, 0, 0, 0, 0, 0, fid, flags, 0, pid, -1, 0, 0x10000, 0, -1, -1);
  // inventory: length, capacity, pointer
  out.int(held, held ? Math.max(10, held) : 0, 0);
}

function writeItem(out: Writer, item: Item): void {
  out.int(item.quantity ?? 1);
  writeObject(out, item.pid, 0x00000123, -1, item.holds?.length ?? 0, item.flags);
  out.int(0x0800); // flags
  if (item.extra) out.int(...item.extra);
  else if (item.kind === 'weapon') out.int(12, 29);
  else if (item.kind === 'ammo' || item.kind === 'misc' || item.kind === 'key') out.int(24);
  for (const inner of item.holds ?? []) writeItem(out, inner);
}

function header(out: Writer): void {
  const head = new Uint8Array(HEADER_SIZE);
  const put = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) head[offset + i] = text.charCodeAt(i);
  };
  put(0, 'FALLOUT SAVE FILE');
  put(0x1d, 'Narg');
  put(0x3d, 'test');
  new DataView(head.buffer).setInt16(0x65, 7, false);
  put(0x73, 'ARTEMPLE.SAV');
  for (const value of head) out.byte(value);
}

export function buildSave(spec: SaveSpec): Uint8Array {
  const fo2 = spec.game === 'fo2';
  const out = new Writer();
  header(out);
  out.int(-1); // the player's combat id

  const globals = spec.globals ?? new Array<number>(fo2 ? 696 : 618).fill(0);
  const writeGlobals = () => {
    out.int(...globals);
    if (!fo2) out.byte(0);
  };
  writeGlobals();
  const maps = spec.maps ?? ['ARTEMPLE.SAV'];
  out.int(maps.length);
  for (const map of maps) out.text(map);
  out.int(1186); // automap size
  writeGlobals();

  // The player.
  const items = spec.items ?? [];
  writeObject(out, 0x01000000, spec.fid ?? 0x0100003e, 17488, items.length);
  out.int(0); // flags
  out.int(0, 0, 8, 0, 0, 0, -1); // combat data
  out.int(spec.hitPoints ?? 44, spec.radiation ?? 0, spec.poison ?? 0);
  for (const item of items) writeItem(out, item);
  out.int(17288); // centre of the view

  // The character sheet.
  out.int(spec.sneaking ? 1 : 0, spec.protoFlags ?? 0);
  const base = new Array<number>(35).fill(0);
  (spec.special ?? [8, 5, 9, 3, 4, 7, 4]).forEach((value, index) => (base[index] = value));
  base[7] = spec.maxHitPoints ?? 44;
  base[8] = 9;
  for (const [stat, value] of Object.entries(spec.base ?? {})) base[Number(stat)] = value;
  const bonus = new Array<number>(35).fill(0);
  (spec.bonus ?? []).forEach((value, index) => (bonus[index] = value));
  out.int(...base, ...bonus, ...new Array<number>(18).fill(0));
  out.int(0, 0, 0);
  if (fo2) out.int(0);
  out.int(...(spec.kills ?? new Array<number>(fo2 ? 19 : 15).fill(0)));
  out.int(...(spec.tagged ?? [4, 0, 5, -1]));

  const perkCount = fo2 ? 119 : 64;
  const ranks = (taken: Record<number, number> = {}) => {
    const list = new Array<number>(perkCount).fill(0);
    for (const [perk, rank] of Object.entries(taken)) list[Number(perk)] = rank;
    return list;
  };
  out.int(...ranks(spec.perks));
  if (fo2) for (let i = 0; i < (spec.companions ?? 25); i++) out.int(...ranks(i === 3 ? spec.companionPerks : {}));

  // Combat.
  if (spec.fighting) {
    out.int(3, 1, 0, 120, spec.fighting - 1, 1, spec.fighting, 0);
    for (let i = 0; i < spec.fighting; i++) out.int(i);
    if (fo2) for (let i = 0; i < spec.fighting; i++) out.int(-1, -1, -1, 0);
  } else {
    out.int(2);
  }
  if (fo2) {
    for (let i = 0; i < (spec.aiPackets ?? 19); i++) {
      // packet number, distances, chances, message ranges... shaped like the real thing
      out.int(62 + i, 12, 10, 10, 45, 124, 10, 10, 101, 58, 55, 25);
      for (let word = 12; word < 45; word++) out.int(42000 + word * 7 + i);
    }
  }

  out.int(...(spec.stats ?? [0, 1, 0, 0, 0]));
  const traits = spec.traits ?? [6, 15];
  if (!fo2) {
    const events = spec.events ?? [[3, [0x04000009, 0]]];
    out.int(events.length);
    for (const [type, words] of events) out.int(264690, type, 469, ...words);
  }
  out.int(...traits);
  out.int(0); // automap flags
  // preferences: difficulty, combat difficulty, violence, target highlight, seven switches, combat speed,
  // speed-up, text delay (3.5), four volumes, brightness (1.0), mouse sensitivity (1.0)
  out.int(spec.difficulty ?? 1, 1, 3, 2, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0x40600000, 22281, 22281, 22281, 22281, 0x3f800000, 0x3f800000);
  // character editor: last level seen, free perk
  out.int(spec.lastLevel ?? (spec.stats ?? [0, 1])[1]!).byte(spec.perksOwed ?? 0);
  out.zeros(400);
  return out.done();
}
