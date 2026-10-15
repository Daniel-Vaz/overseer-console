import { expect, test } from './fixtures';
import { zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { fakeFallout1Folder, fakeFallout2Folder, fakeFallout2WithPlaces, fakeSaveDat, junkFolder, openConsole, pickFolder } from './helpers';

test('plays the power-on sequence once, then shows the main directory', async ({ page }) => {
  await page.goto('');
  await expect(page.getByText('POWER-ON SELF TEST')).toBeVisible();
  await expect(page.getByText('PRIVATE STORAGE')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  await expect(page.locator('.menu button')).toHaveCount(7);

  // Not again in the same session.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  await expect(page.getByText('POWER-ON SELF TEST')).toHaveCount(0);
});

test('wears its mark on the main directory, and every icon it names is there', async ({ page }) => {
  await openConsole(page);
  const mark = page.getByRole('img', { name: 'Overseer Console' });
  await expect(mark).toBeVisible();
  await expect.poll(() => mark.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBeGreaterThan(0);

  // The tab icon, the home screen icon and the icons of the installed app.
  const named = await page.evaluate(async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((link) => link.href);
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href;
    const icons = ((await (await fetch(manifest)).json()) as { icons: { src: string }[] }).icons;
    return [...links, ...icons.map((icon) => new URL(icon.src, manifest).href)];
  });
  expect(named.length).toBeGreaterThanOrEqual(6);
  for (const url of named) {
    const response = await page.request.get(url);
    expect(response.ok(), url).toBe(true);
    expect(response.headers()['content-type'], url).toMatch(/^image\//);
  }
});

test('the status board has a picture for every entry, and each one loads', async ({ page }) => {
  await openConsole(page);
  const glyph = page.locator('.board .glyph');
  const pictures = new Set<string>();
  const walk = async () => {
    const entries = await page.locator('.menu button').count();
    await page.keyboard.press('Home');
    for (let entry = 0; entry < entries; entry++) {
      await expect(glyph).toBeVisible();
      pictures.add(await glyph.evaluate((node) => getComputedStyle(node).getPropertyValue('--glyph')));
      await page.keyboard.press('ArrowDown');
    }
  };

  await walk();
  // A deck without its holodisk is drawn in the colour of its "NO HOLODISK".
  await page.keyboard.press('Home');
  await expect(page.locator('.menu li').first()).toContainText('NO HOLODISK');
  await expect(glyph).toHaveClass(/amber/);
  await page.keyboard.press('5');
  await expect(page.getByRole('heading', { name: 'Terminal settings' })).toBeVisible();
  await walk();

  // Seven entries on the main directory; ten more on the settings, where the two sounds share one.
  expect(pictures.size).toBeGreaterThanOrEqual(17);
  for (const picture of pictures) {
    const url = new URL(/url\(["']?(.+?)["']?\)/.exec(picture)![1]!, page.url()).href;
    const response = await page.request.get(url);
    expect(response.ok(), url).toBe(true);
    expect(response.headers()['content-type'], url).toBe('image/png');
  }
});

test('any key skips the power-on sequence', async ({ page }) => {
  await page.goto('');
  await expect(page.getByText('POWER-ON SELF TEST')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
});

test('is fully usable from the keyboard and remembers settings', async ({ page }) => {
  await openConsole(page);
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu li.selected')).toContainText('Save archives');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Save archives' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();

  await page.keyboard.press('5');
  await expect(page.getByRole('heading', { name: 'Terminal settings' })).toBeVisible();
  // The settings stand under what they belong to, and their keys run on in order.
  await expect(page.locator('.menu .group')).toContainText(['The games', 'This console']);
  expect(await page.locator('.menu .key').allInnerTexts()).toEqual(['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[A]', '[8]', '[9]', '[V]', '[M]', '[L]', '[D]', '[0]']);

  // A setting steps on with ENTER and the right arrow, and back with the left one.
  const scaling = page.locator('.menu li').filter({ hasText: 'Scaling' });
  await page.keyboard.press('ArrowDown');
  await expect(scaling).toContainText('FILL WINDOW');
  await page.keyboard.press('ArrowLeft');
  await expect(scaling).toContainText('SMOOTH');
  await page.keyboard.press('ArrowRight');
  await expect(scaling).toContainText('FILL WINDOW');
  await page.keyboard.press('Enter');
  await expect(scaling).toContainText('WHOLE PIXELS');

  await page.reload();
  await expect(page.locator('.menu li').filter({ hasText: 'Scaling' })).toContainText('WHOLE PIXELS');
});

test('a game starts at the picture it was made for, until the player chooses another', async ({ page }) => {
  await openConsole(page, 'settings');
  await expect(page.locator('.menu li').filter({ hasText: 'Picture' })).toContainText('CLASSIC / CLASSIC / HIGH');
  await page.keyboard.press('1');
  const decks = page.locator('.menu li');
  await expect(decks.nth(0)).toContainText('CLASSIC 4:3');
  await expect(decks.nth(1)).toContainText('CLASSIC 4:3');
  await expect(decks.nth(2)).toContainText('HIGH RESOLUTION');

  // The original picture is there for Et Tu too, and stays chosen.
  await page.keyboard.press('3');
  await expect(decks.nth(2)).toContainText('CLASSIC 4:3');
  await page.reload();
  await expect(decks.nth(2)).toContainText('CLASSIC 4:3');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu li').filter({ hasText: 'Picture' })).toContainText('CLASSIC 4:3');
});

test('every game has a picture of its own', async ({ page }) => {
  // A player who had chosen one picture for all games, before each had its own, keeps it for each.
  await openConsole(page, 'settings', { display: 'wide' });
  const summary = page.locator('.menu li').filter({ hasText: 'Picture' });
  await expect(summary).toContainText('WIDE');
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Picture' })).toBeVisible();
  await expect(page.getByText('OVERSEER CONSOLE // PICTURE')).toBeVisible();

  const decks = page.locator('.menu li');
  await expect(decks).toContainText(['Deck A: Fallout', 'Deck B: Fallout 2', 'Deck C: Fallout Et Tu', 'Back']);
  await page.keyboard.press('3');
  await expect(decks.nth(2)).toContainText('HIGH RESOLUTION');
  await expect(page.locator('.menu-note')).toContainText('The picture Fallout Et Tu was laid out for.');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(decks.nth(0)).toContainText('CLASSIC 4:3');
  // The others are as they were.
  await expect(decks.nth(1)).toContainText('WIDE');

  await page.reload();
  await expect(decks.nth(0)).toContainText('CLASSIC 4:3');
  await expect(decks.nth(1)).toContainText('WIDE');
  await expect(decks.nth(2)).toContainText('HIGH RESOLUTION');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Terminal settings' })).toBeVisible();
  await expect(summary).toContainText('CLASSIC / WIDE / HIGH');

  // A deck has the same choice for its own game, and the game is started at it.
  await page.goto('#/fo2');
  await pickFolder(page, await fakeFallout2Folder());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  const entry = page.locator('.menu li').filter({ hasText: 'Picture' });
  await expect(entry).toContainText('WIDE');
  await page.keyboard.press('3');
  await expect(entry).toContainText('HIGH RESOLUTION');
  await page.keyboard.press('3');
  await expect(entry).toContainText('CLASSIC 4:3');
  // The cursor is on the entry: the left arrow steps it back.
  await page.keyboard.press('ArrowLeft');
  await expect(entry).toContainText('HIGH RESOLUTION');
  await page.waitForTimeout(1500);
  await page.keyboard.press('1');
  await page.waitForURL(/play\.html/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  const size = await page.evaluate(() => {
    const engine = (window as unknown as { overseerEngine: { screen: { width: number; height: number } } }).overseerEngine;
    return engine.screen;
  });
  // Half as tall again as the original, and as wide as the window's shape allows.
  expect(size).toEqual({ width: 1152, height: 720 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('overseer-console:settings')!).picture)).toEqual({ fo1: 'classic', fo2: 'high', ettu: 'high' });
});

test('the switches on the housing turn the tube effects and sounds off', async ({ page }) => {
  await openConsole(page);
  const crt = page.getByRole('button', { name: 'CRT effects' });
  await expect(crt).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.housing')).toHaveClass(/crt-on/);
  await crt.click();
  await expect(crt).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.housing')).toHaveClass(/crt-off/);
});

test('explains how to load a game when none is installed', async ({ page }) => {
  await openConsole(page, 'fo2');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
  await expect(page.getByText('NOT LOADED')).toBeVisible();
  await expect(page.getByText('Nothing is uploaded')).toBeVisible();
  await expect(page.locator('.menu button').first()).toContainText('Load holodisk');
  // The entries are numbered as they stand, with no letter among them that could pass for a digit.
  expect(await page.locator('.menu .key').allInnerTexts()).toEqual(['[1]', '[2]', '[3]', '[4]', '[5]', '[0]']);

  await page.keyboard.press('5');
  await expect(page.getByText('Fallout 2 is sold by')).toBeVisible();
  await expect(page.locator('.menu button')).toContainText(['GOG', 'Steam', 'Epic Games', 'Back']);
  // ESC closes that list first, and only then leaves the deck.
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu button').first()).toContainText('Load holodisk');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
});

test('rejects a folder that is not a game and says why', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, junkFolder());
  await expect(page.getByText('HOLODISK REJECTED')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('MASTER.DAT');
  // Still offers to try again.
  await expect(page.locator('.menu button').first()).toContainText('Load holodisk');
});

test('imports a game folder into browser storage, and ejects it again', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder());

  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  // master.dat, critter.dat, patch000.dat, one music file, one data file; no exe, no manual.
  await expect(page.getByRole('status')).toContainText('5 files');
  await expect(page.locator('.menu button').first()).toContainText('Begin simulation');

  // The files really are in the origin private file system.
  const stored = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const game = await (await (await root.getDirectoryHandle('overseer-console')).getDirectoryHandle('games')).getDirectoryHandle('fo2');
    const current = JSON.parse(await (await (await game.getFileHandle('current.json')).getFile()).text());
    const install = await game.getDirectoryHandle(current.install);
    const manifest = JSON.parse(await (await (await install.getFileHandle('manifest.json')).getFile()).text());
    const master = manifest.files.find((f: { path: string }) => f.path === 'master.dat');
    const blob = await (await install.getFileHandle(master.blob)).getFile();
    return { files: manifest.files.map((f: { path: string }) => f.path).sort(), masterBytes: blob.size, packed: manifest.files.filter((f: { pack?: unknown }) => f.pack).length };
  });
  expect(stored.files).toEqual(['critter.dat', 'data/worldmap.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm']);
  expect(stored.masterBytes).toBe(3 << 20);
  expect(stored.packed).toBe(4);

  await page.keyboard.press('0');
  await expect(page.locator('.menu li').nth(1)).toContainText('READY');

  await page.keyboard.press('2');
  await expect(page.locator('.menu button').first()).toContainText('Begin simulation');
  // What is done to the game data itself (loading it again, taking it out) is one entry, not four beside the one that plays.
  await expect(page.locator('.menu button')).toContainText(['Begin simulation', 'Save archives', 'Picture', 'Holodisk', 'Back']);
  await page.keyboard.press('4');
  await expect(page.locator('.menu button')).toContainText(['Replace holodisk: select the game folder', 'Replace holodisk: select a zip of the game folder', 'Eject holodisk', 'Back']);
  await page.keyboard.press('e');
  await expect(page.getByText('EJECT THE FALLOUT 2 HOLODISK?')).toBeVisible();
  // What cannot be taken back is asked under a caution sign, and ENTER lands on leaving things as they are.
  await expect(page.locator('.signed .glyph.amber')).toBeVisible();
  await expect(page.locator('.menu li.selected')).toContainText('No, keep it');
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu button').first()).toContainText('Replace holodisk');
  await page.keyboard.press('e');
  await page.keyboard.press('y');
  await expect(page.getByText('NOT LOADED')).toBeVisible();
});

test('restores, exports and erases saved games', async ({ page }) => {
  await openConsole(page, 'saves/fo2');
  await expect(page.getByText('NO SAVED GAMES YET')).toBeVisible();

  const archive = zipSync({
    'SAVEGAME/SLOT03/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'before the temple')),
    'SAVEGAME/SLOT03/ARTEMPLE.SAV': new Uint8Array([1, 2, 3]),
  });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();

  const slot = page.locator('.menu li').first();
  await expect(slot).toContainText('SLOT 03');
  await expect(slot).toContainText('before the temple');
  await expect(slot).toContainText('Narg');
  // A slot is opened by its own number.
  await expect(slot.locator('.key')).toHaveText('[3]');

  await page.keyboard.press('3');
  await expect(page.locator('.readout')).toContainText('25 JUL 2241, 0824 hours');
  await expect(page.locator('.readout')).toContainText('ARTEMPLE');
  // When it was saved is written the way the games write their own dates.
  await expect(page.locator('.readout')).toContainText(/\d\d [A-Z]{3} \d{4}, \d\d:\d\d \(JUST NOW\)/);

  const download = page.waitForEvent('download');
  await page.keyboard.press('e');
  expect((await download).suggestedFilename()).toMatch(/^overseer-fo2-slot03-.*\.zip$/);

  // Erasing asks first, and ENTER lands on keeping the save.
  await page.keyboard.press('d');
  await expect(page.getByText('ERASE SLOT 03')).toBeVisible();
  await expect(page.locator('.menu li.selected')).toContainText('No, keep it');
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu li').first()).toContainText('Load this save');
  await page.keyboard.press('d');
  await expect(page.getByText('It is kept for a week under Erased saves and can be put back from there.')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('SLOT 03 erased.')).toBeVisible();
  await expect(page.getByText('NO SAVED GAMES YET')).toBeVisible();

  // Erased is not gone: for a week the save can be put back as it was.
  const erased = page.locator('.menu li').filter({ hasText: 'Erased saves' });
  await expect(erased).toContainText('1 KEPT');
  await page.keyboard.press('r');
  await expect(page.getByText('ERASED SAVES', { exact: true })).toBeVisible();
  await expect(page.locator('.menu li').first()).toContainText('SLOT 03');
  await expect(page.locator('.menu li').first()).toContainText('ERASED JUST NOW');
  await expect(page.locator('.menu-note')).toContainText('Kept until');
  // ESC leaves that list without touching anything.
  await page.keyboard.press('Escape');
  await expect(erased).toContainText('1 KEPT');
  await page.keyboard.press('r');
  await page.keyboard.press('3');
  await expect(page.getByText('SLOT 03 put back.')).toBeVisible();
  await expect(slot).toContainText('SLOT 03');
  await expect(slot).toContainText('before the temple');
  await expect(page.locator('.menu li').filter({ hasText: 'Erased saves' })).toHaveCount(0);
  await page.keyboard.press('3');
  await expect(page.locator('.readout')).toContainText('in 2 files');
});

test('says when saves were last exported, and asks for it while they never were', async ({ page }) => {
  await openConsole(page, 'saves/fo2');
  const archive = zipSync({ 'SAVEGAME/SLOT03/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'before the temple')) });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();
  await expect(page.getByText('LAST EXPORTED: NEVER')).toBeVisible();
  await expect(page.getByText("These saves are only in this browser's storage")).toBeVisible();

  // The main directory says so too, in amber.
  await page.goto('#/');
  const archives = page.locator('.menu li').filter({ hasText: 'Save archives' });
  await expect(archives).toContainText('1 SAVE, NEVER EXPORTED');
  await expect(page.locator('.board .readout')).toContainText('NEVER');
  await page.keyboard.press('4');
  await expect(page.locator('.menu li').filter({ hasText: 'Fallout 2' })).toContainText('1 SAVE, NEVER EXPORTED');

  // Exporting one save is not a backup of them all; exporting all of them is.
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  let download = page.waitForEvent('download');
  await page.keyboard.press('e');
  await download;
  await page.keyboard.press('Escape');
  await expect(page.getByText('LAST EXPORTED: NEVER')).toBeVisible();
  download = page.waitForEvent('download');
  await page.keyboard.press('x');
  expect((await download).suggestedFilename()).toMatch(/^overseer-fo2-saves-.*\.zip$/);
  await expect(page.getByText('LAST EXPORTED JUST NOW, TO A ZIP FILE.')).toBeVisible();

  await page.goto('#/');
  await expect(archives).toContainText('1 SAVE');
  await expect(archives).not.toContainText('NEVER');
  await expect(page.locator('.board .readout')).toContainText('JUST NOW');
});

test('keeps what a slot held before it was replaced, and rolls back to it', async ({ page }) => {
  await openConsole(page, 'saves/fo2');
  const restore = async (description: string) => {
    const archive = zipSync({
      'SAVEGAME/SLOT03/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', description)),
      'SAVEGAME/SLOT03/ARTEMPLE.SAV': new Uint8Array([1, 2, 3]),
    });
    await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  };

  await restore('before the temple');
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();
  await restore('stuck in the temple');
  await expect(page.getByText('SLOT 03 ALREADY HOLDS A SAVE')).toBeVisible();
  await page.keyboard.press('y');

  const slot = page.locator('.menu li').first();
  await expect(slot).toContainText('stuck in the temple');
  await expect(page.locator('.menu-note')).toContainText('1 earlier version kept.');

  // Open the slot, look at its history, go back to the first save.
  await page.keyboard.press('3');
  await expect(page.locator('.menu li').filter({ hasText: 'Earlier versions' })).toContainText('1 KEPT');
  await page.keyboard.press('v');
  await expect(page.getByText('SLOT 03: EARLIER VERSIONS')).toBeVisible();
  await expect(page.locator('.menu li').first()).toContainText('before the temple');
  await expect(page.locator('.menu-note')).toContainText('Replaced when an archive was restored over the slot');
  await page.keyboard.press('1');
  await expect(page.getByText(/^ROLL SLOT 03 BACK TO THE SAVE OF /)).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText(/^SLOT 03 rolled back to the save of /)).toBeVisible();
  await expect(page.locator('.readout')).toContainText('before the temple');

  // Rolling back is itself undoable: the replaced save is now the history.
  await page.keyboard.press('v');
  await expect(page.locator('.menu li').first()).toContainText('stuck in the temple');
  await expect(page.locator('.menu-note')).toContainText('Replaced when the slot was rolled back');

  // ESC closes one view at a time.
  await page.keyboard.press('Escape');
  await expect(page.locator('.readout')).toContainText('before the temple');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu li').first()).toContainText('SLOT 03');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Saved games are kept in this browser.')).toBeVisible();
});

test('refuses an archive without saved games', async ({ page }) => {
  await openConsole(page, 'saves/fo1');
  const archive = zipSync({ 'notes.txt': new Uint8Array([104, 105]) });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByText('No saved games in that archive')).toBeVisible();
});

test('the player sends you back to the console when there is nothing to play', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('overseer-console:booted', '1'));
  await page.goto('play.html');
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();

  await page.goto('play.html?game=fo1');
  await expect(page.getByRole('heading', { name: 'SIMULATION 01: Fallout' })).toBeVisible();
  await expect(page.getByText('NOT LOADED')).toBeVisible();
});

test('the player boots an engine against stored data, and a second tab is refused', async ({ page, context }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('1');
  await page.waitForURL(/play\.html/);

  // Engine downloaded and instantiated, stored files mounted, waiting for a key.
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('SIMULATION 02 ready')).toBeVisible();
  const mounted = await page.evaluate(() => {
    const engine = (window as unknown as { overseerEngine: { module: { FS: { analyzePath(path: string): { exists: boolean } } } } }).overseerEngine;
    return ['/game/master.dat', '/game/CRITTER.DAT', '/game/fallout2.cfg', '/game/data/SAVEGAME'].map((path) => engine.module.FS.analyzePath(path).exists);
  });
  expect(mounted).toEqual([true, true, true, true]);

  // Two tabs running one game would overwrite each other's saves.
  const second = await context.newPage();
  await second.goto('play.html?game=fo2');
  await expect(second.getByText('System fault')).toBeVisible();
  await expect(second.getByText('already running in another tab')).toBeVisible();
  await second.close();

  // Esc at the gate goes back without starting anything.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
});

test('continue goes from the main directory straight into the latest save', async ({ page }) => {
  // Saves alone are not enough: without the game data there is nothing to continue.
  await openConsole(page, 'saves/fo2');
  const restore = async (slot: string, description: string) => {
    const archive = zipSync({ [`SAVEGAME/SLOT${slot}/SAVE.DAT`]: new Uint8Array(fakeSaveDat('Narg', description)) });
    await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
    await expect(page.getByText('1 save restored from the archive.')).toBeVisible();
  };
  await restore('02', 'older');
  await page.keyboard.press('2');
  await expect(page.locator('.menu li').first()).toContainText('Load this save');
  await expect(page.locator('.menu li').first().locator('button')).toBeDisabled();
  await page.goto('#/');
  await expect(page.locator('.menu button')).toHaveCount(7);
  await expect(page.getByText('Continue:')).toHaveCount(0);

  await page.goto('#/fo2');
  await pickFolder(page, await fakeFallout2Folder());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto('#/saves/fo2');
  await page.waitForTimeout(20); // a later save
  await restore('07', 'newest');

  // The game's own screen offers it...
  await page.goto('#/fo2');
  const first = page.locator('.menu li').first();
  await expect(first).toContainText('Continue');
  await expect(first).toContainText('SLOT 07');
  await expect(page.locator('.menu li').nth(1)).toContainText('Begin simulation');

  // ...and the main directory lists it first, already selected.
  await page.goto('#/');
  await expect(first).toContainText('Continue: Fallout 2');
  await expect(first).toContainText('SLOT 07');
  await expect(first).toHaveClass(/selected/);
  await expect(page.locator('.menu-note')).toContainText('"newest", Narg, ARTEMPLE');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForURL(/play\.html\?game=fo2&slot=7$/);
  await expect(page.getByText('CONTINUING FROM SAVE SLOT 07')).toBeVisible({ timeout: 60_000 });
  // The opening movies are skipped on the way to a save.
  const config = await page.evaluate(() => {
    const engine = (window as unknown as { overseerEngine: { module: { FS: { readFile(path: string): Uint8Array } } } }).overseerEngine;
    return new TextDecoder().decode(engine.module.FS.readFile('/game/fallout2.cfg'));
  });
  expect(config).toContain('skip_opening_movies=1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();

  // Any save can be loaded directly from the archives.
  await page.goto('#/saves/fo2');
  await expect(page.locator('.menu li').first()).toContainText('SLOT 02');
  await page.keyboard.press('2');
  await expect(page.locator('.readout')).toContainText('older');
  await page.waitForTimeout(1500);
  await page.keyboard.press('l');
  await page.waitForURL(/play\.html\?game=fo2&slot=2$/);
  await expect(page.getByText('CONTINUING FROM SAVE SLOT 02')).toBeVisible({ timeout: 60_000 });
});

test('names the place of a save as the game does, from the game\'s own data', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2WithPlaces());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.goto('#/saves/fo2');
  const archive = zipSync({
    // The third map of the game's list, on its second level; and a map the list does not have.
    'SAVEGAME/SLOT04/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'under the den', { map: 2, level: 1 })),
    'SAVEGAME/SLOT06/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'off the map', { map: 40, level: 0 })),
  });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByText('2 saves restored from the archive.')).toBeVisible();

  // The area the map is entered by, then the level: what the game's own list of saves says.
  const note = page.locator('.menu-note');
  await expect(note).toContainText('The Den Basement, 0824 hours.');
  await page.keyboard.press('ArrowDown');
  // Where the game's data does not say, the name of the map file stands, as before.
  await expect(note).toContainText('ARTEMPLE, 0824 hours.');
  await page.keyboard.press('4');
  await expect(page.locator('.readout')).toContainText('The Den Basement');
  await expect(page.locator('.readout')).not.toContainText('ARTEMPLE');

  // The same words where a save is offered to continue from.
  await page.goto('#/');
  await expect(page.locator('.menu li').first()).toContainText('Continue: Fallout 2');
  await expect(note).toContainText('"under the den", Narg, The Den Basement, 25 JUL 2241.');
  await page.goto('#/fo2');
  await expect(page.locator('.menu li').first()).toContainText('Continue');
  await expect(note).toContainText('Narg, The Den Basement, 25 JUL 2241.');
});

/** Loads a made-up game and goes to the start gate of its engine. */
async function toTheGate(page: Page, game: 'fo1' | 'fo2', folder: string): Promise<void> {
  await page.goto(`#/${game}`);
  if (!(await page.locator('.menu button', { hasText: 'Begin simulation' }).count())) {
    await pickFolder(page, folder);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  }
  await page.waitForTimeout(1500);
  await page.keyboard.press('1');
  await page.waitForURL(/play\.html/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
}

test('Fallout 2 starts with what its engine adds, and as the original when that is switched off', async ({ page }) => {
  const game = () =>
    page.evaluate(() => {
      const { FS } = (window as unknown as { overseerEngine: { module: { FS: { analyzePath(path: string): { exists: boolean }; readFile(path: string): Uint8Array } } } }).overseerEngine.module;
      const read = (path: string) => (FS.analyzePath(path).exists ? new TextDecoder().decode(FS.readFile(path)) : null);
      return { engineData: FS.analyzePath('/game/ce.dat').exists, lights: read('/game/mods/sfall-mods.ini'), config: read('/game/fallout2.cfg') ?? '' };
    });
  const folder = await fakeFallout2Folder();

  await openConsole(page);
  await toTheGate(page, 'fo2', folder);
  const improved = await game();
  // The engine's own pictures and words, the key that lights things up, and its settings.
  expect(improved.engineData).toBe(true);
  expect(improved.lights).toContain('[Highlighting]');
  expect(improved.lights).toContain('Key=42');
  expect(improved.config).toContain('inventory_columns=2');
  expect(improved.config).toContain('auto_open_doors=1');
  expect(improved.config).toContain('extend_ap_bar=1');
  await expect(page.locator('#terminal-hints')).toContainText('F8 FAST FORWARD IN GAME');

  // Back at the console before going anywhere else: leaving the player page is a navigation of its own.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
  await page.goto('#/settings');
  const entry = page.locator('.menu li').filter({ hasText: 'Game improvements' });
  await expect(entry).toContainText('ON');
  await page.keyboard.press('6');
  await expect(entry).toContainText('OFF');
  await expect(page.locator('.menu-note')).toContainText('Fallout 2 as the original played.');

  await toTheGate(page, 'fo2', folder);
  const original = await game();
  expect(original.engineData).toBe(false);
  expect(original.lights).toBeNull();
  expect(original.config).toContain('inventory_columns=1');
  expect(original.config).toContain('auto_open_doors=0');
});

test('fast forward runs the clock of either engine several times as fast, and a suspended game stays suspended', async ({ page }) => {
  /** How fast the engine's clock runs against the page's own, measured over a moment. */
  const pace = (ms: number) =>
    page.evaluate(async (wait) => {
      const stats = () => (window as unknown as { overseerEngine: { module: { overseer: { stats(): { clock: number } } } } }).overseerEngine.module.overseer.stats();
      const from = { clock: stats().clock, real: performance.now() };
      await new Promise((resolve) => setTimeout(resolve, wait));
      return (stats().clock - from.clock) / (performance.now() - from.real);
    }, ms);
  const engine = (call: string, value?: number) =>
    page.evaluate(([name, argument]) => (window as unknown as { overseerEngine: Record<string, (value?: number) => void> }).overseerEngine[name as string]!(argument as number | undefined), [call, value] as const);

  await openConsole(page);
  for (const [game, folder] of [['fo2', await fakeFallout2Folder()], ['fo1', await fakeFallout1Folder()]] as const) {
    await toTheGate(page, game, folder);
    expect(await pace(300), `${game} at its own pace`).toBeCloseTo(1, 1);
    await engine('setSpeed', 3);
    const fast = await pace(300);
    expect(fast, `${game} fast`).toBeGreaterThan(2.7);
    expect(fast, `${game} fast`).toBeLessThan(3.3);
    // Suspended, the clock stands still whatever its speed; back at its own pace it carries on from where it was.
    await engine('pause');
    expect(await pace(200), `${game} suspended`).toBe(0);
    await engine('resume');
    await engine('setSpeed', 1);
    expect(await pace(300), `${game} back at its own pace`).toBeCloseTo(1, 1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /SIMULATION 0\d/ })).toBeVisible();
  }
});

test('the fast forward speed and the improvements are settings like the others', async ({ page }) => {
  await openConsole(page, 'settings');
  const speed = page.locator('.menu li').filter({ hasText: 'Fast forward' });
  await expect(speed).toContainText('3 TIMES');
  await page.keyboard.press('7');
  await expect(speed).toContainText('4 TIMES');
  await page.keyboard.press('7');
  await expect(speed).toContainText('2 TIMES');
  await page.keyboard.press('6');
  await page.reload();
  await expect(page.locator('.menu li').filter({ hasText: 'Fast forward' })).toContainText('2 TIMES');
  await expect(page.locator('.menu li').filter({ hasText: 'Game improvements' })).toContainText('OFF');
});

test('credits name the engines, their licence and that the builds are modified', async ({ page }) => {
  await openConsole(page, 'credits');
  await expect(page.getByRole('link', { name: 'Fallout 2 Community Edition' })).toBeVisible();
  await expect(page.getByText('Sustainable Use License')).toBeVisible();
  await expect(page.getByText('THE ENGINE BUILDS SERVED HERE ARE MODIFIED COPIES.')).toBeVisible();
  await expect(page.getByText('not affiliated with')).toBeVisible();
  // Filled in from the engine builds.
  await expect(page.getByRole('link', { name: 'License' })).toHaveCount(2);

  const licence = await page.request.get('engines/fo1/LICENSE.txt');
  expect(licence.ok()).toBe(true);
  expect(await licence.text()).toContain('Sustainable Use License');
});

test('the manual is a list of chapters, each read on its own and leading to the next', async ({ page }) => {
  await openConsole(page);
  await page.keyboard.press('6');
  await expect(page.getByRole('heading', { name: 'Operations manual' })).toBeVisible();
  const chapters = ['Loading a game', 'Fallout Et Tu', 'Controls', 'Picture and speed', 'Touch screens', 'Saving', 'Save archives', 'Your Dropbox', 'If something fails'];
  await expect(page.locator('.menu .label')).toHaveText([...chapters, 'Back'], { ignoreCase: true });

  // The board lists the sections of the chapter under the cursor: the headings that chapter has.
  for (const [number, title] of chapters.entries()) {
    await page.goto('#/manual');
    await page.keyboard.press('Home');
    for (let step = 0; step < number; step++) await page.keyboard.press('ArrowDown');
    const topics = await page.locator('.board .topics li').allInnerTexts();
    await page.keyboard.press('Enter');
    await expect(page.locator('h1')).toHaveText(title);
    await expect(page.getByText(`chapter ${number + 1} of ${chapters.length}`)).toBeVisible();
    expect(topics.map((topic) => topic.replace(/^- /, '').toUpperCase())).toEqual((await page.locator('.prose h2').allInnerTexts()).map((heading) => heading.replace(/=/g, '').trim().toUpperCase()));
  }

  // N and P turn the pages; ESC goes back to the contents, with the chapter read under the cursor.
  await page.goto('#/manual');
  await page.keyboard.press('6');
  await expect(page.locator('h1')).toHaveText('Saving');
  await page.keyboard.press('n');
  await expect(page.locator('h1')).toHaveText('Save archives');
  await page.keyboard.press('p');
  await page.keyboard.press('p');
  await expect(page.locator('h1')).toHaveText('Touch screens');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Operations manual' })).toBeVisible();
  await expect(page.locator('.menu li.selected')).toContainText('Touch screens');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();

  // A deck that asks where the game files are opens that chapter.
  await page.goto('#/fo2');
  await page.locator('.menu button', { hasText: 'Where are the game files?' }).click();
  await expect(page.locator('h1')).toHaveText('Loading a game');
  await expect(page.getByText('Browse local files')).toBeVisible();
});

test('keeps working without a network connection once visited', async ({ page, context }) => {
  await openConsole(page);
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  // The service worker has installed and holds the pages.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
    return registration.scope;
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  await page.keyboard.press('6');
  await expect(page.getByRole('heading', { name: 'Operations manual' })).toBeVisible();

  // The player page is available offline as well (and finds no game to run).
  await page.goto('play.html?game=fo2');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
});

test('says so when the browser refuses to store data, as private windows do', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.storage.getDirectory = () => Promise.reject(new DOMException('refused', 'SecurityError'));
  });
  await openConsole(page);
  await expect(page.getByText('PRIVATE STORAGE UNAVAILABLE')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.getByText('THIS BROWSER CANNOT STORE GAME DATA')).toBeVisible();

  // The player has nothing to run and hands back to the console instead of failing.
  await page.goto('play.html?game=fo2');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
  await expect(page.getByText('System fault')).toHaveCount(0);
});
