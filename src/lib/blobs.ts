/**
 * Things that are read like files without being files on this device.
 *
 * The importer copies whatever it is given a range at a time (see SourceBlob
 * in storage/opfs.ts). These are the pieces such sources are built from.
 */
import type { SourceBlob } from './storage/opfs';

/** The bytes of [start, end) of a source. */
export async function readRange(source: SourceBlob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await source.slice(start, end).arrayBuffer());
}

/**
 * A source whose contents come from `read`, which is only ever asked for
 * ranges inside it, and must answer with bytes of its own: never with a view
 * of something it keeps.
 */
export function sourceOf(
  size: number,
  lastModified: number,
  read: (start: number, end: number) => Promise<Uint8Array>,
): SourceBlob {
  const range = async (start: number, end: number): Promise<ArrayBuffer> => {
    const from = Math.max(0, Math.min(start, size));
    const to = Math.max(from, Math.min(end, size));
    if (to === from) return new ArrayBuffer(0);
    const data = await read(from, to);
    if (data.length !== to - from) throw new Error(`short read: wanted ${to - from} bytes, got ${data.length}`);
    // Whoever asked may hand the buffer on to a worker: it must be theirs alone.
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer
      ? data.buffer
      : (data.slice().buffer as ArrayBuffer);
  };
  return {
    size,
    lastModified,
    slice: (start, end) => ({ arrayBuffer: () => range(start, end) }),
    arrayBuffer: () => range(0, size),
    text: async () => new TextDecoder().decode(await range(0, size)),
  };
}

/** A source holding the given bytes. */
export function bytesSource(data: Uint8Array, lastModified = 0): SourceBlob {
  return sourceOf(data.length, lastModified, async (start, end) => data.slice(start, end));
}

/**
 * Reads a slow source in large pieces and answers small requests out of the
 * last piece read. A file in the player's Dropbox costs a request per read;
 * walking through an archive there in ten thousand small steps would take
 * ten thousand requests.
 */
export function buffered(source: SourceBlob, windowBytes = 8 << 20): SourceBlob {
  let held: { start: number; data: Promise<Uint8Array> } | null = null;
  return sourceOf(source.size, source.lastModified, async (start, end) => {
    if (end - start >= windowBytes) return readRange(source, start, end);
    if (held) {
      const data = await held.data.catch(() => null);
      if (data && start >= held.start && end <= held.start + data.length) {
        return data.slice(start - held.start, end - held.start);
      }
    }
    // Archives are read front to back, except for their directory at the
    // end: a window that would run off the end is moved back to fit.
    const from = Math.max(0, Math.min(start, source.size - windowBytes));
    const window = { start: from, data: readRange(source, from, Math.min(source.size, from + windowBytes)) };
    held = window;
    const data = await window.data;
    return data.slice(start - from, end - from);
  });
}
