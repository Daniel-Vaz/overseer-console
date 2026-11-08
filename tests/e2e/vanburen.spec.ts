import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { junkFolder, openConsole, pickFolder } from './helpers';
import { tempFolder } from './tempdirs';

/**
 * The Van Buren tech demo, apart from the games. Without its files these
 * check its screen and the ways loading it is turned down. With
 * VB_RAR="/path/to/F3_Demo.rar" (as archive.org has it), or VB_DIR (the
 * folder it was unpacked to), the demo is loaded, played to Junktown, and
 * ejected again.
 */

const ARCHIVE_URL = 'https://archive.org/cors/f3demo/F3_Demo.rar';

async function openDemo(page: Page): Promise<void> {
  await openConsole(page, 'vanburen');
  await expect(page.getByRole('heading', { name: 'Simulation 03: Van Buren (2003)' })).toBeVisible();
  await expect(page.getByText('NOT LOADED')).toBeVisible();
}

test('stands beside the two decks on the main directory, on a key of its own', async ({ page }) => {
  await openConsole(page);
  const entry = page.locator('.menu li', { hasText: 'SIMULATION 03: Van Buren (2003)' });
  await expect(entry).toContainText('NOT LOADED');
  // Under the decks, before the Mod library, whose key is still 3.
  await expect(page.locator('.menu li').nth(2)).toContainText('SIMULATION 03');
  await expect(page.locator('.menu li').nth(3)).toContainText('Mod library');
  await page.keyboard.press('v');
  await expect(page.getByRole('heading', { name: 'Simulation 03: Van Buren (2003)' })).toBeVisible();
  await expect(page.locator('.bar')).toContainText('PROTOTYPE // VAN BUREN');
  await expect(page.locator('.menu li').first()).toContainText('Fetch from the Internet Archive');
  await expect(page.locator('.menu li').first()).toContainText('241.7 MB');
  await page.keyboard.press('a');
  await expect(page.getByText('Black Isle Studios was making Fallout 3')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('NOT LOADED')).toBeVisible();
  await page.keyboard.press('0');
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
});

test('turns down a file that is not a RAR archive', async ({ page }) => {
  await openDemo(page);
  const folder = tempFolder();
  const fake = join(folder, 'F3_Demo.rar');
  writeFileSync(fake, Buffer.alloc(4096, 0x41));
  await page.locator('input[accept=".rar"]').setInputFiles(fake);
  await expect(page.getByText('ARCHIVE REJECTED')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('That is not a RAR archive the console can read.')).toBeVisible();
  await expect(page.getByText('NOT LOADED')).toBeVisible();
});

test('turns down a folder without the tech demo in it', async ({ page }) => {
  await openDemo(page);
  await pickFolder(page, junkFolder());
  await expect(page.getByText('ARCHIVE REJECTED')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('The Van Buren tech demo is not in what you selected')).toBeVisible();
});

test('says so when the download from the Internet Archive breaks off', async ({ page, context }) => {
  await context.route(ARCHIVE_URL, (route) =>
    route.fulfill({ status: 200, body: Buffer.alloc(100_000, 0x52), headers: { 'access-control-allow-origin': '*' } }),
  );
  await openDemo(page);
  await page.keyboard.press('1');
  await expect(page.getByText('ARCHIVE REJECTED')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('the download broke off after 100000 of 253425960 bytes')).toBeVisible();
  // Nothing was kept of it.
  await expect(page.getByText('NOT LOADED')).toBeVisible();
});

const SOURCES = [
  { name: 'its archive', env: 'VB_RAR', source: process.env.VB_RAR },
  { name: 'its unpacked folder', env: 'VB_DIR', source: process.env.VB_DIR },
];

for (const { name, env, source } of SOURCES) {
  test(`loads the tech demo from ${name}, plays it to Junktown, and ejects it`, async ({ page }) => {
    test.skip(!source, `set ${env} to run this`);
    test.setTimeout(600_000);
    const log: string[] = [];
    page.on('console', (message) => log.push(message.text()));

    await openDemo(page);
    if (env === 'VB_RAR') await page.locator('input[accept=".rar"]').setInputFiles(source!);
    else await pickFolder(page, source!);
    await expect(page.getByText('TECH DEMO LOADED')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByText('THE ARCHIVE.ORG RELEASE')).toBeVisible();
    await expect(page.getByText('29 files, 560.1 MB')).toBeVisible();

    await page.keyboard.press('1');
    await page.waitForURL(/vanburen\.html/);
    await expect(page.getByText('Prototype ready')).toBeVisible({ timeout: 120_000 });
    await page.keyboard.press('Space');
    await expect.poll(() => log.some((line) => /\[engine\] Mainmenu: \d+ triangles/.test(line)), { timeout: 120_000 }).toBe(true);
    await page.waitForTimeout(3000);

    // Start New Game, the first of the demo's own buttons.
    const canvas = await page.locator('#canvas').boundingBox();
    await page.mouse.move(canvas!.x + 265, canvas!.y + 50);
    await page.waitForTimeout(300);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => log.some((line) => /\[engine\] 03_Tutorial_Junktown: \d+ triangles/.test(line)), { timeout: 180_000 }).toBe(true);

    // The console's own menu over it, and the way back.
    await page.keyboard.press('F9');
    await expect(page.getByText('Simulation suspended')).toBeVisible();
    await page.keyboard.press('x');
    await expect(page.getByText('End simulation?')).toBeVisible();
    await page.keyboard.press('y');
    await expect(page.getByRole('heading', { name: 'Simulation 03: Van Buren (2003)' })).toBeVisible();
    // Once the console has looked in storage again.
    await expect(page.getByText('THE ARCHIVE.ORG RELEASE')).toBeVisible();

    await page.keyboard.press('2');
    await page.keyboard.press('e');
    await expect(page.getByText('EJECT THE TECH DEMO?')).toBeVisible();
    await page.keyboard.press('y');
    await expect(page.getByText('NOT LOADED')).toBeVisible();
  });
}
