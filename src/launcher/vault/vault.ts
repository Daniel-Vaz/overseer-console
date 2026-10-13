/**
 * The vault behind the console, on a canvas.
 *
 * The room is painted once, small, and shown enlarged with hard-edged pixels.
 * After that only what changes is drawn again, a dozen times a second: the
 * lamps, the great door when it rolls, and whatever is passing through.
 * Presses on the canvas are passed on to whatever was under them.
 */
import { breed, type Breed, type Kind } from './critters';
import { Effects, type Said } from './effects';
import { GEAR, ROLL, arrange, spotAt, type Box, type Lamp, type Layout } from './layout';
import { BUILDS, Life, type Actor, type Poke, type Visit } from './life';
import { REMARKS, type Sound } from './remarks';
import { paintBack, paintCog, paintFront, paintLight, paintSpill } from './scenery';

/** Screen pixels to one painted pixel, before rounding to whole device pixels. */
const COARSE = 3;
/** Pictures a second. The games' own animations ran at about this rate. */
const RATE = 12;
/** The hall with every lamp out, as a share of full light. */
const DARK = '#333f45';
/** How much of a lamp's light hangs in the dusty air in front of the wall. */
const HAZE = 0.16;
/** With less of the room than this showing past the console, in painted pixels, it is not worth painting. */
const WORTH_SHOWING = 14;

interface Lit {
  lamp: Lamp;
  patch: HTMLCanvasElement;
  /** Its brightness now, from 0 to 1. */
  level: number;
  /** When a failing lamp next changes its mind. */
  until: number;
}

/** A creature's pictures, ready to draw, facing either way. */
interface Pictures {
  breed: Breed;
  right: Record<string, HTMLCanvasElement[]>;
  left: Record<string, HTMLCanvasElement[]>;
}

/**
 * What the room can be asked for from outside: a visitor, the whole cast at
 * once, nobody at all for a while, a seal that did not take, or a flicker of
 * its lamps when the console has had its power off and on again.
 */
export type Request = Visit | 'parade' | 'nobody' | 'jam' | 'dip';

export interface Vault {
  /** Fits the room to the window again. */
  resize(): void;
  /** Asks something of the room now, instead of waiting for it. False if none of the room shows. */
  send(request: Request): boolean;
  /** Where on the page the pointer is, and whether it is over the room. */
  look(x: number, y: number, over: boolean): void;
  /** A press on the room, at a place on the page. */
  press(x: number, y: number): void;
  /** Whether the vault's storage is sealed. The great door follows: shut if it is, rolled aside if not. */
  seal(sealed: boolean): void;
  close(): void;
}

export interface VaultOptions {
  /** Where on the page the console is. */
  housing: () => DOMRect | null;
  /** Nothing moves and nothing answers: for those who have asked their system for less motion. */
  still: boolean;
  /** Told whether any of the room can be seen past the console. */
  onshow?: (showing: boolean) => void;
  onsound?: (sound: Sound) => void;
  /** Something for the nameplate on the housing to say. */
  onremark?: (remark: string) => void;
  /** A radroach has met its end. */
  onsquash?: () => void;
}

function mirror(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d')!;
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(source, 0, 0);
  return canvas;
}

export function openVault(canvas: HTMLCanvasElement, options: VaultOptions): Vault {
  const context = canvas.getContext('2d')!;
  const light = document.createElement('canvas');
  const lightContext = light.getContext('2d')!;
  const cast = new Map<Kind, Pictures>();
  /* The great door is painted again whenever it has turned, and its shadow cut out of that. */
  const cog = document.createElement('canvas');
  const cogShadow = document.createElement('canvas');
  let cogTurn = NaN;

  let layout: Layout | null = null;
  let life: Life | null = null;
  let effects: Effects | null = null;
  let back: HTMLCanvasElement | null = null;
  let front: HTMLCanvasElement | null = null;
  let spill: HTMLCanvasElement | null = null;
  let halo: HTMLCanvasElement | null = null;
  let lit: Lit[] = [];
  const burning = new Map<Lamp, Lit>();
  let frame = 0;
  let last = 0;
  let closed = false;
  /** What the room was last fitted to, and how many screen pixels its painted ones are. */
  let fitted = '';
  let cell = COARSE;
  /* What outlasts a change of window: the seal, once it is known, and whether the case has been opened. */
  let sealed: boolean | null = null;
  let sown = false;
  /* Where the pointer was last, in the room's own pixels, and what the cursor shows for it. */
  const pointer = { x: 0, y: 0, over: false };
  let cursor = '';

  function tell(said: Said): void {
    if (said.sound) options.onsound?.(said.sound);
    if (said.remark) options.onremark?.(said.remark);
  }

  function build(): void {
    const ratio = window.devicePixelRatio || 1;
    // A painted pixel covers a whole number of device pixels, so that all of them come out the same size.
    cell = Math.max(1, Math.round(COARSE * ratio)) / ratio;
    const bounds = canvas.parentElement!.getBoundingClientRect();
    const width = Math.ceil(bounds.width / cell);
    const height = Math.ceil(bounds.height / cell);
    const rect = options.housing();
    const console: Box = rect
      ? {
          x: Math.round((rect.left - bounds.left) / cell),
          y: Math.round((rect.top - bounds.top) / cell),
          width: Math.round(rect.width / cell),
          height: Math.round(rect.height / cell),
        }
      : { x: 0, y: 0, width, height };
    // Nothing has moved: the room stands as it is, and whoever is in it stays.
    const measured = [cell, width, height, console.x, console.y, console.width, console.height].join();
    if (measured === fitted) return;
    fitted = measured;

    const showing =
      width > 0 &&
      height > 0 &&
      Math.max(console.x, console.y, width - console.x - console.width, height - console.y - console.height) >= WORTH_SHOWING;
    options.onshow?.(showing);
    cancelAnimationFrame(frame);
    if (!showing) {
      layout = life = effects = null;
      return;
    }

    // 23 October 2077.
    const today = new Date();
    layout = arrange(width, height, console, today.getMonth() === 9 && today.getDate() === 23);
    life = new Life(layout);
    life.open = sealed === false;
    effects = new Effects(layout, tell, { open: sealed === false, sown });
    canvas.width = light.width = width;
    canvas.height = light.height = height;
    canvas.style.width = `${width * cell}px`;
    canvas.style.height = `${height * cell}px`;

    back = paintBack(layout).toCanvas();
    front = paintFront(layout).toCanvas();
    spill = paintSpill(layout).toCanvas();
    lit = layout.lamps.map((lamp) => ({ lamp, patch: paintLight(lamp).toCanvas(), level: lamp.mood === 'beacon' ? 0.8 : 1, until: 0 }));
    burning.clear();
    for (const entry of lit) burning.set(entry.lamp, entry);
    last = performance.now();
    draw(last);
    if (!options.still) frame = requestAnimationFrame(tick);
  }

  function pictures(kind: Kind): Pictures {
    let known = cast.get(kind);
    if (!known) {
      const made = breed(kind);
      known = { breed: made, right: {}, left: {} };
      for (const [pose, sheets] of Object.entries(made.poses)) {
        known.right[pose] = sheets.map((sheet) => sheet.toCanvas());
        known.left[pose] = known.right[pose].map(mirror);
      }
      cast.set(kind, known);
    }
    return known;
  }

  /** The light that a creature full of radiation carries around with it. */
  function aura(): HTMLCanvasElement {
    halo ??= paintLight({ x: 0, y: 0, reach: 52, ink: 0x6dff8e, mood: 'steady', shape: 'round' }).toCanvas();
    return halo;
  }

  /** How bright the things are that are lamps only in a manner of speaking. */
  function moodLevel(lamp: Lamp): number {
    switch (lamp.mood) {
      case 'screen':
        return effects?.screen ?? 0;
      case 'garden':
        return (effects?.grown ?? 0) * 0.9;
      case 'daylight':
        // It comes in past the door only as far as the door has got out of its way.
        return (effects?.rolled ?? 0) ** 2;
      default:
        return 1;
    }
  }

  /** Decides how brightly every lamp burns at this moment. */
  function burn(now: number): void {
    for (const entry of lit) {
      const { lamp } = entry;
      if (effects?.out(lamp)) {
        entry.level = 0;
      } else if (lamp.mood === 'beacon') {
        entry.level = options.still ? 0.8 : 0.62 + 0.38 * Math.sin(now / 900);
      } else if (lamp.mood !== 'failing') {
        entry.level = moodLevel(lamp);
      } else if (!options.still) {
        // Mostly on, with fits of stuttering. One that was switched off comes back on at once.
        if (entry.level === 0) entry.level = 1;
        if (now < entry.until) continue;
        const on = entry.level > 0.5;
        const fit = Math.random() < 0.7;
        entry.level = on ? (Math.random() < 0.5 ? 0.08 : 0.3) : 1;
        entry.until = now + (on ? 40 + Math.random() * 160 : fit ? 60 + Math.random() * 200 : 900 + Math.random() * 5200);
      }
    }
  }

  /** Draws one creature where it stands: as the lamps light it, or by the light it gives off itself. */
  function show(actor: Actor, shining: boolean): void {
    const build = BUILDS[actor.kind];
    const { breed: made, right, left } = pictures(actor.kind);
    const turned = actor.facing < 0 && !build.crawls;
    const sheets = (turned ? left : right)[build.crawls ? `${actor.pose}${actor.heading}` : actor.pose];
    if (!sheets?.length) return;
    const index =
      actor.pose === 'walk'
        ? Math.floor((actor.walked / made.stride) * sheets.length) % sheets.length
        : Math.floor(actor.held * (made.rates?.[actor.pose] ?? 4)) % sheets.length;
    const sheet = sheets[index]!;
    const x = Math.round(actor.x) - (turned ? sheet.width - 1 - made.foot.x : made.foot.x);
    const y = Math.round(actor.y) - made.foot.y;
    if (shining) {
      context.globalAlpha = actor.shown * (build.shines === 'only' ? 1 : Math.min(1, 0.34 + (actor.flare ?? 0) * 0.6));
      context.drawImage(sheet, x, y);
      return;
    }
    if (!build.crawls && !build.flat) {
      // What it stands on is darker under it.
      context.globalAlpha = actor.shown * 0.42;
      context.fillStyle = '#000';
      context.fillRect(Math.round(actor.x - build.width * 0.4), Math.round(actor.y) - 1, Math.round(build.width * 0.8), 2);
    }
    context.globalAlpha = actor.shown;
    context.drawImage(sheet, x, y);
  }

  /** The great door, wherever on its rail it has got to. */
  function door(now: number): void {
    if (!layout) return;
    const rolled = effects?.rolled ?? 0;
    // Rolling without slipping: as far as it has gone, so far it has turned.
    const turn = -(ROLL * rolled) / GEAR;
    if (turn !== cogTurn) {
      cogTurn = turn;
      paintCog(turn).toCanvas(cog);
      cogShadow.width = cog.width;
      cogShadow.height = cog.height;
      const shadow = cogShadow.getContext('2d')!;
      shadow.drawImage(cog, 0, 0);
      shadow.globalCompositeOperation = 'source-in';
      shadow.fillRect(0, 0, cog.width, cog.height);
    }
    // Something on the far side is knocking back.
    const shaken = (effects?.shudder ?? 0) > 0 ? (Math.floor(now / 60) % 2 ? 1 : -1) : 0;
    const x = Math.round(layout.gear.x - ROLL * rolled) - GEAR - 1 + shaken;
    const y = layout.gear.y - GEAR - 1;
    if (rolled > 0.02) {
      // Out of its socket it stands in front of the wall, and throws a shadow on it.
      context.globalAlpha = 0.45;
      context.drawImage(cogShadow, x + 2, y + 2);
      context.globalAlpha = 1;
    }
    context.drawImage(cog, x, y);
  }

  function draw(now: number): void {
    if (!layout || !back || !front || !spill) return;
    burn(now);
    const power = effects?.power ?? 1;
    const actors = life?.actors ?? [];
    const shining = actors.filter((actor) => BUILDS[actor.kind].shines === 'too');

    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.drawImage(back, 0, 0);
    door(now);
    for (const actor of actors) if (BUILDS[actor.kind].shines !== 'only') show(actor, false);
    context.globalAlpha = 1;
    effects?.draw(context);
    context.drawImage(front, 0, 0);

    // The light in the hall: darkness, plus what every lamp adds.
    lightContext.globalCompositeOperation = 'source-over';
    lightContext.globalAlpha = 1;
    lightContext.fillStyle = DARK;
    lightContext.fillRect(0, 0, light.width, light.height);
    lightContext.globalCompositeOperation = 'lighter';
    lightContext.drawImage(spill, 0, 0);
    for (const entry of lit) {
      if (entry.level <= 0) continue;
      lightContext.globalAlpha = entry.level * power;
      lightContext.drawImage(entry.patch, Math.round(entry.lamp.x) - entry.lamp.reach, Math.round(entry.lamp.y) - entry.lamp.reach);
    }
    for (const actor of shining) {
      lightContext.globalAlpha = Math.min(1, actor.shown * (0.8 + 0.2 * Math.sin(now / 240) + (actor.flare ?? 0)));
      lightContext.drawImage(aura(), Math.round(actor.x) - 52, Math.round(actor.y) - 26 - 52);
    }

    context.globalCompositeOperation = 'multiply';
    context.drawImage(light, 0, 0);

    // Dust in the air catches the light as well, and what shines by itself is not dimmed by the dark.
    context.globalCompositeOperation = 'lighter';
    for (const entry of lit) {
      if (entry.level <= 0) continue;
      context.globalAlpha = entry.level * power * HAZE;
      context.drawImage(entry.patch, Math.round(entry.lamp.x) - entry.lamp.reach, Math.round(entry.lamp.y) - entry.lamp.reach);
    }
    for (const actor of shining) {
      context.globalAlpha = Math.min(1, actor.shown * (HAZE + (actor.flare ?? 0) * 0.5));
      context.drawImage(aura(), Math.round(actor.x) - 52, Math.round(actor.y) - 26 - 52);
      show(actor, true);
    }
    for (const actor of actors) if (BUILDS[actor.kind].shines === 'only') show(actor, true);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    effects?.shine(context, (lamp) => (burning.get(lamp)?.level ?? 0) * power);
  }

  /** The cursor says what a press would do: take aim at something alive, or lay a hand on something that is not. */
  function hover(): void {
    const next = !pointer.over || !layout || !life ? '' : life.under(pointer.x, pointer.y) ? 'crosshair' : spotAt(layout, pointer.x, pointer.y) ? 'pointer' : '';
    if (next === cursor) return;
    cursor = next;
    canvas.style.cursor = next;
  }

  /** What follows from somebody having been poked. */
  function react({ actor, reaction }: Poke): void {
    switch (reaction) {
      case 'squashed':
        effects?.burst('goo', actor.x, actor.y);
        tell({ sound: 'squash' });
        options.onsquash?.();
        break;
      case 'petted':
        effects?.burst('heart', actor.x + actor.facing * 8, actor.y - 30);
        tell({ sound: 'bark', remark: REMARKS.dog });
        break;
      case 'stared':
        tell({ sound: 'groan', remark: REMARKS.ghoul });
        break;
      case 'upset':
        tell({ sound: 'groan', remark: REMARKS.upset });
        break;
      case 'flared':
        // Every counter in the room goes off at once.
        for (let i = 0; i < 12; i++) window.setTimeout(() => options.onsound?.('crackle'), i * 30);
        tell({ sound: 'groan', remark: REMARKS.glowing });
        break;
      case 'bolted':
        tell({ sound: 'squeak', remark: REMARKS.molerat });
        break;
      case 'gone':
        tell({ sound: 'growl', remark: REMARKS.eyes });
        break;
    }
  }

  function tick(now: number): void {
    if (closed) return;
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / RATE - 2) return;
    // A tab left in the background comes back to where it was, not to where it would have got to.
    const seconds = Math.min(0.25, (now - last) / 1000);
    life?.step(seconds);
    effects?.step(seconds);
    // Things come in by the great door only once it has rolled out of their way.
    if (life && effects) life.open = effects.rolled > 0.95;
    // A counter ticks faster the more there is to count.
    if (life?.actors.some((actor) => actor.kind === 'glowing') && Math.random() < 0.45) options.onsound?.('crackle');
    last = now;
    hover();
    draw(now);
  }

  /** A place on the page, in the room's own pixels. */
  function place(x: number, y: number): [number, number] {
    const bounds = canvas.getBoundingClientRect();
    return [(x - bounds.left) / cell, (y - bounds.top) / cell];
  }

  // Painting the room takes a moment, and the console itself should be up first.
  const first = window.setTimeout(build, 0);

  return {
    resize() {
      if (!closed) build();
    },
    send(request) {
      if (options.still || !life) return false;
      if (request === 'jam' || request === 'dip' || request === 'nobody') {
        if (request === 'jam') effects?.stick();
        else if (request === 'dip') effects?.flicker();
        else life.clear();
        return true;
      }
      if (request !== 'parade') return life.send(request);
      const anybody = life.parade();
      if (anybody) options.onremark?.(REMARKS.parade);
      return anybody;
    },
    look(x, y, over) {
      [pointer.x, pointer.y] = place(x, y);
      pointer.over = over;
      if (effects) effects.gaze = { x: pointer.x, y: pointer.y };
    },
    press(x, y) {
      if (options.still || !layout || !life || !effects) return;
      const [px, py] = place(x, y);
      const poke = life.poke(px, py);
      if (poke) {
        react(poke);
        return;
      }
      const spot = spotAt(layout, px, py);
      if (!spot) return;
      const stirred = effects.touch(spot);
      sown = effects.sown;
      if (stirred === 'flush') life.flush(layout.skeleton + 14, layout.floor - 8);
      else if (stirred === 'lurk') life.lurk();
    },
    seal(next) {
      // The first that is heard of it puts the door where it belongs. After that it is seen to roll.
      const atOnce = sealed === null || options.still;
      sealed = next;
      if (!effects) return;
      effects.seal(!next, atOnce);
      if (life && atOnce) life.open = !next;
      if (options.still) draw(performance.now());
    },
    close() {
      closed = true;
      clearTimeout(first);
      cancelAnimationFrame(frame);
    },
  };
}
