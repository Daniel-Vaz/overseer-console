/**
 * Makes a Fallout 2 archive (a .dat) out of loose files, without copying them.
 *
 * A conversion like Fallout Et Tu ships as some sixteen thousand loose files.
 * The engines are quick with a few large archives and slow with a great many
 * small files, and the console's storage is built the same way. So when such a
 * package is loaded its folders are stored as archives: this describes one,
 * and reads any range of it by reading the files it is made of.
 *
 * The format is the games' own: the files back to back, then a directory
 * (count; for each file the length of its name, the name, one byte "packed",
 * size, size as stored, offset), then the size of that directory and of the
 * whole archive. Nothing is packed.
 */
import { readRange, sourceOf } from './blobs';
import type { SourceBlob } from './storage/opfs';

export interface PackMember {
  /** Path inside the archive, either slash. */
  name: string;
  file: SourceBlob;
}

/** The engines keep sizes and offsets in signed 32-bit numbers. */
export const MAX_ARCHIVE_BYTES = 0x7fffffff;

/** Lower case as the engines' C library does it: the letters A to Z and nothing else. */
const lower = (text: string): string => text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));

/** A path as the games' archives spell it, in the one-byte characters they use. */
export function archiveName(path: string): string {
  const name = path.replace(/\//g, '\\').replace(/^(\.?\\)+/, '');
  return name.replace(/[^\x00-\xff]/g, '?');
}

/**
 * The order the directory must be in. The engines find a file by bisecting
 * it, comparing names without regard to case, which is the order of their
 * lower-cased bytes. (Not the same as upper-casing: "_" sorts before the
 * letters here and after them there.)
 */
export function archiveOrder(a: string, b: string): number {
  const [x, y] = [lower(a), lower(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * An archive holding the given files. Where two share a name (in any case)
 * the later one is kept. The files are laid out in the order given, so that
 * copying the archive reads its sources front to back.
 */
export function packDat2(members: PackMember[], lastModified = Date.now()): SourceBlob {
  const byName = new Map<string, { name: string; file: SourceBlob }>();
  for (const member of members) {
    const name = archiveName(member.name);
    if (!name) continue;
    const key = lower(name);
    // Re-inserted, so that it also takes the later one's place in the layout.
    byName.delete(key);
    byName.set(key, { name, file: member.file });
  }

  const laid: { name: string; file: SourceBlob; offset: number; size: number }[] = [];
  let dataBytes = 0;
  for (const { name, file } of byName.values()) {
    laid.push({ name, file, offset: dataBytes, size: file.size });
    dataBytes += file.size;
  }

  const sorted = [...laid].sort((a, b) => archiveOrder(a.name, b.name));
  const treeBytes = 4 + sorted.reduce((sum, entry) => sum + 4 + entry.name.length + 13, 0);
  const total = dataBytes + treeBytes + 8;
  if (total > MAX_ARCHIVE_BYTES) throw new RangeError('too much for one archive');

  const tail = new Uint8Array(treeBytes + 8);
  const view = new DataView(tail.buffer);
  let at = 0;
  view.setUint32(at, sorted.length, true);
  at += 4;
  for (const entry of sorted) {
    view.setUint32(at, entry.name.length, true);
    at += 4;
    for (let i = 0; i < entry.name.length; i++) tail[at + i] = entry.name.charCodeAt(i);
    at += entry.name.length;
    tail[at] = 0; // stored, not packed
    view.setUint32(at + 1, entry.size, true);
    view.setUint32(at + 5, entry.size, true);
    view.setUint32(at + 9, entry.offset, true);
    at += 13;
  }
  view.setUint32(at, treeBytes, true);
  view.setUint32(at + 4, total, true);

  return sourceOf(total, lastModified, async (start, end) => {
    const out = new Uint8Array(end - start);
    if (start < dataBytes) {
      // The first file that reaches into the range.
      let low = 0;
      let high = laid.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (laid[mid]!.offset + laid[mid]!.size <= start) low = mid + 1;
        else high = mid;
      }
      // One after another: a source that reads ahead is read in order.
      for (let index = low; index < laid.length && laid[index]!.offset < end; index++) {
        const entry = laid[index]!;
        const from = Math.max(start, entry.offset);
        const to = Math.min(end, entry.offset + entry.size);
        if (to > from) out.set(await readRange(entry.file, from - entry.offset, to - entry.offset), from - start);
      }
    }
    if (end > dataBytes) {
      const from = Math.max(start, dataBytes);
      out.set(tail.subarray(from - dataBytes, end - dataBytes), from - start);
    }
    return out;
  });
}
