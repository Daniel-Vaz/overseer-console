/**
 * The small things in the room that move by themselves, and the things that
 * answer to being touched: water dripping from a joint, dust in the
 * lamplight, the great door on its rail, a monitor with two channels, a
 * fault lamp that can be thumped into silence, lamps with switches, and a
 * case that grows a garden.
 */
import { GEAR, MONITOR, lampOver, type Lamp, type Layout, type Spot } from './layout';
import { Raster, hash, textWidth } from './raster';
import { REMARKS, lampRemark, roomRemark, type Sound } from './remarks';
import { lightAt, paintMended } from './scenery';

/** Coarse pixels a second, every second: what a falling drop gains. */
const GRAVITY = 290;
/** Seconds the great door takes to roll from shut to open, or back. */
export const ROLLING = 4.2;
/** Seconds the purifier stays quiet after a thump, before it faults again. */
const MENDED = 26;

/** What a touch, or something that follows from one, brings back to the console. */
export interface Said {
  sound?: Sound;
  remark?: string;
}

/** What a touch asks of whoever lives in the room, where it asks anything. */
export type Stirred = 'flush' | 'lurk' | null;

interface Mote {
  lamp: Lamp;
  /** Where it floats, measured from its lamp. */
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  /** Where it is in its slow turning, which makes it glint. */
  turn: number;
}

/** Something thrown up for a moment: a spark, a drop of what was a radroach, a puff of dust, a heart. */
interface Speck {
  kind: 'spark' | 'goo' | 'dust' | 'heart';
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Seconds it has left, of how many. */
  left: number;
  span: number;
}

/** One stalk of what the case grows. */
interface Plant {
  x: number;
  /** The height of what it grows out of. */
  root: number;
  height: number;
  lean: number;
  /** How far the garden must have come before this one starts. */
  after: number;
  bloom: string | null;
}

const HEART = [0b01010, 0b11111, 0b01110, 0b00100];
const BLOOMS = ['#f2d268', '#f4eed5', '#ff9a7a'];

function hex(ink: number): string {
  return `#${ink.toString(16).padStart(6, '0')}`;
}

/** The picture the monitor comes back to: the words every vault dweller grew up with. */
function card(): Raster {
  const { width, height } = MONITOR.screen;
  const sheet = new Raster(width, height);
  const paper = 0xb4cbbc;
  const ink = 0x0c1a13;
  sheet.box(0, 0, width, height, paper);
  // Bars along the top and the bottom, as on a test card.
  for (let x = 1; x < width - 1; x++) {
    if ((x >> 1) % 2 === 0) {
      sheet.box(x, 1, 1, 2, ink);
      sheet.box(x, height - 3, 1, 2, ink);
    }
  }
  sheet.text(Math.round((width - textWidth('PLEASE')) / 2), 5, 'PLEASE', ink);
  sheet.box(4, 11, width - 8, 1, ink);
  sheet.disc(width / 2 - 0.5, 11, 2.2, paper);
  sheet.disc(width / 2 - 0.5, 11, 2.2, ink, 1.4);
  sheet.text(Math.round((width - textWidth('STAND BY')) / 2), 14, 'STAND BY', ink);
  // The lines of the tube.
  sheet.shade(0, 0, width, height, (_, y) => (y % 2 ? 0.8 : 1));
  return sheet;
}

/** A tube with nothing coming in: one picture of the snow. */
function snow(seed: number): Raster {
  const { width, height } = MONITOR.screen;
  const sheet = new Raster(width, height);
  sheet.each(0, 0, width, height, (x, y) => {
    const grey = Math.round(40 + hash(x, y, seed) ** 2 * 190);
    return (grey << 16) | (Math.min(255, grey + 14) << 8) | grey;
  });
  return sheet;
}

export class Effects {
  /** How brightly the monitor lights its surroundings just now, from 0 to 1. */
  screen = 0;
  /** How far the garden has come, from 0 for a shut case to 1 for full bloom. */
  grown: number;
  /** Whether the case has been opened. */
  sown: boolean;
  /** Seconds for which the great door still shakes from a knock on its far side. */
  shudder = 0;
  /** Where the pointer is in the room, for whatever watches it. */
  gaze: { x: number; y: number } | null = null;

  private readonly layout: Layout;
  private readonly tell: (said: Said) => void;
  private readonly random: () => number;
  private readonly motes: Mote[] = [];
  private readonly specks: Speck[] = [];
  private readonly plants: Plant[] = [];
  /** Lamps somebody has switched off. */
  private readonly dark = new Set<Lamp>();
  /** Lamps put out by whoever lives under them, and when each comes on again. */
  private readonly hushed = new Map<Lamp, number>();
  /** Seconds for which the power is still unsteady after having been off and on again. */
  private dip = 0;
  private clock = 0;

  /* The monitor: dark, then snow, then one of its two channels, then dark again. */
  private tube: 'dark' | 'snow' | 'on' | 'fade' = 'dark';
  private channel: 'card' | 'eye' = 'card';
  private until: number;
  /** Switched on by hand: it stays on a good while longer than when it comes on by itself. */
  private kept = false;
  private glitch = 0;
  private lid = 3;
  private cardPicture: HTMLCanvasElement | null = null;
  private snowPictures: HTMLCanvasElement[] = [];

  /* The drip: a wait, then a drop that falls, then a splash. */
  private drop: { y: number; speed: number } | null = null;
  private splash = 0;
  private nextDrop: number;
  /** Drops still to come in a hurry, after somebody has been at the joint. */
  private gush = 0;

  /* The great door: where it is on its rail, where it is going, and what else is moving it. */
  private door: number;
  private aim: number;
  private jam = 0;
  /** When the knocks from the far side are due. */
  private answers: number[] = [];

  /* The purifier's panel, and the skeleton. */
  private mended = 0;
  private mendedPicture: HTMLCanvasElement | null = null;
  private rattled = -60;

  constructor(layout: Layout, tell: (said: Said) => void, state: { open: boolean; sown: boolean }, random: () => number = Math.random) {
    this.layout = layout;
    this.tell = tell;
    this.random = random;
    this.door = this.aim = state.open ? 1 : 0;
    this.sown = state.sown;
    this.grown = state.sown ? 1 : 0;
    // It comes on early the first time, so that a short stay at the console catches it.
    this.until = 7 + random() * 9;
    this.nextDrop = 1 + random() * 2;
    for (const lamp of layout.lamps) {
      if (lamp.shape !== 'down' || lamp.mood === 'dead') continue;
      for (let i = 0; i < 7; i++) this.motes.push(this.mote(lamp, true));
    }

    // What the case will grow: up the faces of the crates, on top of the smaller one, and out of its own lid.
    const floor = layout.floor + 5;
    for (let i = 0; i < 18; i++) {
      const x = layout.crates - 9 + Math.round(hash(i, 0, 701) * 74);
      const root = i < 2 ? floor - 31 : x >= layout.crates + 33 && x < layout.crates + 55 && i % 2 ? floor - 15 : floor;
      this.plants.push({
        x: i < 2 ? layout.crates + 6 + i * 16 : x,
        root,
        height: (i < 2 ? 3 : 5) + Math.round(hash(i, 1, 703) * (i < 2 ? 4 : 12)),
        lean: hash(i, 2, 709) - 0.5,
        after: hash(i, 3, 719) * 0.35,
        bloom: hash(i, 4, 727) > 0.5 ? BLOOMS[i % BLOOMS.length]! : null,
      });
    }
  }

  /** How far the great door has rolled aside, from 0 for shut to 1 for as far as it goes. */
  get rolled(): number {
    // A seal that did not take: the door starts for its socket and falls back.
    return this.door - (this.jam > 0 ? 0.16 * Math.sin(Math.PI * (1 - this.jam / 1.2)) : 0);
  }

  /** Whether a lamp has been put out: by somebody at the console, or by whoever lives under it. */
  out(lamp: Lamp): boolean {
    return this.dark.has(lamp) || (this.hushed.get(lamp) ?? 0) > this.clock;
  }

  /** How much of its power the room has just now: all of it, except just after it has been off and on again. */
  get power(): number {
    if (this.dip <= 0) return 1;
    return this.dip > 0.6 ? 0.05 : 0.35 + 0.65 * this.random();
  }

  /** The console has had its power off and on again, and the room is on the same circuit. */
  flicker(): void {
    this.dip = 1;
    if (this.tube === 'on') this.glitch = 8;
  }

  /** Rolls the great door open or shut: over a few seconds, or at once where nobody is to see it move. */
  seal(open: boolean, atOnce: boolean): void {
    const aim = open ? 1 : 0;
    if (atOnce) this.door = aim;
    else if (aim !== this.aim) this.tell({ sound: 'rumble' });
    this.aim = aim;
  }

  /** The seal was asked for and not given: the door tries, and stays where it is. */
  stick(): void {
    if (this.door < 1 || this.aim < 1 || this.jam > 0) return;
    this.jam = 1.2;
    this.tell({ sound: 'grind', remark: REMARKS.jammed });
  }

  /** Somebody has touched something in the room. Says what the room's creatures should do about it, if anything. */
  touch(spot: Spot): Stirred {
    const { layout } = this;
    switch (spot.kind) {
      case 'lamp': {
        const on = this.dark.delete(spot.lamp);
        if (!on) this.dark.add(spot.lamp);
        this.tell({ sound: 'relay', remark: lampRemark(layout.lamps.indexOf(spot.lamp) + 1, on) });
        return null;
      }
      case 'monitor':
        this.kept = true;
        if (this.tube === 'dark' || this.tube === 'fade') {
          this.channel = 'card';
          this.tube = 'snow';
          this.until = 0.35;
          this.tell({ sound: 'relay', remark: REMARKS.card });
        } else if (this.channel === 'card') {
          this.channel = 'eye';
          this.tube = 'snow';
          this.until = 0.25;
          this.tell({ sound: 'relay', remark: REMARKS.eye });
        } else {
          this.tube = 'fade';
          this.until = 0.4;
          this.tell({ sound: 'relay', remark: REMARKS.standby });
        }
        return null;
      case 'panel':
        // Thumping it works, for a while. Thumping it again undoes that at once.
        this.burst('spark', layout.panel.x + 39, layout.panel.y + 11);
        if (this.mended > 0) {
          this.mended = 0;
          this.tell({ sound: 'zap', remark: REMARKS.meddled });
        } else {
          this.mended = MENDED + this.random() * 14;
          this.tell({ sound: 'chime', remark: REMARKS.mended });
        }
        return null;
      case 'case':
        if (this.sown) {
          this.tell({ remark: REMARKS.bloom });
        } else {
          this.sown = true;
          this.tell({ sound: 'chime', remark: REMARKS.garden });
        }
        return null;
      case 'drip':
        // The joint lets go of what it had been holding back.
        this.gush = 6;
        this.nextDrop = 0;
        this.tell({ sound: 'plink', remark: REMARKS.drip });
        return null;
      case 'room': {
        // Most of the quarters are empty. Where a light is still kept on, it goes out, and stays out for a while.
        const lamp = spot.door.state === 'shut' ? lampOver(layout, spot.door) : undefined;
        if (lamp) this.hushed.set(lamp, this.clock + 18 + this.random() * 10);
        this.tell({ sound: 'thud', remark: roomRemark(layout.doorways.indexOf(spot.door) + 1, lamp !== undefined) });
        return null;
      }
      case 'skeleton': {
        // Something had made its home in there. It will not be back for a little while.
        const home = this.clock - this.rattled > 7;
        if (home) this.rattled = this.clock;
        this.tell({ sound: 'rattle', remark: REMARKS.skeleton });
        return home ? 'flush' : null;
      }
      case 'door':
        if (this.door !== this.aim) return null;
        if (this.door === 0) {
          // A knock on steel a foot thick. After a moment, three come back.
          this.tell({ sound: 'clang', remark: REMARKS.knock });
          this.burst('dust', layout.gear.x, layout.gear.y - GEAR + 4);
          if (!this.answers.length) this.answers = [1.5, 1.86, 2.22].map((wait) => this.clock + wait);
          return null;
        }
        // Calling into the tunnel. Something out there hears it.
        this.tell({ remark: REMARKS.echo });
        return 'lurk';
    }
  }

  /** Throws up a handful of something at a spot. */
  burst(kind: Speck['kind'], x: number, y: number): void {
    const few = kind === 'heart' ? 1 : kind === 'dust' ? 6 : 8;
    for (let i = 0; i < few; i++) {
      const span = kind === 'heart' ? 1.7 : kind === 'dust' ? 1.2 + this.random() : kind === 'goo' ? 0.45 : 0.3 + this.random() * 0.4;
      this.specks.push({
        kind,
        x: x + (kind === 'dust' ? (this.random() - 0.5) * 30 : 0),
        y,
        dx: kind === 'heart' ? 0 : (this.random() - 0.5) * (kind === 'dust' ? 10 : kind === 'goo' ? 60 : 90),
        dy: kind === 'heart' ? -9 : kind === 'dust' ? this.random() * 6 : -8 - this.random() * (kind === 'goo' ? 40 : 60),
        left: span,
        span,
      });
    }
  }

  private mote(lamp: Lamp, anywhere: boolean): Mote {
    const y = anywhere ? 8 + this.random() * lamp.reach * 0.7 : 6 + this.random() * 10;
    return {
      lamp,
      x: (this.random() - 0.5) * (y * 1.3 + 16),
      y,
      driftX: (this.random() - 0.5) * 3,
      driftY: 0.8 + this.random() * 2.2,
      turn: this.random() * 6.28,
    };
  }

  step(seconds: number): void {
    const { layout } = this;
    this.clock += seconds;

    // The monitor.
    this.until -= seconds;
    if (this.until <= 0) {
      if (this.tube === 'dark') {
        this.channel = 'card';
        this.tube = 'snow';
        this.until = 0.5;
      } else if (this.tube === 'snow') {
        this.tube = 'on';
        this.until = this.kept ? 40 + this.random() * 30 : 7 + this.random() * 6;
      } else if (this.tube === 'on') {
        this.tube = 'fade';
        this.until = 0.4;
      } else {
        this.tube = 'dark';
        this.kept = false;
        this.until = 35 + this.random() * 55;
      }
    }
    // While the card is up the picture now and then tears for a moment.
    this.glitch = this.tube === 'on' && this.channel === 'card' && this.random() < 0.035 ? Math.max(2, this.glitch) : Math.max(0, this.glitch - 1);
    if (this.dip > 0) this.dip -= seconds;
    this.screen = this.tube === 'dark' ? 0 : this.tube !== 'on' || this.glitch ? 0.45 + this.random() * 0.2 : this.channel === 'card' ? 0.8 + this.random() * 0.1 : 0.4;
    // The eye blinks: open for a few seconds, shut for an instant.
    this.lid -= seconds;
    if (this.lid < -0.16) this.lid = 2 + this.random() * 4;

    // The drip.
    if (this.splash > 0) this.splash -= seconds;
    if (this.drop) {
      this.drop.speed += GRAVITY * seconds;
      this.drop.y += this.drop.speed * seconds;
      if (this.drop.y >= layout.drip.to) {
        this.drop = null;
        this.splash = 0.3;
        this.nextDrop = this.gush > 0 ? 0.1 + this.random() * 0.2 : 1.4 + this.random() * 3.6;
        this.gush = Math.max(0, this.gush - 1);
      }
    } else {
      this.nextDrop -= seconds;
      if (this.nextDrop <= 0) this.drop = { y: layout.drip.from, speed: 0 };
    }

    // The dust in the lamplight.
    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i]!;
      mote.x += mote.driftX * seconds;
      mote.y += mote.driftY * seconds;
      mote.turn += seconds * 1.7;
      if (lightAt(mote.lamp, mote.x, mote.y) < 0.04) this.motes[i] = this.mote(mote.lamp, false);
    }

    // The great door.
    if (this.door !== this.aim) {
      const step = seconds / ROLLING;
      if (Math.abs(this.aim - this.door) <= step) {
        this.door = this.aim;
        // Home: it drops into its socket, or against its stop, and what had settled on it comes down.
        this.burst('dust', layout.gear.x - (this.aim ? 30 : 0), layout.gear.y - GEAR + 6);
        this.tell({ sound: 'clunk', remark: this.aim ? REMARKS.open : REMARKS.shut });
      } else {
        this.door += Math.sign(this.aim - this.door) * step;
      }
    }
    if (this.jam > 0) this.jam = Math.max(0, this.jam - seconds);
    if (this.shudder > 0) this.shudder -= seconds;
    while (this.answers.length && this.answers[0]! <= this.clock) {
      const first = this.answers.length === 3;
      this.answers.shift();
      this.shudder = 0.17;
      this.burst('dust', layout.gear.x, layout.gear.y - GEAR + 4);
      this.tell({ sound: 'thud', remark: first ? REMARKS.answer : undefined });
    }

    // The purifier. Left alone, it goes back to what it does best.
    if (this.mended > 0) {
      this.mended -= seconds;
      if (this.mended <= 0) {
        this.burst('spark', layout.panel.x + 39, layout.panel.y + 11);
        this.tell({ sound: 'zap' });
      }
    }

    // The garden.
    if (this.sown && this.grown < 1) this.grown = Math.min(1, this.grown + seconds / 9);

    // Whatever is in the air.
    for (let i = this.specks.length - 1; i >= 0; i--) {
      const speck = this.specks[i]!;
      speck.left -= seconds;
      if (speck.left <= 0) {
        this.specks.splice(i, 1);
        continue;
      }
      if (speck.kind === 'dust') speck.dy += (12 - speck.dy) * seconds * 2;
      else if (speck.kind !== 'heart') speck.dy += (speck.kind === 'goo' ? 200 : 240) * seconds;
      speck.x += speck.dx * seconds;
      speck.y += speck.dy * seconds;
    }
  }

  /**
   * Draws what the lamps light like everything else in the room: the garden,
   * the panel's better news, dust and drops in the air. This comes before
   * the dark of the hall is laid over the picture.
   */
  draw(context: CanvasRenderingContext2D): void {
    const { layout } = this;
    context.globalAlpha = 1;

    if (this.mended > 0) {
      this.mendedPicture ??= paintMended(layout).toCanvas();
      context.drawImage(this.mendedPicture, layout.panel.x + 3, layout.panel.y + 9);
    }

    if (this.grown > 0) {
      for (const plant of this.plants) {
        const tall = Math.floor(plant.height * Math.max(0, Math.min(1, (this.grown - plant.after) / 0.65)));
        let x = plant.x;
        let y = plant.root;
        for (let i = 0; i < tall; i++) {
          x = plant.x + Math.round(plant.lean * i * 0.5 + Math.sin(i / 2 + plant.lean * 9) * 0.7);
          y = plant.root - 1 - i;
          context.fillStyle = i % 2 ? '#4a9a3c' : '#357a2e';
          context.fillRect(x, y, 1, 1);
          if (i % 3 === 1 && i < tall - 1) {
            context.fillStyle = '#7cc653';
            context.fillRect(x + ((i / 3) & 1 ? 1 : -1), y, 1, 1);
          }
        }
        if (plant.bloom && tall === plant.height) {
          context.fillStyle = plant.bloom;
          context.fillRect(x, y - 1, 1, 1);
          context.fillRect(x - 1, y, 1, 1);
          context.fillRect(x + 1, y, 1, 1);
        }
      }
    }

    for (const speck of this.specks) {
      if (speck.kind !== 'dust' && speck.kind !== 'goo') continue;
      context.globalAlpha = Math.min(1, (speck.left / speck.span) * 1.4) * (speck.kind === 'dust' ? 0.7 : 1);
      context.fillStyle = speck.kind === 'dust' ? '#b0a485' : '#a3a83a';
      context.fillRect(Math.round(speck.x), Math.round(speck.y), 1, 1);
    }
    context.globalAlpha = 1;
  }

  /**
   * Draws what shines by itself, over a picture that has already been dimmed
   * by the dark of the hall. It is told how brightly each lamp burns.
   */
  shine(context: CanvasRenderingContext2D, burning: (lamp: Lamp) => number): void {
    const { layout } = this;

    // The lamps themselves.
    context.globalCompositeOperation = 'lighter';
    for (const lamp of layout.lamps) {
      if (lamp.shape !== 'down') continue;
      context.globalAlpha = burning(lamp);
      context.fillStyle = hex(lamp.ink);
      const span = lamp.span ?? 6;
      context.fillRect(Math.round(lamp.x - span / 2), Math.round(lamp.y) + 1, span, span > 8 ? 2 : 3);
    }

    // Dust turning in their light.
    for (const mote of this.motes) {
      const lit = lightAt(mote.lamp, mote.x, mote.y) * burning(mote.lamp) * (0.45 + 0.55 * Math.sin(mote.turn));
      if (lit <= 0.03) continue;
      context.globalAlpha = Math.min(1, lit * 0.7);
      context.fillStyle = hex(mote.lamp.ink);
      context.fillRect(Math.round(mote.lamp.x + mote.x), Math.round(mote.lamp.y + mote.y), 1, 1);
    }

    // The lamp on the purifier's panel: red, on for a second and off for a second, or green for as long as a thump lasts.
    if (this.mended > 0 || Math.floor(this.clock) % 2 === 0) {
      context.globalAlpha = 1;
      context.fillStyle = this.mended > 0 ? '#4dff7c' : '#ff5a3c';
      context.fillRect(layout.panel.x + 38, layout.panel.y + 10, 3, 3);
      context.globalAlpha = 0.25;
      context.fillRect(layout.panel.x + 36, layout.panel.y + 8, 7, 7);
    }

    // Sparks.
    context.fillStyle = '#ffe9a0';
    for (const speck of this.specks) {
      if (speck.kind !== 'spark') continue;
      context.globalAlpha = speck.left / speck.span;
      context.fillRect(Math.round(speck.x), Math.round(speck.y), 1, 1);
    }
    context.globalCompositeOperation = 'source-over';

    // What a dog thinks of being made a fuss of.
    context.fillStyle = '#ff6a7a';
    for (const speck of this.specks) {
      if (speck.kind !== 'heart') continue;
      context.globalAlpha = Math.min(1, (speck.left / speck.span) * 2);
      const x = Math.round(speck.x + Math.sin(speck.left * 5) * 1.2) - 2;
      HEART.forEach((row, v) => {
        for (let u = 0; u < 5; u++) if (row & (16 >> u)) context.fillRect(x + u, Math.round(speck.y) + v, 1, 1);
      });
    }

    // The monitor.
    if (layout.monitor && this.tube !== 'dark') {
      const x = layout.monitor.x + MONITOR.screen.x;
      const y = layout.monitor.y + MONITOR.screen.y;
      context.globalAlpha = this.tube === 'fade' ? Math.max(0, this.until / 0.4) : 0.92;
      if (this.tube === 'on' && this.channel === 'eye') {
        this.eye(context, x, y);
      } else {
        if (!this.snowPictures.length) this.snowPictures = [1, 2, 3, 4].map((seed) => snow(seed * 37).toCanvas());
        this.cardPicture ??= card().toCanvas();
        const tuned = this.tube === 'on' && !this.glitch;
        context.drawImage(tuned ? this.cardPicture : this.snowPictures[Math.floor(this.clock * 12) % this.snowPictures.length]!, x, y);
      }
    }

    // The drop on its way down, and what is left of it.
    const { drip } = layout;
    context.fillStyle = '#a9d6dc';
    if (this.drop) {
      context.globalAlpha = 0.8;
      context.fillRect(drip.x, Math.round(this.drop.y), 1, this.drop.speed > 60 ? 3 : 2);
    } else if (this.nextDrop < 0.5) {
      // It gathers at the joint before it lets go.
      context.globalAlpha = 0.7;
      context.fillRect(drip.x, drip.from, 1, 1);
    }
    if (this.splash > 0) {
      context.globalAlpha = 0.7 * (this.splash / 0.3);
      const spread = this.splash > 0.15 ? 1 : 2;
      context.fillRect(drip.x - spread, drip.to - (spread === 1 ? 2 : 1), 1, 1);
      context.fillRect(drip.x + spread, drip.to - (spread === 1 ? 2 : 1), 1, 1);
      context.fillRect(drip.x, drip.to - 1, 1, 1);
    }
    context.globalAlpha = 1;
  }

  /**
   * The monitor's other channel: the console's own mark, an eye, drawn in
   * phosphor. It follows the pointer about for as far as it can turn.
   */
  private eye(context: CanvasRenderingContext2D, left: number, top: number): void {
    const { width, height } = MONITOR.screen;
    const cx = left + width / 2;
    const cy = top + height / 2;
    context.fillStyle = '#04140a';
    context.fillRect(left, top, width, height);
    const shut = this.lid < 0;
    // How far the lids stand apart, at a place so far from the middle.
    const upper = (u: number) => (shut ? 0 : -Math.round(7 * (1 - (u / 13) ** 2)));
    const lower = (u: number) => (shut ? 0 : Math.round(6 * (1 - (u / 13) ** 2)));
    context.fillStyle = '#21e58f';
    for (let u = -13; u <= 13; u++) {
      context.fillRect(cx + u, cy + upper(u), 1, 1);
      context.fillRect(cx + u, cy + lower(u), 1, 1);
    }
    if (shut) return;

    let lookX = 0;
    let lookY = 0;
    if (this.gaze) {
      const dx = this.gaze.x - cx;
      const dy = this.gaze.y - cy;
      const far = Math.hypot(dx, dy) || 1;
      const pull = Math.min(1, far / 60);
      lookX = Math.round((dx / far) * 6 * pull);
      lookY = Math.round((dy / far) * 2 * pull);
    }
    for (let v = -5; v <= 5; v++) {
      for (let u = -5; u <= 5; u++) {
        const far = Math.hypot(u, v);
        const ring = far > 3.3 && far <= 4.5;
        if (!ring && far > 1.6) continue;
        const x = lookX + u;
        const y = lookY + v;
        // Only what shows between the lids.
        if (Math.abs(x) >= 13 || y <= upper(x) || y >= lower(x)) continue;
        context.fillStyle = ring ? '#1f925d' : '#c8ffd6';
        context.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }
}
