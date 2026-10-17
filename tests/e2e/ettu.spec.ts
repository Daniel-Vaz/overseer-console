import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { zipSync } from 'fflate';
import { fakeEttuZip, fakeFallout1Folder, fakeFallout2Folder, fakeFallout2WithEttu, fakeSaveDat, openConsole, pickFolder, zipFolder } from './helpers';

/**
 * Fallout Et Tu: a mod of Fallout 2 the console puts together from its package
 * and the two games. These run on made-up data, which is enough for everything
 * up to the moment the engine is started; playing it needs the real thing
 * (see game.spec.ts).
 */

const loaded = (page: Page) => expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });

async function loadDeck(page: Page, deck: 'fo1' | 'fo2', folder: string): Promise<void> {
  await page.goto(`#/${deck}`);
  await pickFolder(page, folder);
  await loaded(page);
}

/** What the installed copy of a game holds in the browser's private file system. */
async function stored(page: Page, game: string): Promise<{ files: string[]; directory: Record<string, string[]> }> {
  return page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await (await root.getDirectoryHandle('overseer-console')).getDirectoryHandle('games')).getDirectoryHandle(id);
    const current = JSON.parse(await (await (await dir.getFileHandle('current.json')).getFile()).text());
    const install = await dir.getDirectoryHandle(current.install);
    const manifest = JSON.parse(await (await (await install.getFileHandle('manifest.json')).getFile()).text());
    const pack = new Uint8Array(await (await (await install.getFileHandle('pack.bin')).getFile()).arrayBuffer());
    // The names in the directory of every archive the import made. (The made-up Fallout 2 has none worth reading.)
    const directory: Record<string, string[]> = {};
    for (const file of manifest.files as { path: string; pack?: [number, number] }[]) {
      if (id !== 'ettu' || !file.pack || (!file.path.startsWith('mods/') && !file.path.endsWith('.dat')) || /\.(txt|ini)$/.test(file.path)) continue;
      const data = pack.subarray(file.pack[0], file.pack[0] + file.pack[1]);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let at = data.length - 8 - view.getUint32(data.length - 8, true);
      const names: string[] = [];
      const count = view.getUint32(at, true);
      at += 4;
      for (let i = 0; i < count; i++) {
        const length = view.getUint32(at, true);
        names.push(String.fromCharCode(...data.subarray(at + 4, at + 4 + length)));
        at += 4 + length + 13;
      }
      directory[file.path] = names;
    }
    return { files: (manifest.files as { path: string }[]).map((file) => file.path).sort(), directory };
  }, game);
}

test('the Mod library says what Fallout Et Tu is put together from', async ({ page }) => {
  await openConsole(page);
  const entry = page.locator('.menu li').nth(2);
  await expect(entry).toContainText('Mod library');
  await expect(entry).toContainText('EMPTY');
  await page.keyboard.press('3');
  await expect(page.getByRole('heading', { name: 'Mod library' })).toBeVisible();
  await expect(page.getByText('OVERSEER CONSOLE // MOD LIBRARY')).toBeVisible();

  // The mods it knows, Et Tu among them, with what each is built from.
  await page.keyboard.press('k');
  await expect(page.getByRole('heading', { name: 'Mods the console knows' })).toBeVisible();
  await page.locator('.menu button', { hasText: 'Fallout Et Tu' }).click();
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible();
  const readout = page.locator('.readout').first();
  await expect(readout).toContainText('FALLOUT 2, DECK B');
  await expect(readout).toContainText('FALLOUT, DECK A, WHILE IT IS LOADED');
  await expect(readout).toContainText('TESTED HERE');
  await expect(page.locator('.menu li').filter({ hasText: 'Get Fallout Et Tu' })).toContainText('OPENS A NEW TAB');
  await expect(page.getByText('Hand the console: Fallout1in2.zip as it is downloaded')).toBeVisible();
});

test('puts Fallout Et Tu together from its zip and the two games, and starts its engine', async ({ page }) => {
  await openConsole(page, 'mods/load');
  const zip = page.locator('input[accept*="zip"]');

  // Its speech and movies come out of Fallout: without that in its deck there is nothing to take them from.
  await zip.setInputFiles(fakeEttuZip());
  await expect(page.getByText('HOLODISK REJECTED')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Load Fallout into deck A first');

  await loadDeck(page, 'fo1', await fakeFallout1Folder());
  await page.goto('#/mods/load');
  await zip.setInputFiles(fakeEttuZip());
  // Known for what it is, it is shown on a page of its own.
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);
  const status = page.getByRole('status');
  await expect(status).toContainText('21 files');
  await expect(status).toContainText('3 files taken from your Fallout in deck A.');
  await expect(status).toContainText('2 optional parts switched off in mods_order.txt can be switched on under Components.');
  // A package from before Et Tu took up the engine is loaded, with a word of caution.
  await expect(status).toContainText('no fallout2-ce.exe');

  // Stored as archives where it was folders: its mods, those switched off as well, and what was borrowed.
  const ettu = await stored(page, 'ettu');
  expect(ettu.files).toEqual([
    'config/Perks.ini',
    'config/fo1_settings.ini',
    'data/sound/music/01HUB.ACM',
    'data/text/english/Translations.ini',
    'ddraw.ini',
    'f2_res.ini',
    'fallout1.dat',
    'mods/InterfaceUpscaled',
    'mods/fo1_base',
    'mods/fo1_interface',
    'mods/fo1_lang_german',
    'mods/mods_order.txt',
    'mods/sfall-mods.ini',
  ]);
  expect(ettu.directory['fallout1.dat']).toEqual(['ART\\CUTS\\INTRO.MVE', 'ART\\TILES\\EDG5000.FRM', 'SOUND\\SPEECH\\OVR\\OVR1.ACM']);
  expect(ettu.directory['mods/fo1_base']).toContain('scripts\\gl_fo1mechanics.int');
  expect(ettu.directory['mods/fo1_interface']).toEqual(['art\\intrface\\IFACE.FRM']);

  // It is loaded, and cannot play: the game it is played on is not here.
  await expect(page.locator('.readout').first()).toContainText('FALLOUT 2, DECK B: NOT LOADED');
  const begin = page.locator('.menu li').filter({ hasText: 'Begin simulation' });
  await expect(begin).toContainText('NEEDS DECK B');
  await expect(begin.locator('button')).toBeDisabled();
  await page.goto('#/');
  await expect(page.locator('.menu li').nth(2)).toContainText('1 MOD');
  await page.goto('#/mods');
  await expect(page.locator('.menu li').filter({ hasText: 'Fallout Et Tu' })).toContainText('NEEDS DECK B');

  await loadDeck(page, 'fo2', await fakeFallout2Folder());
  await page.goto('#/mods');
  await expect(page.locator('.menu li').filter({ hasText: 'Fallout Et Tu' })).toContainText('READY');
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible();
  await expect(page.locator('.readout').first()).toContainText('FALLOUT 2, DECK B: LOADED');
  await expect(begin.locator('button')).toBeEnabled();
  // Nobody chose a picture here: Et Tu starts at the one it is laid out for.
  await expect(page.locator('.menu li').filter({ hasText: 'Picture' })).toContainText('HIGH RESOLUTION');
  await page.waitForTimeout(1500);
  await page.keyboard.press('1');
  await page.waitForURL(/play\.html\?game=ettu$/);

  // The engine of Fallout 2 is up, with Et Tu's files and the archives of the game underneath.
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('SIMULATION 02 ready')).toBeVisible();
  await expect(page.locator('#bar-title')).toHaveText('OVERSEER CONSOLE // SIMULATION 02 // ET TU');
  await expect(page.getByText('Fallout Et Tu - Fallout 2 Community Edition')).toBeVisible();
  const game = await page.evaluate(() => {
    const { FS } = (window as unknown as { overseerEngine: { module: { FS: { analyzePath(path: string): { exists: boolean }; readFile(path: string): Uint8Array } } } }).overseerEngine.module;
    const paths = ['fo2/master.dat', 'fo2/critter.dat', 'fo2/sound/music/01hub.acm', 'fo2/patch000.dat', 'mods/fo1_base', 'mods/mods_order.txt', 'fallout1.dat', 'ce.dat', 'config/fo1_settings.ini', 'ddraw.ini', 'data/SAVEGAME'];
    const base = FS.readFile('/game/ce.dat');
    return {
      exists: Object.fromEntries(paths.map((path) => [path, FS.analyzePath(`/game/${path}`).exists])),
      config: new TextDecoder().decode(FS.readFile('/game/fallout2.cfg')),
      lights: new TextDecoder().decode(FS.readFile('/game/mods/sfall-mods.ini')),
      // The engine's own data file is an archive: its last four bytes hold its size.
      engineData: new DataView(base.buffer, base.byteOffset, base.byteLength).getUint32(base.length - 4, true) === base.length,
    };
  });
  // Fallout 2's own patch archive is not part of Et Tu, and stays out.
  expect(game.exists).toEqual({
    'fo2/master.dat': true,
    'fo2/critter.dat': true,
    'fo2/sound/music/01hub.acm': true,
    'fo2/patch000.dat': false,
    'mods/fo1_base': true,
    'mods/mods_order.txt': true,
    'fallout1.dat': true,
    'ce.dat': true,
    'config/fo1_settings.ini': true,
    'ddraw.ini': true,
    'data/SAVEGAME': true,
  });
  expect(game.engineData).toBe(true);
  expect(game.config).toContain('master_dat=fo2\\master.dat');
  expect(game.config).toContain('critter_dat=fo2\\critter.dat');
  expect(game.config).toContain('critter_patches=fallout1.dat');
  expect(game.config).toContain('music_path1=data\\sound\\music\\');
  expect(game.config).toContain('music_path2=fo2\\sound\\music\\');
  // What the package's own settings file says about the player is kept.
  expect(game.config).toContain('text_base_delay=3.5');
  // Half as tall again as the original, and as wide as the window's shape allows.
  expect(game.config).toContain('resolution_x=1152');
  expect(game.config).toContain('resolution_y=720');
  // The package ships the left CTRL key for lighting things up, and lights nothing
  // it cannot shoot at. The console's own key and rules stand in all three games.
  expect(game.lights).toContain('[Highlighting]\r\nKey=42\r\n');
  expect(game.lights).toContain('Containers=1');
  expect(game.lights).toContain('CheckLOS=0');

  // Its saves are its own.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible();
  await page.goto('#/saves');
  await expect(page.locator('.menu button')).toContainText(['Fallout', 'Fallout 2', 'Fallout Et Tu', 'Back']);
  await page.keyboard.press('3');
  await expect(page.getByRole('heading', { name: 'Save archives: Fallout Et Tu' })).toBeVisible();
  const save = zipSync({ 'SAVEGAME/SLOT01/SAVE.DAT': new Uint8Array(fakeSaveDat('Albert', 'outside the vault')) });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(save) });
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();
  // The picture of a save is drawn with the colours, and its character described in the
  // words, of the conversion's own archive: not of the Fallout 2 it runs on.
  await expect(page.locator('canvas.thumb')).toBeVisible();
  const facts = await page.evaluate(() => JSON.parse(localStorage.getItem('overseer-console:facts:ettu') ?? 'null') as { perks: string[]; traits: string[]; skills: string[] } | null);
  expect(facts?.perks).toHaveLength(119);
  expect(facts?.perks[0]).toBe('Et Tu perk 0');
  expect(facts?.traits[13]).toBe('Night Person');
  expect(facts?.skills).toHaveLength(18);
  // And it can be continued from, like any other.
  await page.goto('#/');
  await expect(page.locator('.menu li').first()).toContainText('Continue: Fallout Et Tu');
});

test('finds Et Tu inside the Fallout 2 folder and offers it without a second pick', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2WithEttu());
  await loaded(page);
  // Fallout 2 took its own five files and nothing of the mod.
  await expect(page.getByRole('status')).toContainText('5 files');
  await expect(page.getByRole('status')).toContainText('FALLOUT ET TU IS IN THAT FOLDER AS WELL.');
  expect((await stored(page, 'fo2')).files).toEqual(['critter.dat', 'data/worldmap.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm']);

  const offer = page.locator('.menu li').filter({ hasText: 'Load Fallout Et Tu from the same folder' });
  await expect(offer).toBeVisible();
  await page.keyboard.press('e');
  // The console follows the mod to its own page.
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible();
  await loaded(page);
  // Its own tool had been run in the folder: nothing needed taking from Fallout, which is not even loaded.
  await expect(page.getByRole('status')).not.toContainText('taken from your Fallout');
  await expect(page.getByRole('status')).not.toContainText('fallout2-ce.exe');
  expect((await stored(page, 'ettu')).directory['fallout1.dat']).toEqual(['ART\\CUTS\\INTRO.MVE', 'ART\\TILES\\EDG5000.FRM', 'SOUND\\SPEECH\\OVR\\OVR1.ACM']);
  await expect(page.locator('.menu li').filter({ hasText: 'Begin simulation' }).locator('button')).toBeEnabled();
});

test('one pick of that folder in the Mod library loads the game it is played on first', async ({ page }) => {
  await openConsole(page, 'mods/load');
  await pickFolder(page, await fakeFallout2WithEttu());
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);
  await expect(page.locator('.readout').first()).toContainText('FALLOUT 2, DECK B: LOADED');
  await page.goto('#/');
  await expect(page.locator('.menu li').nth(1)).toContainText('READY');
  await expect(page.locator('.menu li').nth(2)).toContainText('1 MOD');

  // Ejecting the game underneath is allowed, and said to leave the mod stranded.
  await page.keyboard.press('2');
  await page.locator('.menu button', { hasText: 'Holodisk' }).click();
  await page.keyboard.press('e');
  await expect(page.getByText('EJECT THE FALLOUT 2 HOLODISK?')).toBeVisible();
  await expect(page.getByText('Fallout Et Tu, in the Mod library, is played on this holodisk, and will not start without it.')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByText('NOT LOADED')).toBeVisible();
  await page.goto('#/mods');
  await expect(page.locator('.menu li').filter({ hasText: 'Fallout Et Tu' })).toContainText('NEEDS DECK B');
  // Asked to play all the same, the player page hands back to the mod's page, which says what is missing.
  await page.goto('play.html?game=ettu');
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible();
  await expect(page.locator('.readout').first()).toContainText('FALLOUT 2, DECK B: NOT LOADED');
});

test('a deck plays the mod put in it, and goes back to the game as it was sold', async ({ page }) => {
  await openConsole(page, 'fo1');
  await loadDeck(page, 'fo1', await fakeFallout1Folder());
  await loadDeck(page, 'fo2', await fakeFallout2Folder(true));
  const mod = page.locator('.menu li').filter({ has: page.locator('.label', { hasText: /^Mod$/ }) });
  await expect(mod).toContainText('NONE');
  await expect(page.locator('.menu-note')).toBeVisible();
  // No mod for it yet: the entry leads to the library.
  await page.keyboard.press('2');
  await expect(page.getByRole('heading', { name: 'Mod library' })).toBeVisible();
  await page.keyboard.press('l');
  await page.locator('input[accept*="zip"]').setInputFiles(fakeEttuZip({ forEngine: true }));
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 60_000 });
  await loaded(page);

  // Not in the deck until it is put there, on its page or on the deck.
  const inDeck = page.locator('.menu li').filter({ hasText: 'In deck B' });
  await expect(inDeck).toContainText('NO');
  await page.goto('#/fo2');
  await expect(mod).toContainText('NONE');
  await page.keyboard.press('2');
  await expect(mod).toContainText('ET TU');
  await expect(page.locator('.readout').first()).toContainText('Mod FALLOUT ET TU');
  // The deck's picture and saves are the mod's now.
  await expect(page.locator('.menu li').filter({ hasText: 'Picture' })).toContainText('HIGH RESOLUTION');
  await page.goto('#/');
  await expect(page.locator('.menu li').nth(1)).toContainText('READY, ET TU');
  await page.goto('#/mods/ettu');
  await expect(inDeck).toContainText('YES');

  // Begun from the deck, the mod plays; left, the console is back on the deck.
  await page.goto('#/fo2');
  await page.waitForTimeout(1500);
  await page.keyboard.press('1');
  await page.waitForURL(/play\.html\?game=ettu&from=fo2$/);
  await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
  await expect(page.locator('.menu li.selected')).toContainText('Begin simulation');

  // One key back to the game as it was sold.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu li.selected')).toContainText('Mod');
  await page.keyboard.press('ArrowRight');
  await expect(mod).toContainText('NONE');
  await expect(page.locator('.menu li').filter({ hasText: 'Picture' })).toContainText('CLASSIC 4:3');
  await page.goto('#/mods/ettu');
  await expect(inDeck).toContainText('NO');
  await page.keyboard.press('2');
  await expect(inDeck).toContainText('YES');
});

test('saves of Fallout Et Tu from the days of its own deck are found in the Mod library', async ({ page }) => {
  await openConsole(page);
  await expect(page.locator('.menu li').nth(2)).toContainText('EMPTY');
  // As an earlier console kept them: in the overlay under its name, with nothing that says it is a mod.
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('overseer-console', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('overlay', { keyPath: ['game', 'key'] });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('overlay', 'readwrite');
      tx.objectStore('overlay').put({ game: 'ettu', key: 'data/savegame/slot01/save.dat', path: 'data/SAVEGAME/SLOT01/SAVE.DAT', mtime: Date.now(), deleted: false, data: new Uint8Array(data) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.removeItem('overseer-console:mods');
  }, [...fakeSaveDat('Albert', 'before the move')]);
  await page.reload();
  await expect(page.locator('.menu li').first()).not.toContainText('Continue');
  await page.goto('#/mods');
  const entry = page.locator('.menu li').filter({ hasText: 'Fallout Et Tu' });
  await expect(entry).toContainText('NO HOLODISK');
  await entry.locator('button').click();
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible();
  await expect(page.locator('.menu li').filter({ hasText: 'Save archives' })).toContainText('1 SAVE');
  await page.locator('.menu button', { hasText: 'Save archives' }).click();
  await expect(page.getByRole('heading', { name: 'Save archives: Fallout Et Tu' })).toBeVisible();
  await expect(page.locator('.menu li').first()).toContainText('before the move');
});

test('either game loads from one zip of its folder as well', async ({ page }) => {
  await openConsole(page, 'fo2');
  // The deck offers it next to the folder, and says a zip may be dropped too.
  await expect(page.locator('.menu li').nth(1)).toContainText('Load holodisk: select a zip of the game folder');
  await expect(page.getByText('OR DROP THE GAME FOLDER, OR A ZIP OF IT, ANYWHERE ON THIS SCREEN.')).toBeVisible();
  const zip = page.locator('input[accept*="zip"]');
  await zip.setInputFiles(zipFolder(await fakeFallout2Folder(), 'Fallout 2'));
  await loaded(page);
  await expect(page.getByRole('status')).toContainText('5 files');
  expect((await stored(page, 'fo2')).files).toEqual(['critter.dat', 'data/worldmap.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm']);

  // Loaded, it can be replaced the same way; a file that is no zip is refused like a folder that holds no game.
  await page.locator('.menu button', { hasText: 'Holodisk' }).click();
  await expect(page.locator('.menu li').filter({ hasText: 'Replace holodisk: select a zip of the game folder' })).toBeVisible();
  await zip.setInputFiles({ name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all') });
  await expect(page.getByRole('alert')).toContainText('notes.zip: That file is not a zip archive.');

  // The other game, and where no folder can be picked at all: the same zip through the plain file picker.
  await page.goto('#/fo1');
  await expect(page.locator('.menu li').nth(1)).toContainText('Load holodisk: select a zip of the game folder');
  await page.locator('input[type="file"][multiple]:not([webkitdirectory])').setInputFiles(zipFolder(await fakeFallout1Folder(), 'Fallout'));
  await loaded(page);
  expect((await stored(page, 'fo1')).files).toEqual(['CRITTER.DAT', 'DATA/SOUND/MUSIC/01HUB.ACM', 'MASTER.DAT']);
});

/**
 * The engine itself, on made-up data: both games' archives are real archives
 * with no game in them, so the engine opens everything, finds nothing to
 * show, and gives up. How far it gets says whether it could read what the
 * console put together. The first thing it needs is a font; the only one
 * there is has to come all the way out of Fallout's MASTER.DAT.
 *
 * Giving up is told on the console's own fault screen, in the engine's
 * words where it had any: never in a message box of the browser's, and never
 * by dropping the player back on the deck without a word.
 */
for (const borrowed of [false, true]) {
  test(`the engine ${borrowed ? 'reads a file the console took out of Fallout for it' : 'is told when a file it needs is nowhere'}`, async ({ page }) => {
    const dialogs: string[] = [];
    const said: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message().trim());
      void dialog.dismiss().catch(() => undefined);
    });
    // The package's settings ask the engine to say what it does; the player page passes that on.
    page.on('console', (message) => {
      if (message.text().startsWith('[engine] ')) said.push(message.text().slice(9));
    });

    await openConsole(page, 'fo1');
    await loadDeck(page, 'fo1', await fakeFallout1Folder());
    await loadDeck(page, 'fo2', await fakeFallout2Folder(true));
    await page.goto('#/mods/load');
    await page.locator('input[accept*="zip"]').setInputFiles(fakeEttuZip({ forEngine: true, engineLog: true, borrow: borrowed ? ['FONT0.FON'] : [] }));
    await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 60_000 });
    await loaded(page);
    await page.waitForTimeout(1500);
    await page.keyboard.press('1');
    await page.waitForURL(/play\.html\?game=ettu$/);
    await expect(page.getByText('PRESS ANY KEY')).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Enter');
    const fault = page.locator('#terminal-body');
    await expect(fault).toContainText('System fault', { timeout: 60_000 });
    await expect(page.locator('#bar-state')).toHaveText('FAULT');

    // It opened its own data file, and both mods where the load order names folders.
    const log = said.join('\n');
    expect(log).toContain('Loading base FO:CE mod: ce.dat');
    expect(log).toContain('Loading mod mods/fo1_base');
    expect(log).toContain('Loaded 2 mods from mods/mods_order.txt');
    expect(log).not.toContain('Error opening');
    if (borrowed) {
      // With its font the engine gets further, to a game that is not there, and stops without a word of its own.
      await expect(fault).not.toContainText(/font/i);
      await expect(fault).toContainText('Fallout Et Tu stopped by itself before it was up.');
    } else {
      await expect(fault).toContainText("Fallout Et Tu stopped. The engine reports: Couldn't find/load text fonts");
    }
    // Either way it stopped while starting, and the screen says what that points at.
    await expect(fault).toContainText("which points at the mod's files");
    // The browser's own message box never came up.
    expect(dialogs).toEqual([]);

    // From there it is one key back to the mod's page.
    await page.keyboard.press('c');
    await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible();
  });
}
