import { describe, expect, it } from 'vitest';
import { bytesSource, readRange } from '../../src/lib/blobs';
import { findInDat, readDatEntry } from '../../src/lib/dat';
import { archiveName, archiveOrder, packDat2 } from '../../src/lib/datpack';
import { ascii } from '../archives';

const member = (name: string, text: string) => ({ name, file: bytesSource(ascii(text)) });

/** The names in an archive's directory, in the order they are stored. */
async function directory(archive: { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } }): Promise<string[]> {
  const all = new Uint8Array(await archive.slice(0, archive.size).arrayBuffer());
  const view = new DataView(all.buffer);
  expect(view.getUint32(all.length - 4, true)).toBe(all.length);
  let at = all.length - 8 - view.getUint32(all.length - 8, true);
  const names: string[] = [];
  const count = view.getUint32(at, true);
  at += 4;
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(at, true);
    names.push(String.fromCharCode(...all.subarray(at + 4, at + 4 + length)));
    at += 4 + length + 13;
  }
  expect(at).toBe(all.length - 8);
  return names;
}

describe('packDat2', () => {
  const archive = packDat2([
    member('scripts/gl_worldmap.int', 'worldmap'),
    member('art/tiles/SHORE01.FRM', 'a tile'),
    member('scripts/glaaa.int', 'aaa'),
    member('text/english/game/perk.msg', '{101}{}{Awareness}'),
    member('color.pal', 'colours'),
    member('art\\tiles\\empty.frm', ''),
  ]);

  it('makes an archive the games\' own reader understands', async () => {
    const found = await findInDat(archive, 'dat2', ['art/tiles/shore01.frm', 'COLOR.PAL', 'text/english/game/perk.msg', 'art/tiles/empty.frm', 'nope.txt']);
    expect([...found.keys()].sort()).toEqual(['art/tiles/empty.frm', 'art/tiles/shore01.frm', 'color.pal', 'text/english/game/perk.msg']);
    expect(await readDatEntry(archive, 'dat2', found.get('art/tiles/shore01.frm')!)).toEqual(ascii('a tile'));
    expect(await readDatEntry(archive, 'dat2', found.get('text/english/game/perk.msg')!)).toEqual(ascii('{101}{}{Awareness}'));
    expect(found.get('art/tiles/empty.frm')).toMatchObject({ size: 0, mode: 0 });
  });

  it('spells names the games\' way and lists them in the order the engine bisects by', async () => {
    expect(await directory(archive)).toEqual([
      'art\\tiles\\empty.frm',
      'art\\tiles\\SHORE01.FRM',
      'color.pal',
      // "_" comes before the letters when case is ignored by lower-casing, as the engine does.
      'scripts\\gl_worldmap.int',
      'scripts\\glaaa.int',
      'text\\english\\game\\perk.msg',
    ]);
    expect(archiveOrder('a_b', 'aab')).toBeLessThan(0);
    expect(archiveOrder('A_B', 'AAB')).toBeLessThan(0);
    expect(archiveOrder('art\\x', 'art_x')).toBeLessThan(0);
    expect(archiveOrder('Tile.FRM', 'tile.frm')).toBe(0);
    expect(archiveName('./data/Art/Tile.frm')).toBe('data\\Art\\Tile.frm');
  });

  it('answers any range from the files it is made of', async () => {
    const all = await readRange(archive, 0, archive.size);
    for (const [start, end] of [[0, 5], [3, 20], [7, archive.size - 3], [archive.size - 40, archive.size], [12, 12]] as const) {
      expect(await readRange(archive, start, end), `${start}-${end}`).toEqual(all.subarray(start, end));
    }
  });

  it('keeps the later of two files with one name, whatever their case', async () => {
    const twice = packDat2([member('data/Maps/V13ENT.MAP', 'old'), member('other.txt', 'x'), member('DATA/maps/v13ent.map', 'newer')]);
    expect(await directory(twice)).toEqual(['DATA\\maps\\v13ent.map', 'other.txt']);
    const found = await findInDat(twice, 'dat2', ['data/maps/v13ent.map']);
    expect(await readDatEntry(twice, 'dat2', found.get('data/maps/v13ent.map')!)).toEqual(ascii('newer'));
    expect(twice.size).toBe('x'.length + 'newer'.length + 4 + (4 + 20 + 13) + (4 + 9 + 13) + 8);
  });
});
