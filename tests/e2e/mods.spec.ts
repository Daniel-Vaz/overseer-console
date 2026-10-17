import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { pattern, rpuFiles } from '../mods';
import { expect, test } from './fixtures';
import { fakeFallout2Folder, openConsole, pickFolder, writeFolder, zipOf } from './helpers';

/**
 * Mods other than Fallout Et Tu, made up for the tests and laid out as the
 * real ones are (see tests/mods.ts). As far as made-up data goes: loaded,
 * laid over the game in the deck, and handed to the engine, which opens what
 * the console put together and finds no game in it. Playing the real mods
 * needs them (see game.spec.ts).
 */

const loaded = (page: Page) => expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });

/** What the engine was handed: whether each path is there, and what a few files say. */
function engineFiles(page: Page, paths: string[], read: string[]) {
  return page.evaluate(
    ({ paths, read }) => {
      const { FS } = (window as unknown as { overseerEngine: { module: { FS: { analyzePath(path: string): { exists: boolean }; readFile(path: string): Uint8Array } } } }).overseerEngine.module;
      return {
        exists: Object.fromEntries(paths.map((path) => [path, FS.analyzePath(`/game/${path}`).exists])),
        text: Object.fromEntries(read.map((path) => [path, new TextDecoder().decode(FS.readFile(`/game/${path}`))])),
      };
    },
    { paths, read },
  );
}

test('loads the Restoration Project from its zip, and starts it as its installer leaves Fallout 2', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder(true));
  await loaded(page);

  await page.goto('#/mods/load');
  await page.locator('input[accept*="zip"]').setInputFiles(await zipOf(rpuFiles(), 'rpu_v2.4.34.zip'));
  await expect(page.getByRole('heading', { name: 'Restoration Project' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);
  const status = page.getByRole('status');
  await expect(status).toContainText('4 files only a desktop needs (programs, installers) were left out.');
  await expect(status).toContainText('Left out: its Hero Appearance art');
  const readout = page.locator('.readout').first();
  await expect(readout).toContainText('FALLOUT 2, DECK B: LOADED');
  await expect(readout).toContainText('2.4.34');
  await expect(readout).toContainText('TESTED HERE');

  // Its installer's options: what its load order switches on, and the one it leaves off.
  const components = page.locator('.menu li').filter({ hasText: 'Components' });
  await expect(components).toContainText('4 OF 5 ON');
  await components.locator('button').click();
  await expect(page.getByText('COMPONENTS OF RESTORATION PROJECT')).toBeVisible();
  const map = page.locator('.menu li').filter({ hasText: 'A more detailed world map' });
  await expect(map).toContainText('ON');
  await expect(page.locator('.menu li').filter({ hasText: 'Other explosions' })).toContainText('OFF');
  await map.locator('button').click();
  await expect(map).toContainText('OFF');
  await page.locator('.menu li').filter({ hasText: 'Other explosions' }).locator('button').click();
  await page.keyboard.press('Escape');
  await expect(components).toContainText('4 OF 5 ON, CHANGED');

  // Started: Fallout 2's archives, the mod's own files, not the patch and data files its installer moves aside.
  await page.waitForTimeout(1500);
  await page.locator('.menu button', { hasText: 'Begin simulation' }).click();
  await page.waitForURL(/play\.html\?game=rpu$/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#bar-title')).toHaveText('OVERSEER CONSOLE // SIMULATION 02 // RPU');
  const game = await engineFiles(
    page,
    ['master.dat', 'critter.dat', 'patch000.dat', 'data/worldmap.dat', 'mods/rpu.dat', 'data/scripts/gl_ammomod.int', 'data/sound/music/01hub.acm', 'sound/music/01hub.acm', 'ddraw.dll', 'appearance'],
    ['fallout2.cfg', 'mods/mods_order.txt', 'mods/sfall-mods.ini'],
  );
  expect(game.exists).toEqual({
    'master.dat': true,
    'critter.dat': true,
    'patch000.dat': false,
    'data/worldmap.dat': false,
    'mods/rpu.dat': true,
    'data/scripts/gl_ammomod.int': true,
    'data/sound/music/01hub.acm': true,
    'sound/music/01hub.acm': true,
    'ddraw.dll': false,
    appearance: false,
  });
  expect(game.text['fallout2.cfg']).toContain('f2_res_dat=mods\\f2_res.dat');
  expect(game.text['fallout2.cfg']).toContain('music_path1=data\\sound\\music\\');
  expect(game.text['fallout2.cfg']).toContain('music_path2=sound\\music\\');
  // The load order as the player left it, the part switched off passed over by the engine.
  expect(game.text['mods/mods_order.txt']).toContain(';rpu_enhanced_worldmap.dat');
  expect(game.text['mods/mods_order.txt']).toContain('\r\nrpu_alternative_explosions.dat\r\n');
  expect(game.text['mods/sfall-mods.ini']).toContain('[Highlighting]\r\nKey=42\r\n');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Restoration Project' })).toBeVisible();

  // The load order as it came, back with one key.
  await components.locator('button').click();
  await page.keyboard.press('r');
  await expect(map).toContainText('ON');
  await page.keyboard.press('Escape');
  await expect(components).toContainText('4 OF 5 ON');
  await expect(components).not.toContainText('CHANGED');
});

test('loads a game folder a mod was installed in, and stores only what differs from the game in the deck', async ({ page }) => {
  const game = await fakeFallout2Folder(true);
  await openConsole(page, 'fo2');
  await pickFolder(page, game);
  await loaded(page);

  // As a desktop has it once a mod's installer ran: the game's archives as they were, its patch archive moved aside.
  const files: Record<string, Uint8Array | string> = {
    'master.dat': new Uint8Array(readFileSync(join(game, 'master.dat'))),
    'critter.dat': new Uint8Array(readFileSync(join(game, 'critter.dat'))),
    'sound/music/01hub.acm': new Uint8Array(readFileSync(join(game, 'sound', 'music', '01hub.acm'))),
    'backup/patch000.dat': new Uint8Array(readFileSync(join(game, 'patch000.dat'))),
    'fallout2.cfg': '[system]\r\nlanguage=english\r\n[preferences]\r\ncombat_speed=75\r\n',
    'mods/mods_order.txt': 'my_mod\r\n',
    'mods/my_mod/text/english/game/perk.msg': '{101}{}{Something Else}',
    'fallout2.exe': 'not a program',
  };
  for (let i = 0; i < 20; i++) files[`data/scripts/script${i}.int`] = pattern(400 + i, i);
  await page.goto('#/mods/load');
  await pickFolder(page, await writeFolder(files, 'Better Fallout 2'));
  await expect(page.getByRole('heading', { name: 'Better Fallout 2' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);
  const status = page.getByRole('status');
  await expect(status).toContainText('the same as your Fallout 2 in deck B are not stored again.');
  await expect(status).toContainText('The console does not know this mod by name');
  await expect(page.locator('.readout').first()).toContainText('NOT TESTED');
  await page.goto('#/mods');
  await expect(page.locator('.menu li').filter({ hasText: 'Better Fallout 2' })).toContainText('READY');
  await page.locator('.menu button', { hasText: 'Better Fallout 2' }).click();

  await page.waitForTimeout(1500);
  await page.locator('.menu button', { hasText: 'Begin simulation' }).click();
  await page.waitForURL(/play\.html\?game=better-fallout-2$/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  const started = await engineFiles(page, ['master.dat', 'critter.dat', 'patch000.dat', 'backup', 'mod-data.dat', 'mods/my_mod', 'data/scripts'], ['fallout2.cfg']);
  expect(started.exists).toEqual({ 'master.dat': true, 'critter.dat': true, 'patch000.dat': false, backup: false, 'mod-data.dat': true, 'mods/my_mod': true, 'data/scripts': false });
  expect(started.text['fallout2.cfg']).toContain('critter_patches=mod-data.dat');
  expect(started.text['fallout2.cfg']).toContain('combat_speed=75');
});

test('says what to hand it instead of an installer, or of an archive it cannot open', async ({ page }) => {
  await openConsole(page, 'mods/load');
  const zip = page.locator('input[accept*="zip"]');
  await zip.setInputFiles({ name: 'rpu_v2.4.34.exe', mimeType: 'application/octet-stream', buffer: Buffer.alloc(5 << 20, 1) });
  await expect(page.getByRole('alert')).toContainText('That is a Windows installer: the console cannot run it. The rpu zip from its releases page');
  await zip.setInputFiles({ name: 'megamod.7z', mimeType: 'application/octet-stream', buffer: Buffer.from('7z') });
  await expect(page.getByRole('alert')).toContainText('megamod.7z: the console opens zip archives only.');
  // A mod needs the game it is played on in its deck: only what differs from it is stored.
  await zip.setInputFiles(await zipOf(rpuFiles(), 'rpu_v2.4.34.zip'));
  await expect(page.getByRole('alert')).toContainText('Restoration Project is played on Fallout 2: load Fallout 2 into deck B first.');
});
