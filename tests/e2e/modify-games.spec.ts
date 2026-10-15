import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Download, Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readCatalog, type Catalog } from '../../src/lib/modify/catalog';
import { readSave, type Original } from '../../src/lib/modify/record';
import type { GameData } from '../../src/lib/gamedata';
import { folderGameData, layeredGameData } from '../gamedata';
import { expect, test } from './fixtures';
import { launch, openConsole, pause, pickFolder, waitForPicture } from './helpers';

/**
 * The save editor with the real games, and the games themselves as the judge:
 * a quick save is changed in the console, loaded in the game, and saved again
 * from inside it. What the game then writes is what it understood the changed
 * save to be; it must be what the editor wrote.
 *
 *   FO1_DIR=... FO2_DIR=... [ETTU=<zip or folder>] npm run test:e2e -- modify-games
 *
 * Fallout Et Tu takes many minutes to put together, as in game.spec.ts.
 */

// Whole games are copied in, more than one for Fallout Et Tu: storage on disk (see fixtures.ts).
test.use({ onDisk: true });

const FO1 = process.env.FO1_DIR;
const FO2 = process.env.FO2_DIR;
const ETTU = process.env.ETTU;

/** Starts a new game with the first ready-made character, past the opening movie. */
async function newGame(page: Page): Promise<void> {
  await launch(page, 'Begin simulation', '1');
  await waitForPicture(page, 4000);
  await page.keyboard.press('n');
  await pause(page, 3500);
  await page.keyboard.press('t');
  await pause(page, 4500);
  await page.keyboard.press('Escape');
  await pause(page, 9000);
}

async function quickSave(page: Page): Promise<void> {
  await pause(page, 1500);
  await page.keyboard.press('F6');
  await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
}

/** Out of the game through the console's own menu. */
async function leave(page: Page, title: RegExp): Promise<void> {
  await page.keyboard.press('F9');
  await expect(page.getByText('Simulation suspended')).toBeVisible();
  await page.keyboard.press('x');
  await page.keyboard.press('y');
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 30_000 });
}

/** Slot 7's SAVE.DAT, by way of the archives' export. */
async function slot7(page: Page, game: string): Promise<Uint8Array> {
  await page.goto(`#/saves/${game}/7`);
  await expect(page.locator('.menu li', { hasText: 'Export this save' })).toBeVisible();
  const download: Promise<Download> = page.waitForEvent('download');
  await page.keyboard.press('e');
  const archive = unzipSync(new Uint8Array(readFileSync(await (await download).path())));
  const name = Object.keys(archive).find((path) => /SLOT07\/SAVE\.DAT$/i.test(path))!;
  return archive[name]!;
}

const selected = (page: Page) => page.locator('.ledger li.selected');

async function cursorTo(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Home');
  for (let step = 0; step < 150; step++) {
    if (((await selected(page).locator('.label').textContent()) ?? '').trim().toLowerCase() === label.toLowerCase()) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`no line called ${label}`);
}

/** Changes the quick save in every section the editor has, and writes it. */
async function modify(page: Page, game: string): Promise<void> {
  await page.goto(`#/saves/${game}/modify/7`);
  await expect(selected(page)).toContainText('Name');
  await page.keyboard.press('Enter');
  await page.locator('.value-input').fill('Tester');
  await page.keyboard.press('Enter');
  await cursorTo(page, 'Level');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await cursorTo(page, 'Unspent skill points');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('2');
  await cursorTo(page, 'Luck');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('3');
  await cursorTo(page, 'Doctor');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('5');
  await cursorTo(page, 'Toughness');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('6');
  await page.keyboard.press('a');
  await page.keyboard.type('stimpak');
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toContainText('Stimpak');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('7');
  await page.keyboard.press('w');
  await expect(page.getByText(/SLOT 07 MODIFIED/)).toBeVisible();
}

/** What a save holds that the editor changed, side by side. */
function sheet(save: Original) {
  const { record } = save;
  return {
    name: record.name,
    special: record.special,
    skills: record.skills,
    tags: record.tags,
    traits: record.traits,
    perks: record.perks,
    level: record.level,
    experience: record.experience,
    unspent: record.unspent,
    base: save.base,
    bonus: save.bonus,
    items: record.items.map((item) => [item.pid, item.quantity]),
  };
}

async function roundTrip(page: Page, game: 'fo1' | 'fo2' | 'ettu', title: RegExp, data: () => Promise<GameData>): Promise<void> {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await newGame(page);
  await quickSave(page);
  await leave(page, title);

  const catalog: Catalog = await readCatalog(await data());
  const layout = game === 'fo1' ? 'fo1' : 'fo2';
  const kindOf = (pid: number) => catalog.items.get(pid)?.kind;
  const before = readSave(await slot7(page, game), layout, kindOf);

  await modify(page, game);
  const written = readSave(await slot7(page, game), layout, kindOf);
  expect(written.record.name).toBe('Tester');
  expect(written.record.level).toBe(before.record.level + 2);
  expect(written.record.special[6]).toBe(before.record.special[6]! + 1);
  expect(written.record.perks[12]).toBe((before.record.perks[12] ?? 0) + 1);
  const stimpak = [...catalog.items.values()].find((item) => item.name === 'Stimpak')!.pid;
  const count = (save: Original) => save.record.items.filter((item) => item.pid === stimpak).reduce((sum, item) => sum + item.quantity, 0);
  expect(count(written)).toBe(count(before) + 2);

  // Into the game with it, and out again by its own quick save.
  await page.goto(`#/saves/${game}/7`);
  await launch(page, 'Load this save', 'l');
  await waitForPicture(page, 6000);
  await quickSave(page);
  await leave(page, title);
  const again = readSave(await slot7(page, game), layout, kindOf);

  // The game read every change, and wrote it back as it was given.
  expect(sheet(again)).toEqual(sheet(written));
  expect(faults).toEqual([]);
}

for (const [game, title, dir, data] of [
  ['fo1', 'Fallout', FO1, () => folderGameData('fo1', FO1!, ['master.dat', 'critter.dat'])],
  ['fo2', 'Fallout 2', FO2, () => folderGameData('fo2', FO2!, ['patch000.dat', 'f2_res.dat', 'critter.dat', 'master.dat'])],
] as const) {
  test(`${title}: a save changed in the console is the save the game plays`, async ({ page }) => {
    test.skip(!dir, `set ${game.toUpperCase()}_DIR to your ${title} folder to run this`);
    test.setTimeout(600_000);
    await openConsole(page, game, { skipIntro: true });
    await pickFolder(page, dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
    await roundTrip(page, game, new RegExp(`${title}$`), data);
  });
}

test('Fallout Et Tu: a save changed in the console is the save the game plays', async ({ page }) => {
  test.skip(!FO1 || !FO2 || !ETTU, 'set FO1_DIR, FO2_DIR and ETTU to run this');
  test.skip(!statSync(ETTU!).isDirectory(), 'ETTU must be the unpacked Fallout1in2 folder here, so that the test can read its items');
  test.setTimeout(1_800_000);
  await openConsole(page, 'fo1', { skipIntro: true });
  await pickFolder(page, FO1!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/fo2');
  await pickFolder(page, FO2!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
  await page.goto('#/ettu');
  await pickFolder(page, ETTU!);
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 900_000 });
  const mods = ['fo1_maps_mountains', 'Anim_ImprovedSMutantDeath', 'fo1_interface', 'fo1_base'];
  await roundTrip(page, 'ettu', /Fallout Et Tu$/, () =>
    layeredGameData('ettu', ETTU!, [
      { folder: join(ETTU!, 'data') },
      ...mods.map((mod) => ({ folder: join(ETTU!, 'mods', mod) })),
      { archive: join(FO2!, 'critter.dat') },
      { archive: join(FO2!, 'master.dat') },
    ]),
  );
});
