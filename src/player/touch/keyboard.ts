/**
 * An on-screen keyboard for players without one.
 *
 * It is the console's own, not the phone's: the system keyboard reports most
 * keys as "unidentified", resizes the page when it opens and looks different
 * everywhere. These keys send exactly the key events the engine listens for.
 *
 * The games work out letters from key positions themselves, so sending a key
 * with Shift held is all it takes to type a capital.
 */

interface Key {
  /** What the key shows, or what it is called when it shows a picture. */
  label: string;
  /** Drawn in place of the label: the lines of a 24 x 24 picture. The usual arrow characters are missing from many fonts. */
  symbol?: string;
  /** DOM `code`, e.g. "KeyA". A leading "@" marks a key of the keyboard itself. */
  code: string;
  key: string;
  keyCode: number;
  /** Width in units of one ordinary key. */
  span?: number;
  /** What it shows while Shift is armed, when that differs. */
  shifted?: string;
}

const letter = (char: string): Key => ({ label: char.toUpperCase(), code: `Key${char.toUpperCase()}`, key: char, keyCode: char.toUpperCase().charCodeAt(0) });
const digit = (char: string, shifted: string): Key => ({ label: char, code: `Digit${char}`, key: char, keyCode: char.charCodeAt(0), shifted });
const fn = (n: number): Key => ({ label: `F${n}`, code: `F${n}`, key: `F${n}`, keyCode: 111 + n });

const ESC: Key = { label: 'ESC', code: 'Escape', key: 'Escape', keyCode: 27 };
const BACKSPACE: Key = { label: 'Backspace', symbol: 'M9 5h12v14H9l-6-7zM13 9.5l5 5M18 9.5l-5 5', code: 'Backspace', key: 'Backspace', keyCode: 8 };
const TAB: Key = { label: 'TAB', code: 'Tab', key: 'Tab', keyCode: 9 };
const ENTER: Key = { label: 'Enter', symbol: 'M19 5v9H6M10 10l-4 4 4 4', code: 'Enter', key: 'Enter', keyCode: 13 };
const SPACE: Key = { label: 'SPACE', code: 'Space', key: ' ', keyCode: 32, span: 2 };
const SHIFT: Key = { label: 'Shift', symbol: 'M12 4l8 9h-5v7H9v-7H4z', code: '@shift', key: '', keyCode: 0 };
const LAYER: Key = { label: 'FN', code: '@layer', key: '', keyCode: 0 };
const COMMA: Key = { label: ',', code: 'Comma', key: ',', keyCode: 188, shifted: '<' };
const PERIOD: Key = { label: '.', code: 'Period', key: '.', keyCode: 190, shifted: '>' };
const LEFT: Key = { label: 'Left', symbol: 'M20 12H5M11 6l-6 6 6 6', code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 };
const RIGHT: Key = { label: 'Right', symbol: 'M4 12h15M13 6l6 6-6 6', code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 };
const UP: Key = { label: 'Up', symbol: 'M12 20V5M6 11l6-6 6 6', code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 };
const DOWN: Key = { label: 'Down', symbol: 'M12 4v15M6 13l6 6 6-6', code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 };
const HOME: Key = { label: 'HOME', code: 'Home', key: 'Home', keyCode: 36 };
const PAGE_UP: Key = { label: 'PGUP', code: 'PageUp', key: 'PageUp', keyCode: 33 };
const PAGE_DOWN: Key = { label: 'PGDN', code: 'PageDown', key: 'PageDown', keyCode: 34 };
const MINUS: Key = { label: '-', code: 'Minus', key: '-', keyCode: 189, shifted: '_' };
const SLASH: Key = { label: '/', code: 'Slash', key: '/', keyCode: 191, shifted: '?' };
const SHIFT_KEY: Key = { label: 'SHIFT', code: 'ShiftLeft', key: 'Shift', keyCode: 16 };

const DIGITS = [digit('1', '!'), digit('2', '@'), digit('3', '#'), digit('4', '$'), digit('5', '%'), digit('6', '^'), digit('7', '&'), digit('8', '*'), digit('9', '('), digit('0', ')')];
// F9 and F11 belong to the console, and F12 writes a screenshot file into the saves.
const FUNCTIONS = [fn(1), fn(2), fn(3), fn(4), fn(5), fn(6), fn(7), fn(8), fn(10), HOME];

/** Twelve units to a row. The first layer is for typing, the second for the keys games use as commands. */
const LAYERS: Key[][][] = [
  [
    [ESC, ...DIGITS, BACKSPACE],
    [TAB, ...'qwertyuiop'.split('').map(letter), ENTER],
    [SHIFT, ...'asdfghjkl'.split('').map(letter), COMMA, PERIOD],
    [LAYER, ...'zxcvbnm'.split('').map(letter), SPACE, LEFT, RIGHT],
  ],
  [
    [ESC, ...FUNCTIONS, BACKSPACE],
    [TAB, ...'qwertyuiop'.split('').map(letter), ENTER],
    [SHIFT, ...'asdfghjkl'.split('').map(letter), MINUS, SLASH],
    [LAYER, PAGE_UP, PAGE_DOWN, ...'cvbnm'.split('').map(letter), SPACE, UP, DOWN],
  ],
];

/** Sends a key to the engine, which listens on the window. */
export function sendKey(type: 'keydown' | 'keyup', key: Pick<Key, 'code' | 'key' | 'keyCode'>, shiftKey = false): void {
  window.dispatchEvent(
    new KeyboardEvent(type, { key: key.key, code: key.code, keyCode: key.keyCode, which: key.keyCode, shiftKey, bubbles: true, cancelable: true }),
  );
}

/** A full press of a key that is not on the panel (the deck's ESC, for one). */
export const ESCAPE_KEY: Pick<Key, 'code' | 'key' | 'keyCode'> = ESC;

/**
 * The keys behind the deck's shortcut buttons, by code: inventory, character
 * screen, Pip-Boy, skilldex, the map, the end of a turn, quick save and quick
 * load.
 */
export const SHORTCUT_KEYS: Record<string, Pick<Key, 'code' | 'key' | 'keyCode'>> = Object.fromEntries(
  [letter('i'), letter('c'), letter('p'), letter('s'), TAB, SPACE, fn(6), fn(7)].map((key) => [key.code, key]),
);

export class Keyboard {
  private layer = 0;
  private shift = false;
  private readonly held = new Map<number, { key: Key; shifted: boolean; button: HTMLButtonElement }>();
  /** Called when the panel opens or closes, so the picture can make room. */
  onToggle: (open: boolean) => void = () => {};

  constructor(private readonly panel: HTMLElement) {
    panel.addEventListener('pointerdown', (event) => this.down(event));
    panel.addEventListener('pointerup', (event) => this.up(event));
    panel.addEventListener('pointercancel', (event) => this.up(event));
    // The panel is all buttons; nothing on it should select text or open a menu.
    panel.addEventListener('contextmenu', (event) => event.preventDefault());
    this.render();
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  show(open: boolean): void {
    if (open === this.open) return;
    if (!open) this.releaseAll();
    this.panel.hidden = !open;
    this.onToggle(open);
  }

  toggle(): void {
    this.show(!this.open);
  }

  /** Switches to the letters and digits: the game is about to be typed to. */
  forTyping(): void {
    if (this.layer === 0) return;
    this.releaseAll();
    this.layer = 0;
    this.render();
  }

  releaseAll(): void {
    for (const [pointer] of this.held) this.release(pointer);
  }

  private render(): void {
    this.panel.replaceChildren(
      ...LAYERS[this.layer]!.map((row) => {
        const line = document.createElement('div');
        line.className = 'keys-row';
        for (const key of row) {
          const button = document.createElement('button');
          button.type = 'button';
          button.tabIndex = -1;
          button.dataset.code = key.code;
          if (key.symbol) {
            button.setAttribute('aria-label', key.label);
            button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${key.symbol}" /></svg>`;
          } else {
            button.textContent = this.shift && key.shifted ? key.shifted : key.label;
          }
          if (key.span) button.style.flexGrow = String(key.span);
          if (key.code === '@shift') button.classList.toggle('armed', this.shift);
          if (key.code === '@layer') button.classList.toggle('armed', this.layer === 1);
          // Words are set smaller than letters.
          if (!key.symbol && (key.code.startsWith('@') || key.label.length > 1)) button.classList.add('word');
          line.append(button);
        }
        return line;
      }),
    );
  }

  private keyOf(target: EventTarget | null): { key: Key; button: HTMLButtonElement } | null {
    const button = target instanceof Element ? target.closest('button') : null;
    if (!(button instanceof HTMLButtonElement)) return null;
    const key = LAYERS[this.layer]!.flat().find((candidate) => candidate.code === button.dataset.code);
    return key ? { key, button } : null;
  }

  private down(event: PointerEvent): void {
    event.preventDefault();
    const hit = this.keyOf(event.target);
    if (!hit) return;
    const { key, button } = hit;
    if (key.code === '@shift') {
      this.shift = !this.shift;
      this.render();
      return;
    }
    if (key.code === '@layer') {
      this.releaseAll();
      this.layer = 1 - this.layer;
      this.render();
      return;
    }
    // A finger sliding off a key must still release it.
    button.setPointerCapture?.(event.pointerId);
    button.classList.add('down');
    const shifted = this.shift;
    if (shifted) sendKey('keydown', SHIFT_KEY, true);
    sendKey('keydown', key, shifted);
    this.held.set(event.pointerId, { key, shifted, button });
  }

  private up(event: PointerEvent): void {
    event.preventDefault();
    this.release(event.pointerId);
  }

  private release(pointer: number): void {
    const held = this.held.get(pointer);
    if (!held) return;
    this.held.delete(pointer);
    held.button.classList.remove('down');
    sendKey('keyup', held.key, held.shifted);
    if (held.shifted) {
      sendKey('keyup', SHIFT_KEY, false);
      // Shift applies to one key, as on a phone.
      this.shift = false;
      this.render();
    }
  }
}
