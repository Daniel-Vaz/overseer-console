import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Download, Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { readCatalog, type Catalog } from '../../src/lib/modify/catalog';
import { readParty } from '../../src/lib/modify/party';
import { readSave, type Original } from '../../src/lib/modify/record';
import { parseSaveHeader } from '../../src/lib/savefile';
import type { GameData } from '../../src/lib/gamedata';
import { registerMod } from '../../src/lib/games';
import { folderGameData, layeredGameData } from '../gamedata';
import { recruit } from '../party';
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

// What the test reads of Fallout Et Tu itself, it reads as a mod of Fallout 2, as the console does.
registerMod({ id: 'ettu', known: 'ettu', title: 'Fallout Et Tu', base: 'fo2', donor: 'fo1' });

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

/** Slot 7's files, by way of the archives' export. */
async function slot7Files(page: Page, game: string): Promise<Record<string, Uint8Array>> {
  await page.goto(`#/saves/${game}/7`);
  await expect(page.locator('.menu li', { hasText: 'Export this save' })).toBeVisible();
  const download: Promise<Download> = page.waitForEvent('download');
  await page.keyboard.press('e');
  const archive = unzipSync(new Uint8Array(readFileSync(await (await download).path())));
  return Object.fromEntries(Object.entries(archive).filter(([path]) => /SLOT07\//i.test(path)));
}

/** Slot 7's SAVE.DAT. */
async function slot7(page: Page, game: string): Promise<Uint8Array> {
  const files = await slot7Files(page, game);
  return files[Object.keys(files).find((path) => /SAVE\.DAT$/i.test(path))!]!;
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
  await page.keyboard.press('7');
  await page.keyboard.press('a');
  await page.keyboard.type('stimpak');
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toContainText('Stimpak');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  // Karma: more of it, and a kill.
  await page.keyboard.press('6');
  await cursorTo(page, 'Karma');
  await page.keyboard.press('ArrowRight');
  await cursorTo(page, 'Men');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  // Pip-Boy: the first quest that is not done, crossed out.
  await page.keyboard.press('9');
  await page.keyboard.press('Home');
  for (let step = 0; step < 40; step++) {
    if (/^(NOT SHOWN|OPEN)$/.test(((await selected(page).locator('.value').textContent()) ?? '').trim())) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('c');
  await expect(selected(page).locator('.value')).toHaveText('DONE');
  await page.keyboard.press('0');
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
  // The world as well: the quest and the karma (the variables the editor changed), the kills.
  const changed = written.record.globals.flatMap((value, index) => (value !== before.record.globals[index] ? [index] : []));
  expect(changed).toHaveLength(2);
  for (const index of changed) expect(again.record.globals[index]).toBe(written.record.globals[index]);
  expect(written.record.kills[0]).toBe(before.record.kills[0]! + 2);
  expect(again.record.kills).toEqual(written.record.kills);
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

/**
 * A companion changed in the console, and the game as the judge again: the
 * quick save's creature taken into the party (tests/party.ts) in slot 3,
 * healed and given stimpaks, loaded, and quick saved from inside the game.
 */
async function companionTrip(page: Page, game: 'fo1' | 'fo2', title: RegExp, data: () => Promise<GameData>): Promise<void> {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await newGame(page);
  await quickSave(page);
  await leave(page, title);
  const gameData = await data();
  const catalog = await readCatalog(gameData);
  const { files, id } = await recruit(await slot7Files(page, game), game, gameData, catalog);
  const slot3 = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path.replace(/SLOT07/i, 'SLOT03'), bytes]));
  await page.goto(`#/saves/${game}`);
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'party.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(slot3)) });
  await expect(page.getByText(/restored from the archive/)).toBeVisible();

  await page.goto(`#/saves/${game}/modify/3`);
  await expect(selected(page)).toContainText('Name');
  await page.keyboard.press('8');
  await expect(selected(page)).toContainText('Hit points');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('a');
  await page.keyboard.type('stimpak');
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toContainText('Stimpak');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.keyboard.press('w');
  await expect(page.getByText(/SLOT 03 MODIFIED/)).toBeVisible();

  await page.goto(`#/saves/${game}/3`);
  await launch(page, 'Load this save', 'l');
  await waitForPicture(page, 6000);
  await quickSave(page);
  await leave(page, title);
  const again = await slot7Files(page, game);
  const save = again[Object.keys(again).find((path) => /SAVE\.DAT$/i.test(path))!]!;
  const kindOf = (pid: number) => catalog.items.get(pid)?.kind;
  const members = readSave(save, game, kindOf).map.rest!.party.members;
  expect(members).toContain(id);
  const entries = Object.entries(again).map(([path, bytes]) => ({ key: path.toLowerCase().replace(/^savegame/, 'data/savegame'), path, data: bytes }));
  const party = await readParty(gameData, catalog, entries, 'data/savegame/slot07/', parseSaveHeader(save)!.map, members);
  const member = party!.members.find((entry) => entry.id === id)!;
  const stimpak = [...catalog.items.values()].find((item) => item.name === 'Stimpak')!.pid;
  // The game kept what the editor wrote: one hit point less, two stimpaks more.
  expect(member.record.hitPoints).toBeLessThan(member.maxHitPoints);
  expect(member.record.items.filter((entry) => entry.pid === stimpak).reduce((sum, entry) => sum + entry.quantity, 0)).toBe(2);
  expect(faults).toEqual([]);
}

for (const [game, title, dir, data] of [
  ['fo1', 'Fallout', FO1, () => folderGameData('fo1', FO1!, ['master.dat', 'critter.dat'])],
  ['fo2', 'Fallout 2', FO2, () => folderGameData('fo2', FO2!, ['patch000.dat', 'f2_res.dat', 'critter.dat', 'master.dat'])],
] as const) {
  test(`${title}: a companion changed in the console is the one the game plays`, async ({ page }) => {
    test.skip(!dir, `set ${game.toUpperCase()}_DIR to your ${title} folder to run this`);
    test.setTimeout(600_000);
    await openConsole(page, game, { skipIntro: true });
    await pickFolder(page, dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
    await companionTrip(page, game, new RegExp(`${title}$`), data);
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
  await page.goto('#/mods/load');
  await pickFolder(page, ETTU!);
  await expect(page.getByRole('heading', { name: 'Fallout Et Tu' })).toBeVisible({ timeout: 900_000 });
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
