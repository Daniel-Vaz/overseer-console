/**
 * The radroach that comes out onto the glass of the console's own tube when
 * nobody has touched anything for a while. Only where it is and what it is
 * doing is kept here; nothing in this file touches the page.
 */
import { BUILDS, advance, type Actor, type Move } from './life';

/** How near a press has to land, in the roach's own pixels. It is quick, so this is generous. */
const REACH = 11;

export class Pest {
  /**
   * The roach while it is out, measured in coarse pixels from the top left
   * corner of the glass. If it was caught, what is left of it.
   */
  roach: Actor | null = null;
  private readonly width: number;
  private readonly height: number;
  private readonly random: () => number;

  constructor(width: number, height: number, random: () => number = Math.random) {
    this.width = width;
    this.height = height;
    this.random = random;
  }

  /** Out from under the edge of the glass, about on it for a while, and off again by itself if nobody comes. */
  come(): void {
    const pace = BUILDS.radroach.pace * this.between(0.8, 1.1);
    const script: Move[] = [];
    for (let i = 0, legs = 3 + Math.floor(this.random() * 4); i < legs; i++) {
      script.push({ crawl: [this.between(14, this.width - 14), this.between(14, this.height - 14)], pace }, { hold: this.between(0.6, 2.8), pose: 'still' });
    }
    script.push({ crawl: this.edge(), pace });
    const [x, y] = this.edge();
    this.roach = { kind: 'radroach', x, y, facing: 1, heading: 0, pose: 'still', walked: 0, held: 0, shown: 1, script };
  }

  /** Somebody is back at the console: it makes for the nearest edge of the glass, fast. */
  flee(): void {
    const roach = this.roach;
    if (!roach || roach.kind !== 'radroach') return;
    const beyond = BUILDS.radroach.width;
    const ways: [number, number][] = [
      [-beyond, roach.y],
      [this.width + beyond, roach.y],
      [roach.x, -beyond],
      [roach.x, this.height + beyond],
    ];
    const nearest = ways.reduce((best, way) => (Math.hypot(way[0] - roach.x, way[1] - roach.y) < Math.hypot(best[0] - roach.x, best[1] - roach.y) ? way : best));
    roach.script = [{ crawl: nearest, pace: BUILDS.radroach.pace * 3 }];
  }

  /** A press on the glass. True if it landed on the roach, which is then a stain that wears off. */
  squash(x: number, y: number): boolean {
    const roach = this.roach;
    if (!roach || roach.kind !== 'radroach' || Math.hypot(x - roach.x, y - roach.y) > REACH) return false;
    this.roach = { ...roach, kind: 'stain', pose: 'splat', held: 0, script: [{ hold: 3.5, pose: 'splat' }, { vanish: 2.5 }] };
    return true;
  }

  step(seconds: number): void {
    if (!this.roach) return;
    advance(this.roach, seconds);
    if (!this.roach.script.length) this.roach = null;
  }

  /** A spot just out of sight beyond one of the four edges of the glass. */
  private edge(): [number, number] {
    const beyond = BUILDS.radroach.width;
    const side = Math.floor(this.random() * 4);
    if (side === 0) return [-beyond, this.between(10, this.height - 10)];
    if (side === 1) return [this.width + beyond, this.between(10, this.height - 10)];
    if (side === 2) return [this.between(10, this.width - 10), -beyond];
    return [this.between(10, this.width - 10), this.height + beyond];
  }

  private between(from: number, to: number): number {
    return from + (to - from) * this.random();
  }
}
