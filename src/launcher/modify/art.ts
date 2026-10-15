/**
 * The game's pictures as images the tube can show: drawn once in phosphor
 * (see phosphor.ts) and kept as data addresses for the rest of the visit.
 */
import type { Frame } from '../../lib/frm';
import type { ItemProto } from '../../lib/modify/catalog';
import type { Pictures } from '../../lib/modify/pictures';
import { paint, type PhosphorStyle } from '../phosphor';

const drawn = new WeakMap<Pictures, Map<string, Promise<string | null>>>();

function draw(frame: Frame | null, palette: Uint8Array | null, style: PhosphorStyle): string | null {
  if (!frame || !palette) return null;
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.putImageData(new ImageData(paint(frame, palette, style), frame.width, frame.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function remember(pictures: Pictures, key: string, make: () => Promise<string | null>): Promise<string | null> {
  let known = drawn.get(pictures);
  if (!known) drawn.set(pictures, (known = new Map()));
  let url = known.get(key);
  if (!url) {
    url = make().catch(() => null);
    known.set(key, url);
  }
  return url;
}

/** A card of the character screen, its ink lit up. */
export function cardArt(pictures: Pictures, index: number): Promise<string | null> {
  return remember(pictures, `card ${index}`, async () => draw(await pictures.card(index), await pictures.palette, 'ink'));
}

/** An item as the inventory shows it, glowing. */
export function itemArt(pictures: Pictures, item: Pick<ItemProto, 'inventoryFid' | 'fid'>): Promise<string | null> {
  return remember(pictures, `item ${item.inventoryFid} ${item.fid}`, async () => draw(await pictures.item(item.inventoryFid, item.fid), await pictures.palette, 'glow'));
}
