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

/** Members of a C enum, by name (or, for one without a name, by a member it has), counting as the compiler does. */
function enumValues(text, name) {
  const start = name.startsWith('=')
    ? text.lastIndexOf('enum', text.indexOf(`${name.slice(1)} `))
    : text.search(new RegExp(`enum (class )?${name}\\b[^{]*\\{`));
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

// What the engines know of the world by heart: global variables they read by
// number, and the tables of them that Fallout 1 carries where Fallout 2 reads
// a file of the game's (quests.txt, holodisk.txt, karmavar.txt).
const fo1Gvars = enumValues(read(`${fo1}/game_vars.h`), 'GameGlobalVar');
const fo2Gvars = enumValues(read(`${fo2}/game_vars.h`), 'GameGlobalVar');
const fo2Cities = enumValues(read(`${fo2}/worldmap.h`), 'City');
const fo1Items = enumValues(read(`${fo1}/proto_types.h`), '=PROTO_ID_POWER_ARMOR');
const fo2Items = enumValues(read(`${fo2}/proto_types.h`), 'ItemProtoTypeId');

/** The members of a plain array initializer, `name[...] = { a, b, ... };`, by what `token` makes of each. */
function members(text, marker, token) {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`no table ${marker}`);
  const open = text.indexOf('{', start + marker.length);
  let depth = 0;
  let end = open;
  for (; end < text.length; end++) {
    if (text[end] === '{') depth++;
    if (text[end] === '}' && --depth === 0) break;
  }
  const body = text.slice(open + 1, end).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rows = [];
  for (const match of body.matchAll(/\{([^{}]*)\}/g)) rows.push(match[1].split(',').map((t) => t.trim()).filter(Boolean).map(token));
  return rows.length ? rows : [body.split(',').map((t) => t.trim()).filter(Boolean).map(token)];
}

const lookup = (map, label) => (name) => {
  if (/^-?\d+$/.test(name)) return Number(name);
  const value = map.get(name);
  if (value === undefined) throw new Error(`unknown ${label} ${name}`);
  return value;
};
const fo1Gvar = lookup(fo1Gvars, 'variable');
const fo2Gvar = lookup(fo2Gvars, 'variable');
const fo2City = lookup(fo2Cities, 'city');
const skilldexId = (name) => lookup(skilldex, 'picture')(name.replace(/^SkillDexFrameId::/, ''));
const fo1Item = lookup(fo1Items, 'item');
const fo2Item = (name) => {
  const match = /ItemProtoTypeId::(\w+)/.exec(name);
  if (!match) throw new Error(`cannot read item ${name}`);
  return lookup(fo2Items, 'item')(match[1]);
};

const fo1Pipboy = read(`${fo1}/pipboy.cc`);
const fo1Quests = members(fo1Pipboy, 'sthreads[QUEST_LOCATION_COUNT][QUEST_PER_LOCATION_COUNT] =', fo1Gvar).map((row) => row.filter((gvar) => gvar !== 0));
const fo1Holodisks = members(fo1Pipboy, 'holodisks[HOLODISK_COUNT] =', fo1Gvar)[0];
const fo1Editor = read(`${fo1}/editor.cc`);
const fo1KarmaVars = members(fo1Editor, 'karma_var_table[9] =', fo1Gvar)[0];
const fo1KarmaPictures = members(fo1Editor, 'karma_pic_table[10] =', Number)[0];
const fo1Worldmap = read(`${fo1}/worldmap.cc`);
const fo1Towns = members(fo1Worldmap, 'cityXgvar[12] =', Number)[0];
const fo1Item_ = read(`${fo1}/item.cc`);
const fo1DrugGvars = members(fo1Item_, 'drug_gvar[7] =', fo1Gvar)[0];
const fo1DrugPids = members(fo1Item_, 'drug_pid[7] =', fo1Item)[0];
const fo2Editor = read(`${fo2}/character_editor.cc`);
const fo2TownReputations = members(fo2Editor, 'gTownReputationEntries[TOWN_REPUTATION_COUNT] =', (t) => (t.startsWith('GVAR_') ? fo2Gvar(t) : fo2City(t)));
const fo2Addictions = members(fo2Editor, 'gAddictionReputationVars[ADDICTION_REPUTATION_COUNT] =', fo2Gvar)[0];
const fo2AddictionPictures = members(fo2Editor, 'gAddictionReputationFrmIds[ADDICTION_REPUTATION_COUNT] =', skilldexId)[0];
const fo2Drugs = members(read(`${fo2}/item.cc`), 'gDrugDescriptions[ADDICTION_COUNT] =', (t) => (t.startsWith('ProtoId(') ? fo2Item(t) : t.startsWith('GVAR_') ? fo2Gvar(t) : Number(t)));

const check = (label, list, count, width) => {
  if (list.length !== count) throw new Error(`${label}: ${list.length} rows, expected ${count}`);
  if (width && list.some((row) => row.length !== width)) throw new Error(`${label}: a row is not ${width} wide`);
};
check('fo1 quest places', fo1Quests, 12);
check('fo1 holodisks', fo1Holodisks, 18);
check('fo1 karma', fo1KarmaVars, 9);
check('fo1 karma pictures', fo1KarmaPictures, 10);
check('fo1 towns', fo1Towns, 12);
check('fo1 drugs', fo1DrugPids, 7);
check('fo1 drug variables', fo1DrugGvars, 7);
check('fo2 town reputations', fo2TownReputations, 19, 2);
check('fo2 addictions', fo2Addictions, 8);
check('fo2 addiction pictures', fo2AddictionPictures, 8);
check('fo2 drugs', fo2Drugs, 9, 3);
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
 * sources (fallout1-ce: game/perk.cc, skill.cc, trait.cc, stat.cc,
 * pipboy.cc, editor.cc, worldmap.cc, item.cc, game_vars.h; fallout2-ce:
 * perk.cc, skill.cc, trait.cc, stat.cc, character_editor.cc, item.cc,
 * game_vars.h) by engines/lib/rule-tables.mjs, not to be edited by hand.
 * What the numbers mean is said in rules.ts and world.ts, which read them.
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

/**
 * Fallout 1's Pip-Boy, which knows its quests by heart: for each of its
 * twelve places (pipboy.msg 700 + 10 x place names it), the global variables
 * of its quests (701 + 10 x place + quest describes each). 0 hides a quest, 1
 * shows it, 2 and more show it done.
 */
export const FO1_QUESTS: readonly (readonly number[])[] = [
${list(fo1Quests)}
];

/** Fallout 1's holodisks: the global variable that gives each (pipboy.msg 400 + its place here names it). */
export const FO1_HOLODISKS: readonly number[] = ${flat(fo1Holodisks)};

/** Fallout 1's karma: the variable, then the titles its character screen lists (editor.msg 1001 + place), three reputations and six addictions. */
export const FO1_KARMA_VARIABLE = ${fo1Gvar('GVAR_PLAYER_REPUATION')};
export const FO1_KARMA_TITLES: readonly number[] = ${flat(fo1KarmaVars)};
/** Their pictures, karma's own first. */
export const FO1_KARMA_PICTURES: readonly number[] = ${flat(fo1KarmaPictures)};

/** Fallout 1's towns: the variable that is 1 once each is known (map.msg 500 + town names it). */
export const FO1_TOWN_VARIABLES: readonly number[] = ${flat(fo1Towns)};

/** Fallout 1's water: the days the vault has left, and the quest that ends the count at 2. */
export const FO1_VAULT_WATER = ${fo1Gvar('GVAR_VAULT_WATER')};
export const FO1_FIND_WATER_CHIP = ${fo1Gvar('GVAR_FIND_WATER_CHIP')};

/** Drugs a character can be addicted to: [item, addiction variable]. */
export const FO1_DRUGS: readonly (readonly number[])[] = [
${list(fo1DrugPids.map((pid, index) => [pid, fo1DrugGvars[index]]))}
];

export const FO2_DRUGS: readonly (readonly number[])[] = [
${list(fo2Drugs.map(([pid, gvar]) => [pid, gvar]))}
];

/** Fallout 2's karma variable; its titles and their thresholds are the game's own (karmavar.txt, genrep.txt). */
export const FO2_KARMA_VARIABLE = ${fo2Gvar('GVAR_PLAYER_REPUTATION')};

/** Fallout 2's town reputations, unless the game names its own: [variable, area]. */
export const FO2_TOWN_REPUTATIONS: readonly (readonly number[])[] = [
${list(fo2TownReputations)}
];

/** Fallout 2's addictions as its character screen lists them (editor.msg 1004 + place): variable, and picture. */
export const FO2_ADDICTIONS: readonly number[] = ${flat(fo2Addictions)};
export const FO2_ADDICTION_PICTURES: readonly number[] = ${flat(fo2AddictionPictures)};
`,
);
console.log('written', out);
