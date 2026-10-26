import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeFallout2Folder, openConsole, pickFolder, waitForPicture } from './helpers';

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
  await expect(pointer).toContainText('HYBRID');
  await pointer.locator('button').tap();
  await expect(pointer).toContainText('TRACKPAD');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('overseer-console:settings')!).touchPointer)).toBe('trackpad');

  await page.locator('.menu button', { hasText: 'Back' }).tap();
  await expect(page.getByRole('heading', { name: 'Main directory' })).toBeVisible();
});

test('on a phone the start gate asks for a tap and makes room for the touch deck', async ({ page }) => {
  await openConsole(page, 'fo2');
  await pickFolder(page, await fakeFallout2Folder());
  await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await pause(page, 1500);
  await page.locator('.menu button', { hasText: 'Begin simulation' }).tap();
  await page.waitForURL(/play\.html/);

  await expect(page.getByText('TAP TO BEGIN')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('body')).toHaveClass(/touch/);
  // The deck and the keyboard draw their own symbols: the fonts of a phone may not have them.
  await expect(page.locator('#deck button[data-act="menu"] svg, #deck button[data-act="keys"] svg')).toHaveCount(2);
  await expect(page.locator('#keys button[aria-label="Backspace"] svg')).toHaveCount(1);
  // The picture is fitted between the two strips of buttons.
  const stage = (await page.locator('#stage').boundingBox())!;
  expect(stage.x).toBeGreaterThan(50);
  expect(stage.x + stage.width).toBeLessThan(844 - 50);
  // Between the deck's own buttons sit the shortcuts: keys of the game, fast forward, and the
  // one that lights up what lies on the ground, which this game has. None of them hangs off the screen.
  const shortcuts = page.locator('#deck .deck-quick button:visible');
  await expect(shortcuts).toHaveText(['INV', 'MAP', 'CHA', 'PIP', 'SKILL', 'FAST', 'HILITE', 'ATTACK', 'MODE', 'TURN', 'QSAVE', 'QLOAD']);
  for (const box of await shortcuts.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThan(20);
  }

  await page.getByRole('button', { name: 'Back to console' }).tap();
  await expect(page.getByRole('heading', { name: 'SIMULATION 02: Fallout 2' })).toBeVisible();
});

test.describe('on a phone held upright', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the shortcuts are two rows across the phone, between the picture and the deck', async ({ page }) => {
    await openConsole(page, 'fo2');
    await pickFolder(page, await fakeFallout2Folder());
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 60_000 });
    await pause(page, 1500);
    await page.locator('.menu button', { hasText: 'Begin simulation' }).tap();
    await expect(page.getByText('TAP TO BEGIN')).toBeVisible({ timeout: 60_000 });

    const boxes = await page
      .locator('#deck .deck-quick button:visible')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON() as DOMRect));
    expect(boxes.length).toBeGreaterThanOrEqual(9);
    expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(2);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(390);
      expect(box.width).toBeGreaterThan(40);
    }
    const stage = (await page.locator('#stage').boundingBox())!;
    expect(stage.y + stage.height).toBeLessThanOrEqual(Math.min(...boxes.map((box) => box.top)) + 1);
    const menu = (await page.locator('#deck button[data-act="menu"]').boundingBox())!;
    expect(menu.y).toBeGreaterThanOrEqual(Math.max(...boxes.map((box) => box.bottom)) - 1);
  });
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

  /**
   * Drags one or two fingers from one game point to another, at the pace of a
   * deliberate hand. A short drag wants fewer steps: a finger that takes too
   * long to get going is held, not dragged.
   */
  async drag(from: Point, to: Point, fingers: 1 | 2, steps = 30): Promise<void> {
    const a = await at(this.page, ...from);
    const b = await at(this.page, ...to);
    const points = (x: number, y: number): [number, number][] => (fingers === 2 ? [[x, y], [x + 70, y]] : [[x, y]]);
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

  /** One finger flicked from one game point to another, as fast as the browser takes it, lifting while still moving. */
  async flick(from: Point, to: Point): Promise<void> {
    const a = await at(this.page, ...from);
    const b = await at(this.page, ...to);
    const steps = 3;
    await this.send('touchStart', [a]);
    for (let step = 1; step <= steps; step++) {
      await this.send('touchMove', [[a[0] + ((b[0] - a[0]) * step) / steps, a[1] + ((b[1] - a[1]) * step) / steps]]);
    }
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
    await pickFolder(page, game.dir!);
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
    const darkens = (timeout: number) => expect.poll(picture, { timeout, intervals: [200] }).toBeLessThan(4);
    // A tap that comes while the screen is still being drawn is not heard: once more, then.
    await darkens(20_000).catch(async () => {
      await tap(page, 88, 331);
      await darkens(40_000);
    });
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

    // Where a game lights up what lies on the ground, HILITE is a switch: on until pressed again. It holds
    // its key for the game's script alone, so what is typed below is not shifted (the save says "Touch1").
    const hilite = deck('lights');
    const lit = await hilite.isVisible();
    expect(lit).toBe(game.id === 'fo2');
    if (lit) {
      await hilite.tap();
      await expect(hilite).toHaveAttribute('aria-pressed', 'true');
      await pause(page, 1000);
      await expect(hilite).toHaveClass(/armed/);
    }

    // The keyboard: F4 for the save screen. It closes on demand...
    await deck('keys').tap();
    await expect(page.locator('#keys')).toBeVisible();
    const shrunk = (await page.locator('#canvas').boundingBox())!;
    expect(shrunk.y + shrunk.height).toBeLessThanOrEqual((await page.locator('#keys').boundingBox())!.y + 1);
    // With the keyboard up, the strips beside the picture keep only the deck's own buttons, all of them on the screen.
    await expect(page.locator('#deck .deck-quick button:visible')).toHaveCount(0);
    for (const act of ['menu', 'keys', 'esc', 'left', 'right']) {
      expect((await deck(act).boundingBox())!.y + (await deck(act).boundingBox())!.height, act).toBeLessThanOrEqual((await page.locator('#keys').boundingBox())!.y + 1);
    }
    await key('@layer').tap();
    await key('F4').tap();
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
    if (lit) {
      await hilite.tap();
      await expect(hilite).toHaveAttribute('aria-pressed', 'false');
      await expect(hilite).not.toHaveClass(/armed/);
    }

    // Quick save and quick load are a button each. Loading throws away what was played since, so it asks twice.
    const shortcut = (code: string) => page.locator(`#deck button[data-key="${code}"]`);
    await pause(page, 1500);
    await shortcut('F6').tap();
    await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
    await pause(page, 1500);
    const saved = await fingerprint(page);
    await shortcut('F7').tap();
    await expect(shortcut('F7')).toHaveClass(/armed/);
    await expect(page.locator('#toast')).toHaveText('Tap QLOAD again to load the quick save');
    await shortcut('F7').tap();
    await expect(shortcut('F7')).not.toHaveClass(/armed/);
    await expect(page.locator('#toast')).toHaveText('QUICK LOADED FROM SLOT 07', { timeout: 30_000 });
    await expect.poll(async () => distance(await fingerprint(page), saved), { timeout: 30_000, intervals: [1000] }).toBeLessThan(6);
    // Asked once and left alone, it stands down again.
    await shortcut('F7').tap();
    await expect(shortcut('F7')).toHaveClass(/armed/);
    await expect(shortcut('F7')).not.toHaveClass(/armed/, { timeout: 5000 });

    // The deck's own shortcut to the character screen, a screen of its own; ESC closes it too.
    const here = await fingerprint(page);
    await shortcut('KeyC').tap();
    await pause(page, 2500);
    expect(distance(await fingerprint(page), here)).toBeGreaterThan(12);
    await deck('esc').tap();
    await pause(page, 2000);
    expect(distance(await fingerprint(page), here)).toBeLessThan(3);

    // MODE is N: the weapon in hand goes to its next attack, which its button on the bar shows. Round again to the first.
    const weapon = async () => {
      const [left, top] = await at(page, 265, 400);
      const [right, bottom] = await at(page, 460, 470);
      return page.screenshot({ clip: { x: left, y: top, width: right - left, height: bottom - top } });
    };
    const firstMode = await weapon();
    await shortcut('KeyN').tap();
    await pause(page, 800);
    expect((await weapon()).equals(firstMode)).toBe(false);
    let back = false;
    for (let tries = 0; tries < 6 && !back; tries++) {
      await shortcut('KeyN').tap();
      await pause(page, 800);
      back = (await weapon()).equals(firstMode);
    }
    expect(back).toBe(true);

    // From here on the browser's own mouse is over the picture, as after a tap
    // on a menu laid over it, or on a laptop with a touch screen. A tap on the
    // deck then reaches the picture as that mouse leaving it, and the game's
    // pointer must not follow it out to the edge: the checks of CURSOR and
    // CLICK below fail if it does.
    await page.mouse.move(...(await at(page, ...game.ground)));
    await pause(page, 1000);

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

      // The menu switches the pointer to hybrid: a drag moves it as on a trackpad and clicks nothing,
      // and a tap after it still clicks where the finger is, here the inventory's button.
      await deck('menu').tap();
      await page.getByRole('button', { name: /Pointer: follows finger/ }).tap();
      await expect(page.getByRole('button', { name: /Pointer: hybrid/ })).toBeVisible();
      await page.getByRole('button', { name: /Resume/ }).tap();
      await expect(page.locator('#terminal')).toBeHidden();
      await pause(page, 1500);
      const still = await fingerprint(page);
      await fingers.drag([300, 120], [380, 160], 1);
      await pause(page, 1500);
      expect(distance(await fingerprint(page), still)).toBeLessThan(3);
      await tap(page, 227, 430);
      await pause(page, 2000);
      expect(distance(await fingerprint(page), still)).toBeGreaterThan(6);
      await deck('esc').tap();
      await pause(page, 2000);
    }

    // TURN does something only on the player's turn in a fight: dim the rest of the time, and a tap then says so.
    const turn = page.locator('#deck button[data-key="Space"]');
    if (await turn.evaluate((button) => button.classList.contains('idle'))) {
      await turn.tap();
      await expect(page.locator('#toast')).toHaveText('TURN ends your turn in a fight. It lights up when your turn comes.');
    }
    // ATTACK starts a fight, as the A key does: it is the player's turn, and TURN is lit. A tap on it ends that turn.
    await shortcut('KeyA').tap();
    await expect(turn).not.toHaveClass(/idle/, { timeout: 30_000 });
    await turn.tap();
    await expect(turn).toHaveClass(/idle/, { timeout: 15_000 });

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

// ---------------------------------------------------------------------
// A long inventory, scrolled with fingers
// ---------------------------------------------------------------------

/**
 * Things both games have, to fill an inventory with more than it shows at
 * once: enough for Fallout 2's two columns to scroll several rows.
 */
const MORE_THINGS = [
  'rope', 'flare', 'radaway', 'rad-x', 'mentats', 'buffout', 'psycho', 'geiger', 'stealth boy', 'crowbar', 'sledgehammer',
  'first aid', 'nuka-cola', 'beer', 'booze', 'brass knuckles', 'dynamite', 'spear', "doctor's bag", 'super stim',
  'motion sensor', 'rock',
];

/** Past the gate with a tap. The explanation of the controls was seen before. */
async function begin(page: Page): Promise<void> {
  await expect(page.getByText(/TAP TO BEGIN|PRESS ANY KEY/)).toBeVisible({ timeout: 60_000 });
  await pause(page, 1500);
  await page.touchscreen.tap(422, 150);
  await expect(page.locator('#terminal')).toBeHidden();
}

type Rect = { left: number; top: number; right: number; bottom: number };

/** The list the game says takes the wheel, looked for across the middle of the screen; null if none. */
function findList(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const engine = (window as unknown as { overseerEngine: { scrollListAt(x: number, y: number): Rect | null } }).overseerEngine;
    for (let x = 0; x < 640; x += 4) {
      const list = engine.scrollListAt(x, 200);
      if (list) return list;
    }
    return null;
  });
}

for (const game of GAMES) {
  test(`${game.title}: a long inventory scrolls under a finger`, async ({ page, browserName }) => {
    test.skip(!game.dir, `set ${game.id.toUpperCase()}_DIR to your ${game.title} folder to run this`);
    test.skip(browserName !== 'chromium', 'fingers that drag are sent through Chromium alone');
    test.setTimeout(600_000);
    const faults: string[] = [];
    page.on('pageerror', (error) => faults.push(error.message));
    await page.addInitScript(() => localStorage.setItem('overseer-console:touch-help', '1'));
    await openConsole(page, game.id, { skipIntro: true });
    await pickFolder(page, game.dir!);
    await expect(page.getByText('HOLODISK LOADED', { exact: true })).toBeVisible({ timeout: 300_000 });

    // A new game, quick saved at once.
    await pause(page, 1500);
    await page.locator('.menu button', { hasText: 'Begin simulation' }).tap();
    await page.waitForURL(/play\.html/);
    await begin(page);
    await waitForPicture(page, 4000);
    await page.keyboard.press('n');
    await pause(page, 3500);
    await page.keyboard.press('t');
    await pause(page, 4500);
    await page.keyboard.press('Escape');
    await pause(page, 9000);
    await page.keyboard.press('F6');
    await expect(page.locator('#toast')).toHaveText('QUICK SAVED IN SLOT 07', { timeout: 30_000 });
    await page.keyboard.press('F9');
    await expect(page.getByText('Simulation suspended')).toBeVisible();
    await page.keyboard.press('x');
    await page.keyboard.press('y');
    await expect(page.getByRole('heading', { name: new RegExp(`${game.title}$`) })).toBeVisible({ timeout: 30_000 });

    // More things than the inventory shows at once, given by the save editor.
    const selected = page.locator('.ledger li.selected');
    await page.goto(`#/saves/${game.id}/modify/7`);
    await expect(selected).toContainText('Name');
    await page.keyboard.press('7');
    for (const name of MORE_THINGS) {
      await page.keyboard.press('a');
      await page.keyboard.type(name);
      await page.keyboard.press('ArrowDown');
      await expect(selected).toContainText(new RegExp(name, 'i'));
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('0');
    await page.keyboard.press('w');
    await expect(page.getByText(/SLOT 07 MODIFIED/)).toBeVisible();
    await page.goto(`#/saves/${game.id}/7`);
    await expect(page.locator('.menu button').filter({ hasText: 'Load this save' })).toBeVisible();
    await pause(page, 1500);
    await page.keyboard.press('l');
    await page.waitForURL(/play\.html/);
    await begin(page);
    await waitForPicture(page, 6000);

    // The inventory, and the list the game says is in it: six rows or more, down its left side.
    await page.keyboard.press('i');
    await pause(page, 2000);
    await expect.poll(() => findList(page), { timeout: 10_000 }).not.toBeNull();
    const list = (await findList(page))!;
    expect(list.bottom - list.top).toBeGreaterThanOrEqual(5 * 48);
    expect(list.right).toBeLessThan(320);
    const mid = (list.left + list.right) / 2;
    const low = list.bottom - 30;
    const ROW = 48;

    const fingers = await Fingers.on(page);
    /** The list, with the pointer taken off it first: one finger dragged across the middle of the window. */
    const look = async () => {
      await fingers.drag([400, 120], [420, 130], 1);
      await pause(page, 800);
      const [x, y] = await at(page, list.left, list.top);
      const [right, bottom] = await at(page, list.right, list.bottom);
      return page.screenshot({ clip: { x, y, width: right - x, height: bottom - y } });
    };
    const top = await look();

    // One finger up the list: it follows, row by row. Back down as far: it is back at the top.
    await fingers.drag([mid, low], [mid, low - ROW * 2.5], 1);
    await pause(page, 1000);
    const twoDown = await look();
    expect(twoDown.equals(top)).toBe(false);
    await fingers.drag([mid, low - ROW * 2.5], [mid, low], 1);
    await pause(page, 1000);
    expect((await look()).equals(top)).toBe(true);

    // Two fingers either side of the list scroll it too, the pointer having been elsewhere: as far as one did.
    const box = (await page.locator('#canvas').boundingBox())!;
    const spread = 70 / (box.width / 640);
    await fingers.drag([mid - spread / 2, low], [mid - spread / 2, low - ROW * 2.5], 2);
    await pause(page, 1000);
    expect((await look()).equals(twoDown)).toBe(true);
    await fingers.drag([mid - spread / 2, low - ROW * 2.5], [mid - spread / 2, low], 2);
    await pause(page, 1000);
    expect((await look()).equals(top)).toBe(true);

    // Flicked, the list glides on past where the finger let go.
    await fingers.drag([mid, low], [mid, low - ROW * 1.5], 1, 12);
    await pause(page, 1000);
    const oneDown = await look();
    await fingers.drag([mid, low - ROW * 3], [mid, low], 1);
    await pause(page, 1000);
    expect((await look()).equals(top)).toBe(true);
    await fingers.flick([mid, low], [mid, low - ROW * 1.5]);
    await pause(page, 2500);
    const glided = await look();
    expect(glided.equals(top)).toBe(false);
    expect(glided.equals(oneDown)).toBe(false);

    // Closed, the inventory's list is gone.
    await page.locator('#deck button[data-act="esc"]').tap();
    await expect.poll(() => findList(page), { timeout: 5000 }).toBeNull();

    expect(faults).toEqual([]);
    await expect(page.getByText('System fault')).toHaveCount(0);
  });
}
