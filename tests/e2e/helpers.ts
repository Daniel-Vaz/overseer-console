import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/** Opens the console on a route with the power-on sequence already seen. */
export async function openConsole(page: Page, route = '', settings: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((stored) => {
    sessionStorage.setItem('overseer-console:booted', '1');
    if (!localStorage.getItem('overseer-console:settings')) {
      localStorage.setItem('overseer-console:settings', JSON.stringify({ sound: false, ...stored }));
    }
  }, settings);
  await page.goto(`#/${route}`);
}

/** A Fallout 2 style archive: its last four bytes hold the size of the file. */
function fakeDat2(size: number): Buffer {
  const data = Buffer.alloc(size, 0x2a);
  data.writeUInt32LE(16, size - 8);
  data.writeUInt32LE(size, size - 4);
  return data;
}

/**
 * Writes a folder laid out like a Fallout 2 install, filled with made-up
 * bytes. Enough for the import pipeline; the engine cannot run it.
 */
export function fakeFallout2Folder(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'overseer-e2e-')), 'Fallout 2');
  mkdirSync(join(root, 'sound', 'music'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'Manual'), { recursive: true });
  writeFileSync(join(root, 'master.dat'), fakeDat2(3 << 20)); // large: stored as its own file
  writeFileSync(join(root, 'critter.dat'), fakeDat2(4096)); // small: goes into the pack
  writeFileSync(join(root, 'patch000.dat'), fakeDat2(4096));
  writeFileSync(join(root, 'fallout2.cfg'), '[system]\r\nlanguage=english\r\n');
  writeFileSync(join(root, 'fallout2.exe'), 'not a program');
  writeFileSync(join(root, 'sound', 'music', '01hub.acm'), Buffer.alloc(2048, 1));
  writeFileSync(join(root, 'data', 'worldmap.dat'), Buffer.alloc(512, 2));
  writeFileSync(join(root, 'Manual', 'manual.txt'), 'read me');
  return root;
}

/** A folder that is not a game. */
export function junkFolder(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'overseer-e2e-')), 'Holiday photos');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'beach.jpg'), 'pixels');
  return root;
}

/** The start of a SAVE.DAT as both engines write it. */
export function fakeSaveDat(character: string, description: string): Buffer {
  const data = Buffer.alloc(0x83 + 224 * 133 + 128);
  data.write('FALLOUT SAVE FILE', 0, 'latin1');
  data.writeInt16BE(1, 0x18);
  data.writeInt16BE(2, 0x1a);
  data.write(character, 0x1d, 'latin1');
  data.write(description, 0x3d, 'latin1');
  data.writeInt16BE(7, 0x65);
  data.writeInt16BE(25, 0x67);
  data.writeInt16BE(2241, 0x69);
  data.writeUInt32BE((8 * 60 + 24) * 600, 0x6b);
  data.write('ARTEMPLE.SAV', 0x73, 'latin1');
  return data;
}
