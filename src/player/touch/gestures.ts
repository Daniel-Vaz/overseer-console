/**
 * Turns fingers on the picture into what the games understand: a mouse.
 *
 * The games are played with a pointer that hovers, a left button that is
 * clicked or held, a right button that switches the cursor's mode, and
 * scrolling. Fingers map onto that as follows:
 *
 *   tap                      left click
 *   drag                     move the pointer (nothing is clicked)
 *   press and hold           hold the left button; drag on to drag, lift to let go
 *   while dragging, tap
 *     with a second finger   left click where the pointer is (for small targets)
 *   two-finger tap           right click
 *   two-finger drag          scroll
 *   drag up or down a list   scroll the list (direct mode); flicked, it glides on
 *
 * In "direct" mode the pointer goes where the finger is. In "trackpad" mode
 * the picture is a trackpad: dragging moves the pointer from where it was,
 * and a tap clicks where the pointer is, not where the finger landed.
 *
 * The lists are the games' inventories, which scroll with the mouse wheel
 * while the pointer is over them. Scrolling one, the pointer goes onto it.
 *
 * This file is only the decision making: touches in, mouse actions out. It
 * knows nothing of the page, so that it can be tested on its own.
 */

export type PointerMode = 'direct' | 'trackpad';

export type MouseButton = 'left' | 'right';

export type MouseAction =
  /** The pointer is now here (picture coordinates, in CSS pixels). */
  | { type: 'move'; x: number; y: number }
  /** A button goes down and stays down. */
  | { type: 'press'; button: MouseButton }
  | { type: 'release'; button: MouseButton }
  /** A button goes down and comes up again. */
  | { type: 'click'; button: MouseButton }
  /** Scroll by whole steps. Positive: the content moves right / down, following the fingers. */
  | { type: 'scroll'; dx: number; dy: number };

/** A list of the game's that scrolls by the row (an inventory), in picture coordinates. */
export interface ScrollList {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The height of one of its rows: one step of scrolling. */
  row: number;
}

export type ListFinder = (x: number, y: number) => ScrollList | null;

export interface GestureTuning {
  /** A finger that moved less than this (CSS pixels) has not moved. */
  slop: number;
  /** A still finger turns into a held button after this long. */
  holdMs: number;
  /** Two fingers that lift within this long of landing made a tap. */
  tapMs: number;
  /** Finger travel per step of scrolling, sideways and up or down. */
  scrollStepX: number;
  scrollStepY: number;
  /** Trackpad mode: pointer travel per finger travel. */
  trackpadSpeed: number;
  /** A list let go of faster than this (CSS pixels per millisecond) glides on. */
  flingSpeed: number;
  /** How quickly a glide slows down: its speed falls to a third in about this long. */
  flingMs: number;
}

export const DEFAULT_TUNING: GestureTuning = {
  slop: 12,
  holdMs: 350,
  tapMs: 400,
  scrollStepX: 32,
  scrollStepY: 24,
  trackpadSpeed: 1.5,
  flingSpeed: 0.3,
  flingMs: 325,
};

/** How far back the finger's speed is measured when it lets go of a list. */
const FLING_WINDOW_MS = 100;
/** A glide stops once its next row is further off than this. */
const FLING_LONGEST_MS = 1200;
/** The games take a turn of the wheel this often at most; a glide goes no faster. */
const FLING_STEP_MS = 40;

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Finger {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  downAt: number;
  moved: boolean;
}

/**
 * idle     no finger down
 * pending  one finger, not yet known whether it taps, drags or holds
 * hover    one finger dragging the pointer about
 * aiming   as hover, with a second finger down that may tap to click
 * held     one finger holding the left button
 * pair     two fingers, not yet known whether they tap or scroll
 * scroll   two fingers scrolling
 * swipe    one finger scrolling a list
 * spent    the gesture is over; waiting for every finger to lift
 */
type State = 'idle' | 'pending' | 'hover' | 'aiming' | 'held' | 'pair' | 'scroll' | 'swipe' | 'spent';

export class Gestures {
  private state: State = 'idle';
  private fingers = new Map<number, Finger>();
  private first: Finger | null = null;
  private second: Finger | null = null;
  private holdTimer: unknown = null;
  private pointerX: number;
  private pointerY: number;
  /** Where the pointer was before the finger of this gesture landed. */
  private restX = 0;
  private restY = 0;
  private pairAt = 0;
  private scrollX = 0;
  private scrollY = 0;
  private centreX = 0;
  private centreY = 0;
  /** The list under the finger that began this gesture (direct mode), or that two fingers scroll. */
  private list: ScrollList | null = null;
  /** Rows a swiping finger has scrolled so far. */
  private swiped = 0;
  /** Where the swiping finger was lately, for its speed when it lets go. */
  private trail: { y: number; at: number }[] = [];
  private flingTimer: unknown = null;
  /** The finger of this gesture caught a gliding list: lifting it clicks nothing. */
  private caught = false;
  /** Where the game's scrolling lists are. None, until the page says. */
  listAt: ListFinder = () => null;

  constructor(
    private width: number,
    private height: number,
    private mode: PointerMode,
    private readonly emit: (action: MouseAction) => void,
    private readonly tuning: GestureTuning = DEFAULT_TUNING,
    private readonly timers: Timers = REAL_TIMERS,
  ) {
    this.pointerX = width / 2;
    this.pointerY = height / 2;
  }

  get pointer(): { x: number; y: number } {
    return { x: this.pointerX, y: this.pointerY };
  }

  get busy(): boolean {
    return this.state !== 'idle';
  }

  setMode(mode: PointerMode): void {
    this.mode = mode;
  }

  /** The picture changed size: the pointer keeps its place in it. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.pointerX = (this.pointerX / this.width) * width;
    this.pointerY = (this.pointerY / this.height) * height;
    this.width = width;
    this.height = height;
  }

  /** Something else moved the pointer (a real mouse). */
  pointerMovedTo(x: number, y: number): void {
    if (this.state !== 'idle') return;
    this.pointerX = this.clampX(x);
    this.pointerY = this.clampY(y);
  }

  down(id: number, x: number, y: number, now: number): void {
    const finger: Finger = { id, startX: x, startY: y, x, y, downAt: now, moved: false };
    this.fingers.set(id, finger);

    switch (this.state) {
      case 'idle':
        // A finger on a gliding list stops it, and does nothing else unless it goes on.
        this.caught = this.stopFling();
        this.first = finger;
        this.restX = this.pointerX;
        this.restY = this.pointerY;
        this.list = this.mode === 'direct' ? this.listAt(x, y) : null;
        this.state = 'pending';
        if (this.mode === 'direct') this.moveTo(x, y);
        this.holdTimer = this.timers.set(() => this.onHold(), this.tuning.holdMs);
        break;
      case 'pending':
        // A second finger before the first did anything: a two-finger gesture.
        // The pointer goes back to where it was; it is not part of this.
        this.clearHold();
        this.second = finger;
        this.pairAt = now;
        this.state = 'pair';
        this.moveTo(this.restX, this.restY);
        this.markCentre();
        break;
      case 'hover':
        this.second = finger;
        this.state = 'aiming';
        break;
      case 'aiming':
      case 'pair':
      case 'scroll':
        // A third finger means nothing here.
        this.state = 'spent';
        break;
      case 'held':
      case 'swipe':
      case 'spent':
        break;
    }
  }

  move(id: number, x: number, y: number, now: number): void {
    const finger = this.fingers.get(id);
    if (!finger) return;
    const dx = x - finger.x;
    const dy = y - finger.y;
    finger.x = x;
    finger.y = y;
    if (!finger.moved && Math.hypot(x - finger.startX, y - finger.startY) > this.tuning.slop) {
      finger.moved = true;
      // In trackpad mode the pointer starts moving from here, not from where the finger landed.
      if (this.mode === 'trackpad' && finger === this.first && this.state === 'pending') {
        this.clearHold();
        this.state = 'hover';
        return;
      }
    }

    switch (this.state) {
      case 'pending':
        if (finger !== this.first) break;
        if (this.mode === 'direct') {
          if (finger.moved && this.list && Math.abs(y - finger.startY) >= Math.abs(x - finger.startX)) {
            // Up or down a list: it scrolls, with the pointer on it where the finger landed.
            this.clearHold();
            this.state = 'swipe';
            this.moveTo(finger.startX, finger.startY);
            this.swiped = 0;
            this.trail = [];
            this.swipe(finger, now);
            break;
          }
          // The pointer is under the finger from the start; a tap clicks where the finger lifts.
          this.moveTo(x, y);
          if (finger.moved) {
            this.clearHold();
            this.state = 'hover';
          }
        }
        break;
      case 'hover':
      case 'held':
        if (finger === this.first) this.follow(finger, dx, dy);
        break;
      case 'aiming':
        if (finger === this.first) {
          this.follow(finger, dx, dy);
        } else if (finger === this.second && finger.moved) {
          // The second finger came to scroll, not to tap. A list under the pointer scrolls by its rows.
          this.state = 'scroll';
          this.list = this.listAt(this.pointerX, this.pointerY);
          this.markCentre();
        }
        break;
      case 'pair':
        if (this.first!.moved || this.second!.moved) {
          // With one of the two already lifted it is neither a tap nor a scroll.
          this.state = this.fingers.size === 2 ? 'scroll' : 'spent';
          if (this.state === 'scroll') {
            this.list = this.pairList();
            // Counted from where the fingers landed: the ground stays under
            // them, and the same drag back brings the same view back.
            this.scrollTo();
          }
        }
        break;
      case 'scroll':
        this.scrollTo();
        break;
      case 'swipe':
        if (finger === this.first) this.swipe(finger, now);
        break;
      case 'idle':
      case 'spent':
        break;
    }
  }

  up(id: number, now: number): void {
    const finger = this.fingers.get(id);
    if (!finger) return;
    this.fingers.delete(id);

    switch (this.state) {
      case 'pending':
        this.clearHold();
        if (this.onPicture(finger) && !this.caught) this.emit({ type: 'click', button: 'left' });
        break;
      case 'swipe':
        if (finger === this.first) this.fling(now);
        break;
      case 'held':
        if (finger !== this.first) return;
        this.emit({ type: 'release', button: 'left' });
        break;
      case 'aiming':
        if (finger === this.second) {
          if (!finger.moved && now - finger.downAt <= this.tuning.tapMs) this.emit({ type: 'click', button: 'left' });
          this.second = null;
          this.state = 'hover';
          return;
        }
        break;
      case 'pair':
        // Fingers never lift at the same instant; the tap is complete when the last one has.
        if (this.fingers.size > 0) return;
        if (now - this.pairAt <= this.tuning.tapMs) this.emit({ type: 'click', button: 'right' });
        break;
      case 'hover':
      case 'scroll':
      case 'spent':
      case 'idle':
        break;
    }
    // Whatever it was, it ends when the first of its fingers lifts.
    this.finish();
  }

  /** The system took the touches away (a palm, an incoming call, a system gesture). */
  cancel(): void {
    this.clearHold();
    this.stopFling();
    if (this.state === 'held') this.emit({ type: 'release', button: 'left' });
    this.fingers.clear();
    this.state = 'idle';
    this.first = this.second = null;
  }

  private finish(): void {
    this.first = this.second = null;
    this.list = null;
    this.caught = false;
    this.state = this.fingers.size ? 'spent' : 'idle';
  }

  private onHold(): void {
    this.holdTimer = null;
    if (this.state !== 'pending') return;
    if (!this.onPicture(this.first!)) {
      // Resting a finger beside the picture holds the pointer at its edge
      // (which scrolls the map); it presses nothing.
      this.state = 'hover';
      return;
    }
    this.state = 'held';
    this.emit({ type: 'press', button: 'left' });
  }

  /**
   * Whether a finger is on the picture rather than on the border around it.
   * Only asked in direct mode: a trackpad is a trackpad all over.
   */
  private onPicture(finger: Finger): boolean {
    if (this.mode === 'trackpad') return true;
    const margin = this.tuning.slop;
    return finger.x >= -margin && finger.y >= -margin && finger.x < this.width + margin && finger.y < this.height + margin;
  }

  private clearHold(): void {
    if (this.holdTimer !== null) this.timers.clear(this.holdTimer);
    this.holdTimer = null;
  }

  private follow(finger: Finger, dx: number, dy: number): void {
    if (this.mode === 'direct') {
      this.moveTo(finger.x, finger.y);
    } else {
      this.moveTo(this.pointerX + dx * this.tuning.trackpadSpeed, this.pointerY + dy * this.tuning.trackpadSpeed);
    }
  }

  private moveTo(x: number, y: number): void {
    const nextX = this.clampX(x);
    const nextY = this.clampY(y);
    if (nextX === this.pointerX && nextY === this.pointerY) return;
    this.pointerX = nextX;
    this.pointerY = nextY;
    this.emit({ type: 'move', x: nextX, y: nextY });
  }

  private clampX(x: number): number {
    return Math.min(this.width - 1, Math.max(0, x));
  }

  private clampY(y: number): number {
    return Math.min(this.height - 1, Math.max(0, y));
  }

  private centre(): [number, number] {
    const a = this.first!;
    const b = this.second!;
    return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  }

  private markCentre(): void {
    [this.centreX, this.centreY] = this.centre();
    this.scrollX = this.scrollY = 0;
  }

  private scrollTo(): void {
    const [x, y] = this.centre();
    this.scrollX += x - this.centreX;
    this.scrollY += y - this.centreY;
    this.centreX = x;
    this.centreY = y;
    // A list scrolls up and down only, a row per row of finger travel.
    if (this.list) this.scrollX = 0;
    const stepX = this.tuning.scrollStepX;
    const stepY = this.list ? this.list.row : this.tuning.scrollStepY;
    const dx = Math.trunc(this.scrollX / stepX);
    const dy = Math.trunc(this.scrollY / stepY);
    if (dx === 0 && dy === 0) return;
    this.scrollX -= dx * stepX;
    this.scrollY -= dy * stepY;
    this.emit({ type: 'scroll', dx, dy });
  }

  /**
   * The list two fingers came to scroll. In direct mode, the one under them,
   * and the pointer goes onto it where they landed; in trackpad mode, the one
   * under the pointer.
   */
  private pairList(): ScrollList | null {
    if (this.mode === 'trackpad') return this.listAt(this.pointerX, this.pointerY);
    const a = this.first!;
    const b = this.second!;
    const x = (a.startX + b.startX) / 2;
    const y = (a.startY + b.startY) / 2;
    const list = this.listAt(x, y);
    if (list) this.moveTo(x, y);
    return list;
  }

  /** A finger swiping a list: it follows the finger a row at a time, counted from where it landed. */
  private swipe(finger: Finger, now: number): void {
    this.trail.push({ y: finger.y, at: now });
    while (this.trail.length > 2 && now - this.trail[0]!.at > FLING_WINDOW_MS) this.trail.shift();
    const rows = Math.trunc((finger.y - finger.startY) / this.list!.row);
    if (rows === this.swiped) return;
    this.emit({ type: 'scroll', dx: 0, dy: rows - this.swiped });
    this.swiped = rows;
  }

  /**
   * A list let go of while still moving glides on, slowing down as it goes:
   * its speed falls off exponentially, so the rows come further and further
   * apart, and the whole glide covers the finger's speed times flingMs.
   */
  private fling(now: number): void {
    const from = this.trail.find((point) => now - point.at <= FLING_WINDOW_MS);
    const to = this.trail[this.trail.length - 1];
    this.trail = [];
    if (!from || !to || to.at <= from.at) return;
    const speed = (to.y - from.y) / (to.at - from.at);
    if (Math.abs(speed) < this.tuning.flingSpeed) return;
    const row = this.list!.row;
    const tau = this.tuning.flingMs;
    const reach = Math.abs(speed) * tau;
    const direction = Math.sign(speed);
    // When the glide has covered k rows.
    const at = (k: number) => -tau * Math.log(1 - (k * row) / reach);
    let k = 0;
    const next = () => {
      this.flingTimer = null;
      // The list went (the inventory was closed): the wheel would scroll whatever is there now.
      if (!this.listAt(this.pointerX, this.pointerY)) return;
      this.emit({ type: 'scroll', dx: 0, dy: direction });
      schedule();
    };
    const schedule = () => {
      if ((k + 1) * row >= reach) return;
      const wait = at(k + 1) - at(k);
      if (at(k + 1) > FLING_LONGEST_MS) return;
      k++;
      this.flingTimer = this.timers.set(next, Math.max(wait, FLING_STEP_MS));
    };
    schedule();
  }

  /** Something other than a finger on the picture took over (a button beside it): a gliding list stops. */
  stopGlide(): void {
    this.stopFling();
  }

  /** Stops a glide. True when there was one. */
  private stopFling(): boolean {
    if (this.flingTimer === null) return false;
    this.timers.clear(this.flingTimer);
    this.flingTimer = null;
    return true;
  }
}
