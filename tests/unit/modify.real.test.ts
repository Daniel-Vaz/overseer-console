/**
 * The save editor against the real games: their rules, their items and their
 * pictures, read the way the console reads them. Skipped unless told where
 * the games are (the same as the browser tests that play them):
 *
 *   FO1_DIR=... FO2_DIR=... ETTU=<the Fallout1in2 folder> npx vitest run tests/unit/modify.real.test.ts
 *
 * Fallout Et Tu needs its package unpacked (ETTU a folder, not the zip) and
 * Fallout 2 beside it, whose archives it runs on.
 */
import { existsSync, openAsBlob, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexDat, readDatEntry, type DatArchive } from '../../src/lib/dat';
import type { GameData } from '../../src/lib/gamedata';
import { readCatalog, type Catalog, type ItemProto } from '../../src/lib/modify/catalog';
import { readMapWith } from '../../src/lib/modify/party';
import { Pictures } from '../../src/lib/modify/pictures';
import { copyRecord, readSave, writeSave } from '../../src/lib/modify/record';
import { PRIMARY, choosable, experienceFor, readRules, type Rules } from '../../src/lib/modify/rules';
import { gameDef, registerMod, type GameId } from '../../src/lib/games';
import { TOWN_PICTURES, readWorld } from '../../src/lib/modify/world';
import { folderGameData, layeredGameData } from '../gamedata';
import { buildSave, type Item } from '../saves';

// Fallout Et Tu is a mod of Fallout 2 here, as in any browser it was loaded in.
registerMod({ id: 'ettu', known: 'ettu', title: 'Fallout Et Tu', base: 'fo2', donor: 'fo1' });

const FO1 = process.env.FO1_DIR;
const FO2 = process.env.FO2_DIR;
const ETTU = process.env.ETTU && existsSync(process.env.ETTU) && statSync(process.env.ETTU).isDirectory() ? process.env.ETTU : undefined;

async function ettuData(): Promise<GameData> {
  // The engine's chain for Et Tu: its data folder, its mods (the last listed highest), then Fallout 2's archives.
  const mods = ['fo1_maps_mountains', 'Anim_ImprovedSMutantDeath', 'fo1_interface', 'fo1_base'];
  return layeredGameData('ettu', ETTU!, [
    { folder: join(ETTU!, 'data') },
    ...mods.map((mod) => ({ folder: join(ETTU!, 'mods', mod) })),
    { archive: join(FO2!, 'critter.dat') },
    { archive: join(FO2!, 'master.dat') },
  ]);
}

const games: [GameId, string | undefined, () => Promise<GameData>][] = [
  ['fo1', FO1, () => folderGameData('fo1', FO1!, ['master.dat', 'critter.dat'])],
  ['fo2', FO2, () => folderGameData('fo2', FO2!, ['patch000.dat', 'f2_res.dat', 'critter.dat', 'master.dat'])],
  ['ettu', ETTU && FO2, ettuData],
];

/** Every map a game has: Fallout and Fallout 2 in their MASTER.DAT, Fallout Et Tu loose in its mods. */
async function mapsOf(game: GameId): Promise<[string, Uint8Array][]> {
  if (game === 'ettu') {
    const out: [string, Uint8Array][] = [];
    for (const mod of readdirSync(join(ETTU!, 'mods'), { withFileTypes: true })) {
      const folder = join(ETTU!, 'mods', mod.name, 'maps');
      if (!mod.isDirectory() || !existsSync(folder)) continue;
      for (const name of readdirSync(folder)) if (/\.map$/i.test(name)) out.push([`${mod.name}/${name}`, new Uint8Array(readFileSync(join(folder, name)))]);
    }
    return out;
  }
  const folder = game === 'fo1' ? FO1! : FO2!;
  const name = readdirSync(folder).find((entry) => entry.toLowerCase() === 'master.dat')!;
  const format = gameDef(game).datFormat;
  const archive = (await openAsBlob(join(folder, name))) as unknown as DatArchive;
  const index = await indexDat(archive, format);
  const out: [string, Uint8Array][] = [];
  for (const [key, entry] of index) if (/^maps\/.*\.map$/.test(key)) out.push([key, await readDatEntry(archive, format, entry)]);
  return out;
}

/** One offered item of a kind, as the test save stores it. */
function sample(catalog: Catalog, kind: ItemProto['kind'], quantity = 1, flags?: number): Item {
  const proto = [...catalog.items.values()].find((item) => item.offered && item.kind === kind)!;
  return { pid: proto.pid, kind: proto.kind, quantity, flags, extra: proto.fresh };
}

for (const [game, available, open] of games) {
  describe.skipIf(!available)(`the save editor with ${gameDef(game).title}`, () => {
    let data: GameData;
    let rules: Rules;
    let catalog: Catalog;

    it("reads the game's rules and items", async () => {
      data = await open();
      [rules, catalog] = await Promise.all([readRules(data), readCatalog(data)]);
      expect(rules.perks.filter(choosable).length).toBeGreaterThan(40);
      expect(rules.skills.every((skill) => skill.name && skill.description)).toBe(true);
      expect(rules.traits.every((trait) => trait.name && trait.description)).toBe(true);
      expect(rules.stats.slice(0, PRIMARY).every((stat) => stat.name && stat.description)).toBe(true);
      expect(catalog.items.size).toBeGreaterThan(200);
      expect([...catalog.items.values()].filter((item) => item.offered).length).toBeGreaterThan(150);
      if (game === 'ettu') {
        // Its own rules: perks taken out, its own table of experience.
        for (const removed of [33, 34, 84, 85, 86, 87, 88, 89, 90, 94, 103]) expect(rules.perks[removed]!.maxRank, `perk ${removed}`).toBe(-1);
        expect(rules.experience.length).toBe(21);
        expect(rules.traits[13]!.hardcoded).toBe(false);
      }
    }, 60_000);

    it('has a picture for every card and every item it offers', async () => {
      const pictures = new Pictures(data);
      expect(await pictures.palette).toHaveLength(768);
      const cards = [
        ...rules.stats.slice(0, PRIMARY).map((stat) => stat.picture),
        ...rules.skills.map((skill) => skill.picture),
        ...rules.traits.map((trait) => trait.picture),
        ...rules.perks.filter((perk) => choosable(perk) && perk.minLevel <= rules.experience.length).map((perk) => perk.picture),
      ];
      const missing: number[] = [];
      for (const card of cards) if (!(await pictures.card(card))) missing.push(card);
      expect(missing).toEqual([]);
      const without: string[] = [];
      for (const item of catalog.items.values()) {
        if (item.offered && !(await pictures.item(item.inventoryFid, item.fid))) without.push(item.name);
      }
      expect(without).toEqual([]);
    }, 120_000);

    it("knows the game's world: its variables, quests, holodisks, karma, towns and kills, with their cards", async () => {
      const world = await readWorld(data);
      expect(world.variables.length).toBe(game === 'fo1' ? 618 : game === 'fo2' ? 696 : world.variables.length);
      expect(world.variables.length).toBeGreaterThan(600);
      expect(world.quests.length).toBeGreaterThan(25);
      expect(world.quests.every((quest) => quest.place && quest.text && quest.variable < world.variables.length)).toBe(true);
      expect(world.holodisks.length).toBeGreaterThan(10);
      expect(world.holodisks.every((disk) => disk.name && disk.variable < world.variables.length)).toBe(true);
      expect(world.karma?.name).toBeTruthy();
      expect(world.titles.length).toBeGreaterThanOrEqual(3);
      expect(world.addictions.every((addiction) => addiction.name && addiction.drugs.length)).toBe(true);
      expect(world.kills.filter((kind) => kind.name).length).toBeGreaterThanOrEqual(15);
      expect(world.areas.length).toBeGreaterThanOrEqual(10);
      expect(new Set(world.areas.map((area) => area.name)).size).toBe(world.areas.length);
      expect(!!world.water).toBe(game !== 'fo2');
      if (game !== 'fo1') expect(world.towns.length).toBeGreaterThanOrEqual(10);
      const pictures = new Pictures(data);
      const missing: number[] = [];
      for (const card of [...world.titles, ...world.addictions].map((title) => title.picture)) if (!(await pictures.card(card))) missing.push(card);
      if (game !== 'fo1') for (const card of TOWN_PICTURES) if (!(await pictures.card(card))) missing.push(card);
      expect(missing).toEqual([]);
    }, 60_000);

    it('reads every map of the game to its last byte', async () => {
      const maps = await mapsOf(game);
      expect(maps.length).toBeGreaterThan(game === 'ettu' ? 50 : 60);
      const failed: string[] = [];
      for (const [name, bytes] of maps) {
        try {
          await readMapWith(data, catalog, bytes);
        } catch (err) {
          failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      expect(failed).toEqual([]);
    }, 300_000);

    it('changes a save made of real items, and proves it', async () => {
      const layout = gameDef(game).engine.id;
      const bag = sample(catalog, 'container');
      const save = buildSave({
        game: layout,
        items: [
          sample(catalog, 'weapon', 1, 0x02000000),
          sample(catalog, 'ammo', 3),
          sample(catalog, 'drug', 5),
          sample(catalog, 'armor', 1, 0x04000000),
          { ...bag, holds: [sample(catalog, 'misc'), sample(catalog, 'key')] },
        ],
        traits: [-1, -1],
        stats: [0, 2, 1200, 0, 0],
      });
      const original = readSave(save, layout, (pid) => catalog.items.get(pid)?.kind);
      const record = copyRecord(original.record);
      record.special = [9, 8, 7, 6, 5, 4, 3];
      record.level = 6;
      record.experience = experienceFor(rules, 6);
      record.traits = [0, 15];
      record.perks[12] = 1;
      record.tags = [0, 3, 6, -1];
      record.skills[5] = 30;
      record.name = 'Tester';
      record.items[2]!.quantity = 12;
      for (const item of [...catalog.items.values()].filter((item) => item.offered).slice(0, 25)) {
        record.items.push({ key: `n${item.pid}`, pid: item.pid, quantity: 2 });
      }
      const written = writeSave(rules, catalog, original, record);
      const again = readSave(written, layout, (pid) => catalog.items.get(pid)?.kind);
      expect(again.record.items).toHaveLength(original.record.items.length + 25);
      expect(again.record.special).toEqual([9, 8, 7, 6, 5, 4, 3]);
      expect(again.record.name).toBe('Tester');
    });
  });
}
