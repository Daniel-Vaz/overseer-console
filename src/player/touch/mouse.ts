/**
 * A mouse made of events: what the gesture layer decides is replayed to the
 * engine as the mouse events its SDL backend already listens for, so both
 * games see an ordinary mouse.
 *
 * The games do not read button events; they look at where the pointer is and
 * whether a button is down each time they poll, and their buttons only take
 * a press from a pointer they already saw resting on them. So a click is
 * three things the game must see one after the other: the pointer arriving,
 * the button going down, the button coming up. Between them this mouse waits
 * until the game has gone round its loop.
 */
import type { MouseAction, MouseButton } from './gestures';

const BUTTON_INDEX: Record<MouseButton, number> = { left: 0, right: 2 };
const BUTTON_MASK: Record<MouseButton, number> = { left: 1, right: 2 };

/**
 * How long each step of a click is given to be seen. "Turns" are the game
 * going round its loop, which is the best sign there is that it looked; but
 * some loops turn several times between two looks, so every step also lasts
 * a minimum time. The slowest loops that take clicks look 15 to 24 times a
 * second.
 *
 * Dwell: the pointer rests where it is before a press. A button of the games
 * takes two looks to accept a pointer that came over from another button:
 * one to let go of the old button, one to notice the new.
 * Hold: the button stays down. Well short of the quarter second after which
 * the games treat a press as "held" and open an action menu.
 * Release: the button stays up before anything else happens.
 * The last number of each is when to stop waiting for a game that is busy.
 */
const DWELL = { ms: 120, turns: 4, giveUp: 400 };
const HOLD = { ms: 90, turns: 4, giveUp: 300 };
const RELEASE = { ms: 60, turns: 3, giveUp: 250 };
/**
 * A scroll step only has to be picked up once; but the games ignore map
 * scrolling that comes faster than 30 times a second.
 */
const SCROLL = { ms: 40, turns: 1, giveUp: 250 };
/** Scroll steps waiting to be sent; more than this is fingers running ahead of the game. */
const MAX_PENDING_SCROLL = 12;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SyntheticMouse {
  private queue: (() => void | Promise<void>)[] = [];
  private draining = false;
  private x = 0;
  private y = 0;
  private buttons = 0;
  private pendingScroll = 0;
  /** When the pointer last changed place, for the game to have seen it there before a press. */
  private moved = { at: 0, turn: 0 };

  /**
   * @param canvas  the element the engine listens on
   * @param turns   a counter that goes up each time the game goes round its loop
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly turns: () => number,
  ) {}

  /** True while a button is held down by this mouse. */
  get holding(): boolean {
    return this.buttons !== 0;
  }

  apply(action: MouseAction): void {
    switch (action.type) {
      case 'move':
        this.enqueue(() => this.sendMove(action.x, action.y));
        break;
      case 'press':
        this.press(action.button);
        break;
      case 'release':
        this.release(action.button);
        break;
      case 'click':
        this.press(action.button);
        this.release(action.button);
        break;
      case 'scroll':
        this.scroll(action.dx, action.dy);
        break;
    }
  }

  press(button: MouseButton): void {
    this.enqueue(() => this.settle(DWELL, this.moved));
    this.enqueue(() => this.sendButton(button, true));
    this.enqueue(() => this.settle(HOLD));
  }

  release(button: MouseButton): void {
    this.enqueue(() => this.sendButton(button, false));
    this.enqueue(() => this.settle(RELEASE));
  }

  /** Lets go of everything at once, skipping whatever was still queued. */
  releaseAll(): void {
    this.queue.length = 0;
    this.pendingScroll = 0;
    for (const button of ['left', 'right'] as const) {
      if (this.buttons & BUTTON_MASK[button]) this.sendButton(button, false);
    }
  }

  private scroll(dx: number, dy: number): void {
    // One step at a time: the games take a single step per poll, however far
    // the wheel turned. A step may go both ways at once.
    for (let i = 0; i < Math.max(Math.abs(dx), Math.abs(dy)); i++) {
      if (this.pendingScroll >= MAX_PENDING_SCROLL) return;
      const stepX = i < Math.abs(dx) ? Math.sign(dx) : 0;
      const stepY = i < Math.abs(dy) ? Math.sign(dy) : 0;
      this.pendingScroll++;
      this.enqueue(() => {
        this.pendingScroll--;
        this.sendWheel(stepX, stepY);
      });
      this.enqueue(() => this.settle(SCROLL));
    }
  }

  private enqueue(step: () => void | Promise<void>): void {
    this.queue.push(step);
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (let step = this.queue.shift(); step; step = this.queue.shift()) await step();
    } finally {
      this.draining = false;
    }
  }

  /** Waits until the game has had the time and the turns to see a change made at `since` (default: just now). */
  private async settle(
    wait: { ms: number; turns: number; giveUp: number },
    since = { at: performance.now(), turn: this.turns() },
  ): Promise<void> {
    const started = performance.now();
    for (;;) {
      if (performance.now() - since.at >= wait.ms && this.turns() - since.turn >= wait.turns) return;
      if (performance.now() - started >= wait.giveUp) return;
      await delay(8);
    }
  }

  private event<T extends object>(extra: T): T & MouseEventInit {
    const rect = this.canvas.getBoundingClientRect();
    return {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + this.x,
      clientY: rect.top + this.y,
      screenX: rect.left + this.x,
      screenY: rect.top + this.y,
      buttons: this.buttons,
      ...extra,
    };
  }

  private sendMove(x: number, y: number): void {
    const movementX = x - this.x;
    const movementY = y - this.y;
    this.x = x;
    this.y = y;
    if (movementX !== 0 || movementY !== 0) this.moved = { at: performance.now(), turn: this.turns() };
    this.canvas.dispatchEvent(new MouseEvent('mousemove', this.event({ movementX, movementY })));
  }

  private sendButton(button: MouseButton, down: boolean): void {
    const mask = BUTTON_MASK[button];
    if (down === ((this.buttons & mask) !== 0)) return;
    // The engine takes the position from the last movement it saw; make sure there was one.
    this.canvas.dispatchEvent(new MouseEvent('mousemove', this.event({ movementX: 0, movementY: 0 })));
    this.buttons = down ? this.buttons | mask : this.buttons & ~mask;
    this.canvas.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', this.event({ button: BUTTON_INDEX[button] })));
  }

  private sendWheel(stepX: number, stepY: number): void {
    // A wheel turned away from the user scrolls up, which moves the content
    // down. Fingers moving down should do the same, hence the signs.
    this.canvas.dispatchEvent(
      new WheelEvent('wheel', this.event({ deltaX: -stepX * 100, deltaY: -stepY * 100, deltaMode: WheelEvent.DOM_DELTA_PIXEL })),
    );
  }

  /** A real mouse moved the pointer; remember where, so the next relative move starts there. */
  sync(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
}
