<script lang="ts">
  import { untrack } from 'svelte';
  import { DESCRIPTION_LENGTH, NAME_LENGTH, levelHitPoints } from '../../lib/modify/record';
  import { STAT, experienceFor } from '../../lib/modify/rules';
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
  const CARD = { person: 54, level: 7, experience: 8, nextLevel: 9, hitPoints: 10, poison: 11, radiation: 12, skills: 27 } as const;

  const record = $derived(editor.record);
  const rules = $derived(editor.rules);
  const next = $derived(record.level < editor.levelMax ? experienceFor(rules, record.level + 1) : null);
  const gained = $derived(levelHitPoints(rules, editor.original, record));

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
    {
      key: 'heal',
      label: 'Heal fully',
      mark: '+',
      value: 'H',
      tone: 'dim',
      note: 'Hit points to their most, poison and radiation to none.',
      action: () => {
        editor.heal();
        say('Healed: full hit points, no poison, no radiation.');
      },
      card: CARD.hitPoints,
      title: 'Heal fully',
      text: 'Hit points to their most, poison and radiation to none.',
    },
  ]);

  const current = $derived(rows[selected] ?? rows[0]!);

  function onkey(event: KeyboardEvent): boolean {
    if (event.key.toLowerCase() !== 'h') return false;
    editor.heal();
    say('Healed: full hit points, no poison, no radiation.');
    return true;
  }
</script>

<div class="modify-main">
  <div class="modify-list">
    <Ledger {rows} bind:selected label="Character" {onkey} valueWidth={14} />
  </div>
  <Card picture={cardArt(editor.session.pictures, current.card)} title={current.title} description={current.text}>
    {#if current.key === 'level' || current.key === 'experience'}
      <p>
        <span class="pair"><b>Level</b> {record.level}</span>
        <span class="pair"><b>Next</b> {next === null ? '-' : thousands(next)}</span>
      </p>
      {#if record.level > editor.original.record.level}
        <p class="hot">+{gained} hit points with the new levels. Skill points and perks come from the game's own character screen, the next time it is opened.</p>
      {/if}
    {:else if current.key === 'hp' || current.key === 'heal'}
      <p><span class="pair"><b>Hit points</b> {editor.hitPoints} / {editor.stat(STAT.maxHitPoints)}</span></p>
    {/if}
  </Card>
</div>
