import type { Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { expect, test } from './fixtures';
import { fo2tweaksFiles } from '../mods';
import { fakeEttuZip, fakeFallout1Folder, fakeFallout2Folder, fakeSaveDat, openConsole, pickFolder, zipOf } from './helpers';

/**
 * How the console fills its tube, at the window sizes people really have:
 * a laptop's, a large monitor's, a window that is taller than wide. The
 * other tests all run at 1280 x 800, where everything has always fitted.
 */

/** What shows of a screen: whether it runs on below the tube, what is cut short, and where the cursor is. */
function fit(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.body')!;
    const bounds = body.getBoundingClientRect();
    const tube = document.querySelector('.tube')!.getBoundingClientRect();
    const within = (node: Element | null, box: DOMRect) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    };
    const note = document.querySelector('.menu-note');
    return {
      cell: parseFloat(getComputedStyle(body).fontSize),
      over: body.scrollHeight - body.clientHeight,
      cut: [...document.querySelectorAll<HTMLElement>('.menu .label')].filter((label) => label.scrollWidth > label.clientWidth + 1).map((label) => label.textContent),
      selected: within(document.querySelector('.menu li.selected button'), bounds),
      note: within(note, tube) ? (note!.textContent ?? '') : null,
      columns: getComputedStyle(document.querySelector('.columns')!).gridTemplateColumns.split(' ').length,
      housing: Math.round(document.querySelector('.housing')!.getBoundingClientRect().height),
      more: !!document.querySelector('.more'),
    };
  });
}

/**
 * Both games in their decks, Fallout Et Tu and an add-on laid over Fallout 2
 * in the Mod library, and three saves of Fallout 2, so that every screen has
 * what it shows when the console is in use.
 */
async function furnish(page: Page): Promise<void> {
  await openConsole(page, 'fo1');
  await pickFolder(page, await fakeFallout1Folder());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto('#/fo2');
  await pickFolder(page, await fakeFallout2Folder());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto('#/mods/load');
  await page.locator('input[accept*="zip"]').setInputFiles(fakeEttuZip({ forEngine: true }));
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto('#/mods/addons');
  await page.locator('input[accept*=".dat"]').setInputFiles(await zipOf(fo2tweaksFiles(), 'fo2tweaks_v14.7.zip'));
  await expect(page.getByRole('heading', { name: 'Fo2tweaks 14.7' })).toBeVisible({ timeout: 60_000 });
  await page.locator('.menu button', { hasText: 'Fallout 2' }).click();
  await page.goto('#/saves/fo2');
  const saves = zipSync({
    'SAVEGAME/SLOT01/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'before the temple')),
    'SAVEGAME/SLOT02/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'klamath, rats done')),
    'SAVEGAME/SLOT05/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'vault city courtyard')),
  });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(saves) });
  await expect(page.getByText('3 saves restored from the archive.')).toBeVisible();
  // The screens as they are on any later visit: not with what the copy just made had to say.
  await page.reload();
  await expect(page.locator('.menu li.selected')).toBeVisible();
}

const SCREENS = ['', 'fo2', 'mods', 'mods/ettu', 'mods/load', 'mods/addons', 'mods/addons/fo2tweaks', 'mods/install', 'mods/install/resurrection', 'mods/known', 'mods/known/olympus', 'mods/known/resurrection', 'mods/known/yesterday', 'saves/fo2', 'settings', 'settings/picture', 'settings/cloud', 'manual'];

test('holds the same page however large the window is: nothing runs off the tube, nothing is cut short', async ({ page }) => {
  await furnish(page);
  // A laptop at 125%, the tests' own size, a full HD monitor with the browser's bars, and one of 1440 lines.
  for (const [width, height] of [[1536, 730], [1280, 800], [1920, 950], [2560, 1300]] as const) {
    await page.setViewportSize({ width, height });
    for (const screen of SCREENS) {
      await page.goto(`#/${screen}`);
      await expect(page.locator('.menu li.selected')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const at = await fit(page);
      const where = `${screen || 'main'} at ${width} x ${height}`;
      expect(at.over, `${where}: runs off the tube`).toBeLessThanOrEqual(1);
      expect(at.cut, `${where}: cut short`).toEqual([]);
      expect(at.columns, `${where}: the board stands beside the list`).toBe(2);
      // What the entry under the cursor does is on the line under the screen.
      expect(at.note, where).toBeTruthy();
    }
  }
  // The window of 1440 lines shows the page of the smaller ones, in larger letters: not fewer lines of it.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('#/settings');
  const small = await fit(page);
  await page.setViewportSize({ width: 2560, height: 1300 });
  await expect.poll(async () => (await fit(page)).cell).toBeGreaterThan(small.cell);
});

test('a list longer than the tube follows the cursor, and says that it runs on', async ({ page }) => {
  await furnish(page);
  // A small laptop, less the browser's own bars.
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('#/settings');
  const more = page.locator('.more');
  await expect(more).toHaveText('-- MORE --');
  const top = await fit(page);
  expect(top.over).toBeGreaterThan(20);
  expect(top.selected).toBe(true);
  expect(top.note).toContain('Every game has its own picture');

  // To the far end with the keys: the list comes along, and so does what the entry does.
  await page.keyboard.press('End');
  await expect(page.locator('.menu li.selected')).toContainText('Back');
  await expect.poll(async () => (await fit(page)).selected).toBe(true);
  await expect(more).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.menu li.selected')).toContainText('Cloud link');
  const end = await fit(page);
  expect(end.selected).toBe(true);
  expect(end.note).toContain('Optional. Keep saves in your own Dropbox or Google Drive');

  // And back to the top, one entry at a time past the edge.
  await page.keyboard.press('Home');
  await expect.poll(async () => (await fit(page)).selected).toBe(true);
  await expect(more).toHaveText('-- MORE --');
  for (let entry = 0; entry < 13; entry++) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await fit(page)).selected, { message: `entry ${entry + 2}` }).toBe(true);
  }
  // An entry chosen by its key shows itself as well.
  await page.keyboard.press('Home');
  await page.keyboard.press('m');
  await expect(page.locator('.menu li.selected')).toContainText('Game data kept in memory');
  await expect.poll(async () => (await fit(page)).selected).toBe(true);
});

test('a window taller than wide puts the board under the list, and cuts nothing short', async ({ page }) => {
  await furnish(page);
  // A tablet held upright, a narrow window on a desktop, and a monitor turned on its side.
  for (const [width, height] of [[820, 1180], [800, 900], [1080, 1920]] as const) {
    await page.setViewportSize({ width, height });
    for (const screen of SCREENS) {
      await page.goto(`#/${screen}`);
      await expect(page.locator('.menu li.selected')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const at = await fit(page);
      const where = `${screen || 'main'} at ${width} x ${height}`;
      expect(at.cut, `${where}: cut short`).toEqual([]);
      expect(at.columns, `${where}: one column`).toBe(1);
      expect(at.note, where).toBeTruthy();
    }
  }
  // The monitor on its side gives the console its height: it is not left as low as on one lying down.
  expect((await fit(page)).housing).toBeGreaterThan(1400);
  await page.goto('#/settings');
  expect((await fit(page)).over).toBeLessThanOrEqual(1);
});

test.describe('on a phone held sideways', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('a save is described label beside value: the screen has the width for that', async ({ page }) => {
    await furnish(page);
    await page.locator('.menu button', { hasText: 'SLOT 02' }).tap();
    const readout = page.locator('.readout').first();
    await expect(readout).toContainText('klamath, rats done');
    // Seven facts on seven lines, not on fourteen.
    expect(await readout.evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(' ').length)).toBe(2);
    const label = (await readout.locator('dt').first().boundingBox())!;
    const value = (await readout.locator('dd').first().boundingBox())!;
    expect(Math.abs(label.y - value.y)).toBeLessThan(label.height / 2);
    // What "Load this save" does is said on the one line under the screen that a low window can spare.
    await expect(page.locator('.menu-note')).toBeVisible();
    await expect(page.locator('.menu-note')).toContainText('Starts the game and goes straight into this save.');
  });
});

test.describe('on a phone held upright', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('the housing is as tall as the screen', async ({ page }) => {
    await openConsole(page);
    await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
    expect((await fit(page)).housing).toBeGreaterThan(800);
    expect((await fit(page)).cut).toEqual([]);
  });
});
