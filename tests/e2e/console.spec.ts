import { expect, test } from './fixtures';
import { zipSync } from 'fflate';
import { fakeFallout2Folder, fakeSaveDat, junkFolder, openConsole, pickFolder } from './helpers';

test('plays the power-on sequence once, then shows the main directory', async ({ page }) => {
  await page.goto('');
  await expect(page.getByText('POWER-ON SELF TEST')).toBeVisible();
  await expect(page.getByText('PRIVATE STORAGE')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  await expect(page.locator('.menu button')).toHaveCount(6);

  // Not again in the same session.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  await expect(page.getByText('POWER-ON SELF TEST')).toHaveCount(0);
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
  await expect(page.locator('.menu li.selected')).toContainText('Save archives');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Save archives' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();

  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { name: 'Terminal settings' })).toBeVisible();
  const picture = page.locator('.menu li').first();
  await expect(picture).toContainText('CLASSIC');
  await page.keyboard.press('1');
  await expect(picture).toContainText('WIDE');

  await page.reload();
  await expect(page.locator('.menu li').first()).toContainText('WIDE');
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

  await page.keyboard.press('3');
  await expect(page.getByText('Fallout 2 is sold by')).toBeVisible();
  await expect(page.locator('.menu button')).toContainText(['GOG', 'Steam', 'Epic Games', 'Back']);
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
  await pickFolder(page, fakeFallout2Folder());

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
  await page.keyboard.press('4');
  await expect(page.getByText('EJECT THE FALLOUT 2 HOLODISK?')).toBeVisible();
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

  await page.keyboard.press('1');
  await expect(page.locator('.readout')).toContainText('25 JUL 2241, 0824 hours');
  await expect(page.locator('.readout')).toContainText('ARTEMPLE');

  const download = page.waitForEvent('download');
  await page.keyboard.press('e');
  expect((await download).suggestedFilename()).toMatch(/^overseer-fo2-slot03-.*\.zip$/);

  await page.keyboard.press('d');
  await expect(page.getByText('ERASE SLOT 03')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('SLOT 03 erased.')).toBeVisible();
  await expect(page.getByText('NO SAVED GAMES YET')).toBeVisible();
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
  await page.keyboard.press('1');
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
  await pickFolder(page, fakeFallout2Folder());
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
  await page.keyboard.press('1');
  await expect(page.locator('.menu li').first()).toContainText('Load this save');
  await expect(page.locator('.menu li').first().locator('button')).toBeDisabled();
  await page.goto('#/');
  await expect(page.locator('.menu button')).toHaveCount(6);
  await expect(page.getByText('Continue:')).toHaveCount(0);

  await page.goto('#/fo2');
  await pickFolder(page, fakeFallout2Folder());
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
  await page.keyboard.press('1');
  await expect(page.locator('.readout')).toContainText('older');
  await page.waitForTimeout(1500);
  await page.keyboard.press('l');
  await page.waitForURL(/play\.html\?game=fo2&slot=2$/);
  await expect(page.getByText('CONTINUING FROM SAVE SLOT 02')).toBeVisible({ timeout: 60_000 });
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
  await page.keyboard.press('5');
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
