/**
 * A sheet of coarse pixels to paint on.
 *
 * The vault behind the console is painted into these one pixel at a time and
 * shown enlarged, the way the games' own scenery was made of few colours and
 * visible grain. Nothing in this file touches the page.
 */

/** A colour as 0xRRGGBB. */
export type Ink = number;

/** One material, from its deepest shadow to its brightest edge. */
export type Ramp = readonly Ink[];

/** Leaves a pixel as it is. */
export const NONE = -1;

/* The steel, rust, brass and phosphor are the colours of the console's own mark. */
export const STEEL: Ramp = [
  0x060503, 0x0c0c08, 0x12120e, 0x1a1a14, 0x23221a, 0x2a2a22, 0x33332a, 0x3e3f34, 0x4f4c3c, 0x605c49, 0x746e59, 0x8e856a, 0xb0a485, 0xdacaa1,
];
export const RUST: Ramp = [0x1c0f06, 0x281709, 0x40270f, 0x643f19, 0x885723, 0xa0763d];
export const BRASS: Ramp = [0x281709, 0x473722, 0x643f19, 0x885723, 0xa0763d, 0xcc8c35, 0xe5b153];
export const PHOSPHOR: Ramp = [0x022f18, 0x064d2a, 0x1f925d, 0x21e58f, 0x9dffc4];
/* What the mark has no use for: paint, hazard stripes, warning lamps, bone. */
export const BLUE: Ramp = [0x0b1118, 0x131f2c, 0x1c3044, 0x28465f, 0x3a5f7c, 0x5a829b];
export const YELLOW: Ramp = [0x2b2008, 0x4d3a0c, 0x7d5e10, 0xb98c14, 0xdcae2c, 0xf2d268];
export const RED: Ramp = [0x1f0906, 0x45130c, 0x7a1d10, 0xb0321c, 0xe2553a, 0xff9a7a];
export const BONE: Ramp = [0x2a2a22, 0x4f4c3c, 0x746e59, 0x8e856a, 0xb0a485, 0xdacaa1, 0xf4eed5];

/** A number between 0 and 1 that depends only on where it is asked for. */
export function hash(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** Smooth noise: neighbouring places get neighbouring values. */
export function noise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(x0, y0, seed) * (1 - sx) + hash(x0 + 1, y0, seed) * sx;
  const bottom = hash(x0, y0 + 1, seed) * (1 - sx) + hash(x0 + 1, y0 + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** Noise with detail in it: blotches made of smaller blotches. */
export function cloud(x: number, y: number, seed = 0): number {
  return (noise(x, y, seed) * 4 + noise(x * 2, y * 2, seed + 1) * 2 + noise(x * 4, y * 4, seed + 2)) / 7;
}

/**
 * The ink of a material at a brightness from 0 to 1. Neighbouring shades are
 * mixed by speckling them, which is where the grain of the picture comes from.
 */
export function tone(ramp: Ramp, level: number, x: number, y: number, grain = 0.8): Ink {
  const at = level * (ramp.length - 1) + (hash(x, y, 91) - 0.5) * grain;
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(at)))]!;
}

/* Letters three pixels wide and five tall, one number per row. */
const LETTERS: Record<string, readonly number[]> = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [7, 5, 5, 5, 7], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 7, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7], '3': [6, 1, 2, 1, 6], '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 6, 1, 6], '6': [3, 4, 6, 5, 2], '7': [7, 1, 2, 2, 2], '8': [2, 5, 2, 5, 2], '9': [2, 5, 3, 1, 6],
  '.': [0, 0, 0, 0, 2], ',': [0, 0, 0, 2, 4], ':': [0, 2, 0, 2, 0], '-': [0, 0, 7, 0, 0], '!': [2, 2, 2, 0, 2],
  '?': [6, 1, 2, 0, 2], '/': [1, 1, 2, 4, 4], "'": [2, 2, 0, 0, 0], '>': [4, 2, 1, 2, 4], '<': [1, 2, 4, 2, 1],
};

/** How wide a line of lettering comes out. */
export function textWidth(text: string, scale = 1): number {
  return Math.max(0, text.length * 4 - 1) * scale;
}

export class Raster {
  readonly width: number;
  readonly height: number;
  /** Red, green, blue and opacity of every pixel, row by row. */
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }

  /** One pixel. Anything off the sheet is ignored; a strength below 1 lets the old colour through. */
  dot(x: number, y: number, ink: Ink, strength = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (ink < 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const data = this.data;
    if (strength >= 1) {
      data[i] = ink >> 16;
      data[i + 1] = (ink >> 8) & 255;
      data[i + 2] = ink & 255;
      data[i + 3] = 255;
      return;
    }
    const covered = data[i + 3]! / 255;
    // On an empty pixel the ink keeps its colour and only its opacity is thinned.
    const keep = covered * (1 - strength);
    const total = keep + strength;
    data[i] = (data[i]! * keep + (ink >> 16) * strength) / total;
    data[i + 1] = (data[i + 1]! * keep + ((ink >> 8) & 255) * strength) / total;
    data[i + 2] = (data[i + 2]! * keep + (ink & 255) * strength) / total;
    data[i + 3] = Math.max(data[i + 3]!, 255 * (covered + (1 - covered) * strength));
  }

  /** The ink of a pixel, or NONE where nothing has been painted. */
  at(x: number, y: number): Ink {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return NONE;
    const i = (y * this.width + x) * 4;
    if (this.data[i + 3]! < 128) return NONE;
    return (this.data[i]! << 16) | (this.data[i + 1]! << 8) | this.data[i + 2]!;
  }

  box(x: number, y: number, width: number, height: number, ink: Ink, strength = 1): void {
    const x1 = Math.min(this.width, Math.round(x + width));
    const y1 = Math.min(this.height, Math.round(y + height));
    for (let py = Math.max(0, Math.round(y)); py < y1; py++) {
      for (let px = Math.max(0, Math.round(x)); px < x1; px++) this.dot(px, py, ink, strength);
    }
  }

  /** Paints a region pixel by pixel with whatever ink the painter names for each. */
  each(x: number, y: number, width: number, height: number, painter: (x: number, y: number) => Ink): void {
    const x1 = Math.min(this.width, Math.round(x + width));
    const y1 = Math.min(this.height, Math.round(y + height));
    for (let py = Math.max(0, Math.round(y)); py < y1; py++) {
      for (let px = Math.max(0, Math.round(x)); px < x1; px++) this.dot(px, py, painter(px, py));
    }
  }

  /** Makes what is already painted darker (below 1) or lighter (above 1). */
  shade(x: number, y: number, width: number, height: number, factor: number | ((x: number, y: number) => number)): void {
    const x1 = Math.min(this.width, Math.round(x + width));
    const y1 = Math.min(this.height, Math.round(y + height));
    for (let py = Math.max(0, Math.round(y)); py < y1; py++) {
      for (let px = Math.max(0, Math.round(x)); px < x1; px++) {
        const by = typeof factor === 'number' ? factor : factor(px, py);
        if (by === 1) continue;
        const i = (py * this.width + px) * 4;
        this.data[i] = this.data[i]! * by;
        this.data[i + 1] = this.data[i + 1]! * by;
        this.data[i + 2] = this.data[i + 2]! * by;
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, ink: Ink, strength = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.dot(x0, y0, ink, strength);
      if (x0 === x1 && y0 === y1) return;
      const twice = error * 2;
      if (twice >= dy) {
        error += dy;
        x0 += sx;
      }
      if (twice <= dx) {
        error += dx;
        y0 += sy;
      }
    }
  }

  /** A filled circle, or a ring when an inner radius is given. The painter sees how far out and at what angle a pixel lies. */
  disc(cx: number, cy: number, radius: number, painter: Ink | ((distance: number, angle: number, x: number, y: number) => Ink), inner = 0): void {
    const reach = Math.ceil(radius);
    for (let py = Math.floor(cy - reach); py <= cy + reach; py++) {
      for (let px = Math.floor(cx - reach); px <= cx + reach; px++) {
        const distance = Math.hypot(px - cx, py - cy);
        if (distance > radius || distance < inner) continue;
        this.dot(px, py, typeof painter === 'number' ? painter : painter(distance, Math.atan2(py - cy, px - cx), px, py));
      }
    }
  }

  /**
   * A limb: a stroke with thickness, round at both ends. The painter is told
   * how far along it a pixel lies (0 to 1) and how far across (-1 to 1).
   */
  stroke(x0: number, y0: number, x1: number, y1: number, width: number, painter: Ink | ((along: number, across: number, x: number, y: number) => Ink)): void {
    const half = width / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = dx * dx + dy * dy;
    const reach = Math.ceil(half);
    for (let py = Math.floor(Math.min(y0, y1) - reach); py <= Math.max(y0, y1) + reach; py++) {
      for (let px = Math.floor(Math.min(x0, x1) - reach); px <= Math.max(x0, x1) + reach; px++) {
        const along = length ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / length)) : 0;
        const ox = px - (x0 + dx * along);
        const oy = py - (y0 + dy * along);
        const distance = Math.hypot(ox, oy);
        if (distance > half) continue;
        if (typeof painter === 'number') this.dot(px, py, painter);
        else this.dot(px, py, painter(along, (Math.sign(ox * dy - oy * dx) * distance) / half, px, py));
      }
    }
  }

  /** Lettering, top left corner first. Characters without a shape leave a gap. */
  text(x: number, y: number, text: string, ink: Ink | ((x: number, y: number) => Ink), scale = 1, strength = 1): void {
    let left = Math.round(x);
    for (const character of text.toUpperCase()) {
      const rows = LETTERS[character];
      if (rows) {
        for (let row = 0; row < 5; row++) {
          for (let column = 0; column < 3; column++) {
            if (!(rows[row]! & (4 >> column))) continue;
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = left + column * scale + sx;
                const py = Math.round(y) + row * scale + sy;
                this.dot(px, py, typeof ink === 'number' ? ink : ink(px, py), strength);
              }
            }
          }
        }
      }
      left += 4 * scale;
    }
  }

  /** The sheet as something the page can draw: on a canvas of its own, or on one that is to be used again. */
  toCanvas(canvas: HTMLCanvasElement = document.createElement('canvas')): HTMLCanvasElement {
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d')?.putImageData(new ImageData(this.data as Uint8ClampedArray<ArrayBuffer>, this.width, this.height), 0, 0);
    return canvas;
  }
}
