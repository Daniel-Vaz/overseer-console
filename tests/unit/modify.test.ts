import { describe, expect, it } from 'vitest';
import type { Catalog, ItemProto } from '../../src/lib/modify/catalog';
import { copyRecord, hitPoints, mintItem, readSave, sheetOf, writeSave, type Original, type SaveRecord } from '../../src/lib/modify/record';
import { PERK, STAT, effectiveStat, experienceFor, levelFor, readRules, requirements, skillValue, type Rules } from '../../src/lib/modify/rules';
import { SaveMapError, mapSave, type ItemKind } from '../../src/lib/modify/savemap';
import { parseCharacter, type SaveLayout } from '../../src/lib/savefile';
import { madeUpGameData } from '../gamedata';
import { buildSave, type Item, type SaveSpec } from '../saves';

const ascii = (text: string) => new TextEncoder().encode(text);
const msg = (entries: [number, string][]) => ascii(entries.map(([number, text]) => `{${number}}{}{${text}}`).join('\r\n'));
const numbered = (first: number, count: number, name: (index: number) => string) => Array.from({ length: count }, (_, i): [number, string] => [first + i, name(i)]);

/** A game's words, made up: enough for the rules to read. */
function texts(perks: number) {
  return {
    'text/english/game/perk.msg': msg([...numbered(101, perks, (i) => `Perk ${i}`), ...numbered(1101, perks, (i) => `What perk ${i} does`), ...numbered(201, perks, (i) => `What perk ${i} does`)]),
    'text/english/game/skill.msg': msg([...numbered(100, 18, (i) => `Skill ${i}`), ...numbered(200, 18, (i) => `What skill ${i} is`)]),
    'text/english/game/stat.msg': msg(numbered(100, 38, (i) => `Stat ${i}`)),
    'text/english/game/trait.msg': msg(numbered(100, 16, (i) => `Trait ${i}`)),
    'text/english/game/editor.msg': msg([[107, 'MALE'], [108, 'FEMALE']]),
  };
}

const rulesFor = (layout: SaveLayout, plain: Record<string, Uint8Array> = {}): Promise<Rules> =>
  readRules(madeUpGameData(layout === 'fo1' ? 'fo1' : 'fo2', texts(layout === 'fo1' ? 64 : 119), plain));

function proto(pid: number, kind: ItemKind, extra: Partial<ItemProto> = {}): ItemProto {
  return {
    pid,
    kind,
    name: `Item ${pid}`,
    description: '',
    fid: 0x00000100 + pid,
    inventoryFid: 0x07000000 + pid,
    flags: 0x08 | 0x8000 | 0x20000000,
    offered: true,
    sid: -1,
    lightDistance: 0,
    lightIntensity: 0,
    weight: 2,
    cost: 10,
    fresh: kind === 'weapon' ? [12, 29] : kind === 'ammo' || kind === 'misc' || kind === 'key' ? [24] : [],
    ...extra,
  };
}

/** What every item in the tests is: by its number. */
const CATALOG: Catalog = {
  items: new Map(
    [
      proto(1, 'armor', { armor: { armorClass: 5, resistance: [], threshold: [], maleFid: 0x01000010, femaleFid: 0x01000011 } }),
      proto(4, 'weapon'),
      proto(8, 'weapon'),
      proto(9, 'weapon'),
      proto(29, 'ammo'),
      proto(30, 'ammo'),
      proto(40, 'drug'),
      proto(41, 'drug'),
      proto(46, 'container'),
      proto(47, 'container'),
      proto(52, 'misc', { lightDistance: 12, lightIntensity: 0x8000 }),
      proto(78, 'key'),
      proto(90, 'container'),
    ].map((item) => [item.pid, item]),
  ),
};
const kindOf = (pid: number) => CATALOG.items.get(pid)?.kind;

const BAG: Item = { pid: 90, kind: 'container', holds: [{ pid: 40, kind: 'drug', quantity: 4 }, { pid: 9, kind: 'weapon' }] };
const ITEMS: Item[] = [
  { pid: 8, kind: 'weapon', flags: 0x02000000 }, // in the right hand
  { pid: 29, kind: 'ammo', quantity: 3 },
  { pid: 41, kind: 'drug', quantity: 1200 },
  { pid: 1, kind: 'armor', flags: 0x04000000 }, // worn
  BAG,
  { pid: 52, kind: 'misc' },
];

function open(spec: SaveSpec): Original {
  return readSave(buildSave(spec), spec.game, kindOf);
}

describe('mapping a save', () => {
  it('accounts for every byte the editor touches, in both games', () => {
    for (const game of ['fo1', 'fo2'] as const) {
      for (const fighting of [0, 4]) {
        const save = buildSave({ game, items: ITEMS, fighting, stats: [5, 7, 21_500, 0, 0], lastLevel: 6, perksOwed: 1, traits: [2, -1], tagged: [0, 3, 14, -1] });
        const map = mapSave(save, game, kindOf);
        expect(map.items.map((item) => item.pid)).toEqual([8, 29, 41, 1, 90, 52]);
        expect(map.items[4]!.contents.map((item) => item.pid)).toEqual([40, 9]);
        const view = new DataView(save.buffer);
        expect([view.getInt32(map.stats, false), view.getInt32(map.stats + 4, false), view.getInt32(map.stats + 8, false)]).toEqual([5, 7, 21_500]);
        expect([view.getInt32(map.traits, false), view.getInt32(map.traits + 4, false)]).toEqual([2, -1]);
        expect(view.getInt32(map.lastLevel, false)).toBe(6);
        expect(save[map.perksOwed]).toBe(1);
        expect(view.getInt32(map.tags + 8, false)).toBe(14);
      }
    }
  });

  it('refuses an item the game does not describe, and a save it cannot follow', () => {
    const save = buildSave({ game: 'fo2', items: [{ pid: 777, kind: 'weapon' }] });
    expect(() => mapSave(save, 'fo2', kindOf)).toThrow(SaveMapError);
    expect(() => mapSave(save, 'fo2', kindOf)).toThrow(/item 777/);
    // An item the data calls something else than the save stored it as: it no longer adds up.
    const wrong = buildSave({ game: 'fo2', items: [{ pid: 29, kind: 'weapon' }] });
    expect(() => mapSave(wrong, 'fo2', kindOf)).toThrow(SaveMapError);
    expect(() => mapSave(buildSave({ game: 'fo2' }), 'fo1', kindOf)).toThrow(SaveMapError);
  });
});

describe('writing a save', () => {
  it('changes nothing when nothing was changed', async () => {
    for (const game of ['fo1', 'fo2'] as const) {
      const rules = await rulesFor(game);
      const original = open({ game, items: ITEMS, special: [5, 5, 5, 5, 5, 5, 5], maxHitPoints: 30, base: { 9: 5, 11: 1, 12: 150, 13: 10, 14: 1, 15: 5, 31: 10, 32: 25 } });
      const written = writeSave(rules, CATALOG, original, copyRecord(original.record));
      expect(written).toEqual(original.data);
    }
  });

  it('works out what follows from S.P.E.C.I.A.L. as the engine does', async () => {
    const rules = await rulesFor('fo2');
    const original = open({ game: 'fo2', special: [5, 5, 5, 5, 5, 5, 5], maxHitPoints: 30, traits: [-1, -1] });
    const record = copyRecord(original.record);
    record.special = [10, 6, 8, 5, 5, 9, 7];
    const again = readSave(writeSave(rules, CATALOG, original, record), 'fo2', kindOf);
    expect(again.base.slice(0, 7)).toEqual([10, 6, 8, 5, 5, 9, 7]);
    expect(again.base[STAT.maxHitPoints]).toBe(10 + 2 * 8 + 15);
    expect(again.base[STAT.maxActionPoints]).toBe(5 + 4);
    expect(again.base[STAT.armorClass]).toBe(9);
    expect(again.base[STAT.meleeDamage]).toBe(5);
    expect(again.base[STAT.carryWeight]).toBe(275);
    expect(again.base[STAT.sequence]).toBe(12);
    expect(again.base[STAT.healingRate]).toBe(2);
    expect(again.base[STAT.criticalChance]).toBe(7);
    expect(again.base[STAT.radiationResistance]).toBe(16);
    expect(again.base[STAT.poisonResistance]).toBe(40);
  });

  it('gives and takes back what perks add, rank by rank', async () => {
    const rules = await rulesFor('fo2');
    const original = open({ game: 'fo2', perks: { 12: 1 }, bonus: Object.assign(new Array<number>(35).fill(0), { 24: 10 }) });
    expect(original.bonus[STAT.damageResistance]).toBe(10);
    const record = copyRecord(original.record);
    record.perks[12] = 3; // Toughness: +10% resistance a rank
    record.perks[26] = 2; // Action Boy: +1 action point a rank
    let again = readSave(writeSave(rules, CATALOG, original, record), 'fo2', kindOf);
    expect(again.bonus[STAT.damageResistance]).toBe(30);
    expect(again.bonus[STAT.maxActionPoints]).toBe(2);
    expect(again.record.perks[12]).toBe(3);
    record.perks[12] = 0;
    record.perks[26] = 0;
    again = readSave(writeSave(rules, CATALOG, original, record), 'fo2', kindOf);
    expect(again.bonus[STAT.damageResistance]).toBe(0);
    expect(again.bonus[STAT.maxActionPoints]).toBe(0);
  });

  it('brings what a level-up brings, and leaves the rest to the game', async () => {
    const rules = await rulesFor('fo2');
    const original = open({ game: 'fo2', special: [5, 5, 6, 5, 5, 5, 5], maxHitPoints: 32, hitPoints: 20, stats: [0, 2, 1500, 0, 0], lastLevel: 2, traits: [-1, -1] });
    const record = copyRecord(original.record);
    record.level = 5;
    record.experience = experienceFor(rules, 5);
    expect(record.experience).toBe(10_000);
    const again = readSave(writeSave(rules, CATALOG, original, record), 'fo2', kindOf);
    // Endurance 6: 6 / 2 + 2 = 5 hit points a level, three levels.
    expect(again.bonus[STAT.maxHitPoints]).toBe(15);
    expect(again.record.hitPoints).toBe(35);
    expect(again.record.level).toBe(5);
    // The character screen still remembers level 2, and grants skill points and perks for 3 to 5 when it opens.
    expect(again.lastLevel).toBe(2);
    expect(levelFor(rules, 10_000)).toBe(5);

    // Down again: the level and experience, and the character screen's memory with them.
    const lower = copyRecord(original.record);
    lower.level = 1;
    lower.experience = 0;
    const back = readSave(writeSave(rules, CATALOG, original, lower), 'fo2', kindOf);
    expect(back.lastLevel).toBe(1);
    expect(back.bonus[STAT.maxHitPoints]).toBe(0);
  });

  it('keeps hit points within what the character can have', async () => {
    const rules = await rulesFor('fo2');
    const original = open({ game: 'fo2', special: [5, 5, 5, 5, 5, 5, 5], maxHitPoints: 30, hitPoints: 30, traits: [-1, -1] });
    const record = copyRecord(original.record);
    record.special[STAT.endurance] = 1;
    expect(hitPoints(rules, original, record)).toBe(5 + 2 + 15);
    record.hitPoints = 0;
    expect(hitPoints(rules, original, record)).toBe(1);
  });

  it('writes name, description, gender, age, tags, traits, skills and the rest', async () => {
    const rules = await rulesFor('fo1');
    const original = open({ game: 'fo1', items: ITEMS, stats: [3, 4, 6500, 0, 0], radiation: 40, poison: 9 });
    const record = copyRecord(original.record);
    Object.assign(record, { name: 'Albert', description: 'after the necropolis', gender: 1, age: 30, unspent: 20, radiation: 0, poison: 0, perksOwed: 1 });
    record.tags = [0, 8, 9, -1];
    record.traits = [15, 2];
    record.skills[0] = 40;
    const written = writeSave(rules, CATALOG, original, record);
    const again = readSave(written, 'fo1', kindOf);
    expect(again.record).toMatchObject({ name: 'Albert', description: 'after the necropolis', gender: 1, age: 30, unspent: 20, radiation: 0, poison: 0, perksOwed: 1, tags: [0, 8, 9, -1], traits: [15, 2] });
    expect(again.record.skills[0]).toBe(40);
    expect(parseCharacter(written, 'fo1')).toMatchObject({ tagged: [0, 8, 9], traits: [15, 2], irradiated: false });
  });

  it('changes what is carried, and leaves bags and what is in hand as they were', async () => {
    const rules = await rulesFor('fo2');
    const original = open({ game: 'fo2', items: ITEMS });
    const record = copyRecord(original.record);
    record.items[2]!.quantity = 5000; // money
    record.items.splice(5, 1); // the misc item
    record.items.push({ key: 'new1', pid: 4, quantity: 1 }, { key: 'new2', pid: 52, quantity: 2 }, { key: 'new3', pid: 46, quantity: 1 });
    const written = writeSave(rules, CATALOG, original, record);
    const again = readSave(written, 'fo2', kindOf);
    expect(again.record.items.map((item) => [item.pid, item.quantity])).toEqual([[8, 1], [29, 3], [41, 5000], [1, 1], [90, 1], [4, 1], [52, 2], [46, 1]]);
    // The bag and what it holds, to the byte; the weapon in hand still in hand.
    const bag = original.map.items[4]!;
    const bagAgain = again.map.items[4]!;
    expect(written.subarray(bagAgain.start, bagAgain.end)).toEqual(original.data.subarray(bag.start, bag.end));
    expect(again.map.items[0]!.flags & 0x02000000).toBeTruthy();
    // A new weapon loaded from its prototype, a new torch lit as its prototype says, both nowhere on the map.
    const weapon = again.map.items[5]!;
    expect(weapon.extra).toEqual([12, 29]);
    expect(new DataView(written.buffer).getInt32(weapon.object + 4, false)).toBe(-1);
    const light = again.map.items[6]!;
    expect(new DataView(written.buffer).getInt32(light.object + 13 * 4, false)).toBe(8);
    expect(light.flags).toBe(0x08 | 0x8000 | 0x20000000);
    // Every new thing has a number of its own.
    const ids = again.map.items.flatMap((item) => [item.id, ...item.contents.map((inner) => inner.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseCharacter(written, 'fo2')).toMatchObject({ money: 5000, items: 10 });
  });

  it('dresses the other gender in the same armour', async () => {
    const rules = await rulesFor('fo2');
    const original = open({ game: 'fo2', items: ITEMS, fid: 0x01000010 | (1 << 28) });
    const record = copyRecord(original.record);
    record.gender = 1;
    const again = readSave(writeSave(rules, CATALOG, original, record), 'fo2', kindOf);
    const fid = new DataView(again.data.buffer).getInt32(again.map.dude + 8 * 4, false);
    expect(fid).toBe(0x01000011 | (1 << 28));
  });

  it('makes a new item the way the engine does', () => {
    const bytes = mintItem(proto(52, 'misc', { lightDistance: 12, lightIntensity: 0x8000 }), 3, 4321);
    const view = new DataView(bytes.buffer);
    const words = Array.from({ length: bytes.length / 4 }, (_, i) => view.getInt32(i * 4, false));
    expect(words).toEqual([3, 4321, -1, 0, 0, 0, 0, 0, 0, 0x100 + 52, 0x08 | 0x8000 | 0x20000000, 0, 52, -1, 8, 0x8000, 0, -1, -1, 0, 0, 0, 0, 24]);
  });
});

describe('the rules', () => {
  const sheetFor = (original: Original, change: (record: SaveRecord) => void = () => undefined) => {
    const record = copyRecord(original.record);
    change(record);
    return { record, sheet: (rules: Rules) => sheetOf(rules, original, record) };
  };

  it("work skills out as each engine does", async () => {
    const fo2 = await rulesFor('fo2');
    const two = sheetFor(open({ game: 'fo2', special: [6, 5, 5, 5, 5, 7, 5], tagged: [0, -1, -1, -1], traits: [-1, -1] }), (record) => (record.skills[0] = 10));
    // Small Guns: 5 + 4 x Agility, a point spent adds one, tagged twice that and 20.
    expect(skillValue(fo2, two.sheet(fo2), 0)).toBe(5 + 28 + 10 + 10 + 20);
    // Unarmed: 30 + 2 x (Agility + Strength).
    expect(skillValue(fo2, two.sheet(fo2), 3)).toBe(30 + 2 * 13);
    const fo1 = await rulesFor('fo1');
    const one = sheetFor(open({ game: 'fo1', special: [6, 5, 5, 5, 5, 7, 5], tagged: [-1, -1, -1, -1], traits: [-1, -1] }));
    // Fallout's Unarmed: 65 + (Agility + Strength) / 2.
    expect(skillValue(fo1, one.sheet(fo1), 3)).toBe(65 + 6);
    // Hard: the skills that are not for fighting are 10 lower.
    const hard = sheetFor(open({ game: 'fo1', difficulty: 2, special: [5, 5, 5, 5, 5, 5, 5], traits: [-1, -1] }));
    expect(skillValue(fo1, hard.sheet(fo1), 12)).toBe(25 + 10 - 10);
  });

  it('count traits and the perks that raise S.P.E.C.I.A.L. on the spot', async () => {
    const rules = await rulesFor('fo2');
    const { sheet } = sheetFor(open({ game: 'fo2', special: [5, 5, 5, 5, 5, 5, 5], traits: [15, 1] }), (record) => (record.perks[PERK.gainStrength] = 1));
    // Gifted +1, Bruiser +2, Gain Strength +1.
    expect(effectiveStat(rules, sheet(rules), STAT.strength)).toBe(9);
    expect(effectiveStat(rules, sheet(rules), STAT.luck)).toBe(6);
    expect(effectiveStat(rules, sheet(rules), STAT.maxActionPoints)).toBe(Math.trunc(6 / 2) + 5 - 2);
  });

  it('say what a perk asks for', async () => {
    const rules = await rulesFor('fo2');
    const { sheet } = sheetFor(open({ game: 'fo2', special: [5, 5, 5, 5, 5, 5, 5], stats: [0, 3, 3000, 0, 0], traits: [-1, -1] }));
    // Toughness: level 3, Endurance 6, Luck 6.
    const toughness = requirements(rules, sheet(rules), rules.perks[12]!);
    expect(toughness.list.map((item) => [item.text, item.met])).toEqual([['Level 3', true], ['Stat 2 6', false], ['Stat 6 6', false]]);
    expect(toughness.met).toBe(false);
  });

  it("follow what a game changes in its engine's rules", async () => {
    const perks = ascii(['[Perks]', 'Enable=1', '[33]', 'Ranks=-1', '[12]', 'Level=6 ; tougher', 'AGL=7', 'AGI=9', '[25]', 'Skill1=0x4000004', 'Skill1Mag=50', '[PerksTweak]', 'MedicFirstAidBonus=20', '[Traits]', 'Enable=1', '[t14]', 'NoHardcode=1', 'SkillMod=0|10|3|10'].join('\r\n'));
    const skills = ascii(['[Skills]', 'TagSkillBonus=15', 'Skill0=a2|p1', 'SkillBase0=10'].join('\r\n'));
    const ddraw = ascii(['[Misc]', 'PerksFile=config\\Perks.ini', 'SkillsFile=config\\Skills.ini', 'XPTable=1000,3000,6000'].join('\r\n'));
    const rules = await rulesFor('fo2', { 'ddraw.ini': ddraw, 'config/perks.ini': perks, 'config/skills.ini': skills });
    expect(rules.perks[33]!.maxRank).toBe(-1);
    expect(rules.perks[12]!.minLevel).toBe(6);
    // The engine reads AGL, not AGI.
    expect(rules.perks[12]!.special[5]).toBe(7);
    expect(rules.perks[25]!.skill1).toBe(0x4000004);
    expect(rules.tweaks.medicFirstAid).toBe(20);
    expect(rules.traits[14]!.hardcoded).toBe(false);
    expect(rules.traits[14]!.skillMods.slice(0, 4)).toEqual([10, 0, 0, 10]);
    expect(rules.experience).toEqual([0, 1000, 3000, 6000]);
    expect(rules.tagBonus).toBe(15);
    const { sheet } = sheetFor(open({ game: 'fo2', special: [5, 6, 5, 5, 5, 7, 5], tagged: [0, -1, -1, -1], traits: [14, -1] }));
    // 10 + 2 x Agility + Perception, tagged 15, Skilled's own +10 in place of the engine's.
    expect(skillValue(rules, sheet(rules), 0)).toBe(10 + 14 + 6 + 15 + 10);
  });
});
