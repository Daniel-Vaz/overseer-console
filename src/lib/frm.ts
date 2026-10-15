/**
 * The games' pictures (.frm): a header, then frames of palette indices.
 *
 * Big-endian throughout: a version, frames per second, action frame and
 * frames per direction, the shift of each of six directions in x and in y,
 * where each direction's frames start, and their total size. Each frame is
 * its width, height and size, an offset, then one byte per pixel, row by row.
 * Index 0 is transparent.
 *
 * The console only shows still pictures (a perk's card, an item in the
 * inventory), so it reads the first frame facing the first way.
 */

export interface Frame {
  width: number;
  height: number;
  /** width x height palette indices. */
  pixels: Uint8Array;
}

const HEADER = 62;
const FRAME_HEADER = 12;
/** Larger than anything the games draw; a picture that claims more is not one. */
const MAX_SIDE = 2048;

/** The first frame of a picture, or null when the file is not one. */
export function firstFrame(file: Uint8Array): Frame | null {
  if (file.length < HEADER + FRAME_HEADER) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const at = HEADER + view.getUint32(34, false);
  if (at + FRAME_HEADER > file.length) return null;
  const width = view.getUint16(at, false);
  const height = view.getUint16(at + 2, false);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return null;
  const start = at + FRAME_HEADER;
  if (start + width * height > file.length) return null;
  return { width, height, pixels: file.subarray(start, start + width * height) };
}
