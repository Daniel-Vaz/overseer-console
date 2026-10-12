import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, Gestures, type MouseAction, type PointerMode, type Timers } from '../../src/player/touch/gestures';

/** A clock the test moves by hand. */
class FakeTimers implements Timers {
  now = 0;
  private pending: { at: number; callback: () => void }[] = [];
  set(callback: () => void, ms: number): unknown {
    const entry = { at: this.now + ms, callback };
    this.pending.push(entry);
    return entry;
  }
  clear(handle: unknown): void {
    this.pending = this.pending.filter((entry) => entry !== handle);
  }
  advance(ms: number): void {
    this.now += ms;
    const due = this.pending.filter((entry) => entry.at <= this.now);
    this.pending = this.pending.filter((entry) => entry.at > this.now);
    for (const entry of due) entry.callback();
  }
}

const HOLD = DEFAULT_TUNING.holdMs;

let timers: FakeTimers;
let actions: MouseAction[];
let gestures: Gestures;

function start(mode: PointerMode): void {
  timers = new FakeTimers();
  actions = [];
  // A 640x480 picture; the pointer starts in its middle.
  gestures = new Gestures(640, 480, mode, (action) => actions.push(action), DEFAULT_TUNING, timers);
}

const down = (id: number, x: number, y: number) => gestures.down(id, x, y, timers.now);
const move = (id: number, x: number, y: number) => gestures.move(id, x, y);
const up = (id: number) => gestures.up(id, timers.now);
const wait = (ms: number) => timers.advance(ms);
/** What happened, written compactly. */
const log = () =>
  actions.map((action) =>
    action.type === 'move'
      ? `move ${Math.round(action.x)},${Math.round(action.y)}`
      : action.type === 'scroll'
        ? `scroll ${action.dx},${action.dy}`
        : `${action.type} ${action.button}`,
  );

describe('direct pointer', () => {
  beforeEach(() => start('direct'));

  it('a tap clicks where the finger is', () => {
    down(1, 100, 200);
    wait(80);
    up(1);
    expect(log()).toEqual(['move 100,200', 'click left']);
    expect(gestures.busy).toBe(false);
  });

  it('a tap may wobble a little and still clicks, where the finger lifted', () => {
    down(1, 100, 200);
    move(1, 104, 203);
    wait(120);
    up(1);
    expect(log()).toEqual(['move 100,200', 'move 104,203', 'click left']);
  });

  it('a drag moves the pointer and clicks nothing', () => {
    down(1, 100, 200);
    move(1, 130, 200);
    move(1, 300, 260);
    wait(900);
    up(1);
    expect(log()).toEqual(['move 100,200', 'move 130,200', 'move 300,260']);
    expect(gestures.pointer).toEqual({ x: 300, y: 260 });
  });

  it('a still finger presses the left button, drags with it and lets go on lifting', () => {
    down(1, 100, 200);
    wait(HOLD);
    expect(log()).toEqual(['move 100,200', 'press left']);
    move(1, 180, 240);
    up(1);
    expect(log()).toEqual(['move 100,200', 'press left', 'move 180,240', 'release left']);
  });

  it('does not hold once the finger has moved away', () => {
    down(1, 100, 200);
    wait(HOLD - 50);
    move(1, 160, 200);
    wait(500);
    up(1);
    expect(log()).toEqual(['move 100,200', 'move 160,200']);
  });

  it('two fingers tapping together right-click, and leave the pointer where it was', () => {
    down(1, 100, 200);
    wait(30);
    down(2, 180, 210);
    wait(90);
    up(1);
    wait(20);
    up(2);
    // The pointer went under the first finger for a moment and came back to the middle.
    expect(log()).toEqual(['move 100,200', 'move 320,240', 'click right']);
    expect(gestures.busy).toBe(false);
  });

  it('two fingers resting too long are not a tap', () => {
    down(1, 100, 200);
    down(2, 180, 210);
    wait(DEFAULT_TUNING.tapMs + 100);
    up(1);
    up(2);
    expect(log()).toEqual(['move 100,200', 'move 320,240']);
  });

  it('two fingers dragging scroll, in whole steps, following the fingers', () => {
    const stepX = DEFAULT_TUNING.scrollStepX;
    const stepY = DEFAULT_TUNING.scrollStepY;
    down(1, 100, 200);
    down(2, 180, 200);
    actions.length = 0;
    // Both fingers move right by two and a half steps: each carries the middle half as far.
    move(1, 100 + stepX * 2.5, 200);
    move(2, 180 + stepX * 2.5, 200);
    expect(log()).toEqual(['scroll 1,0', 'scroll 1,0']);
    // And up by one step; with the half step to the right still owed that makes a diagonal one.
    move(1, 100 + stepX * 3, 200 - stepY);
    move(2, 180 + stepX * 3, 200 - stepY);
    expect(log()).toEqual(['scroll 1,0', 'scroll 1,0', 'scroll 1,-1']);
    up(1);
    move(2, 400, 400);
    up(2);
    expect(log()).toHaveLength(3);
    expect(gestures.busy).toBe(false);
  });

  it('the same drag there and back scrolls as far back as it went', () => {
    const count = (from: [number, number], to: [number, number]) => {
      actions.length = 0;
      down(1, from[0], from[1]);
      down(2, from[0] + 70, from[1]);
      for (let step = 1; step <= 30; step++) {
        const x = Math.round(from[0] + ((to[0] - from[0]) * step) / 30);
        const y = Math.round(from[1] + ((to[1] - from[1]) * step) / 30);
        move(1, x, y);
        move(2, x + 70, y);
      }
      up(1);
      up(2);
      return actions.reduce((sum, action) => (action.type === 'scroll' ? [sum[0]! + action.dx, sum[1]! + action.dy] : sum), [0, 0]);
    };
    for (const [from, to] of [[[203, 122], [325, 187]], [[90, 300], [311, 144]], [[400, 100], [391, 333]]] as [[number, number], [number, number]][]) {
      const there = count(from, to);
      const back = count(to, from);
      expect([there[0]! + back[0]!, there[1]! + back[1]!]).toEqual([0, 0]);
      expect(Math.abs(there[0]!) + Math.abs(there[1]!)).toBeGreaterThan(2);
    }
  });

  it('while dragging, a tap of a second finger clicks where the pointer is', () => {
    down(1, 100, 200);
    move(1, 250, 300);
    wait(600);
    down(2, 500, 400);
    wait(70);
    up(2);
    expect(log()).toEqual(['move 100,200', 'move 250,300', 'click left']);
    // The first finger is still aiming.
    move(1, 260, 310);
    down(2, 500, 400);
    up(2);
    up(1);
    expect(log()).toEqual(['move 100,200', 'move 250,300', 'click left', 'move 260,310', 'click left']);
  });

  it('while dragging, a second finger that moves scrolls instead', () => {
    const step = DEFAULT_TUNING.scrollStepX;
    down(1, 100, 200);
    move(1, 200, 200);
    down(2, 300, 200);
    actions.length = 0;
    move(2, 300, 200 + DEFAULT_TUNING.scrollStepY * 2.5);
    move(1, 200, 200 + DEFAULT_TUNING.scrollStepY * 2.5);
    up(2);
    up(1);
    expect(log()).toEqual(['scroll 0,1']);
  });

  it('keeps the pointer on the picture', () => {
    down(1, -50, 700);
    move(1, 900, -20);
    up(1);
    expect(log()).toEqual(['move 0,479', 'move 639,0']);
  });

  it('a tap beside the picture clicks nothing, and a resting finger there presses nothing', () => {
    down(1, -60, 240);
    up(1);
    expect(log()).toEqual(['move 0,240']);
    actions.length = 0;
    // Resting a finger on the border keeps the pointer at the edge, which scrolls the map.
    down(1, 700, 240);
    wait(HOLD * 3);
    move(1, 700, 300);
    up(1);
    expect(log()).toEqual(['move 639,240', 'move 639,300']);
  });

  it('ignores further fingers while a button is held', () => {
    down(1, 100, 200);
    wait(HOLD);
    down(2, 400, 400);
    move(2, 450, 450);
    up(2);
    move(1, 120, 220);
    up(1);
    expect(log()).toEqual(['move 100,200', 'press left', 'move 120,220', 'release left']);
    expect(gestures.busy).toBe(false);
  });

  it('lets go of the button when the system takes the touch away', () => {
    down(1, 100, 200);
    wait(HOLD);
    gestures.cancel();
    expect(log()).toEqual(['move 100,200', 'press left', 'release left']);
    expect(gestures.busy).toBe(false);
    // And works normally afterwards.
    down(1, 50, 60);
    up(1);
    expect(log().slice(-2)).toEqual(['move 50,60', 'click left']);
  });

  it('three fingers do nothing', () => {
    down(1, 100, 200);
    down(2, 150, 200);
    down(3, 200, 200);
    up(1);
    up(2);
    up(3);
    expect(log()).toEqual(['move 100,200', 'move 320,240']);
    expect(gestures.busy).toBe(false);
  });

  it('keeps the pointer in place when the picture changes size', () => {
    down(1, 160, 120);
    up(1);
    gestures.resize(320, 240);
    expect(gestures.pointer).toEqual({ x: 80, y: 60 });
  });
});

describe('trackpad pointer', () => {
  beforeEach(() => start('trackpad'));
  const speed = DEFAULT_TUNING.trackpadSpeed;

  it('a tap clicks where the pointer already is, wherever the finger lands', () => {
    down(1, 20, 30);
    wait(60);
    up(1);
    expect(log()).toEqual(['click left']);
    expect(gestures.pointer).toEqual({ x: 320, y: 240 });
  });

  it('a drag moves the pointer from where it was, by how far the finger travels', () => {
    down(1, 500, 400);
    move(1, 500 + 20, 400); // far enough to count as moving; the pointer starts from here
    move(1, 500 + 60, 400 + 10);
    up(1);
    expect(log()).toEqual([`move ${320 + 40 * speed},${240 + 10 * speed}`]);
  });

  it('small movements of a tapping finger do not nudge the pointer', () => {
    down(1, 100, 100);
    move(1, 105, 103);
    up(1);
    expect(log()).toEqual(['click left']);
  });

  it('press and hold drags from the pointer', () => {
    down(1, 600, 50);
    wait(HOLD);
    move(1, 600, 90);
    up(1);
    expect(log()).toEqual(['press left', `move 320,${240 + 40 * speed}`, 'release left']);
  });

  it('two-finger tap and scroll work as in direct mode', () => {
    down(1, 100, 200);
    down(2, 180, 210);
    up(2);
    up(1);
    expect(log()).toEqual(['click right']);
    actions.length = 0;
    down(1, 100, 200);
    down(2, 180, 200);
    actions.length = 0;
    move(1, 100, 200 + DEFAULT_TUNING.scrollStepY * 3);
    move(2, 180, 200 + DEFAULT_TUNING.scrollStepY * 3);
    up(1);
    up(2);
    expect(log()).toEqual(['scroll 0,1', 'scroll 0,2']);
  });

  it('a real mouse moving the pointer is taken into account', () => {
    gestures.pointerMovedTo(50, 60);
    down(1, 300, 300);
    up(1);
    expect(gestures.pointer).toEqual({ x: 50, y: 60 });
  });
});
