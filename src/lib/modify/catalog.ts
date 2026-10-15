/**
 * Everything a game's items are: their prototypes (proto/items/*.pro, listed
 * in items.lst; an item's number is its line), with the words the game uses
 * for them (pro_item.msg).
 *
 * A prototype is big-endian: number, message, picture on the ground, light
 * radius and intensity, flags, more flags, script, kind, material, size,
 * weight, value, picture in the inventory, a sound byte, and then what is
 * particular to the kind (proto.cc, protoRead and protoItemDataRead; the
 * same in both games).
 */
import { messages } from '../gamefacts';
import type { GameData } from '../gamedata';
import type { ItemKind } from './savemap';

const KINDS: ItemKind[] = ['armor', 'container', 'drug', 'weapon', 'ammo', 'misc', 'key'];
/** The prototype's extended flags: a container that can be picked up; a weapon that is part of a creature. */
const PICK_UP = 0x8000;
const NATURAL = 0x08000000;

export interface ItemProto {
  pid: number;
  kind: ItemKind;
  name: string;
  description: string;
  /** Picture on the ground, and in the inventory (-1: none of its own). */
  fid: number;
  inventoryFid: number;
  /** The prototype's flags, from which a new item's are made. */
  flags: number;
  /**
   * Whether the editor offers it to carry: not lockers and graves (which are
   * containers too, but not ones that can be picked up), not a creature's
   * claws, nothing nameless, and nothing that needs a script of its own,
   * which only the game can give an item.
   */
  offered: boolean;
  /** A script every new item of this kind is given (-1: none). */
  sid: number;
  lightDistance: number;
  lightIntensity: number;
  weight: number;
  cost: number;
  /** What a new one stores after its flags: a loaded weapon, a full box, charges, a key's code. */
  fresh: number[];
  armor?: { armorClass: number; resistance: number[]; threshold: number[]; maleFid: number; femaleFid: number };
  weapon?: { minDamage: number; maxDamage: number; range: number; minStrength: number; actionPoints: number; caliber: number; ammoPid: number; capacity: number };
  ammo?: { caliber: number; quantity: number };
  misc?: { charges: number };
}

export interface Catalog {
  items: Map<number, ItemProto>;
}

/** Names in one of the games' .lst files, by line: the first word of each. */
export function listNames(file: Uint8Array): string[] {
  return new TextDecoder('latin1')
    .decode(file)
    .split(/\r?\n/)
    .map((line) => line.trim().split(/[\s;]/)[0] ?? '');
}

/** Reads one prototype. Null when it is not an item's. */
export function readProto(file: Uint8Array, names: Map<number, string>): ItemProto | null {
  if (file.length < 57) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const int = (at: number) => (at + 4 <= file.length ? view.getInt32(at, false) : 0);
  const pid = int(0);
  const kind = KINDS[int(32)];
  if (pid >>> 24 !== 0 || !kind) return null;
  const message = int(4);
  const at = 57;
  const proto: ItemProto = {
    pid,
    kind,
    name: names.get(message) ?? '',
    description: names.get(message + 1) ?? '',
    fid: int(8),
    inventoryFid: int(52),
    flags: int(20) >>> 0,
    offered: (kind !== 'container' || (int(24) & PICK_UP) !== 0) && (int(24) & NATURAL) === 0 && int(28) === -1 && (names.get(message) ?? '') !== '',
    sid: int(28),
    lightDistance: int(12),
    lightIntensity: int(16),
    weight: int(44),
    cost: int(48),
    fresh: [],
  };
  const ints = (from: number, count: number) => Array.from({ length: count }, (_, i) => int(from + i * 4));
  switch (kind) {
    case 'armor':
      proto.armor = { armorClass: int(at), resistance: ints(at + 4, 7), threshold: ints(at + 32, 7), maleFid: int(at + 64), femaleFid: int(at + 68) };
      break;
    case 'weapon': {
      const [, minDamage, maxDamage, , range, , , minStrength, actionPoints, , , , , caliber, ammoPid, capacity] = ints(at, 16) as number[];
      proto.weapon = { minDamage: minDamage!, maxDamage: maxDamage!, range: range!, minStrength: minStrength!, actionPoints: actionPoints!, caliber: caliber!, ammoPid: ammoPid!, capacity: capacity! };
      proto.fresh = [capacity!, ammoPid!];
      break;
    }
    case 'ammo':
      proto.ammo = { caliber: int(at), quantity: int(at + 4) };
      proto.fresh = [int(at + 4)];
      break;
    case 'misc':
      proto.misc = { charges: int(at + 8) };
      proto.fresh = [int(at + 8)];
      break;
    case 'key':
      proto.fresh = [int(at)];
      break;
  }
  return proto;
}

/** Reads every item a game has. */
export async function readCatalog(data: GameData): Promise<Catalog> {
  const items = new Map<number, ItemProto>();
  const list = await data.read('proto/items/items.lst');
  if (!list) return { items };
  const textFile = await data.read('text/english/game/pro_item.msg');
  const names = textFile ? messages(textFile) : new Map<number, string>();
  const files = listNames(list);
  // A few at a time: each is a small read out of a large archive.
  const BATCH = 48;
  for (let first = 0; first < files.length; first += BATCH) {
    await Promise.all(
      files.slice(first, first + BATCH).map(async (name, offset) => {
        if (!name) return;
        const file = await data.read(`proto/items/${name}`);
        const proto = file ? readProto(file, names) : null;
        // An item's number is its line in the list.
        if (proto && (proto.pid & 0xffffff) === first + offset + 1) items.set(proto.pid, proto);
      }),
    );
  }
  return { items };
}
