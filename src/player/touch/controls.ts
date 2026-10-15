/**
 * Touch play: fingers on the picture, and a deck of buttons around it.
 *
 * Nothing here is shown until the page is actually touched (or opened on a
 * device whose main pointer is a finger), so mouse and keyboard players never
 * see it.
 */
import { DEFAULT_TUNING, Gestures, type GestureTuning, type MouseButton, type PointerMode } from './gestures';
import { ESCAPE_KEY, Keyboard, SHORTCUT_KEYS, sendKey } from './keyboard';
import { SyntheticMouse } from './mouse';

export interface TouchHost {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  deck: HTMLElement;
  keys: HTMLElement;
  /** A counter that goes up each time the game goes round its loop. */
  turns(): number;
  /** Whether the game is running and should get input. */
  playing(): boolean;
  /** Whether the game is waiting for text (a save's description, a name). Undefined when the engine cannot tell. */
  wantsText(): boolean | undefined;
  /** Whether it is the player's turn in combat. Undefined when there is no engine to ask. */
  playerTurn(): boolean | undefined;
  openMenu(): void;
  /** Fast forward, on or off. */
  toggleFast(): void;
  /** What lies on the ground lit up, or not. */
  toggleLights(): void;
  /** Something the player should read, briefly. */
  say(text: string): void;
  /** The deck or the keyboard appeared or went: the picture has to be fitted again. */
  layoutChanged(): void;
}

/** True on phones and tablets: devices whose main pointer is a finger. */
export function fingerFirst(): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

/** How long a button that asks for a second tap waits for it. */
const CONFIRM_MS = 3000;

export class TouchControls {
  private readonly tuning: GestureTuning = { ...DEFAULT_TUNING };
  /** A button that costs what was played since the last save, tapped once: it waits for the second tap. */
  private asking: { button: HTMLElement; timer: number } | null = null;
  private readonly gestures: Gestures;
  private readonly mouse: SyntheticMouse;
  readonly keyboard: Keyboard;
  private shown = false;
  /** The keyboard is up because the game asked for text, not because the player opened it. */
  private keyboardIsAutomatic = false;
  private wantedText = false;
  private readonly deckHeld = new Map<number, () => void>();
  /** Called the first time the deck appears. */
  onFirstShown: () => void = () => {};

  constructor(
    private readonly host: TouchHost,
    mode: PointerMode,
  ) {
    const { stage, canvas, deck } = host;
    this.mouse = new SyntheticMouse(canvas, host.turns);
    this.gestures = new Gestures(
      canvas.clientWidth || 640,
      canvas.clientHeight || 480,
      mode,
      (action) => {
        // A held finger turning into a held button is felt, where the device can: "now drag".
        if (action.type === 'press') navigator.vibrate?.(12);
        this.mouse.apply(action);
      },
      this.tuning,
    );
    this.keyboard = new Keyboard(host.keys);
    this.keyboard.onToggle = (open) => {
      document.body.classList.toggle('keys-open', open);
      deck.querySelector('[data-act="keys"]')?.classList.toggle('armed', open);
      if (!open) this.keyboardIsAutomatic = false;
      host.layoutChanged();
    };

    // Before the engine's own listeners on the canvas, which would otherwise
    // turn the same touches into a second, different pointer.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
      stage.addEventListener(type, (event) => this.onTouch(event), { capture: true, passive: false });
    }
    // A real mouse and the touch pointer are the same pointer to the game.
    canvas.addEventListener('mousemove', (event) => {
      if (!event.isTrusted) return;
      this.gestures.pointerMovedTo(event.offsetX, event.offsetY);
      this.mouse.sync(event.offsetX, event.offsetY);
    });

    // A tap beside the picture (the deck, the keyboard) reaches it as a mouse
    // leaving it: the browser makes mouse events out of taps. SDL would carry
    // the game's pointer to where that mouse went, out at the edge of the
    // picture, and the map would scroll there. With the deck out, the game's
    // pointer goes where fingers and real mouse movements take it, and no
    // further.
    for (const type of ['mouseenter', 'mouseleave'] as const) {
      stage.addEventListener(type, (event) => event.isTrusted && this.shown && event.stopPropagation(), { capture: true });
    }

    deck.addEventListener('pointerdown', (event) => this.onDeckDown(event));
    deck.addEventListener('pointerup', (event) => this.onDeckUp(event));
    deck.addEventListener('pointercancel', (event) => this.onDeckUp(event));
    deck.addEventListener('contextmenu', (event) => event.preventDefault());

    // iOS: no pinch-zooming of the game.
    document.addEventListener('gesturestart', (event) => event.preventDefault());
    setInterval(() => {
      this.watchForText();
      this.watchTurn();
    }, 200);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Shows the deck. Idempotent. */
  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.host.deck.hidden = false;
    document.body.classList.add('touch');
    this.host.layoutChanged();
    this.onFirstShown();
  }

  setMode(mode: PointerMode): void {
    this.gestures.setMode(mode);
  }

  /** The picture was resized: `scale` is CSS pixels per pixel of the game. */
  resized(width: number, height: number, scale: number): void {
    this.gestures.resize(width, height);
    // The games scroll their maps 32 pixels sideways and 24 up or down at a
    // time; a step per that much finger travel keeps the ground under the fingers.
    this.tuning.scrollStepX = Math.max(16, 32 * scale);
    this.tuning.scrollStepY = Math.max(12, 24 * scale);
  }

  /** Shows on the deck whether the game is running fast. */
  setFast(on: boolean): void {
    this.showSwitch('fast', on);
  }

  /** Shows on the deck whether what lies on the ground is lit up. */
  setLights(on: boolean): void {
    this.showSwitch('lights', on);
  }

  private showSwitch(act: string, on: boolean): void {
    const button = this.host.deck.querySelector(`[data-act="${act}"]`);
    button?.classList.toggle('armed', on);
    button?.setAttribute('aria-pressed', String(on));
  }

  /** Offers one of the deck's buttons, or takes it away: not every game has what every one is for. */
  offer(act: string, offered: boolean): void {
    const button = this.host.deck.querySelector<HTMLElement>(`[data-act="${act}"]`);
    if (button) button.hidden = !offered;
  }

  /** Lets go of everything: the game is being paused or left. */
  releaseAll(): void {
    this.gestures.cancel();
    this.mouse.releaseAll();
    this.keyboard.releaseAll();
    for (const release of this.deckHeld.values()) release();
    this.deckHeld.clear();
    this.stopAsking();
  }

  /**
   * Whether a button that asks to be tapped twice has been: the first tap
   * lights it up and says what the second will do.
   */
  private confirmed(button: HTMLElement): boolean {
    if (this.asking?.button === button) {
      this.stopAsking();
      return true;
    }
    this.stopAsking();
    button.classList.add('armed');
    this.asking = { button, timer: window.setTimeout(() => this.stopAsking(), CONFIRM_MS) };
    this.host.say(button.dataset.confirm || `Tap ${button.textContent} again`);
    return false;
  }

  private stopAsking(): void {
    if (!this.asking) return;
    clearTimeout(this.asking.timer);
    this.asking.button.classList.remove('armed');
    this.asking = null;
  }

  private onTouch(event: TouchEvent): void {
    // The engine must never see raw touches, playing or not.
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    // Showing the deck for the first time pauses the game to explain it.
    if (this.host.playing()) this.show();
    if (!this.host.playing() || event.type === 'touchcancel') {
      // Whatever was begun is over: a finger that lifts while the game is
      // paused must not leave a tap or a held button behind.
      this.gestures.cancel();
      return;
    }
    const rect = this.host.canvas.getBoundingClientRect();
    for (const touch of Array.from(event.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      if (event.type === 'touchstart') this.gestures.down(touch.identifier, x, y, event.timeStamp);
      else if (event.type === 'touchmove') this.gestures.move(touch.identifier, x, y);
      else this.gestures.up(touch.identifier, event.timeStamp);
    }
  }

  private onDeckDown(event: PointerEvent): void {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-act], button[data-key]') : null;
    if (!button) return;
    // No focus change, no delayed click, no text selection.
    event.preventDefault();
    // Any other button is an answer of "no" to one that asked for a second tap.
    if (this.asking && this.asking.button !== button) this.stopAsking();
    const act = button.dataset.act;
    if (act === 'menu') {
      this.host.openMenu();
      return;
    }
    if (act === 'keys') {
      this.keyboard.toggle();
      return;
    }
    if (!this.host.playing()) return;
    if (act === 'fast') {
      this.host.toggleFast();
      return;
    }
    if (act === 'lights') {
      this.host.toggleLights();
      return;
    }

    // A shortcut is a key of the keyboard: down for as long as the button is.
    const shortcut = SHORTCUT_KEYS[button.dataset.key ?? ''];
    if (!act && !shortcut) return;
    if (button.dataset.confirm !== undefined && !this.confirmed(button)) return;
    // Dimmed, it does nothing just now: say when it will. The key still goes, should the game want it.
    if (button.classList.contains('idle') && button.dataset.inCombat) this.host.say(button.dataset.inCombat);
    button.setPointerCapture?.(event.pointerId);
    button.classList.add('down');
    let release: () => void;
    if (shortcut) {
      sendKey('keydown', shortcut);
      release = () => sendKey('keyup', shortcut);
    } else if (act === 'esc') {
      sendKey('keydown', ESCAPE_KEY);
      release = () => sendKey('keyup', ESCAPE_KEY);
    } else {
      const which = act as MouseButton;
      this.mouse.press(which);
      release = () => this.mouse.release(which);
    }
    this.deckHeld.set(event.pointerId, () => {
      button.classList.remove('down');
      release();
    });
  }

  private onDeckUp(event: PointerEvent): void {
    const release = this.deckHeld.get(event.pointerId);
    if (!release) return;
    this.deckHeld.delete(event.pointerId);
    release();
  }

  /**
   * Lights the buttons that only do something during the player's turn in
   * combat (TURN) while that turn lasts, and dims them the rest of the time.
   */
  private watchTurn(): void {
    if (!this.shown) return;
    const yours = this.host.playerTurn();
    for (const button of this.host.deck.querySelectorAll('[data-in-combat]')) button.classList.toggle('idle', yours === false);
  }

  /** Brings the keyboard up when the game starts waiting for text, and takes it away again after. */
  private watchForText(): void {
    if (!this.shown || !this.host.playing()) return;
    const wants = this.host.wantsText();
    if (wants === undefined || wants === this.wantedText) return;
    this.wantedText = wants;
    if (wants) {
      // Letters, whatever the keyboard was last used for.
      this.keyboard.forTyping();
      if (!this.keyboard.open) {
        this.keyboard.show(true);
        this.keyboardIsAutomatic = true;
      }
    } else if (this.keyboardIsAutomatic) {
      this.keyboard.show(false);
    }
  }
}
