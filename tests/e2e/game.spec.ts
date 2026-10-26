import { linkSync, mkdirSync, openAsBlob, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { indexDat, readDatEntry, type DatArchive } from '../../src/lib/dat';
import { Ini } from '../../src/lib/ini';
import type { Page } from '@playwright/test';
import type { FileReads } from '../../src/lib/engine/host';
import { parseSaveHeader, type SaveHeader } from '../../src/lib/savefile';
import { expect, test } from './fixtures';
import { sfallLibrary } from '../mods';
import { tempFolder } from './tempdirs';
import { distance, engineStats, fingerprint, inProgress, launch, openConsole, pause, pickFolder, showsPicture, waitForPicture } from './helpers';

/**
 * Plays the real games. Needs your own copies:
 *   FO1_DIR="/path/to/Fallout" FO2_DIR="/path/to/Fallout 2" npm run test:e2e
 * Skipped when the folders are not given, which is always the case in CI.
 */
// Whole games are copied in, more than one for Fallout Et Tu: storage on disk (see fixtures.ts).
test.use({ onDisk: true });

const GAMES = [
  { id: 'fo1', title: 'Fallout', dir: process.env.FO1_DIR },
  { id: 'fo2', title: 'Fallout 2', dir: process.env.FO2_DIR },
] as const;

for (const game of GAMES) {
  test(`${game.title}: import, play, save, leave, continue from the save, and quit`, async ({ page }) => {
    test.skip(!game.dir, `set ${game.id.toUpperCase()}_DIR to your ${game.title} folder to run this`);
    const faults: string[] = [];
    page.on('pageerror', (error) => faults.push(error.message));

    await openConsole(page, game.id, { skipIntro: true });
    await pickFolder(page, game.dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

    // An add-on of one loose file, which the saves made with it will name.
    const note = zipSync({ 'data/text/english/dialog/zzovnote.msg': new TextEncoder().encode('{100}{}{Overseer.}\r\n') });
    await page.locator('.menu button', { hasText: 'Add-ons' }).click();
    await page.locator('input[accept*=".dat"]').setInputFiles({ name: 'overseer_note.zip', mimeType: 'application/zip', buffer: Buffer.from(note) });
    await expect(page.locator('.menu li', { hasText: 'Overseer note' })).toContainText('ON', { timeout: 120_000 });
    await page.keyboard.press('Escape');

    // Main menu.
    await launch(page, 'Begin simulation', '1');
    const firstPicture = await waitForPicture(page, 4000);
    const mainMenu = await fingerprint(page);
    const afterStart = await engineStats(page);
    console.log(`${game.title}: first picture ${firstPicture} ms after starting, ${afterStart.blockReads} block reads taking ${Math.round(afterStart.blockMs)} ms`);
    // The main menu is not a game in progress: no time counts towards an autosave.
    expect(await inProgress(page)).toBe(false);

    // New game with the first ready-made character; skip the opening movie.
    await page.keyboard.press('n');
    await pause(page, 3500);
    await page.keyboard.press('t');
    await pause(page, 4500);
    await page.keyboard.press('Escape');
    await pause(page, 7500);
    expect(await showsPicture(page)).toBe(true);

    // Nothing to quick load yet: the game goes on, and the page says why nothing happened.
    await page.keyboard.press('F7');
    await expect(page.locator('#toast')).toHaveText('NO QUICK SAVE IN SLOT 07 YET. F6 MAKES ONE.', { timeout: 10_000 });
    expect(await inProgress(page)).toBe(true);

    // A save of the player's own: the save screen, the first slot, a description.
    await page.keyboard.press('F4');
    await pause(page, 2500);
    await page.keyboard.press('Enter');
    await pause(page, 1500);
    await page.keyboard.type('e2e', { delay: 80 });
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toHaveText('SAVED TO BROWSER STORAGE', { timeout: 30_000 });
    expect((await engineStats(page)).syncs).toBeGreaterThan(0);

    // The save screen has pages of ten slots, Fallout's as well as Fallout 2's: the next one starts at slot 11.
    const ownSave = (await engineStats(page)).syncs;
    await pause(page, 1500);
    await page.keyboard.press('F4');
    await pause(page, 2500);
    await page.keyboard.press('ArrowRight');
    await pause(page, 1000);
    const pagePicture = test.info().outputPath(`${game.id}-save-page-2.png`);
    await page.locator('canvas').screenshot({ path: pagePicture });
    await test.info().attach(`${game.title}: the second page of save slots`, { path: pagePicture, contentType: 'image/png' });
    await page.keyboard.press('Enter');
    await pause(page, 1500);
    await page.keyboard.type('page two', { delay: 80 });
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await engineStats(page)).syncs, { timeout: 30_000 }).toBeGreaterThan(ownSave);

    // An autosave, asked for now rather than after minutes of play: in slot 8, the first of the last three.
    expect(await inProgress(page)).toBe(true);
    await pause(page, 3000);
    const autosaved = page.evaluate(() => (window as unknown as { overseerAutosave(): Promise<boolean> }).overseerAutosave());
    await expect(page.locator('#toast')).toHaveText('AUTOSAVED IN SLOT 08', { timeout: 30_000 });
    expect(await autosaved).toBe(true);
    const firstSave = (await engineStats(page)).syncs;

    // A quick save: into slot 7, every time, with no questions. The second makes the first history.
    await pause(page, 1500);
    await page.keyboard.press('F6');
    await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
    const quickSaved = (await engineStats(page)).syncs;
    expect(quickSaved).toBeGreaterThan(firstSave);
    await pause(page, 1500);
    await page.keyboard.press('F6');
    await expect.poll(async () => (await engineStats(page)).syncs, { timeout: 30_000 }).toBeGreaterThan(quickSaved);
    await pause(page, 1500);
    const inGame = await fingerprint(page);
    expect(distance(inGame, mainMenu)).toBeGreaterThan(12);

    // And a quick load from it, straight back into the game.
    await page.keyboard.press('F7');
    await expect(page.locator('#toast')).toHaveText('QUICK LOADED FROM SLOT 07', { timeout: 30_000 });
    await expect.poll(async () => distance(await fingerprint(page), inGame), { timeout: 30_000, intervals: [1000] }).toBeLessThan(6);
    expect(await inProgress(page)).toBe(true);

    const audio = await page.evaluate(() => (window as unknown as { overseerEngine: { audioContext(): AudioContext | undefined } }).overseerEngine.audioContext()?.state);
    expect(audio).toBe('running');

    // Switching to another tab freezes the game and its clock; coming back resumes it.
    const setHidden = (hidden: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { value, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    await pause(page, 300);
    const whileHidden = await engineStats(page);
    await pause(page, 700);
    expect((await engineStats(page)).sleeps).toBe(whileHidden.sleeps);
    await setHidden(false);
    await pause(page, 700);
    expect((await engineStats(page)).sleeps).toBeGreaterThan(whileHidden.sleeps);

    // The console menu freezes the game; leaving goes back to the console.
    await page.keyboard.press('F9');
    await expect(page.getByText('Simulation suspended')).toBeVisible();
    const frozen = (await engineStats(page)).sleeps;
    await pause(page, 600);
    expect((await engineStats(page)).sleeps).toBe(frozen);
    await page.keyboard.press('x');
    await page.keyboard.press('y');
    await expect(page.getByRole('heading', { name: new RegExp(`${game.title}$`) })).toBeVisible();

    // The saves are in the archives: the quick save in slot 7, with the one it replaced kept as an earlier version.
    await page.goto(`#/saves/${game.id}`);
    const slot = page.locator('.menu li').first();
    await expect(slot).toContainText('SLOT 01');
    await expect(slot).toContainText('e2e');
    await expect(page.locator('.menu li', { hasText: 'SLOT 07' })).toContainText(/QUICKSAVE \d\d:\d\d/);
    await expect(page.locator('.menu li', { hasText: 'SLOT 11' })).toContainText('page two');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.menu li.selected')).toContainText('SLOT 07');
    await expect(page.locator('.menu-note')).toContainText('1 earlier version kept.');
    await page.keyboard.press('Home');
    await expect(page.locator('.menu li', { hasText: 'SLOT 08' })).toContainText(/AUTOSAVE \d\d:\d\d/);
    // Nothing has left this browser yet, and the console says so.
    await expect(page.getByText('LAST EXPORTED: NEVER')).toBeVisible();

    // The console read the save: its picture, drawn with the game's own palette, and the character.
    await expect(page.locator('canvas.thumb')).toBeVisible();
    await page.keyboard.press('1');
    const sheet = page.locator('.sheet');
    await expect(sheet).toContainText(/Level\s*1/);
    await expect(sheet).toContainText('Tagged');
    await expect(sheet).toContainText('Traits');
    await expect(sheet).toContainText(game.id === 'fo1' ? 'Heavy Handed, Bruiser' : 'Heavy Handed, Gifted');
    const lit = await page.locator('canvas.thumb').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      for (let i = 1; i < pixels.length; i += 4) if (pixels[i]! > 40) bright++;
      return bright / (pixels.length / 4);
    });
    expect(lit).toBeGreaterThan(0.1);

    // Exported, the save is a sound archive holding every file the game wrote.
    const download = page.waitForEvent('download');
    await page.keyboard.press('e');
    const archive = unzipSync(new Uint8Array(readFileSync(await (await download).path())));
    const names = Object.keys(archive).map((name) => name.toUpperCase());
    expect(names).toContain('SAVEGAME/SLOT01/SAVE.DAT');
    expect(names).toContain('SAVEGAME/SLOT01/AUTOMAP.SAV');
    // And what the console wrote beside it: the game and the add-on it was made with.
    expect(JSON.parse(Buffer.from(archive['SAVEGAME/SLOT01/OVERSEER.JSON']!).toString())).toEqual({ game: game.id, addons: [{ id: 'overseer-note', title: 'Overseer note' }] });
    expect(names.some((name) => /SLOT01\/[A-Z0-9_]+\.SAV$/.test(name) && !name.endsWith('AUTOMAP.SAV'))).toBe(true);
    for (const [name, data] of Object.entries(archive)) expect(data.length, name).toBeGreaterThan(0);
    expect(Buffer.from(archive['SAVEGAME/SLOT01/SAVE.DAT']!.subarray(0, 17)).toString('latin1')).toBe('FALLOUT SAVE FILE');

    // The add-on switched off: the save it was made with asks first, and is played without it.
    await page.goto(`#/${game.id}`);
    await page.locator('.menu button', { hasText: 'Add-ons' }).click();
    await page.locator('.menu li', { hasText: 'Overseer note' }).locator('button').click();
    await expect(page.locator('.menu li', { hasText: 'Overseer note' })).toContainText('OFF');

    // Continue: from the main directory straight back to where the latest save, the quick save, was made.
    await page.goto('#/');
    await expect(page.locator('.menu li').first()).toContainText(`Continue: ${game.title}`);
    await pause(page, 1500);
    await page.keyboard.press('c');
    await page.waitForURL(/play\.html/);
    await expect(page.getByText('Add-ons missing')).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('p');
    await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Enter');
    await expect(page.locator('#terminal')).toBeHidden();
    expect(page.url()).toContain('slot=7');
    let closest = 255;
    await expect
      .poll(async () => (closest = Math.min(closest, distance(await fingerprint(page), inGame))), { timeout: 120_000, intervals: [1000] })
      .toBeLessThan(6);
    console.log(`${game.title}: after continuing the picture is ${closest.toFixed(1)} away from the one saved (${distance(inGame, mainMenu).toFixed(1)} from the main menu)`);
    const before = (await engineStats(page)).sleeps;
    await pause(page, 1000);
    expect((await engineStats(page)).sleeps).toBeGreaterThan(before);
    // Loaded again from the game itself, the engine says which save it was: the page says what it lacks, this time.
    await pause(page, 1500);
    await page.keyboard.press('F7');
    await expect(page.locator('#toast')).toHaveText('SAVE 07 WAS MADE WITH OVERSEER NOTE ON. F9 TO START IT AGAIN WITH IT.', { timeout: 30_000 });
    await pause(page, 3000);

    // Quitting through the game's own menus: to its main menu, and from there out of the game, back to the console.
    await page.keyboard.press('F10');
    await pause(page, 1500);
    await page.keyboard.press('y');
    await expect.poll(async () => distance(await fingerprint(page), mainMenu), { timeout: 30_000, intervals: [1000] }).toBeLessThan(6);
    await page.keyboard.press('e');
    await expect(page.getByRole('heading', { name: new RegExp(`${game.title}$`) })).toBeVisible({ timeout: 30_000 });
    expect(page.url()).not.toContain('play.html');

    expect(faults).toEqual([]);
  });
}

/**
 * Fallout Et Tu, from the real things: both games and the conversion's package.
 *   FO1_DIR=... FO2_DIR=... ETTU="/path/to/Fallout1in2.zip" npm run test:e2e
 * ETTU may also be the Fallout1in2 folder. Decks A and B are loaded first, as a player would.
 */
test('Fallout Et Tu: put together from both games and its package, started, and quit', async ({ page }, testInfo) => {
  const [fallout, fallout2] = GAMES.map((game) => game.dir);
  const ettu = process.env.ETTU;
  test.skip(!fallout || !fallout2 || !ettu, 'set FO1_DIR, FO2_DIR and ETTU (the Et Tu zip or folder) to run this');
  test.setTimeout(1_800_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo1', { skipIntro: true });
  await pickFolder(page, fallout!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/fo2');
  await pickFolder(page, fallout2!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

  await page.goto('#/mods/load');
  if (statSync(ettu!).isDirectory()) await pickFolder(page, ettu!);
  else await page.locator('input[accept*="zip"]').setInputFiles(ettu!);
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 900_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 900_000 });
  console.log(`Fallout Et Tu: ${(await page.getByRole('status').innerText()).replace(/\s+/g, ' ')}`);

  // Its main menu: a picture, drawn by an engine that keeps running.
  await launch(page, 'Begin simulation', '1');
  const firstPicture = await waitForPicture(page, 4000);
  const stats = await engineStats(page);
  console.log(`Fallout Et Tu: first picture ${firstPicture} ms after starting, ${stats.blockReads} block reads taking ${Math.round(stats.blockMs)} ms`);
  const before = stats.sleeps;
  await pause(page, 1500);
  expect((await engineStats(page)).sleeps).toBeGreaterThan(before);

  // A new game with the first ready-made character, past the opening movie, onto its first map.
  const mainMenu = await fingerprint(page);
  const mainMenuPicture = await page.locator('#canvas').screenshot();
  await page.keyboard.press('n');
  await pause(page, 3500);
  await page.keyboard.press('t');
  await pause(page, 4500);
  await page.keyboard.press('Escape');
  await pause(page, 9000);
  expect(await showsPicture(page)).toBe(true);
  expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);
  for (const [name, at] of [['main menu', mainMenuPicture], ['new game', await page.locator('#canvas').screenshot()]] as const) {
    await testInfo.attach(`Fallout Et Tu: ${name}`, { body: at, contentType: 'image/png' });
  }
  // Played from its own archives, with Fallout 2's under it.
  const reads = await fileReads(page);
  console.log(`Fallout Et Tu: the engine read, of its own files, ${reads.own.join(', ')}; of Fallout 2's, ${reads.base.join(', ')}`);
  expect(reads.own).toEqual(expect.arrayContaining(['fallout1.dat', 'mods/fo1_base']));
  expect(reads.base).toEqual(expect.arrayContaining(['fo2/master.dat']));

  // Quitting through the game's own menus goes back to the console.
  await page.keyboard.press('F10');
  await pause(page, 1500);
  await page.keyboard.press('y');
  await expect.poll(async () => distance(await fingerprint(page), mainMenu), { timeout: 30_000, intervals: [1000] }).toBeLessThan(6);
  await page.keyboard.press('e');
  await expect(page.getByRole('heading', { name: /Fallout Et Tu$/ })).toBeVisible({ timeout: 30_000 });
  expect(faults).toEqual([]);
});

/**
 * The mods the console knows, from their real files, over the real game each
 * is played on: loaded, started, and taken from the main menu into a new game
 * with its first ready-made character. That it is the mod being played, not
 * the game under it, is shown by what the engine reads (the mod's own
 * archives), where the new game begins (read from a save, where one can be
 * made), and the pictures attached to the test.
 *   FO2_DIR=... RPU="/path/to/rpu_v2.4.34.zip" SONORA="/path/to/Fallout_Sonora_1.16.4E.zip"
 *   OLYMPUS="/path/to/Olympus-2207-English.zip" RESURRECTION="/path/to/FoRes_EN_1_5.zip" npm run test:e2e -- game
 * NEVADA and MEGAMOD (with FO2_DIR) and FIXT (with FO1_DIR) take the folder each was installed in, or a zip of it;
 * YESTERDAY, the folder its 7z unpacks to.
 */
const MODS = [
  // `menu`: how long the game takes to reach its main menu. `reads`: archives of the mod's own the engine reads by its
  // first scene; `usesBase`: whether it reads the game's archives too (a mod laid over a game) or none of them (a whole
  // game of its own). `text`: a file of the mod's, as the engine finds it, and words only the mod's copy holds.
  // `saved`: where a quick save from its first scene is made, and by whom: its own first ready-made character.
  { id: 'rpu', title: 'Restoration Project', base: 'fo2', env: 'RPU', menu: 8000, reads: [/^mods\/rpu\.dat$/i], usesBase: true, text: undefined, saved: { map: 'ARTEMPLE', character: 'Narg' } },
  { id: 'sonora', title: 'Fallout: Sonora', base: 'fo2', env: 'SONORA', menu: 8000, reads: [/^master\.dat$/i], usesBase: false, text: undefined, saved: { map: 'ARTEMPLE', character: 'Chavez' } },
  // Its intro is played by its own scripts, before its main menu; its first scene is a conversation, with no saving.
  { id: 'olympus', title: 'Olympus 2207', base: 'fo2', env: 'OLYMPUS', menu: 40000, reads: [/^master\.dat$/i], usesBase: false, text: undefined, saved: undefined },
  { id: 'nevada', title: 'Fallout: Nevada', base: 'fo2', env: 'NEVADA', menu: 15000, reads: [/^master\.dat$/i], usesBase: false, text: undefined, saved: { map: 'ARTEMPLE', character: 'Slash' } },
  // Its own first character's name begins with a stray byte, 0x8D, as its PREMADE/COMBAT.GCD spells it.
  { id: 'megamod', title: 'Fallout 2 Megamod', base: 'fo2', env: 'MEGAMOD', menu: 8000, reads: [/^mod-data\.dat$/i], usesBase: true, text: undefined, saved: { map: 'ARTEMPLE', character: '\x8dNarg' } },
  // In a folder of its own, Fallout 2's archives below it: its content is the high resolution patch's archive.
  { id: 'resurrection', title: 'Fallout 1.5: Resurrection', base: 'fo2', env: 'RESURRECTION', menu: 8000, reads: [/^fores\.dat$/i, /^fores_critter\.dat$/i], usesBase: true, text: undefined, saved: { map: 'NH_CAVE', character: 'Kyle' } },
  // Its patch001.dat, more than one archive holds, is three here (its patch002.dat, the fourth, is small enough to be
  // read whole, and not counted).
  { id: 'yesterday', title: 'Fallout Yesterday', base: 'fo2', env: 'YESTERDAY', menu: 15000, reads: [/^patch001\.dat$/i, /^patch003\.dat$/i], usesBase: true, text: undefined, saved: { map: 'V8EXT', character: 'Spuck' } },
  // Fallout's engine reads only Fallout's own archives: a mod of it is loose files, handed to the engine whole.
  { id: 'fixt', title: 'Fallout Fixt', base: 'fo1', env: 'FIXT', menu: 8000, reads: [], usesBase: true, text: ['data/text/english/game/misc.msg', 'Fallout Fixt 0.81alpha'], saved: { map: 'V13ENT', character: 'Max Stone' } },
] as const;

/** What the engine has read of its large files, by path: the mod's own, the game's under it, and its add-ons'. */
async function fileReads(page: Page): Promise<{ own: string[]; base: string[]; addon: string[] }> {
  const reads = await page.evaluate(() => (window as unknown as { overseerEngine: { reads(): Record<string, FileReads> } }).overseerEngine.reads());
  const of = (from: FileReads['from']) => Object.keys(reads).filter((path) => reads[path]!.from === from).sort();
  return { own: of('own'), base: of('base'), addon: of('addon') };
}

/** Links the files of one folder into another, folder by folder: the same files, under another path, nothing copied. */
function linkInto(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      mkdirSync(join(to, entry.name), { recursive: true });
      linkInto(join(from, entry.name), join(to, entry.name));
    } else linkSync(join(from, entry.name), join(to, entry.name));
  }
}

/** A file of the game folder the engine plays from, found whatever the case of its path, or null. */
async function engineFile(page: Page, path: string): Promise<Uint8Array | null> {
  const bytes = await page.evaluate((path) => {
    const fs = (window as unknown as { overseerEngine: { module: { FS: { readdir(path: string): string[]; readFile(path: string): Uint8Array } } } }).overseerEngine.module.FS;
    let at = '/game';
    for (const name of path.toLowerCase().split('/')) {
      const found = fs.readdir(at).find((entry) => entry.toLowerCase() === name);
      if (!found) return null;
      at = `${at}/${found}`;
    }
    return [...fs.readFile(at)];
  }, path);
  return bytes ? new Uint8Array(bytes) : null;
}

/** The header of the save in `slot`, as the engine wrote it. */
async function savedHeader(page: Page, slot: number): Promise<SaveHeader | null> {
  const bytes = await engineFile(page, `data/savegame/slot${String(slot).padStart(2, '0')}/save.dat`);
  return bytes ? parseSaveHeader(bytes) : null;
}

for (const mod of MODS) {
  test(`${mod.title}: loaded over the game it is played on, started, and into a new game`, async ({ page }, testInfo) => {
    const source = process.env[mod.env];
    const game = GAMES.find((entry) => entry.id === mod.base)!;
    test.skip(!source || !game.dir, `set ${game.id.toUpperCase()}_DIR and ${mod.env} to run this`);
    test.setTimeout(1_800_000);
    const faults: string[] = [];
    page.on('pageerror', (error) => faults.push(error.message));
    const picture = async (name: string) => {
      const path = testInfo.outputPath(`${mod.id}-${name}.png`);
      await page.locator('#canvas').screenshot({ path });
      await testInfo.attach(`${mod.title}: ${name}`, { path, contentType: 'image/png' });
    };

    await openConsole(page, game.id, { skipIntro: true });
    await pickFolder(page, game.dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
    await page.goto('#/mods/load');
    if (statSync(source!).isDirectory()) await pickFolder(page, source!);
    else await page.locator('input[accept*="zip"]').setInputFiles(source!);
    await expect(page.getByRole('heading', { name: mod.title })).toBeVisible({ timeout: 1_800_000 });
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 1_800_000 });
    console.log(`${mod.title}: ${(await page.getByRole('status').innerText()).replace(/\s+/g, ' ')}`);

    // Its main menu, drawn by an engine that keeps running.
    await launch(page, 'Begin simulation', '1');
    const firstPicture = await waitForPicture(page, mod.menu);
    console.log(`${mod.title}: first picture ${firstPicture} ms after starting`);
    const mainMenu = await fingerprint(page);
    expect(await inProgress(page)).toBe(false);
    await picture('main menu');

    // A new game with the first ready-made character, past whatever film opens it.
    await page.keyboard.press('n');
    await pause(page, 6000);
    await page.keyboard.press('t');
    await pause(page, 10000);
    await page.keyboard.press(' ');
    await pause(page, 5000);
    await page.keyboard.press(' ');
    await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
    await pause(page, 10000);
    expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);
    await picture('new game');

    // Played from the mod's own files: its archives read, and the game's under it only where the mod is laid over it.
    const reads = await fileReads(page);
    console.log(`${mod.title}: the engine read, of the mod's own files, ${reads.own.join(', ') || 'none'}; of ${game.title}'s, ${reads.base.join(', ') || 'none'}`);
    for (const pattern of mod.reads) expect(reads.own.some((path) => pattern.test(path)), `${pattern} read`).toBe(true);
    // A mod in a folder of its own has the game's archives in a folder below it (see storage/mount.ts).
    if (mod.usesBase) expect(reads.base.some((path) => /^(fo2\/)?master\.dat$/i.test(path))).toBe(true);
    else expect(reads.base).toEqual([]);
    if (mod.text) {
      const [path, words] = mod.text;
      expect(Buffer.from((await engineFile(page, path)) ?? []).toString('latin1')).toContain(words);
    }

    if (mod.saved) {
      // Saved, into its own archives, on the map the mod's new game begins on, by its own first character.
      await page.keyboard.press('F6');
      await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
      const header = await savedHeader(page, 7);
      console.log(`${mod.title}: saved by ${header?.character} on ${header?.map}, elevation ${header?.elevation}, ${header?.gameDate}`);
      expect(header).toMatchObject(mod.saved);
    }

    // Out through the console menu, back to the mod's own page.
    await page.keyboard.press('F9');
    await expect(page.getByText('Simulation suspended')).toBeVisible();
    await page.keyboard.press('x');
    await page.keyboard.press('y');
    await expect(page.getByRole('heading', { name: mod.title })).toBeVisible({ timeout: 30_000 });
    if (mod.saved) {
      await page.goto(`#/saves/${mod.id}`);
      await expect(page.locator('.menu li', { hasText: 'SLOT 07' })).toContainText(/QUICKSAVE \d\d:\d\d/);
    }
    expect(faults).toEqual([]);
  });
}

/**
 * Fallout Yesterday's own traits are made with sfall's fake traits, which the
 * engine of Fallout 2 was given for it (engines/fallout2/patches): its first
 * ready-made character is given a free trait slot, and the trait chosen for
 * it in the game's perk box is kept in the save, through a load and a save
 * again.
 */
test('Fallout Yesterday: a trait of its own, chosen in the perk box, kept in a save', async ({ page }) => {
  const source = process.env.YESTERDAY;
  const fallout2 = GAMES.find((entry) => entry.id === 'fo2')!;
  test.skip(!source || !fallout2.dir, 'set FO2_DIR and YESTERDAY to run this');
  test.setTimeout(1_800_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, fallout2.dir!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/mods/load');
  await pickFolder(page, source!);
  await expect(page.getByRole('heading', { name: 'Fallout Yesterday' })).toBeVisible({ timeout: 1_800_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 1_800_000 });

  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 15000);

  // A point of the game's 640 x 480 screens, centred in its picture, pressed the way a person does.
  const press = async (x: number, y: number) => {
    const box = (await page.locator('#canvas').boundingBox())!;
    const size = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }));
    await page.mouse.move(box.x + ((size.width - 640) / 2 + x) * (box.width / size.width), box.y + ((size.height - 480) / 2 + y) * (box.height / size.height));
    await pause(page, 300);
    await page.mouse.down();
    await pause(page, 200);
    await page.mouse.up();
    await pause(page, 1200);
  };

  // A new game with its first ready-made character, who is given up one of its traits.
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('m');
  await pause(page, 5000);
  await press(248, 410); // Chem Resistant, on the creation screen
  await page.keyboard.press('ArrowRight');
  await pause(page, 1500);
  await press(464, 462); // Done
  // Past the film that opens it, as a player would.
  await pause(page, 10_000);
  await page.keyboard.press(' ');
  await expect.poll(() => inProgress(page), { timeout: 600_000, intervals: [1000] }).toBe(true);

  // Its scripts ask for a trait for the free slot on the character screen, which opens once its first scenes let
  // go of the player (back from the simulation of Vault 8), with the perk box over it. That screen covers the interface bar, which stays as it is through
  // the changes of map and the words of the scenes: by its strip of the picture it is told from the map.
  const bar = (print: number[]) => print.slice(32 * 20);
  // The bar, once it is drawn (the map fades in from black) and holds still.
  let inGameBar = bar(await fingerprint(page));
  await expect
    .poll(
      async () => {
        const now = bar(await fingerprint(page));
        const ready = now.reduce((sum, cell) => sum + cell, 0) / now.length > 30 && distance(now, inGameBar) < 2;
        inGameBar = now;
        return ready;
      },
      { timeout: 180_000, intervals: [2000] },
    )
    .toBe(true);
  // The character screen over the bar: unlike the fades of its scenes, which darken the bar with the rest, it is
  // bright, and it holds still.
  const brightness = (strip: number[]) => strip.reduce((sum, cell) => sum + cell, 0) / strip.length;
  const covered = (strip: number[]) => distance(strip, inGameBar) > 15 && brightness(strip) > 35;
  let opened = false;
  for (let attempt = 0; attempt < 100 && !opened; attempt++) {
    await page.keyboard.press('c');
    await pause(page, 3000);
    const first = bar(await fingerprint(page));
    await pause(page, 1000);
    const second = bar(await fingerprint(page));
    opened = covered(first) && covered(second) && distance(first, second) < 3;
    if (!opened) {
      // Its first scene, in the simulation of Vault 8, waits for the player to go on.
      await page.keyboard.press('Enter');
      await pause(page, 2000);
    }
  }
  expect(opened, 'the character screen opens').toBe(true);
  // Its own traits, in the order of their names: Apprenticed to a Trader, Army Training, Arsonist.
  await page.keyboard.press('ArrowDown');
  await pause(page, 500);
  await page.keyboard.press('ArrowDown');
  await pause(page, 1000);
  const box = page.locator('#canvas');
  await box.screenshot({ path: test.info().outputPath('yesterday-perk-box.png') });
  await test.info().attach('Fallout Yesterday: its traits in the perk box', { path: test.info().outputPath('yesterday-perk-box.png'), contentType: 'image/png' });
  await page.keyboard.press('Enter');
  await pause(page, 3000);
  await box.screenshot({ path: test.info().outputPath('yesterday-traits.png') });
  await test.info().attach('Fallout Yesterday: the trait taken', { path: test.info().outputPath('yesterday-traits.png'), contentType: 'image/png' });
  await page.keyboard.press('Enter');
  await pause(page, 3000);

  // The made-up traits of the save, out of sfallgv.sav: its global variables (16 bytes each), two words, and
  // then they (1096 bytes each, the name at 8), before the made-up perks and the selectable ones.
  const traitsSaved = async () => {
    const data = Buffer.from((await engineFile(page, 'data/savegame/slot07/sfallgv.sav')) ?? []);
    let at = 4 + data.readInt32LE(0) * 16 + 8;
    const names: string[] = [];
    for (let count = data.readInt32LE(at), index = 0; index < count; index++) {
      const name = data.subarray(at + 4 + index * 1096 + 8, at + 4 + index * 1096 + 72);
      names.push(name.subarray(0, name.indexOf(0)).toString('latin1'));
    }
    return names;
  };
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  expect(await traitsSaved()).toContain('Arsonist');
  // Loaded, and saved again: the trait came back with the game.
  await page.keyboard.press('F7');
  await pause(page, 10_000);
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  expect(await traitsSaved()).toContain('Arsonist');
  expect(faults).toEqual([]);
});

/**
 * A mod of Fallout made on Windows: its lists end their lines in CR LF, which
 * the engine of Fallout once read with the CR left on every name when the list
 * lay loose in the data folder (engines/fallout1/patches, "Read loose text
 * files the way Windows does"). Fallout Fixt ships its lists that way. Here
 * the game's own lists of items, critters and scripts are written loose, CR LF
 * and all, beside a link to the rest of the game, and loaded as a mod.
 */
test('Fallout: a mod whose lists end their lines as Windows writes them plays', async ({ page }) => {
  const fallout = GAMES[0].dir;
  test.skip(!fallout, 'set FO1_DIR to your Fallout folder to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  // The game as it is, linked rather than copied, and its lists out of MASTER.DAT, loose, ending lines in CR LF.
  const folder = join(tempFolder(), 'Fallout Made On Windows');
  mkdirSync(folder, { recursive: true });
  linkInto(fallout!, folder);
  const masterName = readdirSync(fallout!).find((name) => name.toLowerCase() === 'master.dat')!;
  const master = (await openAsBlob(join(fallout!, masterName))) as unknown as DatArchive;
  const index = await indexDat(master, 'dat1');
  for (const list of ['proto/items/items.lst', 'proto/critters/critters.lst', 'scripts/scripts.lst']) {
    const text = new TextDecoder('latin1').decode(await readDatEntry(master, 'dat1', index.get(list)!));
    const path = join(folder, 'DATA', ...list.toUpperCase().split('/'));
    mkdirSync(dirname(path), { recursive: true });
    // A link to the game's own copy would be written through: the copy here is a file of its own.
    rmSync(path, { force: true });
    writeFileSync(path, Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'latin1'));
  }

  await openConsole(page, 'fo1', { skipIntro: true });
  await pickFolder(page, fallout!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/mods/load');
  await pickFolder(page, folder);
  await expect(page.getByRole('heading', { name: 'Fallout Made On Windows' })).toBeVisible({ timeout: 600_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 600_000 });
  // Of the whole game folder only the three lists are its own: the rest is the game in deck A.
  await expect(page.getByRole('status')).toContainText('3 files');
  await expect(page.getByRole('status')).toContainText('the same as your Fallout in deck A are not stored again');

  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 4000);
  const mainMenu = await fingerprint(page);
  await page.keyboard.press('n');
  await pause(page, 3500);
  await page.keyboard.press('t');
  await pause(page, 4500);
  await page.keyboard.press('Escape');
  await expect.poll(() => inProgress(page), { timeout: 60_000, intervals: [1000] }).toBe(true);
  await pause(page, 7500);
  expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);
  // Saved: the game's items and critters, read through the lists, written back into a save of the mod's own.
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  expect(faults).toEqual([]);
});

/**
 * What the engine of Fallout 2 was given of sfall for the known mods
 * (engines/fallout2/patches 0008-0012), played in the real game by two scripts
 * of tests/sfall loaded as a mod: a global script that calls them and writes
 * what it saw into a virtual file kept in the save, and a hook script, found
 * by its file name, that counts its runs in another. Both are read back out of
 * the quick save's sfallfs.sav.
 */
test('Fallout 2: sfall virtual files, hook scripts and the calls the mods make, kept in a save', async ({ page }) => {
  const fallout2 = GAMES[1].dir;
  test.skip(!fallout2, 'set FO2_DIR to your Fallout 2 folder to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  const folder = join(tempFolder(), 'Overseer sfall test');
  mkdirSync(join(folder, 'data', 'scripts'), { recursive: true });
  for (const script of ['gl_overseer.int', 'hs_gamemodechange.int', 'hs_setglobalvar.int', 'hs_onexplosion.int']) {
    writeFileSync(join(folder, 'data', 'scripts', script), readFileSync(new URL(`../sfall/${script}`, import.meta.url)));
  }
  // A folder of the mods folder with a settings file in it, as Inventory Filter's is: packed into an archive here.
  mkdirSync(join(folder, 'mods', 'OvTest.dat'), { recursive: true });
  writeFileSync(join(folder, 'mods', 'OvTest.dat', 'ovtest.ini'), '[Test]\r\n; What the player changes on the mod\'s page\r\nValue=42\r\nOther=7\r\n');
  mkdirSync(join(folder, 'data', 'sound', 'sfx'), { recursive: true });
  writeFileSync(join(folder, 'data', 'sound', 'sfx', 'overseer.mp3'), readFileSync(new URL('../sfall/overseer.mp3', import.meta.url)));
  // Hero Appearance on, with a style of its own: the first ready-made character, standing, in a robe (Fallout 2's
  // own robe, out of critter.dat).
  writeFileSync(join(folder, 'ddraw.ini'), '[Misc]\r\nEnableHeroAppearanceMod=1\r\nDrugsFile=Drugs.ini\r\n');
  // sfall's drugs file, naming one drug.
  writeFileSync(join(folder, 'Drugs.ini'), '[main]\r\nCount=1\r\n[1]\r\nPID=40\r\nNumEffects=1\r\nAddictTime=0\r\n');
  // The sfall it came with, which its scripts are told.
  writeFileSync(join(folder, 'ddraw.dll'), sfallLibrary(['4.4.5.1', [4, 4, 5]]));
  const critterName = readdirSync(fallout2!).find((name) => name.toLowerCase() === 'critter.dat')!;
  const critters = (await openAsBlob(join(fallout2!, critterName))) as unknown as DatArchive;
  const robe = (await indexDat(critters, 'dat2')).get('art/critters/harobeaa.frm')!;
  mkdirSync(join(folder, 'appearance', 'hmR00S01', 'art', 'critters'), { recursive: true });
  writeFileSync(join(folder, 'appearance', 'hmR00S01', 'art', 'critters', '_HMWARRAA.FRM'), await readDatEntry(critters, 'dat2', robe));

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, fallout2!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/mods/load');
  await pickFolder(page, folder);
  await expect(page.getByRole('heading', { name: 'Overseer sfall test' })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  // One of its settings changed on its page, as a player would.
  await page.locator('.menu li', { hasText: 'Settings' }).locator('button').click();
  await page.locator('.menu li', { hasText: 'ovtest.ini' }).locator('button').click();
  await page.locator('.menu li', { hasText: /^\[1\]\s*Value/ }).locator('button').click();
  await page.getByRole('textbox').fill('43');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('.menu li', { hasText: /^\[1\]\s*Value/ })).toContainText('43');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // A new game with the first ready-made character.
  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 8000);
  const mainMenu = await fingerprint(page);
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('t');
  await pause(page, 10000);
  await page.keyboard.press(' ');
  await pause(page, 5000);
  await page.keyboard.press(' ');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 5000);
  expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);
  // The character screen, opened and closed: two changes of game mode for the hook script.
  await page.keyboard.press('c');
  await pause(page, 3000);
  await page.keyboard.press('Escape');
  await pause(page, 3000);

  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });

  // sfallfs.sav: the number of files, then each one's length, name (128 bytes), position and bytes.
  const keptFiles = async () => {
    const data = Buffer.from((await engineFile(page, 'data/savegame/slot07/sfallfs.sav')) ?? []);
    const kept = new Map<string, Buffer>();
    for (let at = 4, index = 0; index < data.readUInt32LE(0); index++) {
      const length = data.readUInt32LE(at);
      const name = data.subarray(at + 4, at + 132);
      kept.set(name.subarray(0, name.indexOf(0)).toString('latin1'), data.subarray(at + 136, at + 136 + length));
      at += 136 + length;
    }
    return kept;
  };
  const files = await keptFiles();
  console.log(`sfall test: kept ${[...files].map(([name, bytes]) => `${name} [${[...bytes].join(' ')}]`).join(', ')}`);
  // Read back high byte first; copied from a virtual file; two traits; the world map's view; the knockback and
  // heave-ho calls; an MP3 played; the Hero Appearance style kept for scripts; six reads, writes and a call into the
  // original program's memory; the version of the mod's sfall; two settings of a packed folder of the mods folder, the
  // first as changed on the mod's page; the settings the engine always acts on; the interface bar hidden and shown,
  // and the metarules beside it; rest on a map; a drug's data; words on the interface bar's overlay; and the end.
  expect([...files.get('overseer/result')!]).toEqual([1, 1, 1, 5, 7, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 5, 43, 7, 1, 1, 1, 1, 1, 66]);
  // The words the script left on an overlay of the interface bar, there after the bar was drawn again.
  const barPath = test.info().outputPath('interface-overlay.png');
  await page.locator('#canvas').screenshot({ path: barPath });
  await test.info().attach('interface_print: OVERSEER over the interface bar', { path: barPath, contentType: 'image/png' });
  // The player in the style's robe.
  const path = test.info().outputPath('hero-appearance.png');
  await page.locator('#canvas').screenshot({ path });
  await test.info().attach('Hero Appearance: the player in the style picked by script', { path, contentType: 'image/png' });
  // Started with the game, and run at each change of game mode since.
  expect(files.get('overseer/hooks')!.readInt32BE(0)).toBeGreaterThanOrEqual(3);
  // Global variable 0 set to 7, read back as 8: the SetGlobalVar hook, by a hook script of its own, once the game
  // is up (the first run of the game mode hook script is before).
  expect([...files.get('overseer/globalvar')!]).toEqual([8]);
  // The explosion the script set off: tiles in its radius looked at, each run told of it as it was.
  const explosion = files.get('overseer/explosion')!;
  expect(explosion.readInt32BE(0)).toBeGreaterThan(0);
  expect(explosion[4]).toBe(1);
  // Only the files the scripts asked to keep.
  expect([...files.keys()].sort()).toEqual(['overseer/explosion', 'overseer/globalvar', 'overseer/hooks', 'overseer/result']);

  // Loaded and saved again: the style came back with the save (the script only says which it found), and the
  // player is drawn in it.
  await page.keyboard.press('F7');
  await pause(page, 10_000);
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 3000);
  const loadedPath = test.info().outputPath('hero-appearance-loaded.png');
  await page.locator('#canvas').screenshot({ path: loadedPath });
  await test.info().attach('Hero Appearance: the player after loading the save', { path: loadedPath, contentType: 'image/png' });
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  expect([...((await keptFiles()).get('overseer/loaded') ?? [])]).toEqual([1]);

  // The character screen with the view of the character, and the race and style headings.
  await page.keyboard.press('c');
  await pause(page, 3000);
  const screenPath = test.info().outputPath('hero-appearance-character-screen.png');
  await page.locator('#canvas').screenshot({ path: screenPath });
  await test.info().attach('Hero Appearance: the character screen', { path: screenPath, contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await pause(page, 2000);
  expect(faults).toEqual([]);
});

/**
 * The touch deck's HILITE switch holds the key that lights up what lies on the
 * ground for the game's script. The script puts the lights out whenever the
 * game leaves the map for a save, a load, a screen over it or a conversation;
 * with the switch still on, they come back as soon as the game is back on the
 * map. In Arroyo, where there is something to light.
 */
test('Fallout 2: what the HILITE switch lights stays lit through saves, a load and the inventory', async ({ page }, testInfo) => {
  const fallout2 = GAMES[1].dir;
  test.skip(!fallout2, 'set FO2_DIR to your Fallout 2 folder to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  const folder = join(tempFolder(), 'Fallout 2');
  mkdirSync(folder, { recursive: true });
  linkInto(fallout2!, folder);
  mkdirSync(join(folder, 'data', 'config'), { recursive: true });
  writeFileSync(join(folder, 'data', 'config', 'game#patch.cfg'), '[start]\r\nmap=arvillag.map\r\n');

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, folder);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 4000);
  await page.keyboard.press('n');
  await pause(page, 3500);
  await page.keyboard.press('t');
  await pause(page, 4500);
  await page.keyboard.press('Escape');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 6000);
  // The pointer is kept off the picture: what it points at lights up of itself.
  await page.mouse.move(2, 2);
  await pause(page, 1000);

  const setLights = (on: boolean) => page.evaluate((on) => (window as unknown as { overseerEngine: { setLights(on: boolean): void } }).overseerEngine.setLights(on), on);
  /** How much of the map is drawn in the yellow the script outlines items with. */
  const outlined = async (name: string): Promise<number> => {
    const path = testInfo.outputPath(`hilite-${name.replace(/\W+/g, '-')}.png`);
    const png = await page.locator('#canvas').screenshot({ path });
    await testInfo.attach(`Fallout 2: HILITE, ${name}`, { path, contentType: 'image/png' });
    return page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      // Above the interface bar.
      const pixels = context.getImageData(0, 0, bitmap.width, Math.floor((bitmap.height * 380) / 480)).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 164 && pixels[i + 1] === 136 && pixels[i + 2] === 48) count++;
      return count;
    }, png.toString('base64'));
  };

  const plain = await outlined('off');
  await setLights(true);
  await pause(page, 1500);
  const lit = await outlined('on');
  console.log(`Fallout 2: HILITE off ${plain}, on ${lit} outlined pixels`);
  expect(lit).toBeGreaterThan(200);
  expect(lit).toBeGreaterThan(plain * 5);

  /** Still lit: as much outlined as when it was switched on, near enough. */
  const stillLit = async (after: string) => {
    await page.mouse.move(2, 2);
    await pause(page, 2500);
    const now = await outlined(`on, after ${after}`);
    console.log(`Fallout 2: after ${after}, ${now} outlined pixels`);
    expect(now, after).toBeGreaterThan(lit / 2);
  };

  await page.evaluate(() => (window as unknown as { overseerAutosave(): Promise<boolean> }).overseerAutosave());
  await expect(page.locator('#toast')).toHaveText('AUTOSAVED IN SLOT 08', { timeout: 30_000 });
  await stillLit('an autosave');

  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  await stillLit('a quick save');

  await page.keyboard.press('i');
  await pause(page, 2000);
  await page.keyboard.press('Escape');
  await stillLit('the inventory');

  await page.keyboard.press('F7');
  await expect(page.locator('#toast')).toHaveText('QUICK LOADED FROM SLOT 07', { timeout: 30_000 });
  await stillLit('a quick load');

  await setLights(false);
  await pause(page, 1500);
  expect(await outlined('off again')).toBeLessThan(lit / 5);
  expect(faults).toEqual([]);
});

/**
 * Fallout Fixt's sfall settings (its ddraw.ini), which the engine of Fallout
 * follows (engines/fallout1/patches): holding left Shift lights up what lies
 * on the ground, here the bodies by the vault's door in grey, and letting go
 * puts it out.
 */
test("Fallout Fixt: its sfall settings' key lights up what lies on the ground", async ({ page }, testInfo) => {
  const fallout = GAMES[0].dir;
  const source = process.env.FIXT;
  test.skip(!fallout || !source, 'set FO1_DIR and FIXT to run this');
  test.setTimeout(1_800_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo1', { skipIntro: true });
  await pickFolder(page, fallout!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/mods/load');
  await pickFolder(page, source!);
  await expect(page.getByRole('heading', { name: 'Fallout Fixt' })).toBeVisible({ timeout: 1_800_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 1_800_000 });

  // A new game with its first ready-made character, outside the vault.
  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 8000);
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('t');
  await pause(page, 10000);
  await page.keyboard.press(' ');
  await pause(page, 5000);
  await page.keyboard.press(' ');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 8000);

  const plain = await fingerprint(page);
  await page.keyboard.down('ShiftLeft');
  await pause(page, 1500);
  const lit = await fingerprint(page);
  const path = testInfo.outputPath('fixt-lit.png');
  await page.locator('#canvas').screenshot({ path });
  await testInfo.attach('Fallout Fixt: left Shift held', { path, contentType: 'image/png' });
  await page.keyboard.up('ShiftLeft');
  await pause(page, 1500);
  console.log(`Fallout Fixt: Shift held ${distance(plain, lit).toFixed(2)} from the plain picture`);
  expect(distance(plain, lit)).toBeGreaterThan(0.2);
  expect(distance(plain, await fingerprint(page))).toBeLessThan(0.1);

  // The touch deck's HILITE switch holds the same key, and what it lights stays lit through a quick save and a
  // quick load, whose map comes back with nothing lit.
  const setLights = (on: boolean) => page.evaluate((on) => (window as unknown as { overseerEngine: { setLights(on: boolean): void } }).overseerEngine.setLights(on), on);
  await setLights(true);
  await pause(page, 1500);
  expect(distance(plain, await fingerprint(page))).toBeGreaterThan(0.2);
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  await pause(page, 2000);
  expect(distance(plain, await fingerprint(page)), 'after a quick save').toBeGreaterThan(0.2);
  await page.keyboard.press('F7');
  await expect(page.locator('#toast')).toHaveText('QUICK LOADED FROM SLOT 07', { timeout: 30_000 });
  await pause(page, 3000);
  const reloaded = testInfo.outputPath('fixt-lit-after-load.png');
  await page.locator('#canvas').screenshot({ path: reloaded });
  await testInfo.attach('Fallout Fixt: HILITE on after a quick load', { path: reloaded, contentType: 'image/png' });
  const litAfterLoad = await fingerprint(page);
  const afterLoad = distance(plain, litAfterLoad);
  console.log(`Fallout Fixt: HILITE on after a quick load ${afterLoad.toFixed(2)} from the plain picture`);
  expect(afterLoad, 'after a quick load').toBeGreaterThan(0.2);
  // Off again, the lights go out (the load put its own words in the message box: the plain picture is not quite this one).
  await setLights(false);
  await pause(page, 1500);
  const off = await fingerprint(page);
  expect(distance(off, litAfterLoad)).toBeGreaterThan(0.2);
  expect(distance(off, plain)).toBeLessThan(afterLoad);
  expect(faults).toEqual([]);
});

/**
 * Add-ons, from the real things: FO2tweaks (its archive and settings for the
 * mods folder, and sfall's library) and Cassidy's talking head (one archive)
 * laid over Fallout 2; Party Orders over the Restoration Project, which has
 * an older copy of it; the music for both games over Fallout. Shown by what
 * the engine says it opens, what its scripts say, what it reads, and what it
 * is handed.
 *   FO2_DIR=... FO2TWEAKS="/path/to/fo2tweaks_v14.7.zip" CASSIDY="/path/to/cassidy_head.dat"
 *   RPU=... PARTY_ORDERS="/path/to/party_orders_v1.17.zip" FO1_DIR=... MUSIC="/path/to/fallout_1_2_lq_ebur128_music_v2.zip"
 */
test('Fallout 2: add-ons laid over it, their archives opened and their scripts run', async ({ page }) => {
  const fallout2 = GAMES[1].dir;
  const [tweaks, cassidy] = [process.env.FO2TWEAKS, process.env.CASSIDY];
  test.skip(!fallout2 || !tweaks || !cassidy, 'set FO2_DIR, FO2TWEAKS and CASSIDY to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  const log: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[engine]')) log.push(message.text());
  });

  // The game linked rather than copied, its settings asking the engine to say what it opens and what scripts say.
  const folder = join(tempFolder(), 'Fallout 2');
  mkdirSync(folder, { recursive: true });
  linkInto(fallout2!, folder);
  const name = readdirSync(folder).find((entry) => entry.toLowerCase() === 'fallout2.cfg') ?? 'fallout2.cfg';
  const settings = Ini.parse(statSync(join(folder, name), { throwIfNoEntry: false }) ? readFileSync(join(folder, name), 'latin1') : '');
  settings.set('debug', 'mode', 'screen');
  settings.set('debug', 'show_script_messages', 1);
  // A link to the original: put aside, and a file of its own written in its place.
  rmSync(join(folder, name), { force: true });
  writeFileSync(join(folder, name), settings.toString(), 'latin1');

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, folder);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

  // Loaded from the deck, each laid over the game as it arrives: FO2tweaks from its zip, Cassidy's head as the archive it is.
  await page.locator('.menu button', { hasText: 'Add-ons' }).click();
  await page.locator('input[accept*=".dat"]').setInputFiles(tweaks!);
  await expect(page.locator('.menu li', { hasText: 'Fo2tweaks' })).toContainText('ON', { timeout: 120_000 });
  await page.locator('input[accept*=".dat"]').setInputFiles(cassidy!);
  await expect(page.locator('.menu li', { hasText: 'Cassidy head' })).toContainText('ON, 2 OF 2', { timeout: 120_000 });
  await page.keyboard.press('Escape');

  // A new game with the first ready-made character.
  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 8000);
  const mainMenu = await fingerprint(page);
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('t');
  await pause(page, 10000);
  await page.keyboard.press(' ');
  await pause(page, 5000);
  await page.keyboard.press(' ');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 10000);
  expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);

  // Both opened by the engine, in the order they were switched on; FO2tweaks' scripts started with the game.
  const opened = log.filter((line) => /Loading mod /.test(line));
  console.log(`Add-ons on Fallout 2: ${opened.join('; ')}`);
  expect(opened.some((line) => /Loading mod mods[\\/]fo2tweaks\.dat/i.test(line))).toBe(true);
  expect(opened.some((line) => /Loading mod mods[\\/]cassidy_head\.dat/i.test(line))).toBe(true);
  expect(opened.findIndex((line) => /fo2tweaks/i.test(line))).toBeLessThan(opened.findIndex((line) => /cassidy_head/i.test(line)));
  const started = log.filter((line) => /gl_g_\w+: initialized/.test(line));
  console.log(`FO2tweaks: ${started.length} lines from its scripts, such as ${started.slice(0, 3).join('; ')}`);
  expect(started.length).toBeGreaterThan(0);
  // Cassidy's head, large enough to be read on demand: its archive's directory read from the add-on.
  expect((await fileReads(page)).addon).toContain('mods/cassidy_head.dat');
  // Told the engine's file system override is on (0021), FO2tweaks does not turn it on in a ddraw.ini of its own
  // and ask for the game to be started again.
  expect(await engineFile(page, 'ddraw.ini')).toBeNull();

  // FO2tweaks' keymap, on as it comes, without what it would move onto or off the console's keys: quick save on F6 still.
  const keymap = Buffer.from((await engineFile(page, 'mods/fo2tweaks.ini')) ?? []).toString('latin1');
  expect(keymap).toMatch(/^keymap=1/m);
  expect(keymap).not.toMatch(/^F[5-9]=/m);
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  expect(await savedHeader(page, 7)).toMatchObject({ map: 'ARTEMPLE', character: 'Narg' });
  await page.keyboard.press('F9');
  await expect(page.getByText('Simulation suspended')).toBeVisible();
  await page.keyboard.press('x');
  await page.keyboard.press('y');
  await expect(page.getByRole('heading', { name: /Fallout 2$/ })).toBeVisible({ timeout: 30_000 });
  expect(faults).toEqual([]);
});

/**
 * Inventory Filter, from the real thing, laid over Fallout 2 as its readme
 * says to unpack it: a folder named InventoryFilter.dat in the mods folder,
 * whose settings it reads by that path (the console packs the folder into an
 * archive: engines/fallout2/patches 0019), and which shows what it filtered
 * by pressing Home (0020). tests/sfall's gl_ovgive gives the player things of
 * each kind to filter. Its buttons are at the inventory's left edge.
 *   FO2_DIR=... INVENTORY_FILTER="/path/to/a zip or folder holding mods/InventoryFilter.dat/"
 */
test('Fallout 2: Inventory Filter as an add-on reads its settings and filters the inventory', async ({ page }) => {
  const fallout2 = GAMES[1].dir;
  const filter = process.env.INVENTORY_FILTER;
  test.skip(!fallout2 || !filter, 'set FO2_DIR and INVENTORY_FILTER to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, fallout2!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.locator('.menu button', { hasText: 'Add-ons' }).click();
  await page.locator('input[accept*=".dat"]').setInputFiles(filter!);
  await expect(page.locator('.menu li', { hasText: /Inventory ?filter/i })).toContainText('ON', { timeout: 120_000 });
  const give = join(tempFolder(), 'gl_ovgive.int');
  writeFileSync(give, readFileSync(new URL('../sfall/gl_ovgive.int', import.meta.url)));
  await page.locator('input[accept*=".dat"]').setInputFiles(give);
  await expect(page.locator('.menu li', { hasText: 'Gl ovgive' })).toContainText('ON', { timeout: 120_000 });
  await page.keyboard.press('Escape');

  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 8000);
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('t');
  await pause(page, 10000);
  await page.keyboard.press(' ');
  await pause(page, 5000);
  await page.keyboard.press(' ');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 8000);

  // Where a point of the game's picture is on the page, and a picture of the inventory's list.
  const box = (await page.locator('#canvas').boundingBox())!;
  const size = await page.evaluate(() => (window as unknown as { overseerEngine: { screen: { width: number; height: number } } }).overseerEngine.screen);
  const at = (x: number, y: number) => ({ x: box.x + (x * box.width) / size.width, y: box.y + (y * box.height) / size.height });
  const corner = at(75, 40);
  const end = at(215, 335);
  const list = () => page.screenshot({ clip: { x: corner.x, y: corner.y, width: end.x - corner.x, height: end.y - corner.y } });
  const press = async (x: number, y: number) => {
    const point = at(x, y);
    await page.mouse.move(point.x, point.y);
    await pause(page, 500);
    await page.mouse.down();
    await pause(page, 150);
    await page.mouse.up();
    await pause(page, 2000);
  };

  await page.keyboard.press('i');
  await pause(page, 3000);
  const all = await list();
  // Weapons only: fewer things in the list, and the weight of what is shown under it, from its settings.
  await press(26, 71);
  const weapons = await list();
  expect(weapons.equals(all)).toBe(false);
  expect(weapons.length).toBeLessThan(all.length * 0.8);
  // Ammunition: another few.
  await press(26, 94);
  const ammo = await list();
  expect(ammo.equals(weapons)).toBe(false);
  // Everything again.
  await press(26, 25);
  expect((await list()).length).toBeGreaterThan(weapons.length);
  // Its buttons, at the inventory's left edge.
  const left = at(5, 10);
  const right = at(45, 175);
  const buttons = async () => {
    // The pointer away from them, which lights one up.
    const away = at(320, 400);
    await page.mouse.move(away.x, away.y);
    await pause(page, 1000);
    return page.screenshot({ clip: { x: left.x, y: left.y, width: right.x - left.x, height: right.y - left.y } });
  };
  const shown = await buttons();
  await page.keyboard.press('Escape');
  await pause(page, 2000);

  // Switched off with its own key, F11, which with SHIFT is the game's: its buttons are gone from the inventory.
  await page.keyboard.press('Shift+F11');
  await pause(page, 2000);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.keyboard.press('i');
  await pause(page, 3000);
  const off = await buttons();
  await test.info().attach('Inventory Filter switched off', { body: off, contentType: 'image/png' });
  expect(off.equals(shown)).toBe(false);
  await page.keyboard.press('Escape');
  expect(faults).toEqual([]);
});

/**
 * sfall's set_dude_obj (engines/fallout2/patches 0030), played in the real
 * game by tests/sfall/gl_ovctrl.int laid over it: a villager joins the party,
 * a thug starts a fight, and on the villager's turns the player plays the
 * villager, as gl_partycontrol does with CombatControl Mode=2. Then the bar
 * is the villager's (its kick, its 9 action points), a click walks it, the
 * game cannot be saved, and the player's own comes back with the turn's end.
 */
test('Fallout 2: the player plays a party member in combat, as sfall\'s set_dude_obj has it', async ({ page }) => {
  const fallout2 = GAMES[1].dir;
  test.skip(!fallout2, 'set FO2_DIR to your Fallout 2 folder to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, fallout2!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.locator('.menu button', { hasText: 'Add-ons' }).click();
  const script = join(tempFolder(), 'gl_ovctrl.int');
  writeFileSync(script, readFileSync(new URL('../sfall/gl_ovctrl.int', import.meta.url)));
  await page.locator('input[accept*=".dat"]').setInputFiles(script);
  await expect(page.locator('.menu li', { hasText: 'Gl ovctrl' })).toContainText('ON', { timeout: 120_000 });
  await page.keyboard.press('Escape');

  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 8000);
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('t');
  await pause(page, 10000);
  await page.keyboard.press(' ');
  await pause(page, 5000);
  await page.keyboard.press(' ');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 2000);

  // The villager's turn, played by the player: no saving while it is (sfall's CombatSaveTest).
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText(/QUICK SAVE FAILED/, { timeout: 30_000 });
  const path = test.info().outputPath('party-control.png');
  await page.locator('#canvas').screenshot({ path });
  await test.info().attach('The villager played as the player', { path, contentType: 'image/png' });

  // Its turn, and the rounds after it, ended: the fight goes on with the player's own in their turns, and the game
  // is still played.
  for (let round = 0; round < 3; round++) {
    await page.keyboard.press(' ');
    await pause(page, 4000);
  }
  await expect.poll(() => inProgress(page), { timeout: 30_000 }).toBe(true);
  expect(faults).toEqual([]);
});

test('Fallout 2: autosaved on arriving on another map, its picture changed while playing, and a save that knows its add-ons', async ({ page }) => {
  const fallout2 = GAMES[1].dir;
  test.skip(!fallout2, 'set FO2_DIR to your Fallout 2 folder to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, fallout2!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

  // An add-on of one global script, which sends the player on to the Den once the game has begun.
  const travel = zipSync({ 'data/scripts/gl_ovtravel.int': new Uint8Array(readFileSync(new URL('../sfall/gl_ovtravel.int', import.meta.url))) });
  await page.locator('.menu button', { hasText: 'Add-ons' }).click();
  await page.locator('input[accept*=".dat"]').setInputFiles({ name: 'overseer_travel.zip', mimeType: 'application/zip', buffer: Buffer.from(travel) });
  await expect(page.locator('.menu li', { hasText: 'Overseer travel' })).toContainText('ON', { timeout: 120_000 });
  await page.keyboard.press('Escape');

  // A new game: the temple, then at once the Den. Arriving there is an autosave; starting the game was not.
  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 8000);
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('t');
  await pause(page, 10000);
  await page.keyboard.press(' ');
  await pause(page, 5000);
  await page.keyboard.press(' ');
  await expect(page.locator('#toast')).toHaveText('AUTOSAVED IN SLOT 08', { timeout: 180_000 });
  expect(await savedHeader(page, 8)).toMatchObject({ map: 'DENBUS1', description: expect.stringMatching(/^AUTOSAVE \d\d:\d\d$/) });
  // Beside it, what it was made with.
  const meta = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('overseer-console');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction('overlay').objectStore('overlay').get(['fo2', 'data/savegame/slot08/overseer.json']);
          read.onsuccess = () => resolve(new TextDecoder().decode(read.result.data));
          read.onerror = () => reject(read.error);
        };
      }),
  );
  expect(JSON.parse(meta)).toEqual({ game: 'fo2', addons: [{ id: 'overseer-travel', title: 'Overseer travel' }] });
  await pause(page, 3000);

  // Another picture from the menu: saved where the game can be, and on from that save in the wider picture.
  await page.keyboard.press('F9');
  await expect(page.getByText('Simulation suspended')).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.locator('.actions.stacked button')).toHaveText(['[1] CLASSIC 4:3  640 x 480  (IN USE)', '[2] WIDE  768 x 480', '[3] HIGH RESOLUTION  1152 x 720']);
  await page.keyboard.press('2');
  await page.waitForURL(/play\.html\?game=fo2&slot=9/, { timeout: 120_000 });
  await expect(page.getByText('CONTINUING FROM SAVE SLOT 09')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#terminal')).toBeHidden();
  await waitForPicture(page, 8000);
  expect(await page.evaluate(() => (window as unknown as { overseerEngine: { screen: { width: number; height: number } } }).overseerEngine.screen)).toEqual({ width: 768, height: 480 });
  expect(await savedHeader(page, 9)).toMatchObject({ map: 'DENBUS1' });
  // Loading that save sent nobody anywhere again: the script remembered, in the save, that it had.
  await pause(page, 5000);
  expect(await page.locator('#toast').textContent()).not.toContain('AUTOSAVED');
  const path = test.info().outputPath('den-wide.png');
  await page.locator('#canvas').screenshot({ path });
  await test.info().attach('The Den, carried on in the wide picture', { path, contentType: 'image/png' });

  // With the add-on off, that save asks before it plays, and switches it back on.
  await page.keyboard.press('F9');
  await page.keyboard.press('x');
  await page.keyboard.press('y');
  await expect(page.getByRole('heading', { name: /Fallout 2$/ })).toBeVisible({ timeout: 30_000 });
  await page.locator('.menu button', { hasText: 'Add-ons' }).click();
  await page.locator('.menu li', { hasText: 'Overseer travel' }).locator('button').click();
  await expect(page.locator('.menu li', { hasText: 'Overseer travel' })).toContainText('OFF');
  await page.goto('#/saves/fo2/9');
  await pause(page, 1500);
  await page.keyboard.press('l');
  await expect(page.getByText('Add-ons missing')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('a');
  await expect(page.getByText('CONTINUING FROM SAVE SLOT 09')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Enter');
  await waitForPicture(page, 6000);

  // A problem report from the menu names the game, its engine and the add-on.
  await page.keyboard.press('F9');
  await page.keyboard.press('d');
  const report = page.locator('#terminal-body .report');
  await expect(report).toContainText('Overseer travel');
  await expect(report).toContainText('WIDE, 768 x 480');
  await expect(report).toContainText('In a game');
  await page.keyboard.press('b');
  await page.keyboard.press('x');
  await page.keyboard.press('y');
  await expect(page.getByRole('heading', { name: /Fallout 2$/ })).toBeVisible({ timeout: 30_000 });
  expect(faults).toEqual([]);
});

test("Restoration Project: an add-on laid over it, in place of its own older copy", async ({ page }) => {
  const fallout2 = GAMES[1].dir;
  const [rpu, orders] = [process.env.RPU, process.env.PARTY_ORDERS];
  test.skip(!fallout2 || !rpu || !orders, 'set FO2_DIR, RPU and PARTY_ORDERS to run this');
  test.setTimeout(1_800_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo2', { skipIntro: true });
  await pickFolder(page, fallout2!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/mods/load');
  await page.locator('input[accept*="zip"]').setInputFiles(rpu!);
  await expect(page.getByRole('heading', { name: 'Restoration Project' })).toBeVisible({ timeout: 1_800_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 1_800_000 });

  await page.locator('.menu button', { hasText: 'Add-ons' }).click();
  await page.locator('input[accept*=".dat"]').setInputFiles(orders!);
  await expect(page.locator('.menu li', { hasText: 'Party orders 1.17' })).toContainText('ON', { timeout: 120_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.readout').first()).toContainText('PARTY ORDERS 1.17');

  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 8000);
  const mainMenu = await fingerprint(page);
  await page.keyboard.press('n');
  await pause(page, 6000);
  await page.keyboard.press('t');
  await pause(page, 10000);
  await page.keyboard.press(' ');
  await pause(page, 5000);
  await page.keyboard.press(' ');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 10000);
  expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);

  // The add-on's archive in place of the mod's own, read where the add-on's are: last in the mod's load order.
  const zip = unzipSync(new Uint8Array(readFileSync(orders!)));
  const theirs = Object.entries(zip).find(([path]) => /mods\/party_orders\.dat$/i.test(path))![1];
  expect(Buffer.from((await engineFile(page, 'mods/party_orders.dat')) ?? []).equals(Buffer.from(theirs))).toBe(true);
  const order = Buffer.from((await engineFile(page, 'mods/mods_order.txt')) ?? []).toString('latin1');
  console.log(`Restoration Project with Party Orders: ${order.trim().split(/\r?\n/).join(', ')}`);
  expect(order.trim().split(/\r?\n/).at(-1)).toBe('party_orders.dat');
  expect((await fileReads(page)).own.some((path) => /^mods\/rpu\.dat$/i.test(path))).toBe(true);

  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
  expect(await savedHeader(page, 7)).toMatchObject({ map: 'ARTEMPLE', character: 'Narg' });
  await page.keyboard.press('F9');
  await expect(page.getByText('Simulation suspended')).toBeVisible();
  await page.keyboard.press('x');
  await page.keyboard.press('y');
  await expect(page.getByRole('heading', { name: 'Restoration Project' })).toBeVisible({ timeout: 30_000 });
  expect(faults).toEqual([]);
});

test("Fallout: an add-on of music laid over it, its tracks played in place of the game's", async ({ page }) => {
  const fallout = GAMES[0].dir;
  const music = process.env.MUSIC;
  test.skip(!fallout || !music, 'set FO1_DIR and MUSIC to run this');
  test.setTimeout(900_000);
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));

  await openConsole(page, 'fo1', { skipIntro: true });
  await pickFolder(page, fallout!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

  // Loaded in the Mod library for Fallout, then laid over it from its page.
  await page.goto('#/mods/addons');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.menu li').first()).toContainText(/FALLOUT$/);
  await page.locator('input[accept*=".dat"]').setInputFiles(music!);
  await expect(page.getByRole('heading', { name: /music/ })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.locator('.menu li', { hasText: /\[1\]\s*Fallout/ }).locator('button').click();
  await expect(page.locator('.menu li', { hasText: /\[1\]\s*Fallout/ })).toContainText('ON');
  await page.goto('#/fo1');
  await expect(page.locator('.menu li', { hasText: 'Add-ons' })).toContainText('1 ON');

  // A new game with the first ready-made character, and a while for its music.
  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 4000);
  const mainMenu = await fingerprint(page);
  await page.keyboard.press('n');
  await pause(page, 3500);
  await page.keyboard.press('t');
  await pause(page, 4500);
  await page.keyboard.press('Escape');
  await expect.poll(() => inProgress(page), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await pause(page, 15000);
  expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);

  const reads = await fileReads(page);
  console.log(`Fallout with the music add-on: the engine read ${reads.addon.join(', ') || 'none'} of the add-on; ${reads.own.filter((path) => /\.acm$/i.test(path)).join(', ') || 'no music'} of the game`);
  expect(reads.addon.some((path) => /^data\/sound\/music\/[^/]+\.acm$/i.test(path))).toBe(true);
  expect(reads.own.filter((path) => /\.acm$/i.test(path))).toEqual([]);
  await page.keyboard.press('F9');
  await expect(page.getByText('Simulation suspended')).toBeVisible();
  await page.keyboard.press('x');
  await page.keyboard.press('y');
  await expect(page.getByRole('heading', { name: /Fallout$/ })).toBeVisible({ timeout: 30_000 });
  expect(faults).toEqual([]);
});
