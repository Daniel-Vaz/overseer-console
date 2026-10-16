<script lang="ts">
  import { untrack } from 'svelte';
  import { DESCRIPTION_LENGTH, NAME_LENGTH, levelHitPoints } from '../../lib/modify/record';
  import { STAT, experienceFor, levelUpGrants } from '../../lib/modify/rules';
  import { plural } from '../format';
  import { cardArt } from './art';
  import Card from './Card.svelte';
  import { title } from './editor.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper, thousands } from './section';

  let { editor, say }: SectionProps = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.record ?? 0));
  $effect(() => {
    editor.cursor.record = selected;
  });

  /** Cards of the character screen for what this section holds. */
  const CARD = { person: 54, level: 7, experience: 8, nextLevel: 9, hitPoints: 10, poison: 11, radiation: 12, skills: 27, special: 0, perks: 71, items: 20, traits: 54 } as const;

  const record = $derived(editor.record);
  const rules = $derived(editor.rules);
  const next = $derived(record.level < editor.levelMax ? experienceFor(rules, record.level + 1) : null);
  const gained = $derived(levelHitPoints(rules, editor.original, record));
  /** What the game's own character screen hands out for levels it has not seen yet. */
  const grants = $derived(levelUpGrants(rules, editor.sheet, editor.original.lastLevel, record.level, record.unspent, record.perksOwed));

  function heal(): void {
    editor.heal();
    say('Healed: full hit points, no poison, no radiation.');
  }

  interface Line extends LedgerRow {
    card: number;
    title: string;
    text: string;
  }

  const rows = $derived.by((): Line[] => [
    {
      key: 'name',
      label: 'Name',
      value: record.name || '(none)',
      tone: record.name ? undefined : 'dim',
      note: `ENTER to type a new name, up to ${NAME_LENGTH} letters.`,
      input: { value: record.name, maxLength: NAME_LENGTH, apply: (text) => editor.setText('name', text.trim()) },
      card: CARD.person,
      title: 'Name',
      text: 'What the game calls the character, on the character screen and in its list of saves.',
    },
    {
      key: 'description',
      label: 'Save description',
      value: record.description || '(none)',
      tone: record.description ? undefined : 'dim',
      note: 'ENTER to type what the list of saves says about this one.',
      input: { value: record.description, maxLength: DESCRIPTION_LENGTH, apply: (text) => editor.setText('description', text.trim()) },
      card: CARD.person,
      title: 'Save description',
      text: 'The line the game and the save archives show for this save.',
    },
    {
      key: 'gender',
      label: 'Gender',
      value: title(rules.genders[record.gender] ?? ''),
      note: '←→ or ENTER to change.',
      adjust: () => editor.setGender(1 - record.gender),
      action: () => editor.setGender(1 - record.gender),
      card: CARD.person,
      title: 'Gender',
      text: 'Whom the world takes the character for. In armour, the armour is worn the other way too.',
    },
    {
      key: 'age',
      label: 'Age',
      value: String(record.age),
      note: '←→ to change, ENTER to type.',
      card: CARD.person,
      title: rules.stats[STAT.age]!.name || 'Age',
      text: rules.stats[STAT.age]!.description,
      ...stepper({ current: record.age, set: (value) => editor.setAge(value), min: rules.stats[STAT.age]!.min, max: Math.min(rules.stats[STAT.age]!.max, 99), digits: 2 }),
    },
    {
      key: 'level',
      label: rules.pcStats[1]!.name || 'Level',
      value: `${record.level}`,
      tone: record.level !== editor.original.record.level ? 'hot' : undefined,
      note: `←→ to change, ENTER to type. Up to ${editor.levelMax}.`,
      card: CARD.level,
      title: rules.pcStats[1]!.name || 'Level',
      text: rules.pcStats[1]!.description,
      ...stepper({ current: record.level, set: (value) => editor.setLevel(value), min: 1, max: editor.levelMax, bigStep: 5, digits: 2 }),
    },
    {
      key: 'experience',
      label: rules.pcStats[2]!.name || 'Experience',
      value: thousands(record.experience),
      note: next === null ? 'The highest level there is.' : `${thousands(next - record.experience)} more to the next level. ←→ by 100, with SHIFT by 1,000.`,
      card: CARD.experience,
      title: rules.pcStats[2]!.name || 'Experience',
      text: rules.pcStats[2]!.description,
      ...stepper({ current: record.experience, set: (value) => editor.setExperience(value), min: 0, max: 99_999_999, step: 100, bigStep: 1000, digits: 9 }),
    },
    {
      key: 'unspent',
      label: rules.pcStats[0]!.name || 'Unspent skill points',
      value: String(record.unspent),
      note: 'Points to spend on skills on the character screen. ←→ to change, ENTER to type.',
      card: CARD.skills,
      title: rules.pcStats[0]!.name || 'Unspent skill points',
      text: rules.pcStats[0]!.description,
      ...stepper({ current: record.unspent, set: (value) => editor.setUnspent(value), min: 0, max: 99, digits: 2 }),
    },
    {
      key: 'hp',
      label: 'Hit points',
      value: `${editor.hitPoints} / ${editor.stat(STAT.maxHitPoints)}`,
      tone: editor.hitPoints < editor.stat(STAT.maxHitPoints) / 2 ? 'amber' : undefined,
      note: 'H to heal fully. ←→ to change, ENTER to type.',
      card: CARD.hitPoints,
      title: rules.stats[STAT.maxHitPoints]!.name || 'Hit points',
      text: rules.stats[STAT.maxHitPoints]!.description,
      ...stepper({ current: editor.hitPoints, set: (value) => editor.setHitPoints(value), min: 1, max: editor.stat(STAT.maxHitPoints), digits: 4 }),
    },
    {
      key: 'poison',
      label: 'Poison',
      value: String(record.poison),
      tone: record.poison > 0 ? 'amber' : 'dim',
      note: 'How poisoned the character is: 0 is not at all. ←→ to change, ENTER to type.',
      card: CARD.poison,
      title: 'Poison',
      text: 'Poison in the blood takes hit points as time passes, until it wears off or is cured.',
      ...stepper({ current: record.poison, set: (value) => editor.setPoison(value), min: 0, max: 2000, digits: 4 }),
    },
    {
      key: 'radiation',
      label: 'Radiation',
      value: String(record.radiation),
      tone: record.radiation > 0 ? 'amber' : 'dim',
      note: 'Rads absorbed: 0 is none. Effects already felt wear off as the game would let them. ←→, ENTER to type.',
      card: CARD.radiation,
      title: 'Radiation',
      text: 'Rads absorbed. Enough of them weaken the body; lowering them is what Rad-Away does.',
      ...stepper({ current: record.radiation, set: (value) => editor.setRadiation(value), min: 0, max: 2000, digits: 4 }),
    },
    // Quick actions: each a change of many fields, every one of them listed under Write to be undone on its own.
    {
      key: 'heal',
      group: 'QUICK ACTIONS',
      label: 'Heal fully',
      mark: '+',
      value: 'H',
      tone: 'dim',
      note: 'Hit points to their most, poison and radiation to none.',
      action: heal,
      card: CARD.hitPoints,
      title: 'Heal fully',
      text: 'Hit points to their most, poison and radiation to none.',
    },
    {
      key: 'max-special',
      group: 'QUICK ACTIONS',
      label: 'Every statistic to 10',
      mark: '+',
      value: 'ENTER',
      tone: 'dim',
      note: 'S.P.E.C.I.A.L. at its most, and what follows from it worked out again.',
      action: () => {
        editor.maxSpecial();
        say('S.P.E.C.I.A.L.: every statistic at 10.');
      },
      card: CARD.special,
      title: 'Every statistic to 10',
      text: 'Strength, Perception, Endurance, Charisma, Intelligence, Agility and Luck at 10, and hit points, action points, carry weight and the rest worked out again from them.',
    },
    {
      key: 'max-skills',
      group: 'QUICK ACTIONS',
      label: `Every skill to ${rules.skillMax}%`,
      mark: '+',
      value: 'ENTER',
      tone: 'dim',
      note: 'Each skill at the most the game allows, with the fewest points that reach it.',
      action: () => {
        editor.maxSkills();
        say(`Every skill at ${rules.skillMax}%.`);
      },
      card: CARD.skills,
      title: `Every skill to ${rules.skillMax}%`,
      text: `Each skill brought to ${rules.skillMax}%, the most the game allows, by the fewest points spent on it.`,
    },
    {
      key: 'max-level',
      group: 'QUICK ACTIONS',
      label: `Level ${editor.levelMax}`,
      mark: '+',
      value: 'ENTER',
      tone: 'dim',
      note: 'The highest level there is, with the experience it needs. The game hands out what the levels bring.',
      action: () => {
        editor.maxLevel();
        say(`Level ${editor.levelMax}: the character screen hands out what the levels bring the next time it opens.`);
      },
      card: CARD.level,
      title: `Level ${editor.levelMax}`,
      text: `The highest level there is, ${thousands(experienceFor(rules, editor.levelMax))} experience. The hit points of every level come with it; the game's character screen hands out the skill points and perks the next time it opens.`,
    },
    {
      key: 'good-perks',
      group: 'QUICK ACTIONS',
      label: 'Every perk the game offers',
      mark: '+',
      value: 'ENTER',
      tone: 'dim',
      note: "Every perk at its every rank, but Tag! and Mutate! (and Fallout 2's Here and Now), which ask for a choice of their own.",
      action: () => {
        const added = editor.allGoodPerks();
        say(added ? `${plural(added, 'perk rank')} taken.` : 'Every perk is taken already.');
      },
      card: CARD.perks,
      title: 'Every perk the game offers',
      text: "Every perk the game's level-up screen can offer, at its every rank, whatever it asks for. Tag! and Mutate! ask for a skill or a trait to be chosen as they are taken, and Here and Now for experience, so they are left to the game.",
    },
    {
      key: 'loadout',
      group: 'QUICK ACTIONS',
      label: "The game's best things",
      mark: '+',
      value: 'ENTER',
      tone: 'dim',
      note: 'Its best armour and guns, with ammunition, and medicine, added to what is carried.',
      action: () => {
        const { added, missing } = editor.loadout();
        if (!added.length) say("This game has none of the things this adds: it names them otherwise.", true);
        else say(`Added ${added.join(', ')}.${missing.length ? ` Not in this game: ${missing.join(', ')}.` : ''}`);
      },
      card: CARD.items,
      title: "The game's best things",
      text:
        editor.worldOf === 'fo1'
          ? 'Hardened Power Armor, a Turbo Plasma Rifle with four boxes of Micro Fusion Cells, ten Super Stimpaks and twenty Stimpaks, into the inventory. What is worn and held stays as it is.'
          : 'Advanced Power Armor Mk II, the PPK12 Gauss Pistol and M72 Gauss Rifle with four boxes of 2mm EC, the Bozar with four boxes of .223 FMJ, ten Super Stimpaks and twenty Stimpaks, into the inventory. What is worn and held stays as it is.',
    },
    ...(editor.members.length
      ? [
          {
            key: 'heal-party',
            group: 'QUICK ACTIONS',
            label: 'Heal the party',
            mark: '+',
            value: 'ENTER',
            tone: 'dim' as const,
            note: 'Every companion at full hit points, without poison or radiation.',
            action: () => {
              for (const member of editor.members) editor.healCompanion(member.id);
              say(`Healed ${editor.members.map((member) => member.name).join(', ')}.`);
            },
            card: CARD.hitPoints,
            title: 'Heal the party',
            text: 'Every companion at full hit points, without poison or radiation.',
          },
        ]
      : []),
  ]);

  const current = $derived(rows[selected] ?? rows[0]!);

  function onkey(event: KeyboardEvent): boolean {
    if (event.key.toLowerCase() !== 'h') return false;
    heal();
    return true;
  }
</script>

<div class="modify-main">
  <div class="modify-list">
    <Ledger {rows} bind:selected label="Character" {onkey} valueWidth={16} />
  </div>
  <Card picture={cardArt(editor.session.pictures, current.card)} title={current.title} description={current.text}>
    {#if current.key === 'level' || current.key === 'experience'}
      <p>
        <span class="pair"><b>Level</b> {record.level}</span>
        <span class="pair"><b>Next</b> {next === null ? '-' : thousands(next)}</span>
      </p>
      {#if record.level > editor.original.record.level}
        <p class="hot">+{gained} hit points with the new levels.</p>
      {/if}
      {#if grants.skillPoints || grants.perks}
        <p class="hot">
          The character screen hands out {grants.skillPoints ? plural(grants.skillPoints, 'skill point') : ''}{grants.skillPoints && grants.perks ? ' and ' : ''}{grants.perks ? plural(grants.perks, 'perk') : ''} the next time it opens.
        </p>
      {/if}
    {:else if current.key === 'hp' || current.key === 'heal'}
      <p><span class="pair"><b>Hit points</b> {editor.hitPoints} / {editor.stat(STAT.maxHitPoints)}</span></p>
    {/if}
  </Card>
</div>
