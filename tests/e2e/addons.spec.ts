import type { Page } from '@playwright/test';
import { cassidyHeadFiles, fo2tweaksFiles, musicFiles, partyOrdersFiles, rpuFiles } from '../mods';
import { expect, test } from './fixtures';
import { fakeFallout1Folder, fakeFallout2Folder, openConsole, pickFolder, zipOf } from './helpers';

/**
 * Add-ons made up for the tests, laid out as the real ones are (see
 * tests/mods.ts): loaded from a deck, from the Mod library and through "Load
 * a mod", switched on for a game and for a mod, and handed to the engine
 * with them, which opens what the console put together and finds no game in
 * it. Playing the real ones needs them (see game.spec.ts).
 */

const loaded = (page: Page) => expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
const entry = (page: Page, label: string | RegExp) => page.locator('.menu li').filter({ hasText: label });

/** What the engine was handed: whether each path is there, and what a few files say. */
function engineFiles(page: Page, paths: string[], read: string[]) {
  return page.evaluate(
    ({ paths, read }) => {
      const { FS } = (window as unknown as { overseerEngine: { module: { FS: { analyzePath(path: string): { exists: boolean }; readFile(path: string): Uint8Array } } } }).overseerEngine.module;
      return {
        exists: Object.fromEntries(paths.map((path) => [path, FS.analyzePath(`/game/${path}`).exists])),
        text: Object.fromEntries(read.map((path) => [path, FS.analyzePath(`/game/${path}`).exists ? new TextDecoder().decode(FS.readFile(`/game/${path}`)) : null])),
      };
    },
    { paths, read },
  );
}

/** Starts what is on the screen, and waits for the engine to have its files. */
async function begin(page: Page, game: string): Promise<void> {
  await page.waitForTimeout(1500);
  await page.locator('.menu button', { hasText: 'Begin simulation' }).click();
  await page.waitForURL(new RegExp(`play\\.html\\?game=${game}`));
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
}

test('loads an add-on on a deck, lays it over the game, and starts the game with it', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder(true));
  await loaded(page);

  await expect(entry(page, 'Add-ons')).toContainText('NONE');
  await entry(page, 'Add-ons').locator('button').click();
  await expect(page.getByText('ADD-ONS OF FALLOUT 2')).toBeVisible();
  await page.locator('input[accept*=".dat"]').setInputFiles(await zipOf(fo2tweaksFiles(), 'fo2tweaks_v14.7.zip'));
  await loaded(page);
  await expect(page.getByRole('status')).toContainText('It adds fo2tweaks.dat to the load order of whatever it is laid over.');
  await expect(entry(page, 'Fo2tweaks 14.7')).toContainText('ON');

  // A second one, a single archive, over the first.
  await page.locator('input[accept*=".dat"]').setInputFiles({ name: 'cassidy_head.dat', mimeType: 'application/octet-stream', buffer: Buffer.from(await (cassidyHeadFiles()['cassidy_head.dat'] as Blob).arrayBuffer()) });
  await loaded(page);
  await expect(entry(page, 'Cassidy head')).toContainText('ON, 2 OF 2');
  await expect(entry(page, 'Fo2tweaks 14.7')).toContainText('ON, 1 OF 2');
  await page.keyboard.press('Escape');
  await expect(entry(page, 'Add-ons')).toContainText('2 ON');
  await expect(page.locator('.readout').first()).toContainText('FO2TWEAKS 14.7, CASSIDY HEAD');

  await begin(page, 'fo2');
  const game = await engineFiles(page, ['mods/fo2tweaks.dat', 'mods/fo2tweaks.ini', 'mods/cassidy_head.dat', 'ddraw.dll', 'master.dat'], ['mods/mods_order.txt']);
  expect(game.exists).toEqual({ 'mods/fo2tweaks.dat': true, 'mods/fo2tweaks.ini': true, 'mods/cassidy_head.dat': true, 'ddraw.dll': false, 'master.dat': true });
  // The later switched on, over the earlier.
  expect(game.text['mods/mods_order.txt']).toBe('fo2tweaks.dat\r\ncassidy_head.dat\r\n');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible({ timeout: 30_000 });

  // Switched off, the game starts without it, and its load order is the engine's to make again.
  await entry(page, 'Add-ons').locator('button').click();
  await entry(page, 'Fo2tweaks 14.7').locator('button').click();
  await entry(page, 'Cassidy head').locator('button').click();
  await expect(entry(page, 'Fo2tweaks 14.7')).toContainText('OFF');
  await page.keyboard.press('Escape');
  await expect(entry(page, 'Add-ons')).toContainText('NONE ON');
  await begin(page, 'fo2');
  const without = await engineFiles(page, ['mods/fo2tweaks.dat', 'mods/cassidy_head.dat'], ['mods/mods_order.txt']);
  expect(without.exists).toEqual({ 'mods/fo2tweaks.dat': false, 'mods/cassidy_head.dat': false });
  expect(without.text['mods/mods_order.txt']).toBeNull();
});

test('loads an add-on of Fallout in the Mod library, and lays its music over the game from its page', async ({ page }) => {
  await openConsole(page, 'fo1');
  await pickFolder(page, await fakeFallout1Folder());
  await loaded(page);

  await page.goto('#/mods');
  await entry(page, 'Load an add-on').locator('button').click();
  await expect(page.getByRole('heading', { name: 'Load an add-on' })).toBeVisible();
  await expect(entry(page, /\[1\]\s*For/)).toContainText('FALLOUT 2');
  await page.keyboard.press('ArrowRight');
  await expect(entry(page, /\[1\]\s*For/)).toContainText('FALLOUT');
  await expect(entry(page, /\[1\]\s*For/)).not.toContainText('FALLOUT 2');
  await page.locator('input[accept*=".dat"]').setInputFiles(await zipOf(musicFiles(), 'fallout_1_2_lq_ebur128_music_v2.zip'));
  await expect(page.getByRole('heading', { name: 'Fallout 1 2 lq ebur128 music 2' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);
  const readout = page.locator('.readout').first();
  await expect(readout).toContainText('FALLOUT, DECK A');
  await expect(readout).toContainText('3 MUSIC TRACKS');
  await expect(readout).toContainText('NOTHING YET');

  await entry(page, /\[1\]\s*Fallout/).locator('button').click();
  await expect(entry(page, /\[1\]\s*Fallout/)).toContainText('ON');
  await expect(readout.locator('dd').last()).toHaveText('FALLOUT');
  await page.goto('#/mods');
  await expect(entry(page, 'Fallout 1 2 lq ebur128 music 2')).toContainText('ON FALLOUT');

  await page.goto('#/fo1');
  await expect(entry(page, 'Add-ons')).toContainText('1 ON');
  await begin(page, 'fo1');
  // The engine finds files whatever the case of their names: the add-on's track is told from the game's by its size.
  const sizes = await page.evaluate(() => {
    const { FS } = (window as unknown as { overseerEngine: { module: { FS: { readdir(path: string): string[]; stat(path: string): { size: number } } } } }).overseerEngine.module;
    return Object.fromEntries(FS.readdir('/game/DATA/SOUND/MUSIC').filter((name) => !name.startsWith('.')).map((name) => [name, FS.stat(`/game/DATA/SOUND/MUSIC/${name}`).size]));
  });
  expect(sizes).toEqual({ '01hub.acm': 120 << 10, '02mstrlr.acm': 110 << 10, 'wind1.acm': 30 << 10 });
});

test('takes an add-on handed to "Load a mod" for one, lays it over a mod, and ejects it', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder(true));
  await loaded(page);
  await page.goto('#/mods/load');
  await page.locator('input[accept*="zip"]').setInputFiles(await zipOf(rpuFiles(), 'rpu_v2.4.34.zip'));
  await expect(page.getByRole('heading', { name: 'Restoration Project' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);

  await page.goto('#/mods/load');
  await page.locator('input[accept*="zip"]').setInputFiles(await zipOf(partyOrdersFiles(), 'party_orders_v1.17.zip'));
  await expect(page.getByRole('heading', { name: 'Party orders 1.17' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);
  await expect(page.locator('.readout').first()).toContainText('FALLOUT 2, DECK B');
  await entry(page, 'Restoration Project').locator('button').click();
  await expect(entry(page, 'Restoration Project')).toContainText('ON');
  await expect(entry(page, /\[1\]\s*Fallout 2/)).toContainText('OFF');

  await page.goto('#/mods/rpu');
  await expect(page.locator('.readout').first()).toContainText('PARTY ORDERS 1.17');
  await begin(page, 'rpu');
  const game = await engineFiles(page, ['mods/party_orders.dat', 'mods/party_orders_text', 'mods/party_orders_extra.dat', 'mods/rpu.dat'], ['mods/mods_order.txt', 'mods/party_orders.ini']);
  expect(game.exists).toEqual({ 'mods/party_orders.dat': true, 'mods/party_orders_text': true, 'mods/party_orders_extra.dat': true, 'mods/rpu.dat': true });
  // The mod's load order, its own copy of the add-on's archive moved up with the add-on, which is laid over it.
  expect(game.text['mods/mods_order.txt']).toBe('rpu.dat\r\nnpc_armor.dat\r\nrpu_czech.dat\r\nrpu_enhanced_worldmap.dat\r\nfo2tweaks.dat\r\nparty_orders.dat\r\nparty_orders_text\r\n');
  expect(game.text['mods/party_orders.ini']).toContain('Heal=33');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Restoration Project' })).toBeVisible({ timeout: 30_000 });

  // Ejected: gone from the library, and from what the mod is started with.
  await page.goto('#/mods');
  await entry(page, 'Party orders 1.17').locator('button').click();
  await entry(page, 'Holodisk').locator('button').click();
  await entry(page, 'Eject holodisk').locator('button').click();
  await page.keyboard.press('y');
  await expect(page.getByRole('heading', { name: 'Mod library' })).toBeVisible();
  await expect(entry(page, 'Party orders')).toHaveCount(0);
  await page.goto('#/mods/rpu');
  await expect(page.locator('.readout').first()).not.toContainText('PARTY ORDERS');
  await expect(entry(page, 'Add-ons')).toContainText('NONE');
});
