#!/usr/bin/env node
/**
 * Writes the engines' rule tables (perks, skills, traits, statistics) as the
 * TypeScript module the save editor reads them from.
 *
 *   node engines/lib/rule-tables.mjs [.cache/engines] [src/lib/modify/tables.ts]
 *
 * Reads the engines' sources where engines/build.sh checks them out, so run
 * a build first. Run it again when an engine moves to a newer commit, and
 * look at what changed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [root = '.cache/engines', out = 'src/lib/modify/tables.ts'] = process.argv.slice(2);
const fo1 = `${root}/fo1/src/src/game`;
const fo2 = `${root}/fo2/src/src`;
const read = (path) => readFileSync(path, 'latin1');

/** Members of a C enum, by name, counting as the compiler does. */
function enumValues(text, name) {
  const start = text.search(new RegExp(`enum (class )?${name}\\b[^{]*\\{`));
  if (start < 0) throw new Error(`no enum ${name}`);
  const body = text.slice(text.indexOf('{', start) + 1, text.indexOf('};', start));
  const values = new Map();
  let next = 0;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim().replace(/,$/, '');
    if (!line) continue;
    const [key, value] = line.split('=').map((part) => part.trim());
    if (!/^[A-Za-z_]\w*$/.test(key)) continue;
    let number;
    if (value === undefined) number = next;
    else if (/^-?\d+$/.test(value) || /^\(?-?\d+\)?$/.test(value)) number = Number(value.replace(/[()]/g, ''));
    else if (values.has(value)) number = values.get(value);
    else continue;
    values.set(key, number);
    next = number + 1;
  }
  return values;
}

const skilldex = enumValues(read(`${fo2}/art_defs.h`), 'SkillDexFrameId');
const fo2Stats = enumValues(read(`${fo2}/stat_defs.h`), 'Stat');
const fo1Stats = enumValues(read(`${fo1}/stat_defs.h`), 'Stat');
fo1Stats.set('STAT_INVALID', -1); // a #define there

function value(token, stats) {
  token = token.trim();
  if (token.startsWith('SkillDexFrameId::')) {
    const id = skilldex.get(token.slice('SkillDexFrameId::'.length));
    if (id === undefined) throw new Error(`unknown picture ${token}`);
    return id;
  }
  if (token.startsWith('STAT_')) {
    const id = stats.get(token);
    if (id === undefined) throw new Error(`unknown stat ${token}`);
    return id;
  }
  if (token === 'PRIMARY_STAT_MIN') return 1;
  if (token === 'PRIMARY_STAT_MAX') return 10;
  if (token === 'INT_MAX') return 2147483647;
  if (/^-?0x[0-9a-f]+$/i.test(token)) return Number.parseInt(token, 16);
  if (/^-?\d+$/.test(token)) return Number(token);
  throw new Error(`cannot read ${token}`);
}

/** The rows of a table of structs: each `{ ... }` as its numbers, names and NULLs left out. */
function rows(text, marker, stats) {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`no table ${marker}`);
  const open = text.indexOf('{', start + marker.length);
  let depth = 0;
  let end = open;
  for (; end < text.length; end++) {
    if (text[end] === '{') depth++;
    if (text[end] === '}' && --depth === 0) break;
  }
  const body = text.slice(open + 1, end).replace(/\/\/.*$/gm, '');
  const out = [];
  for (const match of body.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const tokens = match[1].replace(/[{}]/g, ',').split(',').map((t) => t.trim()).filter(Boolean);
    out.push(tokens.filter((t) => t !== 'nullptr' && t !== 'NULL').map((t) => value(t, stats)));
  }
  return out;
}

const fo2Perks = rows(read(`${fo2}/perk.cc`), 'gPerkDescriptions[PERK_COUNT] =', fo2Stats);
const fo1PerkRows = rows(read(`${fo1}/perk.cc`), 'perk_data[PERK_COUNT] =', fo1Stats);
// Fallout 1 keeps no picture with a perk: its character screen shows perk number + 72.
const fo1Perks = fo1PerkRows.map(([maxRank, minLevel, stat, mod, skill, skillValue, ...special], perk) => [
  perk + 72, maxRank, minLevel, stat, mod, skill, skillValue, 0, -1, 0, ...special,
]);
const fo2Skills = rows(read(`${fo2}/skill.cc`), 'gSkillDescriptions[SKILL_COUNT] =', fo2Stats);
const fo1Skills = rows(read(`${fo1}/skill.cc`), 'skill_data[SKILL_COUNT] =', fo1Stats);
const fo2Traits = rows(read(`${fo2}/trait.cc`), 'traitDescriptions[TRAIT_COUNT] =', fo2Stats).map(([picture]) => picture);
const fo1Traits = rows(read(`${fo1}/trait.cc`), 'trait_data[TRAIT_COUNT] =', fo1Stats).map(([picture]) => picture);
const fo2StatRows = rows(read(`${fo2}/stat.cc`), 'gStatDescriptions[STAT_COUNT] =', fo2Stats);
const fo1StatRows = rows(read(`${fo1}/stat.cc`), 'stat_data[STAT_COUNT] =', fo1Stats);

const check = (label, list, count, width) => {
  if (list.length !== count) throw new Error(`${label}: ${list.length} rows, expected ${count}`);
  if (width && list.some((row) => row.length !== width)) throw new Error(`${label}: a row is not ${width} wide`);
};
check('fo2 perks', fo2Perks, 119, 17);
check('fo1 perks', fo1Perks, 64, 17);
check('fo2 skills', fo2Skills, 18, 8);
check('fo1 skills', fo1Skills, 18, 8);
check('fo2 traits', fo2Traits, 16);
check('fo1 traits', fo1Traits, 16);
check('fo2 stats', fo2StatRows, 38, 4);
check('fo1 stats', fo1StatRows, 38, 4);

const list = (rows) => rows.map((row) => `  [${row.join(', ')}],`).join('\n');
const flat = (values) => `[${values.join(', ')}]`;

writeFileSync(
  out,
  `/**
 * The rule tables of the two engines, as numbers. Generated from their
 * sources (fallout1-ce: game/perk.cc, skill.cc, trait.cc, stat.cc;
 * fallout2-ce: perk.cc, skill.cc, trait.cc, stat.cc) by
 * engines/lib/rule-tables.mjs, not to be edited by hand. What the numbers
 * mean is said in rules.ts, which reads them.
 */

/**
 * One row per perk: picture (line of skilldex.lst), most ranks (-1: not one
 * to choose), lowest level, stat it changes, by how much per rank, first
 * skill required and its value, how the two skills combine (0: the first,
 * 1: either, 2: both), second skill and its value, then the least of each
 * of S, P, E, C, I, A, L it asks for (for a perk that is not chosen: what it
 * adds to each).
 */
export type PerkRow = readonly number[];

export const FO1_PERKS: readonly PerkRow[] = [
${list(fo1Perks)}
];

export const FO2_PERKS: readonly PerkRow[] = [
${list(fo2Perks)}
];

/**
 * One row per skill: picture, value at nothing spent, stat multiplier, first
 * stat, second stat (-1: none), what a point spent adds, experience for a
 * use, whether a use is limited per day.
 */
export const FO1_SKILLS: readonly (readonly number[])[] = [
${list(fo1Skills)}
];

export const FO2_SKILLS: readonly (readonly number[])[] = [
${list(fo2Skills)}
];

/** The picture of each trait. */
export const FO1_TRAIT_PICTURES: readonly number[] = ${flat(fo1Traits)};
export const FO2_TRAIT_PICTURES: readonly number[] = ${flat(fo2Traits)};

/** One row per stat: picture, least value, most value, value of a new character. */
export const FO1_STATS: readonly (readonly number[])[] = [
${list(fo1StatRows)}
];

export const FO2_STATS: readonly (readonly number[])[] = [
${list(fo2StatRows)}
];
`,
);
console.log('written', out);
