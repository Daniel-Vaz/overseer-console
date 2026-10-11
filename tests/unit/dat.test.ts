import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { findInDat, readDatEntry, unpackDat1 } from '../../src/lib/dat';
import { decodePalette, messageNames } from '../../src/lib/gamefacts';

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const u32le = (value: number) => new Uint8Array(new Uint32Array([value]).buffer);
const u32be = (value: number) => Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);

/** A Fallout 2 archive: file data, then the directory, then two sizes. */
function dat2(files: Record<string, { data: Uint8Array; packed: boolean }>): Blob {
  const blobs: Uint8Array[] = [];
  const tree: Uint8Array[] = [u32le(Object.keys(files).length)];
  let offset = 0;
  for (const [name, file] of Object.entries(files)) {
    const stored = file.packed ? zlibSync(file.data) : file.data;
    blobs.push(stored);
    tree.push(u32le(name.length), ascii(name), Uint8Array.of(file.packed ? 1 : 0), u32le(file.data.length), u32le(stored.length), u32le(offset));
    offset += stored.length;
  }
  const directory = concat(tree);
  const total = offset + directory.length + 8;
  return new Blob([concat([...blobs, directory, u32le(directory.length), u32le(total)])]);
}

/** LZSS made of literals only: a flag byte of all ones before every eight bytes. */
function lzssLiterals(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let at = 0; at < data.length; at += 8) out.push(0xff, ...data.subarray(at, at + 8));
  return Uint8Array.from(out);
}

/** A Fallout 1 archive: directory names, then each directory's files, then the data. */
function dat1(dirs: Record<string, Record<string, { data: Uint8Array; mode: 0x10 | 0x20 | 0x40 }>>): Blob {
  const names = Object.keys(dirs);
  const pack = (file: { data: Uint8Array; mode: number }): Uint8Array => {
    if (file.mode === 0x20) return file.data;
    if (file.mode === 0x10) return lzssLiterals(file.data);
    // 0x40: a plain block, then an LZSS block.
    const half = Math.floor(file.data.length / 2);
    const lz = lzssLiterals(file.data.subarray(half));
    return concat([Uint8Array.of(0x80 | (half >> 8), half & 255), file.data.subarray(0, half), Uint8Array.of(lz.length >> 8, lz.length & 255), lz]);
  };
  const header: Uint8Array[] = [u32be(names.length), u32be(0x5e), u32be(0), u32be(0)];
  for (const name of names) header.push(Uint8Array.of(name.length), ascii(name));
  const headerSize = header.reduce((sum, part) => sum + part.length, 0) +
    names.reduce((sum, dir) => sum + 16 + Object.keys(dirs[dir]!).reduce((inner, file) => inner + 1 + file.length + 16, 0), 0);
  const data: Uint8Array[] = [];
  let offset = headerSize;
  for (const dir of names) {
    const files = dirs[dir]!;
    header.push(u32be(Object.keys(files).length), u32be(0), u32be(0x10), u32be(0));
    for (const [name, file] of Object.entries(files)) {
      const stored = pack(file);
      header.push(Uint8Array.of(name.length), ascii(name), u32be(file.mode), u32be(offset), u32be(file.data.length), u32be(file.mode === 0x20 ? 0 : stored.length));
      data.push(stored);
      offset += stored.length;
    }
  }
  return new Blob([concat([...header, ...data])]);
}

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
