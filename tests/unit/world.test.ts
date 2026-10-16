import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Catalog, ItemProto } from '../../src/lib/modify/catalog';
import { MapFileError, packMap, readMap, unpackMap } from '../../src/lib/modify/mapfile';
import { partyChanged, readParty, writeParty, type SlotFile } from '../../src/lib/modify/party';
import { copyRecord, curedWithdrawals, dateAt, readSave, writeSave, type Original } from '../../src/lib/modify/record';
import { STAT, levelUpGrants, readRules, skillCost, type Rules } from '../../src/lib/modify/rules';
import type { ItemKind } from '../../src/lib/modify/savemap';
import { readRest } from '../../src/lib/modify/tail';
import { questState, readVariables, readWorld, standing, townStanding } from '../../src/lib/modify/world';
import { madeUpGameData } from '../gamedata';
import { buildMap, critterProto } from '../maps';
import { buildSave, type SaveSpec } from '../saves';

const ascii = (text: string) => new TextEncoder().encode(text);
const msg = (entries: [number, string][]) => ascii(entries.map(([number, text]) => `{${number}}{}{${text}}`).join('\r\n'));
const numbered = (first: number, count: number, name: (index: number) => string) => Array.from({ length: count }, (_, i): [number, string] => [first + i, name(i)]);

function item(pid: number, kind: ItemKind): ItemProto {
  return {
    pid,
    kind,
    name: `Item ${pid}`,
    description: '',
    fid: 0x100 + pid,
    inventoryFid: 0x07000000 + pid,
    flags: 0x08,
    offered: true,
    sid: -1,
    lightDistance: 0,
    lightIntensity: 0,
    weight: 1,
    cost: 10,
    fresh: kind === 'weapon' ? [12, 29] : kind === 'ammo' || kind === 'misc' || kind === 'key' ? [24] : [],
  };
}

const CATALOG: Catalog = { items: new Map([item(4, 'weapon'), item(29, 'ammo'), item(40, 'drug'), item(41, 'misc'), item(46, 'container')].map((entry) => [entry.pid, entry])) };
const kindOf = (pid: number) => CATALOG.items.get(pid)?.kind;

/** A vault13.gam in the games' own manner. */
const GAM = [
  '',
  ' // Comments',
  '',
  '//MAP_GLOBAL_VARS:',
  'GAME_GLOBAL_VARS:',
  '//GLOBAL                                                NUMBER',
  '',
  'GVAR_PLAYER_REPUTATION                  :=0;    //      (0)',
  'GVAR_CHILDKILLER_REPUTATION             :=0;    //      (1)',
  'GVAR_KILL_EVIL_PLANTS                   :=3;    //      (2) Hakunin asked',
  'GVAR_NUMBER_THREE                       :=0;    //  (3)   // Has a note of its own',
  'GVAR_TOWN_REP_ARROYO                    :=0;    //      (4)',
  'GVAR_HOLODISK_ONE                       :=0;    //      (5)',
  'GVAR_NO_VALUE',
  '',
].join('\r\n');

describe('the names of global variables', () => {
  it('reads vault13.gam as the engine does: every line that is not empty or a comment is a variable', () => {
    const variables = readVariables(ascii(GAM));
    expect(variables.map((variable) => variable.name)).toEqual([
      'GVAR_PLAYER_REPUTATION',
      'GVAR_CHILDKILLER_REPUTATION',
      'GVAR_KILL_EVIL_PLANTS',
      'GVAR_NUMBER_THREE',
      'GVAR_TOWN_REP_ARROYO',
      'GVAR_HOLODISK_ONE',
      'GVAR_NO_VALUE',
    ]);
    expect(variables[2]).toEqual({ index: 2, name: 'GVAR_KILL_EVIL_PLANTS', start: 3, note: 'Hakunin asked' });
    expect(variables[3]!.note).toBe('Has a note of its own');
    expect(variables[6]!.start).toBe(0);
    // A line that only looks like a comment from its second character on is still a variable to the engine.
    expect(readVariables(ascii('GAME_GLOBAL_VARS:\r\n A_COMMENT_IT_IS_NOT\r\nGVAR_X :=5;')).map((v) => [v.name, v.start])).toEqual([
      ['A_COMMENT_IT_IS_NOT', 0],
      ['GVAR_X', 5],
    ]);
  });
});

/** Fallout 2's world files, made up. */
function fallout2World(extra: Record<string, Uint8Array> = {}, plain: Record<string, Uint8Array> = {}) {
  return madeUpGameData(
    'fo2',
    {
      'data/vault13.gam': ascii(GAM),
      'data/quests.txt': ascii(['# quests', '1501, 101, 5, 1, 2', '', '1500, 100, 2, 2, 6', '1500, 102, 3, 0, 1'].join('\r\n')),
      'text/english/game/quests.msg': msg([[100, 'Kill the plants.'], [101, 'Free the slaves.'], [102, 'Find the GECK.']]),
      'text/english/game/map.msg': msg([[1500, 'Arroyo'], [1501, 'The Den'], [1502, 'Arroyo'], [1503, 'Golgotha']]),
      'data/holodisk.txt': ascii('# disks\r\n5, 300, 1000\r\n'),
      'text/english/game/pipboy.msg': msg([[300, 'A Disk']]),
      'data/karmavar.txt': ascii('0, 48, 1000, 1100\r\n1, 50, 1003, 1103\r\n'),
      'data/genrep.txt': ascii('1000, 3000\r\n-249, 3004\r\n-2147483648, 3008\r\n'),
      'text/english/game/editor.msg': msg([
        [1000, 'Reputation (General) '],
        [1100, 'How known the character is.'],
        [1003, 'Childkiller'],
        [1103, 'Not a good thing.'],
        [3000, 'Savior'],
        [3004, 'Wanderer'],
        [3008, 'Demon'],
        ...numbered(1004, 8, (i) => `Reliance ${i}`),
        ...numbered(1104, 8, (i) => `What reliance ${i} is`),
        ...numbered(2000, 7, (i) => ['Idolized', 'Liked', 'Accepted', 'Neutral', 'Antipathy', 'Hated', 'Vilified'][i]!),
      ]),
      'text/english/game/proto.msg': msg([...numbered(1450, 19, (i) => `Kind ${i}`), ...numbered(1469, 19, (i) => `What kind ${i} is`)]),
      'data/city.txt': ascii(
        [
          '[Area 00]',
          'townmap_label_art_idx=150',
          'size=Medium',
          '[Area 01]',
          'townmap_label_art_idx=151',
          'size=Large',
          '[Area 02]       ; destroyed',
          'townmap_label_art_idx=370',
          'size=Medium',
          '[Area 03]',
          'townmap_label_art_idx=-1',
          'size=Small',
          '[Area 04]',
          'lock_state=On',
          'townmap_label_art_idx=7',
          'size=Small',
        ].join('\r\n'),
      ),
      ...extra,
    },
    plain,
  );
}

describe("a game's world", () => {
  it("is read from Fallout 2's own files", async () => {
    const world = await readWorld(fallout2World());
    expect(world.variables).toHaveLength(7);
    // The Pip-Boy's order: by place, then as the list gives them.
    expect(world.quests.map((quest) => [quest.place, quest.text, quest.variable, quest.shown, quest.done])).toEqual([
      ['Arroyo', 'Kill the plants.', 2, 2, 6],
      ['Arroyo', 'Find the GECK.', 3, 0, 1],
      ['The Den', 'Free the slaves.', 5, 1, 2],
    ]);
    expect(world.holodisks).toEqual([{ variable: 5, name: 'A Disk' }]);
    expect(world.karma).toMatchObject({ variable: 0, picture: 48, name: 'Reputation (General)' });
    expect(world.titles.map((title) => [title.variable, title.name])).toEqual([[1, 'Childkiller']]);
    expect(standing(world, 1500)).toBe('Savior');
    expect(standing(world, 0)).toBe('Wanderer');
    expect(standing(world, -5000)).toBe('Demon');
    // The engine's own towns, named from the map's words.
    expect(world.towns[0]).toEqual({ variable: 47, area: 0, name: 'Arroyo' });
    expect(world.addictions.map((addiction) => addiction.variable)).toEqual([21, 22, 23, 24, 25, 26, 296, 295]);
    expect(world.addictions[6]!.drugs).toEqual([259]);
    expect(world.addictions[5]!.drugs).toEqual([124, 125]);
    expect(world.kills).toHaveLength(19);
    expect(world.kills[3]).toEqual({ name: 'Kind 3', description: 'What kind 3 is' });
    // Towns of the world map: not the locked, not those without a label, not a second of a name.
    expect(world.areas.map((area) => [area.index, area.name, area.size])).toEqual([
      [0, 'Arroyo', 1],
      [1, 'The Den', 2],
    ]);
    expect(world.water).toBeNull();
  });

  it('takes the towns a game names for itself', async () => {
    const fromSfall = await readWorld(fallout2World({}, { 'ddraw.ini': ascii('[Misc]\r\nCityRepsList=1:4,0:2\r\n') }));
    expect(fromSfall.towns).toEqual([
      { variable: 4, area: 1, name: 'The Den' },
      { variable: 2, area: 0, name: 'Arroyo' },
    ]);
    const fromConfig = await readWorld(fallout2World({ 'config/game#patch.cfg': ascii('[worldmap]\r\ncity_reputation_list=0:4\r\n') }));
    expect(fromConfig.towns).toEqual([{ variable: 4, area: 0, name: 'Arroyo' }]);
  });

  it("is mostly Fallout 1's engine's own", async () => {
    const world = await readWorld(
      madeUpGameData('fo1', {
        'data/vault13.gam': ascii(GAM),
        'text/english/game/pipboy.msg': msg([[700, 'Vault 13'], [701, 'Calm the rebels.'], [704, 'Find the water chip.'], [400, 'FEV Tape']]),
        'text/english/game/editor.msg': msg([[1000, 'Reputation (General) '], [1001, 'Berserker'], [1004, 'Nuka Cola Craving']]),
        'text/english/game/map.msg': msg([[500, 'Vault 13'], [502, 'Shady Sands']]),
        'text/english/game/proto.msg': msg(numbered(450, 15, (i) => `Kind ${i}`)),
      }),
    );
    expect(world.quests[0]).toEqual({ place: 'Vault 13', text: 'Calm the rebels.', variable: 238, shown: 1, done: 2 });
    // The water chip's quest is on the list from the start.
    const chip = world.quests.find((quest) => quest.variable === 101)!;
    expect([chip.text, chip.shown, chip.done]).toEqual(['Find the water chip.', 0, 2]);
    expect(world.holodisks[0]).toEqual({ variable: 162, name: 'FEV Tape' });
    expect(world.karma).toMatchObject({ variable: 155, name: 'Reputation (General)' });
    expect(world.titles.map((title) => title.variable)).toEqual([156, 157, 158]);
    expect(world.addictions[0]).toMatchObject({ variable: 189, name: 'Nuka Cola Craving', drugs: [106] });
    expect(world.areas[2]).toEqual({ index: 2, name: 'Shady Sands', size: 1, variable: 68 });
    expect(world.water).toEqual({ days: 10, chip: 101 });
    expect(world.kills).toHaveLength(15);
  });

  it('words what towns think and where quests stand as the games do', () => {
    expect([40, 29, 15, 14, 1, 0, -1, -15, -16, -30, -31].map(townStanding)).toEqual([0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6]);
    const quest = { place: '', text: '', variable: 0, shown: 2, done: 6 };
    expect([0, 1, 2, 5, 6, 9].map((value) => questState(quest, value))).toEqual(['hidden', 'hidden', 'open', 'open', 'done', 'done']);
  });
});

describe('what follows the character screen', () => {
  it("reads to the end of the file in both engines' order", () => {
    const fo2 = buildSave({ game: 'fo2', rest: { party: [18003, 18062], fuel: 4000, queue: [[100, 0, 18000, [1, 2, 3, 4, 5, 6]], [200, 2, 18000, [0, 259, 101]], [300, 3, 9, [5, 0]]] } });
    const map = readSave(fo2, 'fo2', kindOf).map;
    expect(map.rest?.party.members).toEqual([18003, 18062]);
    expect(map.rest?.world.kind).toBe('fo2');
    expect(map.queue?.events.map((event) => [event.type, event.owner, event.data])).toEqual([
      [0, 18000, [1, 2, 3, 4, 5, 6]],
      [2, 18000, [0, 259, 101]],
      [3, 9, [5, 0]],
    ]);
    const fo1 = buildSave({ game: 'fo1', events: [[2, [1, 106, 53]]], rest: { party: [18048] } });
    const one = readSave(fo1, 'fo1', kindOf).map;
    expect(one.rest?.party.members).toEqual([18048]);
    expect(one.queue?.events.map((event) => [event.type, event.data])).toEqual([[2, [1, 106, 53]]]);
  });

  it('is not read where it does not end the file exactly', () => {
    // Made-up bytes after the record (what older test saves have): no rest, the rest of the editor as before.
    expect(readSave(buildSave({ game: 'fo2' }), 'fo2', kindOf).map.rest).toBeNull();
    const save = buildSave({ game: 'fo2', rest: {} });
    const longer = new Uint8Array(save.length + 4);
    longer.set(save);
    const map = readSave(save, 'fo2', kindOf).map;
    expect(readRest(longer, 'fo2', map.perksOwed + 1, 25)).toBeNull();
  });
});

describe('maps', () => {
  it('read to their last byte, every kind of object at its own length', async () => {
    const data = buildMap({ plain: true, critters: [{ id: 18003, pid: 0x01000003, hitPoints: 20, items: [{ pid: 4, kind: 'weapon', flags: 0x02000000 }, { pid: 40, kind: 'drug', quantity: 3 }] }] });
    const map = await readMap(data, { item: kindOf, scenery: () => undefined });
    expect(map.version).toBe(20);
    expect(map.objects.map((object) => [object.id, object.pid >>> 24])).toEqual([
      [7, 5],
      [8, 3],
      [18003, 1],
    ]);
    expect(map.objects[2]!.items.map((entry) => [entry.pid, entry.quantity])).toEqual([
      [4, 1],
      [40, 3],
    ]);
    expect(map.objects[2]!.end).toBe(data.length - 8);
  });

  it('are refused when they do not add up', async () => {
    const data = buildMap({ critters: [{ id: 1, pid: 0x01000003, items: [{ pid: 777, kind: 'weapon' }] }] });
    await expect(readMap(data, { item: kindOf, scenery: () => undefined })).rejects.toThrow(/item 777/);
    const good = buildMap({ critters: [{ id: 1, pid: 0x01000003 }] });
    await expect(readMap(good.slice(0, good.length - 3), { item: kindOf, scenery: () => undefined })).rejects.toThrow(MapFileError);
  });

  it('come gzipped in Fallout 2 saves, and go back as they came', () => {
    const data = buildMap();
    expect(unpackMap(gzipSync(data))).toEqual(data);
    expect(unpackMap(data)).toEqual(data);
    expect(unpackMap(packMap(data))).toEqual(data);
  });
});

/** A slot of Fallout 2 with a companion in the map the player is on. */
async function partySlot(packed: boolean) {
  const map = buildMap({ critters: [{ id: 12, pid: 0x01000002, hitPoints: 9 }, { id: 18003, pid: 0x01000003, hitPoints: 30, items: [{ pid: 4, kind: 'weapon', flags: 0x02000000 }, { pid: 40, kind: 'drug', quantity: 2 }] }] });
  const data = madeUpGameData('fo2', {
    'proto/critters/critters.lst': ascii('00000001.pro\r\n00000002.pro\r\n00000003.pro\r\n'),
    'proto/critters/00000003.pro': critterProto(0x01000003, 103, 40),
    'text/english/game/pro_crit.msg': msg([[103, 'Sulik']]),
  });
  const files: SlotFile[] = [
    { key: 'data/savegame/slot02/artemple.sav', path: 'SAVEGAME/SLOT02/ARTEMPLE.SAV', data: packed ? packMap(map) : map },
    // The slot's copy of the prototype: levelled up, more hit points.
    { key: 'data/savegame/slot02/proto/critters/00000003.pro', path: 'SAVEGAME/SLOT02/proto/critters/00000003.pro', data: packMap(critterProto(0x01000003, 103, 40, 12)) },
  ];
  const party = await readParty(data, CATALOG, files, 'data/savegame/slot02/', 'ARTEMPLE', [18003]);
  return { data, party: party!, map };
}

describe('the party', () => {
  it('is found in the map the player was on, named and measured from its prototypes', async () => {
    const { party } = await partySlot(true);
    expect(party.members).toHaveLength(1);
    const [member] = party.members;
    expect(member!.name).toBe('Sulik');
    expect(member!.maxHitPoints).toBe(52);
    expect(member!.record.hitPoints).toBe(30);
    expect(member!.record.items.map((entry) => [entry.pid, entry.quantity])).toEqual([
      [4, 1],
      [40, 2],
    ]);
    // Another creature that shares no number with a member is no member.
    expect(party.members.some((entry) => entry.id === 12)).toBe(false);
    expect(party.packed).toBe(true);
  });

  it('is changed in its map, and everything else stays as it was', async () => {
    for (const packed of [true, false]) {
      const { data, party, map } = await partySlot(packed);
      const after = party.members.map((member) => ({ ...member.record, items: member.record.items.map((entry) => ({ ...entry })) }));
      expect(partyChanged(party, after)).toBe(false);
      after[0]!.hitPoints = 99; // above the most: brought down to it
      after[0]!.poison = 4;
      after[0]!.items[1]!.quantity = 7;
      after[0]!.items.push({ key: 'n0', pid: 29, quantity: 2 });
      expect(partyChanged(party, after)).toBe(true);
      const written = await writeParty(data, CATALOG, party, after, new Set([1, 2, 3]));
      expect(written[0] === 0x1f).toBe(packed);
      const again = await readParty(data, CATALOG, [{ key: party.key, path: party.path, data: written }], 'data/savegame/slot02/', 'ARTEMPLE', [18003]);
      const member = again!.members[0]!;
      expect([member.record.hitPoints, member.record.poison]).toEqual([member.maxHitPoints, 4]);
      expect(member.record.items.map((entry) => [entry.pid, entry.quantity])).toEqual([
        [4, 1],
        [40, 7],
        [29, 2],
      ]);
      // A new thing is numbered apart from every object of the map and of the player.
      expect([12, 18003, 1, 2, 3]).not.toContain(member.record.items[2]!.original!.id);
      expect(unpackMap(written).length).toBe(map.length + (member.record.items[2]!.original!.end - member.record.items[2]!.original!.start));
    }
  });
});

async function rulesFor(game: 'fo1' | 'fo2', plain: Record<string, Uint8Array> = {}): Promise<Rules> {
  const perks = game === 'fo1' ? 64 : 119;
  return readRules(
    madeUpGameData(
      game,
      {
        'text/english/game/perk.msg': msg([...numbered(101, perks, (i) => `Perk ${i}`), ...numbered(1101, perks, (i) => `What perk ${i} does`)]),
        'text/english/game/skill.msg': msg(numbered(100, 18, (i) => `Skill ${i}`)),
        'text/english/game/stat.msg': msg(numbered(100, 38, (i) => `Stat ${i}`)),
        'text/english/game/trait.msg': msg(numbered(100, 16, (i) => `Trait ${i}`)),
        'text/english/game/editor.msg': msg([[107, 'MALE'], [108, 'FEMALE']]),
      },
      plain,
    ),
  );
}

function open(spec: SaveSpec): Original {
  return readSave(buildSave(spec), spec.game, kindOf);
}

describe('writing what the world knows', () => {
  it('changes global variables in both of the copies a save keeps, and kills, and reputation', async () => {
    for (const game of ['fo1', 'fo2'] as const) {
      const rules = await rulesFor(game);
      const original = open({ game, rest: {} });
      const record = copyRecord(original.record);
      record.globals[9] = 6;
      record.globals[300] = -12;
      record.kills[3] = 40;
      record.reputation = -7;
      const written = writeSave(rules, CATALOG, original, record);
      const again = readSave(written, game, kindOf);
      expect(again.record.globals[9]).toBe(6);
      expect(again.record.globals[300]).toBe(-12);
      const view = new DataView(written.buffer);
      expect(view.getInt32(again.map.globals.again + 9 * 4, false)).toBe(6);
      expect(again.record.kills[3]).toBe(40);
      expect(again.record.reputation).toBe(-7);
      expect(again.map.rest).not.toBeNull();
    }
  });

  it('moves the clock and the date the header shows with it', async () => {
    const rules = await rulesFor('fo2');
    const original = open({ game: 'fo2', rest: {}, time: 864_000 * 5 + 36_000 * 8, date: [12, 30, 2241] });
    const record = copyRecord(original.record);
    record.time += 864_000 * 3;
    expect(dateAt(original, record.time)).toEqual([1, 2, 2242]);
    const written = writeSave(rules, CATALOG, original, record);
    const view = new DataView(written.buffer);
    expect([view.getInt16(0x65, false), view.getInt16(0x67, false), view.getInt16(0x69, false), view.getUint32(0x6b, false)]).toEqual([1, 2, 2242, record.time]);
    // Back over the end of February.
    expect(dateAt(open({ game: 'fo2', rest: {}, time: 864_000 * 40, date: [3, 1, 2242] }), 864_000 * 39)).toEqual([2, 28, 2242]);
  });

  it('makes places of the world map known as the engine does, and fills the car', async () => {
    const rules = await rulesFor('fo2');
    // Two tiles across, two down; the area hidden by the game, at (420, 330): tile 3, subtile row 0, column 1.
    const original = open({ game: 'fo2', rest: { tiles: 4, across: 2, fuel: 1000, areas: [{ x: 100, y: 100, state: 1, visited: 2 }, { x: 420, y: 330, state: 0, visited: 0, entrances: [1, 0] }] } });
    const record = copyRecord(original.record);
    record.areas[1] = 1;
    record.fuel = 80_000;
    const written = writeSave(rules, CATALOG, original, record, { areaSizes: [1, 1] });
    const again = readSave(written, 'fo2', kindOf);
    expect(again.record.areas).toEqual([2, 1]);
    expect(again.record.fuel).toBe(80_000);
    const world = again.map.rest!.world;
    if (world.kind !== 'fo2') throw new Error('not the world map of Fallout 2');
    expect(world.areas[1]!.state).toBe(1);
    // A medium circle is marked from (410, 320): the subtile there and its neighbours that exist.
    const view = new DataView(written.buffer);
    const state = (tile: number, row: number, column: number) => view.getInt32(world.subtiles + (tile * 42 + row * 7 + column) * 4, false);
    expect(state(3, 0, 1)).toBe(1);
    expect(state(3, 1, 2)).toBe(1);
    expect(state(1, 5, 0)).toBe(1);
    expect(state(3, 3, 3)).toBe(0);
  });

  it('cures an addiction with the withdrawal it brought, and takes back one under way', async () => {
    const rules = await rulesFor('fo2');
    // Perk 74 stands for the withdrawal: what it takes from Strength and Agility is in the bonus statistics while it lasts.
    rules.perks[74]!.maxRank = -1;
    rules.perks[74]!.special = [-2, 0, 0, 0, 0, -1, 0];
    const globals = new Array<number>(696).fill(0);
    globals[296] = 1; // Jet
    globals[22] = 1; // Buffout
    const bonus = new Array<number>(35).fill(0);
    bonus[STAT.strength] = -2;
    bonus[STAT.agility] = -1;
    const original = open({
      game: 'fo2',
      globals,
      bonus,
      protoFlags: 0x10,
      rest: {
        queue: [
          [500, 2, 18000, [0, 259, 74]], // Jet: under way
          [600, 2, 18000, [1, 87, 75]], // Buffout: still to come
          [700, 2, 4242, [0, 259, 74]], // someone else's
          [864_000, 4, -2, []],
        ],
      },
    });
    const record = copyRecord(original.record);
    record.globals[296] = 0;
    expect(curedWithdrawals(original, record).map((event) => event.time)).toEqual([500]);
    const written = writeSave(rules, CATALOG, original, record);
    const again = readSave(written, 'fo2', kindOf);
    expect(again.map.queue!.events.map((event) => event.time)).toEqual([600, 700, 864_000]);
    expect(again.bonus[STAT.strength]).toBe(0);
    expect(again.bonus[STAT.agility]).toBe(0);
    // Still addicted to Buffout: the flag stays.
    expect(again.flags & 0x10).toBe(0x10);

    const both = copyRecord(original.record);
    both.globals[296] = 0;
    both.globals[22] = 0;
    const cured = readSave(writeSave(rules, CATALOG, original, both), 'fo2', kindOf);
    expect(cured.map.queue!.events.map((event) => event.time)).toEqual([700, 864_000]);
    expect(cured.flags & 0x10).toBe(0);
  });

  it("cures in Fallout 1's queue, which comes before the traits", async () => {
    const rules = await rulesFor('fo1');
    const globals = new Array<number>(618).fill(0);
    globals[191] = 1; // Mentats
    const original = open({ game: 'fo1', globals, traits: [4, 9], events: [[3, [0x04000009, 0]], [2, [1, 53, 60], 18000]], rest: {} });
    const record = copyRecord(original.record);
    record.globals[191] = 0;
    const again = readSave(writeSave(rules, CATALOG, original, record), 'fo1', kindOf);
    expect(again.map.queue!.events.map((event) => event.type)).toEqual([3]);
    expect(again.record.traits).toEqual([4, 9]);
    expect(again.map.rest).not.toBeNull();
  });
});

describe('the rules of levels and skill points', () => {
  it('say what the character screen hands out for levels it has not seen', async () => {
    const fo2 = await rulesFor('fo2');
    const sheet = { base: [5, 5, 5, 5, 6, 5, 5, ...new Array<number>(28).fill(0)], bonus: new Array<number>(35).fill(0), skills: new Array<number>(18).fill(0), tags: [-1, -1, -1, -1], perks: new Array<number>(119).fill(0), traits: [-1, -1], level: 7, difficulty: 1, clock: 1200 };
    // Levels 2 to 7: 17 points each (5 + 2 x Intelligence 6), perks at 3 and 6.
    expect(levelUpGrants(fo2, sheet, 1, 7, 0, 0)).toEqual({ skillPoints: 99, perks: 2 });
    expect(levelUpGrants(fo2, sheet, 1, 3, 10, 0)).toEqual({ skillPoints: 34, perks: 1 });
    // A save that owes a perk already gets none replayed (perks are owed as levels are gained).
    expect(levelUpGrants(fo2, sheet, 1, 3, 0, 1)).toEqual({ skillPoints: 34, perks: 0 });
    // Skilled: five points more a level, a perk every fourth.
    expect(levelUpGrants(fo2, { ...sheet, traits: [14, -1] }, 1, 4, 0, 0)).toEqual({ skillPoints: 66, perks: 1 });
    const fo1 = await rulesFor('fo1');
    // Fallout 1 owes one perk at most, and Skilled brings no points.
    expect(levelUpGrants(fo1, { ...sheet, perks: new Array<number>(64).fill(0), traits: [14, -1] }, 1, 8, 0, 0)).toEqual({ skillPoints: 99, perks: 1 });
  });

  it('price skill points as the character screen does', async () => {
    const fo2 = await rulesFor('fo2');
    const sheet = { base: [5, 5, 5, 5, 5, 5, 5, ...new Array<number>(28).fill(0)], bonus: new Array<number>(35).fill(0), skills: new Array<number>(18).fill(0), tags: [-1, -1, -1, -1], perks: new Array<number>(119).fill(0), traits: [-1, -1], level: 1, difficulty: 1, clock: 1200 };
    // Small Guns starts at 5 + 4 x Agility 5 = 25%: one point, until 101%.
    expect(skillCost(fo2, sheet, 0)).toBe(1);
    expect(skillCost(fo2, { ...sheet, skills: [80, ...new Array<number>(17).fill(0)] }, 0)).toBe(2);
    expect(skillCost(fo2, { ...sheet, skills: [180, ...new Array<number>(17).fill(0)] }, 0)).toBe(6);
    const custom = await rulesFor('fo2', { 'ddraw.ini': ascii('[Misc]\r\nSkillsFile=config\\Skills.ini\r\n'), 'config/skills.ini': ascii('[Skills]\r\nSkillCost0=30|60\r\n') });
    // By the value: 25% costs 1, 35% (ten points on) 2, 65% 3.
    expect(skillCost(custom, sheet, 0)).toBe(1);
    expect(skillCost(custom, { ...sheet, skills: [10, ...new Array<number>(17).fill(0)] }, 0)).toBe(2);
    expect(skillCost(custom, { ...sheet, skills: [40, ...new Array<number>(17).fill(0)] }, 0)).toBe(3);
    expect(skillCost(await rulesFor('fo1'), { ...sheet, perks: new Array<number>(64).fill(0), skills: [180, ...new Array<number>(17).fill(0)] }, 0)).toBe(1);
  });
});
