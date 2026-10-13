/**
 * What goes on in the vault: who is walking where, and when the next visitor
 * comes. Only positions and timing are kept here; the pictures are drawn
 * elsewhere, and nothing in this file touches the page.
 */
import { HEADINGS, type Kind } from './critters';
import { CEILING, DOOR_WIDTH, footing, type Box, type Layout } from './layout';

/** One thing for a visitor to do, before it goes on to the next. */
export type Move =
  /** Walk along its level to a place. */
  | { walk: number; pace: number }
  /** Cross the wall in a straight line to a spot. */
  | { crawl: readonly [number, number]; pace: number }
  /** Stay put for so many seconds, doing something. */
  | { hold: number; pose: string }
  /** Step out of the dark over so many seconds. */
  | { appear: number }
  /** And back into it. */
  | { vanish: number };

export interface Actor {
  kind: Kind;
  /** Where its feet are; for a crawler, its middle. */
  x: number;
  y: number;
  /** 1 walking to the right, -1 to the left. */
  facing: 1 | -1;
  /** A crawler points one of eight ways instead: eighths of a turn, 0 to the right. */
  heading: number;
  pose: string;
  /** How far it has come, which decides the picture of its gait. */
  walked: number;
  /** Seconds spent in its present pose. */
  held: number;
  /** 0 out of sight, 1 in full view. */
  shown: number;
  script: Move[];
  /** How often it has been poked. Some put up with more of it than others. */
  pokes?: number;
  /** How much brighter than usual something that shines is burning, from 0 to 1. It dies down by itself. */
  flare?: number;
}

interface Build {
  width: number;
  height: number;
  /** Coarse pixels a second, at its usual gait. */
  pace: number;
  /** Crosses walls instead of walking the floors. */
  crawls?: boolean;
  /** Gives off light of its own: as well as being lit by the lamps, or instead of it. */
  shines?: 'too' | 'only';
  /** Lies flat on the wall: throws no shadow, and takes no notice of anything. */
  flat?: boolean;
}

export const BUILDS: Record<Kind, Build> = {
  ghoul: { width: 22, height: 48, pace: 10 },
  glowing: { width: 22, height: 48, pace: 8, shines: 'too' },
  molerat: { width: 44, height: 20, pace: 30 },
  radroach: { width: 13, height: 13, pace: 36, crawls: true },
  stain: { width: 15, height: 15, pace: 0, flat: true },
  dog: { width: 38, height: 26, pace: 24 },
  eyes: { width: 9, height: 3, pace: 0, shines: 'only' },
};

/** What can come through. */
export type Visit = 'ghoul' | 'stare' | 'glowing' | 'molerat' | 'pack' | 'radroach' | 'swarm' | 'dog' | 'eyes';

/** How often each is picked, against the others. */
const ODDS: Record<Visit, number> = { radroach: 28, molerat: 20, ghoul: 17, stare: 10, swarm: 8, pack: 6, glowing: 4, dog: 4, eyes: 3 };

/** How high above a sill the eyes in a doorway are: more than a man's height. */
const EYE_HEIGHT = 47;

/** What something did about being poked. */
export type Reaction = 'squashed' | 'petted' | 'stared' | 'upset' | 'flared' | 'bolted' | 'gone';

export interface Poke {
  /** Who was poked, as it was at that moment. */
  actor: Actor;
  reaction: Reaction;
}

/** While something is behind the console nobody is watching, so it does not dawdle. */
const UNSEEN_HURRY = 6;

export class Life {
  readonly actors: Actor[] = [];
  /** Seconds until the next visitor, counted while the hall is empty. */
  rest: number;
  /** Whether the great door stands open, so that things can come in past it. */
  open = false;
  private last: Visit | null = null;
  private readonly layout: Layout;
  private readonly random: () => number;

  constructor(layout: Layout, random: () => number = Math.random) {
    this.layout = layout;
    this.random = random;
    // The first one comes soon, so that a short stay at the console still meets somebody.
    this.rest = 5 + random() * 7;
  }

  /** Moves everything on by a stretch of time, in seconds. */
  step(seconds: number): void {
    for (const actor of this.actors) {
      advance(actor, seconds * (this.unseen(actor) ? UNSEEN_HURRY : 1));
      if (actor.flare) actor.flare = Math.max(0, actor.flare - seconds * 0.7);
    }
    for (let i = this.actors.length - 1; i >= 0; i--) {
      if (!this.actors[i]!.script.length) this.actors.splice(i, 1);
    }
    // What is only a stain on the wall keeps nobody away.
    if (this.actors.some((actor) => !BUILDS[actor.kind].flat)) return;
    this.rest -= seconds;
    if (this.rest > 0) return;
    this.rest = 16 + this.random() * 38;
    this.send(this.pick());
  }

  /** Lets a visitor of the named sort in, if the room has anywhere to show it. */
  send(visit: Visit): boolean {
    // Requests come in from the page, where anybody can ask for anything.
    if (!(visit in ODDS)) return false;
    const before = this.actors.length;
    switch (visit) {
      case 'ghoul':
        this.wanderer('ghoul', false);
        break;
      case 'stare':
        this.wanderer('ghoul', true);
        break;
      case 'glowing':
        this.wanderer('glowing', this.random() < 0.5);
        break;
      case 'molerat':
        this.runner(0);
        break;
      case 'pack':
        this.runner(1 + Math.floor(this.random() * 2));
        break;
      case 'radroach':
        this.crawler(0);
        break;
      case 'swarm':
        for (let i = 0, n = 3 + Math.floor(this.random() * 3); i < n; i++) this.crawler(i * (0.3 + this.random()));
        break;
      case 'dog':
        this.dog();
        break;
      case 'eyes':
        this.watcher();
        break;
    }
    this.last = visit;
    return this.actors.length > before;
  }

  /** Everybody out, and nobody new for a good while: for whoever wants the room to themselves. */
  clear(): void {
    this.actors.length = 0;
    this.rest = 120;
  }

  /** The whole cast at once, as when the credits roll. */
  parade(): boolean {
    let anybody = false;
    for (const visit of ['stare', 'pack', 'dog', 'glowing', 'swarm', 'ghoul'] as const) anybody = this.send(visit) || anybody;
    return anybody;
  }

  /** A radroach bolts out of somewhere it had been sitting unseen, looks about, and makes for cover. */
  flush(x: number, y: number): void {
    const pace = BUILDS.radroach.pace * 1.7;
    const pause: [number, number] = [x + this.between(-16, 16), y - this.between(14, 30)];
    const roach: Actor = { kind: 'radroach', x, y, facing: 1, heading: 0, pose: 'still', walked: 0, held: 0, shown: 1, script: [] };
    roach.script = [{ crawl: pause, pace }, { hold: this.between(0.2, 0.7), pose: 'still' }, { crawl: this.refuge(pause[0], pause[1]), pace }];
    this.actors.push(roach);
  }

  /** Eyes open in the dark beyond the great door, if it stands open and can be seen. */
  lurk(): boolean {
    if (this.actors.some((actor) => actor.kind === 'eyes')) return false;
    const before = this.actors.length;
    this.watcher(true);
    return this.actors.length > before;
  }

  /** Whatever is at a spot in the room and would notice being poked: the nearest to the eye first. */
  under(x: number, y: number): Actor | null {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i]!;
      const build = BUILDS[actor.kind];
      if (build.flat || actor.shown < 1) continue;
      // A little more than its own size: small things on the move are hard to hit.
      const above = build.crawls ? build.height / 2 + 3 : build.shines === 'only' ? 5 : build.height + 2;
      const below = build.crawls ? build.height / 2 + 3 : build.shines === 'only' ? 5 : 2;
      if (Math.abs(x - actor.x) <= build.width / 2 + 3 && y >= actor.y - above && y <= actor.y + below) return actor;
    }
    return null;
  }

  /** Pokes whatever is at a spot. Says who it was and what it did about it, or nothing if nobody was there. */
  poke(x: number, y: number): Poke | null {
    const actor = this.under(x, y);
    if (!actor) return null;
    const build = BUILDS[actor.kind];
    const { layout } = this;
    // Whatever it was in the middle of waiting for can wait.
    const interrupt = (...moves: Move[]) => {
      if (actor.script[0] && 'hold' in actor.script[0]) actor.script.shift();
      actor.script.unshift(...moves);
      actor.held = 0;
    };
    switch (actor.kind) {
      case 'radroach':
        // It stays where it was hit, and the others have seen enough.
        this.actors[this.actors.indexOf(actor)] = { ...actor, kind: 'stain', pose: 'splat', held: 0, script: [{ hold: 22, pose: 'splat' }, { vanish: 6 }] };
        for (const other of this.actors) {
          if (other.kind === 'radroach') other.script = [{ crawl: this.refuge(other.x, other.y), pace: build.pace * 2.6 }];
        }
        return { actor, reaction: 'squashed' };
      case 'dog':
        // He sits down to be made a fuss of.
        interrupt({ hold: 3.6, pose: 'sit' });
        return { actor, reaction: 'petted' };
      case 'molerat':
        // One squeal and the whole pack is off, the way each of them was going.
        for (const other of this.actors) {
          if (other.kind === 'molerat' && other.shown >= 1) other.script = [{ walk: other.facing > 0 ? layout.width + build.width : -build.width, pace: build.pace * 2.6 }];
        }
        return { actor, reaction: 'bolted' };
      case 'ghoul':
      case 'glowing':
        actor.pokes = (actor.pokes ?? 0) + 1;
        if (actor.kind === 'glowing') actor.flare = 1;
        if (actor.pokes >= 3) {
          // That was once too often. It is leaving, by the nearer side.
          actor.script = [{ walk: actor.x < layout.width / 2 ? -build.width * 2 : layout.width + build.width * 2, pace: build.pace * 2.8 }];
          return { actor, reaction: 'upset' };
        }
        // It turns to see who did that.
        interrupt({ hold: 2.6, pose: 'stare' }, { hold: 0.4, pose: 'stand' });
        return { actor, reaction: actor.kind === 'glowing' ? 'flared' : 'stared' };
      case 'eyes':
        actor.script = [{ vanish: 0.12 }];
        return { actor, reaction: 'gone' };
      case 'stain':
        return null;
    }
  }

  /** The nearest place to a spot where a radroach is out of sight: beyond the window, or behind the console. */
  private refuge(x: number, y: number): [number, number] {
    const box = this.layout.console;
    const build = BUILDS.radroach;
    const places: [number, number][] = [
      [-build.width, y],
      [this.layout.width + build.width, y],
      [x, -build.height],
    ];
    if (y > box.y && y < box.y + box.height) places.push(x < box.x ? [box.x + build.width, y] : [box.x + box.width - build.width, y]);
    else if (x > box.x && x < box.x + box.width) places.push([x, y < box.y ? box.y + build.height : box.y + box.height - build.height]);
    return places.reduce((best, place) => (Math.hypot(place[0] - x, place[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? place : best));
  }

  private pick(): Visit {
    const visits = (Object.keys(ODDS) as Visit[]).filter((visit) => visit !== this.last);
    let roll = this.random() * visits.reduce((sum, visit) => sum + ODDS[visit], 0);
    for (const visit of visits) {
      roll -= ODDS[visit];
      if (roll < 0) return visit;
    }
    return 'radroach';
  }

  /** Whether an actor is wholly behind the console. */
  private unseen(actor: Actor): boolean {
    const build = BUILDS[actor.kind];
    const box = this.layout.console;
    const top = build.crawls ? actor.y - build.height / 2 : actor.y - build.height;
    const bottom = build.crawls ? actor.y + build.height / 2 : actor.y;
    return actor.x - build.width / 2 > box.x + 2 && actor.x + build.width / 2 < box.x + box.width - 2 && top > box.y + 2 && bottom < box.y + box.height - 2;
  }

  /** The stretches of a level on which something of a given height can be seen past the console. */
  private views(level: number, height: number): [number, number][] {
    const { layout } = this;
    const box = layout.console;
    const feet = footing(layout, level);
    const hidden = Math.max(0, Math.min(feet, box.y + box.height) - Math.max(feet - height, box.y));
    if (hidden < height * 0.6) return [[0, layout.width]];
    const views: [number, number][] = [];
    if (box.x >= 12) views.push([0, box.x]);
    if (layout.width - (box.x + box.width) >= 12) views.push([box.x + box.width, layout.width]);
    return views;
  }

  /** A level to walk on that can be seen somewhere, the floor more often than a gallery. */
  private level(height: number): number | null {
    const levels = [0, ...this.layout.decks.map((_, index) => index + 1)].filter((level) => this.views(level, height).length);
    if (!levels.length) return null;
    return levels.includes(0) && this.random() < 0.5 ? 0 : levels[Math.floor(this.random() * levels.length)]!;
  }

  private between(from: number, to: number): number {
    return from + (to - from) * this.random();
  }

  /** Whether the great door stands open where something on a level could be seen coming in past it. */
  private gate(level: number, views: [number, number][]): boolean {
    const { portal } = this.layout;
    return level === 0 && this.open && views.some(([from, to]) => portal - 14 >= from && portal + 14 <= to);
  }

  /** The ways in and out of a level that can be seen: its open doorways, and on the floor the great door when that stands open. */
  private ways(level: number, views: [number, number][]): number[] {
    const ways = this.layout.doorways
      .filter((door) => door.level === level && door.state !== 'shut' && views.some(([from, to]) => door.x >= from && door.x + DOOR_WIDTH <= to))
      .map((door) => door.x + DOOR_WIDTH / 2);
    if (this.gate(level, views)) ways.push(this.layout.portal);
    return ways;
  }

  /**
   * Something on two legs. It goes straight through the hall, or comes out of
   * a doorway and leaves, or comes in and goes home through one, or only steps
   * out for a look around. Wherever it can be seen on the way, it stops once.
   */
  private wanderer(kind: 'ghoul' | 'glowing', stares: boolean): void {
    const build = BUILDS[kind];
    const level = this.level(build.height);
    if (level === null) return;
    const { layout } = this;
    const views = this.views(level, build.height);
    const pace = build.pace * this.between(0.9, 1.15);
    const beyond = (rightward: boolean) => (rightward ? layout.width + build.width : -build.width);

    const ways = this.ways(level, views);
    const way = ways[Math.floor(this.random() * ways.length)];
    const threshold = way ?? 0;
    const roll = this.random();
    const errand = way === undefined || roll < 0.2 ? 'through' : roll < 0.5 ? 'out' : roll < 0.75 ? 'home' : 'peek';
    // Leaving by the far side of the hall, so that the walk is worth watching.
    const far = threshold < layout.width / 2;
    const rightward = this.random() < 0.5;
    const start = errand === 'through' ? beyond(!rightward) : errand === 'home' ? beyond(far) : threshold;
    const end = errand === 'through' ? beyond(rightward) : errand === 'out' ? beyond(far) : threshold;

    const script: Move[] = [];
    let looked = false;
    // Not on top of whoever sits by the wall down there: a little further along, where there is room.
    const clear = (spot: number, limit: number) => (level === 0 && spot > layout.skeleton - 8 && spot < layout.skeleton + 32 ? Math.min(layout.skeleton + 34, limit) : spot);
    const linger = () => {
      script.push({ hold: this.between(0.8, 2.2), pose: 'stand' });
      // Sometimes it has noticed the console.
      if (stares && !looked) script.push({ hold: this.between(2.4, 3.6), pose: 'stare' }, { hold: 0.6, pose: 'stand' });
      looked = true;
    };
    if (errand === 'out' || errand === 'peek') script.push({ appear: 1.2 });
    if (errand === 'peek') {
      const [from, to] = views.find(([from, to]) => threshold >= from && threshold <= to) ?? [threshold, threshold];
      const left = Math.max(from + build.width / 2, threshold - 46);
      const right = Math.min(to - build.width / 2, threshold + 46);
      const spot = threshold - left > right - threshold ? this.between(left, Math.max(left, threshold - 14)) : this.between(Math.min(right, threshold + 14), right);
      script.push({ walk: clear(spot, right), pace });
      linger();
      script.push({ walk: threshold, pace });
    } else {
      for (const [from, to] of end >= start ? views : [...views].reverse()) {
        const lo = Math.max(from, Math.min(start, end)) + build.width;
        const hi = Math.min(to, Math.max(start, end)) - build.width;
        if (hi - lo < 8) continue;
        script.push({ walk: clear(this.between(lo, hi), hi), pace });
        linger();
      }
      script.push({ walk: end, pace });
    }
    if (errand === 'home' || errand === 'peek') script.push({ vanish: 1.2 });

    const first = script.find((move): move is { walk: number; pace: number } => 'walk' in move);
    this.actors.push({
      kind,
      x: start,
      y: footing(layout, level),
      facing: (first?.walk ?? end) >= start ? 1 : -1,
      heading: 0,
      pose: 'stand',
      walked: 0,
      held: 0,
      shown: errand === 'out' || errand === 'peek' ? 0 : 1,
      script,
    });
  }

  /** Mole rats: straight through at a trot, nose down, with others close behind if it is a pack. */
  private runner(followers: number): void {
    const build = BUILDS.molerat;
    const level = this.level(build.height);
    if (level === null) return;
    const { layout } = this;
    const views = this.views(level, build.height);
    // With the great door open they may as well have come in from the caves outside.
    const outside = this.gate(level, views) && this.random() < 0.4;
    const rightward = outside ? layout.portal < layout.width / 2 : this.random() < 0.5;
    const pace = build.pace * this.between(0.85, 1.15);
    const end = rightward ? layout.width + build.width : -build.width;
    for (let n = 0; n <= followers; n++) {
      const script: Move[] = [];
      if (outside) {
        // One after another out of the dark, each with a sniff at the air in here.
        script.push({ hold: n * 0.9, pose: 'walk' }, { appear: 0.7 }, { walk: layout.portal + (rightward ? 1 : -1) * n * 9, pace }, { hold: this.between(0.7, 1.6), pose: 'sniff' });
      } else {
        for (const [from, to] of rightward ? views : [...views].reverse()) {
          if (to - from < build.width * 1.5 || this.random() < 0.3) continue;
          // Followers stop where the leader stopped, more or less.
          script.push({ walk: this.between(from + build.width / 2, to - build.width / 2), pace: pace * (n ? 1.05 : 1) });
          script.push({ hold: this.between(0.9, 2.4), pose: 'sniff' });
        }
      }
      script.push({ walk: end, pace });
      const start = outside ? layout.portal : (rightward ? -build.width : layout.width + build.width) + (rightward ? -1 : 1) * n * this.between(34, 52);
      this.actors.push({ kind: 'molerat', x: start, y: footing(layout, level), facing: rightward ? 1 : -1, heading: 0, pose: 'walk', walked: 0, held: 0, shown: outside ? 0 : 1, script });
    }
  }

  /** The dog: trots through, and wherever he can see the console he sits down to have a look at it. */
  private dog(): void {
    const build = BUILDS.dog;
    const level = this.level(build.height);
    if (level === null) return;
    const { layout } = this;
    const views = this.views(level, build.height);
    // With the great door open he may have wandered in from the wasteland.
    const outside = this.gate(level, views) && this.random() < 0.4;
    const rightward = outside ? layout.portal < layout.width / 2 : this.random() < 0.5;
    const pace = build.pace * this.between(0.9, 1.1);
    const script: Move[] = [];
    if (outside) {
      script.push({ appear: 0.8 }, { hold: this.between(2.6, 4.6), pose: 'sit' });
    } else {
      for (const [from, to] of rightward ? views : [...views].reverse()) {
        if (to - from < build.width * 1.4) continue;
        script.push({ walk: this.between(from + build.width / 2, to - build.width / 2), pace });
        script.push({ hold: this.between(2.6, 4.6), pose: 'sit' });
        if (views.length === 1) break;
      }
    }
    script.push({ walk: rightward ? layout.width + build.width : -build.width, pace });
    const start = outside ? layout.portal : rightward ? -build.width : layout.width + build.width;
    this.actors.push({ kind: 'dog', x: start, y: footing(layout, level), facing: rightward ? 1 : -1, heading: 0, pose: 'walk', walked: 0, held: 0, shown: outside ? 0 : 1, script });
  }

  /**
   * Eyes in a doorway that has no light in it: they open, they watch for a
   * while, they are gone. With the great door open they may be out there in
   * the tunnel instead, and that is the only place they are looked for if
   * somebody has just called into it.
   */
  private watcher(beyond = false): void {
    const { layout } = this;
    const box = layout.console;
    const seen = (x: number, y: number) => x - 6 >= 0 && x + 6 <= layout.width && (x + 6 <= box.x || x - 6 >= box.x + box.width || y < box.y || y > box.y + box.height);
    const places: [number, number][] = [];
    if (!beyond) {
      for (const door of layout.doorways) {
        const place: [number, number] = [door.x + DOOR_WIDTH / 2 + 2, (door.level === 0 ? layout.floor : layout.decks[door.level - 1]!) - EYE_HEIGHT];
        if (door.state === 'open' && seen(...place)) places.push(place);
      }
    }
    if (this.open && seen(layout.portal - 2, layout.floor - EYE_HEIGHT - 6)) places.push([layout.portal - 2, layout.floor - EYE_HEIGHT - 6]);
    const place = places[Math.floor(this.random() * places.length)];
    if (!place) return;
    const script: Move[] = [{ appear: 0.5 }, { hold: this.between(1.2, 2.4), pose: 'open' }];
    for (let i = 0, blinks = 1 + Math.floor(this.random() * 3); i < blinks; i++) {
      script.push({ hold: 0.16, pose: 'blink' }, { hold: this.between(0.9, 2.6), pose: 'open' });
    }
    script.push({ vanish: 0.5 });
    this.actors.push({ kind: 'eyes', x: place[0], y: place[1], facing: 1, heading: 0, pose: 'open', walked: 0, held: 0, shown: 0, script });
  }

  /** A radroach: out from behind something, across the wall in short runs, and gone again. */
  private crawler(wait: number): void {
    const build = BUILDS.radroach;
    const { layout } = this;
    const box = layout.console;
    // The parts of the wall that show: either side of the console, and above it.
    const walls: Box[] = [];
    if (box.x >= 16) walls.push({ x: 0, y: CEILING, width: box.x, height: layout.floor - CEILING });
    if (layout.width - (box.x + box.width) >= 16) walls.push({ x: box.x + box.width, y: CEILING, width: layout.width - box.x - box.width, height: layout.floor - CEILING });
    if (box.y >= CEILING + 16) walls.push({ x: box.x, y: CEILING, width: box.width, height: box.y - CEILING });
    if (!walls.length) return;
    const wall = walls[Math.floor(this.random() * walls.length)]!;

    // Somewhere out of sight to come from and to go to: beyond the window on any side, or behind the console.
    const hide = (): [number, number] => {
      const sides: [number, number][] = [[this.between(wall.x, wall.x + wall.width), -build.height]];
      if (wall.x <= 0) sides.push([-build.width, this.between(wall.y, wall.y + wall.height)]);
      if (wall.x + wall.width >= layout.width) sides.push([layout.width + build.width, this.between(wall.y, wall.y + wall.height)]);
      if (wall.x + wall.width <= box.x + 1) sides.push([box.x + build.width, this.between(Math.max(wall.y, box.y), Math.min(wall.y + wall.height, box.y + box.height))]);
      if (wall.x >= box.x + box.width - 1) sides.push([box.x + box.width - build.width, this.between(Math.max(wall.y, box.y), Math.min(wall.y + wall.height, box.y + box.height))]);
      if (wall.y + wall.height <= box.y + 1) sides.push([this.between(wall.x, wall.x + wall.width), box.y + build.height]);
      return sides[Math.floor(this.random() * sides.length)]!;
    };
    const from = hide();
    const to = hide();
    const script: Move[] = [];
    if (wait) script.push({ hold: wait, pose: 'still' });
    const pace = build.pace * this.between(0.8, 1.3);
    for (let i = 0, legs = 2 + Math.floor(this.random() * 4); i < legs; i++) {
      script.push({ crawl: [this.between(wall.x + 6, wall.x + wall.width - 6), this.between(wall.y + 6, wall.y + wall.height - 6)], pace });
      script.push({ hold: this.between(0.3, 1.8), pose: 'still' });
    }
    script.push({ crawl: to, pace: pace * 1.2 });
    this.actors.push({ kind: 'radroach', x: from[0], y: from[1], facing: 1, heading: 0, pose: 'still', walked: 0, held: 0, shown: 1, script });
  }
}

/** Carries one actor through its script for a stretch of time. */
export function advance(actor: Actor, seconds: number): void {
  let left = seconds;
  while (left > 0 && actor.script.length) {
    const move = actor.script[0]!;
    if ('walk' in move) {
      const distance = move.walk - actor.x;
      const reach = move.pace * left;
      actor.pose = 'walk';
      if (distance) actor.facing = distance > 0 ? 1 : -1;
      if (Math.abs(distance) > reach) {
        actor.x += Math.sign(distance) * reach;
        actor.walked += reach;
        return;
      }
      actor.x = move.walk;
      actor.walked += Math.abs(distance);
      left -= Math.abs(distance) / move.pace;
    } else if ('crawl' in move) {
      const dx = move.crawl[0] - actor.x;
      const dy = move.crawl[1] - actor.y;
      const distance = Math.hypot(dx, dy);
      const reach = move.pace * left;
      if (distance > 0.01) actor.heading = (Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * HEADINGS) + HEADINGS) % HEADINGS;
      actor.pose = 'walk';
      if (distance > reach) {
        actor.x += (dx / distance) * reach;
        actor.y += (dy / distance) * reach;
        actor.walked += reach;
        return;
      }
      actor.x = move.crawl[0];
      actor.y = move.crawl[1];
      actor.walked += distance;
      left -= distance / move.pace;
    } else if ('hold' in move) {
      if (actor.pose !== move.pose) {
        actor.pose = move.pose;
        actor.held = 0;
      }
      if (actor.held + left < move.hold) {
        actor.held += left;
        return;
      }
      left -= move.hold - actor.held;
    } else if ('appear' in move) {
      actor.shown = Math.min(1, actor.shown + left / move.appear);
      if (actor.shown < 1) return;
      left = 0;
    } else {
      actor.shown = Math.max(0, actor.shown - left / move.vanish);
      if (actor.shown > 0) return;
      left = 0;
    }
    actor.script.shift();
    actor.held = 0;
  }
}
