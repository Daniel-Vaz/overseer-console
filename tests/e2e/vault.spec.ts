import type { Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { arrange, DOOR_HEIGHT, DOOR_WIDTH, MONITOR, lampOver, type Layout } from '../../src/launcher/vault/layout';
import { expect, test } from './fixtures';
import { fakeSaveDat, openConsole } from './helpers';

/** A window with room around the console, and one without. */
const LARGE = { width: 1920, height: 1080 };
const SMALL = { width: 1280, height: 800 };

/**
 * How long to wait for something that takes the vault a few seconds of its
 * own time. A browser that is short of breath draws fewer pictures a second,
 * and the vault's clock runs no faster than its pictures.
 */
const SLOWLY = 40_000;

/** What the vault's canvas holds: how many different colours, and a sum that changes when the picture does. */
async function picture(page: Page): Promise<{ colours: number; sum: number }> {
  return page.locator('canvas.vault').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<number>();
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const colour = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      sum = (sum + colour * ((i >> 2) % 251)) % 2147483647;
      if (i % 28 === 0) seen.add(colour);
    }
    return { colours: seen.size, sum };
  });
}

/**
 * Where things stand in the room, worked out the way the room itself does it,
 * and a way to turn one of its places into a place on the page.
 */
async function room(page: Page): Promise<{ layout: Layout; at: (x: number, y: number) => [number, number] }> {
  const seen = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.vault')!;
    const bounds = canvas.getBoundingClientRect();
    const housing = document.querySelector('.housing')!.getBoundingClientRect();
    const cell = bounds.width / canvas.width;
    return {
      width: canvas.width,
      height: canvas.height,
      cell,
      left: bounds.left,
      top: bounds.top,
      console: {
        x: Math.round((housing.left - bounds.left) / cell),
        y: Math.round((housing.top - bounds.top) / cell),
        width: Math.round(housing.width / cell),
        height: Math.round(housing.height / cell),
      },
    };
  });
  return {
    layout: arrange(seen.width, seen.height, seen.console),
    at: (x, y) => [seen.left + (x + 0.5) * seen.cell, seen.top + (y + 0.5) * seen.cell],
  };
}

/**
 * Opens the console in a window with the vault around it, and waits until
 * the vault is painted. Nobody is let into it for a while, so that a press
 * meant for a lamp does not land on something that happened to walk past.
 */
async function openVault(page: Page, route = ''): Promise<void> {
  await page.setViewportSize(LARGE);
  await openConsole(page, route);
  await expect(page.locator('canvas.vault')).toHaveClass(/showing/);
  await expect.poll(async () => (await picture(page)).colours).toBeGreaterThan(200);
  await request(page, 'nobody');
}

/**
 * Has the browser say of its storage what a test needs it to say: `sealed`
 * is what it answers when asked, `granting` what it does when asked to seal.
 * Both can be changed while the page runs. Set on the kind of object, since
 * not every browser lets the one object be told otherwise.
 */
async function fakeSeal(page: Page, sealed: boolean, granting = false): Promise<void> {
  await page.addInitScript(
    ([sealed, granting]) => {
      const world = window as unknown as { sealed: boolean; granting: boolean };
      world.sealed = sealed!;
      world.granting = granting!;
      const answers = {
        persisted: () => Promise.resolve(world.sealed),
        persist: () => Promise.resolve((world.sealed = world.sealed || world.granting)),
      };
      for (const [name, value] of Object.entries(answers)) Object.defineProperty(StorageManager.prototype, name, { configurable: true, writable: true, value });
    },
    [sealed, granting],
  );
}

/** Asks something of the vault, the way a curious visitor could from the browser's own console. */
async function request(page: Page, detail: string): Promise<void> {
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent('overseer:vault', { detail })), detail);
}

test('a window larger than the console shows the vault around it, and things come through', async ({ page }) => {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await page.setViewportSize(LARGE);
  await openConsole(page);
  const vault = page.locator('canvas.vault');
  await expect(vault).toHaveClass(/showing/);
  await expect.poll(async () => (await picture(page)).colours).toBeGreaterThan(200);
  // Coarse pixels, enlarged: the canvas holds far fewer than the window has.
  expect(await vault.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThan(LARGE.width / 2);

  // The lamps alone keep the picture changing.
  const before = (await picture(page)).sum;
  await expect.poll(async () => (await picture(page)).sum).not.toBe(before);

  // Every sort of visitor, all at once: none of them may trip the page up.
  for (const visit of ['ghoul', 'stare', 'glowing', 'molerat', 'pack', 'radroach', 'swarm', 'dog', 'eyes']) {
    await page.evaluate((detail) => window.dispatchEvent(new CustomEvent('overseer:vault', { detail })), visit);
  }
  await page.waitForTimeout(4000);
  expect(faults).toEqual([]);
  // The console in front of it all works as before.
  await page.keyboard.press('6');
  await expect(page.getByRole('heading', { name: 'Operations manual' })).toBeVisible();

  // With no room to show, it is not painted at all.
  await page.setViewportSize(SMALL);
  await expect(vault).not.toHaveClass(/showing/);
  await page.setViewportSize(LARGE);
  await expect(vault).toHaveClass(/showing/);
  expect(faults).toEqual([]);
});

test('the vault holds still for those who have asked for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(LARGE);
  await openConsole(page);
  await expect(page.locator('canvas.vault')).toHaveClass(/showing/);
  await expect.poll(async () => (await picture(page)).colours).toBeGreaterThan(200);
  const before = (await picture(page)).sum;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('overseer:vault', { detail: 'molerat' })));
  await page.waitForTimeout(1500);
  expect((await picture(page)).sum).toBe(before);
});

test('the vault can be switched off in the settings, and stays off', async ({ page }) => {
  await page.setViewportSize(LARGE);
  await openConsole(page, 'settings');
  await expect(page.locator('canvas.vault')).toHaveClass(/showing/);
  const entry = page.locator('.menu li').filter({ hasText: 'Vault around the console' });
  await expect(entry).toContainText('ON');
  await page.keyboard.press('v');
  await expect(entry).toContainText('OFF');
  await expect(page.locator('canvas.vault')).toHaveCount(0);

  await page.reload();
  await expect(entry).toContainText('OFF');
  await expect(page.locator('canvas.vault')).toHaveCount(0);
  await page.keyboard.press('v');
  await expect(page.locator('canvas.vault')).toHaveClass(/showing/);
});

test('things in the vault answer to being pressed, and the nameplate says what they made of it', async ({ page }) => {
  await fakeSeal(page, false);
  await openVault(page);
  const vault = page.locator('canvas.vault');
  const plate = page.locator('.nameplate');
  await expect(plate).toHaveText('OVERSEER CONSOLE');
  const { layout, at } = await room(page);

  // The monitor has two channels and a rest: every press moves it on by one.
  const channels = ['PLEASE STAND BY.', 'OVERSEER ON DUTY', 'MONITOR: STANDBY'];
  const monitor = at(layout.monitor!.x + MONITOR.width / 2, layout.monitor!.y + MONITOR.height / 2);
  await page.mouse.click(...monitor);
  await expect.poll(async () => channels.indexOf((await plate.textContent()) ?? '')).toBeGreaterThanOrEqual(0);
  const first = channels.indexOf((await plate.textContent())!);
  for (const turn of [1, 2]) {
    await page.mouse.click(...monitor);
    await expect(plate).toHaveText(channels[(first + turn) % channels.length]!);
  }

  // The cursor shows what can be touched, and what cannot.
  await page.mouse.move(...monitor);
  await expect.poll(() => vault.evaluate((canvas: HTMLCanvasElement) => canvas.style.cursor)).toBe('pointer');
  await page.mouse.move(...at(layout.console.x + layout.console.width + 6, layout.floor - 100));
  await expect.poll(() => vault.evaluate((canvas: HTMLCanvasElement) => canvas.style.cursor)).toBe('');

  // The lamp over the way out has a switch.
  const lamp = layout.lamps[0]!;
  await page.mouse.click(...at(lamp.x, lamp.y + 2));
  await expect(plate).toHaveText('LAMP 01: OFFLINE');
  await page.mouse.click(...at(lamp.x, lamp.y + 2));
  await expect(plate).toHaveText('LAMP 01: ONLINE.');

  // Most of the quarters are empty. Behind the one door with a light still on, somebody puts it out.
  const rooms = layout.doorways.map((door, index) => ({ door, number: String(index + 1).padStart(2, '0') })).filter(({ door }) => door.level === 1);
  const knock = async (door: Layout['doorways'][number]) => page.mouse.click(...at(door.x + DOOR_WIDTH / 2, layout.decks[0]! - DOOR_HEIGHT / 2));
  const kept = rooms.find(({ door }) => door.state === 'shut' && door.lit !== 'dead')!;
  const empty = rooms.find(({ door }) => door.state !== 'shut')!;
  // How red the picture is where the lamp over that door burns: a good deal while it does, hardly at all once it is out.
  const bulb = lampOver(layout, kept.door)!;
  const glow = () => vault.evaluate((canvas: HTMLCanvasElement, [x, y]) => canvas.getContext('2d')!.getImageData(x!, y!, 1, 1).data[0]!, [bulb.x, bulb.y + 2]);
  await expect.poll(glow).toBeGreaterThan(150);
  await knock(kept.door);
  await expect(plate).toHaveText(`ROOM ${kept.number}: GO AWAY`);
  await expect.poll(glow).toBeLessThan(100);
  await knock(empty.door);
  await expect(plate).toHaveText(`ROOM ${empty.number}: VACANT.`);

  // The joint in the pipes that drips can be made to drip faster.
  await page.mouse.click(...at(layout.drip.x, layout.drip.from + 20));
  await expect(plate).toHaveText('DO NOT DRINK IT.');

  // Somebody sits by that door who would rather be left alone.
  await page.mouse.click(...at(layout.skeleton + 12, layout.floor - 6));
  await expect(plate).toHaveText('LEAVE HIM ALONE.');

  // The storage is not sealed, so the great door stands open and there is only the tunnel to call into.
  await page.mouse.click(...at(layout.portal, layout.gear.y));
  await expect(plate).toHaveText('HELLO? ...HELLO?');

  // Having said its piece, the plate goes back to the console's name.
  await expect(plate).toHaveText('OVERSEER CONSOLE', { timeout: 8000 });
});

test('a sealed vault keeps its great door shut: knock, and something knocks back', async ({ page }) => {
  await fakeSeal(page, true);
  await openVault(page);
  const plate = page.locator('.nameplate');
  await expect(page.locator('.board')).toContainText('SEALED');
  const { layout, at } = await room(page);
  await page.mouse.click(...at(layout.gear.x + 10, layout.gear.y + 10));
  await expect(plate).toHaveText('KNOCK, KNOCK...?');
  await expect(plate).toHaveText('SOMEONE IS HOME.');
});

test('sealing the storage rolls the great door shut; a seal that is refused leaves it jammed open', async ({ page }) => {
  await fakeSeal(page, false);
  await openVault(page, 'settings');
  const plate = page.locator('.nameplate');
  const entry = page.locator('.menu li').filter({ hasText: 'Seal private storage' });
  await expect(entry).toContainText('NOT SEALED');

  await page.keyboard.press('l');
  await expect(plate).toHaveText('DOOR JAMMED OPEN');
  await expect(entry).toContainText('NOT SEALED');

  await page.evaluate(() => ((window as unknown as { granting: boolean }).granting = true));
  await page.keyboard.press('l');
  await expect(entry).toContainText('SEALED');
  // It takes its time: a door like that does not hurry.
  await expect(plate).toHaveText('VAULT DOOR: SHUT', { timeout: SLOWLY });

  // And being shut, it can be knocked on.
  const { layout, at } = await room(page);
  await page.mouse.click(...at(layout.gear.x + 10, layout.gear.y + 10));
  await expect(plate).toHaveText('KNOCK, KNOCK...?');
});

test('an unsealed store is pointed out once it holds something, and the console says what that means', async ({ page }) => {
  await fakeSeal(page, false);
  await openConsole(page);
  const settings = page.locator('.menu li').filter({ hasText: 'Terminal settings' });
  const seal = page.locator('.board dd').last();
  // With nothing kept here there is nothing a browser could clear: no warning on a first visit.
  await expect(seal).toHaveText('OPEN');
  await expect(seal).not.toHaveClass(/amber/);
  await expect(settings).not.toContainText('NOT SEALED');

  await page.goto('#/saves/fo2');
  const archive = zipSync({ 'SAVEGAME/SLOT01/SAVE.DAT': new Uint8Array(fakeSaveDat('Narg', 'worth keeping')) });
  await page.locator('input[accept*="zip"]').setInputFiles({ name: 'saves.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByText('1 save restored from the archive.')).toBeVisible();
  await page.goto('#/');
  await expect(settings).toContainText('STORAGE NOT SEALED');
  await expect(seal).toHaveClass(/amber/);
  // The entry says what it is about and where to mend it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu li.selected')).toContainText('Terminal settings');
  await expect(page.locator('.menu-note')).toContainText('a browser short of disk space may clear the games and saves kept here');

  // Sealed, there is nothing to point out. (The archives look at the store again as they open.)
  await page.evaluate(() => ((window as unknown as { sealed: boolean }).sealed = true));
  await page.goto('#/saves/fo2');
  await expect(page.locator('.menu li').first()).toContainText('SLOT 01');
  await page.goto('#/');
  await expect(seal).toHaveText('SEALED');
  await expect(settings).not.toContainText('NOT SEALED');
});

test('holding Shift and asking for the credits brings the whole cast through', async ({ page }) => {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await openVault(page);
  await page.keyboard.press('End');
  await expect(page.locator('.menu li.selected')).toContainText('Credits and legal');
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByRole('heading', { name: 'Credits and legal' })).toBeVisible();
  await expect(page.locator('.nameplate')).toHaveText('ROLL THE CREDITS');
  await page.waitForTimeout(2500);
  expect(faults).toEqual([]);

  // Without Shift the credits are just the credits.
  await page.keyboard.press('Escape');
  await expect(page.locator('.nameplate')).toHaveText('OVERSEER CONSOLE', { timeout: 8000 });
  await page.keyboard.press('7');
  await expect(page.getByRole('heading', { name: 'Credits and legal' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('.nameplate')).toHaveText('OVERSEER CONSOLE');
});

test('a radroach comes out onto the glass, even where no vault shows; it can be squashed, and the count is kept', async ({ page }) => {
  await page.setViewportSize(SMALL);
  await openConsole(page);
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  const pest = page.locator('.pest');
  const plate = page.locator('.nameplate');
  await expect(pest).not.toHaveClass(/out/);

  const squash = async () => {
    await request(page, 'pest');
    await expect(pest).toHaveClass(/out/);
    const box = (await pest.boundingBox())!;
    await pest.dispatchEvent('pointerdown', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true });
  };
  await squash();
  await expect(plate).toHaveText('RADROACHES: 0001');
  // What is left of it wears off the glass.
  await expect(pest).not.toHaveClass(/out/, { timeout: SLOWLY });

  // The count outlasts the visit.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  await squash();
  await expect(plate).toHaveText('RADROACHES: 0002');
  await expect(pest).not.toHaveClass(/out/, { timeout: SLOWLY });

  // It does not wait to be caught: a key is enough to send it running, and then nothing is counted.
  await expect(plate).toHaveText('OVERSEER CONSOLE', { timeout: 8000 });
  await request(page, 'pest');
  await expect(pest).toHaveClass(/out/);
  await page.keyboard.press('ArrowDown');
  await expect(pest).not.toHaveClass(/out/, { timeout: SLOWLY });
  await expect(plate).toHaveText('OVERSEER CONSOLE');
  // The console under it was in use all the while.
  await expect(page.locator('.menu li.selected')).toContainText('SIMULATION 02');
});

test('the power lamp is a button: off and on again, on a screen of any size', async ({ page }) => {
  await openConsole(page);
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
  const housing = page.locator('.housing');
  await expect(housing).toHaveClass(/warm-up/);
  await page.getByRole('button', { name: 'PWR off and on again' }).click();
  await expect(page.locator('.nameplate')).toHaveText('OFF AND ON AGAIN');
  // The tube has warmed up again, and the console is where it was.
  await expect(housing).toHaveClass(/warm-up/);
  await expect(page.locator('.menu button')).toHaveCount(7);
  await page.keyboard.press('5');
  await expect(page.getByRole('heading', { name: 'Terminal settings' })).toBeVisible();
});
