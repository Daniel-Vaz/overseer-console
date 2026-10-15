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
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameData } from '../../src/lib/gamedata';
import type { GameId } from '../../src/lib/games';
import { readCatalog, type Catalog, type ItemProto } from '../../src/lib/modify/catalog';
import { Pictures } from '../../src/lib/modify/pictures';
import { copyRecord, readSave, writeSave } from '../../src/lib/modify/record';
import { PRIMARY, choosable, experienceFor, readRules, type Rules } from '../../src/lib/modify/rules';
import { GAMES } from '../../src/lib/games';
import { folderGameData, layeredGameData } from '../gamedata';
import { buildSave, type Item } from '../saves';

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

/** One offered item of a kind, as the test save stores it. */
function sample(catalog: Catalog, kind: ItemProto['kind'], quantity = 1, flags?: number): Item {
  const proto = [...catalog.items.values()].find((item) => item.offered && item.kind === kind)!;
  return { pid: proto.pid, kind: proto.kind, quantity, flags, extra: proto.fresh };
}

for (const [game, available, open] of games) {
  describe.skipIf(!available)(`the save editor with ${GAMES[game].title}`, () => {
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

    it('changes a save made of real items, and proves it', async () => {
      const layout = GAMES[game].engine.id;
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
