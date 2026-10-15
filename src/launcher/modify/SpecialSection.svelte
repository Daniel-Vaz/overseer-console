<script lang="ts">
  import { untrack } from 'svelte';
  import { DERIVED, PRIMARY, STAT } from '../../lib/modify/rules';
  import { cardArt } from './art';
  import Card from './Card.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper } from './section';

  let { editor }: SectionProps = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.special ?? 0));
  $effect(() => {
    editor.cursor.special = selected;
  });

  const rules = $derived(editor.rules);
  const record = $derived(editor.record);

  /** "Damage Res." for the derived ones: the names the character screen uses are long. */
  const SHORT: Record<number, string> = {
    [STAT.maxHitPoints]: 'Hit points',
    [STAT.maxActionPoints]: 'Action points',
    [STAT.damageResistance]: 'Damage res.',
    [STAT.radiationResistance]: 'Radiation res.',
    [STAT.poisonResistance]: 'Poison res.',
  };
  const PERCENT = new Set<number>([STAT.damageResistance, STAT.radiationResistance, STAT.poisonResistance, STAT.criticalChance]);

  const rows = $derived.by((): LedgerRow[] =>
    Array.from({ length: PRIMARY }, (_, stat): LedgerRow => {
      const base = record.special[stat]!;
      const effective = editor.stat(stat);
      const word = rules.statWords[Math.min(10, Math.max(1, effective)) - 1] ?? '';
      return {
        key: `s${stat}`,
        label: rules.stats[stat]!.name,
        value: `${String(base).padStart(2)}${effective !== base ? ` (${effective})` : ''} ${word.toUpperCase()}`,
        tone: base !== editor.original.record.special[stat] ? 'hot' : undefined,
        note: effective !== base ? `${base} as chosen, ${effective} with what traits, perks and drugs add. ←→ to change, ENTER to type.` : '←→ to change, ENTER to type.',
        ...stepper({ current: base, set: (value) => editor.setSpecial(stat, value), min: 1, max: 10, digits: 2 }),
      };
    }),
  );

  const stat = $derived(Math.min(selected, PRIMARY - 1));
  const total = $derived(record.special.reduce((sum, value) => sum + value, 0));
</script>

<div class="modify-main">
  <div class="modify-list">
    <Ledger {rows} bind:selected label="S.P.E.C.I.A.L." valueWidth={16} />
    <p class="dim modify-total">TOTAL {total}, A NEW CHARACTER HAS 40</p>
    <dl class="readout derived" aria-label="Derived statistics">
      {#each DERIVED as derived (derived)}
        {@const now = editor.stat(derived)}
        {@const was = editor.was(derived)}
        <dt>{SHORT[derived] ?? rules.stats[derived]!.name}</dt>
        <dd class:hot={now !== was}>
          {now}{PERCENT.has(derived) ? '%' : ''}{#if now !== was}<span class="dim"> (was {was})</span>{/if}
        </dd>
      {/each}
    </dl>
  </div>
  <Card picture={cardArt(editor.session.pictures, rules.stats[stat]!.picture)} title={rules.stats[stat]!.name} description={rules.stats[stat]!.description}>
    <p>
      <span class="pair"><b>Chosen</b> {record.special[stat]}</span>
      <span class="pair"><b>Now</b> {editor.stat(stat)}</span>
    </p>
  </Card>
</div>
