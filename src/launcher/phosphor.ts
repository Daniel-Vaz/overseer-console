/**
 * The games' colour pictures, drawn the way this tube draws everything: as
 * brightness, in the phosphor's green.
 *
 *  - glow: the brighter a pixel was, the brighter it shines. For a save's
 *    screenshot and for the things a character carries.
 *  - ink: for the line drawings on the character screen's cards (Vault Boy
 *    on parchment). The ink shines and the paper falls away into the tube;
 *    drawn the other way round they would be slabs of bright green.
 */
import type { Frame } from '../lib/frm';

export type PhosphorStyle = 'glow' | 'ink';

const luma = (palette: Uint8Array, index: number): number =>
  (0.299 * palette[index * 3]! + 0.587 * palette[index * 3 + 1]! + 0.114 * palette[index * 3 + 2]!) / 255;

/**
 * Writes one pixel at `level` (0 to 1) of the phosphor's light: up to three
 * quarters its own green, above that towards its white-hot core.
 */
export function shine(out: Uint8ClampedArray, at: number, level: number, alpha = 255): void {
  const body = Math.min(1, level / 0.75);
  const core = Math.max(0, (level - 0.75) / 0.25);
  out[at] = 77 * body + (200 - 77) * core;
  out[at + 1] = 255 * body;
  out[at + 2] = 124 * body + (214 - 124) * core;
  out[at + 3] = alpha;
}

/** A save's picture: dark games, so the shadows are lifted to read at this size. */
export function glowLevel(palette: Uint8Array, index: number): number {
  return Math.pow(luma(palette, index), 0.72);
}

/** Paints a frame of palette indices into RGBA pixels. Index 0 stays clear. */
export function paint(frame: Frame, palette: Uint8Array, style: PhosphorStyle): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, pixels } = frame;
  const out = new Uint8ClampedArray(width * height * 4);
  if (style === 'glow') {
    for (let i = 0; i < width * height; i++) {
      if (pixels[i] === 0) continue;
      shine(out, i * 4, glowLevel(palette, pixels[i]!));
    }
    return out;
  }
  // The paper is whatever brightness most of the card has; ink is what is darker than it.
  const levels = new Float32Array(width * height);
  for (let i = 0; i < levels.length; i++) levels[i] = luma(palette, pixels[i]!);
  const paper = Float32Array.from(levels).sort()[Math.floor(levels.length * 0.5)]! || 1;
  for (let i = 0; i < levels.length; i++) {
    if (pixels[i] === 0) continue;
    const ink = Math.min(1, Math.max(0, (paper * 0.94 - levels[i]!) / (paper * 0.78)));
    const level = Math.pow(ink, 0.75);
    // The paper keeps a faint trace of its grain, as a tube's unlit face does.
    shine(out, i * 4, Math.max(level, 0.16), Math.round(255 * Math.max(level, 0.09)));
  }
  return out;
}
