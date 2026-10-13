/** Game archives made up for the tests: the two .dat formats, built from a few bytes. */
import { zlibSync } from 'fflate';

export const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
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
export function dat2(files: Record<string, { data: Uint8Array; packed: boolean }>): Blob {
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
export function dat1(dirs: Record<string, Record<string, { data: Uint8Array; mode: 0x10 | 0x20 | 0x40 }>>): Blob {
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
