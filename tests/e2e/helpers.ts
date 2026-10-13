import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { errors, type Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { ascii, dat2 } from '../archives';
import { ettuFiles, fallout1Master, type EttuOptions } from '../ettu';

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

/**
 * Picks a folder through the hidden input behind "Load holodisk".
 *
 * Playwright sets the files and then waits for the input's `input` event,
 * which WebKit now and then fires before Playwright is listening: the page
 * has the folder and the call never returns. What the page shows next is the
 * proof of the upload, so running out of time here is not a failure.
 */
export async function pickFolder(page: Page, folder: string): Promise<void> {
  try {
    await page.locator('input[webkitdirectory]').setInputFiles(folder, { timeout: 10_000 });
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
  }
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
 *
 * With `archives` its three .dat files are real archives holding next to
 * nothing: the engine opens them, and then finds no game in them.
 */
export async function fakeFallout2Folder(archives = false): Promise<string> {
  const root = join(mkdtempSync(join(tmpdir(), 'overseer-e2e-')), 'Fallout 2');
  mkdirSync(join(root, 'sound', 'music'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'Manual'), { recursive: true });
  const archive = async (name: string) => Buffer.from(await dat2({ [`made-up\\${name}.txt`]: { data: ascii(name), packed: false } }).arrayBuffer());
  writeFileSync(join(root, 'master.dat'), archives ? await archive('master') : fakeDat2(3 << 20)); // large: stored as its own file
  writeFileSync(join(root, 'critter.dat'), archives ? await archive('critter') : fakeDat2(4096)); // small: goes into the pack
  writeFileSync(join(root, 'patch000.dat'), archives ? await archive('patch') : fakeDat2(4096));
  writeFileSync(join(root, 'fallout2.cfg'), '[system]\r\nlanguage=english\r\n');
  writeFileSync(join(root, 'fallout2.exe'), 'not a program');
  writeFileSync(join(root, 'sound', 'music', '01hub.acm'), Buffer.alloc(2048, 1));
  writeFileSync(join(root, 'data', 'worldmap.dat'), Buffer.alloc(512, 2));
  writeFileSync(join(root, 'Manual', 'manual.txt'), 'read me');
  return root;
}

/** A Fallout 1 style archive: a small big-endian count, then fixed header words. */
function fakeDat1(size: number): Buffer {
  const data = Buffer.alloc(size, 0x2a);
  data.writeUInt32BE(0x30, 0);
  data.writeUInt32BE(0x5e, 4);
  data.writeUInt32BE(0, 8);
  return data;
}

/**
 * A folder laid out like a Fallout install. Its MASTER.DAT is a real, small
 * archive holding the files Fallout Et Tu borrows from the game.
 */
export async function fakeFallout1Folder(): Promise<string> {
  const root = join(mkdtempSync(join(tmpdir(), 'overseer-e2e-')), 'Fallout');
  mkdirSync(join(root, 'DATA', 'SOUND', 'MUSIC'), { recursive: true });
  writeFileSync(join(root, 'MASTER.DAT'), Buffer.from(await fallout1Master().arrayBuffer()));
  writeFileSync(join(root, 'CRITTER.DAT'), fakeDat1(4096));
  writeFileSync(join(root, 'FALLOUTW.EXE'), 'not a program');
  writeFileSync(join(root, 'DATA', 'SOUND', 'MUSIC', '01HUB.ACM'), Buffer.alloc(2048, 1));
  return root;
}

/** Writes the made-up Fallout Et Tu package into `root`, as its folder is laid out on a desktop. */
function writeEttu(root: string, options: EttuOptions): void {
  for (const [path, data] of Object.entries(ettuFiles(options))) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  }
}

/** Fallout Et Tu as the zip it is downloaded as. */
export function fakeEttuZip(options: EttuOptions = {}): { name: string; mimeType: string; buffer: Buffer } {
  const files = Object.fromEntries(Object.entries(ettuFiles(options)).map(([path, data]) => [`Fallout1in2/${path}`, data]));
  return { name: 'Fallout1in2.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files, { level: 6 })) };
}

/** A Fallout 2 folder with Fallout Et Tu installed inside it, its own tool already run. */
export async function fakeFallout2WithEttu(): Promise<string> {
  const root = await fakeFallout2Folder();
  writeEttu(join(root, 'Fallout1in2'), { extracted: true, forEngine: true });
  return root;
}

/** A folder as one zip, the way it is carried to a device that cannot pick folders. */
export function zipFolder(folder: string, name: string): { name: string; mimeType: string; buffer: Buffer } {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files[`${name}/${relative(folder, path).replace(/\\/g, '/')}`] = new Uint8Array(readFileSync(path));
    }
  };
  walk(folder);
  return { name: `${name}.zip`, mimeType: 'application/zip', buffer: Buffer.from(zipSync(files, { level: 6 })) };
}

/** A folder that is not a game. */
export function junkFolder(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'overseer-e2e-')), 'Holiday photos');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'beach.jpg'), 'pixels');
  return root;
}

/**
 * The start of a SAVE.DAT as both engines write it. `place` is the number of
 * the map it was made on and the level of it the player stood on.
 */
export function fakeSaveDat(character: string, description: string, place: { map: number; level: number } = { map: 0, level: 0 }): Buffer {
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
  data.writeInt16BE(place.level, 0x6f);
  data.writeInt16BE(place.map, 0x71);
  data.write('ARTEMPLE.SAV', 0x73, 'latin1');
  return data;
}

/**
 * A Fallout 2 folder whose MASTER.DAT says what its places are called: the
 * list of maps, the areas they are entered by, and the words for both, laid
 * out as the engine reads them. Three maps; the second and third are in
 * "The Den", and the third has a basement.
 */
export async function fakeFallout2WithPlaces(): Promise<string> {
  const root = await fakeFallout2Folder(true);
  const lines = (...text: string[]) => ascii(text.join('\r\n'));
  const master = dat2({
    'color.pal': { data: Uint8Array.from({ length: 800 }, (_, i) => i % 64), packed: false },
    'data\\maps.txt': {
      data: lines(
        '; Elevation names are in a separate message file.',
        '[Map 000]',
        'lookup_name=Desert Encounter 1',
        'map_name=desert1',
        '',
        '[Map 001]',
        'lookup_name=Den Entrance',
        'map_name=denbus1 ; the west side',
        '',
        '[Map 002]',
        'lookup_name=Den Business',
        'map_name=denbus2',
        '',
      ),
      packed: true,
    },
    'data\\city.txt': {
      data: lines(
        '[Area 00]',
        'area_name=Arroyo',
        'townmap_art_idx=156',
        'entrance_0=On,130,200,Arroyo Village,-1,-1,0',
        '',
        '[Area 01]',
        'area_name=The Den',
        'townmap_art_idx=157',
        'entrance_0=On,140,290,Den Entrance,0,22710,0',
        'entrance_1=Off,290,160,DEN BUSINESS,-1,-1,0',
        '',
      ),
      packed: false,
    },
    'text\\english\\game\\map.msg': {
      data: lines('{200}{}{Desert}', '{203}{}{West Side}', '{206}{}{East Side}', '{207}{}{Basement}', '{1500}{}{Arroyo}', '{1501}{}{The Den}'),
      packed: true,
    },
  });
  writeFileSync(join(root, 'master.dat'), Buffer.from(await master.arrayBuffer()));
  return root;
}
