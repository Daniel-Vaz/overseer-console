/**
 * What a game's world is made of, as far as a save holds it: the names of its
 * global variables, the quests and holodisks the Pip-Boy shows for them, the
 * karma, reputations and addictions of the character screen, the kills it
 * counts, and the places of the world map.
 *
 * Read from the player's own copy the way the engines read it. The engine of
 * Fallout 2 takes it from the game's files (vault13.gam, quests.txt,
 * holodisk.txt, karmavar.txt, genrep.txt, city.txt, the game's settings) and
 * words (quests.msg, pipboy.msg, editor.msg, map.msg, proto.msg); Fallout 1's
 * engine knows most of it by heart (tables.ts) and reads only the words and
 * vault13.gam.
 */
import { messages, sections } from '../gamefacts';
import type { GameData } from '../gamedata';
import { GAMES } from '../games';
import { Ini } from '../ini';
import {
  FO1_DRUGS,
  FO1_FIND_WATER_CHIP,
  FO1_HOLODISKS,
  FO1_KARMA_PICTURES,
  FO1_KARMA_TITLES,
  FO1_KARMA_VARIABLE,
  FO1_QUESTS,
  FO1_TOWN_VARIABLES,
  FO1_VAULT_WATER,
  FO2_ADDICTION_PICTURES,
  FO2_ADDICTIONS,
  FO2_DRUGS,
  FO2_KARMA_VARIABLE,
  FO2_TOWN_REPUTATIONS,
} from './tables';

export interface Variable {
  /** Its number, as scripts and the save know it. */
  index: number;
  name: string;
  /** What a new game starts it at. */
  start: number;
  /** What the game's own list says of it, where it says anything. */
  note: string;
}

export interface Quest {
  /** The place the Pip-Boy lists it under. */
  place: string;
  text: string;
  variable: number;
  /** From this value on the Pip-Boy shows it; from `done` on, crossed out. */
  shown: number;
  done: number;
}

export interface Holodisk {
  variable: number;
  name: string;
}

/** A line of the character screen's karma: a reputation, or the karma itself. */
export interface Title {
  variable: number;
  /** Its card: a line of skilldex.lst. */
  picture: number;
  name: string;
  description: string;
}

export interface Addiction extends Title {
  /** The drugs that lead to it. */
  drugs: number[];
}

export interface TownReputation {
  variable: number;
  /** The area of the world map it is about (Fallout 2's engine), and its name. */
  area: number;
  name: string;
}

/** A place on the world map. */
export interface Area {
  /** Its number: for Fallout 2's engine its line among the areas, for Fallout 1 its town. */
  index: number;
  name: string;
  /** Fallout 2's engine: how large its circle is (0 small, 1 medium, 2 large). */
  size: number;
  /** Fallout 1: the variable that is 1 once the town is known. */
  variable?: number;
}

export interface World {
  variables: Variable[];
  quests: Quest[];
  holodisks: Holodisk[];
  /** The karma variable and its line. */
  karma: Title | null;
  /** General reputation by karma (Fallout 2's engine): the first whose threshold the karma reaches names it. */
  standings: { threshold: number; name: string }[];
  /** The reputations the character screen lists when their variable is not 0. */
  titles: Title[];
  addictions: Addiction[];
  /** Fallout 2's engine: reputation in each town, and the words for it from best to worst, with what each means. */
  towns: TownReputation[];
  townWords: string[];
  townNotes: string[];
  kills: { name: string; description: string }[];
  /** The places of the world map that the player can be told of. */
  areas: Area[];
  /** Vault 13's water, where the game counts it down: the days left, and the quest that stops the count at 2. */
  water: { days: number; chip: number } | null;
}

const decode = (bytes: Uint8Array): string => new TextDecoder('windows-1252').decode(bytes);

/**
 * The lines of a text file as the engines' fgets reads them: at most 257
 * characters at a time, a Windows line end read as "\n".
 */
function engineLines(text: string): string[] {
  const lines: string[] = [];
  const source = text.replace(/\r\n/g, '\n');
  let at = 0;
  while (at < source.length) {
    const end = source.indexOf('\n', at);
    const stop = Math.min(end < 0 ? source.length : end + 1, at + 257);
    lines.push(source.slice(at, stop));
    at = stop;
  }
  return lines;
}

/**
 * The global variables of vault13.gam, read as the engine reads them
 * (globalVarsRead): from the line after GAME_GLOBAL_VARS, every line that is
 * neither empty nor a comment is a variable, its starting value whatever
 * number follows the first "=" before any ";".
 */
export function readVariables(file: Uint8Array): Variable[] {
  const lines = engineLines(decode(file));
  const first = lines.findIndex((line) => line.slice(0, 16) === 'GAME_GLOBAL_VARS:'.slice(0, 16));
  if (first < 0) return [];
  const variables: Variable[] = [];
  for (const line of lines.slice(first + 1)) {
    if (line === '\n' || line.startsWith('//')) continue;
    const semicolon = line.indexOf(';');
    const body = semicolon < 0 ? line : line.slice(0, semicolon);
    const equals = body.indexOf('=');
    const start = equals < 0 ? 0 : Number.parseInt(body.slice(equals + 1).trim(), 10);
    const name = (equals < 0 ? body : body.slice(0, equals)).replace(/:$/, '').trim().replace(/:$/, '').trim();
    // "//  (12)  // what it is", "// (12) what it is": the number is the list's own count.
    const note = semicolon < 0 ? '' : line.slice(semicolon + 1).replace(/^[\s/]*\(\s*\d+\s*\)/, '').replace(/^[\s/]+/, '').replace(/\s+/g, ' ').trim();
    variables.push({ index: variables.length, name, start: Number.isFinite(start) ? start : 0, note });
  }
  return variables;
}

/** The lines of one of Fallout 2's comma lists (quests.txt and the like): numbers, "#" for a comment. */
function rows(file: Uint8Array | null, width: number): number[][] {
  if (!file) return [];
  const out: number[][] = [];
  for (const raw of decode(file).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/[\s,]+/).filter(Boolean);
    if (tokens.length < width) continue;
    // atoi: a number where one starts, else 0.
    out.push(tokens.slice(0, width).map((token) => Number.parseInt(token, 10) || 0));
  }
  return out;
}

/** The town reputations a game names for itself (Fallout 2's engine: config\game.cfg, its patch, or sfall's CityRepsList). */
async function townList(data: GameData): Promise<number[][] | null> {
  const parse = (text: string | undefined): number[][] | null => {
    if (!text) return null;
    const pairs = text
      .split(',')
      .map((pair) => pair.split(':').map((part) => Number.parseInt(part.trim(), 10)))
      .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isInteger));
    return pairs.length ? pairs.map(([area, variable]) => [variable, area]) : null;
  };
  for (const name of ['config/game#patch.cfg', 'config/game.cfg']) {
    const file = await data.read(name);
    const list = file ? parse(Ini.parse(decode(file)).get('worldmap', 'city_reputation_list')) : null;
    if (list) return list;
  }
  const ddraw = await data.plain('ddraw.ini');
  return ddraw ? parse(Ini.parse(decode(ddraw)).get('Misc', 'CityRepsList')) : null;
}

/** Reads what a game's world is made of. */
export async function readWorld(data: GameData): Promise<World> {
  const def = GAMES[data.game];
  const engine = def.engine.id;
  const text = async (name: string): Promise<Map<number, string>> => {
    const bytes = await data.read(`text/english/game/${name}`);
    return bytes ? messages(bytes) : new Map();
  };
  const [pipboy, editor, places, proto, questWords] = await Promise.all(['pipboy.msg', 'editor.msg', 'map.msg', 'proto.msg', 'quests.msg'].map(text)) as Map<number, string>[];
  const word = (list: Map<number, string>, number: number) => list!.get(number) ?? '';
  const gam = await data.read('data/vault13.gam');
  const variables = gam ? readVariables(gam) : [];
  const named = (name: string) => variables.find((variable) => variable.name.toUpperCase() === name)?.index;

  const kills = Array.from({ length: engine === 'fo1' ? 15 : 19 }, (_, kind) => ({
    name: word(proto!, (engine === 'fo1' ? 450 : 1450) + kind),
    description: word(proto!, (engine === 'fo1' ? 465 : 1469) + kind),
  }));

  if (engine === 'fo1') {
    const quests: Quest[] = FO1_QUESTS.flatMap((list, place) =>
      list.map((variable, quest) => ({ place: word(pipboy!, 700 + 10 * place), text: word(pipboy!, 701 + 10 * place + quest), variable, shown: 1, done: 2 })),
    );
    // The water chip's quest is always on the list (pipboy.cc treats it as never below 1).
    for (const quest of quests) if (quest.variable === FO1_FIND_WATER_CHIP) quest.shown = 0;
    const title = (variable: number, line: number): Title => ({
      variable,
      picture: FO1_KARMA_PICTURES[line] ?? -1,
      name: word(editor!, 1000 + line).trim(),
      description: word(editor!, 1100 + line),
    });
    const drugsOf = (variable: number) => FO1_DRUGS.filter(([, gvar]) => gvar === variable).map(([pid]) => pid!);
    return {
      variables,
      quests,
      holodisks: FO1_HOLODISKS.map((variable, disk) => ({ variable, name: word(pipboy!, 400 + disk) })),
      karma: title(FO1_KARMA_VARIABLE, 0),
      standings: [],
      titles: FO1_KARMA_TITLES.slice(0, 3).map((variable, line) => title(variable, line + 1)),
      addictions: FO1_KARMA_TITLES.slice(3).map((variable, line) => ({ ...title(variable, line + 4), drugs: drugsOf(variable) })),
      towns: [],
      townWords: [],
      townNotes: [],
      kills,
      areas: FO1_TOWN_VARIABLES.map((variable, town) => ({ index: town, name: word(places!, 500 + town), size: 1, variable })),
      water: { days: FO1_VAULT_WATER, chip: FO1_FIND_WATER_CHIP },
    };
  }

  // The engine of Fallout 2, for Fallout 2 and for what runs on it.
  const quests = rows(await data.read('data/quests.txt'), 5)
    .map(([place, description, variable, shown, done]) => ({ at: place!, quest: { place: word(places!, place!), text: word(questWords!, description!), variable: variable!, shown: shown!, done: done! } }))
    // The Pip-Boy lists them by place, in the order its list gives them within one.
    .sort((a, b) => a.at - b.at)
    .map(({ quest }) => quest)
    .filter((quest) => quest.text);
  const holodisks = rows(await data.read('data/holodisk.txt'), 3).map(([variable, name]) => ({ variable: variable!, name: word(pipboy!, name!) }));
  const karmaRows = rows(await data.read('data/karmavar.txt'), 4).map(([variable, picture, name, description]) => ({
    variable: variable!,
    picture: picture!,
    name: word(editor!, name!).trim(),
    description: word(editor!, description!),
  }));
  const standings = rows(await data.read('data/genrep.txt'), 2).map(([threshold, name]) => ({ threshold: threshold!, name: word(editor!, name!) }));
  const towns = ((await townList(data)) ?? FO2_TOWN_REPUTATIONS.map((row) => [...row])).map(([variable, area]) => ({ variable: variable!, area: area!, name: word(places!, 1500 + area!) }));

  const areas: Area[] = [];
  const cityFile = await data.read('data/city.txt');
  const cities = cityFile ? sections(cityFile) : new Map<string, Map<string, string>>();
  for (let index = 0; index < 500; index++) {
    const section = cities.get(`area ${String(index).padStart(2, '0')}`);
    if (!section) break;
    // An area the game locks (random encounters) is never shown on the map; one
    // without a label for the world map's list of towns is a special place, not a town.
    if ((section.get('lock_state') ?? '').toLowerCase() === 'on') continue;
    if (Number.parseInt(section.get('townmap_label_art_idx') ?? '-1', 10) < 0) continue;
    // A second place of a name is the first one as a later part of the game has it (Arroyo destroyed): never both at once.
    const name = word(places!, 1500 + index);
    if (!name || areas.some((area) => area.name.toLowerCase() === name.toLowerCase())) continue;
    const size = ['small', 'medium', 'large'].indexOf((section.get('size') ?? '').toLowerCase());
    areas.push({ index, name, size: size < 0 ? 2 : size });
  }

  // Fallout Et Tu counts Vault 13's water down in a variable of its own; Fallout 2 has no such thing.
  const days = named('GVAR_VAULT13_WATER_DAYS');
  const chip = named('GVAR_VAULT_WATER');
  const drugsOf = (variable: number) => FO2_DRUGS.filter(([, gvar]) => gvar === variable).map(([pid]) => pid!);
  return {
    variables,
    quests,
    holodisks: holodisks.filter((disk) => disk.name),
    karma: karmaRows.find((row) => row.variable === FO2_KARMA_VARIABLE) ?? null,
    standings,
    titles: karmaRows.filter((row) => row.variable !== FO2_KARMA_VARIABLE),
    addictions: FO2_ADDICTIONS.map((variable, line) => ({
      variable,
      picture: FO2_ADDICTION_PICTURES[line] ?? -1,
      name: word(editor!, 1004 + line),
      description: word(editor!, 1104 + line),
      drugs: drugsOf(variable),
    })),
    towns: towns.filter((town) => town.name),
    townWords: Array.from({ length: 7 }, (_, line) => word(editor!, 2000 + line)),
    townNotes: Array.from({ length: 7 }, (_, line) => word(editor!, 2100 + line)),
    kills,
    areas,
    water: data.game === 'ettu' && days !== undefined && chip !== undefined ? { days, chip } : null,
  };
}

/** What a town thinks of the player, from best (0) to worst (6), as the character screen words it. */
export function townStanding(value: number): number {
  if (value < -30) return 6;
  if (value < -15) return 5;
  if (value < 0) return 4;
  if (value === 0) return 3;
  if (value < 15) return 2;
  if (value < 30) return 1;
  return 0;
}

/** The character screen's card for a town's standing, from best to worst (character_editor.cc). */
export const TOWN_PICTURES = [135, 137, 137, 141, 153, 153, 150];
/** Its cards for karma, kills and addictions. */
export const CARDS = { karma: 48, kills: 46, addiction: 53, reputation: 48 } as const;

/** The general reputation karma earns (Fallout 2's engine), or ''. */
export function standing(world: World, karma: number): string {
  return world.standings.find((entry) => karma >= entry.threshold)?.name ?? '';
}

/** Whether a quest shows in the Pip-Boy, and whether it is done there. */
export function questState(quest: Quest, value: number): 'hidden' | 'open' | 'done' {
  if (value >= quest.done) return 'done';
  return value >= quest.shown ? 'open' : 'hidden';
}

/** A variable's name as the game's own list gives it, or its number. */
export function variableName(world: World, index: number): string {
  return world.variables[index]?.name || `Variable ${index}`;
}
