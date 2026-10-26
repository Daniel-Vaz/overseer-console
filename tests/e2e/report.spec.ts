import type { Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { fo2tweaksFiles } from '../mods';
import { expect, test } from './fixtures';
import { fakeFallout2Folder, fakeFallout2WithPlaces, fakeSaveDat, openConsole, pickFolder, zipOf } from './helpers';

/**
 * Problem reports, the picture changed from a game's menu, and saves that
 * say what they were made with, on made-up game data: the engine gives up on
 * it within moments, which is enough for all that comes before or around it.
 * Playing them in the real game is in game.spec.ts.
 */

const loaded = (page: Page) => expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
const entry = (page: Page, label: string | RegExp) => page.locator('.menu li').filter({ hasText: label });
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** The address of the next tab the page opens on GitHub, which answers nothing: nothing reaches the real one. */
async function nextIssue(page: Page, open: () => Promise<void>): Promise<URL> {
  const context = page.context();
  let asked = '';
  await context.route('https://github.com/**', (route) => {
    asked ||= route.request().url();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>issue</title>' });
  });
  const tab = context.waitForEvent('page');
  await open();
  await tab;
  await expect.poll(() => asked).not.toBe('');
  // Not waited for: Chromium now and then never says such a tab has closed (seen in CI), and its closing is not what
  // is tested here.
  void (await tab).close().catch(() => undefined);
  await context.unroute('https://github.com/**');
  return new URL(asked);
}

/** From the console's deck to the suspended menu of the engine, before the engine can give up on the made-up data. */
async function toTheMenu(page: Page): Promise<void> {
  await page.goto('#/fo2');
  await page.waitForTimeout(1500);
  await page.keyboard.press('1');
  await page.waitForURL(/play\.html/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  // Held from its first moment: it gets no further than a slice of its start-up, and the menu is the page's to show.
  await page.evaluate(() => (window as unknown as { overseerEngine: { pause(): void } }).overseerEngine.pause());
  await page.keyboard.press('Enter');
  await page.keyboard.press('F9');
  await expect(page.getByText('Simulation suspended')).toBeVisible();
}

test("a game's menu has a problem report to file on GitHub, filled in, and nothing sent", async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder());
  await loaded(page);
  await toTheMenu(page);

  await page.keyboard.press('d');
  await expect(page.locator('#terminal-body .big')).toHaveText('Problem report');
  const report = page.locator('#terminal-body .report');
  await expect(report).toContainText('CONSOLE');
  await expect(report).toContainText('Fallout 2 (fo2)');
  await expect(report).toContainText('fallout2-ce');
  await expect(report).toContainText('BROWSER AND MACHINE');
  // What the console knows, and no more: no account of the player's.
  await expect(report).not.toContainText(/\S+@\S+\.\S+/);

  // A new issue, its title the same as every report's, its body the report.
  const url = await nextIssue(page, () => page.keyboard.press('o'));
  expect(`${url.origin}${url.pathname}`).toBe('https://github.com/Daniel-Vaz/overseer-console/issues/new');
  expect(url.searchParams.get('title')).toBe('[Fallout 2] Problem: <say what went wrong>');
  const body = url.searchParams.get('body')!;
  expect(body.startsWith('### What happened')).toBe(true);
  expect(body).toContain('| Game | Fallout 2 (fo2) |');
  expect(body).toMatch(/\| Build \| [0-9a-f]{7}/);
  await expect(page.locator('.report-status')).toContainText('OPENED ON GITHUB IN A NEW TAB');

  // Saved as a file, the same report.
  const download = page.waitForEvent('download');
  await page.keyboard.press('s');
  expect((await download).suggestedFilename()).toMatch(/^overseer-report-fallout-2-\d{8}-\d{4}\.md$/);

  // Back to the menu, and from there into the game again.
  await page.keyboard.press('Escape');
  await expect(page.getByText('Simulation suspended')).toBeVisible();
});

test("a game's menu changes its picture: at once, while no game is in progress", async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder());
  await loaded(page);
  await toTheMenu(page);
  await expect(page.locator('.actions button', { hasText: '[V] Picture: CLASSIC 4:3' })).toBeVisible();

  await page.keyboard.press('v');
  await expect(page.locator('#terminal-body .big')).toHaveText('Picture');
  const choices = page.locator('.actions.stacked button');
  // Each with the size it would have in this window: 1280 x 800, a shape of 16:10.
  await expect(choices).toHaveText(['[1] CLASSIC 4:3  640 x 480  (IN USE)', '[2] WIDE  768 x 480', '[3] HIGH RESOLUTION  1152 x 720']);
  await page.keyboard.press('2');
  // No game in progress (its main menu): the game starts again at once, from no save, in the new picture.
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  expect(page.url()).not.toContain('slot=');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('overseer-console:settings')!));
  expect(settings.picture.fo2).toBe('wide');
});

test('a save made with an add-on that is off asks before it plays, and switches it back on', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder(true));
  await loaded(page);
  // An add-on, loaded on the deck and so laid over the game, then switched off.
  await entry(page, 'Add-ons').locator('button').click();
  await page.locator('input[accept*=".dat"]').setInputFiles(await zipOf(fo2tweaksFiles(), 'fo2tweaks_v14.7.zip'));
  await loaded(page);
  await entry(page, 'Fo2tweaks 14.7').locator('button').click();
  await expect(entry(page, 'Fo2tweaks 14.7')).toContainText('OFF');

  // A save from a console where it was on: the archive says so before it is restored.
  await page.goto('#/saves/fo2');
  const archive = zipSync({
    'SAVEGAME/SLOT03/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'with the tweaks')),
    'SAVEGAME/SLOT03/OVERSEER.JSON': encode({ game: 'fo2', addons: [{ id: 'fo2tweaks', title: 'Fo2tweaks 14.7', version: '14.7' }] }),
  });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.locator('.import-warnings')).toHaveText(
    'SLOT03 was made with Fo2tweaks 14.7 on, which is not on for Fallout 2. The console offers to switch it on when the save is played.',
  );
  await page.locator('.menu button', { hasText: 'Restore them anyway' }).click();
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();

  // Played, it asks first.
  await page.locator('.menu button', { hasText: 'SLOT 03' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('l');
  await page.waitForURL(/play\.html\?game=fo2&slot=3/);
  await expect(page.getByText('Add-ons missing')).toBeVisible();
  await expect(page.locator('#terminal-body')).toContainText('The save in slot 03 was made with Fo2tweaks 14.7 on, and it is off now.');
  await page.keyboard.press('a');
  await expect(page.getByText('CONTINUING FROM SAVE SLOT 03')).toBeVisible({ timeout: 60_000 });
  const register = await page.evaluate(() => JSON.parse(localStorage.getItem('overseer-console:addons')!));
  expect(register.on.fo2).toEqual(['fo2tweaks']);
  // And handed to the engine with it.
  const tweaks = await page.evaluate(() => (window as unknown as { overseerEngine: { about: { addons: { id: string }[] } } }).overseerEngine.about.addons.map((addon) => addon.id));
  expect(tweaks).toEqual(['fo2tweaks']);
});

test('restored saves are looked over: one the game cannot load is turned away, one of another game is named', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2WithPlaces());
  await loaded(page);
  await page.goto('#/saves/fo2');
  const restore = (files: Record<string, Uint8Array>) =>
    page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) });

  // On a map this game does not have, from a console where it was saved in another game.
  const elsewhere = new Uint8Array(fakeSaveDat('Narg', 'in sonora'));
  elsewhere.set(new TextEncoder().encode('SNHUB.SAV\0\0\0'), 0x73);
  await restore({ 'SAVEGAME/SLOT02/SAVE.DAT': elsewhere, 'SAVEGAME/SLOT02/OVERSEER.JSON': encode({ game: 'sonora', addons: [] }) });
  await expect(page.locator('.import-warnings li')).toHaveText([
    'SLOT02 was saved in sonora, not in Fallout 2.',
    'SLOT02 was saved on the map SNHUB, which Fallout 2 does not have: it looks like a save of another game or mod, and will not load.',
  ]);
  await page.locator('.menu button', { hasText: 'No, cancel' }).click();
  await expect(page.locator('.import-warnings')).toHaveCount(0);
});

test("the console's own problem report says what it holds, and the fault a game stopped with", async ({ page }) => {
  await openConsole(page, 'fo2');
  // Small archives that are archives: the engine opens them, and stops, short of its fonts.
  await pickFolder(page, await fakeFallout2Folder(true));
  await loaded(page);
  // The engine gives up on the made-up data: the fault screen, which keeps what it said.
  await page.waitForTimeout(1500);
  await page.keyboard.press('1');
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('System fault')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.actions button', { hasText: '[D] Report it' })).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: /Fallout 2$/ })).toBeVisible({ timeout: 30_000 });

  // From the manual's chapter on faults.
  await page.goto('#/manual/faults');
  await page.locator('.menu button', { hasText: 'Write a problem report' }).click();
  await expect(page.getByRole('heading', { name: 'Problem report' })).toBeVisible();
  const sheet = page.locator('.report-sheet');
  await expect(sheet).toContainText('Last fault');
  await expect(sheet).toContainText('Fallout 2 (fo2)');
  await expect(sheet).toContainText("Couldn't find/load text fonts");

  const url = await nextIssue(page, () => page.locator('.menu button', { hasText: 'Open as a GitHub issue' }).click());
  expect(url.searchParams.get('title')).toMatch(/^\[Fallout 2\] Fault: Fallout 2 stopped/);

  // Left out, the report is about the console again.
  await page.locator('.menu button', { hasText: 'Leave out the last fault' }).click();
  await expect(sheet).not.toContainText('Last fault');
  await expect(page.locator('.menu button', { hasText: 'Leave out the last fault' })).toHaveCount(0);
});
