<script lang="ts">
  import { untrack } from 'svelte';
  import { requirements, type PerkRule } from '../../lib/modify/rules';
  import { cardArt } from './art';
  import Card from './Card.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper } from './section';

  let { editor, say }: SectionProps = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.perks ?? 0));
  $effect(() => {
    editor.cursor.perks = selected;
  });

  type Filter = 'all' | 'taken' | 'open';
  let filter = $state<Filter>('all');
  const FILTERS: Filter[] = ['all', 'taken', 'open'];
  const FILTER_NAMES: Record<Filter, string> = { all: 'ALL', taken: 'TAKEN', open: 'CAN BE TAKEN' };

  const rules = $derived(editor.rules);
  const record = $derived(editor.record);
  const owedLimit = $derived(rules.engine === 'fo1' ? 1 : 250);

  interface Line extends LedgerRow {
    perk?: PerkRule;
  }

  const shown = $derived(
    editor.perks.filter((perk) => {
      const rank = record.perks[perk.id] ?? 0;
      if (filter === 'taken') return rank > 0;
      if (filter === 'open') return rank < perk.maxRank && requirements(rules, editor.sheet, perk).met;
      return true;
    }),
  );

  const rows = $derived.by((): Line[] => [
    {
      key: 'owed',
      label: 'Perks owed',
      value: String(record.perksOwed),
      tone: record.perksOwed !== editor.original.record.perksOwed ? 'hot' : record.perksOwed ? 'amber' : 'dim',
      note: `Perks the game lets the character choose the next time its character screen opens. ←→ to change.`,
      ...stepper({ current: record.perksOwed, set: (value) => editor.setPerksOwed(value), min: 0, max: owedLimit, digits: 3 }),
    },
    ...shown.map((perk): Line => {
      const rank = record.perks[perk.id] ?? 0;
      const met = requirements(rules, editor.sheet, perk).met;
      return {
        key: `p${perk.id}`,
        group: 'PERKS',
        perk,
        label: perk.name,
        mark: rank > 0 ? '*' : '',
        value: `${rank}/${perk.maxRank}`,
        tone: rank !== (editor.original.record.perks[perk.id] ?? 0) ? 'hot' : rank > 0 ? undefined : met ? undefined : 'dim',
        note:
          perk.maxRank > 1
            ? `Rank ${rank} of ${perk.maxRank}. ←→ to change, ENTER for the next rank.`
            : rank
              ? 'Taken. ENTER or ← to give it up.'
              : `${met ? '' : 'Its requirements are not met, but it can be taken all the same. '}ENTER or → to take it.`,
        less: rank > 0,
        more: rank < perk.maxRank,
        adjust: (direction) => editor.setPerkRank(perk, rank + direction),
        action: () => editor.setPerkRank(perk, rank >= perk.maxRank ? 0 : rank + 1),
      };
    }),
    ...editor.given.map(
      (perk): Line => ({
        key: `g${perk.id}`,
        group: 'GIVEN BY THE GAME',
        perk,
        label: perk.name,
        mark: '*',
        value: (record.perks[perk.id] ?? 0) > 1 ? `x${record.perks[perk.id]}` : '',
        locked: true,
        note: 'The game gives this and takes it away itself: an addiction, a reputation, an implant. It is left as it is.',
      }),
    ),
  ]);

  const current = $derived(rows[selected] ?? rows[0]!);
  const needs = $derived(current.perk ? requirements(rules, editor.sheet, current.perk) : null);

  function cycle(): void {
    filter = FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length]!;
    selected = 0;
    say(`Showing ${filter === 'all' ? 'every perk' : filter === 'taken' ? 'the perks taken' : 'the perks that can be taken'}.`);
  }

  function onkey(event: KeyboardEvent): boolean {
    if (event.key.toLowerCase() !== 'f') return false;
    cycle();
    return true;
  }
</script>

<div class="modify-main">
  <div class="modify-list">
    <p class="modify-status">
      <span class="pair"><b>Taken</b> {editor.perks.reduce((sum, perk) => sum + (record.perks[perk.id] ? 1 : 0), 0)}</span>
      <button type="button" class="chip" onclick={cycle}>[F] {FILTER_NAMES[filter]}</button>
    </p>
    <Ledger {rows} bind:selected label="Perks" {onkey} valueWidth={5} empty="NO PERKS TO SHOW. F TO SHOW OTHERS." />
  </div>
  {#if current.perk}
    <Card picture={cardArt(editor.session.pictures, current.perk.picture)} title={current.perk.name} description={current.perk.description}>
      {#if current.perk.maxRank > 0}
        <p><span class="pair"><b>Rank</b> {record.perks[current.perk.id] ?? 0} of {current.perk.maxRank}</span></p>
        {#if needs}
          <ul class="needs" aria-label="Requirements">
            {#each needs.list as need (need.text)}
              <li class:amber={!need.met}>{need.met ? '+' : '-'} {need.text}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </Card>
  {:else}
    <Card picture={cardArt(editor.session.pictures, 71)} title="Perks owed" description="When a character gains enough levels the game offers a perk to choose. The character screen offers the ones owed the next time it opens." />
  {/if}
</div>
