import type { BrowserContext, Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { FakeDropbox } from '../fake-dropbox';
import { expect, test as base } from './fixtures';
import { fakeEttuZip, fakeFallout2Folder, fakeSaveDat, openConsole, pickFolder } from './helpers';

/**
 * WebKit sends the requests of a page that a service worker controls straight
 * to the network, past the stand-in below: to the real Dropbox. There the
 * tests run without the worker. Chromium and Firefox keep it, which also
 * shows that the worker lets requests to Dropbox through untouched.
 */
const test = base.extend({
  serviceWorkers: async ({ browserName }, use) => {
    await use(browserName === 'webkit' ? 'block' : 'allow');
  },
});

/**
 * The console linked to a Dropbox that is not there: every request to the
 * three Dropbox hosts is answered by tests/fake-dropbox.ts.
 */
async function standIn(context: BrowserContext, dropbox: FakeDropbox, line: { downloadMs: number } = { downloadMs: 0 }): Promise<void> {
  await context.route(/^https:\/\/(www\.dropbox\.com|api\.dropboxapi\.com|content\.dropboxapi\.com)\//, async (route) => {
    const request = route.request();
    // A slow line, where a test wants to act while something is still on its way.
    if (line.downloadMs && request.url().includes('/files/download')) await new Promise((resolve) => setTimeout(resolve, line.downloadMs));
    const answer = dropbox.handle({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postDataBuffer() });
    await route.fulfill({ status: answer.status, headers: answer.headers, body: typeof answer.body === 'string' ? answer.body : Buffer.from(answer.body) });
  });
}

/** Opens Dropbox from the link screen, allows the app, and comes back with the code. */
async function codeFromDropbox(page: Page, context: BrowserContext): Promise<string> {
  const opened = context.waitForEvent('page');
  await page.keyboard.press('2');
  const approval = await opened;
  const code = await approval.locator('#code').innerText();
  await approval.close();
  return code;
}

async function linkConsole(page: Page, context: BrowserContext, dropbox: FakeDropbox): Promise<void> {
  await openConsole(page, 'settings/cloud/dropbox');
  await page.getByLabel('App key').fill(dropbox.appKey);
  await page.getByLabel('App key').press('Escape');
  await expect(page.locator('.menu li').nth(1).locator('button')).toBeEnabled();
  await page.getByLabel('Access code').fill(await codeFromDropbox(page, context));
  await page.getByLabel('Access code').press('Enter');
  await expect(page.getByText('Linked to the Dropbox of Chosen One.')).toBeVisible();
}

function saveZip(slot: string, description: string): Buffer {
  return Buffer.from(
    zipSync({
      [`SAVEGAME/SLOT${slot}/SAVE.DAT`]: new Uint8Array(fakeSaveDat('Narg', description)),
      [`SAVEGAME/SLOT${slot}/ARTEMPLE.SAV`]: new Uint8Array([1, 2, 3]),
    }),
  );
}

/** When the save in a Fallout 2 slot was written, to the millisecond, as the console has it stored. */
function savedAt(page: Page, slot: string): Promise<number> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('overseer-console');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction('overlay').objectStore('overlay').get(['fo2', key]);
        request.onsuccess = () => resolve((request.result as { mtime: number }).mtime);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, `data/savegame/slot${slot}/save.dat`);
}

/** Makes this browser one that has never held a save, as a second device would be. */
async function forgetSaves(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const name of ['overseer-console', 'overseer-console-history']) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
    localStorage.removeItem('overseer-console:dropbox:synced');
  });
  await page.reload();
}

test('links to a Dropbox with an app key and a pasted code, and unlinks again', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  await standIn(context, dropbox);

  // The settings lead there, and so does the deck of a game that is not loaded.
  await openConsole(page, 'fo2');
  await expect(page.locator('.menu li').nth(2)).toContainText('Load holodisk from your cloud');
  await expect(page.locator('.menu li').nth(2)).toContainText('NOT LINKED');
  await page.goto('#/settings');
  await expect(page.locator('.menu li').filter({ hasText: 'Cloud link' })).toContainText('NOT LINKED');
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: 'Cloud link' })).toBeVisible();
  await expect(page.locator('.menu li').first()).toContainText('FREE: 2 GB');
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Dropbox link' })).toBeVisible();
  // What to do stands above what to fill in.
  const steps = (await page.getByText('you make a small private app in your own Dropbox').boundingBox())!;
  const field = (await page.getByLabel('App key').boundingBox())!;
  expect(steps.y).toBeLessThan(field.y);
  const open = page.locator('.menu li').nth(1).locator('button');
  await expect(open).toBeDisabled();

  // Typed keys are text, not commands: this key holds the digits of four menu entries.
  await page.keyboard.press('1');
  await expect(page.getByLabel('App key')).toBeFocused();
  await page.keyboard.type(`${dropbox.appKey}x`);
  await page.keyboard.press('Backspace');
  await expect(page.getByLabel('App key')).toHaveValue(dropbox.appKey);
  await expect(page.getByRole('heading', { name: 'Dropbox link' })).toBeVisible();
  // ESC hands the keyboard back to the menu without leaving the screen.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('App key')).not.toBeFocused();
  await expect(page.getByRole('heading', { name: 'Dropbox link' })).toBeVisible();
  await expect(open).toBeEnabled();

  const code = await codeFromDropbox(page, context);
  expect(code).toBe(dropbox.code);
  await page.keyboard.press('3');
  await expect(page.getByLabel('Access code')).toBeFocused();
  await page.keyboard.type('not-the-code');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Dropbox did not accept that code');

  await page.getByLabel('Access code').fill(code);
  await page.getByLabel('Access code').press('Escape');
  await page.keyboard.press('4');
  await expect(page.getByText('Linked to the Dropbox of Chosen One.')).toBeVisible();
  await expect(page.locator('.readout').first()).toContainText('chosen@arroyo.example');
  await expect(page.getByLabel('Saves folder')).toHaveValue('/Saves');

  // The link outlives the page, and the console says so where it promised nothing leaves the device.
  await page.goto('#/');
  await page.reload();
  await expect(page.getByText('ONLY WHAT YOU UPLOAD GOES TO YOUR OWN DROPBOX')).toBeVisible();
  await page.goto('#/settings');
  await expect(page.locator('.menu li').filter({ hasText: 'Cloud link' })).toContainText('DROPBOX');
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: 'Dropbox link' })).toBeVisible();
  // One cloud at a time: Google Drive's screen says this one is linked.
  await page.goto('#/settings/cloud/drive');
  await expect(page.getByText('THE CONSOLE IS LINKED TO THE DROPBOX OF CHOSEN ONE.')).toBeVisible();
  await page.goto('#/settings/cloud');

  // Folders are tidied as they are stored.
  await page.getByLabel('Saves folder').fill('Vault 13\\Backups/');
  await page.getByLabel('Saves folder').press('Enter');
  await expect(page.getByLabel('Saves folder')).toHaveValue('/Vault 13/Backups');
  await page.getByLabel('Games folder').fill('../elsewhere');
  await page.getByLabel('Games folder').press('Enter');
  await expect(page.getByRole('status')).toContainText('cannot contain');

  await page.keyboard.press('u');
  await expect(page.getByText('UNLINK FROM THE DROPBOX OF CHOSEN ONE?')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('Unlinked. Dropbox has cancelled the access the console had.')).toBeVisible();
  expect(dropbox.linked).toBe(false);
  // The key is kept for the next time.
  await expect(page.getByLabel('App key')).toHaveValue(dropbox.appKey);
  await page.goto('#/');
  await expect(page.getByText('NOTHING IS UPLOADED')).toBeVisible();
});

test('says which permissions a Dropbox app lacks', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  // A new app as Dropbox makes it: nothing ticked on its Permissions tab yet.
  dropbox.allowed = ['account_info.read'];
  await standIn(context, dropbox);

  // Where the Dropbox link used to be is where it is now.
  await openConsole(page, 'settings/dropbox');
  await expect(page).toHaveURL(/#\/settings\/cloud\/dropbox$/);
  await page.getByLabel('App key').fill(dropbox.appKey);
  await page.getByLabel('App key').press('Escape');
  await expect(page.locator('.menu li').nth(1).locator('button')).toBeEnabled();
  await page.getByLabel('Access code').fill(await codeFromDropbox(page, context));
  await page.getByLabel('Access code').press('Enter');
  await expect(page.getByRole('status')).toContainText('does not allow files.metadata.read, files.content.read, files.content.write');
  await expect(page.getByRole('status')).toContainText('Permissions tab');
  await expect(page.locator('.board')).toContainText('NOT LINKED');
  expect(dropbox.linked).toBe(false);
});

test('carries saves to another browser through Dropbox', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  await standIn(context, dropbox);
  await linkConsole(page, context, dropbox);

  // A save made here.
  await page.goto('#/saves/fo2');
  await expect(page.locator('.menu li').filter({ hasText: 'Fetch from Dropbox' })).toBeVisible();
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: saveZip('03', 'before the temple') });
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();
  const saved = await savedAt(page, '03');

  await expect(page.getByText('LAST EXPORTED: NEVER')).toBeVisible();
  await expect(page.getByText('Upload them to Dropbox [U] to keep a copy.')).toBeVisible();
  await page.keyboard.press('u');
  await expect(page.getByText('1 save uploaded to Dropbox.')).toBeVisible();
  await expect(page.getByText('LAST EXPORTED JUST NOW, TO DROPBOX.')).toBeVisible();
  expect([...dropbox.files.values()].map((file) => file.path)).toEqual(['/Saves/Fallout 2/SLOT03.zip']);
  await page.keyboard.press('u');
  await expect(page.getByText('Dropbox already holds every save that is in this browser.')).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.getByText('Dropbox holds nothing newer than this browser.')).toBeVisible();

  // Another browser, linked to the same Dropbox, holding nothing.
  await forgetSaves(page);
  await expect(page.getByText('NO SAVED GAMES YET')).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.getByText('1 save fetched from Dropbox.')).toBeVisible();
  const slot = page.locator('.menu li').first();
  await expect(slot).toContainText('SLOT 03');
  await expect(slot).toContainText('before the temple');
  // It is the save of that moment, not one made now, and all of it.
  expect(await savedAt(page, '03')).toBe(saved);
  await page.keyboard.press('3');
  await expect(page.locator('.readout').first()).toContainText('in 2 files');
  await page.keyboard.press('0');

  // The game is played on elsewhere, and that save uploaded.
  dropbox.put('/Saves/Fallout 2/SLOT03.zip', saveZip('03', 'through the temple'), new Date(Date.now() + 60_000).toISOString().slice(0, 19) + 'Z');
  await page.keyboard.press('u');
  await expect(page.getByRole('status')).toContainText('SLOT 03 is newer in Dropbox and was left alone: fetch it first.');
  await page.keyboard.press('f');
  await expect(page.getByText('SLOT 03 HOLDS AN OLDER SAVE IN THIS BROWSER.')).toBeVisible();
  // ESC is "no": nothing was touched.
  await page.keyboard.press('Escape');
  await expect(slot).toContainText('before the temple');
  await page.keyboard.press('f');
  await expect(page.getByText('SLOT 03 HOLDS AN OLDER SAVE IN THIS BROWSER.')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('1 save fetched from Dropbox.')).toBeVisible();
  await expect(slot).toContainText('through the temple');

  // What it replaced is one roll back away.
  await page.keyboard.press('3');
  await page.keyboard.press('v');
  await expect(page.locator('.menu li').first()).toContainText('before the temple');
  await expect(page.locator('.menu-note')).toContainText('Replaced by a save fetched from Dropbox');
  await page.keyboard.press('Escape');

  // Erasing a save that is in Dropbox erases it there as well.
  await page.keyboard.press('d');
  await expect(page.getByText('Its copy in your Dropbox is erased as well.')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('SLOT 03 erased, here and in Dropbox.')).toBeVisible();
  expect(dropbox.files.size).toBe(0);
  await page.keyboard.press('f');
  await expect(page.getByText('There are no saves for Fallout 2 in Dropbox yet.')).toBeVisible();
});

test('says so when Dropbox has cancelled the link', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  await standIn(context, dropbox);
  await linkConsole(page, context, dropbox);
  await page.goto('#/saves/fo2');
  await expect(page.locator('.menu li').filter({ hasText: 'Fetch from Dropbox' })).toBeVisible();

  // The player removes the app from their Dropbox account.
  dropbox.disconnectApp();
  await page.keyboard.press('f');
  await expect(page.getByRole('status')).toContainText('Dropbox no longer accepts this link');
  await expect(page.locator('.menu li').filter({ hasText: 'Keep saves in your cloud' })).toContainText('NOT LINKED');
});

/** Bytes that depend on where they are, so a piece put in the wrong place shows. */
function patterned(size: number): Buffer {
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) data[i] = (i * 31 + (i >>> 16)) & 0xff;
  return data;
}

test('loads a game from the folder in Dropbox', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  // Larger than one piece of the copy (4 MB), so that pieces have to be joined.
  const master = patterned(5 << 20);
  master.writeUInt32LE(16, master.length - 8);
  master.writeUInt32LE(master.length, master.length - 4);
  const small = Buffer.alloc(4096, 0x2a);
  small.writeUInt32LE(16, small.length - 8);
  small.writeUInt32LE(small.length, small.length - 4);
  dropbox.put('/Games/Fallout 2/master.dat', master);
  dropbox.put('/Games/Fallout 2/critter.dat', small);
  dropbox.put('/Games/Fallout 2/patch000.dat', small);
  dropbox.put('/Games/Fallout 2/fallout2.cfg', '[system]\r\nlanguage=english\r\n');
  dropbox.put('/Games/Fallout 2/fallout2.exe', 'not a program');
  dropbox.put('/Games/Fallout 2/sound/music/01hub.acm', Buffer.alloc(2048, 1));
  dropbox.put('/Games/Fallout 2/data/worldmap.dat', Buffer.alloc(512, 2));
  dropbox.put('/Games/Fallout 2/data/SAVEGAME/SLOT02/SAVE.DAT', fakeSaveDat('Narg', 'came with the folder'));
  dropbox.put('/Saves/Fallout 2/SLOT03.zip', saveZip('03', 'not part of the game'));
  await standIn(context, dropbox);
  await linkConsole(page, context, dropbox);

  // The other game is not there, and is not mistaken for this one.
  await page.goto('#/fo1');
  await page.keyboard.press('3');
  await expect(page.getByText('HOLODISK REJECTED')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Fallout was not found in your Dropbox. What is there is Fallout 2.');

  await page.goto('#/fo2');
  await expect(page.locator('.menu li').nth(2)).toContainText('Load holodisk from Dropbox');
  await page.keyboard.press('3');
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status')).toContainText('5 files');
  await expect(page.getByRole('status')).toContainText('Saved games found in the folder were added');
  await expect(page.locator('.menu button').first()).toContainText('Continue');

  // The files are in the origin private file system, every byte where it belongs.
  const stored = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const game = await (await (await root.getDirectoryHandle('overseer-console')).getDirectoryHandle('games')).getDirectoryHandle('fo2');
    const current = JSON.parse(await (await (await game.getFileHandle('current.json')).getFile()).text());
    const install = await game.getDirectoryHandle(current.install);
    const manifest = JSON.parse(await (await (await install.getFileHandle('manifest.json')).getFile()).text());
    const entry = manifest.files.find((f: { path: string }) => f.path === 'master.dat');
    const bytes = new Uint8Array(await (await (await install.getFileHandle(entry.blob)).getFile()).arrayBuffer());
    let wrong = 0;
    for (let i = 0; i < bytes.length - 8; i++) if (bytes[i] !== ((i * 31 + (i >>> 16)) & 0xff)) wrong++;
    return { files: manifest.files.map((f: { path: string }) => f.path).sort(), masterBytes: bytes.length, wrong, packed: manifest.files.filter((f: { pack?: unknown }) => f.pack).length };
  });
  expect(stored).toEqual({
    files: ['critter.dat', 'data/worldmap.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm'],
    masterBytes: 5 << 20,
    wrong: 0,
    packed: 4,
  });

  // Loaded, it can be fetched again in place: with the other ways of loading it, under its holodisk.
  await page.locator('.menu button', { hasText: 'Holodisk' }).click();
  await expect(page.locator('.menu li').filter({ hasText: 'Replace holodisk from Dropbox' })).toBeVisible();
});

test('loads Fallout Et Tu from the zip it is kept as in the Mods folder of Dropbox', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  // Not there yet: the console says where to put it.
  dropbox.put('/Games/notes.txt', 'nothing to play');
  await standIn(context, dropbox);
  await linkConsole(page, context, dropbox);
  await page.goto('#/mods/load');
  await expect(page.locator('.menu li').filter({ hasText: 'From Dropbox' })).not.toContainText('NOT LINKED');
  await page.keyboard.press('3');
  await expect(page.getByText("There are no mods in /Mods in the console's app folder in your Dropbox.")).toBeVisible();
  await page.keyboard.press('Escape');

  // The package as it is downloaded, from a folder its own tool was run in: nothing to take from Fallout.
  dropbox.put('/Mods/Fallout1in2.zip', fakeEttuZip({ extracted: true, forEngine: true }).buffer);
  // A mod kept as a folder is listed as well; a loose file is none.
  dropbox.put('/Mods/Some Mod/mods/some.dat', 'not a mod at all');
  dropbox.put('/Mods/readme.txt', 'what is in here');
  dropbox.calls.length = 0;
  await page.keyboard.press('3');
  await expect(page.getByText('IN /MODS IN YOUR DROPBOX:')).toBeVisible();
  await expect(page.locator('.menu .label')).toHaveText(['Fallout1in2.zip', 'Some Mod', 'Back'], { ignoreCase: true });
  await expect(page.locator('.menu li').first()).toContainText('ZIP');
  await expect(page.locator('.menu li').nth(1)).toContainText('1 FILE,');
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status')).toContainText('21 files');
  await expect(page.getByRole('status')).not.toContainText('fallout2-ce.exe');

  // Read ahead, not file by file: some forty files came out of the zip in a handful of downloads.
  const downloads = dropbox.calls.filter((call) => call.includes('download')).length;
  expect(downloads).toBeGreaterThan(0);
  expect(downloads).toBeLessThan(12);

  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const game = await (await (await root.getDirectoryHandle('overseer-console')).getDirectoryHandle('games')).getDirectoryHandle('ettu');
    const current = JSON.parse(await (await (await game.getFileHandle('current.json')).getFile()).text());
    const manifest = JSON.parse(await (await (await (await game.getDirectoryHandle(current.install)).getFileHandle('manifest.json')).getFile()).text());
    return (manifest.files as { path: string }[]).map((file) => file.path).sort();
  });
  expect(files).toContain('mods/fo1_base');
  expect(files).toContain('fallout1.dat');

  // Its files can be fetched again from there, its saves kept.
  await page.locator('.menu button', { hasText: 'Holodisk' }).click();
  await expect(page.locator('.menu li').filter({ hasText: 'Replace holodisk from Dropbox' })).toBeVisible();

  // A game is never looked for among the mods.
  dropbox.put('/Mods/Fallout 2/master.dat', 'not here');
  await page.goto('#/fo2');
  await page.locator('.menu button', { hasText: 'Load holodisk from Dropbox' }).click();
  await expect(page.getByRole('alert')).toContainText("No MASTER.DAT in the console's app folder in your Dropbox.");
});

test('puts a game in Dropbox from this device, for another device to load from there', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  await standIn(context, dropbox);
  await linkConsole(page, context, dropbox);

  await page.keyboard.press('p');
  await expect(page.getByRole('heading', { name: 'Put in Dropbox' })).toBeVisible();
  await page.keyboard.press('1');
  await pickFolder(page, await fakeFallout2Folder());
  const done = page.getByRole('status').filter({ hasText: 'Fallout 2.zip (' });
  await expect(done).toContainText("is in your Dropbox. On any device linked to it, the game's deck loads it: Load holodisk from Dropbox.", { timeout: 60_000 });
  expect([...dropbox.files.values()].map((file) => file.path)).toEqual(['/Fallout 2.zip']);
  expect(dropbox.calls.filter((call) => call.startsWith('files/upload_session'))).toEqual(['files/upload_session/start', 'files/upload_session/finish']);

  await page.goto('#/fo2');
  await page.locator('.menu button', { hasText: 'Load holodisk from Dropbox' }).click();
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status')).toContainText('5 files');
});

test('a game on its way from Dropbox can be called off, and the deck is as it was', async ({ page, context }) => {
  const dropbox = new FakeDropbox();
  // Three pieces of the copy (4 MB each): long enough on a slow line to be stopped half way.
  const master = patterned(12 << 20);
  master.writeUInt32LE(16, master.length - 8);
  master.writeUInt32LE(master.length, master.length - 4);
  const small = Buffer.alloc(4096, 0x2a);
  small.writeUInt32LE(16, small.length - 8);
  small.writeUInt32LE(small.length, small.length - 4);
  dropbox.put('/Games/Fallout 2/master.dat', master);
  dropbox.put('/Games/Fallout 2/critter.dat', small);
  dropbox.put('/Games/Fallout 2/patch000.dat', small);
  dropbox.put('/Games/Fallout 2/sound/music/01hub.acm', Buffer.alloc(2048, 1));
  const line = { downloadMs: 0 };
  await standIn(context, dropbox, line);
  await linkConsole(page, context, dropbox);

  /** Whether the browser would ask before it lets the page go. */
  const guarded = () =>
    page.evaluate(() => {
      const leaving = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(leaving);
      return leaving.defaultPrevented;
    });
  /** What the store holds of the game: the names in its folder. */
  const stored = () =>
    page.evaluate(async () => {
      const names: string[] = [];
      try {
        const root = await navigator.storage.getDirectory();
        const game = await (await (await root.getDirectoryHandle('overseer-console')).getDirectoryHandle('games')).getDirectoryHandle('fo2');
        for await (const name of (game as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
      } catch {
        // No folder for the game at all.
      }
      return names;
    });

  await page.goto('#/fo2');
  expect(await guarded()).toBe(false);
  line.downloadMs = 800;
  const fromDropbox = page.locator('.menu button', { hasText: 'Load holodisk from Dropbox' });
  await fromDropbox.click();
  await expect(page.getByText('FETCHING HOLODISK FROM DROPBOX INTO PRIVATE STORAGE')).toBeVisible({ timeout: 60_000 });
  // Closing the tab now would end the copy: the browser is told to ask first.
  expect(await guarded()).toBe(true);

  // Calling it off is asked about, and ENTER lands on carrying on.
  await page.keyboard.press('x');
  await expect(page.getByText('STOP LOADING THE FALLOUT 2 HOLODISK?')).toBeVisible();
  await expect(page.locator('.menu li.selected')).toContainText('No, carry on');
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu li.selected')).toContainText('Stop loading');
  await page.keyboard.press('x');
  await page.keyboard.press('y');

  await expect(page.getByText('LOADING STOPPED')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Nothing was changed: the deck is as it was.')).toBeVisible();
  await expect(page.getByText('NOT LOADED')).toBeVisible();
  await expect(page.locator('.menu button').first()).toContainText('Load holodisk');
  // What had been copied is gone, not left to take up room.
  expect(await stored()).toEqual([]);
  expect(await guarded()).toBe(false);

  // Asked again, on a line that keeps up, it loads.
  line.downloadMs = 0;
  await fromDropbox.click();
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status')).toContainText('4 files');
  expect(await stored()).toEqual(expect.arrayContaining(['current.json']));
});
