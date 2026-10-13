import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buffered, bytesSource, readRange } from '../../src/lib/blobs';
import { ZipError, readZip } from '../../src/lib/zip';
import { ascii, concat } from '../archives';

const file = (data: Uint8Array, name = 'archive.zip') => new File([data as Uint8Array<ArrayBuffer>], name);

/** Bytes that pack well but are not all alike, so a mistake in where they are read from shows. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let seed = 12345;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // Runs of a few values: compressible, never periodic.
    out[i] = (seed >> 16) & 7;
  }
  return out;
}

describe('readZip', () => {
  const music = noise(40_000);
  const archive = zipSync(
    {
      'Fallout1in2/Fallout2.cfg': ascii('[system]\r\nlanguage=english\r\n'),
      'Fallout1in2/data/sound/music/01HUB.ACM': [music, { level: 0 }],
      'Fallout1in2/mods/fo1_base/art/tiles/shore01.frm': [noise(9000), { level: 9 }],
      'Fallout1in2/mods/': new Uint8Array(0),
    },
    { level: 6 },
  );

  it('lists the files, not the folders, with their sizes', async () => {
    const files = await readZip(file(archive));
    expect(files.map((entry) => entry.path).sort()).toEqual([
      'Fallout1in2/Fallout2.cfg',
      'Fallout1in2/data/sound/music/01HUB.ACM',
      'Fallout1in2/mods/fo1_base/art/tiles/shore01.frm',
    ]);
    expect(files.find((entry) => entry.path.endsWith('.ACM'))!.file.size).toBe(40_000);
  });

  it('reads stored and packed files, whole and in part', async () => {
    const files = new Map((await readZip(file(archive))).map((entry) => [entry.path, entry.file]));
    expect(await files.get('Fallout1in2/Fallout2.cfg')!.text()).toBe('[system]\r\nlanguage=english\r\n');
    expect(await readRange(files.get('Fallout1in2/data/sound/music/01HUB.ACM')!, 0, 40_000)).toEqual(music);
    expect(await readRange(files.get('Fallout1in2/data/sound/music/01HUB.ACM')!, 1234, 5678)).toEqual(music.subarray(1234, 5678));
    const tile = files.get('Fallout1in2/mods/fo1_base/art/tiles/shore01.frm')!;
    expect(await readRange(tile, 8000, 9000)).toEqual(noise(9000).subarray(8000));
    // Past the end there is nothing, not an error.
    expect((await readRange(tile, 9000, 9500)).length).toBe(0);
  });

  it('unpacks a large packed file as it is read, forwards, and again from the start', async () => {
    const big = noise(11 << 20);
    const [entry] = await readZip(file(zipSync({ 'master.dat': big }, { level: 1 })));
    const source = entry!.file;
    expect(source.size).toBe(big.length);
    // The way an import reads: in order, in pieces.
    for (let at = 0; at < big.length; at += 3 << 20) {
      const end = Math.min(big.length, at + (3 << 20));
      expect(Buffer.compare(await readRange(source, at, end), big.subarray(at, end)), `piece at ${at}`).toBe(0);
    }
    // The way the importer looks at an archive first: its end, then its start.
    expect(await readRange(source, big.length - 8, big.length)).toEqual(big.subarray(big.length - 8));
    expect(await readRange(source, 0, 16)).toEqual(big.subarray(0, 16));
    expect(await readRange(source, 5_000_000, 5_000_100)).toEqual(big.subarray(5_000_000, 5_000_100));
  });

  it('reads an archive too large for the classic end record', async () => {
    // One stored file, written the way archivers do past 4 GB or 65535 files: the
    // real numbers in a second record, the classic fields filled with ones.
    const name = ascii('big/readme.txt');
    const data = ascii('hello from beyond the classic limits');
    const u16 = (value: number) => Uint8Array.of(value & 255, value >> 8);
    const u32 = (value: number) => Uint8Array.of(value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24);
    const u64 = (value: number) => concat([u32(value), u32(0)]);
    const local = concat([u32(0x04034b50), u16(45), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    const extra = concat([u16(1), u16(24), u64(data.length), u64(data.length), u64(0)]);
    const central = concat([
      u32(0x02014b50), u16(45), u16(45), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(0xffffffff), u32(0xffffffff), u16(name.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0), u32(0xffffffff),
      name, extra,
    ]);
    const end64 = concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(1), u64(1), u64(central.length), u64(local.length)]);
    const locator = concat([u32(0x07064b50), u32(0), u64(local.length + central.length), u32(1)]);
    const end = concat([u32(0x06054b50), u16(0), u16(0), u16(0xffff), u16(0xffff), u32(0xffffffff), u32(0xffffffff), u16(0)]);
    const files = await readZip(file(concat([local, central, end64, locator, end])));
    expect(files.map((entry) => entry.path)).toEqual(['big/readme.txt']);
    expect(await files[0]!.file.text()).toBe('hello from beyond the classic limits');
  });

  it('says so when a file is not a zip archive', async () => {
    await expect(readZip(file(noise(5000)))).rejects.toBeInstanceOf(ZipError);
    await expect(readZip(file(new Uint8Array(4)))).rejects.toThrow(/not a zip/);
  });

  it('lists an archive with a file it cannot unpack, and refuses only that file', async () => {
    const data = zipSync({ 'a.txt': ascii('plain'), 'b.txt': [ascii('secret'), { level: 0 }] });
    // Mark the second file as encrypted, in the directory at the end.
    const view = new DataView(data.buffer);
    let at = data.length - 22;
    const directory = view.getUint32(at + 16, true);
    at = directory + 46 + view.getUint16(directory + 28, true) + view.getUint16(directory + 30, true) + view.getUint16(directory + 32, true);
    view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true);
    const files = await readZip(file(data));
    expect(await files[0]!.file.text()).toBe('plain');
    await expect(files[1]!.file.text()).rejects.toThrow(/encrypted/);
  });
});

describe('buffered', () => {
  it('answers many small reads from few large ones', async () => {
    const data = noise(300_000);
    const reads: [number, number][] = [];
    const inner = bytesSource(data);
    const counted = { ...inner, slice: (start: number, end: number) => (reads.push([start, end]), inner.slice(start, end)) };
    const source = buffered(counted, 100_000);

    for (let at = 0; at < 250_000; at += 500) {
      expect(await readRange(source, at, at + 500)).toEqual(data.subarray(at, at + 500));
    }
    expect(reads.length).toBeLessThanOrEqual(3);
    // The directory of an archive sits at its end: the window is moved back to fit.
    expect(await readRange(source, 299_990, 300_000)).toEqual(data.subarray(299_990));
    expect(reads.at(-1)).toEqual([200_000, 300_000]);
    // A read larger than the window goes straight through.
    expect(await readRange(source, 10, 150_010)).toEqual(data.subarray(10, 150_010));
  });
});
