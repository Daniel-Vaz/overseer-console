/**
 * The pictures the save editor shows, out of the player's own copy of the
 * game: the cards of the character screen (art/skilldex, by their line in
 * skilldex.lst) and the things in the inventory (art/inven, by the picture
 * number an item's prototype gives).
 */
import { decodePalette } from '../gamefacts';
import type { GameData } from '../gamedata';
import { firstFrame, type Frame } from '../frm';
import { listNames } from './catalog';

/** The kind of picture a picture number names, in its top byte. */
const INVENTORY = 7;
const ITEMS = 0;

export class Pictures {
  private lists = new Map<string, Promise<string[]>>();
  private frames = new Map<string, Promise<Frame | null>>();
  readonly palette: Promise<Uint8Array | null>;

  constructor(private readonly data: GameData) {
    this.palette = data.read('color.pal').then((file) => (file ? decodePalette(file) : null));
  }

  private list(folder: string): Promise<string[]> {
    let list = this.lists.get(folder);
    if (!list) {
      list = this.data.read(`art/${folder}/${folder}.lst`).then((file) => (file ? listNames(file) : []));
      this.lists.set(folder, list);
    }
    return list;
  }

  private frame(folder: string, index: number): Promise<Frame | null> {
    const key = `${folder}/${index}`;
    let frame = this.frames.get(key);
    if (!frame) {
      frame = this.list(folder).then(async (names) => {
        const name = names[index];
        if (!name) return null;
        const file = await this.data.read(`art/${folder}/${name}`);
        return file ? firstFrame(file) : null;
      });
      this.frames.set(key, frame);
    }
    return frame;
  }

  /** A card of the character screen: its line in skilldex.lst. */
  card(index: number): Promise<Frame | null> {
    return index >= 0 ? this.frame('skilldex', index) : Promise.resolve(null);
  }

  /** An item, as the inventory shows it; its picture on the ground when it has none for the inventory. */
  async item(inventoryFid: number, fid: number): Promise<Frame | null> {
    if (inventoryFid !== -1 && (inventoryFid >>> 24) % 16 === INVENTORY) {
      const frame = await this.frame('inven', inventoryFid & 0xfff);
      if (frame) return frame;
    }
    if (fid !== -1 && (fid >>> 24) % 16 === ITEMS) return this.frame('items', fid & 0xfff);
    return null;
  }
}
