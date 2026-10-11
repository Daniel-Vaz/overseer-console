import { describe, expect, it } from 'vitest';
import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, parseSaveHeader } from '../../src/lib/saves';

/** Builds the header the engines write at the start of SAVE.DAT. */
function saveFile(options: { character: string; description: string; month: number; day: number; year: number; ticks: number; map: string }): Uint8Array {
  const data = new Uint8Array(0x83 + THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT + 128);
  const view = new DataView(data.buffer);
  const put = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) data[offset + i] = text.charCodeAt(i);
  };
  put(0, 'FALLOUT SAVE FILE');
  view.setInt16(0x18, 1, false);
  view.setInt16(0x1a, 2, false);
  data[0x1c] = 0x52;
  put(0x1d, options.character);
  put(0x3d, options.description);
  view.setInt16(0x65, options.month, false);
  view.setInt16(0x67, options.day, false);
  view.setInt16(0x69, options.year, false);
  view.setUint32(0x6b, options.ticks, false);
  put(0x73, options.map);
  data.fill(7, 0x83, 0x83 + THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT);
  return data;
}

describe('parseSaveHeader', () => {
  it('reads who, when and where', () => {
    // 08:24 on the first day: (8 * 60 + 24) minutes, 600 ticks per minute.
    const header = parseSaveHeader(
      saveFile({ character: 'Narg', description: 'vault', month: 7, day: 25, year: 2241, ticks: (8 * 60 + 24) * 600, map: 'ARTEMPLE.SAV' }),
    );
    expect(header).not.toBeNull();
    expect(header!.character).toBe('Narg');
    expect(header!.description).toBe('vault');
    expect(header!.gameDate).toBe('25 JUL 2241');
    expect(header!.gameClock).toBe('0824');
    expect(header!.map).toBe('ARTEMPLE');
    expect(header!.thumbnail).toHaveLength(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT);
    expect(header!.thumbnail![0]).toBe(7);
  });

  it('wraps the clock at midnight', () => {
    const ticks = (3 * 24 * 60 + 23 * 60 + 5) * 600;
    const header = parseSaveHeader(saveFile({ character: 'A', description: '', month: 12, day: 5, year: 2161, ticks, map: 'V13ENT.SAV' }));
    expect(header!.gameClock).toBe('2305');
    expect(header!.gameDate).toBe('05 DEC 2161');
  });

  it('rejects anything that is not a save', () => {
    expect(parseSaveHeader(new Uint8Array(10))).toBeNull();
    expect(parseSaveHeader(new Uint8Array(4096))).toBeNull();
  });
});
