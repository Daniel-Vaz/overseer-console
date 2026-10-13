/**
 * Reads files out of a zip archive where it lies.
 *
 * A game or a conversion often arrives as one zip of several hundred
 * megabytes. Nothing here unpacks it as a whole: the directory at its end is
 * read, and every file in it becomes something the importer can read a range
 * of, exactly like a file picked from a folder.
 */
import { Inflate, inflateSync } from 'fflate';
import { readRange, sourceOf } from './blobs';
import type { SourceBlob } from './storage/opfs';

export class ZipError extends Error {
  override name = 'ZipError';
}

export interface ZipFile {
  /** Path inside the archive, forward slashes. */
  path: string;
  file: SourceBlob;
}

const END = 0x06054b50;
const END64_LOCATOR = 0x07064b50;
const END64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The end record, and the longest comment that may follow it. */
const END_BYTES = 22;
const MAX_COMMENT = 0xffff;

/** No archive of a game comes near this many files. */
const MAX_ENTRIES = 1 << 20;

/** Packed files up to this size are unpacked in one go and remembered for a while. */
const WHOLE_BYTES = 8 << 20;
/** How much unpacked data is remembered. */
const REMEMBERED_BYTES = 48 << 20;
/** Larger packed files are unpacked as a stream, read in pieces of this size. */
const STREAM_BYTES = 1 << 20;

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

function u64(data: DataView, at: number): number {
  const value = data.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('The zip archive is damaged.');
  return Number(value);
}

interface Directory {
  entries: number;
  size: number;
  offset: number;
}

async function findDirectory(archive: SourceBlob): Promise<Directory> {
  if (archive.size < END_BYTES) throw new ZipError('That file is not a zip archive.');
  const tailAt = Math.max(0, archive.size - END_BYTES - MAX_COMMENT);
  const tail = await readRange(archive, tailAt, archive.size);
  const data = view(tail);
  let at = tail.length - END_BYTES;
  while (at >= 0 && data.getUint32(at, true) !== END) at--;
  if (at < 0) throw new ZipError('That file is not a zip archive.');

  const entries = data.getUint16(at + 10, true);
  const size = data.getUint32(at + 12, true);
  const offset = data.getUint32(at + 16, true);
  if (entries !== 0xffff && size !== 0xffffffff && offset !== 0xffffffff) return { entries, size, offset };

  // Too large for the classic record: the real numbers are in a second one,
  // pointed at from just before the first.
  const locatorAt = tailAt + at - 20;
  if (locatorAt < 0) throw new ZipError('The zip archive is damaged.');
  const locator = view(await readRange(archive, locatorAt, locatorAt + 20));
  if (locator.getUint32(0, true) !== END64_LOCATOR) throw new ZipError('The zip archive is damaged.');
  const recordAt = u64(locator, 8);
  const record = view(await readRange(archive, recordAt, recordAt + 56));
  if (record.byteLength < 56 || record.getUint32(0, true) !== END64) throw new ZipError('The zip archive is damaged.');
  return { entries: u64(record, 32), size: u64(record, 40), offset: u64(record, 48) };
}

/** Zip keeps times the way MS-DOS did: local time, two seconds to the tick. */
function dosTime(date: number, time: number): number {
  if (!date) return 0;
  return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
}

interface Entry {
  path: string;
  method: number;
  encrypted: boolean;
  packedSize: number;
  size: number;
  /** Where the entry's own header starts; its data follows that. */
  headerAt: number;
  modified: number;
}

const utf8 = new TextDecoder();

function parseDirectory(data: Uint8Array, count: number): Entry[] {
  const dir = view(data);
  const entries: Entry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > data.length || dir.getUint32(at, true) !== CENTRAL) throw new ZipError('The zip archive is damaged.');
    const flags = dir.getUint16(at + 8, true);
    const nameLength = dir.getUint16(at + 28, true);
    const extraLength = dir.getUint16(at + 30, true);
    const commentLength = dir.getUint16(at + 32, true);
    const nameAt = at + 46;
    const extraAt = nameAt + nameLength;
    if (extraAt + extraLength + commentLength > data.length) throw new ZipError('The zip archive is damaged.');

    let packedSize = dir.getUint32(at + 20, true);
    let size = dir.getUint32(at + 24, true);
    let headerAt = dir.getUint32(at + 42, true);
    // Sizes that did not fit follow in an extra field, in this order.
    for (let extra = extraAt; extra + 4 <= extraAt + extraLength; ) {
      const id = dir.getUint16(extra, true);
      const length = dir.getUint16(extra + 2, true);
      if (id === 1) {
        let field = extra + 4;
        const next = () => {
          if (field + 8 > extra + 4 + length) throw new ZipError('The zip archive is damaged.');
          const value = u64(dir, field);
          field += 8;
          return value;
        };
        if (size === 0xffffffff) size = next();
        if (packedSize === 0xffffffff) packedSize = next();
        if (headerAt === 0xffffffff) headerAt = next();
      }
      extra += 4 + length;
    }

    const name = data.subarray(nameAt, nameAt + nameLength);
    // Bit 11: the name is UTF-8. Otherwise it is in the code page of whoever
    // made the archive; the names of game files are plain ASCII either way.
    const path = (flags & 0x800 ? utf8.decode(name) : String.fromCharCode(...name)).replace(/\\/g, '/');
    if (path && !path.endsWith('/')) {
      entries.push({
        path,
        method: dir.getUint16(at + 10, true),
        encrypted: (flags & 1) !== 0,
        packedSize,
        size,
        headerAt,
        modified: dosTime(dir.getUint16(at + 14, true), dir.getUint16(at + 12, true)),
      });
    }
    at = extraAt + extraLength + commentLength;
  }
  return entries;
}

/** Unpacked files remembered across reads, oldest first. Shared by every archive that is open. */
const remembered = new Map<object, Uint8Array>();
let rememberedBytes = 0;

function remember(key: object, data: Uint8Array): void {
  remembered.set(key, data);
  rememberedBytes += data.length;
  for (const [old, bytes] of remembered) {
    if (rememberedBytes <= REMEMBERED_BYTES || old === key) break;
    remembered.delete(old);
    rememberedBytes -= bytes.length;
  }
}

function entrySource(archive: SourceBlob, entry: Entry): SourceBlob {
  let dataAt: Promise<number> | null = null;
  /** Where the entry's bytes start: past its own header, whose length only the header says. */
  const start = (): Promise<number> =>
    (dataAt ??= readRange(archive, entry.headerAt, entry.headerAt + 30).then((header) => {
      const local = view(header);
      if (header.length < 30 || local.getUint32(0, true) !== LOCAL) throw new ZipError(`The zip archive is damaged at ${entry.path}.`);
      return entry.headerAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    }));
  const refuse = (): never => {
    throw new ZipError(
      entry.encrypted
        ? `${entry.path} is encrypted in that zip archive. Unpack it and pick the folder instead.`
        : `${entry.path} is packed in a way the console cannot read. Unpack the archive and pick the folder instead.`,
    );
  };

  if (entry.encrypted || (entry.method !== 0 && entry.method !== 8)) {
    return sourceOf(entry.size, entry.modified, async () => refuse());
  }
  if (entry.method === 0) {
    return sourceOf(entry.size, entry.modified, async (from, to) => {
      const at = await start();
      return readRange(archive, at + from, at + to);
    });
  }

  if (entry.size <= WHOLE_BYTES) {
    const whole = async (): Promise<Uint8Array> => {
      const known = remembered.get(entry);
      if (known) return known;
      const at = await start();
      const packed = await readRange(archive, at, at + entry.packedSize);
      let data: Uint8Array;
      try {
        data = inflateSync(packed, { out: new Uint8Array(entry.size) });
      } catch {
        throw new ZipError(`${entry.path} is damaged in that zip archive.`);
      }
      if (data.length !== entry.size) throw new ZipError(`${entry.path} is damaged in that zip archive.`);
      remember(entry, data);
      return data;
    };
    return sourceOf(entry.size, entry.modified, async (from, to) => (await whole()).slice(from, to));
  }

  // A large packed file: unpacked front to back as it is read. Reading
  // backwards starts over, which the importer, copying in order, never does.
  let stream: { at: number; packedAt: number; inflate: Inflate; ready: Uint8Array[]; readyBytes: number; ended: boolean } | null = null;
  let busy: Promise<unknown> = Promise.resolve();
  const read = async (from: number, to: number): Promise<Uint8Array> => {
    if (!stream || from < stream.at) {
      const fresh: NonNullable<typeof stream> = { at: 0, packedAt: 0, inflate: null!, ready: [], readyBytes: 0, ended: false };
      fresh.inflate = new Inflate((chunk, final) => {
        fresh.ready.push(chunk);
        fresh.readyBytes += chunk.length;
        if (final) fresh.ended = true;
      });
      stream = fresh;
    }
    const current = stream;
    const out = new Uint8Array(to - from);
    let filled = 0;
    const dataAt = await start();
    while (filled < out.length) {
      if (!current.readyBytes) {
        if (current.ended || current.packedAt >= entry.packedSize) throw new ZipError(`${entry.path} is damaged in that zip archive.`);
        const length = Math.min(STREAM_BYTES, entry.packedSize - current.packedAt);
        const packed = await readRange(archive, dataAt + current.packedAt, dataAt + current.packedAt + length);
        current.packedAt += length;
        try {
          current.inflate.push(packed, current.packedAt >= entry.packedSize);
        } catch {
          throw new ZipError(`${entry.path} is damaged in that zip archive.`);
        }
        continue;
      }
      const chunk = current.ready[0]!;
      // Bytes before the range asked for are passed over.
      const skip = Math.min(chunk.length, Math.max(0, from - current.at));
      const take = Math.min(chunk.length - skip, out.length - filled);
      out.set(chunk.subarray(skip, skip + take), filled);
      filled += take;
      const used = skip + take;
      current.at += used;
      current.readyBytes -= used;
      if (used === chunk.length) current.ready.shift();
      else current.ready[0] = chunk.subarray(used);
    }
    return out;
  };
  // One reader at a time: the stream has a single position.
  return sourceOf(entry.size, entry.modified, (from, to) => {
    const result = busy.then(() => read(from, to));
    busy = result.catch(() => {
      stream = null;
    });
    return result;
  });
}

/** The files in a zip archive. Throws a ZipError when it is not one, or is damaged. */
export async function readZip(archive: SourceBlob): Promise<ZipFile[]> {
  const directory = await findDirectory(archive);
  if (directory.entries > MAX_ENTRIES || directory.offset + directory.size > archive.size) {
    throw new ZipError('The zip archive is damaged.');
  }
  const data = await readRange(archive, directory.offset, directory.offset + directory.size);
  return parseDirectory(data, directory.entries).map((entry) => ({ path: entry.path, file: entrySource(archive, entry) }));
}

/** Whether a picked file is worth trying to read as a zip archive. */
export function looksLikeZip(name: string): boolean {
  return /\.zip$/i.test(name);
}
