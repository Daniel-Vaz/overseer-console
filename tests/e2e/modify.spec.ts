import type { Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { buildSave, type Item } from '../saves';
import { expect, test } from './fixtures';
import { EDITOR_ITEMS, fakeFallout2ForEditor, openConsole, pickFolder } from './helpers';

/**
 * The save editor, on made-up game data: a Fallout 2 whose archive holds the
 * words, items and pictures the editor reads, and a save made of them.
 */

const item = (pid: number, quantity = 1, flags?: number, holds?: Item[]): Item => {
  const kind = EDITOR_ITEMS[pid]!.kind;
  const extra = kind === 'weapon' ? [0, -1] : kind === 'ammo' ? [24] : kind === 'misc' || kind === 'key' ? [0] : [];
  return { pid, kind, quantity, flags, extra, holds };
};

/** Slot 2: Narg, level 3, a knife in hand, leather armour on, ammunition, stimpaks, money and a bag. */
function save(items: Item[] = [item(4, 1, 0x02000000), item(1, 1, 0x04000000), item(29, 2), item(40, 3), item(41, 120), item(46, 1, undefined, [item(40, 1)])]): Uint8Array {
  return buildSave({
    game: 'fo2',
    items,
    special: [6, 7, 5, 4, 8, 7, 5],
    maxHitPoints: 32,
    hitPoints: 25,
    base: { 8: 8, 9: 7, 11: 1, 12: 175, 13: 14, 14: 1, 15: 5, 31: 10, 32: 25, 33: 25 },
    tagged: [0, 8, 14, -1],
    perks: { 50: 1 },
    stats: [7, 3, 3500, 0, 0],
    traits: [-1, -1],
  });
}

async function furnish(page: Page, saves: Record<string, Uint8Array> = { 'SAVEGAME/SLOT02/SAVE.DAT': save() }): Promise<void> {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2ForEditor());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto('#/saves/fo2');
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(saves)) });
  await expect(page.getByText(/restored from the archive/)).toBeVisible();
}

const selected = (page: Page) => page.locator('.ledger li.selected');
const row = (page: Page, label: string | RegExp) => page.locator('.ledger li', { has: page.locator('.label', { hasText: label }) });

/** Moves the cursor down to the line with this label. */
async function cursorTo(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Home');
  for (let step = 0; step < 150; step++) {
    if (((await selected(page).locator('.label').textContent()) ?? '').trim().toLowerCase() === label.toLowerCase()) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`no line called ${label}`);
}

test('changes a character in every section and writes it into its slot', async ({ page }) => {
  await furnish(page);
  await page.keyboard.press('2');
  await expect(page.locator('.menu li', { hasText: 'Modify this save' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page).toHaveURL(/#\/saves\/fo2\/modify\/2$/);
  await expect(page.getByRole('heading', { name: 'Modify save: SLOT 02' })).toBeVisible();
  await expect(page.locator('.modify-who')).toContainText('Narg, LEVEL 3');
  // The card shows the game's own picture, drawn in phosphor.
  await expect(page.locator('.board.card img')).toBeVisible();

  // Record: a name typed, two levels more, the hit points they bring.
  await expect(selected(page)).toContainText('Name');
  await page.keyboard.press('Enter');
  await page.locator('.value-input').fill('Albert');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Name').locator('.value')).toHaveText('Albert');
  await cursorTo(page, 'Level');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.modify-who')).toContainText('LEVEL 5');
  // Endurance 5: four hit points a level.
  await expect(row(page, 'Hit points').locator('.value')).toHaveText('33 / 40');
  await expect(row(page, 'Experience').locator('.value')).toHaveText('10,000');

  // S.P.E.C.I.A.L.: more strength, and what follows from it worked out again.
  await page.keyboard.press('2');
  await expect(selected(page)).toContainText('Strength');
  await page.keyboard.press('ArrowRight');
  await expect(selected(page).locator('.value')).toContainText('7');
  await expect(page.locator('.derived dd').nth(3)).toContainText('200');
  await expect(page.locator('.derived dd').nth(3)).toContainText('was 175');

  // Skills: Small Guns untagged, Lockpick tagged; a value typed.
  await page.keyboard.press('3');
  await expect(selected(page).locator('.sign')).toHaveText('*');
  await page.keyboard.press('t');
  await expect(selected(page).locator('.sign')).toHaveText('');
  await cursorTo(page, 'Lockpick');
  await page.keyboard.press('t');
  await expect(selected(page).locator('.sign')).toHaveText('*');
  // A fourth needs the Tag! perk.
  await cursorTo(page, 'Science');
  await page.keyboard.press('t');
  await expect(page.locator('.modify-message')).toContainText('Three skills are tagged already');
  await page.keyboard.press('Enter');
  await page.locator('.value-input').fill('60');
  await page.keyboard.press('Enter');
  await expect(selected(page).locator('.value')).toHaveText(/^6[01]%$/);

  // Traits: two at most.
  await page.keyboard.press('4');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.modify-message')).toContainText('two traits at most');
  await expect(page.locator('.ledger .sign', { hasText: '*' })).toHaveCount(2);

  // Perks: Toughness, two ranks; what it asks for on the card.
  await page.keyboard.press('5');
  await cursorTo(page, 'Toughness');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(selected(page).locator('.value')).toHaveText('2/3');
  await expect(page.locator('.board.card .needs')).toContainText('Level 3');
  // Only the perks taken.
  await page.keyboard.press('f');
  await expect(page.locator('.chip')).toHaveText('[F] TAKEN');
  await expect(page.locator('.ledger li .label')).toHaveText(['Perks owed', 'Toughness', 'Perk Number 50']);

  // Inventory: more stimpaks from the list of everything, the ammunition taken out, the knife in hand left alone.
  await page.keyboard.press('6');
  await expect(page.locator('.modify-status')).toContainText('Money 120');
  await page.keyboard.press('a');
  await expect(page.locator('.picker-search input')).toBeFocused();
  await page.keyboard.type('stim');
  await expect(page.locator('.ledger li .label')).toHaveText(['Stimpak']);
  await page.keyboard.press('Enter');
  await expect(page.locator('.modify-message')).toContainText('Added Stimpak: 4 carried.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.picker-search')).toHaveCount(0);
  await expect(row(page, 'Stimpak').locator('.value')).toHaveText('×4');
  await cursorTo(page, '10mm JHP');
  await page.keyboard.press('d');
  await expect(row(page, '10mm JHP')).toHaveCount(0);
  await cursorTo(page, 'Knife');
  await page.keyboard.press('d');
  await expect(page.locator('.modify-message')).toContainText('in hand: take it off in the game first');
  await expect(row(page, 'Knife').locator('.value')).toHaveText('IN HAND');

  // Write: the changes listed, one undone, the rest written.
  await page.keyboard.press('7');
  await expect(page.locator('.ledger li', { hasText: 'Name Narg → Albert' })).toBeVisible();
  await expect(page.locator('.ledger li', { hasText: 'Took out 2 × 10mm JHP' })).toBeVisible();
  await page.locator('.ledger li', { hasText: 'Took out 2 × 10mm JHP' }).locator('.main').click();
  await page.locator('.ledger li.selected .main').click();
  await expect(page.locator('.ledger li', { hasText: 'Took out' })).toHaveCount(0);
  await expect(page.locator('.modify-who')).toContainText('NOT WRITTEN');
  await page.keyboard.press('w');
  await expect(page.getByText(/SLOT 02 MODIFIED: \d+ changes written\./)).toBeVisible();

  // Back in the archives: the save as written, and the one it replaced kept.
  await page.keyboard.press('0');
  await expect(page).toHaveURL(/#\/saves\/fo2\/2$/);
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText(/Level\s*5/);
  await expect(sheet).toContainText('Toughness x2');
  await expect(page.locator('.readout')).toContainText('Albert');
  await expect(page.locator('.menu li', { hasText: 'Earlier versions' })).toContainText('1 KEPT');
  await page.keyboard.press('v');
  await expect(page.locator('.menu-note')).toContainText('Replaced when the save was modified');
  // ESC goes back from the slot to the list.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/saves\/fo2$/);
});

test('asks before leaving with changes not written, and leaves the save as it was', async ({ page }) => {
  await furnish(page);
  await page.goto('#/saves/fo2/modify/2');
  await expect(selected(page)).toContainText('Name');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.modify-who')).toContainText('1 CHANGE NOT WRITTEN');
  await page.keyboard.press('Escape');
  await expect(page.getByText('DISCARD 1 CHANGE NOT WRITTEN?')).toBeVisible();
  await page.keyboard.press('n');
  await expect(selected(page)).toContainText('Gender');
  await expect(selected(page).locator('.value')).toHaveText('Female');
  await page.keyboard.press('Escape');
  await page.keyboard.press('y');
  await expect(page).toHaveURL(/#\/saves\/fo2\/2$/);
  await expect(page.locator('.menu li', { hasText: 'Earlier versions' })).toContainText('NONE YET');
});

test('refuses a save it cannot account for, and says why', async ({ page }) => {
  // Item 999 is nothing the game knows.
  await furnish(page, { 'SAVEGAME/SLOT03/SAVE.DAT': save([item(40, 2), { pid: 999, kind: 'drug' }]) });
  await page.goto('#/saves/fo2/modify/3');
  await expect(page.getByRole('alert')).toContainText("cannot be changed safely: the game's data does not describe item 999");
  await page.keyboard.press('0');
  await expect(page).toHaveURL(/#\/saves\/fo2\/3$/);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('is worked with fingers', async ({ page }) => {
    await furnish(page);
    await page.goto('#/saves/fo2/modify/2');
    // One section at a time, with a way to either side.
    await expect(page.locator('.section-switch')).toContainText('Record');
    await page.locator('.section-switch button').last().tap();
    await expect(page.locator('.section-switch')).toContainText('S.P.E.C.I.A.L.');
    // A tap on a line picks it, the steps change it.
    await row(page, 'Luck').locator('.main').tap();
    await expect(selected(page)).toContainText('Luck');
    await row(page, 'Luck').locator('.step').last().tap();
    await expect(row(page, 'Luck').locator('.value')).toContainText('6');
    // The card's buttons do what keys do.
    await page.locator('.section-switch button').last().tap();
    await page.locator('.card-button').tap();
    await expect(page.locator('.ledger .sign', { hasText: '*' })).toHaveCount(2);
  });
});

test('fits every window, the list under the cursor in view', async ({ page }) => {
  await furnish(page);
  for (const [width, height] of [[1280, 800], [1536, 730], [1366, 650], [1920, 950], [2560, 1300], [820, 1180], [390, 844], [844, 390]] as const) {
    await page.setViewportSize({ width, height });
    for (const section of ['1', '5', '6', '7']) {
      await page.goto('#/saves/fo2/modify/2');
      await expect(page.locator('.ledger li.selected')).toBeVisible();
      await page.keyboard.press(section);
      await page.keyboard.press('End');
      await page.evaluate(() => document.fonts.ready);
      const at = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('.body')!;
        const list = document.querySelector<HTMLElement>('.modify-list')!.getBoundingClientRect();
        const chosen = document.querySelector('.ledger li.selected')!.getBoundingClientRect();
        const card = document.querySelector('.board.card')!.getBoundingClientRect();
        const tabs = [...document.querySelectorAll<HTMLElement>('.section-tab')].filter((tab) => tab.offsetParent);
        const strip = document.querySelector('.sections')!.getBoundingClientRect();
        return {
          over: body.scrollHeight - body.clientHeight,
          inView: chosen.top >= list.top - 1 && chosen.bottom <= list.bottom + 1,
          card: card.height > 20,
          tabsCut: tabs.filter((tab) => tab.getBoundingClientRect().right > strip.right + 1).length,
          rows: Math.floor(list.height / chosen.height),
        };
      });
      const where = `section ${section} at ${width} x ${height}`;
      expect(at.over, `${where}: runs off the tube`).toBeLessThanOrEqual(1);
      expect(at.inView, `${where}: the cursor is out of view`).toBe(true);
      expect(at.card, `${where}: no card`).toBe(true);
      expect(at.tabsCut, `${where}: tabs cut off`).toBe(0);
      expect(at.rows, `${where}: room for lines`).toBeGreaterThanOrEqual(4);
    }
  }
});
