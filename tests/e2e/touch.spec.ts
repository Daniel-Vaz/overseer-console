import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeFallout2Folder, openConsole } from './helpers';

/**
 * Playing by touch, on a screen the size of a phone held sideways.
 *
 * The first tests need nothing but the build. The last ones play the real
 * games with fingers only and need your own copies:
 *   FO1_DIR="/path/to/Fallout" FO2_DIR="/path/to/Fallout 2" npm run test:e2e
 */
test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

// Where things are in each game's 640x480 picture: the round "new game" button
// of the main menu, and a quiet piece of ground near where the game starts.
type Point = [x: number, y: number];
const GAMES: { id: string; title: string; dir?: string; newGame: Point; ground: Point }[] = [
  { id: 'fo1', title: 'Fallout', dir: process.env.FO1_DIR, newGame: [438, 99], ground: [420, 270] },
  { id: 'fo2', title: 'Fallout 2', dir: process.env.FO2_DIR, newGame: [43, 72], ground: [470, 190] },
];

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

test('the console can be worked with a finger', async ({ page }) => {
  await openConsole(page);
  await page.locator('.menu button', { hasText: 'Terminal settings' }).tap();
  await expect(page.getByRole('heading', { name: 'Terminal settings' })).toBeVisible();

  // The one setting that only matters on a touch screen is offered here.
  const pointer = page.locator('.menu li', { hasText: 'Touch pointer' });
  await expect(pointer).toContainText('FOLLOWS FINGER');
  await pointer.locator('button').tap();
  await expect(pointer).toContainText('TRACKPAD');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('overseer-console:settings')!).touchPointer)).toBe('trackpad');

  await page.locator('.menu button', { hasText: 'Back' }).tap();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
});

test('on a phone the start gate asks for a tap and makes room for the touch deck', async ({ page }) => {
  await openConsole(page, 'fo2');
  await page.locator('input[type=file]').first().setInputFiles(fakeFallout2Folder());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await pause(page, 1500);
  await page.locator('.menu button', { hasText: 'Begin simulation' }).tap();
  await page.waitForURL(/play\.html/);

  await expect(page.getByText('TAP TO BEGIN')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('body')).toHaveClass(/touch/);
  // The picture is fitted between the two strips of buttons.
  const stage = (await page.locator('#stage').boundingBox())!;
  expect(stage.x).toBeGreaterThan(50);
  expect(stage.x + stage.width).toBeLessThan(844 - 50);

  await page.getByRole('button', { name: 'Back to console' }).tap();
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
});

// ---------------------------------------------------------------------
// The real games, by touch alone
// ---------------------------------------------------------------------

/** A point of the game's 640x480 picture, in page coordinates. */
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.locator('#canvas').boundingBox())!;
  return [box.x + (x / 640) * box.width, box.y + (y / 480) * box.height];
}

async function tap(page: Page, x: number, y: number): Promise<void> {
  await page.touchscreen.tap(...(await at(page, x, y)));
}

/** Brightness of the picture on a 32x24 grid (see game.spec.ts). */
async function fingerprint(page: Page): Promise<number[]> {
  const box = (await page.locator('#canvas').boundingBox())!;
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, 32, 24);
    const pixels = context.getImageData(0, 0, 32, 24).data;
    const cells: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) cells.push((pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3);
    return cells;
  }, png.toString('base64'));
}

const brightness = (cells: number[]): number => cells.reduce((sum, value) => sum + value, 0) / cells.length;

function distance(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length;
}

/** The pixels of a small square of the picture around a game point. */
async function patch(page: Page, x: number, y: number, size = 44): Promise<Buffer> {
  const [cx, cy] = await at(page, x, y);
  return page.screenshot({ clip: { x: cx - size / 2, y: cy - size / 2, width: size, height: size } });
}

/** Fingers Playwright itself cannot move: several at once, and drags. Chromium only. */
class Fingers {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async on(page: Page): Promise<Fingers> {
    return new Fingers(page, await page.context().newCDPSession(page));
  }

  private send(type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]): Promise<unknown> {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })) });
  }

  /** Drags one or two fingers from one game point to another, at the pace of a deliberate hand. */
  async drag(from: Point, to: Point, fingers: 1 | 2): Promise<void> {
    const a = await at(this.page, ...from);
    const b = await at(this.page, ...to);
    const points = (x: number, y: number): [number, number][] => (fingers === 2 ? [[x, y], [x + 70, y]] : [[x, y]]);
    const steps = 30;
    await this.send('touchStart', points(...a));
    for (let step = 1; step <= steps; step++) {
      await pause(this.page, 40);
      await this.send('touchMove', points(a[0] + ((b[0] - a[0]) * step) / steps, a[1] + ((b[1] - a[1]) * step) / steps));
    }
    await pause(this.page, 300);
    await this.lift();
  }

  /** Two fingers down together and up again, as quickly as a tap is. */
  async tapTwo(x: number, y: number): Promise<void> {
    const [cx, cy] = await at(this.page, x, y);
    await this.send('touchStart', [[cx, cy], [cx + 70, cy + 8]]);
    await pause(this.page, 90);
    await this.lift();
  }

  async press(x: number, y: number): Promise<void> {
    await this.send('touchStart', [await at(this.page, x, y)]);
  }

  lift(): Promise<unknown> {
    return this.send('touchEnd', []);
  }
}

for (const game of GAMES) {
  test(`${game.title}: played with fingers only`, async ({ page, browserName }) => {
    test.skip(!game.dir, `set ${game.id.toUpperCase()}_DIR to your ${game.title} folder to run this`);
    const faults: string[] = [];
    page.on('pageerror', (error) => faults.push(error.message));
    const key = (code: string) => page.locator(`#keys button[data-code="${code}"]`);
    const deck = (act: string) => page.locator(`#deck button[data-act="${act}"]`);

    await openConsole(page, game.id, { skipIntro: true });
    await page.locator('input[webkitdirectory]').setInputFiles(game.dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });
    await pause(page, 1500);
    await page.locator('.menu button', { hasText: 'Begin simulation' }).tap();
    await page.waitForURL(/play\.html/);

    // The gate, then the explanation of the controls, shown once.
    await expect(page.getByText(/TAP TO BEGIN|PRESS ANY KEY/)).toBeVisible({ timeout: 60_000 });
    await page.touchscreen.tap(422, 150);
    const gotIt = page.getByRole('button', { name: /Got it/ });
    if (!(await gotIt.isVisible().catch(() => false))) {
      // Not a phone as far as the browser can tell: the deck comes with the first touch.
      await expect(page.locator('#terminal')).toBeHidden();
      await pause(page, 1500);
      await page.touchscreen.tap(422, 150);
    }
    await expect(page.getByText('TOUCH CONTROLS')).toBeVisible();
    await gotIt.tap();
    await expect(page.locator('#terminal')).toBeHidden();
    await expect(deck('menu')).toBeVisible();
    await expect.poll(async () => (await page.screenshot()).length, { timeout: 90_000, intervals: [500] }).toBeGreaterThan(100_000);
    await pause(page, 4000);
    const mainMenu = await fingerprint(page);

    // New game: the round button, the ready-made character, and a tap to skip the movie.
    await tap(page, ...game.newGame);
    await pause(page, 3500);
    expect(distance(await fingerprint(page), mainMenu)).toBeGreaterThan(8);
    await tap(page, 88, 331);
    // The screen goes dark, then the opening movie starts; a tap on it skips it.
    const picture = async () => brightness(await fingerprint(page));
    await expect.poll(picture, { timeout: 60_000, intervals: [200] }).toBeLessThan(4);
    await expect.poll(picture, { timeout: 90_000, intervals: [300] }).toBeGreaterThan(10);
    await pause(page, 1500);
    await tap(page, 320, 200);
    await pause(page, 8000);
    const inGame = await fingerprint(page);
    expect(distance(inGame, mainMenu)).toBeGreaterThan(12);

    // A tap on a button of the game's own interface: the inventory. ESC on the deck closes it.
    await tap(page, 227, 430);
    await pause(page, 2000);
    expect(distance(await fingerprint(page), inGame)).toBeGreaterThan(6);
    await deck('esc').tap();
    await pause(page, 2000);
    expect(distance(await fingerprint(page), inGame)).toBeLessThan(3);

    if (browserName === 'chromium') {
      const fingers = await Fingers.on(page);
      const settled = await fingerprint(page);
      const ground = game.ground;

      // One finger dragging only moves the pointer: nothing is clicked, nobody walks.
      await fingers.drag([150, 120], ground, 1);
      await pause(page, 1500);
      expect(distance(await fingerprint(page), settled)).toBeLessThan(3);

      // The cursor button is the right mouse button: it switches the pointer's shape, and back.
      const walking = await patch(page, ...ground);
      await deck('right').tap();
      await pause(page, 800);
      expect((await patch(page, ...ground)).equals(walking)).toBe(false);
      await deck('right').tap();
      await pause(page, 800);
      expect((await patch(page, ...ground)).equals(walking)).toBe(true);

      // Two fingers tapping together are a right click too.
      await fingers.tapTwo(300, 200);
      await pause(page, 800);
      expect((await patch(page, ...ground)).equals(walking)).toBe(false);
      await deck('right').tap();
      await pause(page, 800);
      expect((await patch(page, ...ground)).equals(walking)).toBe(true);

      // Two fingers drag the map along, and back. Short drags: the games do
      // not let the view stray far from the character, least of all here at
      // the start.
      for (const [from, to] of [[[250, 150], [300, 150]], [[250, 150], [250, 190]]] as [Point, Point][]) {
        await fingers.drag(from, to, 2);
        await pause(page, 1500);
        expect(distance(await fingerprint(page), settled)).toBeGreaterThan(4);
        await fingers.drag(to, from, 2);
        await pause(page, 1500);
        expect(distance(await fingerprint(page), settled)).toBeLessThan(3);
      }

      // Aim by dragging, then the click button: opens the inventory without tapping its button.
      await fingers.drag([300, 300], [227, 430], 1);
      await pause(page, 500);
      await deck('left').tap();
      await pause(page, 2000);
      expect(distance(await fingerprint(page), settled)).toBeGreaterThan(6);
      await deck('esc').tap();
      await pause(page, 2000);

      // Press and hold on the ground, drag, let go: the button was held and released, and nothing broke.
      await fingers.press(...ground);
      await pause(page, 900);
      await fingers.lift();
      await pause(page, 2500);
    }

    // The keyboard: F6 for a quick save. It closes on demand...
    await deck('keys').tap();
    await expect(page.locator('#keys')).toBeVisible();
    const shrunk = (await page.locator('#canvas').boundingBox())!;
    expect(shrunk.y + shrunk.height).toBeLessThanOrEqual((await page.locator('#keys').boundingBox())!.y + 1);
    await key('@layer').tap();
    await key('F6').tap();
    await pause(page, 2500);
    await deck('keys').tap();
    await expect(page.locator('#keys')).toBeHidden();
    // ...and comes back by itself when the game asks for the save's description,
    // which it does once the slot is confirmed with the picker's own button.
    await pause(page, 600); // the picture grows back into the room the keyboard took
    await tap(page, 398, 357);
    await expect(page.locator('#keys')).toBeVisible({ timeout: 10_000 });
    await key('@shift').tap();
    for (const code of ['KeyT', 'KeyO', 'KeyU', 'KeyC', 'KeyH', 'Digit1']) await key(code).tap();
    await key('Enter').tap();
    await expect(page.locator('#toast')).toHaveText('SAVED TO BROWSER STORAGE', { timeout: 30_000 });
    await expect(page.locator('#keys')).toBeHidden({ timeout: 10_000 });

    // The menu button pauses; from there, out to the console, where the save shows what was typed.
    await deck('menu').tap();
    await expect(page.getByText('Simulation suspended')).toBeVisible();
    await expect(page.getByRole('button', { name: /Touch controls/ })).toBeVisible();
    await page.getByRole('button', { name: /Exit to console/ }).tap();
    await page.getByRole('button', { name: /\[Y\]/ }).tap();
    await expect(page.getByRole('heading', { name: new RegExp(`${game.title}$`) })).toBeVisible();
    await page.goto(`#/saves/${game.id}`);
    await expect(page.locator('.menu li').first()).toContainText('Touch1');

    expect(faults).toEqual([]);
    await expect(page.getByText('System fault')).toHaveCount(0);
  });
}
