/**
 * What still lives in the vault, drawn from scratch.
 *
 * Nothing here is a picture copied in: every creature is a small puppet of
 * joints and strokes, posed once for each step of its walk and painted into
 * a sheet. No artwork from the games is used.
 */
import { BLUE, BONE, NONE, Raster, YELLOW, hash, tone, type Ramp } from './raster';

const TWO_PI = Math.PI * 2;

/** The pictures of one creature. */
export interface Breed {
  /** Where its feet are on every sheet, so that the sheets line up. */
  foot: { x: number; y: number };
  /** How far it gets in one turn of its walk; keeps the feet from sliding. */
  stride: number;
  /** Named runs of pictures: a walk, standing still, and whatever else it can do. */
  poses: Record<string, Raster[]>;
  /** Pictures a second for the poses it holds while standing; four where nothing is said. */
  rates?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/**
 * Gives a finished figure its edges: caught by the light along the top,
 * in shadow underneath. That is what keeps it readable in a dark hall.
 */
function rim(sheet: Raster, light = 1.3, dark = 0.55): void {
  const { width, height, data } = sheet;
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i++) solid[i] = data[i * 4 + 3]! > 127 ? 1 : 0;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && solid[y * width + x] === 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      let by = 1;
      if (!at(x, y - 1)) by = light;
      else if (!at(x, y + 1)) by = dark;
      else if (!at(x + 1, y)) by = 0.72;
      else if (!at(x - 1, y)) by = 1.1;
      if (by !== 1) sheet.shade(x, y, 1, 1, by);
    }
  }
}

/** Where the middle joint of a two-part limb goes, bending towards the given side. */
function bend(ax: number, ay: number, bx: number, by: number, upper: number, lower: number, side: 1 | -1): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.min(Math.hypot(dx, dy), upper + lower - 0.01);
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance || 1);
  const off = Math.sqrt(Math.max(0, upper * upper - along * along));
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  return [ax + ux * along + -uy * off * side, ay + uy * along + ux * off * side];
}

/** Where a foot is during a walk: half the time on the ground going back, half in the air coming forward. */
function step(phase: number, reach: number, lift: number): [number, number] {
  const at = ((phase % 1) + 1) % 1;
  if (at < 0.5) return [reach / 2 - reach * (at * 2), 0];
  const swing = (at - 0.5) * 2;
  return [-reach / 2 + reach * swing, -lift * Math.sin(Math.PI * swing)];
}

/* ------------------------------------------------------------------ */
/* Ghoul                                                               */
/* ------------------------------------------------------------------ */

const HIDE: Ramp = [0x1b150d, 0x35281a, 0x57442a, 0x7a643c, 0x978353, 0xb39f6e];
const RAW: Ramp = [0x34110c, 0x5e2217, 0x853a27];
/** One that soaked up so much that it shines. */
const GLOWING: Ramp = [0x0b3a1c, 0x13692f, 0x27a84c, 0x5fe07a, 0xb4ffc0, 0xe9ffe6];

type GhoulPose = 'walk' | 'stand' | 'stare';

/** What is left of a vault dweller: hunched, in the rags of a blue suit, one leg dragging. */
function ghoul(phase: number, pose: GhoulPose, glowing: boolean): Raster {
  const sheet = new Raster(30, 56);
  const ground = 54;
  const walking = pose === 'walk';
  const hide = glowing ? GLOWING : HIDE;
  const suit: Ramp = glowing ? GLOWING.slice(0, 4) : BLUE;

  const sway = walking ? Math.sin(phase * TWO_PI) : Math.sin(phase * TWO_PI) * 0.6;
  const hipX = 12;
  const hipY = ground - 21 + (walking ? Math.round(Math.abs(Math.sin(phase * TWO_PI)) * 1.2) : 0);
  const shoulderX = hipX + 5 + (walking ? 0 : -1) + Math.round(sway * 0.6);
  const shoulderY = hipY - 15;
  const headX = shoulderX + (pose === 'stare' ? 1 : 4);
  const headY = shoulderY - 6 + (walking ? Math.round(Math.abs(Math.cos(phase * TWO_PI)) * 0.8) : 0);

  const skin = (level: number, shadow: number) => (_along: number, across: number, x: number, y: number) =>
    hash(x >> 1, y >> 1, 301) > 0.86 && !glowing ? tone(RAW, 0.5 + level * 0.4, x, y) : tone(hide, (level - across * 0.14) * shadow, x, y, 0.5);
  const cloth = (level: number, shadow: number, torn: number) => (along: number, across: number, x: number, y: number) =>
    along > torn || hash(x, y, 307) > 0.95 ? tone(hide, (level - across * 0.14) * shadow, x, y, 0.5) : tone(suit, (level - across * 0.16) * shadow, x, y, 0.5);

  const leg = (offset: number, shadow: number, drag: boolean) => {
    // The bad leg hardly leaves the ground and never reaches as far.
    const [fx, fy] = walking ? step(phase + offset, drag ? 8 : 13, drag ? 1 : 4) : [offset ? -2 : 2, 0];
    const footX = hipX + 3 + fx + (drag && walking ? -2 : 0);
    const footY = ground - 1 + fy;
    const [kneeX, kneeY] = bend(hipX, hipY, footX, footY, 10.5, 10.5, -1);
    sheet.stroke(hipX, hipY, kneeX, kneeY, 4, cloth(0.5, shadow, 2));
    sheet.stroke(kneeX, kneeY, footX, footY - 1, 3, cloth(0.46, shadow, 0.45));
    // A foot, toes forward.
    sheet.stroke(footX, footY, footX + 3, footY, 2, skin(0.3, shadow));
  };

  const arm = (shadow: number, lead: number) => {
    const swing = walking ? Math.sin(phase * TWO_PI + lead) * 0.22 : 0.05 * sway;
    const upper = 0.42 + swing;
    const lower = 0.95 + swing * 1.3 + (pose === 'stare' ? -0.3 : 0);
    const elbowX = shoulderX + Math.sin(upper) * 8.5;
    const elbowY = shoulderY + 2 + Math.cos(upper) * 8.5;
    const handX = elbowX + Math.sin(lower) * 8;
    const handY = elbowY + Math.cos(lower) * 8;
    sheet.stroke(shoulderX, shoulderY + 2, elbowX, elbowY, 3.2, cloth(0.5, shadow, 0.8));
    sheet.stroke(elbowX, elbowY, handX, handY, 2.4, skin(0.6, shadow));
    sheet.stroke(handX, handY, handX + 1, handY + 2, 2.6, skin(0.55, shadow));
  };

  // The far side first, in shadow.
  arm(0.62, Math.PI);
  leg(0.5, 0.55, true);

  // A back bent by two hundred years.
  sheet.stroke(hipX, hipY - 1, shoulderX - 1, shoulderY + 3, 8.6, cloth(0.52, 1, 2));
  sheet.stroke(shoulderX - 3, shoulderY + 4, shoulderX, shoulderY + 1, 7, cloth(0.56, 1, 2));
  if (!glowing) {
    // The stripe down the side of the suit, where it has not rotted off.
    for (let i = 0; i < 14; i++) {
      const x = Math.round(hipX + 1 + ((shoulderX - hipX) * i) / 14);
      const y = hipY - 1 - i;
      if (hash(x, y, 311) > 0.3 && sheet.at(x, y) !== NONE) sheet.dot(x, y, tone(YELLOW, 0.55, x, y));
    }
  }
  // Rags hanging from the hem.
  for (let x = hipX - 4; x <= hipX + 4; x++) {
    const length = Math.floor(hash(x, 0, 313) * 4);
    for (let i = 0; i < length; i++) sheet.dot(x, hipY + 2 + i, tone(suit, 0.3, x, hipY + i));
  }

  // Neck and head, carried low and forward.
  sheet.stroke(shoulderX + 1, shoulderY, headX - 1, headY + 3, 3, skin(0.5, 0.9));
  sheet.stroke(headX - 1, headY - 1, headX + 1, headY, 7.2, skin(0.62, 1));
  sheet.stroke(headX + 1, headY + 2, headX + 2, headY + 3, 4, skin(0.56, 1));
  const dark = glowing ? GLOWING[0]! : 0x0d0906;
  if (pose === 'stare') {
    // Turned to look straight at whoever is sitting at the console.
    sheet.dot(headX - 2, headY - 1, dark);
    sheet.dot(headX - 1, headY - 1, dark);
    sheet.dot(headX + 2, headY - 1, dark);
    sheet.dot(headX + 3, headY - 1, dark);
    sheet.dot(headX, headY + 1, dark);
    sheet.dot(headX + 1, headY + 1, dark);
    for (let x = headX - 1; x <= headX + 2; x++) sheet.dot(x, headY + 3, dark);
  } else {
    sheet.dot(headX + 2, headY - 1, dark);
    sheet.dot(headX + 3, headY - 1, dark);
    sheet.dot(headX + 4, headY + 1, dark);
    sheet.dot(headX + 3, headY + 3, dark);
    sheet.dot(headX + 4, headY + 3, dark);
  }
  // A few last strands of hair.
  sheet.dot(headX - 4, headY - 2, tone(hide, 0.1, 0, 0));
  sheet.dot(headX - 4, headY - 1, tone(hide, 0.1, 0, 0));
  sheet.dot(headX - 3, headY - 4, tone(hide, 0.14, 0, 0));

  leg(0, 1, false);
  arm(1, 0);

  rim(sheet, glowing ? 1.15 : 1.3, glowing ? 0.75 : 0.55);

  if (pose === 'stare' && !glowing) {
    // The console's tube, caught in its eyes.
    sheet.dot(headX - 1, headY - 1, 0x4dff7c);
    sheet.dot(headX + 2, headY - 1, 0x4dff7c);
  }
  return sheet;
}

function ghoulBreed(glowing: boolean): Breed {
  const walk = Array.from({ length: 12 }, (_, i) => ghoul(i / 12, 'walk', glowing));
  return {
    foot: { x: 12, y: 54 },
    // Both feet take a turn on the ground, the bad one for a shorter stretch.
    stride: 21,
    poses: {
      walk,
      stand: [ghoul(0, 'stand', glowing), ghoul(0.25, 'stand', glowing), ghoul(0.5, 'stand', glowing), ghoul(0.75, 'stand', glowing)],
      stare: [ghoul(0.25, 'stare', glowing), ghoul(0.75, 'stare', glowing)],
    },
    rates: { stand: 2.5, stare: 0.7 },
  };
}

/* ------------------------------------------------------------------ */
/* Mole rat                                                            */
/* ------------------------------------------------------------------ */

const PELT: Ramp = [0x21151a, 0x3a2830, 0x5c434a, 0x85656a, 0xab8a8c, 0xcbb0ae];

/** A naked rodent the size of a dog: all wrinkles, with teeth it cannot close its mouth over. */
function moleRat(phase: number, pose: 'walk' | 'sniff'): Raster {
  const sheet = new Raster(46, 26);
  const ground = 24;
  const walking = pose === 'walk';
  const beat = Math.sin(phase * TWO_PI);
  const bob = walking ? Math.round(Math.abs(beat) * 1.1) : 0;
  // Sniffing, it lifts its nose and puts it down again.
  const nose = walking ? Math.round(beat * 0.8) : Math.round(-2.4 * Math.max(0, Math.sin(phase * TWO_PI)));

  const pelt = (level: number, shadow: number) => (_along: number, across: number, x: number, y: number) => {
    // Folds of loose skin across the back.
    const fold = (x + Math.round(Math.sin(y / 2.2) * 1.3)) % 4 === 0 && across < 0.3 ? 0.13 : 0;
    return tone(PELT, (level - across * 0.2 - fold + (hash(x >> 1, y >> 1, 401) - 0.5) * 0.1) * shadow, x, y, 0.5);
  };

  const leg = (x: number, offset: number, shadow: number) => {
    const [fx, fy] = walking ? step(phase + offset, 7, 2.6) : [0, 0];
    sheet.stroke(x, ground - 8 + bob, x + fx, ground - 2 + fy, 3.2, pelt(0.42, shadow));
    sheet.stroke(x + fx, ground - 1 + fy, x + fx + 2, ground - 1 + fy, 1.8, pelt(0.62, shadow));
  };

  // The tail, bare and whipping about.
  const whip = walking ? beat * 2 : Math.sin(phase * TWO_PI * 2) * 1.2;
  sheet.stroke(10, ground - 14 + bob, 5, ground - 17 + bob + whip * 0.5, 1.8, pelt(0.5, 0.9));
  sheet.stroke(5, ground - 17 + bob + whip * 0.5, 1, ground - 14 + bob + whip, 1.3, pelt(0.56, 0.9));

  leg(13, 0.5, 0.6);
  leg(28, 0, 0.6);

  // Rump, barrel and shoulders.
  sheet.stroke(13, ground - 12 + bob, 26, ground - 13 + bob, 13, pelt(0.56, 1));
  sheet.stroke(11, ground - 11 + bob, 14, ground - 11 + bob, 11, pelt(0.5, 1));
  // Neck, skull and snout.
  const headY = ground - 12 + bob + nose;
  sheet.stroke(28, ground - 13 + bob, 33, headY, 10.4, pelt(0.58, 1));
  sheet.stroke(33, headY, 38, headY + 1, 7.6, pelt(0.62, 1));
  sheet.stroke(38, headY + 1, 41, headY + 2, 4.6, pelt(0.68, 1));
  // Nose, eye, ear, and the teeth.
  sheet.dot(43, headY + 2, 0xc77b74);
  sheet.dot(43, headY + 1, 0xa85f5a);
  sheet.dot(35, headY - 2, 0x070504);
  sheet.dot(36, headY - 2, 0x070504);
  sheet.dot(31, headY - 5, tone(PELT, 0.2, 0, 0));
  sheet.dot(32, headY - 6, tone(PELT, 0.72, 0, 0));
  sheet.dot(30, headY - 6, tone(PELT, 0.72, 0, 0));
  sheet.dot(41, headY + 5, BONE[6]!);
  sheet.dot(41, headY + 6, BONE[5]!);
  sheet.dot(42, headY + 5, BONE[5]!);

  leg(16, 0, 1);
  leg(31, 0.5, 1);

  rim(sheet, 1.25, 0.6);
  return sheet;
}

function moleRatBreed(): Breed {
  return {
    foot: { x: 23, y: 24 },
    stride: 14,
    poses: {
      walk: Array.from({ length: 8 }, (_, i) => moleRat(i / 8, 'walk')),
      sniff: Array.from({ length: 6 }, (_, i) => moleRat(i / 6, 'sniff')),
    },
    rates: { sniff: 7 },
  };
}

/* ------------------------------------------------------------------ */
/* Radroach                                                            */
/* ------------------------------------------------------------------ */

const SHELL: Ramp = [0x0e0703, 0x241206, 0x45260c, 0x6b3f14, 0x93601f, 0xbf8a3a];

/** How many ways a radroach can point: eighths of a turn, the first to the right. */
export const HEADINGS = 8;

/** A cockroach as long as a forearm, seen from above as it crosses the wall. */
function radroach(heading: number, gait: number, feelers: number): Raster {
  const sheet = new Raster(21, 21);
  const angle = (heading / HEADINGS) * TWO_PI;
  const hx = Math.cos(angle);
  const hy = Math.sin(angle);
  const at = (along: number, side: number): [number, number] => [10 + hx * along - hy * side, 10 + hy * along + hx * side];

  // Six legs, three of them forward at a time.
  for (let pair = 0; pair < 3; pair++) {
    for (const side of [-1, 1] as const) {
      const forward = (pair + (side > 0 ? 1 : 0) + gait) % 2 === 0;
      const lean = (pair - 1) * 2.4 + (forward ? 1.6 : -1.6);
      const [x0, y0] = at((pair - 1) * 2.2 - 0.5, side * 2);
      const [x1, y1] = at((pair - 1) * 2.2 - 0.5 + lean * 0.5, side * 4.6);
      const [x2, y2] = at((pair - 1) * 2.2 - 0.5 + lean, side * 6.4);
      sheet.line(x0, y0, x1, y1, SHELL[2]!);
      sheet.line(x1, y1, x2, y2, SHELL[1]!);
    }
  }
  // Feelers, forever tasting the air.
  for (const side of [-1, 1] as const) {
    const [x0, y0] = at(5, side * 0.8);
    const [x1, y1] = at(7.5, side * (2 + feelers));
    const [x2, y2] = at(9.6, side * (2.4 + feelers * 2.4));
    sheet.line(x0, y0, x1, y1, SHELL[3]!);
    sheet.line(x1, y1, x2, y2, SHELL[2]!);
  }
  // Wing cases, with the seam between them; then the shield behind the head; then the head.
  const [tx, ty] = at(-5, 0);
  const [mx, my] = at(1.2, 0);
  sheet.stroke(tx, ty, mx, my, 5.6, (along, across, x, y) => tone(SHELL, (Math.abs(across) < 0.2 ? 0.2 : 0.5 - across * 0.24) + along * 0.1, x, y, 0.4));
  const [sx, sy] = at(3, 0);
  sheet.stroke(mx, my, sx, sy, 5, (_along, across, x, y) => tone(SHELL, 0.74 - across * 0.2, x, y, 0.4));
  const [nx, ny] = at(5, 0);
  sheet.stroke(sx, sy, nx, ny, 2.6, SHELL[1]!);
  rim(sheet, 1.2, 0.7);
  return sheet;
}

function radroachBreed(): Breed {
  const poses: Record<string, Raster[]> = {};
  for (let heading = 0; heading < HEADINGS; heading++) {
    poses[`walk${heading}`] = [radroach(heading, 0, 0), radroach(heading, 1, 0)];
    poses[`still${heading}`] = [radroach(heading, 0, 0), radroach(heading, 0, 0.5), radroach(heading, 0, 0), radroach(heading, 0, -0.4)];
  }
  return { foot: { x: 10, y: 10 }, stride: 5, poses, rates: { still: 5 } };
}

const GOO: Ramp = [0x2a2408, 0x4f4a10, 0x7c7a1c, 0xa3a83a, 0xc9cf62];

/** What a radroach leaves behind when somebody's aim was good. */
function stainBreed(): Breed {
  const sheet = new Raster(19, 19);
  // A blot with ragged edges, and drops flung off it.
  sheet.disc(9, 9, 5.6, (distance, angle, x, y) => (distance < 2.8 + hash(Math.round(angle * 2.5), 0, 601) * 2.6 ? tone(GOO, 0.8 - distance * 0.11, x, y, 0.7) : NONE));
  for (let i = 0; i < 10; i++) {
    const angle = hash(i, 0, 607) * TWO_PI;
    const reach = 5 + hash(i, 1, 613) * 3.6;
    sheet.dot(9 + Math.cos(angle) * reach, 9 + Math.sin(angle) * reach, tone(GOO, 0.4 + hash(i, 2, 617) * 0.5, i, 0));
  }
  // What is left of the shell, and two legs that have not understood yet.
  sheet.line(6, 9, 9, 8, SHELL[1]!);
  sheet.line(9, 10, 12, 9, SHELL[2]!);
  sheet.dot(8, 10, SHELL[3]!);
  sheet.dot(11, 8, SHELL[1]!);
  sheet.line(12, 11, 15, 14, SHELL[1]!);
  sheet.line(6, 7, 3, 5, SHELL[1]!);
  return { foot: { x: 9, y: 9 }, stride: 1, poses: { splat: [sheet] } };
}

/* ------------------------------------------------------------------ */
/* Dog                                                                 */
/* ------------------------------------------------------------------ */

const COAT: Ramp = [0x16110d, 0x2c2219, 0x4a3a2a, 0x6b563e, 0x8d7455, 0xad9574];

/** A dog with a collar, who has plainly decided that this is his vault now. */
function dog(phase: number, pose: 'walk' | 'sit'): Raster {
  const sheet = new Raster(42, 30);
  const ground = 28;
  const sitting = pose === 'sit';
  const beat = Math.sin(phase * TWO_PI);
  const bob = sitting ? 0 : Math.round(Math.abs(beat) * 1.1);

  // Dark along the back, pale underneath.
  const coat = (level: number, shadow: number) => (_along: number, across: number, x: number, y: number) =>
    tone(COAT, (level - across * 0.24 + (hash(x >> 1, y >> 1, 501) - 0.5) * 0.08) * shadow, x, y, 0.5);

  const rumpX = 12;
  const rumpY = sitting ? ground - 7 : ground - 14 + bob;
  const chestX = 25;
  const chestY = sitting ? ground - 15 : ground - 15 + bob;

  const leg = (x: number, y: number, offset: number, shadow: number, hind: boolean) => {
    if (sitting && hind) {
      // Folded under him.
      sheet.stroke(x - 1, ground - 5, x + 5, ground - 2, 5, coat(0.44, shadow));
      sheet.stroke(x + 4, ground - 1, x + 8, ground - 1, 2, coat(0.56, shadow));
      return;
    }
    const [fx, fy] = sitting ? [0, 0] : step(phase + offset, 7, 3);
    const footX = x + fx;
    const footY = ground - 1 + fy;
    const [kneeX, kneeY] = bend(x, y, footX, footY, 5.9, 5.9, hind ? 1 : -1);
    sheet.stroke(x, y, kneeX, kneeY, 3.4, coat(0.46, shadow));
    sheet.stroke(kneeX, kneeY, footX, footY, 2.2, coat(0.5, shadow));
    sheet.stroke(footX, footY, footX + 2, footY, 1.8, coat(0.6, shadow));
  };

  // The tail: carried high on the move, sweeping the floor when he sits and is pleased.
  if (sitting) {
    sheet.stroke(rumpX - 3, ground - 4, rumpX - 9, ground - 3 + beat * 2.4, 2.2, coat(0.5, 0.95));
  } else {
    sheet.stroke(rumpX - 2, rumpY - 2, rumpX - 7, rumpY - 8 + beat, 2.4, coat(0.5, 0.95));
    sheet.stroke(rumpX - 7, rumpY - 8 + beat, rumpX - 8, rumpY - 11 + beat, 1.8, coat(0.58, 0.95));
  }

  leg(rumpX + 1, rumpY + 2, 0.5, 0.6, true);
  leg(chestX - 1, chestY + 3, 0, 0.6, false);

  // Haunches, barrel and chest.
  sheet.stroke(rumpX, rumpY, chestX, chestY, 8.4, coat(0.52, 1));
  sheet.stroke(rumpX - 1, rumpY + 1, rumpX + 2, rumpY + 1, 8, coat(0.48, 1));
  sheet.stroke(chestX - 1, chestY + 1, chestX + 1, chestY + 2, 8.6, coat(0.56, 1));
  // Neck, head and muzzle.
  const headX = chestX + 6;
  const headY = chestY - 8 + (sitting ? Math.round(Math.max(0, beat) * 0.9) : Math.round(beat * 0.6));
  sheet.stroke(chestX + 1, chestY - 1, headX - 1, headY + 2, 5.4, coat(0.52, 1));
  sheet.stroke(headX - 1, headY, headX + 2, headY + 1, 6.2, coat(0.56, 1));
  sheet.stroke(headX + 3, headY + 2, headX + 7, headY + 3, 3.2, coat(0.66, 1));
  // Ears pricked.
  sheet.stroke(headX - 2, headY - 3, headX - 3, headY - 6, 1.8, coat(0.36, 1));
  sheet.stroke(headX + 1, headY - 3, headX + 1, headY - 6, 2, coat(0.5, 1));
  // The collar somebody once put on him.
  sheet.stroke(chestX + 2, chestY - 4, chestX + 5, chestY - 2, 1.6, 0xb0321c);

  leg(rumpX + 3, rumpY + 2, 0, 1, true);
  leg(chestX + 1, chestY + 3, 0.5, 1, false);

  rim(sheet, 1.25, 0.58);
  // Nose, eye, and his tongue out when he has sat down to look at you.
  sheet.dot(headX + 8, headY + 2, 0x0a0706);
  sheet.dot(headX + 2, headY - 1, 0x0a0706);
  if (sitting && phase % 0.5 < 0.25) sheet.dot(headX + 6, headY + 5, 0xc77b74);
  return sheet;
}

function dogBreed(): Breed {
  return {
    foot: { x: 20, y: 28 },
    stride: 14,
    poses: {
      walk: Array.from({ length: 8 }, (_, i) => dog(i / 8, 'walk')),
      sit: Array.from({ length: 8 }, (_, i) => dog(i / 8, 'sit')),
    },
    rates: { sit: 9 },
  };
}

/* ------------------------------------------------------------------ */
/* Something in the dark                                               */
/* ------------------------------------------------------------------ */

/** Two eyes, a long way up, in a doorway with no light in it. Whatever they belong to stays where it is. */
function eyesBreed(): Breed {
  const open = new Raster(9, 3);
  for (const x of [0, 6]) {
    open.dot(x, 1, 0xffb347);
    open.dot(x + 1, 1, 0xffe2a0);
    open.dot(x + 2, 1, 0xffb347);
    open.dot(x + 1, 0, 0xc26a1a, 0.7);
    open.dot(x + 1, 2, 0xc26a1a, 0.7);
  }
  const narrowed = new Raster(9, 3);
  for (const x of [0, 6]) narrowed.box(x, 1, 3, 1, 0xc26a1a);
  return { foot: { x: 4, y: 1 }, stride: 1, poses: { open: [open], blink: [narrowed] } };
}

/* ------------------------------------------------------------------ */
/* The cast                                                            */
/* ------------------------------------------------------------------ */

export type Kind = 'ghoul' | 'glowing' | 'molerat' | 'radroach' | 'stain' | 'dog' | 'eyes';

export function breed(kind: Kind): Breed {
  switch (kind) {
    case 'ghoul':
      return ghoulBreed(false);
    case 'glowing':
      return ghoulBreed(true);
    case 'molerat':
      return moleRatBreed();
    case 'radroach':
      return radroachBreed();
    case 'stain':
      return stainBreed();
    case 'dog':
      return dogBreed();
    case 'eyes':
      return eyesBreed();
  }
}
