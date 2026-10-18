/**
 * Packs files into a zip without holding them in memory.
 *
 * Every file is stored as it is, not compressed: game data is packed
 * already, and a stored file can be read where it lies in the zip, as
 * zip.ts does. So the zip is put together as a Blob made of the files
 * themselves with a few headers between them, which the browser reads from
 * disk only as the zip is sent. All that is read up front is each file's
 * checksum.
 *
 * Past 4 GB, or 65535 files, the sizes and places no longer fit the
 * original zip format and go in its 64-bit extension, which every unzipper
 * of the last twenty years reads.
 */

export interface PackEntry {
  /** Inside the zip, forward slashes. */
  path: string;
  file: Blob;
  /** When the file was last written. */
  modified: number;
}

export interface PackOptions {
  /** Reports how much has been read for the checksums, and of which file. */
  onProgress?(doneBytes: number, totalBytes: number, path: string): void;
  signal?: AbortSignal;
  /** Use the 64-bit records even when they are not needed (for the tests). */
  zip64?: boolean;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;
/** Bit 11: names are UTF-8. */
const UTF8_NAMES = 0x0800;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
/** What the checksums are read in. */
const READ_BYTES = 4 << 20;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a zip keeps of each file, carried on from `crc` for data read in pieces. */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** Zip keeps times the way MS-DOS did: local time, two seconds to the tick, from 1980 on. */
function dosTime(timestamp: number): { date: number; time: number } {
  const at = new Date(Math.max(timestamp, new Date(1980, 0, 1).getTime()));
  return {
    date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
  };
}

class Writer {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private readonly view: DataView;
  private at = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number): this {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
    return this;
  }

  u32(value: number): this {
    this.view.setUint32(this.at, value >>> 0, true);
    this.at += 4;
    return this;
  }

  u64(value: number): this {
    this.view.setBigUint64(this.at, BigInt(value), true);
    this.at += 8;
    return this;
  }

  raw(data: Uint8Array<ArrayBuffer>): this {
    this.bytes.set(data, this.at);
    this.at += data.length;
    return this;
  }
}

function stopped(): DOMException {
  return new DOMException('stopped', 'AbortError');
}

/** The zip of `entries`, as a Blob that reads the files only when it is read itself. */
export async function packZip(entries: PackEntry[], options: PackOptions = {}): Promise<Blob> {
  const total = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let read = 0;

  for (const entry of entries) {
    if (options.signal?.aborted) throw stopped();
    let crc = 0;
    for (let at = 0; at < entry.file.size; at += READ_BYTES) {
      if (options.signal?.aborted) throw stopped();
      const piece = new Uint8Array(await entry.file.slice(at, Math.min(entry.file.size, at + READ_BYTES)).arrayBuffer());
      crc = crc32(piece, crc);
      read += piece.length;
      options.onProgress?.(read, total, entry.path);
    }

    const name = encoder.encode(entry.path.replace(/\\/g, '/'));
    const size = entry.file.size;
    const { date, time } = dosTime(entry.modified);
    const wide = options.zip64 || size >= MAX32;
    const far = options.zip64 || offset >= MAX32;
    const version = wide || far ? 45 : 20;

    // The file's own header: its sizes go in the 64-bit extra field when they do not fit.
    const local = new Writer(30 + name.length + (wide ? 20 : 0))
      .u32(LOCAL)
      .u16(version)
      .u16(UTF8_NAMES)
      .u16(0)
      .u16(time)
      .u16(date)
      .u32(crc)
      .u32(wide ? MAX32 : size)
      .u32(wide ? MAX32 : size)
      .u16(name.length)
      .u16(wide ? 20 : 0)
      .raw(name);
    if (wide) local.u16(1).u16(16).u64(size).u64(size);
    parts.push(local.bytes, entry.file);

    // Its entry in the directory at the end: sizes, then its place, as far as they do not fit.
    const extra = (wide ? 16 : 0) + (far ? 8 : 0);
    const record = new Writer(46 + name.length + (extra ? 4 + extra : 0))
      .u32(CENTRAL)
      .u16(version)
      .u16(version)
      .u16(UTF8_NAMES)
      .u16(0)
      .u16(time)
      .u16(date)
      .u32(crc)
      .u32(wide ? MAX32 : size)
      .u32(wide ? MAX32 : size)
      .u16(name.length)
      .u16(extra ? 4 + extra : 0)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(far ? MAX32 : offset)
      .raw(name);
    if (extra) {
      record.u16(1).u16(extra);
      if (wide) record.u64(size).u64(size);
      if (far) record.u64(offset);
    }
    central.push(record.bytes);
    offset += local.bytes.length + size;
  }

  const directorySize = central.reduce((sum, record) => sum + record.length, 0);
  parts.push(...central);
  const big = options.zip64 || entries.length >= MAX16 || offset >= MAX32 || directorySize >= MAX32;
  if (big) {
    parts.push(
      new Writer(56).u32(END64).u64(44).u16(45).u16(45).u32(0).u32(0).u64(entries.length).u64(entries.length).u64(directorySize).u64(offset).bytes,
      new Writer(20).u32(END64_LOCATOR).u32(0).u64(offset + directorySize).u32(1).bytes,
    );
  }
  parts.push(
    new Writer(22)
      .u32(END)
      .u16(0)
      .u16(0)
      .u16(big ? MAX16 : entries.length)
      .u16(big ? MAX16 : entries.length)
      .u32(big ? MAX32 : directorySize)
      .u32(big ? MAX32 : offset)
      .u16(0).bytes,
  );
  return new Blob(parts, { type: 'application/zip' });
}
