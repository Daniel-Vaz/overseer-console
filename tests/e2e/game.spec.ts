import { expect, test, type Page } from '@playwright/test';
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

async function launch(page: Page): Promise<void> {
  await expect(page.locator('.menu button').first()).toContainText('Begin simulation');
  // A person does not launch within milliseconds of the page appearing.
  await pause(page, 1500);
  await page.keyboard.press('1');
  await page.waitForURL(/play\.html/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#terminal')).toBeHidden();
}

for (const game of GAMES) {
  test(`${game.title}: import, play, save, leave, come back and load`, async ({ page }) => {
    test.skip(!game.dir, `set ${game.id.toUpperCase()}_DIR to your ${game.title} folder to run this`);
    const faults: string[] = [];
    page.on('pageerror', (error) => faults.push(error.message));

    await openConsole(page, game.id, { skipIntro: true });
    await page.locator('input[webkitdirectory]').setInputFiles(game.dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

    // Main menu.
    await launch(page);
    const firstPicture = await waitForPicture(page, 4000);
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
    expect((await engineStats(page)).syncs).toBeGreaterThan(0);

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

    // The save is in the archives.
    await page.goto(`#/saves/${game.id}`);
    const slot = page.locator('.menu li').first();
    await expect(slot).toContainText('SLOT 01');
    await expect(slot).toContainText('e2e');

    // Back in, straight from storage: load it.
    await page.goto(`#/${game.id}`);
    await launch(page);
    await waitForPicture(page, 4000);
    await page.keyboard.press('l');
    await pause(page, 2500);
    await page.keyboard.press('Enter');
    await pause(page, 7500);
    expect(await showsPicture(page)).toBe(true);
    const before = (await engineStats(page)).sleeps;
    await pause(page, 1000);
    expect((await engineStats(page)).sleeps).toBeGreaterThan(before);

    expect(faults).toEqual([]);
    await expect(page.getByText('System fault')).toHaveCount(0);
  });
}
