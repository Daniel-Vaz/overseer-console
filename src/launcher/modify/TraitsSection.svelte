<script lang="ts">
  import { untrack } from 'svelte';
  import { cardArt } from './art';
  import Card from './Card.svelte';
  import Ledger from './Ledger.svelte';
  import type { LedgerRow, SectionProps } from './section';

  let { editor, say }: SectionProps = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.traits ?? 0));
  $effect(() => {
    editor.cursor.traits = selected;
  });

  const rules = $derived(editor.rules);
  const record = $derived(editor.record);
  const chosen = $derived(record.traits.filter((trait) => trait >= 0).length);

  function toggle(trait: number): void {
    const refused = editor.toggleTrait(trait);
    if (refused) say(refused, true);
  }

  const rows = $derived.by((): LedgerRow[] =>
    rules.traits.map((rule, trait): LedgerRow => {
      const has = record.traits.includes(trait);
      const had = editor.original.record.traits.includes(trait);
      return {
        key: `t${trait}`,
        label: rule.name,
        mark: has ? '*' : '',
        value: has ? 'CHOSEN' : '',
        tone: has !== had ? 'hot' : undefined,
        note: has ? 'ENTER to give this trait up.' : chosen >= 2 ? 'Two traits are chosen: give one up to take this.' : 'ENTER to take this trait.',
        action: () => toggle(trait),
      };
    }),
  );

  const trait = $derived(Math.min(selected, rules.traits.length - 1));
</script>

<div class="modify-main">
  <div class="modify-list">
    <p class="modify-status"><span class="pair"><b>Chosen</b> {chosen} of 2</span></p>
    <Ledger {rows} bind:selected label="Traits" valueWidth={7} />
  </div>
  <Card picture={cardArt(editor.session.pictures, rules.traits[trait]!.picture)} title={rules.traits[trait]!.name} description={rules.traits[trait]!.description}>
    <p>
      <button type="button" class="card-button" onclick={() => toggle(trait)}>
        [ENTER] {record.traits.includes(trait) ? 'Give this trait up' : 'Take this trait'}
      </button>
    </p>
  </Card>
</div>
