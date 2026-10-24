import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { errors, expect, type Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { ascii, dat2 } from '../archives';
import { ettuFiles, fallout1Master, type EttuOptions } from '../ettu';
import { critterProto } from '../maps';
import { tempFolder } from './tempdirs';

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
  const root = join(tempFolder(), 'Fallout 2');
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
  const root = join(tempFolder(), 'Fallout');
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

/** Files laid out as a folder on disk, below a folder called `name`. */
export function writeFolder(files: Record<string, Uint8Array | string | Blob>, name: string): Promise<string> {
  const root = join(tempFolder(), name);
  return Promise.all(
    Object.entries(files).map(async ([path, data]) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), typeof data === 'string' ? data : data instanceof Blob ? Buffer.from(await data.arrayBuffer()) : data);
    }),
  ).then(() => root);
}

/** Files as one zip, as a mod is downloaded; `folder` puts them in a folder inside it. */
export async function zipOf(files: Record<string, Uint8Array | string | Blob>, name: string, folder = ''): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    entries[`${folder ? `${folder}/` : ''}${path}`] = typeof data === 'string' ? ascii(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  }
  return { name, mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries, { level: 1 })) };
}

/**
 * A zip of exactly `bytes` bytes, as a release of that size is: zeros nobody
 * reads between its last file and its central directory. Its bytes, and the
 * path of a copy on disk for a file picker.
 */
export async function sizedZip(files: Record<string, Uint8Array | string | Blob>, name: string, bytes: number): Promise<{ data: Buffer; path: string }> {
  const zip = (await zipOf(files, name)).buffer;
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error('the zip has a comment');
  const central = zip.readUInt32LE(end + 16);
  const gap = bytes - zip.length;
  if (gap < 0) throw new Error(`the files take more than ${bytes} bytes`);
  const data = Buffer.alloc(bytes);
  zip.copy(data, 0, 0, central);
  zip.copy(data, central + gap, central);
  data.writeUInt32LE(central + gap, end + gap + 16);
  const path = join(tempFolder(), name);
  writeFileSync(path, data);
  return { data, path };
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
  const root = join(tempFolder(), 'Holiday photos');
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
 * out as the engine reads them. Four maps; the second and third are in
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
        // The map every made-up save is made on (see fakeSaveDat), in no area.
        '[Map 003]',
        'lookup_name=Temple of Trials',
        'map_name=artemple',
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

// ---------------------------------------------------------------------
// A game the save editor can work with
// ---------------------------------------------------------------------

const be = (...values: number[]): Uint8Array => {
  const out = new Uint8Array(values.length * 4);
  values.forEach((value, index) => new DataView(out.buffer).setInt32(index * 4, value | 0, false));
  return out;
};

/** A picture in the games' format: one frame, `width` x `height`, a diagonal of colours on index 0. */
function frm(width: number, height: number): Uint8Array {
  const pixels = Uint8Array.from({ length: width * height }, (_, i) => ((i % width) + Math.floor(i / width)) % 3 === 0 ? 0 : 40 + (i % 180));
  const header = new Uint8Array(62);
  const view = new DataView(header.buffer);
  view.setUint32(0, 4, false);
  view.setUint16(4, 10, false);
  view.setUint16(8, 1, false);
  view.setUint32(58, 12 + pixels.length, false);
  const frame = new Uint8Array(12);
  new DataView(frame.buffer).setUint16(0, width, false);
  new DataView(frame.buffer).setUint16(2, height, false);
  new DataView(frame.buffer).setUint32(4, pixels.length, false);
  return Uint8Array.from([...header, ...frame, ...pixels]);
}

type FakeKind = 'armor' | 'container' | 'drug' | 'weapon' | 'ammo' | 'misc' | 'key';

/** The items of the made-up game, by number: what they are and what they are called. */
export const EDITOR_ITEMS: Record<number, { kind: FakeKind; name: string; weight?: number }> = {
  1: { kind: 'armor', name: 'Leather Armor', weight: 8 },
  4: { kind: 'weapon', name: 'Knife', weight: 1 },
  8: { kind: 'weapon', name: '10mm Pistol', weight: 3 },
  29: { kind: 'ammo', name: '10mm JHP' },
  40: { kind: 'drug', name: 'Stimpak' },
  41: { kind: 'misc', name: 'Money' },
  46: { kind: 'container', name: 'Bag', weight: 1 },
};

/** An item prototype as the games store one (proto.cc). */
function proto(pid: number): Uint8Array {
  const item = EDITOR_ITEMS[pid] ?? { kind: 'misc' as const, name: `Junk ${pid}` };
  const kinds: FakeKind[] = ['armor', 'container', 'drug', 'weapon', 'ammo', 'misc', 'key'];
  const type = kinds.indexOf(item.kind);
  const common = be(pid, pid * 100, 0x00000000 + pid, 0, 0, 0x08, item.kind === 'container' ? 0x8000 : 0, -1, type, 0, 1, item.weight ?? 0, 25 * pid, 0x07000000 + (pid % 2));
  const own: Record<FakeKind, Uint8Array> = {
    armor: be(5, 20, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, -1, 0x0100003e, 0x0100003f),
    container: be(100, 0),
    drug: be(-2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    weapon: Uint8Array.from([...be(1, 2, 6, 0, 1, 0, 0, 2, 3, 3, 0, -1, 1, 0, -1, 0), 0]),
    ammo: be(1, 24, 0, 0, 1, 1),
    misc: be(-1, 0, 0),
    key: be(-1),
  };
  return Uint8Array.from([...common, 0, ...own[item.kind]]);
}

/**
 * A Fallout 2 folder whose MASTER.DAT holds what the save editor reads: the
 * words of the character screen, items with their prototypes and pictures,
 * the character screen's cards. Everything made up.
 */
export async function fakeFallout2ForEditor(): Promise<string> {
  const root = await fakeFallout2Folder(true);
  const msg = (entries: [number, string][]) => ascii(entries.map(([number, text]) => `{${number}}{}{${text}}`).join('\r\n'));
  const run = (first: number, names: string[]) => names.map((name, index): [number, string] => [first + index, name]);
  const perks = Array.from({ length: 119 }, (_, i) => ({ 12: 'Toughness', 51: 'Tag!', 18: 'Educated' })[i] ?? `Perk Number ${i}`);
  const skills = ['Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons', 'Throwing', 'First Aid', 'Doctor', 'Sneak', 'Lockpick', 'Steal', 'Traps', 'Science', 'Repair', 'Speech', 'Barter', 'Gambling', 'Outdoorsman'];
  const traits = ['Fast Metabolism', 'Bruiser', 'Small Frame', 'One Hander', 'Finesse', 'Kamikaze', 'Heavy Handed', 'Fast Shot', 'Bloody Mess', 'Jinxed', 'Good Natured', 'Chem Reliant', 'Chem Resistant', 'Sex Appeal', 'Skilled', 'Gifted'];
  const stats = ['Strength', 'Perception', 'Endurance', 'Charisma', 'Intelligence', 'Agility', 'Luck', 'Maximum Hit Points', 'Maximum Action Points', 'Armor Class', 'Unarmed Damage', 'Melee Damage', 'Carry Weight', 'Sequence', 'Healing Rate', 'Critical Chance', 'Better Criticals'];
  const files: Record<string, { data: Uint8Array; packed: boolean }> = {
    'color.pal': { data: Uint8Array.from({ length: 800 }, (_, i) => i % 64), packed: false },
    'text\\english\\game\\perk.msg': { data: msg([...run(101, perks), ...run(1101, perks.map((name) => `What ${name} does.`))]), packed: true },
    'text\\english\\game\\skill.msg': { data: msg([...run(100, skills), ...run(200, skills.map((name) => `What ${name} is.`))]), packed: true },
    'text\\english\\game\\trait.msg': { data: msg([...run(100, traits), ...run(200, traits.map((name) => `What ${name} does.`))]), packed: true },
    'text\\english\\game\\stat.msg': {
      data: msg([...run(100, stats), ...run(200, stats.map((name) => `What ${name} is.`)), [133, 'Age'], [134, 'Gender'], ...run(301, ['V. Bad', 'Bad', 'Poor', 'Fair', 'Average', 'Good', 'V. Good', 'Great', 'Excellent', 'Heroic']), ...run(400, ['Unspent Skill Points', 'Level', 'Experience', 'Reputation', 'Karma'])]),
      packed: true,
    },
    'text\\english\\game\\editor.msg': {
      data: msg([
        [107, 'MALE'],
        [108, 'FEMALE'],
        [1000, 'Reputation (General) '],
        [1100, 'How well known and respected the character is.'],
        [1003, 'Childkiller'],
        [1103, 'Not a good thing to be known for.'],
        [3000, 'Savior of the Damned'],
        [3004, 'Wanderer'],
        [3008, 'Demon Spawn'],
        ...run(1004, ['Nuka Cola reliance', 'Buffout reliance', 'Mentats reliance', 'Psycho reliance', 'RadAway reliance', 'Alcohol reliance', 'Jet reliance', 'Tragic reliance']),
        ...run(2000, ['Idolized', 'Liked', 'Accepted', 'Neutral', 'Antipathy', 'Hated', 'Vilified']),
      ]),
      packed: false,
    },
    // The world: global variables, quests, holodisks, karma, towns, kills (see src/lib/modify/world.ts).
    'data\\vault13.gam': { data: ascii(['GAME_GLOBAL_VARS:', '', ...Array.from({ length: 696 }, (_, i) => `${({ 0: 'GVAR_PLAYER_REPUTATION', 1: 'GVAR_CHILDKILLER_REPUTATION', 9: 'GVAR_KILL_EVIL_PLANTS', 18: 'GVAR_PLAYER_GOT_CAR', 47: 'GVAR_TOWN_REP_ARROYO', 220: 'GVAR_MILITARY_BASE_HOLODISK' } as Record<number, string>)[i] ?? `GVAR_NUMBER_${i}`} :=0; // (${i})${i === 9 ? ' Hakunin wants his garden free of plants' : ''}`)].join('\r\n')), packed: true },
    'data\\quests.txt': { data: ascii(['# location, description, gvar, shown, done', '1500, 100, 9, 2, 6', '1501, 101, 30, 1, 2'].join('\r\n')), packed: false },
    'text\\english\\game\\quests.msg': { data: msg([[100, 'Kill the evil plants that infest Hakunin\'s garden.'], [101, 'Free Vic from his debt.']]), packed: false },
    'data\\holodisk.txt': { data: ascii('220, 300, 1000\r\n'), packed: false },
    'text\\english\\game\\pipboy.msg': { data: msg([[300, 'Military Base Outside']]), packed: false },
    'data\\karmavar.txt': { data: ascii('0, 48, 1000, 1100\r\n1, 50, 1003, 1103\r\n'), packed: false },
    'data\\genrep.txt': { data: ascii('1000, 3000\r\n-249, 3004\r\n-2147483648, 3008\r\n'), packed: false },
    'data\\city.txt': { data: ascii('[Area 00]\r\ntownmap_label_art_idx=150\r\nsize=Medium\r\n[Area 01]\r\ntownmap_label_art_idx=151\r\nsize=Large\r\n[Area 02]\r\ntownmap_label_art_idx=152\r\nsize=Large\r\n'), packed: false },
    'text\\english\\game\\map.msg': { data: msg([[1500, 'Arroyo'], [1501, 'The Den'], [1502, 'Klamath']]), packed: false },
    'text\\english\\game\\proto.msg': { data: msg([...run(1450, ['Men', 'Women', 'Children', 'Super Mutants', 'Ghouls', 'Brahmin', 'Radscorpions', 'Rats', 'Floaters', 'Centaurs', 'Robots', 'Dogs', 'Manti', 'DeathClaws', 'Plants', 'Geckos', 'Aliens', 'Giant Ants', 'Big Bad Boss'])]), packed: false },
    // A companion: its prototype and its name.
    'proto\\critters\\critters.lst': { data: ascii('00000001.pro\r\n00000002.pro\r\n00000003.pro\r\n'), packed: false },
    'proto\\critters\\00000003.pro': { data: critterProto(0x01000003, 103, 60), packed: true },
    'text\\english\\game\\pro_crit.msg': { data: msg([[103, 'Sulik']]), packed: false },
    'text\\english\\game\\pro_item.msg': {
      data: msg(Array.from({ length: 46 }, (_, i) => i + 1).flatMap((pid): [number, string][] => [[pid * 100, EDITOR_ITEMS[pid]?.name ?? `Junk ${pid}`], [pid * 100 + 1, `What a ${EDITOR_ITEMS[pid]?.name ?? 'thing'} is.`]])),
      packed: true,
    },
    'proto\\items\\items.lst': { data: ascii(Array.from({ length: 46 }, (_, i) => `${String(i + 1).padStart(8, '0')}.pro`).join('\r\n')), packed: false },
    'art\\skilldex\\skilldex.lst': { data: ascii(Array.from({ length: 175 }, () => 'CARD.FRM').join('\r\n')), packed: false },
    'art\\skilldex\\card.frm': { data: frm(28, 24), packed: true },
    'art\\inven\\inven.lst': { data: ascii('THING.FRM\r\nOTHER.FRM'), packed: false },
    'art\\inven\\thing.frm': { data: frm(30, 18), packed: true },
    'art\\inven\\other.frm': { data: frm(18, 22), packed: true },
  };
  for (let pid = 1; pid <= 46; pid++) files[`proto\\items\\${String(pid).padStart(8, '0')}.pro`] = { data: proto(pid), packed: pid % 2 === 0 };
  writeFileSync(join(root, 'master.dat'), Buffer.from(await dat2(files).arrayBuffer()));
  return root;
}

// ---------------------------------------------------------------------
// Playing the real games
// ---------------------------------------------------------------------

export const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Whether the engine says a game is in progress, rather than its menus. */
export function inProgress(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { overseerEngine: { inGame(): boolean } }).overseerEngine.inGame());
}

export async function engineStats(page: Page): Promise<{ sleeps: number; syncs: number; blockReads: number; blockMs: number }> {
  return page.evaluate(() => (window as unknown as { overseerEngine: { module: { overseer: { stats(): never } } } }).overseerEngine.module.overseer.stats());
}

/** True when the page shows a picture rather than a black frame. */
export async function showsPicture(page: Page): Promise<boolean> {
  return (await page.screenshot()).length > 150_000;
}

/** Waits for the game to draw something, then for it to settle. Returns how long the picture took. */
export async function waitForPicture(page: Page, settleMs: number): Promise<number> {
  const started = Date.now();
  await expect.poll(() => showsPicture(page), { timeout: 90_000, intervals: [500] }).toBe(true);
  const took = Date.now() - started;
  await pause(page, settleMs);
  return took;
}

/** Starts the game from a console menu entry and passes the start gate. */
export async function launch(page: Page, entry: string, key: string): Promise<void> {
  await expect(page.locator('.menu button').filter({ hasText: entry })).toBeVisible();
  // A person does not launch within milliseconds of the page appearing.
  await pause(page, 1500);
  await page.keyboard.press(key);
  await page.waitForURL(/play\.html/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#terminal')).toBeHidden();
}

/**
 * A coarse fingerprint of the game's picture: brightness on a 32x24 grid.
 * Two pictures of the same scene are close; a different screen is far away.
 */
export async function fingerprint(page: Page): Promise<number[]> {
  const box = (await page.locator('#canvas').boundingBox())!;
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, 32, 24);
    const pixels = context.getImageData(0, 0, 32, 24).data;
    const cells: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) cells.push((pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3);
    return cells;
  }, png.toString('base64'));
}

/** Mean difference in brightness between two fingerprints, 0 to 255. */
export function distance(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length;
}
