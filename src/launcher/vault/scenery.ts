/**
 * The parts of the vault that stand still: walls, floor, pipes, galleries and
 * doors, painted from scratch. No artwork from the games is used.
 *
 * Everything is painted as it would look in full light. How dark the hall is,
 * and where the lamps reach, is decided when the picture is put together.
 */
import { CEILING, DOOR_HEIGHT, DOOR_WIDTH, GEAR, MONITOR, PLATE_HEIGHT, PLATE_WIDTH, ROLL, type Doorway, type Lamp, type Layout } from './layout';
import { BLUE, BONE, BRASS, NONE, PHOSPHOR, RED, RUST, Raster, STEEL, YELLOW, cloud, hash, noise, tone, type Ink, type Ramp } from './raster';

const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Wall and floor                                                      */
/* ------------------------------------------------------------------ */

/** Where water has found a way down the wall: 0 for dry, up to 1 in the worst of it. */
function seep(x: number): number {
  return Math.max(0, noise(x / 23, 0.5, 53) - 0.6) * 2.5;
}

/** Steel that has been left alone for a long time: one pixel of it. */
function steel(level: number, x: number, y: number, rusting = 0): Ink {
  // Rust comes in patches that have run downwards, with a crust of finer blotches.
  const rust = cloud(x / 15, y / 24, 23) * 0.84 + noise(x / 4, y / 5, 29) * 0.16 + rusting;
  if (rust > 0.72) return tone(RUST, 0.12 + (rust - 0.72) * 2.6 + (level - 0.6) * 0.5, x, y);
  // Where it is about to break through, the steel is stained by it.
  return tone(STEEL, level - Math.max(0, rust - 0.64) * 1.1, x, y, 0.4);
}

function wall(sheet: Raster, layout: Layout): void {
  const middle = Math.round(layout.width / 2);
  sheet.each(0, 0, layout.width, layout.floor, (x, y) => {
    // Plates are counted upwards from the floor, every other row shifted by half a plate.
    const up = layout.floor - 1 - y;
    const row = Math.floor(up / PLATE_HEIGHT);
    const v = PLATE_HEIGHT - 1 - (up - row * PLATE_HEIGHT);
    const along = x - middle + (row & 1) * (PLATE_WIDTH / 2) + 4096 * PLATE_WIDTH;
    const column = Math.floor(along / PLATE_WIDTH);
    const u = along - column * PLATE_WIDTH;
    // The bottom row of every storey is the darker dado, under a painted band.
    const dado = row % 4 === 0;

    let level = 0.64 + (hash(column, row, 5) - 0.5) * 0.12 + (cloud(x / 41, y / 29, 11) - 0.5) * 0.24;
    if (dado) level -= 0.1;

    // Water has run down the wall for decades, worst where the pipes above have given way.
    const wet = seep(x);
    const run = noise(x * 0.42, y / 61, 31) + wet * 0.25;
    if (run > 0.72) level -= (run - 0.72) * 0.8;
    // Here and there a plate was replaced, and is younger than its neighbours.
    const fresh = hash(column, row, 7) > 0.93;
    if (fresh) level += 0.08;

    if (dado && v < 3) {
      const worn = cloud(x / 9, y / 3, 47);
      if (worn < 0.62) return v === 2 ? tone(YELLOW, 0.3 + worn * 0.3, x, y) : tone(BLUE, 0.42 + level * 0.4 - v * 0.08, x, y);
    }

    // Bevelled edges: light from above and from the left.
    if (v === 0) level += 0.15;
    else if (v === 1) level += 0.05;
    else if (v === PLATE_HEIGHT - 1) level -= 0.3;
    if (u === 0) level += 0.09;
    else if (u === PLATE_WIDTH - 1) level -= 0.22;

    // A rivet in each corner and one halfway along the long edges.
    const ru = u === 3 || u === PLATE_WIDTH - 5 || u === PLATE_WIDTH / 2 - 1 ? 0 : u === 4 || u === PLATE_WIDTH - 4 || u === PLATE_WIDTH / 2 ? 1 : -1;
    const rv = v === 3 || v === PLATE_HEIGHT - 5 ? 0 : v === 4 || v === PLATE_HEIGHT - 4 ? 1 : -1;
    if (ru >= 0 && rv >= 0) level += ru + rv === 0 ? 0.3 : ru + rv === 2 ? -0.26 : 0.07;

    // Rust gathers along the seams, and bleeds downwards from them.
    const seam = Math.min(v, PLATE_HEIGHT - 1 - v, u, PLATE_WIDTH - 1 - u);
    const bleed = v < 14 ? (14 - v) * 0.006 * (noise(x * 0.6, row * 7.3, 37) > 0.62 ? 2 : 0.1) : 0;
    const damp = wet * (0.1 + noise(x / 7, y / 37, 59) * 0.2);
    return steel(level, x, y, (seam < 2 ? (2 - seam) * 0.025 : 0) + bleed + damp + (dado ? 0.02 : 0) - (fresh ? 0.12 : 0));
  });
}

function floor(sheet: Raster, layout: Layout): void {
  const middle = layout.width / 2;
  // The eye is at the height of the console's middle: floor seams run towards a point up there.
  const horizon = layout.floor - 150;
  const depth = layout.height - layout.floor;
  sheet.each(0, layout.floor, layout.width, depth, (x, y) => {
    const fall = y - horizon;
    const across = ((x - middle) / fall) * 4.6 + 4096;
    const away = 2100 / fall;
    const tile = hash(Math.floor(across), Math.floor(away), 61);
    let level = 0.42 + (tile - 0.5) * 0.08 + (cloud(x / 30, y / 9, 67) - 0.5) * 0.2;
    const fu = across - Math.floor(across);
    const fv = away - Math.floor(away);
    // Seams between the floor plates.
    if (fu < 0.045 || fv < 0.07) level -= 0.14;
    else if (fu < 0.09 || fv < 0.14) level += 0.05;
    // The wall stands on it.
    if (y - layout.floor < 2) level -= 0.14;
    // Towards the eye the floor drops out of the light.
    level -= ((y - layout.floor) / depth) ** 2 * 0.12;
    return steel(level, x, y, -0.05 + seep(x) * 0.1);
  });
}

/* ------------------------------------------------------------------ */
/* Pipes                                                               */
/* ------------------------------------------------------------------ */

/** A pipe along the wall: round, so brightest a little above its middle. */
function pipe(sheet: Raster, layout: Layout, top: number, thickness: number, ramp: readonly Ink[], joint: number, seed: number): void {
  for (let x = 0; x < layout.width; x++) {
    const along = (x - Math.round(layout.width / 2) + 4096 * joint) % joint;
    const flange = along < 3;
    const extra = flange && thickness > 4 ? 1 : 0;
    for (let j = -extra; j < thickness + extra; j++) {
      const across = (j + 0.5) / thickness;
      let level = 0.2 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, across * 0.85 + 0.1))) ** 1.4 - across * 0.18;
      level += (cloud(x / 19, (j + seed) / 3, seed) - 0.5) * 0.2;
      if (flange) level += along === 0 ? 0.14 : along === 2 ? -0.1 : 0.05;
      const rust = cloud(x / 15, j / 4 + seed, seed + 3) + (along < 9 ? 0.12 : 0);
      sheet.dot(x, top + j, rust > 0.66 ? tone(RUST, 0.2 + level * 0.8, x, top + j) : tone(ramp, level, x, top + j));
    }
    // Its shadow on the wall.
    sheet.shade(x, top + thickness + extra, 1, Math.max(2, Math.round(thickness / 2)), 0.62);
  }
}

function ceiling(sheet: Raster, layout: Layout): void {
  // The ceiling itself, and the shade it keeps the top of the wall in.
  sheet.each(0, 0, layout.width, 7, (x, y) => tone(STEEL, 0.13 + (y === 6 ? 0.1 : 0) + (cloud(x / 30, y, 71) - 0.5) * 0.08, x, y));
  sheet.shade(0, 7, layout.width, CEILING - 7, (_, y) => 0.55 + ((y - 7) / (CEILING - 7)) * 0.45);

  pipe(sheet, layout, 11, 13, STEEL.slice(2, 12), 96, 3);
  pipe(sheet, layout, 28, 6, BRASS, 64, 5);
  pipe(sheet, layout, 38, 3, STEEL.slice(0, 8), 32, 7);

  // Straps holding the pipes to the ceiling.
  const middle = Math.round(layout.width / 2);
  for (let x = ((middle + 48) % 96) - 96; x < layout.width; x += 96) {
    sheet.each(x, 7, 2, 28, (px, py) => tone(STEEL, px === x ? 0.5 : 0.28, px, py));
    sheet.each(x - 1, 10, 4, 1, (px, py) => tone(STEEL, 0.6, px, py));
    sheet.each(x - 1, 24, 4, 1, (px, py) => tone(STEEL, 0.2, px, py));
  }
}

/* ------------------------------------------------------------------ */
/* Galleries                                                           */
/* ------------------------------------------------------------------ */

const POSTS = 33;

function galleries(sheet: Raster, layout: Layout): void {
  const middle = Math.round(layout.width / 2);
  for (const deck of layout.decks) {
    // What the deck keeps out of the light.
    sheet.shade(0, deck + 5, layout.width, 16, (_, y) => 0.5 + ((y - deck - 5) / 16) * 0.5);
    // Brackets under it.
    for (let x = ((middle + POSTS) % (POSTS * 2)) - POSTS * 2; x < layout.width; x += POSTS * 2) {
      for (let j = 0; j < 11; j++) {
        sheet.each(x, deck + 5 + j, 11 - j, 1, (px, py) => tone(STEEL, px === x ? 0.42 : j === 0 ? 0.3 : px === x + 10 - j ? 0.36 : 0.22, px, py));
      }
    }
    // The deck: a grating seen edge on.
    sheet.each(0, deck, layout.width, 5, (x, y) => {
      const j = y - deck;
      if (j === 0) return steel(0.66, x, y, 0.02);
      if (j === 4) return tone(STEEL, 0.1, x, y);
      return steel((x + j) % 3 === 0 ? 0.2 : 0.42 - j * 0.04, x, y, 0.04);
    });
  }
}

/** The railings stand in front of whatever walks the galleries. */
function railings(sheet: Raster, layout: Layout): void {
  const middle = Math.round(layout.width / 2);
  for (const deck of layout.decks) {
    const top = deck - 30;
    const first = ((middle + 16) % POSTS) - POSTS;
    for (let x = first; x < layout.width; x += POSTS) {
      const bay = Math.round((x - middle) / POSTS);
      // Here and there the handrail has come away at one end and hangs down to the deck.
      const fallen = hash(bay, deck, 83) > 0.88;
      for (let i = 0; i < POSTS; i++) {
        const px = x + i;
        if (fallen) {
          const drop = Math.round((i / POSTS) ** 1.6 * 26);
          sheet.dot(px, top + drop, steel(0.62, px, top + drop, 0.06));
          sheet.dot(px, top + drop + 1, steel(0.3, px, top + drop + 1, 0.06));
        } else {
          sheet.dot(px, top, steel(0.72, px, top, 0.03));
          sheet.dot(px, top + 1, steel(0.36, px, top + 1, 0.03));
          sheet.dot(px, top + 15, steel(0.46, px, top + 15, 0.05));
        }
        // Kick plate.
        sheet.dot(px, deck - 3, steel(0.58, px, deck - 3, 0.04));
        sheet.dot(px, deck - 2, steel(0.4, px, deck - 2, 0.06));
        sheet.dot(px, deck - 1, steel(0.3, px, deck - 1, 0.08));
      }
      sheet.each(x, top, 2, 30, (px, py) => steel(px === x ? 0.64 : 0.34, px, py, 0.04));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Doors                                                               */
/* ------------------------------------------------------------------ */

function doorway(sheet: Raster, layout: Layout, door: Doorway): void {
  const base = door.level === 0 ? layout.floor : layout.decks[door.level - 1]!;
  const top = base - DOOR_HEIGHT;
  const { x } = door;

  // The frame stands proud of the wall.
  sheet.each(x, top, DOOR_WIDTH, DOOR_HEIGHT, (px, py) => {
    const u = px - x;
    const v = py - top;
    const edge = Math.min(u, DOOR_WIDTH - 1 - u, v);
    if (edge > 3) return NONE;
    const lit = u === 0 || v === 0 ? 0.74 : edge === 3 ? 0.2 : u === DOOR_WIDTH - 1 ? 0.3 : 0.56;
    return steel(lit, px, py, 0.02);
  });
  sheet.shade(x + DOOR_WIDTH, top + 2, 2, DOOR_HEIGHT - 2, 0.6);

  const inner = { x: x + 4, y: top + 4, width: DOOR_WIDTH - 8, height: DOOR_HEIGHT - 4 };
  // How much of the opening each leaf still covers.
  const gap = door.state === 'open' ? inner.width - 4 : door.state === 'ajar' ? 8 : 0;
  sheet.each(inner.x, inner.y, inner.width, inner.height, (px, py) => {
    const u = px - inner.x;
    const v = py - inner.y;
    const leaf = inner.width - gap;
    if (u >= leaf) {
      // Darkness beyond, and a little of the floor inside.
      return tone(STEEL, v > inner.height - 5 ? 0.12 : 0.02, px, py, 0.4);
    }
    let level = 0.44 + (cloud(px / 14, py / 20, 101 + x) - 0.5) * 0.24;
    if (u === leaf - 1) level -= 0.22;
    if (u === 0) level += 0.1;
    // Ribs pressed into the leaf, and a slit to look through.
    if (v % 19 === 18) level -= 0.2;
    else if (v % 19 === 0) level += 0.1;
    if (leaf > 12 && v >= 9 && v < 13 && u >= 5 && u < Math.min(leaf - 3, 17)) return tone(STEEL, v === 9 ? 0.02 : 0.1, px, py, 0.3);
    return steel(level, px, py, v > inner.height - 14 ? 0.1 : 0);
  });
  // The sill, striped.
  sheet.each(x, base - 2, DOOR_WIDTH, 2, (px, py) => (((px - x + (py - base)) >> 2) & 1 ? tone(YELLOW, 0.5, px, py) : tone(STEEL, 0.12, px, py)));

  // The lamp over it.
  const lampX = x + DOOR_WIDTH / 2 - 3;
  sheet.each(lampX - 1, top - 7, 8, 2, (px, py) => tone(STEEL, py === top - 7 ? 0.6 : 0.32, px, py));
  sheet.each(lampX, top - 5, 6, 3, (px, py) => tone(door.lit === 'dead' ? STEEL : BRASS, door.lit === 'dead' ? 0.24 : 0.8, px, py));
}

const TEETH = 12;
const ROCK: Ramp = [0x070605, 0x15110c, 0x272016, 0x3d3222, 0x57492f, 0x71603f];

/** How the light from above and from the left meets an edge that faces a given way. */
function facing(angle: number): number {
  return -(Math.cos(angle) * 0.55 + Math.sin(angle) * 0.83);
}

/** Where the great door sits: the collar bolted to the wall, the rail it rolls on, and behind it the way out. */
function socket(sheet: Raster, layout: Layout): void {
  const { x: cx, y: cy } = layout.gear;

  // The rail, toothed to take the door's own teeth.
  sheet.each(cx - ROLL - GEAR - 6, layout.floor - 1, ROLL + GEAR * 2 + 12, 3, (x, y) => tone(STEEL, y === layout.floor - 1 ? ((x >> 1) & 1 ? 0.52 : 0.22) : 0.1, x, y, 0.3));

  // The collar, bolted to the wall.
  sheet.disc(
    cx,
    cy,
    GEAR + 11,
    (distance, angle, x, y) => {
      const depth = distance - (GEAR + 4);
      let level = 0.52 + facing(angle) * (depth > 5.5 ? 0.2 : depth < 1.2 ? -0.24 : 0.04);
      const bolt = ((angle / TWO_PI) * 24 + 48.5) % 1;
      if (depth > 2 && depth < 5 && Math.abs(bolt - 0.5) < 0.09) level += 0.26;
      return steel(level, x, y, 0.03 + (y > cy ? 0.05 : 0));
    },
    GEAR + 4,
  );

  // Through it, the tunnel that leads out: rock, a pair of rails, and darkness that deepens towards the far end.
  const farX = cx + 24;
  const farY = cy + 4;
  sheet.disc(cx, cy, GEAR + 4, (distance, angle, x, y) => {
    // The bore through the wall. Its lower half faces the light, its upper half does not.
    if (distance > GEAR - 1) return steel(0.3 - facing(angle) * 0.2, x, y, 0.08);
    const deep = Math.max(0, 1 - Math.hypot(x - farX, (y - farY) * 1.2) / 78);
    const down = y - farY - 16;
    if (down > Math.abs(x - farX) * 0.22) {
      // The floor of the tunnel, and the rails running away along it.
      if (Math.abs(Math.abs(x - farX) - down * 0.62) < 0.75) return tone(STEEL, 0.62 - deep * 0.5, x, y, 0.4);
      return tone(ROCK, 0.74 - deep * 0.7 + (cloud(x / 9, y / 3, 317) - 0.5) * 0.3, x, y, 0.7);
    }
    // Rock, rough-hewn: lighter where a face of it is turned towards the hall.
    return tone(ROCK, 0.66 - deep * 0.72 + (cloud(x / 6, y / 5, 311) - 0.5) * 0.5 + (noise(x / 2.5, y / 2, 313) > 0.72 ? 0.12 : 0), x, y, 0.7);
  });
  // The far end, where it is daytime: a scrap of sky over a scrap of sand.
  for (let v = -3; v <= 2; v++) {
    const half = v < -1 ? 4 + v : 3;
    for (let u = -half; u <= half; u++) sheet.dot(farX + u, farY + v, v > 0 || (v === 0 && u < 0) ? tone(BRASS, 0.7 + u * 0.03, farX + u, farY + v) : tone(BONE, 0.86, farX + u, farY + v, 0.5));
  }
  // Somebody did not get far. Whoever he was, he has been lying out there for a long time.
  const bone = (level: number) => (_a: number, _b: number, px: number, py: number) => tone(BONE, level, px, py, 0.4);
  sheet.stroke(cx + 10, cy + 38, cx + 12, cy + 38, 3.2, bone(0.6));
  sheet.dot(cx + 10, cy + 38, STEEL[0]!);
  sheet.stroke(cx + 14, cy + 39, cx + 20, cy + 40, 1.4, bone(0.5));
  sheet.dot(cx + 16, cy + 38, tone(BONE, 0.5, 0, 0));
  sheet.dot(cx + 18, cy + 38, tone(BONE, 0.5, 0, 0));
  sheet.stroke(cx + 21, cy + 40, cx + 25, cy + 41, 1.2, bone(0.44));

  // The fitting of the warning lamp that still turns over the door.
  const lampX = cx + 8;
  const lampY = cy - GEAR - 8;
  sheet.each(lampX - 5, lampY - 2, 10, 3, (x, y) => steel(y === lampY - 2 ? 0.66 : 0.34, x, y));
  sheet.each(lampX - 3, lampY + 1, 6, 3, (x, y) => tone(BRASS, 0.8, x, y));
  sheet.each(lampX - 4, lampY + 4, 8, 1, (x, y) => tone(STEEL, 0.2, x, y));
}

/**
 * The great door itself: a cogwheel of steel as tall as two men, on a sheet
 * of its own so that it can roll. Its teeth, its bolts and its number turn
 * with it; the light it stands in does not.
 */
export function paintCog(turn = 0): Raster {
  const middle = GEAR + 1;
  const sheet = new Raster(middle * 2 + 1, middle * 2 + 1);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const number = new Raster(21, 15);
  number.text(0, 0, '13', 0xffffff, 3);

  sheet.disc(middle, middle, GEAR, (distance, angle, x, y) => {
    // Where this spot is on the door itself, however far the door has turned.
    const own = angle - turn;
    const ox = (x - middle) * cos + (y - middle) * sin;
    const oy = (y - middle) * cos - (x - middle) * sin;

    const at = ((own / TWO_PI) * TEETH + TEETH * 4 + 0.25) % 1;
    const tooth = at < 0.5;
    const rim = tooth ? GEAR : GEAR - 8;
    if (distance > rim) return NONE;
    let level = 0.5 + (cloud(ox / 33 + 9, oy / 33 + 9, 131) - 0.5) * 0.26;
    // Rim and flanks of the teeth catch or lose the light.
    if (rim - distance < 1.6) level += facing(angle) * 0.3;
    else if (tooth && distance > GEAR - 8) {
      const flank = Math.min(at, 0.5 - at) * ((TWO_PI * distance) / TEETH);
      if (flank < 1.3) level += (at < 0.25 ? facing(angle - Math.PI / 2) : facing(angle + Math.PI / 2)) * 0.26;
    }
    // A groove, then a raised ring carrying the bolts, then the hub.
    if (Math.abs(distance - (GEAR - 13)) < 0.9) level -= 0.22 - facing(angle) * 0.1;
    if (distance < GEAR - 19 && distance > GEAR - 29) {
      level += 0.07;
      if (GEAR - 19 - distance < 1.2) level += facing(angle) * 0.22;
      if (distance - (GEAR - 29) < 1.2) level -= facing(angle) * 0.22;
      const bolt = ((own / TWO_PI) * 12 + 48.5) % 1;
      if (Math.abs(distance - (GEAR - 24)) < 2 && Math.abs(bolt - 0.5) < 0.1) level += distance < GEAR - 24 ? 0.24 : -0.2;
    }
    if (distance < GEAR - 29 && distance > 18) {
      // Spokes between ring and hub.
      const spoke = ((own / TWO_PI) * 6 + 24.5) % 1;
      const off = Math.abs(spoke - 0.5) * ((TWO_PI * distance) / 6);
      level += off < 2.2 ? 0.1 + (off > 1.4 ? facing(angle + (spoke < 0.5 ? -1 : 1) * (Math.PI / 2)) * 0.2 : 0) : -0.1;
    }
    if (distance <= 18) {
      level += 0.05;
      if (18 - distance < 1.3) level += facing(angle) * 0.26;
      // Its number, in paint that has mostly held.
      if (number.at(Math.round(ox + 10), Math.round(oy + 7)) !== NONE && cloud(ox / 4 + 40, oy / 5 + 40, 149) > 0.3) {
        return tone(YELLOW, 0.62 + (hash(Math.round(ox), Math.round(oy), 3) - 0.5) * 0.2, x, y);
      }
    }
    return steel(level, ox + 300, oy + 300, 0.02 + (y - middle) / 900 + (distance > GEAR - 12 ? 0.04 : 0));
  });
  return sheet;
}

/** The number of the vault stencilled on the floor before its door, behind the line nobody was to stand beyond. */
function threshold(sheet: Raster, layout: Layout): void {
  const left = layout.gear.x + 12;
  const top = layout.floor + 19;
  const digits = new Raster(7, 5);
  digits.text(0, 0, '13', 0xffffff);
  for (let v = 0; v < 5; v++) {
    for (let u = 0; u < 7; u++) {
      if (digits.at(u, v) === NONE) continue;
      // Three wide and two deep to a dot: it lies on the floor, and the eye is not far above it.
      sheet.each(left + u * 3, top + v * 2, 3, 2, (x, y) => (cloud(x / 5, y / 3, 331) > 0.34 ? tone(YELLOW, 0.46 + (hash(x, y, 337) - 0.5) * 0.2, x, y) : NONE));
    }
  }
  sheet.each(layout.gear.x - GEAR, layout.floor + 14, GEAR * 2, 2, (x, y) => {
    if (cloud(x / 7, y, 341) < 0.4) return NONE;
    return ((x + y) >> 2) & 1 ? tone(YELLOW, 0.42, x, y) : tone(STEEL, 0.1, x, y);
  });
}

/* ------------------------------------------------------------------ */
/* What was left behind                                                */
/* ------------------------------------------------------------------ */

/** Three words somebody wrote on the wall, in paint that ran. */
function graffiti(sheet: Raster, layout: Layout): void {
  if (!layout.graffiti) return;
  const { x, y, scale } = layout.graffiti;
  // The fitting of the tube above them.
  const tube = x + 14 * scale;
  sheet.each(tube - 9, y - 7, 18, 2, (px, py) => steel(py === y - 7 ? 0.64 : 0.3, px, py));
  sheet.each(tube - 7, y - 5, 14, 2, (px, py) => tone(BONE, 0.7, px, py));
  const paint = (px: number, py: number) => (cloud(px / 5, py / 4, 163) > 0.2 ? tone(RED, 0.62 + (hash(px, py, 167) - 0.5) * 0.2, px, py) : NONE);
  ['WAR', 'NEVER', 'CHANGES'].forEach((word, line) => {
    [...word].forEach((letter, index) => {
      // No two letters stand quite level.
      const lx = x + index * 4 * scale + (line === 0 ? scale : 0);
      const ly = y + line * 6 * scale + Math.round((hash(index, line, 173) - 0.5) * 0.9 * scale);
      sheet.text(lx, ly, letter, paint, scale);
      if (hash(index, line, 179) > 0.62) {
        const run = 2 + Math.floor(hash(index, line, 181) * 5 * scale);
        for (let i = 0; i < run; i++) sheet.dot(lx + scale, ly + 5 * scale + i, tone(RED, 0.5 - i * 0.02, lx, ly + i), 0.85 - i / (run * 1.4));
      }
    });
  });
}

/** Cables slung between the pipe straps, sagging more every decade. */
function cables(sheet: Raster, layout: Layout): void {
  const middle = Math.round(layout.width / 2);
  for (let x = ((middle + 48) % 96) - 96; x < layout.width; x += 96) {
    const from = Math.round((x - middle) / 96);
    if (hash(from, 0, 191) < 0.35) continue;
    const sag = 5 + hash(from, 1, 193) * 15;
    for (let i = 0; i <= 96; i++) {
      const t = i / 96;
      const y = Math.round(31 + sag * 4 * t * (1 - t));
      sheet.dot(x + i, y, tone(STEEL, 0.07, x + i, y, 0.3));
      if (hash(x + i, y, 197) > 0.8) sheet.dot(x + i, y - 1, tone(STEEL, 0.3, x + i, y, 0.3));
    }
  }
}

/** The casing of the wall monitor. What it shows is drawn when the picture is put together. */
function monitor(sheet: Raster, layout: Layout): void {
  if (!layout.monitor) return;
  const { x, y } = layout.monitor;
  const { width, height, screen } = MONITOR;
  // The arm that clamps it to the big pipe.
  sheet.each(x + width / 2 - 3, 20, 6, y - 20, (px, py) => steel(px === x + width / 2 - 3 ? 0.6 : px === x + width / 2 + 2 ? 0.2 : 0.4, px, py));
  sheet.each(x + width / 2 - 5, 18, 10, 3, (px, py) => steel(py === 18 ? 0.66 : 0.34, px, py));
  sheet.each(x, y, width, height, (px, py) => {
    const u = px - x;
    const v = py - y;
    // Corners knocked off.
    if ((u === 0 || u === width - 1) && (v === 0 || v === height - 1)) return NONE;
    const inside = u >= screen.x - 1 && u <= screen.x + screen.width && v >= screen.y - 1 && v <= screen.y + screen.height;
    if (inside) {
      // The well the glass sits in, and the glass itself with the room in it.
      if (u === screen.x - 1 || v === screen.y - 1) return tone(STEEL, 0.03, px, py, 0.3);
      if (u === screen.x + screen.width || v === screen.y + screen.height) return tone(STEEL, 0.3, px, py, 0.3);
      return tone(PHOSPHOR, u + v < 15 && u + v > 11 ? 0.2 : 0.02, px, py, 0.4);
    }
    const level = v === 0 || u === 0 ? 0.62 : v === height - 1 || u === width - 1 ? 0.2 : 0.42;
    return steel(level + (cloud(px / 12, py / 9, 223) - 0.5) * 0.14, px, py, 0.03);
  });
  // Its shadow on the wall.
  sheet.shade(x + 3, y + height, width - 2, 3, 0.62);
}

/** One of the dwellers never left: still in the blue suit, slumped where the wall meets the floor. */
function skeleton(sheet: Raster, layout: Layout): void {
  const x = layout.skeleton + 12;
  const y = layout.floor + 2;
  const bone = (level: number) => (_a: number, across: number, px: number, py: number) => tone(BONE, level - across * 0.12, px, py, 0.4);
  const suit = (level: number) => (_a: number, across: number, px: number, py: number) => tone(BLUE, level - across * 0.14, px, py, 0.4);
  // Shadow where it rests against the plates.
  sheet.shade(x - 9, y - 15, 22, 16, 0.76);
  // One leg out along the floor, the other with its knee drawn up.
  sheet.stroke(x - 2, y - 1, x - 10, y + 2, 3.4, suit(0.44));
  sheet.stroke(x - 10, y + 2, x - 16, y + 4, 2, bone(0.6));
  sheet.box(x - 19, y + 3, 3, 3, STEEL[2]!);
  sheet.stroke(x + 3, y - 1, x + 8, y - 7, 3.4, suit(0.36));
  sheet.stroke(x + 8, y - 7, x + 10, y + 3, 2, bone(0.52));
  sheet.box(x + 9, y + 4, 4, 2, STEEL[2]!);
  // One arm in its lap, the other fallen to the floor.
  sheet.stroke(x + 6, y - 10, x + 10, y - 2, 2, suit(0.38));
  sheet.stroke(x + 10, y - 2, x + 12, y + 2, 1.6, bone(0.5));
  // Chest sunk sideways, and the ribs showing where the cloth has gone.
  sheet.stroke(x, y - 2, x + 2, y - 10, 9, suit(0.5));
  for (let rib = 0; rib < 3; rib++) {
    sheet.box(x + 2, y - 10 + rib * 2, 3, 1, BONE[4]!);
    sheet.dot(x + 2, y - 9 + rib * 2, STEEL[1]!);
  }
  for (let i = 0; i < 8; i++) if (hash(i, 0, 229) > 0.3) sheet.dot(x - 3 + Math.round(i / 4), y - 3 - i, tone(YELLOW, 0.5, x, y - i));
  sheet.stroke(x - 3, y - 9, x - 4, y - 3, 2, suit(0.46));
  sheet.stroke(x - 4, y - 3, x - 1, y - 1, 1.6, bone(0.6));
  // The skull, fallen forward onto the shoulder.
  sheet.stroke(x + 4, y - 15, x + 5, y - 14, 6.6, bone(0.74));
  sheet.stroke(x + 5, y - 12, x + 6, y - 11, 4, bone(0.62));
  sheet.dot(x + 3, y - 15, STEEL[0]!);
  sheet.dot(x + 6, y - 14, STEEL[0]!);
  sheet.dot(x + 2, y - 15, STEEL[1]!);
  sheet.dot(x + 7, y - 14, STEEL[1]!);
  sheet.dot(x + 4, y - 13, STEEL[1]!);
  sheet.box(x + 4, y - 11, 3, 1, STEEL[2]!);
}

/** A row of lockers, one of them hanging open. */
function lockers(sheet: Raster, layout: Layout): void {
  const top = layout.floor - 50;
  for (let n = 0; n < 3; n++) {
    const x = layout.lockers + n * 16;
    const open = n === 1;
    sheet.each(x, top, 16, 50, (px, py) => {
      const u = px - x;
      const v = py - top;
      if (v < 2) return steel(v === 0 ? 0.7 : 0.4, px, py);
      if (u === 0) return steel(0.62, px, py, 0.03);
      if (u === 15) return steel(0.16, px, py);
      if (open) {
        // Nothing inside but a shelf and the dark; its door has swung round against the next one.
        if (u > 11) return steel(0.5 - (u - 12) * 0.08, px, py, 0.05);
        return tone(STEEL, v === 14 || v === 30 ? 0.24 : 0.04, px, py, 0.3);
      }
      let level = 0.52 + (cloud(px / 10, py / 14, 233 + n) - 0.5) * 0.2;
      // Slits to let the air in, a plate for a name, a handle.
      if (v >= 6 && v <= 12 && v % 2 === 0 && u >= 4 && u <= 11) level = 0.1;
      if (v >= 17 && v <= 19 && u >= 5 && u <= 10) level += v === 17 ? 0.22 : 0.1;
      if (v >= 26 && v <= 30 && u >= 11 && u <= 12) level = u === 11 ? 0.74 : 0.14;
      return steel(level, px, py, v > 38 ? 0.1 : 0.02);
    });
  }
  sheet.shade(layout.lockers + 48, top + 3, 3, 47, 0.6);
}

/** Crates nobody came back for, and on one of them a case worth crossing the wasteland for. */
function crates(sheet: Raster, layout: Layout): void {
  const base = layout.floor + 5;
  const crate = (x: number, width: number, height: number, seed: number) => {
    sheet.shade(x + width, base - height + 3, 3, height - 3, 0.6);
    sheet.each(x, base - height, width, height, (px, py) => {
      const u = px - x;
      const v = py - (base - height);
      const edge = Math.min(u, width - 1 - u, v, height - 1 - v);
      let level = 0.42 + (cloud(px / 3, py / 11, seed) - 0.5) * 0.3;
      // Boards, a frame round them, and a brace across.
      if (edge < 2) level = edge === 0 ? (u === 0 || v === 0 ? 0.66 : 0.2) : 0.52;
      else if (u % 5 === 0) level -= 0.2;
      else if (Math.abs(u * (height / width) - v) < 1.2) level += 0.14;
      return tone(BRASS, level * 0.72, px, py, 0.6);
    });
  };
  crate(layout.crates, 30, 20, 239);
  crate(layout.crates + 33, 22, 15, 241);

  // The case: brushed steel, a handle, and four letters.
  const x = layout.crates + 4;
  const y = base - 20 - 11;
  sheet.each(x, y, 22, 11, (px, py) => {
    const u = px - x;
    const v = py - y;
    if ((u === 0 || u === 21) && (v === 0 || v === 10)) return NONE;
    const level = v === 0 ? 0.92 : v === 10 ? 0.4 : u === 0 ? 0.84 : u === 21 ? 0.46 : v === 5 ? 0.6 : 0.74;
    return tone(STEEL, level, px, py, 0.4);
  });
  sheet.box(x + 8, y - 2, 6, 1, STEEL[9]!);
  sheet.dot(x + 8, y - 1, STEEL[6]!);
  sheet.dot(x + 13, y - 1, STEEL[6]!);
  sheet.text(x + 4, y + 3, 'GECK', STEEL[1]!);
  sheet.dot(x + 19, y + 2, PHOSPHOR[3]!);
}

/** The purifier's fault panel. The lamp on it is lit when the picture is put together. */
function panel(sheet: Raster, layout: Layout): void {
  const { x, y } = layout.panel;
  // The conduit that feeds it.
  sheet.each(x + 6, y + 17, 2, layout.floor - y - 17, (px, py) => tone(STEEL, px === x + 6 ? 0.4 : 0.16, px, py));
  sheet.each(x, y, 46, 17, (px, py) => {
    const u = px - x;
    const v = py - y;
    const edge = Math.min(u, 45 - u, v, 16 - v);
    if (edge === 0) return steel(u === 0 || v === 0 ? 0.7 : 0.22, px, py);
    return tone(BONE, 0.5 + (cloud(px / 9, py / 6, 251) - 0.5) * 0.24, px, py, 0.5);
  });
  sheet.text(x + 3, y + 2, 'WATER CHIP', STEEL[1]!);
  sheet.text(x + 3, y + 9, 'FAULT', RED[2]!);
  sheet.box(x + 37, y + 9, 5, 5, STEEL[1]!);
  sheet.box(x + 38, y + 10, 3, 3, RED[1]!);
  sheet.shade(x + 2, y + 17, 46, 2, 0.66);
}

/** What the panel reads for as long as a thump has put the purifier right: a patch to lay over its second line. */
export function paintMended(layout: Layout): Raster {
  const { x, y } = layout.panel;
  const sheet = new Raster(20, 5);
  sheet.each(0, 0, 20, 5, (u, v) => tone(BONE, 0.5 + (cloud((x + 3 + u) / 9, (y + 9 + v) / 6, 251) - 0.5) * 0.24, x + 3 + u, y + 9 + v, 0.5));
  sheet.text(0, 0, 'OKAY', PHOSPHOR[1]!);
  return sheet;
}

/** The fittings of the emergency lights low on the wall. */
function footlights(sheet: Raster, layout: Layout): void {
  for (const x of layout.footlights) {
    const y = layout.floor - 14;
    sheet.each(x - 4, y - 2, 8, 3, (px, py) => steel(py === y - 2 ? 0.66 : px === x - 4 ? 0.5 : 0.3, px, py));
    sheet.each(x - 2, y + 1, 4, 3, (px, py) => tone(BRASS, 0.8, px, py));
  }
}

/** Where the dripping joint has been at the wall: scale on the pipe, a wet streak below. */
function stain(sheet: Raster, layout: Layout): void {
  const { x, from, to } = layout.drip;
  for (let y = from; y < to; y++) {
    const wander = Math.round(Math.sin(y / 9) * 1.2);
    sheet.shade(x - 1 + wander, y, 3, 1, 0.72 + hash(x, y, 257) * 0.1);
    if (hash(x, y, 263) > 0.86) sheet.dot(x + wander + (hash(y, x, 269) > 0.5 ? 2 : -2), y, tone(BONE, 0.5, x, y), 0.5);
  }
  sheet.each(x - 2, from - 7, 5, 7, (px, py) => (hash(px, py, 271) > 0.4 ? tone(PHOSPHOR, 0.3 + hash(px, py, 277) * 0.3, px, py) : NONE));
}

/* ------------------------------------------------------------------ */
/* Putting it together                                                 */
/* ------------------------------------------------------------------ */

/** Everything that things walk in front of. */
export function paintBack(layout: Layout): Raster {
  const sheet = new Raster(layout.width, layout.height);
  wall(sheet, layout);
  floor(sheet, layout);
  threshold(sheet, layout);
  graffiti(sheet, layout);
  stain(sheet, layout);
  socket(sheet, layout);
  footlights(sheet, layout);
  lockers(sheet, layout);
  panel(sheet, layout);
  galleries(sheet, layout);
  for (const door of layout.doorways) doorway(sheet, layout, door);
  skeleton(sheet, layout);
  crates(sheet, layout);
  ceiling(sheet, layout);
  cables(sheet, layout);
  monitor(sheet, layout);
  return sheet;
}

/** Everything that things walk behind. */
export function paintFront(layout: Layout): Raster {
  const sheet = new Raster(layout.width, layout.height);
  railings(sheet, layout);
  return sheet;
}

/* ------------------------------------------------------------------ */
/* Light                                                               */
/* ------------------------------------------------------------------ */

/** How much of a lamp's light reaches a spot, measured from the lamp: from 0 to 1. */
export function lightAt(lamp: Lamp, dx: number, dy: number): number {
  const distance = Math.hypot(dx, dy);
  if (lamp.shape === 'round') return Math.max(0, 1 - distance / lamp.reach) ** 1.7;
  // A lamp on a wall glows a little all round, and lights a widening cone below itself.
  const glow = Math.max(0, 1 - distance / 24) ** 2;
  if (dy <= 0) return glow;
  const spread = Math.max(0, 1 - Math.abs(dx) / (dy * 1.05 + 14));
  const cone = Math.max(0, 1 - distance / lamp.reach) ** 1.25 * spread ** 0.7 * Math.min(1, dy / 6);
  return Math.max(glow, cone);
}

/** What one lamp adds to the hall: a patch of light to lay over the darkness. */
export function paintLight(lamp: Lamp): Raster {
  const size = lamp.reach * 2 + 1;
  const sheet = new Raster(size, size);
  const red = lamp.ink >> 16;
  const green = (lamp.ink >> 8) & 255;
  const blue = lamp.ink & 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Light falls off in steps, as it does in a picture of few colours.
      const amount = Math.round(lightAt(lamp, x - lamp.reach, y - lamp.reach) * 18 + (hash(x, y, 201) - 0.5) * 0.9) / 18;
      if (amount <= 0) continue;
      const i = (y * size + x) * 4;
      sheet.data[i] = red * amount;
      sheet.data[i + 1] = green * amount;
      sheet.data[i + 2] = blue * amount;
      sheet.data[i + 3] = 255;
    }
  }
  return sheet;
}

/** The glow of the console's own tube on what stands behind it. */
export function paintSpill(layout: Layout): Raster {
  const sheet = new Raster(layout.width, layout.height);
  const box = layout.console;
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
      const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
      const amount = Math.round(Math.max(0, 1 - Math.hypot(dx, dy) / 64) ** 2 * 10 + (hash(x, y, 211) - 0.5) * 0.9) / 10;
      if (amount <= 0) continue;
      const i = (y * layout.width + x) * 4;
      sheet.data[i] = 14 * amount;
      sheet.data[i + 1] = 56 * amount;
      sheet.data[i + 2] = 28 * amount;
      sheet.data[i + 3] = 255;
    }
  }
  return sheet;
}

