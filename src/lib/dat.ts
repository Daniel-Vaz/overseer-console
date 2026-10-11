/**
 * Reads single files out of the games' archives (MASTER.DAT and friends).
 *
 * The console only ever needs a few small files from them - the colour
 * palette, for instance - so this looks a file up in the archive's directory
 * and reads just its bytes. The archive itself stays on disk.
 *
 * Two formats exist. Fallout 1: big-endian, a directory at the start, files
 * stored plain or LZSS-compressed. Fallout 2: little-endian, a directory at
 * the end, files stored plain or zlib-compressed.
 */
import { unzlibSync } from 'fflate';
import type { DatFormat } from './games';

export interface DatEntry {
  /** Lower-cased path with forward slashes, as asked for. */
  name: string;
  offset: number;
  /** Size once unpacked. */
  size: number;
  /** Bytes it occupies in the archive. */
  packedSize: number;
  /** Fallout 1: 0x10 one LZSS stream, 0x20 stored, 0x40 LZSS in blocks. Fallout 2: 0 stored, 1 zlib. */
  mode: number;
}

async function bytes(archive: Blob, offset: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await archive.slice(offset, offset + length).arrayBuffer());
}

const latin1 = (data: Uint8Array, offset: number, length: number): string => {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(data[offset + i]!);
  return out;
};

const normalise = (path: string): string => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/** Fallout 2: the directory sits at the end, its size in the last 8 bytes. */
async function findDat2(archive: Blob, wanted: Set<string>): Promise<Map<string, DatEntry>> {
  const found = new Map<string, DatEntry>();
  if (archive.size < 12) return found;
  const tail = new DataView((await bytes(archive, archive.size - 8, 8)).buffer);
  const treeSize = tail.getUint32(0, true);
  const dataSize = tail.getUint32(4, true);
  if (dataSize !== archive.size || treeSize < 4 || treeSize > archive.size - 8) return found;

  const tree = await bytes(archive, archive.size - 8 - treeSize, treeSize);
  const view = new DataView(tree.buffer);
  const count = view.getUint32(0, true);
  let at = 4;
  for (let i = 0; i < count && found.size < wanted.size; i++) {
    if (at + 4 > tree.length) break;
    const nameLength = view.getUint32(at, true);
    at += 4;
    if (nameLength > 4096 || at + nameLength + 13 > tree.length) break;
    const name = normalise(latin1(tree, at, nameLength));
    at += nameLength;
    if (wanted.has(name)) {
      found.set(name, {
        name,
        mode: tree[at]!,
        size: view.getUint32(at + 1, true),
        packedSize: view.getUint32(at + 5, true),
        offset: view.getUint32(at + 9, true),
      });
    }
    at += 13;
  }
  return found;
}

/** Fallout 1: the directory comes first. Its length is not stored, so it is read in growing pieces. */
async function findDat1(archive: Blob, wanted: Set<string>): Promise<Map<string, DatEntry>> {
  const found = new Map<string, DatEntry>();
  for (let window = 512 << 10; ; window *= 4) {
    const head = await bytes(archive, 0, Math.min(window, archive.size));
    const view = new DataView(head.buffer);
    const complete = scan();
    if (complete || head.length >= archive.size) return found;
    found.clear();

    /** Walks the directory. False when it runs past what was read. */
    function scan(): boolean {
      if (head.length < 16) return false;
      const dirCount = view.getUint32(0, false);
      if (dirCount === 0 || dirCount > 4096) return true;
      let at = 16;
      const dirs: string[] = [];
      for (let i = 0; i < dirCount; i++) {
        if (at >= head.length) return false;
        const length = head[at]!;
        if (at + 1 + length > head.length) return false;
        dirs.push(latin1(head, at + 1, length));
        at += 1 + length;
      }
      for (const dir of dirs) {
        if (at + 16 > head.length) return false;
        const fileCount = view.getUint32(at, false);
        at += 16;
        for (let i = 0; i < fileCount; i++) {
          if (at >= head.length) return false;
          const length = head[at]!;
          if (at + 1 + length + 16 > head.length) return false;
          const file = latin1(head, at + 1, length);
          at += 1 + length;
          const name = normalise(dir === '.' ? file : `${dir}/${file}`);
          if (wanted.has(name)) {
            found.set(name, {
              name,
              mode: view.getUint32(at, false) & 0xf0 || 0x10,
              offset: view.getUint32(at + 4, false),
              size: view.getUint32(at + 8, false),
              packedSize: view.getUint32(at + 12, false),
            });
          }
          at += 16;
        }
      }
      return true;
    }
  }
}

/** Looks up files by path (any case, either slash). Missing ones are absent from the result. */
export function findInDat(archive: Blob, format: DatFormat, paths: string[]): Promise<Map<string, DatEntry>> {
  const wanted = new Set(paths.map(normalise));
  return format === 'dat1' ? findDat1(archive, wanted) : findDat2(archive, wanted);
}

/**
 * Unpacks one LZSS stream as the Fallout 1 engine does: a 4096-byte window
 * primed with spaces, a flag byte for every eight items, each item either a
 * literal byte or a (position, length) pair into the window.
 */
function lzss(input: Uint8Array, start: number, end: number, out: Uint8Array, outAt: number): number {
  const ring = new Uint8Array(4096).fill(0x20);
  let ringAt = 4078;
  let at = start;
  while (at < end) {
    const flags = input[at++]!;
    for (let bit = 0; bit < 8 && at < end; bit++) {
      if (flags & (1 << bit)) {
        const value = input[at++]!;
        if (outAt < out.length) out[outAt] = value;
        outAt++;
        ring[ringAt] = value;
        ringAt = (ringAt + 1) & 0xfff;
      } else {
        if (at + 1 >= end) return outAt;
        const low = input[at++]!;
        const high = input[at++]!;
        const from = low | ((high & 0xf0) << 4);
        const length = (high & 0x0f) + 3;
        for (let i = 0; i < length; i++) {
          const value = ring[(from + i) & 0xfff]!;
          if (outAt < out.length) out[outAt] = value;
          outAt++;
          ring[ringAt] = value;
          ringAt = (ringAt + 1) & 0xfff;
        }
      }
    }
  }
  return outAt;
}

/** Unpacks a Fallout 1 file from its stored bytes. */
export function unpackDat1(packed: Uint8Array, size: number, mode: number): Uint8Array {
  if (mode === 0x20) return packed.subarray(0, size);
  const out = new Uint8Array(size);
  if (mode === 0x10) {
    lzss(packed, 0, packed.length, out, 0);
    return out;
  }
  // 0x40: blocks, each led by a 16-bit length whose top bit marks plain bytes.
  let at = 0;
  let outAt = 0;
  while (outAt < size && at + 2 <= packed.length) {
    const header = (packed[at]! << 8) | packed[at + 1]!;
    at += 2;
    const length = header & 0x7fff;
    if (length === 0) break;
    if (header & 0x8000) {
      out.set(packed.subarray(at, Math.min(at + length, at + size - outAt)), outAt);
      outAt += length;
    } else {
      outAt = lzss(packed, at, Math.min(at + length, packed.length), out, outAt);
    }
    at += length;
  }
  return out;
}

/** Largest file this module is willing to unpack; everything it is used for is far smaller. */
const MAX_FILE = 16 << 20;

/** Reads and unpacks one file found by findInDat. */
export async function readDatEntry(archive: Blob, format: DatFormat, entry: DatEntry): Promise<Uint8Array> {
  if (entry.size > MAX_FILE || entry.packedSize > MAX_FILE) throw new Error(`${entry.name} is too large to read here`);
  if (format === 'dat1') {
    // A stored file has no packed size of its own.
    const length = entry.mode === 0x20 ? entry.size : entry.packedSize;
    return unpackDat1(await bytes(archive, entry.offset, length), entry.size, entry.mode);
  }
  const packed = await bytes(archive, entry.offset, entry.packedSize);
  return entry.mode ? unzlibSync(packed, { out: new Uint8Array(entry.size) }) : packed.subarray(0, entry.size);
}
