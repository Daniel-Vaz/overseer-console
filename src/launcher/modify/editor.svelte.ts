/**
 * The save editor's state: the record being changed, what follows from it by
 * the game's rules, and every change made so far, each with a way back.
 *
 * Shared by the sections of the editor screen. Nothing here is written to
 * the save until write() is asked for.
 */
import { markForContinue } from '../../lib/saves';
import type { ItemProto } from '../../lib/modify/catalog';
import { partyChanged, readParty, writeParty, type Member } from '../../lib/modify/party';
import {
  MAX_QUANTITY,
  addictionVariables,
  canCure,
  clockOf,
  copyRecord,
  curedWithdrawals,
  dateAt,
  equipped,
  experienceAt,
  hasTagPerk,
  hitPoints,
  levelHitPoints,
  readSave,
  sheetOf,
  usedIds,
  writeSave,
  type Carried,
  type Companion,
  type SaveRecord,
} from '../../lib/modify/record';
import {
  PERK,
  PRIMARY,
  STAT,
  choosable,
  effectiveStat,
  levelFor,
  pointValue,
  requirements,
  skillCost,
  skillValue,
  tagLimit,
  type PerkRule,
} from '../../lib/modify/rules';
import { EQUIPPED, type MappedItem } from '../../lib/modify/savemap';
import { storeSession, type EditorSession } from '../../lib/modify/session';
import { questState, standing, townStanding, variableName, type Quest } from '../../lib/modify/world';
import { gameDef } from '../../lib/games';

export interface Change {
  id: string;
  text: string;
  undo: () => void;
}

/** Most of a skill the editor lets a character spend on: the game's ceiling is reached well before. */
const MAX_SKILL_POINTS = 300;
/** Fallout 2's car holds this much fuel (worldmap.cc, CAR_FUEL_MAX). */
export const FUEL_MAX = 80_000;
/** The game's clock: tenths of a second. */
export const TICKS_PER_HOUR = 36_000;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
/** Perks "every good perk" leaves out: those that ask for a choice the editor cannot make, and Here and Now's experience. */
const NOT_GOOD = new Set<number>([PERK.tag, 52]);
const HERE_AND_NOW = 92;

/** The best of what each game has, by its items' own names: armour, guns and what they fire, medicine. */
const LOADOUT: Record<'fo1' | 'fo2', [name: string, quantity: number][]> = {
  fo1: [['Hardened Power Armor', 1], ['Turbo Plasma Rifle', 1], ['Micro Fusion Cell', 4], ['Super Stimpak', 10], ['Stimpak', 20]],
  fo2: [
    ['Adv. Power Armor MKII', 1],
    ['PPK12 Gauss Pistol', 1],
    ['M72 Gauss Rifle', 1],
    ['2mm EC', 4],
    ['Bozar', 1],
    ['.223 FMJ', 4],
    ['Super Stimpak', 10],
    ['Stimpak', 20],
  ],
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const number = (value: number) => value.toLocaleString('en-US');

export class Editor {
  session: EditorSession;
  record = $state<SaveRecord>() as SaveRecord;
  /** Bumped when the save under the editor is replaced, after writing. */
  generation = $state(0);
  /** Whether the list of everything the game has is open, to add from; and for whom (0: the player, else a companion's object). */
  picking = $state(false);
  pickingFor = $state(0);
  /** Whether the Pip-Boy section lists every global variable, to search through. */
  variables = $state(false);
  /** Whether skills are bought with unspent points and perks taken when owed, as the game's own screens allow. */
  byRules = $state(false);
  /** Whether keys typed go to a search: the screen's own keys are left alone then. */
  get searching(): boolean {
    return this.picking || this.variables;
  }
  /** Where the cursor was in each section, for coming back to it. */
  cursor: Record<string, number> = {};
  private nextKey = 0;

  constructor(session: EditorSession) {
    this.session = session;
    this.record = copyRecord(session.original.record);
  }

  get rules() {
    return this.session.rules;
  }
  get original() {
    return this.session.original;
  }
  get catalog() {
    return this.session.catalog;
  }
  get world() {
    return this.session.world;
  }
  get worldOf() {
    return gameDef(this.session.game).world;
  }
  /** The party's members as the save holds them. */
  get members(): Member[] {
    return this.session.original.party?.members ?? [];
  }

  /** The character sheet as it now stands. */
  sheet = $derived.by(() => {
    void this.generation;
    return sheetOf(this.rules, this.original, this.record);
  });

  /** A statistic as the game uses it. */
  stat(stat: number): number {
    return effectiveStat(this.rules, this.sheet, stat);
  }

  /** The same statistic in the save as it was. */
  was(stat: number): number {
    void this.generation;
    return effectiveStat(this.rules, sheetOf(this.rules, this.original, this.original.record), stat);
  }

  skill(skill: number): number {
    return skillValue(this.rules, this.sheet, skill);
  }

  hitPoints = $derived.by(() => hitPoints(this.rules, this.original, this.record, this.sheet));

  levelMax = $derived(this.rules.experience.length);

  /** Perks the player can choose, as the game offers them. */
  perks = $derived(this.rules.perks.filter((perk) => choosable(perk) && perk.minLevel <= this.rules.experience.length));

  /** Perks the game gave (addictions, reputations, implants...) that the character has. */
  given = $derived(this.rules.perks.filter((perk) => !choosable(perk) && (this.record.perks[perk.id] ?? 0) > 0 && perk.name));

  /** Weight of everything carried, bags and what is in them included. */
  carried = $derived.by(() => weight(this, this.record.items));

  proto(pid: number): ItemProto | undefined {
    return this.catalog.items.get(pid);
  }

  /** A global variable as it now stands. */
  global(index: number): number {
    return this.record.globals[index] ?? 0;
  }

  // -------------------------------------------------------------------
  // Changing things
  // -------------------------------------------------------------------

  setText(field: 'name' | 'description', value: string): void {
    this.record[field] = value.replace(/[^\x20-\x7e]/g, '');
  }

  setGender(gender: number): void {
    this.record.gender = gender ? 1 : 0;
  }

  setAge(age: number): void {
    const rule = this.rules.stats[STAT.age]!;
    this.record.age = clamp(age, rule.min, Math.min(rule.max, 99));
  }

  setSpecial(stat: number, value: number): void {
    this.record.special[stat] = clamp(value, 1, 10);
  }

  /** A level, with the experience it needs. */
  setLevel(level: number): void {
    const next = clamp(level, 1, this.levelMax);
    this.record.experience = experienceAt(this.rules, this.record, next);
    this.record.level = next;
  }

  /** Experience, and the level it reaches if that is higher, as the game would have it. */
  setExperience(experience: number): void {
    this.record.experience = clamp(experience, 0, 99_999_999);
    const reached = levelFor(this.rules, this.record.experience);
    if (reached > this.record.level) this.record.level = reached;
    else if (this.record.experience < this.rules.experience[this.record.level - 1]!) this.record.level = reached;
  }

  setUnspent(points: number): void {
    this.record.unspent = clamp(points, 0, 99);
  }

  setPerksOwed(count: number): void {
    this.record.perksOwed = clamp(count, 0, this.rules.engine === 'fo1' ? 1 : 250);
  }

  /** Hit points as shown: what levels gained here bring is part of them. */
  setHitPoints(value: number): void {
    const most = this.stat(STAT.maxHitPoints);
    this.record.hitPoints = clamp(value, 1, most) - levelHitPoints(this.rules, this.original, this.record);
  }

  setPoison(value: number): void {
    this.record.poison = clamp(value, 0, 2000);
  }

  setRadiation(value: number): void {
    this.record.radiation = clamp(value, 0, 2000);
  }

  /** Hit points full, no poison, no radiation. */
  heal(): void {
    this.setHitPoints(this.stat(STAT.maxHitPoints));
    this.record.poison = 0;
    this.record.radiation = 0;
  }

  setSkillPoints(skill: number, points: number): void {
    this.record.skills[skill] = clamp(points, 0, MAX_SKILL_POINTS);
  }

  /** The fewest points that bring a skill to a value (or as close as the points allow). */
  setSkillValue(skill: number, target: number): void {
    const now = this.skill(skill);
    const per = pointValue(this.rules, this.sheet, skill);
    const points = this.record.skills[skill]!;
    this.setSkillPoints(skill, points + Math.ceil((target - now) / per));
  }

  /**
   * By the rules: buys points of a skill with unspent skill points at what the
   * character screen charges, or sells back points bought here (skillAdd,
   * skillSub). Null when at least one was, else why not.
   */
  paySkill(skill: number, direction: 1 | -1, times = 1): string | null {
    const name = this.rules.skills[skill]!.name;
    for (let step = 0; step < times; step++) {
      if (direction > 0) {
        if (this.skill(skill) >= this.rules.skillMax) return step ? null : `${name} is at its most already.`;
        const cost = skillCost(this.rules, this.sheet, skill);
        if (this.record.unspent < cost) return step ? null : `Not enough unspent skill points: the next point of ${name} costs ${cost}.`;
        this.record.unspent -= cost;
        this.record.skills[skill]! += 1;
      } else {
        if (this.record.skills[skill]! <= (this.original.record.skills[skill] ?? 0)) return step ? null : 'Only points bought here can be sold back, as on the character screen.';
        this.record.skills[skill]! -= 1;
        this.record.unspent += skillCost(this.rules, this.sheet, skill);
      }
    }
    return null;
  }

  /** By the rules: takes a perk's next rank with a perk owed, its requirements met; or gives back one taken here. */
  payPerk(perk: PerkRule, direction: 1 | -1): string | null {
    const rank = this.record.perks[perk.id] ?? 0;
    if (direction > 0) {
      if (rank >= perk.maxRank) return `${perk.name} is at its highest rank.`;
      if (this.record.perksOwed <= 0) return 'No perk is owed: the game offers one every few levels.';
      if (!requirements(this.rules, this.sheet, perk).met) return `${perk.name} asks for more than the character has.`;
      this.setPerkRank(perk, rank + 1);
      this.record.perksOwed -= 1;
      return null;
    }
    if (rank <= (this.original.record.perks[perk.id] ?? 0)) return 'Only perks taken here can be given back.';
    this.setPerkRank(perk, rank - 1);
    this.record.perksOwed += 1;
    return null;
  }

  /** Tags a skill or takes the tag off. Null when done, else why not. */
  toggleTag(skill: number): string | null {
    const tags = this.record.tags;
    const at = tags.indexOf(skill);
    if (at >= 0) {
      tags[at] = -1;
      return null;
    }
    const limit = tagLimit(this.sheet);
    if (tags.filter((tag) => tag >= 0).length >= limit) return `${limit === 4 ? 'Four' : 'Three'} skills are tagged already: take the tag off one first.`;
    // The first three slots are the character's own; the fourth is the Tag! perk's.
    const free = tags.slice(0, 3).indexOf(-1);
    tags[free >= 0 ? free : 3] = skill;
    return null;
  }

  /** Takes a trait or gives it up. Null when done, else why not. */
  toggleTrait(trait: number): string | null {
    const traits = this.record.traits;
    const at = traits.indexOf(trait);
    if (at >= 0) {
      traits[at] = -1;
      return null;
    }
    const free = traits.indexOf(-1);
    if (free < 0) return 'A character has two traits at most: give one up first.';
    traits[free] = trait;
    return null;
  }

  setPerkRank(perk: PerkRule, rank: number): void {
    this.record.perks[perk.id] = clamp(rank, 0, perk.maxRank);
    // A fourth tag needs the Tag! perk.
    if (!hasTagPerk(this.record) && this.record.tags[3]! >= 0 && this.record.tags.slice(0, 3).includes(-1)) {
      const free = this.record.tags.indexOf(-1);
      this.record.tags[free] = this.record.tags[3]!;
      this.record.tags[3] = -1;
    }
  }

  setQuantity(key: string, quantity: number): void {
    const item = this.record.items.find((entry) => entry.key === key);
    if (item && !equipped(item)) item.quantity = clamp(quantity, 1, MAX_QUANTITY);
  }

  removeItem(key: string): void {
    const index = this.record.items.findIndex((entry) => entry.key === key);
    if (index >= 0 && !equipped(this.record.items[index]!)) this.record.items.splice(index, 1);
  }

  /** Adds to what is carried: onto a stack of the same thing where there is one, as the game does. Returns the entry's key. */
  addItem(pid: number, quantity = 1): string {
    return this.addTo(this.record.items, pid, quantity);
  }

  private addTo(items: Carried[], pid: number, quantity: number): string {
    const stack = items.find((item) => item.pid === pid && !equipped(item) && (!item.original || !item.original.contents.length) && sameFresh(this, item));
    if (stack) {
      stack.quantity = clamp(stack.quantity + quantity, 1, MAX_QUANTITY);
      return stack.key;
    }
    const key = `n${this.nextKey++}`;
    items.push({ key, pid, quantity: clamp(quantity, 1, MAX_QUANTITY) });
    return key;
  }

  // The world: global variables, kills, time, the map.

  setGlobal(index: number, value: number): void {
    if (index >= 0 && index < this.record.globals.length) this.record.globals[index] = clamp(value, -2_147_483_648, 2_147_483_647);
  }

  /** A global variable back to what a new game starts it at. */
  resetGlobal(index: number): void {
    const start = this.world.variables[index]?.start;
    if (start !== undefined) this.setGlobal(index, start);
  }

  setKills(kind: number, count: number): void {
    if (kind >= 0 && kind < this.record.kills.length) this.record.kills[kind] = clamp(count, 0, 999_999);
  }

  setReputation(value: number): void {
    this.record.reputation = clamp(value, -20, 20);
  }

  /** The game's clock, never before its start. */
  setTime(time: number): void {
    this.record.time = clamp(time, 0, 0xffffffff);
  }

  /** Whether an area of the world map is known: Fallout 2's engine by its state, Fallout 1 by the town's variable. */
  areaKnown(index: number): boolean {
    const area = this.world.areas[index];
    if (!area) return false;
    if (area.variable !== undefined) return this.global(area.variable) !== 0;
    return (this.record.areas[area.index] ?? 0) > 0;
  }

  setAreaKnown(index: number, known: boolean): void {
    const area = this.world.areas[index];
    if (!area) return;
    if (area.variable !== undefined) {
      this.setGlobal(area.variable, known ? 1 : 0);
      return;
    }
    const was = this.original.record.areas[area.index] ?? 0;
    // Making it known again leaves what the save knew of it (visited stays visited).
    this.record.areas[area.index] = known ? (was > 0 ? was : 1) : 0;
  }

  setFuel(fuel: number): void {
    this.record.fuel = clamp(fuel, 0, FUEL_MAX);
  }

  /** Whether an addiction can be cured here: its withdrawal must be in a queue the editor read. */
  canCure(): boolean {
    return canCure(this.original);
  }

  // The party.

  companion(id: number): Companion | undefined {
    return this.record.party.find((member) => member.id === id);
  }

  setCompanion(id: number, field: 'hitPoints' | 'poison' | 'radiation', value: number): void {
    const member = this.companion(id);
    const most = this.members.find((entry) => entry.id === id)?.maxHitPoints ?? 1;
    if (!member) return;
    member[field] = field === 'hitPoints' ? clamp(value, 1, most) : clamp(value, 0, 2000);
  }

  healCompanion(id: number): void {
    const member = this.companion(id);
    const most = this.members.find((entry) => entry.id === id)?.maxHitPoints;
    if (!member || most === undefined) return;
    member.hitPoints = most;
    member.poison = 0;
    member.radiation = 0;
  }

  addToCompanion(id: number, pid: number, quantity = 1): string | null {
    const member = this.companion(id);
    return member ? this.addTo(member.items, pid, quantity) : null;
  }

  setCompanionQuantity(id: number, key: string, quantity: number): void {
    const item = this.companion(id)?.items.find((entry) => entry.key === key);
    if (item && !equipped(item)) item.quantity = clamp(quantity, 1, MAX_QUANTITY);
  }

  removeFromCompanion(id: number, key: string): void {
    const items = this.companion(id)?.items;
    const index = items?.findIndex((entry) => entry.key === key) ?? -1;
    if (items && index >= 0 && !equipped(items[index]!)) items.splice(index, 1);
  }

  /** Weight a companion carries. */
  companionCarried(id: number): number {
    return weight(this, this.companion(id)?.items ?? []);
  }

  // Quick actions, one change of the record each (and each to be undone line by line).

  maxSpecial(): void {
    for (let stat = 0; stat < PRIMARY; stat++) this.setSpecial(stat, 10);
  }

  maxSkills(): void {
    for (let skill = 0; skill < this.rules.skills.length; skill++) {
      if (this.skill(skill) < this.rules.skillMax) this.setSkillValue(skill, this.rules.skillMax);
    }
  }

  maxLevel(): void {
    this.setLevel(this.levelMax);
  }

  /** Every perk the game offers, at its every rank, but those that ask for a choice of their own. Returns how many ranks were added. */
  allGoodPerks(): number {
    let added = 0;
    for (const perk of this.perks) {
      if (NOT_GOOD.has(perk.id) || (this.rules.engine === 'fo2' && perk.id === HERE_AND_NOW)) continue;
      const rank = this.record.perks[perk.id] ?? 0;
      if (rank >= perk.maxRank) continue;
      added += perk.maxRank - rank;
      this.setPerkRank(perk, perk.maxRank);
    }
    return added;
  }

  /** Adds the game's best things to what is carried. Returns the names of those this game does not have. */
  loadout(): { added: string[]; missing: string[] } {
    const added: string[] = [];
    const missing: string[] = [];
    const offered = [...this.catalog.items.values()].filter((item) => item.offered);
    for (const [name, quantity] of LOADOUT[this.worldOf]) {
      const item = offered.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (!item) {
        missing.push(name);
        continue;
      }
      this.addItem(item.pid, quantity);
      added.push(quantity > 1 ? `${quantity} × ${item.name}` : item.name);
    }
    return { added, missing };
  }

  /** Back to the save as it is in its slot. */
  reset(): void {
    this.record = copyRecord(this.original.record);
  }

  // -------------------------------------------------------------------
  // What has changed
  // -------------------------------------------------------------------

  /** What a quest, holodisk, karma... a variable stands for, if it stands for one. */
  meaning(index: number): { kind: 'quest' | 'holodisk' | 'karma' | 'title' | 'town' | 'addiction' | 'area' | 'water'; name: string; quest?: Quest } | null {
    const world = this.world;
    const quest = world.quests.find((entry) => entry.variable === index);
    if (quest) return { kind: 'quest', name: quest.text, quest };
    if (world.water?.days === index) return { kind: 'water', name: "Vault 13's water" };
    const disk = world.holodisks.find((entry) => entry.variable === index);
    if (disk) return { kind: 'holodisk', name: disk.name };
    if (world.karma?.variable === index) return { kind: 'karma', name: world.karma.name };
    const title = world.titles.find((entry) => entry.variable === index);
    if (title) return { kind: 'title', name: title.name };
    const town = world.towns.find((entry) => entry.variable === index);
    if (town) return { kind: 'town', name: town.name };
    const addiction = world.addictions.find((entry) => entry.variable === index);
    if (addiction) return { kind: 'addiction', name: addiction.name };
    const area = world.areas.find((entry) => entry.variable === index);
    if (area) return { kind: 'area', name: area.name };
    return null;
  }

  /** A date and time of day the way the Pip-Boy shows them: "25 JUL 2241 08:24". */
  when(time: number): string {
    const [month, day, year] = dateAt(this.original, time);
    const clock = String(clockOf(time)).padStart(4, '0');
    return `${String(day).padStart(2, '0')} ${MONTHS[month - 1] ?? '???'} ${year} ${clock.slice(0, 2)}:${clock.slice(2)}`;
  }

  changes = $derived.by((): Change[] => {
    void this.generation;
    const was = this.original.record;
    const now = this.record;
    const rules = this.rules;
    const list: Change[] = [];
    const add = (id: string, text: string, undo: () => void) => list.push({ id, text, undo });

    if (now.name !== was.name) add('name', `Name ${was.name || '(none)'} → ${now.name || '(none)'}`, () => (now.name = was.name));
    if (now.description !== was.description) add('description', `Description changed`, () => (now.description = was.description));
    if (now.gender !== was.gender) add('gender', `${title(rules.genders[was.gender] ?? '')} → ${title(rules.genders[now.gender] ?? '')}`, () => (now.gender = was.gender));
    if (now.age !== was.age) add('age', `Age ${was.age} → ${now.age}`, () => (now.age = was.age));
    for (let stat = 0; stat < PRIMARY; stat++) {
      if (now.special[stat] !== was.special[stat]) {
        add(`special${stat}`, `${rules.stats[stat]!.name} ${was.special[stat]} → ${now.special[stat]}`, () => (now.special[stat] = was.special[stat]!));
      }
    }
    if (now.level !== was.level || now.experience !== was.experience) {
      add('level', `Level ${was.level} → ${now.level}, ${number(now.experience)} experience`, () => {
        now.level = was.level;
        now.experience = was.experience;
      });
    }
    if (now.unspent !== was.unspent) add('unspent', `Unspent skill points ${was.unspent} → ${now.unspent}`, () => (now.unspent = was.unspent));
    if (now.perksOwed !== was.perksOwed) add('owed', `Perks owed ${was.perksOwed} → ${now.perksOwed}`, () => (now.perksOwed = was.perksOwed));
    if (now.hitPoints !== was.hitPoints) add('hp', `Hit points ${was.hitPoints} → ${this.hitPoints}`, () => (now.hitPoints = was.hitPoints));
    if (now.poison !== was.poison) add('poison', `Poison ${was.poison} → ${now.poison}`, () => (now.poison = was.poison));
    if (now.radiation !== was.radiation) add('radiation', `Radiation ${was.radiation} → ${now.radiation}`, () => (now.radiation = was.radiation));

    const before = sheetOf(rules, this.original, was);
    for (let skill = 0; skill < now.skills.length; skill++) {
      if (now.skills[skill] !== was.skills[skill]) {
        add(`skill${skill}`, `${rules.skills[skill]!.name} ${skillValue(rules, before, skill)}% → ${this.skill(skill)}%`, () => (now.skills[skill] = was.skills[skill]!));
      }
    }
    const tagged = (tags: number[]) => tags.filter((tag) => tag >= 0).map((tag) => rules.skills[tag]!.name);
    if (now.tags.some((tag, slot) => tag !== was.tags[slot])) {
      add('tags', `Tagged ${tagged(was.tags).join(', ') || 'none'} → ${tagged(now.tags).join(', ') || 'none'}`, () => (now.tags = was.tags.slice()));
    }
    const traitNames = (traits: number[]) => traits.filter((trait) => trait >= 0).map((trait) => rules.traits[trait]!.name);
    if (now.traits.some((trait, slot) => trait !== was.traits[slot])) {
      add('traits', `Traits ${traitNames(was.traits).join(', ') || 'none'} → ${traitNames(now.traits).join(', ') || 'none'}`, () => (now.traits = was.traits.slice()));
    }
    rules.perks.forEach((perk, id) => {
      const [from, to] = [was.perks[id] ?? 0, now.perks[id] ?? 0];
      if (from === to) return;
      const text = to === 0 ? `Gave up ${perk.name}` : from === 0 ? `Took ${perk.name}${perk.maxRank > 1 ? `, rank ${to}` : ''}` : `${perk.name} rank ${from} → ${to}`;
      add(`perk${id}`, text, () => (now.perks[id] = from));
    });

    this.itemChanges(add, 'i', '', was.items, now.items);

    // The world.
    const world = this.world;
    now.globals.forEach((value, index) => {
      const from = was.globals[index] ?? 0;
      if (value === from) return;
      const undo = () => (now.globals[index] = from);
      const meaning = this.meaning(index);
      const name = meaning?.name ?? variableName(world, index);
      switch (meaning?.kind) {
        case 'quest': {
          const state = (v: number) => ({ hidden: 'not shown', open: 'open', done: 'done' })[questState(meaning.quest!, v)];
          add(`g${index}`, `Quest: ${shorten(name, 48)} ${state(from) === state(value) ? `${from} → ${value}` : `${state(from)} → ${state(value)}`}`, undo);
          break;
        }
        case 'holodisk':
          add(`g${index}`, `Holodisk ${name}: ${value ? 'given' : 'taken away'}`, undo);
          break;
        case 'addiction':
          add(`g${index}`, value ? `Addicted: ${name}` : `Cured: ${name}`, undo);
          break;
        case 'area':
          add(`g${index}`, `${name}: ${value ? 'known' : 'not known'} on the world map`, undo);
          break;
        case 'water':
          add(`g${index}`, `Vault 13's water ${from} → ${value} days`, undo);
          break;
        case 'town':
          add(`g${index}`, `${name}: reputation ${from} → ${value}`, undo);
          break;
        case 'karma':
          add(`g${index}`, `Karma ${number(from)} → ${number(value)}`, undo);
          break;
        case 'title':
          add(`g${index}`, from && value ? `${name} ${from} → ${value}` : `${name}: ${value ? 'earned' : 'taken away'}`, undo);
          break;
        default:
          add(`g${index}`, `${name} ${from} → ${value}`, undo);
      }
    });
    now.kills.forEach((count, kind) => {
      const from = was.kills[kind] ?? 0;
      if (count !== from) add(`k${kind}`, `${world.kills[kind]?.name || `Kind ${kind}`} killed ${number(from)} → ${number(count)}`, () => (now.kills[kind] = from));
    });
    if (now.reputation !== was.reputation) add('reputation', `${rules.pcStats[3]?.name || 'Reputation'} ${was.reputation} → ${now.reputation}`, () => (now.reputation = was.reputation));
    if (now.time !== was.time) add('time', `Date ${this.when(was.time)} → ${this.when(now.time)}`, () => (now.time = was.time));
    now.areas.forEach((visited, index) => {
      const from = was.areas[index] ?? 0;
      if (visited === from) return;
      const name = world.areas.find((area) => area.index === index)?.name || `Area ${index}`;
      add(`a${index}`, `${name}: ${visited ? 'known' : 'not known'} on the world map`, () => (now.areas[index] = from));
    });
    if (now.fuel !== was.fuel) add('fuel', `Car's fuel ${number(was.fuel)} → ${number(now.fuel)}`, () => (now.fuel = was.fuel));

    // The party.
    for (const member of this.members) {
      const then = was.party.find((entry) => entry.id === member.id);
      const current = now.party.find((entry) => entry.id === member.id);
      if (!then || !current) continue;
      if (current.hitPoints !== then.hitPoints) add(`p${member.id}hp`, `${member.name}: hit points ${then.hitPoints} → ${current.hitPoints}`, () => (current.hitPoints = then.hitPoints));
      if (current.poison !== then.poison) add(`p${member.id}poison`, `${member.name}: poison ${then.poison} → ${current.poison}`, () => (current.poison = then.poison));
      if (current.radiation !== then.radiation) add(`p${member.id}rad`, `${member.name}: radiation ${then.radiation} → ${current.radiation}`, () => (current.radiation = then.radiation));
      this.itemChanges(add, `p${member.id}`, `${member.name}: `, then.items, current.items);
    }
    return list;
  });

  /** The changes to a list of carried things, from `was` to `now`. */
  private itemChanges(add: (id: string, text: string, undo: () => void) => void, prefix: string, owner: string, was: Carried[], now: Carried[]): void {
    const kept = new Map(now.map((item) => [item.key, item]));
    was.forEach((item, index) => {
      const name = this.proto(item.pid)?.name ?? `Item ${item.pid}`;
      const current = kept.get(item.key);
      if (!current) {
        add(`${prefix}gone${item.key}`, `${owner}${owner ? 'took out' : 'Took out'} ${item.quantity > 1 ? `${number(item.quantity)} × ` : ''}${name}`, () => {
          // Back where it was in the list.
          const after = was.slice(0, index).map((entry) => entry.key);
          let at = 0;
          now.forEach((entry, position) => after.includes(entry.key) && (at = position + 1));
          now.splice(at, 0, { ...item });
        });
      } else if (current.quantity !== item.quantity) {
        add(`${prefix}count${item.key}`, `${owner}${name} ${number(item.quantity)} → ${number(current.quantity)}`, () => (current.quantity = item.quantity));
      }
    });
    for (const item of now) {
      if (item.original) continue;
      add(`${prefix}new${item.key}`, `${owner}${owner ? 'added' : 'Added'} ${item.quantity > 1 ? `${number(item.quantity)} × ` : ''}${this.proto(item.pid)?.name ?? `Item ${item.pid}`}`, () => {
        const at = now.findIndex((entry) => entry.key === item.key);
        if (at >= 0) now.splice(at, 1);
      });
    }
  }

  // -------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------

  /** Writes the changes into the slot. The save as it was becomes an earlier version. */
  async write(): Promise<void> {
    const record = $state.snapshot(this.record) as SaveRecord;
    const party = this.original.party;
    // The party's map and the player's pack must not number two new things alike.
    const taken = new Set<number>(party?.ids ?? []);
    const data = writeSave(this.rules, this.catalog, this.original, record, {
      areaSizes: this.areaSizes(),
      takenIds: taken,
    });
    let partyMap: Uint8Array | null = null;
    if (party && partyChanged(party, record.party)) {
      const fresh = readSave(data, this.original.layout, (pid) => this.catalog.items.get(pid)?.kind);
      partyMap = await writeParty(this.session.data, this.catalog, party, record.party, usedIds(fresh.map.items));
    }
    const savedAt = await storeSession(this.session, data, partyMap);
    markForContinue(this.session.game, this.session.slot, savedAt);
    // From here on the save in the slot is the one being changed.
    const updatedParty = party && partyMap ? await refreshParty(this, partyMap) : party;
    const original = readSave(data, this.original.layout, (pid) => this.catalog.items.get(pid)?.kind, updatedParty);
    this.session = { ...this.session, original, savedAt };
    this.record = copyRecord(original.record);
    this.generation++;
  }

  /** The size of each area's circle on Fallout 2's world map, by area. */
  private areaSizes(): number[] {
    const sizes: number[] = [];
    for (const area of this.world.areas) sizes[area.index] = area.size;
    return sizes;
  }

  /** Whether curing an addiction would also take back a withdrawal already under way. */
  withdrawalUnderway(variable: number): boolean {
    const probe = copyRecord(this.original.record);
    probe.globals[variable] = 0;
    return curedWithdrawals(this.original, probe).some((event) => event.data[0] === 0);
  }

  /** The addiction variables this engine knows of. */
  get addictionVariables(): number[] {
    return addictionVariables(this.original.layout);
  }

  /** General reputation in words, for a karma (Fallout 2's engine). */
  standing(karma: number): string {
    return standing(this.world, karma);
  }

  townWord(value: number): string {
    return this.world.townWords[townStanding(value)] ?? '';
  }
}

/** The party read again out of the map just written. */
function refreshParty(editor: Editor, packed: Uint8Array) {
  const party = editor.original.party!;
  return readParty(
    editor.session.data,
    editor.catalog,
    [{ key: party.key, path: party.path, data: packed }],
    party.key.slice(0, party.key.lastIndexOf('/') + 1),
    party.key.slice(party.key.lastIndexOf('/') + 1).replace(/\.sav$/, ''),
    party.members.map((member) => member.id),
  );
}

/** Weight of a list of carried things, bags and what is in them included. */
function weight(editor: Editor, items: Carried[]): number {
  const weigh = (pid: number, quantity: number) => (editor.catalog.items.get(pid)?.weight ?? 0) * quantity;
  const inside = (list: MappedItem[]): number => list.reduce((sum, item) => sum + weigh(item.pid, item.quantity) + inside(item.contents), 0);
  return items.reduce((sum, item) => sum + weigh(item.pid, item.quantity) + (item.original ? inside(item.original.contents) : 0), 0);
}

/** Whether an item carried holds what a new one would: a stack it can join. */
function sameFresh(editor: Editor, item: Carried): boolean {
  if (!item.original) return true;
  const fresh = editor.proto(item.pid)?.fresh ?? [];
  return (item.original.flags & EQUIPPED) === 0 && fresh.every((word, index) => item.original!.extra[index] === word);
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? Math.round(value) : low));
}

/** "MALE" as "Male". */
export function title(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1).toLowerCase() : text;
}

/** A long text cut to a length, with an ellipsis. */
export function shorten(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}
