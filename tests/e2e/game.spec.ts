import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openConsole } from './helpers';

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
  test(`${game.title}: import, play, save, leave, and continue from the save`, async ({ page }) => {
    test.skip(!game.dir, `set ${game.id.toUpperCase()}_DIR to your ${game.title} folder to run this`);
    const faults: string[] = [];
    page.on('pageerror', (error) => faults.push(error.message));

    await openConsole(page, game.id, { skipIntro: true });
    await page.locator('input[webkitdirectory]').setInputFiles(game.dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

    // Main menu.
    await launch(page, 'Begin simulation', '1');
    const firstPicture = await waitForPicture(page, 4000);
    const mainMenu = await fingerprint(page);
    const afterStart = await engineStats(page);
    console.log(`${game.title}: first picture ${firstPicture} ms after starting, ${afterStart.blockReads} block reads taking ${Math.round(afterStart.blockMs)} ms`);

    // New game with the first ready-made character; skip the opening movie.
    await page.keyboard.press('n');
    await pause(page, 3500);
    await page.keyboard.press('t');
    await pause(page, 4500);
    await page.keyboard.press('Escape');
    await pause(page, 7500);
    expect(await showsPicture(page)).toBe(true);

    // Quick save: pick the first slot, describe it, confirm.
    await page.keyboard.press('F6');
    await pause(page, 2500);
    await page.keyboard.press('Enter');
    await pause(page, 1500);
    await page.keyboard.type('e2e', { delay: 80 });
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toHaveText('SAVED TO BROWSER STORAGE', { timeout: 30_000 });
    const firstSave = (await engineStats(page)).syncs;
    expect(firstSave).toBeGreaterThan(0);

    // Quick save again: same slot, no questions. The first save becomes history.
    await pause(page, 1500);
    await page.keyboard.press('F6');
    await expect.poll(async () => (await engineStats(page)).syncs, { timeout: 30_000 }).toBeGreaterThan(firstSave);
    await pause(page, 1500);
    const inGame = await fingerprint(page);
    expect(distance(inGame, mainMenu)).toBeGreaterThan(12);

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

    // The save is in the archives, with the one it replaced kept as an earlier version.
    await page.goto(`#/saves/${game.id}`);
    const slot = page.locator('.menu li').first();
    await expect(slot).toContainText('SLOT 01');
    await expect(slot).toContainText('e2e');
    await expect(page.locator('.menu-note')).toContainText('1 earlier version kept.');

    // Continue: from the main directory straight back to where the save was made.
    await page.goto('#/');
    await expect(page.locator('.menu li').first()).toContainText(`Continue: ${game.title}`);
    await launch(page, 'Continue', 'c');
    expect(page.url()).toContain('slot=1');
    let closest = 255;
    await expect
      .poll(async () => (closest = Math.min(closest, distance(await fingerprint(page), inGame))), { timeout: 120_000, intervals: [1000] })
      .toBeLessThan(6);
    console.log(`${game.title}: after continuing the picture is ${closest.toFixed(1)} away from the one saved (${distance(inGame, mainMenu).toFixed(1)} from the main menu)`);
    const before = (await engineStats(page)).sleeps;
    await pause(page, 1000);
    expect((await engineStats(page)).sleeps).toBeGreaterThan(before);

    expect(faults).toEqual([]);
    await expect(page.getByText('System fault')).toHaveCount(0);
  });
}
