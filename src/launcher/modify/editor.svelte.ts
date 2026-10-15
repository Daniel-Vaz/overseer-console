/**
 * The save editor's state: the record being changed, what follows from it by
 * the game's rules, and every change made so far, each with a way back.
 *
 * Shared by the sections of the editor screen. Nothing here is written to
 * the save until write() is asked for.
 */
import { markForContinue } from '../../lib/saves';
import type { ItemProto } from '../../lib/modify/catalog';
import {
  MAX_QUANTITY,
  copyRecord,
  equipped,
  experienceAt,
  hasTagPerk,
  hitPoints,
  levelHitPoints,
  readSave,
  sheetOf,
  writeSave,
  type Carried,
  type SaveRecord,
} from '../../lib/modify/record';
import {
  PRIMARY,
  STAT,
  choosable,
  effectiveStat,
  levelFor,
  pointValue,
  skillValue,
  tagLimit,
  type PerkRule,
} from '../../lib/modify/rules';
import { EQUIPPED, type MappedItem } from '../../lib/modify/savemap';
import { storeSession, type EditorSession } from '../../lib/modify/session';
import { GAMES } from '../../lib/games';

export interface Change {
  id: string;
  text: string;
  undo: () => void;
}

/** Most of a skill the editor lets a character spend on: the game's ceiling is reached well before. */
const MAX_SKILL_POINTS = 300;

const number = (value: number) => value.toLocaleString('en-US');

export class Editor {
  session: EditorSession;
  record = $state<SaveRecord>() as SaveRecord;
  /** Bumped when the save under the editor is replaced, after writing. */
  generation = $state(0);
  /** Whether the list of everything the game has is open, to add from. */
  picking = $state(false);
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
    return GAMES[this.session.game].world;
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
  carried = $derived.by(() => {
    const weigh = (pid: number, quantity: number) => (this.catalog.items.get(pid)?.weight ?? 0) * quantity;
    const inside = (items: MappedItem[]): number => items.reduce((sum, item) => sum + weigh(item.pid, item.quantity) + inside(item.contents), 0);
    return this.record.items.reduce((sum, item) => sum + weigh(item.pid, item.quantity) + (item.original ? inside(item.original.contents) : 0), 0);
  });

  proto(pid: number): ItemProto | undefined {
    return this.catalog.items.get(pid);
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
    const stack = this.record.items.find((item) => item.pid === pid && !equipped(item) && (!item.original || !item.original.contents.length) && sameFresh(this, item));
    if (stack) {
      stack.quantity = clamp(stack.quantity + quantity, 1, MAX_QUANTITY);
      return stack.key;
    }
    const key = `n${this.nextKey++}`;
    this.record.items.push({ key, pid, quantity: clamp(quantity, 1, MAX_QUANTITY) });
    return key;
  }

  /** Back to the save as it is in its slot. */
  reset(): void {
    this.record = copyRecord(this.original.record);
  }

  // -------------------------------------------------------------------
  // What has changed
  // -------------------------------------------------------------------

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

    const kept = new Map(now.items.map((item) => [item.key, item]));
    was.items.forEach((item, index) => {
      const name = this.proto(item.pid)?.name ?? `Item ${item.pid}`;
      const current = kept.get(item.key);
      if (!current) {
        add(`gone${item.key}`, `Took out ${item.quantity > 1 ? `${number(item.quantity)} × ` : ''}${name}`, () => {
          // Back where it was in the list.
          const after = was.items.slice(0, index).map((entry) => entry.key);
          let at = 0;
          now.items.forEach((entry, position) => after.includes(entry.key) && (at = position + 1));
          now.items.splice(at, 0, { ...item });
        });
      } else if (current.quantity !== item.quantity) {
        add(`count${item.key}`, `${name} ${number(item.quantity)} → ${number(current.quantity)}`, () => (current.quantity = item.quantity));
      }
    });
    for (const item of now.items) {
      if (item.original) continue;
      add(`new${item.key}`, `Added ${item.quantity > 1 ? `${number(item.quantity)} × ` : ''}${this.proto(item.pid)?.name ?? `Item ${item.pid}`}`, () => {
        const at = now.items.findIndex((entry) => entry.key === item.key);
        if (at >= 0) now.items.splice(at, 1);
      });
    }
    return list;
  });

  // -------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------

  /** Writes the changes into the slot. The save as it was becomes an earlier version. */
  async write(): Promise<void> {
    const record = $state.snapshot(this.record) as SaveRecord;
    const data = writeSave(this.rules, this.catalog, this.original, record);
    const savedAt = await storeSession(this.session, data);
    markForContinue(this.session.game, this.session.slot, savedAt);
    // From here on the save in the slot is the one being changed.
    const original = readSave(data, this.original.layout, (pid) => this.catalog.items.get(pid)?.kind);
    this.session = { ...this.session, original, savedAt };
    this.record = copyRecord(original.record);
    this.generation++;
  }
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
