import { describe, expect, it } from 'vitest';
import { findInDat, readDatEntry, unpackDat1 } from '../../src/lib/dat';
import { decodePalette, messageNames } from '../../src/lib/gamefacts';
import { ascii, dat1, dat2 } from '../archives';

const palette = Uint8Array.from({ length: 800 }, (_, i) => i % 64);
const message = ascii('# names\r\n{100}{}{Fast Metabolism}\r\n{101}{}{Bruiser}\r\n{102}{snd}{Small Frame}\r\n{200}{}{A description.}\r\n');

describe('Fallout 2 archives', () => {
  const archive = dat2({
    'art\\intrface\\junk.frm': { data: new Uint8Array(5000).fill(9), packed: true },
    'color.pal': { data: palette, packed: true },
    'text\\english\\game\\trait.msg': { data: message, packed: false },
  });

  it('finds files whatever the case or slashes', async () => {
    const found = await findInDat(archive, 'dat2', ['COLOR.PAL', 'Text/English/Game/TRAIT.MSG', 'missing.txt']);
    expect([...found.keys()].sort()).toEqual(['color.pal', 'text/english/game/trait.msg']);
    expect(found.get('color.pal')).toMatchObject({ size: 800, mode: 1 });
  });

  it('unpacks packed and plain files', async () => {
    const found = await findInDat(archive, 'dat2', ['color.pal', 'text/english/game/trait.msg']);
    expect(await readDatEntry(archive, 'dat2', found.get('color.pal')!)).toEqual(palette);
    expect(await readDatEntry(archive, 'dat2', found.get('text/english/game/trait.msg')!)).toEqual(message);
  });

  it('finds nothing in a file that is not an archive', async () => {
    expect((await findInDat(new Blob([new Uint8Array(4096).fill(7)]), 'dat2', ['color.pal'])).size).toBe(0);
    expect((await findInDat(new Blob([]), 'dat2', ['color.pal'])).size).toBe(0);
  });
});

describe('Fallout 1 archives', () => {
  const archive = dat1({
    '.': { 'COLOR.PAL': { data: palette, mode: 0x40 }, 'VAULT13.GAM': { data: ascii('GVAR_ONE :=0;'), mode: 0x20 } },
    'TEXT\\ENGLISH\\GAME': { 'TRAIT.MSG': { data: message, mode: 0x10 }, 'PERK.MSG': { data: ascii('{101}{}{Awareness}'), mode: 0x20 } },
  });

  it('finds files in the root and in folders', async () => {
    const found = await findInDat(archive, 'dat1', ['color.pal', 'text/english/game/trait.msg', 'vault13.gam', 'text/english/game/nope.msg']);
    expect([...found.keys()].sort()).toEqual(['color.pal', 'text/english/game/trait.msg', 'vault13.gam']);
  });

  it('unpacks all three ways a file can be stored', async () => {
    const found = await findInDat(archive, 'dat1', ['color.pal', 'text/english/game/trait.msg', 'vault13.gam']);
    expect(await readDatEntry(archive, 'dat1', found.get('color.pal')!)).toEqual(palette);
    expect(await readDatEntry(archive, 'dat1', found.get('text/english/game/trait.msg')!)).toEqual(message);
    expect(await readDatEntry(archive, 'dat1', found.get('vault13.gam')!)).toEqual(ascii('GVAR_ONE :=0;'));
  });

  it('follows references back into what was already unpacked', () => {
    // "abcabcabc": three literals, then a copy of six bytes that overlaps itself.
    // The window starts at position 4078, so the copy reads from there.
    const from = 4078;
    const packed = Uint8Array.of(0b00000111, 0x61, 0x62, 0x63, from & 255, ((from >> 4) & 0xf0) | (6 - 3));
    expect(unpackDat1(packed, 9, 0x10)).toEqual(ascii('abcabcabc'));
  });
});

describe('game facts', () => {
  it('scales the palette to full brightness and blanks unused entries', () => {
    const file = new Uint8Array(768);
    file.set([63, 0, 32], 3);
    file.set([255, 255, 255], 0);
    const colours = decodePalette(file)!;
    expect([...colours.subarray(0, 6)]).toEqual([0, 0, 0, 255, 0, 130]);
    expect(decodePalette(new Uint8Array(100))).toBeNull();
  });

  it('reads names out of a message file, and refuses a file with gaps', () => {
    expect(messageNames(message, 100, 3)).toEqual(['Fast Metabolism', 'Bruiser', 'Small Frame']);
    expect(messageNames(message, 100, 4)).toEqual([]);
  });
});
