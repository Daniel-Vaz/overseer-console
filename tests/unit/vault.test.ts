import { describe, expect, it } from 'vitest';
import { breed } from '../../src/launcher/vault/critters';
import { arrange, DOOR_HEIGHT, DOOR_WIDTH, GEAR, MONITOR, STOREY, lampOver, spotAt, type Layout } from '../../src/launcher/vault/layout';
import { BUILDS, Life, type Actor, type Visit } from '../../src/launcher/vault/life';
import { Pest } from '../../src/launcher/vault/pest';
import { REMARKS, lampRemark, roomRemark, tally } from '../../src/launcher/vault/remarks';
import { paintBack, paintCog, paintFront } from '../../src/launcher/vault/scenery';

const VISITS: Visit[] = ['ghoul', 'stare', 'glowing', 'molerat', 'pack', 'radroach', 'swarm', 'dog', 'eyes'];

/** A window with the console in the middle of it, in the coarse pixels the room is painted in. */
function room(width: number, height: number, consoleWidth = 500, consoleHeight = 340): Layout {
  return arrange(width, height, { x: Math.round((width - consoleWidth) / 2), y: Math.round((height - consoleHeight) / 2), width: consoleWidth, height: consoleHeight });
}

/** A full-HD window: 70 pixels of room either side of the console, next to nothing above and below. */
const fullHd = () => room(640, 360);

/** Numbers that look random and are the same on every run. */
function dice(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Lets time pass a twelfth of a second at a time, as the page does, until the hall is empty. Returns the seconds it took. */
function watch(life: Life, each?: (actor: Actor) => void, limit = 600): number {
  let seconds = 0;
  while (life.actors.length && seconds < limit) {
    life.step(1 / 12);
    seconds += 1 / 12;
    for (const actor of life.actors) each?.(actor);
  }
  return seconds;
}

function inSight(layout: Layout, x: number): boolean {
  return x >= 0 && x <= layout.width && (x <= layout.console.x || x >= layout.console.x + layout.console.width);
}

describe('the room', () => {
  it('keeps what matters most where a narrow margin still shows it', () => {
    const layout = fullHd();
    const right = layout.console.x + layout.console.width;

    // The hub of the great door, with its number.
    expect(layout.gear.x).toBeGreaterThan(8);
    expect(layout.gear.x).toBeLessThan(layout.console.x);
    // A way out on the floor, standing open.
    const exit = layout.doorways.find((door) => door.level === 0 && door.state === 'open')!;
    expect(exit.x).toBeGreaterThanOrEqual(right);
    expect(exit.x + DOOR_WIDTH).toBeLessThanOrEqual(layout.width);
    // The words on the wall and the monitor.
    expect(layout.graffiti!.x).toBeGreaterThanOrEqual(0);
    expect(layout.graffiti!.x + 27 * layout.graffiti!.scale).toBeLessThanOrEqual(layout.console.x);
    expect(layout.monitor!.x).toBeGreaterThanOrEqual(right);
    expect(layout.monitor!.x + MONITOR.width).toBeLessThanOrEqual(layout.width);
  });

  it('hangs nothing on the wall that the window would cut in half', () => {
    // A console of the usual size, with every margin from the narrowest that shows the room at all.
    let monitors = 0;
    let words = 0;
    for (const height of [300, 360, 480]) {
      for (let margin = 14; margin <= 90; margin++) {
        const layout = arrange(500 + 2 * margin, height, { x: margin, y: 5, width: 500, height: height - 10 });
        const right = layout.console.x + layout.console.width;
        if (layout.monitor) {
          monitors++;
          expect(layout.monitor.x, `monitor, margin ${margin}`).toBeGreaterThan(right);
          expect(layout.monitor.x + MONITOR.width, `monitor, margin ${margin}`).toBeLessThan(layout.width);
          // Its light comes with it, and only with it.
          expect(layout.lamps.filter((lamp) => lamp.mood === 'screen')).toHaveLength(1);
        } else {
          expect(layout.lamps.some((lamp) => lamp.mood === 'screen'), `no monitor, margin ${margin}`).toBe(false);
        }
        if (layout.graffiti) {
          words++;
          expect(layout.graffiti.x, `words, margin ${margin}`).toBeGreaterThan(0);
          expect(layout.graffiti.x + 27 * layout.graffiti.scale, `words, margin ${margin}`).toBeLessThanOrEqual(layout.console.x);
        }
      }
    }
    // Both are there where there is room, and neither where there is none.
    expect(monitors).toBeGreaterThan(50);
    expect(words).toBeGreaterThan(50);
    expect(arrange(528, 360, { x: 14, y: 5, width: 500, height: 350 }).monitor).toBeNull();
    expect(arrange(528, 360, { x: 14, y: 5, width: 500, height: 350 }).graffiti).toBeNull();
    // A wall a little too narrow for the usual place still takes the monitor, nearer the console.
    const snug = arrange(604, 360, { x: 52, y: 5, width: 500, height: 350 });
    expect(snug.monitor).toEqual({ x: 604 - MONITOR.width - 3, y: 27 });
  });

  it('has a gallery for every storey the window has room for', () => {
    expect(room(640, 250).decks).toHaveLength(0);
    expect(room(640, 360).decks).toHaveLength(1);
    expect(room(854, 480).decks).toHaveLength(2);
    const tall = room(1280, 720);
    expect(tall.decks).toHaveLength(4);
    expect(tall.decks[0]! - tall.decks[1]!).toBe(STOREY);
  });

  it('lights the warning lamp red on the anniversary only', () => {
    const console = { x: 70, y: 10, width: 500, height: 340 };
    const beacon = (layout: Layout) => layout.lamps.find((lamp) => lamp.mood === 'beacon')!.ink;
    expect(beacon(arrange(640, 360, console, true))).not.toBe(beacon(arrange(640, 360, console)));
  });

  it('is painted the same on every visit, with nothing left blank', () => {
    const layout = room(320, 330, 200, 150);
    const first = paintBack(layout);
    const again = paintBack(layout);
    expect(Buffer.compare(Buffer.from(first.data.buffer), Buffer.from(again.data.buffer))).toBe(0);
    let blank = 0;
    for (let i = 3; i < first.data.length; i += 4) if (first.data[i] !== 255) blank++;
    expect(blank).toBe(0);

    // In front of whatever walks the gallery there is nothing but its railing.
    expect(layout.decks).toHaveLength(1);
    const front = paintFront(layout);
    const deck = layout.decks[0]!;
    for (let y = 0; y < layout.height; y++) {
      const painted = front.at(160, y) >= 0 || front.at(161, y) >= 0 || front.at(175, y) >= 0;
      if (y < deck - 30 || y >= deck) expect(painted, `row ${y}`).toBe(false);
    }
    expect(front.at(175, deck - 30)).toBeGreaterThanOrEqual(0);
  });
});

describe('visitors', () => {
  it('the first comes within a quarter of a minute, the next only after a pause', () => {
    for (const seed of [1, 2, 3, 4]) {
      const life = new Life(fullHd(), dice(seed));
      let waited = 0;
      while (!life.actors.length && waited < 60) {
        life.step(1 / 12);
        waited += 1 / 12;
      }
      expect(waited).toBeLessThan(12.2);
      watch(life);
      expect(life.actors).toHaveLength(0);
      expect(life.rest).toBeGreaterThanOrEqual(16);
    }
  });

  it('every sort comes into a room that can show it, and leaves again', () => {
    for (const visit of VISITS) {
      for (const seed of [11, 12, 13, 14, 15, 16]) {
        const life = new Life(fullHd(), dice(seed));
        expect(life.send(visit), visit).toBe(true);
        const seconds = watch(life, (actor) => expect(Number.isFinite(actor.x) && Number.isFinite(actor.y), visit).toBe(true));
        expect(life.actors, `${visit} with seed ${seed} after ${Math.round(seconds)} s`).toHaveLength(0);
      }
    }
  });

  it('they manage in windows of other shapes as well', () => {
    const rooms = [room(854, 480), room(1147, 480), room(1280, 720), room(342, 455, 334, 340), room(560, 300), room(534, 300, 500, 290)];
    for (const [index, layout] of rooms.entries()) {
      for (const visit of VISITS) {
        const life = new Life(layout, dice(index * 31 + 7));
        if (!life.send(visit)) continue;
        watch(life);
        expect(life.actors, `${visit} in room ${index}`).toHaveLength(0);
      }
    }
  });

  it('can all be sent home, and then nobody comes for a good while', () => {
    const life = new Life(fullHd(), dice(9));
    life.parade();
    expect(life.actors.length).toBeGreaterThan(5);
    life.clear();
    expect(life.actors).toHaveLength(0);
    for (let i = 0; i < 12 * 100; i++) life.step(1 / 12);
    expect(life.actors).toHaveLength(0);
  });

  it('nothing is sent into a room that the console hides', () => {
    const layout = arrange(300, 200, { x: 0, y: 0, width: 300, height: 200 });
    for (const visit of VISITS) {
      const life = new Life(layout, dice(5));
      expect(life.send(visit), visit).toBe(false);
      expect(life.actors).toHaveLength(0);
    }
  });

  it('are never asked for a picture they do not have', () => {
    const asked = new Set<string>();
    for (const visit of VISITS) {
      for (const seed of [21, 22, 23]) {
        const life = new Life(room(854, 480), dice(seed));
        life.send(visit);
        watch(life, (actor) => asked.add(`${actor.kind} ${BUILDS[actor.kind].crawls ? `${actor.pose}${actor.heading}` : actor.pose}`));
      }
    }
    expect(asked.size).toBeGreaterThan(20);
    for (const entry of asked) {
      const [kind, pose] = entry.split(' ') as [Actor['kind'], string];
      const made = breed(kind);
      const sheets = made.poses[pose];
      expect(sheets?.length, entry).toBeGreaterThan(0);
      for (const sheet of sheets!) {
        expect([sheet.width, sheet.height], entry).toEqual([sheets![0]!.width, sheets![0]!.height]);
        expect(made.foot.x).toBeLessThan(sheet.width);
        expect(made.foot.y).toBeLessThan(sheet.height);
      }
    }
  });

  it('what goes behind the console does not dawdle there', () => {
    // A mole rat crosses the whole hall. At its own pace that takes half a minute; nobody watches most of it.
    for (const seed of [31, 32, 33]) {
      const life = new Life(fullHd(), dice(seed));
      life.send('molerat');
      expect(watch(life)).toBeLessThan(20);
    }
  });

  it('a ghoul that has noticed the console stops where it can be seen, and stares', () => {
    for (const seed of [41, 42, 43, 44, 45]) {
      const layout = fullHd();
      const life = new Life(layout, dice(seed));
      life.send('stare');
      const stared: number[] = [];
      watch(life, (actor) => {
        if (actor.pose === 'stare') stared.push(actor.x);
      });
      expect(stared.length, `seed ${seed}`).toBeGreaterThan(12);
      for (const x of stared) expect(inSight(layout, x)).toBe(true);
    }
  });

  it('a radroach comes from out of sight and stops only on wall that shows', () => {
    for (const seed of [51, 52, 53, 54, 55, 56]) {
      const layout = fullHd();
      const box = layout.console;
      const life = new Life(layout, dice(seed));
      life.send('radroach');
      const roach = life.actors[0]!;
      const hidden = (x: number, y: number) => x < 0 || x > layout.width || y < 0 || (x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height);
      expect(hidden(roach.x, roach.y), `starts at ${roach.x}, ${roach.y}`).toBe(true);
      watch(life, (actor) => {
        if (actor.pose === 'still' && actor.walked > 0) expect(inSight(layout, actor.x), `rests at ${actor.x}`).toBe(true);
      });
      expect(hidden(roach.x, roach.y), `ends at ${roach.x}, ${roach.y}`).toBe(true);
    }
  });
});

/** Sends one sort of visitor in and lets time pass until one of that kind stands in full view. */
function meet(life: Life, visit: Visit, kind: Actor['kind'], layout: Layout): Actor {
  expect(life.send(visit), visit).toBe(true);
  for (let i = 0; i < 12 * 240; i++) {
    life.step(1 / 12);
    const found = life.actors.find((actor) => actor.kind === kind && actor.shown >= 1 && inSight(layout, actor.x));
    if (found) return found;
  }
  throw new Error(`no ${kind} came into view`);
}

describe('the great door', () => {
  it('turns as it rolls, number and all', () => {
    const shut = paintCog(0);
    const again = paintCog(0);
    const rolled = paintCog(-1);
    expect(Buffer.compare(Buffer.from(shut.data.buffer), Buffer.from(again.data.buffer))).toBe(0);
    expect(Buffer.compare(Buffer.from(shut.data.buffer), Buffer.from(rolled.data.buffer))).not.toBe(0);
    // Its number is painted in yellow, which nothing else on it is: more red than blue by far.
    const yellow = (sheet: typeof shut) => {
      let count = 0;
      for (let i = 0; i < sheet.data.length; i += 4) if (sheet.data[i]! > 150 && sheet.data[i + 2]! < 80 && sheet.data[i + 3] === 255) count++;
      return count;
    };
    expect(yellow(shut)).toBeGreaterThan(40);
    expect(yellow(rolled)).toBeGreaterThan(40);
    // A cogwheel: the corners of its sheet stay empty, and so do the gaps between its teeth.
    expect(shut.at(0, 0)).toBeLessThan(0);
    expect(shut.at(GEAR + 1, GEAR + 1)).toBeGreaterThanOrEqual(0);
  });

  it('lets things in from outside only while it stands open', () => {
    const cameIn = (open: boolean) => {
      let count = 0;
      for (let seed = 0; seed < 60; seed++) {
        const layout = fullHd();
        const life = new Life(layout, dice(seed * 7 + 1));
        life.open = open;
        for (const visit of ['ghoul', 'molerat', 'dog'] as const) {
          life.actors.length = 0;
          life.send(visit);
          if (life.actors.some((actor) => actor.x === layout.portal)) count++;
        }
      }
      return count;
    };
    expect(cameIn(false)).toBe(0);
    expect(cameIn(true)).toBeGreaterThan(10);
  });

  it('has eyes behind it when somebody calls into the tunnel, and only then', () => {
    const layout = fullHd();
    const life = new Life(layout, dice(3));
    expect(life.lurk()).toBe(false);
    life.open = true;
    expect(life.lurk()).toBe(true);
    expect(life.actors[0]).toMatchObject({ kind: 'eyes', x: layout.portal - 2 });
    // One pair at a time.
    expect(life.lurk()).toBe(false);
  });
});

describe('poking', () => {
  it('a radroach is squashed where it sat, and the rest of the swarm runs for cover', () => {
    const layout = fullHd();
    const box = layout.console;
    const life = new Life(layout, dice(61));
    const roach = meet(life, 'swarm', 'radroach', layout);
    const at = { x: roach.x, y: roach.y };
    expect(life.under(at.x + 2, at.y - 2)).toBe(roach);

    const poke = life.poke(at.x + 2, at.y - 2)!;
    expect(poke.reaction).toBe('squashed');
    const stain = life.actors.find((actor) => actor.kind === 'stain')!;
    expect(stain).toMatchObject(at);
    // What is left of it takes no further notice.
    expect(life.poke(at.x, at.y)).toBeNull();

    const others = life.actors.filter((actor) => actor.kind === 'radroach');
    expect(others.length).toBeGreaterThan(1);
    for (let i = 0; i < 12 * 8; i++) life.step(1 / 12);
    // Eight seconds on, every one of them is out of sight; the stain is still there.
    for (const other of others) {
      const hidden = other.x < 0 || other.x > layout.width || other.y < 0 || (other.x > box.x && other.x < box.x + box.width && other.y > box.y && other.y < box.y + box.height);
      expect(hidden || !life.actors.includes(other), `one stayed at ${other.x}, ${other.y}`).toBe(true);
    }
    expect(life.actors).toContain(stain);
    // And a stain does not keep the next visitor away: the wait for one goes on.
    life.actors.splice(0, life.actors.length, stain);
    const rest = life.rest;
    life.step(1);
    expect(life.rest).toBeLessThan(rest);
  });

  it('the dog sits down to be made a fuss of', () => {
    const layout = fullHd();
    const life = new Life(layout, dice(71));
    const dog = meet(life, 'dog', 'dog', layout);
    expect(life.poke(dog.x, dog.y - 10)?.reaction).toBe('petted');
    life.step(1 / 12);
    expect(dog.pose).toBe('sit');
    const where = dog.x;
    for (let i = 0; i < 12 * 3; i++) life.step(1 / 12);
    expect(dog.x).toBe(where);
  });

  it('a ghoul turns to stare, twice; the third time it has had enough', () => {
    const layout = fullHd();
    const life = new Life(layout, dice(81));
    const ghoul = meet(life, 'ghoul', 'ghoul', layout);
    for (const expected of ['stared', 'stared'] as const) {
      expect(life.poke(ghoul.x, ghoul.y - 20)?.reaction).toBe(expected);
      life.step(1 / 12);
      expect(ghoul.pose).toBe('stare');
    }
    expect(life.poke(ghoul.x, ghoul.y - 20)?.reaction).toBe('upset');
    // It leaves a good deal faster than it came.
    expect(watch(life)).toBeLessThan(12);
  });

  it('the glowing one burns brighter for a moment', () => {
    const layout = fullHd();
    const life = new Life(layout, dice(91));
    const glowing = meet(life, 'glowing', 'glowing', layout);
    expect(life.poke(glowing.x, glowing.y - 20)?.reaction).toBe('flared');
    expect(glowing.flare).toBe(1);
    for (let i = 0; i < 12 * 3; i++) life.step(1 / 12);
    expect(glowing.flare).toBe(0);
  });

  it('one mole rat squeals and the whole pack is off', () => {
    const layout = room(854, 480);
    const life = new Life(layout, dice(101));
    const rat = meet(life, 'pack', 'molerat', layout);
    const pack = life.actors.filter((actor) => actor.kind === 'molerat' && actor.shown >= 1);
    expect(life.poke(rat.x, rat.y - 8)?.reaction).toBe('bolted');
    for (const other of pack) expect(other.script).toHaveLength(1);
    // The hall is three times as wide as they need a second for.
    expect(watch(life)).toBeLessThan(14);
  });

  it('the eyes in the dark are gone at once', () => {
    const layout = fullHd();
    const life = new Life(layout, dice(111));
    const eyes = meet(life, 'eyes', 'eyes', layout);
    expect(life.poke(eyes.x + 1, eyes.y)?.reaction).toBe('gone');
    expect(watch(life)).toBeLessThan(0.5);
  });

  it('there is nothing to poke where nobody is', () => {
    const life = new Life(fullHd(), dice(121));
    expect(life.poke(20, 100)).toBeNull();
    expect(life.under(20, 100)).toBeNull();
  });

  it('something bolts out from where it was hiding when its hiding place is disturbed', () => {
    const layout = fullHd();
    const box = layout.console;
    const life = new Life(layout, dice(131));
    life.flush(layout.skeleton + 14, layout.floor - 8);
    const roach = life.actors[0]!;
    expect(roach.kind).toBe('radroach');
    watch(life);
    const hidden = roach.x < 0 || roach.x > layout.width || roach.y < 0 || (roach.x > box.x && roach.x < box.x + box.width);
    expect(hidden).toBe(true);
  });
});

describe('what answers to being touched', () => {
  it('is found where it stands, and nowhere else', () => {
    const layout = room(854, 480);
    const right = layout.console.x + layout.console.width;
    expect(spotAt(layout, layout.gear.x, layout.gear.y)?.kind).toBe('door');
    expect(spotAt(layout, layout.gear.x + GEAR, layout.gear.y)?.kind).toBe('door');
    expect(spotAt(layout, layout.monitor!.x + 10, layout.monitor!.y + 10)?.kind).toBe('monitor');
    expect(spotAt(layout, layout.panel.x + 20, layout.panel.y + 8)?.kind).toBe('panel');
    expect(spotAt(layout, layout.crates + 14, layout.floor - 20)?.kind).toBe('case');
    expect(spotAt(layout, layout.skeleton + 12, layout.floor - 6)?.kind).toBe('skeleton');
    expect(spotAt(layout, layout.drip.x, layout.drip.from + 20)?.kind).toBe('drip');
    // Bare wall, bare floor.
    expect(spotAt(layout, right + 10, 200)).toBeNull();
    expect(spotAt(layout, right + 120, layout.floor + 30)).toBeNull();
  });

  it('includes every lamp that has a fitting, and none of the lights that have not', () => {
    const layout = room(854, 480);
    for (const lamp of layout.lamps) {
      const spot = spotAt(layout, lamp.x, lamp.y + 2);
      if (lamp.shape === 'down') expect(spot).toEqual({ kind: 'lamp', lamp });
      else expect(spot?.kind).not.toBe('lamp');
    }
  });

  it('counts every door of the quarters as a room, but not the way out', () => {
    const layout = room(854, 480);
    for (const door of layout.doorways) {
      const base = door.level === 0 ? layout.floor : layout.decks[door.level - 1]!;
      const spot = spotAt(layout, door.x + DOOR_WIDTH / 2, base - DOOR_HEIGHT / 2);
      if (door.level === 0 && door.state === 'open') expect(spot?.kind).not.toBe('room');
      else expect(spot).toEqual({ kind: 'room', door });
      // A door has a lamp over it exactly where one is still kept burning.
      expect(lampOver(layout, door) !== undefined).toBe(door.lit !== 'dead');
    }
    // In the narrowest margin that shows anything, one door on the gallery still has somebody behind it.
    const narrow = fullHd();
    const kept = narrow.doorways.filter((door) => door.state === 'shut' && lampOver(narrow, door) && inSight(narrow, door.x) && inSight(narrow, door.x + DOOR_WIDTH));
    expect(kept).toHaveLength(1);
  });
});

describe('the nameplate', () => {
  it('never says more, or less, than fits where the name of the console stands', () => {
    const width = 'OVERSEER CONSOLE'.length;
    for (const [name, remark] of Object.entries(REMARKS)) expect(remark, name).toHaveLength(width);
    for (const count of [0, 1, 42, 9999, 123456]) expect(tally(count)).toHaveLength(width);
    for (const number of [1, 9, 10, 99, 100, 250]) {
      for (const state of [true, false]) {
        expect(lampRemark(number, state)).toHaveLength(width);
        expect(roomRemark(number, state)).toHaveLength(width);
      }
    }
    expect(tally(7)).toBe('RADROACHES: 0007');
    expect(lampRemark(4, false)).toBe('LAMP 04: OFFLINE');
  });
});

describe('the radroach on the glass', () => {
  const WIDTH = 440;
  const HEIGHT = 280;
  const onGlass = (roach: Actor) => roach.x > 0 && roach.x < WIDTH && roach.y > 0 && roach.y < HEIGHT;

  /** Lets time pass until it is out on the glass and resting. */
  function settle(pest: Pest): Actor {
    for (let i = 0; i < 12 * 60; i++) {
      pest.step(1 / 12);
      if (pest.roach && pest.roach.pose === 'still' && pest.roach.walked > 0 && onGlass(pest.roach)) return pest.roach;
    }
    throw new Error('it never came out');
  }

  it('comes out from under an edge, wanders, and goes again by itself', () => {
    for (const seed of [1, 2, 3, 4]) {
      const pest = new Pest(WIDTH, HEIGHT, dice(seed));
      expect(pest.roach).toBeNull();
      pest.come();
      expect(onGlass(pest.roach!)).toBe(false);
      settle(pest);
      let seconds = 0;
      while (pest.roach && seconds < 300) {
        pest.step(1 / 12);
        seconds += 1 / 12;
      }
      expect(pest.roach).toBeNull();
    }
  });

  it('makes for the nearest edge the moment somebody is back', () => {
    const pest = new Pest(WIDTH, HEIGHT, dice(5));
    pest.come();
    const roach = settle(pest);
    const edge = Math.min(roach.x, WIDTH - roach.x, roach.y, HEIGHT - roach.y);
    pest.flee();
    let seconds = 0;
    while (pest.roach && seconds < 60) {
      pest.step(1 / 12);
      seconds += 1 / 12;
    }
    expect(pest.roach).toBeNull();
    // Three times its usual pace: no slower than that over the distance it had to cover.
    expect(seconds).toBeLessThan((edge + BUILDS.radroach.width) / (BUILDS.radroach.pace * 3) + 0.3);
  });

  it('can be caught by whoever is quick enough, and leaves a stain that wears off', () => {
    const pest = new Pest(WIDTH, HEIGHT, dice(6));
    pest.come();
    const roach = settle(pest);
    expect(pest.squash(roach.x + 40, roach.y)).toBe(false);
    expect(pest.squash(roach.x + 4, roach.y - 3)).toBe(true);
    expect(pest.roach).toMatchObject({ kind: 'stain', x: roach.x, y: roach.y });
    // It cannot be caught twice, and it does not run any more.
    expect(pest.squash(roach.x, roach.y)).toBe(false);
    pest.flee();
    expect(pest.roach!.kind).toBe('stain');
    for (let i = 0; i < 12 * 7; i++) pest.step(1 / 12);
    expect(pest.roach).toBeNull();
  });
});
