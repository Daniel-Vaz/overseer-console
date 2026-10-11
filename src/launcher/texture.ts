/**
 * Surface textures for the console's housing: fine grain and rust blotches.
 *
 * They are painted once into small canvases and handed to CSS as images.
 * (SVG turbulence filters give the same look, but browsers without GPU
 * rasterisation spend seconds drawing them.)
 */

/** Small deterministic generator, so the housing looks the same on every visit. */
function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function paint(width: number, height: number, draw: (pixels: Uint8ClampedArray) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return 'none';
  const image = context.createImageData(width, height);
  draw(image.data);
  context.putImageData(image, 0, 0);
  return `url(${canvas.toDataURL('image/png')})`;
}

/** Fine dark and light specks: brushed, slightly dirty steel. */
function grain(): string {
  const size = 160;
  const random = randomSource(7);
  return paint(size, size, (pixels) => {
    for (let i = 0; i < size * size; i++) {
      const value = random();
      const light = value > 0.5;
      pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = light ? 255 : 0;
      pixels[i * 4 + 3] = Math.abs(value - 0.5) ** 2 * (light ? 60 : 150);
    }
  });
}

/** Soft, irregular patches of rust. Tiles seamlessly. */
function rust(): string {
  const width = 256;
  const height = 192;
  const random = randomSource(23);
  const octaves = [6, 12, 24].map((cells) => {
    const rows = Math.round((cells * height) / width);
    return { cells, rows, grid: Array.from({ length: cells * rows }, random) };
  });
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (x: number, y: number): number => {
    let total = 0;
    let weight = 1;
    let sum = 0;
    for (const { cells, rows, grid } of octaves) {
      const gx = (x / width) * cells;
      const gy = (y / height) * rows;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      // Wrapping the lattice makes the texture repeat without a seam.
      const at = (cx: number, cy: number) => grid[(cy % rows) * cells + (cx % cells)]!;
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      total += (top * (1 - fy) + bottom * fy) * weight;
      sum += weight;
      weight *= 0.5;
    }
    return total / sum;
  };
  return paint(width, height, (pixels) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = sample(x, y);
        const i = (y * width + x) * 4;
        pixels[i] = 122;
        pixels[i + 1] = 66;
        pixels[i + 2] = 26;
        pixels[i + 3] = Math.max(0, Math.min(1, (value - 0.56) * 5)) * 150;
      }
    }
  });
}

export function applyTextures(): void {
  const style = document.documentElement.style;
  style.setProperty('--grain', grain());
  style.setProperty('--rust', rust());
}
