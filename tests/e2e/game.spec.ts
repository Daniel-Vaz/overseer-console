import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { expect, test } from './fixtures';
import { statSync } from 'node:fs';
import { openConsole, pickFolder } from './helpers';

/**
 * Plays the real games. Needs your own copies:
 *   FO1_DIR="/path/to/Fallout" FO2_DIR="/path/to/Fallout 2" npm run test:e2e
 * Skipped when the folders are not given, which is always the case in CI.
 */
const GAMES = [
  { id: 'fo1', title: 'Fallout', dir: process.env.FO1_DIR },
  { id: 'fo2', title: 'Fallout 2', dir: process.env.FO2_DIR },
] as const;

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Whether the engine says a game is in progress, rather than its menus. */
function inProgress(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { overseerEngine: { inGame(): boolean } }).overseerEngine.inGame());
}

async function engineStats(page: Page): Promise<{ sleeps: number; syncs: number; blockReads: number; blockMs: number }> {
  return page.evaluate(() => (window as unknown as { overseerEngine: { module: { overseer: { stats(): never } } } }).overseerEngine.module.overseer.stats());
}

/** True when the page shows a picture rather than a black frame. */
async function showsPicture(page: Page): Promise<boolean> {
  return (await page.screenshot()).length > 150_000;
}

/** Waits for the game to draw something, then for it to settle. Returns how long the picture took. */
async function waitForPicture(page: Page, settleMs: number): Promise<number> {
  const started = Date.now();
  await expect.poll(() => showsPicture(page), { timeout: 90_000, intervals: [500] }).toBe(true);
  const took = Date.now() - started;
  await pause(page, settleMs);
  return took;
}

/** Starts the game from a console menu entry and passes the start gate. */
async function launch(page: Page, entry: string, key: string): Promise<void> {
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
async function fingerprint(page: Page): Promise<number[]> {
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
function distance(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length;
}

for (const game of GAMES) {
  test(`${game.title}: import, play, save, leave, continue from the save, and quit`, async ({ page }) => {
    test.skip(!game.dir, `set ${game.id.toUpperCase()}_DIR to your ${game.title} folder to run this`);
    const faults: string[] = [];
    page.on('pageerror', (error) => faults.push(error.message));

    await openConsole(page, game.id, { skipIntro: true });
    await pickFolder(page, game.dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

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
    expect(names.some((name) => /SLOT01\/[A-Z0-9_]+\.SAV$/.test(name) && !name.endsWith('AUTOMAP.SAV'))).toBe(true);
    for (const [name, data] of Object.entries(archive)) expect(data.length, name).toBeGreaterThan(0);
    expect(Buffer.from(archive['SAVEGAME/SLOT01/SAVE.DAT']!.subarray(0, 17)).toString('latin1')).toBe('FALLOUT SAVE FILE');

    // Continue: from the main directory straight back to where the latest save, the quick save, was made.
    await page.goto('#/');
    await expect(page.locator('.menu li').first()).toContainText(`Continue: ${game.title}`);
    await launch(page, 'Continue', 'c');
    expect(page.url()).toContain('slot=7');
    let closest = 255;
    await expect
      .poll(async () => (closest = Math.min(closest, distance(await fingerprint(page), inGame))), { timeout: 120_000, intervals: [1000] })
      .toBeLessThan(6);
    console.log(`${game.title}: after continuing the picture is ${closest.toFixed(1)} away from the one saved (${distance(inGame, mainMenu).toFixed(1)} from the main menu)`);
    const before = (await engineStats(page)).sleeps;
    await pause(page, 1000);
    expect((await engineStats(page)).sleeps).toBeGreaterThan(before);

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
test('Fallout Et Tu: put together from both games and its package, started, and quit', async ({ page }) => {
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

  await page.goto('#/ettu');
  if (statSync(ettu!).isDirectory()) await pickFolder(page, ettu!);
  else await page.locator('input[accept*="zip"]').setInputFiles(ettu!);
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
  await page.keyboard.press('n');
  await pause(page, 3500);
  await page.keyboard.press('t');
  await pause(page, 4500);
  await page.keyboard.press('Escape');
  await pause(page, 9000);
  expect(await showsPicture(page)).toBe(true);
  expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(12);

  // Quitting through the game's own menus goes back to the console.
  await page.keyboard.press('F10');
  await pause(page, 1500);
  await page.keyboard.press('y');
  await expect.poll(async () => distance(await fingerprint(page), mainMenu), { timeout: 30_000, intervals: [1000] }).toBeLessThan(6);
  await page.keyboard.press('e');
  await expect(page.getByRole('heading', { name: /Fallout Et Tu$/ })).toBeVisible({ timeout: 30_000 });
  expect(faults).toEqual([]);
});
