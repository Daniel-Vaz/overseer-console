/**
 * Reading SAVE.DAT, the file at the heart of a saved game.
 *
 * Both games start it with the same big-endian header: who, when, where and a
 * small picture of the screen. Nothing here touches storage.
 */

const SIGNATURE = 'FALLOUT SAVE FILE';

export const THUMBNAIL_WIDTH = 224;
export const THUMBNAIL_HEIGHT = 133;
const THUMBNAIL_OFFSET = 0x83;

/** Size of the header: everything before the first section of game state. */
export const HEADER_SIZE = THUMBNAIL_OFFSET + THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT + 128;

export interface SaveHeader {
  character: string;
  description: string;
  /** In-game date. */
  gameDate: string;
  /** In-game time of day, "0824". */
  gameClock: string;
  /** Map file the save was made on, without extension. */
  map: string;
  /** 224x133 palette indices, when present. */
  thumbnail?: Uint8Array;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function text(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const code = bytes[offset + i] ?? 0;
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

/** Reads the header of a SAVE.DAT. Returns null when it is not one. */
export function parseSaveHeader(data: Uint8Array): SaveHeader | null {
  if (data.length < THUMBNAIL_OFFSET || text(data, 0, 24) !== SIGNATURE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const month = view.getInt16(0x65, false);
  const day = view.getInt16(0x67, false);
  const year = view.getInt16(0x69, false);
  const ticks = view.getUint32(0x6b, false);
  const minutes = Math.floor(ticks / 600);
  const clock = 100 * (Math.floor(minutes / 60) % 24) + (minutes % 60);
  const thumbnailEnd = THUMBNAIL_OFFSET + THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT;
  return {
    character: text(data, 0x1d, 32),
    description: text(data, 0x3d, 30),
    gameDate: `${String(day).padStart(2, '0')} ${MONTHS[month - 1] ?? '???'} ${year}`,
    gameClock: String(clock).padStart(4, '0'),
    map: text(data, 0x73, 16).replace(/\.sav$/i, ''),
    thumbnail: data.length >= thumbnailEnd ? data.subarray(THUMBNAIL_OFFSET, thumbnailEnd) : undefined,
  };
}

const SAVE_PREFIX = 'data/savegame/';

/** The slot a path inside the game folder belongs to, if it is part of a save. */
export function slotOf(key: string): number | null {
  const match = /^data\/savegame\/slot(\d+)\//.exec(key);
  return match ? Number(match[1]) : null;
}

/** Lower-cased folder of a slot, with a trailing slash. */
export function slotPrefix(slot: number): string {
  return `${SAVE_PREFIX}slot${String(slot).padStart(2, '0')}/`;
}

export function isSaveData(key: string): boolean {
  return /^data\/savegame\/slot\d+\/save\.dat$/.test(key);
}

export { SAVE_PREFIX };
