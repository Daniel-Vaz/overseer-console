import type { Page } from '@playwright/test';
import { MOD_RELEASES } from '../../src/lib/mods/releases';
import { resurrectionFiles, rpuFiles } from '../mods';
import { expect, test } from './fixtures';
import { fakeFallout2Folder, openConsole, pickFolder, sizedZip, zipOf } from './helpers';

/**
 * Installing a known mod's release without a cloud that downloads it: the
 * player's browser downloads it from its makers' link, and the player hands
 * it over. Through Dropbox, see dropbox.spec.ts.
 */

const loaded = (page: Page) => expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
const entry = (page: Page, text: string) => page.locator('.menu li').filter({ hasText: text });

test('installs Resurrection from the release the player downloaded, once Fallout 2 is in its deck', async ({ page, context }) => {
  const release = MOD_RELEASES.resurrection!;
  await openConsole(page, 'mods');
  await entry(page, 'Install a known mod').locator('button').click();
  await expect(page.getByRole('heading', { name: 'Install a known mod' })).toBeVisible();
  for (const title of ['Fallout Et Tu', 'Restoration Project', 'Fallout: Sonora', 'Olympus 2207', 'Fallout 1.5: Resurrection']) {
    await expect(entry(page, title)).toBeVisible();
  }
  await expect(entry(page, 'Megamod')).toHaveCount(0);
  await expect(entry(page, 'Resurrection')).toContainText('1.5, 341.5 MB');

  await entry(page, 'Resurrection').locator('button').click();
  await expect(page.getByRole('heading', { name: 'Install Fallout 1.5: Resurrection' })).toBeVisible();
  await expect(page.locator('.readout')).toContainText('FoRes_EN_1_5.zip, 341.5 MB');
  await expect(page.locator('.readout')).toContainText('FALLOUT 2, DECK B: NOT LOADED');
  // Not without the game it is played on.
  await expect(entry(page, 'Install the download')).toContainText('NEEDS DECK B');
  await expect(entry(page, 'Install the download').locator('button')).toBeDisabled();

  await page.goto('#/fo2');
  await pickFolder(page, await fakeFallout2Folder(true));
  await loaded(page);
  await page.goto('#/mods/install/resurrection');

  // Its makers' own link, in a tab of its own.
  await context.route(/^https:\/\/bitbucket\.org\//, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'a download' }));
  const opened = context.waitForEvent('page');
  await entry(page, 'Download version 1.5').locator('button').click();
  expect((await opened).url()).toBe(release.url);

  // Picked where the browser keeps downloads, where it has a picker that can start there (here a stand-in for one).
  await page.evaluate(() => {
    const host = window as unknown as { showOpenFilePicker: (options: unknown) => Promise<unknown[]>; asked: unknown };
    host.showOpenFilePicker = async (options) => {
      host.asked = options;
      return [{ getFile: async () => new File(['not a zip'], 'FoRes_EN_1_5.zip') }];
    };
  });
  await entry(page, 'Install the download').locator('button').click();
  await expect(page.getByText('THAT IS NOT FORES_EN_1_5.ZIP OF VERSION 1.5')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { asked: { startIn: string } }).asked.startIn)).toBe('downloads');
  await page.keyboard.press('Escape');

  // Something else handed over is asked about, not taken for the release.
  await page.locator('input[accept*="zip"]').setInputFiles(await zipOf(resurrectionFiles(), 'FoRes_EN_1_5.zip'));
  await expect(page.getByText('THAT IS NOT FORES_EN_1_5.ZIP OF VERSION 1.5')).toBeVisible();
  await expect(page.getByText('another version, or a download that did not finish')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('THAT IS NOT FORES_EN_1_5.ZIP')).toHaveCount(0);

  // The release itself.
  const zip = await sizedZip(resurrectionFiles(), release.file, release.bytes);
  await page.locator('input[accept*="zip"]').setInputFiles(zip.path);
  await loaded(page);
  await expect(page).toHaveURL(/#\/mods\/install\/resurrection$/);
  await entry(page, 'Open Fallout 1.5: Resurrection').locator('button').click();
  await expect(page.getByRole('heading', { name: 'Fallout 1.5: Resurrection' })).toBeVisible();
  await expect(page.locator('.readout').first()).toContainText('1.5');

  // Loaded at the version the console installs: nothing to update, the release offered again under Holodisk.
  await expect(entry(page, 'Update to')).toHaveCount(0);
  await entry(page, 'Holodisk').locator('button').click();
  await expect(entry(page, 'Install again, version 1.5')).toBeVisible();
});

test('offers the release as an update to a mod loaded at an older version', async ({ page }) => {
  // An older Restoration Project, by the name of its zip.
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder(true));
  await loaded(page);
  await page.goto('#/mods/load');
  await page.locator('input[accept*="zip"]').setInputFiles(await zipOf(rpuFiles(), 'rpu_v2.4.30.zip'));
  await expect(page.getByRole('heading', { name: 'Restoration Project' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);
  await expect(page.locator('.readout').first()).toContainText(`2.4.30, ${MOD_RELEASES.rpu!.version} IS OUT`);
  await entry(page, `Update to version ${MOD_RELEASES.rpu!.version}`).locator('button').click();
  await expect(page.getByRole('heading', { name: 'Install Restoration Project' })).toBeVisible();
  await expect(page.locator('.readout')).toContainText('VERSION 2.4.30, OLDER');
  await expect(entry(page, 'Update from the download')).toBeVisible();
  await page.goto('#/mods/install');
  await expect(entry(page, 'Restoration Project')).toContainText(`UPDATE TO ${MOD_RELEASES.rpu!.version}`);
});
