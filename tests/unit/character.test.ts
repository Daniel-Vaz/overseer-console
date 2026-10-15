import { describe, expect, it } from 'vitest';
import { HEADER_SIZE, parseCharacter, parseSaveHeader } from '../../src/lib/savefile';
import { buildSave, type Item, type ItemKind } from '../saves';

describe('parseCharacter', () => {
  it('reads a fresh Fallout 2 character', () => {
    const save = buildSave({ game: 'fo2', items: [{ pid: 7, kind: 'weapon' }] });
    expect(parseSaveHeader(save)).not.toBeNull();
    expect(parseCharacter(save, 'fo2')).toEqual({
      hitPoints: 44,
      maxHitPoints: 44,
      poisoned: false,
      irradiated: false,
      special: [8, 5, 9, 3, 4, 7, 4],
      tagged: [4, 0, 5],
      kills: 0,
      money: 0,
      items: 1,
      karma: 0,
      perks: [],
      level: 1,
      experience: 0,
      traits: [6, 15],
    });
  });

  it('finds its way through an inventory of every kind of item, bags included', () => {
    const globals = new Array<number>(696).fill(0);
    globals[0] = 250; // karma
    globals[40] = 7;
    const items: Item[] = [
      { pid: 8, kind: 'weapon' },
      { pid: 29, kind: 'ammo', quantity: 3 },
      { pid: 41, kind: 'drug', quantity: 1200 }, // money takes no extra words
      { pid: 1, kind: 'armor' },
      {
        pid: 90,
        kind: 'container',
        holds: [
          { pid: 40, kind: 'drug', quantity: 4 },
          { pid: 41, kind: 'drug', quantity: 34 },
          { pid: 9, kind: 'weapon' },
        ],
      },
      { pid: 52, kind: 'misc' },
      { pid: 78, kind: 'key' },
      { pid: 46, kind: 'container', holds: [{ pid: 47, kind: 'container', holds: [{ pid: 30, kind: 'ammo', quantity: 9 }] }] },
    ];
    const kills = new Array<number>(19).fill(0);
    kills[0] = 12;
    kills[7] = 31;
    const save = buildSave({
      game: 'fo2',
      globals,
      maps: ['ARTEMPLE.SAV', 'ARCAVES.SAV', 'DENBUS1.SAV'],
      items,
      hitPoints: 61,
      maxHitPoints: 96,
      poison: 14,
      special: [6, 8, 4, 2, 9, 10, 5],
      bonus: [0, 1, 0, 0, 0, 3],
      kills,
      tagged: [0, 9, 14, 12],
      perks: { 0: 1, 11: 2, 60: 1, 73: 1, 118: 1 },
      companionPerks: { 2: 1 },
      stats: [7, 12, 70_250, 3, 0],
      traits: [15, -1],
    });
    expect(parseCharacter(save, 'fo2')).toEqual({
      hitPoints: 61,
      maxHitPoints: 96,
      poisoned: true,
      irradiated: false,
      special: [6, 9, 4, 2, 9, 10, 5],
      tagged: [0, 9, 14, 12],
      kills: 43,
      money: 1234,
      items: 13,
      karma: 250,
      // Slot 60 is an effect of a weapon in hand, not a perk the player took.
      perks: [0, 11, 11, 73, 118],
      level: 12,
      experience: 70_250,
      traits: [15],
    });
  });

  it('copes with every item being the last one', () => {
    const kinds: ItemKind[] = ['weapon', 'ammo', 'misc', 'key', 'armor', 'drug'];
    for (const kind of kinds) {
      for (const protoFlags of [0, 1, 8, 0x4000]) {
        const save = buildSave({ game: 'fo2', protoFlags, items: [{ pid: 3, kind: 'armor' }, { pid: 5, kind }] });
        expect(parseCharacter(save, 'fo2')?.items, `${kind}, flags ${protoFlags}`).toBe(2);
      }
      const bagLast = buildSave({ game: 'fo1', items: [{ pid: 46, kind: 'container', holds: [{ pid: 5, kind }] }] });
      expect(parseCharacter(bagLast, 'fo1')?.items, `${kind} in a bag`).toBe(2);
    }
    expect(parseCharacter(buildSave({ game: 'fo2', items: [] }), 'fo2')?.items).toBe(0);
  });

  it('reads a save made in the middle of a fight', () => {
    const save = buildSave({ game: 'fo2', fighting: 5, stats: [0, 3, 3100, 0, 0] });
    expect(parseCharacter(save, 'fo2')).toMatchObject({ level: 3, experience: 3100, traits: [6, 15] });
    const first = buildSave({ game: 'fo1', fighting: 3, stats: [2, 4, 6400, 0, 0], traits: [1, 6] });
    expect(parseCharacter(first, 'fo1')).toMatchObject({ level: 4, experience: 6400, traits: [1, 6] });
  });

  it('reads Fallout 2 saves from game data with other numbers of companions', () => {
    for (const [companions, aiPackets] of [[0, 0], [1, 1], [25, 19], [25, 0], [40, 33]] as const) {
      const save = buildSave({ game: 'fo2', companions, aiPackets, stats: [1, 9, 40_000, 0, 0], traits: [0, 3] });
      expect(parseCharacter(save, 'fo2'), `${companions} companions`).toMatchObject({ level: 9, experience: 40_000, traits: [0, 3] });
    }
  });

  it('reads a Fallout 1 character, whose traits come after the queue of timed events', () => {
    const globals = new Array<number>(618).fill(0);
    globals[155] = -40;
    const save = buildSave({
      game: 'fo1',
      globals,
      maps: ['V13ENT.SAV'],
      items: [{ pid: 4, kind: 'weapon' }, { pid: 8, kind: 'weapon' }, { pid: 29, kind: 'ammo', quantity: 3 }, { pid: 40, kind: 'drug', quantity: 4 }, { pid: 41, kind: 'drug', quantity: 77 }],
      hitPoints: 20,
      maxHitPoints: 43,
      radiation: 60,
      special: [8, 4, 9, 4, 4, 7, 4],
      tagged: [0, 1, 3, -1],
      perks: { 5: 1, 55: 1 },
      stats: [0, 6, 15_200, 0, 0],
      traits: [6, 1],
      events: [
        [0, [1, 2, 3, 4, 5, 6]], // a drug wearing off
        [3, [0x04000009, 0]], // a script timer
        [6, [40, 0]], // radiation
        [2, [1, 53, 54]], // withdrawal
        [4, []],
        [1, []],
      ],
    });
    expect(parseCharacter(save, 'fo1')).toEqual({
      hitPoints: 20,
      maxHitPoints: 43,
      poisoned: false,
      irradiated: true,
      special: [8, 4, 9, 4, 4, 7, 4],
      tagged: [0, 1, 3],
      kills: 0,
      money: 77,
      items: 5,
      karma: -40,
      perks: [5],
      level: 6,
      experience: 15_200,
      traits: [6, 1],
    });
  });

  it('keeps what it is sure of when the rest of a save is unfamiliar', () => {
    // An event type this console does not know: the traits cannot be reached.
    const save = buildSave({ game: 'fo1', stats: [0, 2, 1500, 0, 0], events: [[40, [1, 2, 3]]] });
    const character = parseCharacter(save, 'fo1');
    expect(character).toMatchObject({ level: 2, experience: 1500, hitPoints: 44 });
    expect(character?.traits).toBeUndefined();
  });

  it('says nothing about files it cannot follow', () => {
    const save = buildSave({ game: 'fo2', items: [{ pid: 7, kind: 'weapon' }] });
    expect(parseCharacter(save.subarray(0, HEADER_SIZE), 'fo2')).toBeNull();
    expect(parseCharacter(save.subarray(0, HEADER_SIZE + 3000), 'fo2')).toBeNull();
    expect(parseCharacter(new Uint8Array(HEADER_SIZE + 5000), 'fo2')).toBeNull();
    // The other game's layout does not fit.
    expect(parseCharacter(save, 'fo1')).toBeNull();
    const noise = save.slice();
    for (let i = HEADER_SIZE; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    expect(parseCharacter(noise, 'fo2')).toBeNull();
  });
});
