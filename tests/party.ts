/**
 * A companion for the tests that play the real games, which start without
 * one: a creature of the map the player stands on, taken into the party the
 * way the engines take one (partyMemberAdd): numbered 18000 and its
 * prototype's number, on the player's side, without its script, and named in
 * SAVE.DAT's list of the party.
 */
import type { Catalog } from '../src/lib/modify/catalog';
import { CRITTER, OBJECT_TYPE, packMap, unpackMap } from '../src/lib/modify/mapfile';
import { readMapWith } from '../src/lib/modify/party';
import { readSave } from '../src/lib/modify/record';
import type { GameData } from '../src/lib/gamedata';
import { parseSaveHeader, type SaveLayout } from '../src/lib/savefile';

/**
 * Takes a slot's files (as its exported archive holds them, by path) and
 * returns them with the first creature of the player's map in the party, and
 * that creature's new number.
 */
export async function recruit(files: Record<string, Uint8Array>, layout: SaveLayout, data: GameData, catalog: Catalog): Promise<{ files: Record<string, Uint8Array>; id: number }> {
  const saveName = Object.keys(files).find((path) => /SAVE\.DAT$/i.test(path))!;
  const save = files[saveName]!;
  const header = parseSaveHeader(save)!;
  const mapName = Object.keys(files).find((path) => path.toUpperCase().endsWith(`/${header.map.toUpperCase()}.SAV`))!;
  const map = unpackMap(files[mapName]!);
  const objects = (await readMapWith(data, catalog, map)).objects;
  const creature = objects.find((object) => object.pid >>> 24 === OBJECT_TYPE.critter)!;
  const id = (creature.pid & 0xffffff) + 18000;
  const view = new DataView(map.buffer, map.byteOffset, map.byteLength);
  view.setInt32(creature.at, id, false);
  view.setInt32(creature.at + 16 * 4, -1, false); // its script stays behind
  view.setInt32(creature.at + CRITTER.team * 4, 0, false); // on the player's side

  // One more in the party: its count, and the new member's number after the others.
  const party = readSave(save, layout, (pid) => catalog.items.get(pid)?.kind).map.rest!.party;
  const count = new DataView(save.buffer, save.byteOffset, save.byteLength).getInt32(party.at, false);
  const at = party.at + 8 + (count - 1) * 4;
  const out = new Uint8Array(save.length + 4);
  out.set(save.subarray(0, at), 0);
  out.set(save.subarray(at), at + 4);
  const words = new DataView(out.buffer);
  words.setInt32(at, id, false);
  words.setInt32(party.at, count + 1, false);

  // The map back as the slot keeps it: Fallout 2's engine gzips its maps, Fallout 1's does not.
  const packed = files[mapName]![0] === 0x1f ? packMap(map) : map;
  return { files: { ...files, [saveName]: out, [mapName]: packed }, id };
}
