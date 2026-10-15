/**
 * The rules of a game's character sheet, as its engine applies them.
 *
 * A save stores the results of the rules as well as the player's choices:
 * the statistics a character derives from S.P.E.C.I.A.L. (hit points, action
 * points, carry weight...) are kept with it, every perk taken added what it
 * gives to the bonus statistics, every level gained added hit points. The
 * save editor changes the choices and works the results out again the way
 * the engines do (stat.cc, skill.cc, perk.cc and trait.cc in each), so that a
 * changed save plays as one the game itself made would.
 *
 * Fallout Et Tu runs on the engine of Fallout 2 with rules of its own, which
 * the engine reads from files the game brings (ddraw.ini names them): perks
 * removed or changed (config/Perks.ini), skills (config/Skills.ini), the
 * table of experience per level. They are read here the same way.
 */
import { messages } from '../gamefacts';
import type { GameData } from '../gamedata';
import { GAMES, type GameId } from '../games';
import { Ini } from '../ini';
import type { SaveLayout } from '../savefile';
import { FO1_PERKS, FO1_SKILLS, FO1_STATS, FO1_TRAIT_PICTURES, FO2_PERKS, FO2_SKILLS, FO2_STATS, FO2_TRAIT_PICTURES } from './tables';

export const PRIMARY = 7;

/** Statistics by number, as both engines count them. */
export const STAT = {
  strength: 0,
  perception: 1,
  endurance: 2,
  charisma: 3,
  intelligence: 4,
  agility: 5,
  luck: 6,
  maxHitPoints: 7,
  maxActionPoints: 8,
  armorClass: 9,
  meleeDamage: 11,
  carryWeight: 12,
  sequence: 13,
  healingRate: 14,
  criticalChance: 15,
  betterCriticals: 16,
  damageResistance: 24,
  damageResistanceExplosion: 30,
  radiationResistance: 31,
  poisonResistance: 32,
  age: 33,
  gender: 34,
} as const;

/** The statistics a character screen shows below S.P.E.C.I.A.L., in its order. */
export const DERIVED = [
  STAT.maxHitPoints,
  STAT.armorClass,
  STAT.maxActionPoints,
  STAT.carryWeight,
  STAT.meleeDamage,
  STAT.damageResistance,
  STAT.poisonResistance,
  STAT.radiationResistance,
  STAT.sequence,
  STAT.healingRate,
  STAT.criticalChance,
] as const;

export const TRAIT = {
  fastMetabolism: 0,
  bruiser: 1,
  smallFrame: 2,
  finesse: 4,
  kamikaze: 5,
  heavyHanded: 6,
  goodNatured: 10,
  /** Night Person in Fallout, Sex Appeal in Fallout 2. */
  thirteenth: 13,
  skilled: 14,
  gifted: 15,
} as const;

const SKILL = {
  smallGuns: 0,
  bigGuns: 1,
  energyWeapons: 2,
  unarmed: 3,
  meleeWeapons: 4,
  throwing: 5,
  firstAid: 6,
  doctor: 7,
  sneak: 8,
  lockpick: 9,
  steal: 10,
  traps: 11,
  science: 12,
  repair: 13,
  speech: 14,
  barter: 15,
  gambling: 16,
  outdoorsman: 17,
} as const;

/** Perks the rules name, by number. The two engines number the first 64 alike. */
export const PERK = {
  survivalist: 16,
  educated: 18,
  lifegiver: 28,
  mrFixit: 31,
  medic: 32,
  masterThief: 33,
  speaker: 34,
  ranger: 47,
  tag: 51,
  // Fallout 2 only.
  vaultCityInoculations: 78,
  gambler: 83,
  gainStrength: 84,
  harmless: 91,
  livingAnatomy: 97,
  negotiator: 99,
  salesman: 103,
  thief: 105,
  vaultCityTraining: 107,
  alcoholRaisedHitPoints: 108,
  alcoholRaisedHitPoints2: 109,
  alcoholLoweredHitPoints: 110,
  alcoholLoweredHitPoints2: 111,
  autodocRaisedHitPoints: 112,
  autodocRaisedHitPoints2: 113,
  autodocLoweredHitPoints: 114,
  autodocLoweredHitPoints2: 115,
  expertExcrementExpeditor: 116,
} as const;

export interface StatRule {
  picture: number;
  min: number;
  max: number;
  name: string;
  description: string;
}

export interface SkillRule {
  picture: number;
  /** The value with nothing spent and S.P.E.C.I.A.L. at nothing. */
  base: number;
  /** What each point of each of S.P.E.C.I.A.L. adds. */
  multipliers: number[];
  /** Fallout: the two statistics are averaged. */
  averaged: boolean;
  /** What a point spent adds (doubled on a tagged skill). */
  perPoint: number;
  name: string;
  description: string;
  /** "Agility" or "Strength + Agility": what the skill comes from, in the game's words. */
  attributes: string;
}

export interface PerkRule {
  id: number;
  picture: number;
  /** -1: not a perk one chooses, but one the game gives and takes. */
  maxRank: number;
  minLevel: number;
  stat: number;
  statModifier: number;
  /** A skill (or, with 0x4000000 set, a global variable) the perk asks for, and how much of it; a negative value is a most. */
  skill1: number;
  skill1Value: number;
  /** 0: the first requirement only. 1: either. 2: both. */
  mode: number;
  skill2: number;
  skill2Value: number;
  /** The least of each of S.P.E.C.I.A.L. it asks for; a negative value is a most. For a perk the game gives: what it adds. */
  special: number[];
  name: string;
  description: string;
}

export interface TraitRule {
  picture: number;
  name: string;
  description: string;
  /** Statistics and skills the game's own rules add to (Perks.ini). */
  statMods: number[];
  skillMods: number[];
  /** Whether the engine's built-in effects apply. */
  hardcoded: boolean;
}

/** Bonuses some perks give to skills, which Perks.ini may change (Fallout 2's engine). */
export interface PerkTweaks {
  educated: number;
  lifegiver: number;
  medicFirstAid: number;
  medicDoctor: number;
  mrFixit: number;
  masterThief: number;
  speaker: number;
  ranger: number;
  survivalist: number;
  thief: number;
  harmless: number;
  negotiator: number;
  salesman: number;
  gambler: number;
  livingAnatomyDoctor: number;
  vaultCityTrainingFirstAid: number;
  vaultCityTrainingDoctor: number;
  expertExcrementExpeditor: number;
  vaultCityInoculationsPoison: number;
  vaultCityInoculationsRad: number;
}

const DEFAULT_TWEAKS: PerkTweaks = {
  educated: 2,
  lifegiver: 4,
  medicFirstAid: 10,
  medicDoctor: 10,
  mrFixit: 10,
  masterThief: 15,
  speaker: 20,
  ranger: 15,
  survivalist: 25,
  thief: 10,
  harmless: 20,
  negotiator: 10,
  salesman: 20,
  gambler: 20,
  livingAnatomyDoctor: 10,
  vaultCityTrainingFirstAid: 5,
  vaultCityTrainingDoctor: 5,
  expertExcrementExpeditor: 5,
  vaultCityInoculationsPoison: 10,
  vaultCityInoculationsRad: 10,
};

export interface Rules {
  game: GameId;
  /** Whose engine: how the rules are worked. */
  engine: SaveLayout;
  /** Whose world: what things are called. */
  world: 'fo1' | 'fo2';
  stats: StatRule[];
  /** Spent skill points, level, experience, reputation, karma: names. */
  pcStats: { name: string; description: string }[];
  /** What the character screen calls each value of S.P.E.C.I.A.L., 1 to 10: "Good", "Great". */
  statWords: string[];
  skills: SkillRule[];
  perks: PerkRule[];
  traits: TraitRule[];
  tweaks: PerkTweaks;
  /** Experience needed for each level, from level 1 (0) up to the highest. */
  experience: number[];
  tagBonus: number;
  /** Fallout 2's engine: whether the skill tagged by the Tag! perk also gets the bonus. */
  tagPerkBonus: boolean;
  /** Whether a tagged skill gains twice from each point spent. */
  tagDoubles: boolean;
  skillMax: number;
  /** The game's words for the gender a character can be. */
  genders: [string, string];
}

/** What the rules are applied to: the parts of a character sheet they read. */
export interface Sheet {
  base: number[];
  bonus: number[];
  /** Points spent on each skill. */
  skills: number[];
  /** Up to four, -1 where none: the fourth is the Tag! perk's. */
  tags: number[];
  /** The player's rank in every perk. */
  perks: number[];
  /** Two, -1 where none. */
  traits: number[];
  level: number;
  /** The game's difficulty: 0 easy, 1 normal, 2 hard. */
  difficulty: number;
  /** In-game time of day, as hours times 100 plus minutes (Night Person). */
  clock: number;
  /** The game's global variables (a perk may ask for one). */
  globals?: number[];
}

// ---------------------------------------------------------------------
// Reading the rules
// ---------------------------------------------------------------------

/** strtol with base 0, as the engine reads Perks.ini: 0x for hexadecimal, a leading 0 for octal. */
function integer(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = text.trim();
  const match = /^([+-]?)(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)/i.exec(value);
  if (!match) return undefined;
  const sign = match[1] === '-' ? -1 : 1;
  const digits = match[2]!;
  const number = /^0x/i.test(digits) ? Number.parseInt(digits.slice(2), 16) : digits.length > 1 && digits.startsWith('0') ? Number.parseInt(digits, 8) : Number(digits);
  return sign * number;
}

const decode = (bytes: Uint8Array): string => new TextDecoder('windows-1252').decode(bytes);

/** A settings file the game brought for its engine, named in ddraw.ini, read as the engine reads it. */
async function engineFile(data: GameData, ddraw: Ini | null, key: string): Promise<Ini | null> {
  const name = ddraw?.get('Misc', key);
  if (!name) return null;
  const bytes = await data.plain(name.replace(/\\/g, '/'));
  return bytes ? Ini.parse(decode(bytes)) : null;
}

const pick = (list: Map<number, string>, number: number, fallback = ''): string => list.get(number) ?? fallback;

/** Experience for each level: Fallout's own table, Fallout 2's formula, or a table the game brings (XPTable). */
function experienceTable(engine: SaveLayout, ddraw: Ini | null): number[] {
  if (engine === 'fo1') {
    const thousands = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91, 105, 120, 136, 153, 171, 190, 210];
    return thousands.map((value) => value * 1000);
  }
  const custom = ddraw?.get('Misc', 'XPTable');
  if (custom) {
    const values = custom.split(',').map((token) => Number(token.trim()));
    if (values.length && values.every((value, index) => Number.isInteger(value) && value > 0 && (index === 0 || value > values[index - 1]!))) {
      return [0, ...values].slice(0, 99);
    }
  }
  return Array.from({ length: 99 }, (_, level) => (level * (level + 1) * 1000) / 2);
}

/** Reads the rules of a game: the engine's tables, the game's words, and whatever the game changes. */
export async function readRules(data: GameData): Promise<Rules> {
  const def = GAMES[data.game];
  const engine = def.engine.id;
  const world = def.world;
  const text = async (name: string): Promise<Map<number, string>> => {
    const bytes = await data.read(`text/english/game/${name}`);
    return bytes ? messages(bytes) : new Map();
  };
  const [statText, skillText, perkText, traitText, editorText] = await Promise.all(
    ['stat.msg', 'skill.msg', 'perk.msg', 'trait.msg', 'editor.msg'].map(text),
  ) as [Map<number, string>, Map<number, string>, Map<number, string>, Map<number, string>, Map<number, string>];
  const ddrawBytes = engine === 'fo2' ? await data.plain('ddraw.ini') : null;
  const ddraw = ddrawBytes ? Ini.parse(decode(ddrawBytes)) : null;
  const perksIni = engine === 'fo2' ? await engineFile(data, ddraw, 'PerksFile') : null;
  const skillsIni = engine === 'fo2' ? await engineFile(data, ddraw, 'SkillsFile') : null;

  const stats: StatRule[] = (engine === 'fo1' ? FO1_STATS : FO2_STATS).map(([picture, min, max], stat) => ({
    picture: picture!,
    min: min!,
    max: max!,
    name: pick(statText, 100 + stat),
    description: pick(statText, 200 + stat),
  }));
  const pcStats = Array.from({ length: 5 }, (_, stat) => ({ name: pick(statText, 400 + stat), description: pick(statText, 500 + stat) }));
  const statWords = Array.from({ length: 10 }, (_, value) => pick(statText, 301 + value));
  // The character screen's own words for them.
  const genders: [string, string] = [pick(editorText, 107, 'Male'), pick(editorText, 108, 'Female')];

  const skills: SkillRule[] = (engine === 'fo1' ? FO1_SKILLS : FO2_SKILLS).map(([picture, base, modifier, stat1, stat2, perPoint], skill) => {
    const multipliers = new Array<number>(PRIMARY).fill(0);
    if (stat1! >= 0) multipliers[stat1!] = modifier!;
    if (stat2! >= 0) multipliers[stat2!] = modifier!;
    return {
      picture: picture!,
      base: base!,
      multipliers,
      averaged: engine === 'fo1' && stat2! >= 0,
      perPoint: perPoint!,
      name: pick(skillText, 100 + skill),
      description: pick(skillText, 200 + skill),
      attributes: pick(skillText, 300 + skill),
    };
  });

  const tweaks = { ...DEFAULT_TWEAKS };
  let tagBonus = 20;
  let tagPerkBonus = engine === 'fo1';
  let tagDoubles = true;
  if (skillsIni) {
    const bonus = integer(skillsIni.get('Skills', 'TagSkillBonus'));
    if (bonus !== undefined && bonus >= 0 && bonus <= 100) tagBonus = bonus;
    const mode = integer(skillsIni.get('Skills', 'TagSkillMode')) ?? 0;
    tagPerkBonus = (mode & 1) !== 0;
    tagDoubles = (mode & 2) === 0;
    skills.forEach((rule, skill) => {
      const formula = skillsIni.get('Skills', `Skill${skill}`);
      if (formula !== undefined) {
        rule.multipliers = new Array<number>(PRIMARY).fill(0);
        for (const token of formula.split('|')) {
          const stat = 'SPECIAL'.indexOf(token[0]?.toUpperCase() ?? '');
          if (token.length >= 2 && stat >= 0) rule.multipliers[stat] = Number.parseFloat(token.slice(1)) || 0;
        }
      }
      const base = integer(skillsIni.get('Skills', `SkillBase${skill}`));
      if (base !== undefined) rule.base = base;
      const multi = integer(skillsIni.get('Skills', `SkillMulti${skill}`));
      if (multi !== undefined) rule.perPoint = Math.min(10, Math.max(1, multi));
      const image = integer(skillsIni.get('Skills', `SkillImage${skill}`));
      if (image !== undefined) rule.picture = image;
    });
  }

  // Fallout 1 describes a perk at 201 and on, Fallout 2's engine at 1101.
  const describedAt = engine === 'fo1' ? 201 : 1101;
  const perks: PerkRule[] = (engine === 'fo1' ? FO1_PERKS : FO2_PERKS).map((row, id) => ({
    id,
    picture: row[0]!,
    maxRank: row[1]!,
    minLevel: row[2]!,
    stat: row[3]!,
    statModifier: row[4]!,
    skill1: row[5]!,
    skill1Value: row[6]!,
    mode: row[7]!,
    skill2: row[8]!,
    skill2Value: row[9]!,
    special: row.slice(10, 17) as number[],
    name: pick(perkText, 101 + id),
    description: pick(perkText, describedAt + id),
  }));

  if (perksIni) {
    const tweak = (key: string, field: keyof PerkTweaks, min: number, max: number) => {
      const value = integer(perksIni.get('PerksTweak', key));
      if (value !== undefined && value >= min) tweaks[field] = Math.min(value, max);
    };
    tweak('EducatedBonus', 'educated', 0, 125);
    tweak('LifegiverBonus', 'lifegiver', 0, 125);
    tweak('MedicFirstAidBonus', 'medicFirstAid', 0, 125);
    tweak('MedicDoctorBonus', 'medicDoctor', 0, 125);
    tweak('MrFixitBonus', 'mrFixit', 0, 125);
    tweak('MasterThiefBonus', 'masterThief', 0, 125);
    tweak('SpeakerBonus', 'speaker', 0, 125);
    tweak('RangerOutdoorsmanBonus', 'ranger', 0, 125);
    tweak('SurvivalistBonus', 'survivalist', 0, 125);
    tweak('ThiefBonus', 'thief', 0, 125);
    tweak('HarmlessBonus', 'harmless', 0, 125);
    tweak('NegotiatorBonus', 'negotiator', 0, 125);
    tweak('SalesmanBonus', 'salesman', 0, 999);
    tweak('GamblerBonus', 'gambler', 0, 125);
    tweak('LivingAnatomyDoctorBonus', 'livingAnatomyDoctor', 0, 125);
    tweak('VaultCityTrainingFirstAidBonus', 'vaultCityTrainingFirstAid', 0, 125);
    tweak('VaultCityTrainingDoctorBonus', 'vaultCityTrainingDoctor', 0, 125);
    tweak('ExpertExcrementExpeditorBonus', 'expertExcrementExpeditor', 0, 125);
    tweak('VaultCityInoculationsPoisonBonus', 'vaultCityInoculationsPoison', -100, 100);
    tweak('VaultCityInoculationsRadBonus', 'vaultCityInoculationsRad', -100, 100);

    if ((integer(perksIni.get('Perks', 'Enable')) ?? 1) !== 0) {
      for (const perk of perks) {
        const section = String(perk.id);
        const value = (key: string) => {
          const number = integer(perksIni.get(section, key));
          return number === undefined || number === -99999 ? undefined : number;
        };
        perk.name = perksIni.get(section, 'Name') ?? perk.name;
        perk.description = perksIni.get(section, 'Desc') ?? perk.description;
        perk.picture = value('Image') ?? perk.picture;
        perk.maxRank = value('Ranks') ?? perk.maxRank;
        perk.minLevel = value('Level') ?? perk.minLevel;
        perk.stat = value('Stat') ?? perk.stat;
        perk.statModifier = value('StatMag') ?? perk.statModifier;
        perk.skill1 = value('Skill1') ?? perk.skill1;
        perk.skill1Value = value('Skill1Mag') ?? perk.skill1Value;
        perk.mode = value('Type') ?? perk.mode;
        perk.skill2 = value('Skill2') ?? perk.skill2;
        perk.skill2Value = value('Skill2Mag') ?? perk.skill2Value;
        // The engine's own spelling of the seven: AGL, not AGI.
        ['STR', 'PER', 'END', 'CHR', 'INT', 'AGL', 'LCK'].forEach((key, stat) => {
          perk.special[stat] = value(key) ?? perk.special[stat]!;
        });
      }
    }
  }

  const pictures = engine === 'fo1' ? FO1_TRAIT_PICTURES : FO2_TRAIT_PICTURES;
  const traits: TraitRule[] = pictures.map((picture, trait) => ({
    picture,
    name: pick(traitText, 100 + trait),
    description: pick(traitText, 200 + trait),
    statMods: new Array<number>(stats.length).fill(0),
    skillMods: new Array<number>(skills.length).fill(0),
    hardcoded: true,
  }));
  if (perksIni && (integer(perksIni.get('Traits', 'Enable')) ?? 1) !== 0) {
    const pairs = (text: string | undefined, into: number[]) => {
      const parts = (text ?? '').split('|');
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const index = Number.parseInt(parts[i]!, 10);
        if (index >= 0 && index < into.length) into[index] = Number.parseInt(parts[i + 1]!, 10) || 0;
      }
    };
    traits.forEach((rule, trait) => {
      const section = `t${trait}`;
      rule.name = perksIni.get(section, 'Name') ?? rule.name;
      rule.description = perksIni.get(section, 'Desc') ?? rule.description;
      rule.picture = integer(perksIni.get(section, 'Image')) ?? rule.picture;
      pairs(perksIni.get(section, 'StatMod'), rule.statMods);
      pairs(perksIni.get(section, 'SkillMod'), rule.skillMods);
      if ((integer(perksIni.get(section, 'NoHardcode')) ?? 0) !== 0) rule.hardcoded = false;
    });
  }

  return {
    game: data.game,
    engine,
    world,
    stats,
    pcStats,
    statWords,
    skills,
    perks,
    traits,
    tweaks,
    experience: experienceTable(engine, ddraw),
    tagBonus,
    tagPerkBonus,
    tagDoubles,
    skillMax: engine === 'fo1' ? 200 : 300,
    genders,
  };
}

// ---------------------------------------------------------------------
// Applying them
// ---------------------------------------------------------------------

const has = (sheet: Sheet, trait: number): boolean => sheet.traits.includes(trait);
/** A trait with its engine-given effects (Perks.ini may switch them off). */
const active = (rules: Rules, sheet: Sheet, trait: number): boolean => has(sheet, trait) && rules.traits[trait]!.hardcoded;
const rank = (sheet: Sheet, perk: number): number => sheet.perks[perk] ?? 0;

/** What the chosen traits add to a statistic (traitGetStatModifier, trait_adjust_stat). */
export function traitStatModifier(rules: Rules, sheet: Sheet, stat: number): number {
  let modifier = 0;
  for (const trait of sheet.traits) if (trait >= 0) modifier += rules.traits[trait]?.statMods[stat] ?? 0;
  const is = (trait: number) => active(rules, sheet, trait);
  if (stat < PRIMARY && is(TRAIT.gifted)) modifier += 1;
  switch (stat) {
    case STAT.strength:
      if (is(TRAIT.bruiser)) modifier += 2;
      break;
    case STAT.perception:
    case STAT.intelligence:
      // Fallout's Night Person: sharper at night, duller by day.
      if (rules.engine === 'fo1' && has(sheet, TRAIT.thirteenth)) modifier += sheet.clock - 600 < 1200 ? -1 : 1;
      break;
    case STAT.agility:
      if (is(TRAIT.smallFrame)) modifier += 1;
      break;
    case STAT.maxActionPoints:
      if (is(TRAIT.bruiser)) modifier -= 2;
      break;
    case STAT.armorClass:
      if (is(TRAIT.kamikaze)) modifier -= sheet.base[STAT.armorClass]!;
      break;
    case STAT.meleeDamage:
      if (is(TRAIT.heavyHanded)) modifier += 4;
      break;
    case STAT.carryWeight:
      if (is(TRAIT.smallFrame)) modifier -= 10 * sheet.base[STAT.strength]!;
      break;
    case STAT.sequence:
      if (is(TRAIT.kamikaze)) modifier += 5;
      break;
    case STAT.healingRate:
      if (is(TRAIT.fastMetabolism)) modifier += 2;
      break;
    case STAT.criticalChance:
      if (is(TRAIT.finesse)) modifier += 10;
      break;
    case STAT.betterCriticals:
      if (is(TRAIT.heavyHanded)) modifier -= 30;
      break;
    case STAT.radiationResistance:
    case STAT.poisonResistance:
      if (is(TRAIT.fastMetabolism)) modifier -= sheet.base[stat]!;
      break;
  }
  return modifier;
}

/** A statistic's base value with the traits' changes: what the engine calls its base "with trait modifier". */
export function baseWithTraits(rules: Rules, sheet: Sheet, stat: number): number {
  return sheet.base[stat]! + traitStatModifier(rules, sheet, stat);
}

/**
 * A statistic as the game uses it (critterGetStat, stat_level): base, traits
 * and bonus together, and in Fallout 2 what some perks add on the spot.
 * Passing effects of the moment (blindness, a fight, mirrored shades) are left out.
 */
export function effectiveStat(rules: Rules, sheet: Sheet, stat: number): number {
  let value = baseWithTraits(rules, sheet, stat) + sheet.bonus[stat]!;
  if (rules.engine === 'fo2') {
    if (stat < PRIMARY && rank(sheet, PERK.gainStrength + stat)) value += 1;
    if (stat === STAT.maxHitPoints) {
      value += 2 * Math.sign(rank(sheet, PERK.alcoholRaisedHitPoints)) + 4 * Math.sign(rank(sheet, PERK.alcoholRaisedHitPoints2));
      value -= 2 * Math.sign(rank(sheet, PERK.alcoholLoweredHitPoints)) + 4 * Math.sign(rank(sheet, PERK.alcoholLoweredHitPoints2));
      value += 2 * Math.sign(rank(sheet, PERK.autodocRaisedHitPoints)) + 4 * Math.sign(rank(sheet, PERK.autodocRaisedHitPoints2));
      value -= 2 * Math.sign(rank(sheet, PERK.autodocLoweredHitPoints)) + 4 * Math.sign(rank(sheet, PERK.autodocLoweredHitPoints2));
    }
    if (stat === STAT.radiationResistance && rank(sheet, PERK.vaultCityInoculations)) value += rules.tweaks.vaultCityInoculationsRad;
    if (stat === STAT.poisonResistance && rank(sheet, PERK.vaultCityInoculations)) value += rules.tweaks.vaultCityInoculationsPoison;
  }
  const { min, max } = rules.stats[stat]!;
  return Math.min(max, Math.max(min, value));
}

/**
 * The base statistics with those derived from S.P.E.C.I.A.L. worked out
 * again (critterUpdateDerivedStats, stat_recalc_derived). Everything else in
 * them is left as it was.
 */
export function deriveBase(rules: Rules, sheet: Sheet): number[] {
  const base = sheet.base.slice();
  const special = (stat: number) => effectiveStat(rules, sheet, stat);
  const [st, pe, en, , , ag, lk] = Array.from({ length: PRIMARY }, (_, stat) => special(stat)) as number[];
  base[STAT.maxHitPoints] = baseWithTraits(rules, sheet, STAT.strength) + baseWithTraits(rules, sheet, STAT.endurance) * 2 + 15;
  base[STAT.maxActionPoints] = Math.trunc(ag! / 2) + 5;
  base[STAT.armorClass] = ag!;
  base[STAT.meleeDamage] = Math.max(st! - 5, 1);
  base[STAT.carryWeight] = 25 * st! + 25;
  base[STAT.sequence] = 2 * pe!;
  base[STAT.healingRate] = Math.max(Math.trunc(en! / 3), 1);
  base[STAT.criticalChance] = lk!;
  base[STAT.betterCriticals] = 0;
  base[STAT.radiationResistance] = 2 * en!;
  base[STAT.poisonResistance] = 5 * en!;
  return base;
}

/** What perks add to a skill (perkGetSkillModifier, perk_adjust_skill). Ghost's darkness is not known here. */
function perkSkillModifier(rules: Rules, sheet: Sheet, skill: number): number {
  const t = rules.tweaks;
  const r = (perk: number) => rank(sheet, perk) > 0;
  let modifier = 0;
  if (rules.engine === 'fo1') {
    if ((skill === SKILL.firstAid || skill === SKILL.doctor) && r(PERK.medic)) modifier += 20;
    if ([SKILL.sneak, SKILL.lockpick, SKILL.steal, SKILL.traps].includes(skill as 8) && r(PERK.masterThief)) modifier += 10;
    if ((skill === SKILL.science || skill === SKILL.repair) && r(PERK.mrFixit)) modifier += 20;
    if ((skill === SKILL.speech || skill === SKILL.barter) && r(PERK.speaker)) modifier += 20;
    return modifier;
  }
  switch (skill) {
    case SKILL.firstAid:
      if (r(PERK.medic)) modifier += t.medicFirstAid;
      if (r(PERK.vaultCityTraining)) modifier += t.vaultCityTrainingFirstAid;
      break;
    case SKILL.doctor:
      if (r(PERK.medic)) modifier += t.medicDoctor;
      if (r(PERK.livingAnatomy)) modifier += t.livingAnatomyDoctor;
      if (r(PERK.vaultCityTraining)) modifier += t.vaultCityTrainingDoctor;
      break;
    case SKILL.sneak:
    case SKILL.lockpick:
    case SKILL.steal:
    case SKILL.traps:
      if (r(PERK.thief)) modifier += t.thief;
      if ((skill === SKILL.lockpick || skill === SKILL.steal) && r(PERK.masterThief)) modifier += t.masterThief;
      if (skill === SKILL.steal && r(PERK.harmless)) modifier += t.harmless;
      break;
    case SKILL.science:
    case SKILL.repair:
      if (r(PERK.mrFixit)) modifier += t.mrFixit;
      break;
    case SKILL.speech:
    case SKILL.barter:
      if (skill === SKILL.speech && r(PERK.speaker)) modifier += t.speaker;
      if (skill === SKILL.speech && r(PERK.expertExcrementExpeditor)) modifier += t.expertExcrementExpeditor;
      if (r(PERK.negotiator)) modifier += t.negotiator;
      if (skill === SKILL.barter && r(PERK.salesman)) modifier += t.salesman;
      break;
    case SKILL.gambling:
      if (r(PERK.gambler)) modifier += t.gambler;
      break;
    case SKILL.outdoorsman:
      if (r(PERK.ranger)) modifier += t.ranger;
      if (r(PERK.survivalist)) modifier += t.survivalist;
      break;
  }
  return modifier;
}

/** What the chosen traits add to a skill (traitGetSkillModifier, trait_adjust_skill). */
function traitSkillModifier(rules: Rules, sheet: Sheet, skill: number): number {
  let modifier = 0;
  for (const trait of sheet.traits) if (trait >= 0) modifier += rules.traits[trait]?.skillMods[skill] ?? 0;
  const is = (trait: number) => active(rules, sheet, trait);
  if (is(TRAIT.gifted)) modifier -= 10;
  if (rules.engine === 'fo1' && is(TRAIT.skilled)) modifier += 10;
  if (is(TRAIT.goodNatured)) {
    if (skill <= SKILL.throwing) modifier -= 10;
    else if ([SKILL.firstAid, SKILL.doctor, SKILL.speech, SKILL.barter].includes(skill as 6)) modifier += 15;
  }
  return modifier;
}

/** Non-combat skills are easier on the easy difficulty and harder on the hard one. */
function difficultyModifier(sheet: Sheet, skill: number): number {
  if (skill < SKILL.firstAid) return 0;
  return sheet.difficulty === 2 ? -10 : sheet.difficulty === 0 ? 20 : 0;
}

/** What spending one point on a skill adds to it now. */
export function pointValue(rules: Rules, sheet: Sheet, skill: number): number {
  const rule = rules.skills[skill]!;
  return rule.perPoint * (sheet.tags.includes(skill) && rules.tagDoubles ? 2 : 1);
}

/** A skill's value as the game shows it (skillGetValue, skill_level). */
export function skillValue(rules: Rules, sheet: Sheet, skill: number): number {
  const rule = rules.skills[skill]!;
  const points = Math.max(0, sheet.skills[skill]!);
  const special = Array.from({ length: PRIMARY }, (_, stat) => effectiveStat(rules, sheet, stat));
  let value: number;
  if (rule.averaged) {
    const stats = rule.multipliers.flatMap((multiplier, stat) => (multiplier ? [stat] : []));
    value = rule.base + Math.trunc(((special[stats[0]!]! + special[stats[1]!]!) * rule.multipliers[stats[0]!]!) / 2) + points * rule.perPoint;
  } else {
    value = rule.base + points * rule.perPoint + rule.multipliers.reduce((sum, multiplier, stat) => sum + multiplier * special[stat]!, 0);
  }
  const slot = sheet.tags.indexOf(skill);
  if (slot >= 0) {
    if (rules.tagDoubles) value += points * rule.perPoint;
    const byTagPerk = rules.engine === 'fo2' && slot === 3 && rank(sheet, PERK.tag) > 0;
    if (!byTagPerk || rules.tagPerkBonus) value += rules.tagBonus;
  }
  value += traitSkillModifier(rules, sheet, skill) + perkSkillModifier(rules, sheet, skill) + difficultyModifier(sheet, skill);
  return Math.min(rules.skillMax, Math.trunc(value));
}

/** How many tagged skills a character may have: three, and one more with Tag!. */
export function tagLimit(sheet: Sheet): number {
  return 3 + (rank(sheet, PERK.tag) > 0 ? 1 : 0);
}

/** Hit points a level brings (pcAddExperienceWithOptions, stat_pc_add_experience). */
export function hitPointsPerLevel(rules: Rules, sheet: Sheet): number {
  const endurance = baseWithTraits(rules, sheet, STAT.endurance);
  const lifegiver = rank(sheet, PERK.lifegiver) * (rules.engine === 'fo2' ? rules.tweaks.lifegiver : 4);
  return Math.trunc(endurance / 2) + 2 + lifegiver;
}

/** The experience a level starts at. */
export function experienceFor(rules: Rules, level: number): number {
  return rules.experience[Math.min(Math.max(level, 1), rules.experience.length) - 1]!;
}

/** The level a quantity of experience reaches. */
export function levelFor(rules: Rules, experience: number): number {
  let level = 1;
  while (level < rules.experience.length && experience >= rules.experience[level]!) level++;
  return level;
}

/** Whether a perk is one the player chooses, and so one the editor offers. */
export function choosable(perk: PerkRule): boolean {
  return perk.maxRank > 0 && perk.name !== '';
}

/**
 * What changing the player's perk ranks from `before` to `after` does to the
 * bonus statistics (perkAddEffect and perkRemoveEffect, once per rank).
 */
export function perkBonusChange(rules: Rules, before: number[], after: number[]): number[] {
  const change = new Array<number>(rules.stats.length).fill(0);
  rules.perks.forEach((perk, id) => {
    const delta = (after[id] ?? 0) - (before[id] ?? 0);
    if (!delta) return;
    if (perk.stat >= 0 && perk.stat < change.length) change[perk.stat]! += delta * perk.statModifier;
    if (perk.maxRank === -1) perk.special.forEach((value, stat) => (change[stat]! += delta * value));
  });
  return change;
}

export interface Requirement {
  /** "Level 3", "Endurance 6", "Small Guns 75%". */
  text: string;
  met: boolean;
}

/** What a perk asks of a character, each with whether this one has it (perkCanAddAtLevel, perk_can_add). */
export function requirements(rules: Rules, sheet: Sheet, perk: PerkRule): { list: Requirement[]; met: boolean } {
  const list: Requirement[] = [];
  list.push({ text: `Level ${perk.minLevel}`, met: sheet.level >= perk.minLevel });
  const check = (param: number, value: number): Requirement | null => {
    if (param < 0) return null;
    const variable = (param & 0x4000000) !== 0;
    const index = param & ~0x4000000;
    if (!variable && (index >= rules.skills.length || !value)) return null;
    const have = variable ? (sheet.globals?.[index] ?? 0) : skillValue(rules, sheet, index);
    const name = variable ? (index === 0 && rules.world === 'fo2' ? 'Karma' : `Global ${index}`) : rules.skills[index]!.name;
    const unit = variable ? '' : '%';
    return value < 0 ? { text: `${name} under ${-value}${unit}`, met: have < -value } : { text: `${name} ${value}${unit}`, met: have >= value };
  };
  const first = check(perk.skill1, perk.skill1Value);
  const second = perk.mode === 0 ? null : check(perk.skill2, perk.skill2Value);
  let skillsMet = true;
  if (first && second) {
    if (perk.mode === 1) {
      list.push({ text: `${first.text} or ${second.text}`, met: first.met || second.met });
      skillsMet = first.met || second.met;
    } else {
      list.push(first, second);
      skillsMet = first.met && second.met;
    }
  } else if (first) {
    list.push(first);
    skillsMet = first.met;
  }
  perk.special.forEach((value, stat) => {
    if (!value) return;
    const have = effectiveStat(rules, sheet, stat);
    const name = rules.stats[stat]!.name;
    list.push(value < 0 ? { text: `${name} under ${-value}`, met: have < -value } : { text: `${name} ${value}`, met: have >= value });
  });
  return { list, met: skillsMet && list.every((item) => item.met) };
}
