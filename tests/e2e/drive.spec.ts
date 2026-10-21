import type { BrowserContext, Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { FakeDrive } from '../fake-drive';
import { expect, test as base } from './fixtures';
import { fakeEttuZip, fakeFallout2Folder, fakeSaveDat, openConsole, pickFolder, writeFolder } from './helpers';

/**
 * WebKit sends the requests of a page that a service worker controls straight
 * to the network, past the stand-in below: to the real Google. There the
 * tests run without the worker, as they do for Dropbox.
 */
const test = base.extend({
  serviceWorkers: async ({ browserName }, use) => {
    await use(browserName === 'webkit' ? 'block' : 'allow');
  },
});

/**
 * The console linked to a Google Drive that is not there: every request to
 * Google's hosts is answered by tests/fake-drive.ts.
 */
async function standIn(context: BrowserContext, drive: FakeDrive, line: { held: Promise<void> | null } = { held: null }): Promise<void> {
  // The console asks every second whether the code was entered, not every five.
  drive.interval = 1;
  await context.route(/^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com|www\.google\.com)\//, async (route) => {
    const request = route.request();
    // A line that holds pieces of an upload until let go, where a test wants to act while something is still on its way.
    if (line.held && request.url().includes('upload_id')) {
      await line.held;
      // Called off meanwhile: the piece never arrived.
      await route.abort().catch(() => undefined);
      return;
    }
    const answer = drive.handle({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postDataBuffer() });
    await route.fulfill({ status: answer.status, headers: answer.headers, body: typeof answer.body === 'string' ? answer.body : Buffer.from(answer.body) });
  });
}

/** Fills in the client, gets a code, and has the player enter it at Google. */
async function linkConsole(page: Page, drive: FakeDrive): Promise<void> {
  await openConsole(page, 'settings/cloud/drive');
  await page.getByLabel('Client ID').fill(drive.clientId);
  await page.getByLabel('Client secret').fill(drive.clientSecret);
  await page.getByLabel('Client secret').press('Escape');
  await page.keyboard.press('3');
  await expect(page.getByText('YOUR CODE:')).toBeVisible();
  drive.approve();
  await expect(page.getByText('Linked to the Google Drive of Chosen One.')).toBeVisible({ timeout: 15_000 });
}

function saveZip(slot: string, description: string): Buffer {
  return Buffer.from(
    zipSync({
      [`SAVEGAME/SLOT${slot}/SAVE.DAT`]: new Uint8Array(fakeSaveDat('Narg', description)),
      [`SAVEGAME/SLOT${slot}/ARTEMPLE.SAV`]: new Uint8Array([1, 2, 3]),
    }),
  );
}

/** Another browser, linked to the same Drive, holding nothing. */
async function forgetSaves(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const name of ['overseer-console', 'overseer-console-history']) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
    localStorage.removeItem('overseer-console:drive:synced');
  });
  await page.reload();
}

test('links to a Google Drive with a code entered at Google, and unlinks again', async ({ page, context }) => {
  const drive = new FakeDrive();
  await standIn(context, drive);

  // From the settings: a choice of clouds, and this one's own screen.
  await openConsole(page, 'settings');
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: 'Cloud link' })).toBeVisible();
  await expect(page.locator('.menu li').nth(1)).toContainText('FREE: UP TO 15 GB');
  await page.keyboard.press('2');
  await expect(page.getByRole('heading', { name: 'Google Drive link' })).toBeVisible();
  // What to do stands above what to fill in.
  const steps = (await page.getByText('you make a small project in your own Google Cloud').boundingBox())!;
  const field = (await page.getByLabel('Client ID').boundingBox())!;
  expect(steps.y).toBeLessThan(field.y);
  await expect(page.locator('.menu li').filter({ hasText: 'Get a code' }).locator('button')).toBeDisabled();

  // Typed keys are text, not commands.
  await page.keyboard.press('1');
  await expect(page.getByLabel('Client ID')).toBeFocused();
  await page.keyboard.type(drive.clientId);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu li').first()).toContainText('ENTERED');
  await page.keyboard.press('2');
  await page.keyboard.type('not a secret');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu li').nth(1)).toContainText('NOT A SECRET');
  await page.getByLabel('Client secret').fill(drive.clientSecret);
  await page.getByLabel('Client secret').press('Escape');

  await page.keyboard.press('3');
  await expect(page.getByText('YOUR CODE:')).toBeVisible();
  const code = drive.userCodes.at(-1)!;
  await expect(page.locator('.usercode')).toHaveText(code);
  await expect(page.locator('.board')).toContainText('WAITING');

  // Google's page opens in a tab of its own.
  const opened = context.waitForEvent('page');
  await page.keyboard.press('4');
  const google = await opened;
  await expect(google).toHaveURL('https://www.google.com/device');
  await google.close();

  // The page loaded again shows the same code, and keeps waiting for it.
  await page.reload();
  await expect(page.locator('.usercode')).toHaveText(code);
  drive.approve(code);
  await expect(page.getByText('Linked to the Google Drive of Chosen One.')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.readout').first()).toContainText('chosen@arroyo.example');
  await expect(page.locator('.readout').first()).toContainText('123456789012');
  await expect(page.getByLabel('Saves folder')).toHaveValue('/Saves');

  await page.goto('#/');
  await page.reload();
  await expect(page.getByText('ONLY WHAT YOU UPLOAD GOES TO YOUR OWN GOOGLE DRIVE')).toBeVisible();
  await page.goto('#/settings');
  await expect(page.locator('.menu li').filter({ hasText: 'Cloud link' })).toContainText('GOOGLE DRIVE');
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: 'Google Drive link' })).toBeVisible();

  // Unlinking forgets it in this browser; the other browsers' links are Google's to end.
  await page.keyboard.press('u');
  await expect(page.getByText('UNLINK FROM THE GOOGLE DRIVE OF CHOSEN ONE?')).toBeVisible();
  await expect(page.locator('.menu li.selected')).toContainText('No, keep the link');
  await page.keyboard.press('y');
  await expect(page.getByText('Unlinked in this browser. Other browsers you linked stay linked')).toBeVisible();
  expect(drive.linked).toBe(true);
  // The client is kept for the next time.
  await expect(page.getByLabel('Client ID')).toHaveValue(drive.clientId);

  // Linked again, and this time Google is asked to end every link.
  await page.keyboard.press('3');
  await expect(page.getByText('YOUR CODE:')).toBeVisible();
  drive.approve();
  await expect(page.getByText('Linked to the Google Drive of Chosen One.')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('u');
  await page.keyboard.press('e');
  await expect(page.getByText("Google has ended the console's access to your Drive, in every browser.")).toBeVisible();
  expect(drive.linked).toBe(false);
  await page.goto('#/');
  await expect(page.getByText('NOTHING IS UPLOADED')).toBeVisible();
});

test('says what is wrong with a client of the wrong kind, or a project without the Drive API', async ({ page, context }) => {
  const drive = new FakeDrive();
  drive.clientType = 'web';
  await standIn(context, drive);
  await openConsole(page, 'settings/cloud/drive');
  await page.getByLabel('Client ID').fill(drive.clientId);
  await page.getByLabel('Client secret').fill(drive.clientSecret);
  await page.getByLabel('Client secret').press('Escape');
  await page.keyboard.press('3');
  await expect(page.getByRole('status')).toContainText('create one of the type "TVs and Limited Input devices"');

  drive.clientType = 'tv';
  drive.apiEnabled = false;
  await page.keyboard.press('3');
  await expect(page.getByText('YOUR CODE:')).toBeVisible();
  drive.approve();
  await expect(page.getByRole('status')).toContainText('The Google Drive API is not switched on in your Google Cloud project', { timeout: 15_000 });
  await expect(page.locator('.board')).toContainText('NOT LINKED');
});

test('carries saves to another browser through Google Drive', async ({ page, context }) => {
  const drive = new FakeDrive();
  await standIn(context, drive);
  await linkConsole(page, drive);

  await page.goto('#/saves/fo2');
  await expect(page.locator('.menu li').filter({ hasText: 'Fetch from Google Drive' })).toBeVisible();
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: saveZip('03', 'before the temple') });
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();

  await expect(page.getByText('Upload them to Google Drive [U] to keep a copy.')).toBeVisible();
  await page.keyboard.press('u');
  await expect(page.getByText('1 save uploaded to Google Drive.')).toBeVisible();
  await expect(page.getByText('LAST EXPORTED JUST NOW, TO GOOGLE DRIVE.')).toBeVisible();
  expect(drive.paths).toEqual(['/Saves/Fallout 2/SLOT03.zip']);
  expect(drive.root).toMatchObject({ name: 'Overseer Console', parents: ['my-drive'] });
  await page.keyboard.press('u');
  await expect(page.getByText('Google Drive already holds every save that is in this browser.')).toBeVisible();

  // Another browser, linked to the same Drive, holding nothing.
  await forgetSaves(page);
  await expect(page.getByText('NO SAVED GAMES YET')).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.getByText('1 save fetched from Google Drive.')).toBeVisible();
  const slot = page.locator('.menu li').first();
  await expect(slot).toContainText('before the temple');

  // Played on elsewhere, and uploaded from there.
  drive.put('/Saves/Fallout 2/SLOT03.zip', saveZip('03', 'through the temple'), new Date(Date.now() + 60_000).toISOString());
  await page.keyboard.press('u');
  await expect(page.getByRole('status')).toContainText('SLOT 03 is newer in Google Drive and was left alone: fetch it first.');
  await page.keyboard.press('f');
  await expect(page.getByText('SLOT 03 HOLDS AN OLDER SAVE IN THIS BROWSER.')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('1 save fetched from Google Drive.')).toBeVisible();
  await expect(slot).toContainText('through the temple');
  await page.keyboard.press('3');
  await page.keyboard.press('v');
  await expect(page.locator('.menu-note')).toContainText('Replaced by a save fetched from Google Drive');
  await page.keyboard.press('Escape');

  // Erased here, erased there: into Drive's trash.
  await page.keyboard.press('d');
  await expect(page.getByText('Its copy in your Google Drive is erased as well.')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('SLOT 03 erased, here and in Google Drive.')).toBeVisible();
  expect(drive.paths).toEqual([]);
  expect([...drive.items.values()].some((item) => item.name === 'SLOT03.zip' && item.trashed)).toBe(true);
});

test('says so when Google has ended the link', async ({ page, context }) => {
  const drive = new FakeDrive();
  await standIn(context, drive);
  await linkConsole(page, drive);
  await page.goto('#/saves/fo2');
  await expect(page.locator('.menu li').filter({ hasText: 'Fetch from Google Drive' })).toBeVisible();

  // The player removes the console's project from their Google Account.
  drive.disconnectApp();
  await page.keyboard.press('f');
  await expect(page.getByRole('status')).toContainText('Google no longer accepts this link');
  await expect(page.locator('.menu li').filter({ hasText: 'Keep saves in your cloud' })).toContainText('NOT LINKED');
});

test('puts a game in Google Drive from this device, for another device to load from there', async ({ page, context, browserName }) => {
  const drive = new FakeDrive();
  await standIn(context, drive);
  await linkConsole(page, drive);

  // A game the player uploaded with Google's own website is out of the console's sight.
  drive.putByPlayer('/Fallout 2/master.dat', 'not seen');
  await page.goto('#/fo2');
  await page.locator('.menu button', { hasText: 'Load holodisk from Google Drive' }).click();
  await expect(page.getByRole('alert')).toContainText('No MASTER.DAT in the Overseer Console folder in your Google Drive, of what the console can see there.');
  await expect(page.getByRole('alert')).toContainText('Put Fallout 2 there with Put in Google Drive');

  // Put in Google Drive: the folder, packed into one zip on the way. Larger than a piece (8 MB), so it goes in two,
  // with Drive's 308 between them. Playwright cannot answer WebKit with a 308, so there the game fits in one piece.
  const pieces = browserName === 'webkit' ? 1 : 2;
  await page.goto('#/settings/cloud');
  await page.keyboard.press('p');
  await expect(page.getByRole('heading', { name: 'Put in Google Drive' })).toBeVisible();
  await expect(page.locator('.board')).toContainText('NONE');
  /** A Fallout 2 archive: its last four bytes hold its size. */
  const dat2 = (size: number) => {
    const data = Buffer.alloc(size, 0x2a);
    data.writeUInt32LE(16, size - 8);
    data.writeUInt32LE(size, size - 4);
    return data;
  };
  const folder = await writeFolder(
    {
      'master.dat': dat2(pieces === 2 ? 12 << 20 : 3 << 20),
      'critter.dat': dat2(4096),
      'patch000.dat': dat2(4096),
      'fallout2.cfg': '[system]\r\nlanguage=english\r\n',
      'sound/music/01hub.acm': Buffer.alloc(2048, 1),
    },
    'Fallout 2',
  );
  await page.keyboard.press('1');
  await pickFolder(page, folder);
  const done = page.getByRole('status').filter({ hasText: 'Fallout 2.zip (' });
  await expect(done).toContainText('is in your Google Drive. On any device linked to it, the game\'s deck loads it: Load holodisk from Google Drive.', { timeout: 60_000 });
  await expect(page.locator('.board .held')).toContainText('Fallout 2.zip');
  const zip = unzipSync(drive.file('/Fallout 2.zip')!.data);
  expect(Object.keys(zip).sort()).toEqual(['Fallout 2/critter.dat', 'Fallout 2/fallout2.cfg', 'Fallout 2/master.dat', 'Fallout 2/patch000.dat', 'Fallout 2/sound/music/01hub.acm']);
  expect(drive.calls.filter((call) => call === 'upload:piece')).toHaveLength(pieces);

  // The same again: asked first.
  await page.keyboard.press('1');
  await pickFolder(page, folder);
  await expect(page.getByText('YOUR GOOGLE DRIVE ALREADY HOLDS FALLOUT 2.ZIP')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu li').first()).toContainText('A game: select its folder');

  // On the deck, from there.
  await page.goto('#/fo2');
  await page.locator('.menu button', { hasText: 'Load holodisk from Google Drive' }).click();
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status')).toContainText('4 files');
});

test('loads Fallout Et Tu from the Mods folder of Google Drive', async ({ page, context }) => {
  const drive = new FakeDrive();
  await standIn(context, drive);
  await linkConsole(page, drive);
  await page.goto('#/mods/load');
  await expect(page.locator('.menu li').filter({ hasText: 'From Google Drive' })).not.toContainText('NOT LINKED');
  await page.keyboard.press('3');
  await expect(page.getByText('There are no mods in /Mods in the Overseer Console folder in your Google Drive.')).toBeVisible();
  await expect(page.getByText('Put each one there with Put in Google Drive')).toBeVisible();
  await page.keyboard.press('Escape');

  drive.put('/Mods/Fallout1in2.zip', fakeEttuZip({ extracted: true, forEngine: true }).buffer);
  await page.keyboard.press('3');
  await expect(page.getByText('IN /MODS IN YOUR GOOGLE DRIVE:')).toBeVisible();
  await expect(page.locator('.menu .label')).toHaveText(['Fallout1in2.zip', 'Back'], { ignoreCase: true });
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  // The report's last line comes a moment later and moves the menu down: the menu is clicked once it has.
  await expect(page.getByRole('status')).toContainText('21 files');
  await expect(page.getByRole('status')).toContainText('can be switched on under Components');
  await page.locator('.menu button', { hasText: 'Holodisk' }).click();
  await expect(page.locator('.menu li').filter({ hasText: 'Replace holodisk from Google Drive' })).toBeVisible();
});

test('a game on its way to Google Drive can be called off, and nothing of it is left there', async ({ page, context }) => {
  const drive = new FakeDrive();
  const line: { held: Promise<void> | null } = { held: null };
  await standIn(context, drive, line);
  await linkConsole(page, drive);
  await page.goto('#/settings/cloud/put');
  await expect(page.getByRole('heading', { name: 'Put in Google Drive' })).toBeVisible();

  // Its pieces are held on the way, however fast this browser packs and sends.
  let letGo = () => {};
  line.held = new Promise((resolve) => (letGo = resolve));
  await page.keyboard.press('1');
  await pickFolder(page, await fakeFallout2Folder());
  await expect(page.getByText('SENDING FALLOUT 2.ZIP TO GOOGLE DRIVE')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('x');
  await expect(page.getByText('STOP PUTTING FALLOUT 2.ZIP IN YOUR GOOGLE DRIVE?')).toBeVisible();
  await expect(page.locator('.menu li.selected')).toContainText('No, carry on');
  await page.keyboard.press('y');
  await expect(page.getByText('Stopped. Nothing of Fallout 2.zip was left in your Google Drive.')).toBeVisible({ timeout: 30_000 });
  expect(drive.paths).toEqual([]);
  letGo();
});
