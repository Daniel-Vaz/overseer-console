<script lang="ts">
  import { untrack } from 'svelte';
  import { CARDS, TOWN_PICTURES, townStanding } from '../../lib/modify/world';
  import { cardArt } from './art';
  import Card from './Card.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper, thousands } from './section';

  // The character screen's Karma and Kills: karma and what it earns, the
  // reputations scripts hand out, each town's, the addictions, and what was
  // killed. All but the kills are the game's global variables.
  let { editor, say }: SectionProps = $props();
  let selected = $state(untrack(() => editor.cursor.karma ?? 0));
  $effect(() => {
    editor.cursor.karma = selected;
  });

  const world = $derived(editor.world);
  const rules = $derived(editor.rules);
  const record = $derived(editor.record);
  const karma = $derived(world.karma ? editor.global(world.karma.variable) : 0);

  interface Line extends LedgerRow {
    card: number;
    title: string;
    text: string;
    /** What the card shows below its title, if anything. */
    facts?: string[];
  }

  const changed = (index: number) => editor.global(index) !== (editor.original.record.globals[index] ?? 0);

  function toggle(variable: number, label: string, on: string, off: string): void {
    const now = editor.global(variable);
    const was = editor.original.record.globals[variable] ?? 0;
    editor.setGlobal(variable, now ? 0 : was || 1);
    say(now ? off : on.replace('%', label));
  }

  const rows = $derived.by((): Line[] => {
    const lines: Line[] = [];
    if (world.karma) {
      const karmaVar = world.karma.variable;
      const earned = editor.standing(karma);
      lines.push({
        key: 'karma',
        label: 'Karma',
        value: thousands(karma),
        tone: changed(karmaVar) ? 'hot' : undefined,
        note: `${earned ? `${earned}. ` : ''}←→ by 10 (SHIFT: by 100), ENTER to type.`,
        card: world.karma.picture >= 0 ? world.karma.picture : CARDS.karma,
        title: world.karma.name || 'Karma',
        text: world.karma.description,
        facts: earned ? [earned] : undefined,
        ...stepper({ current: karma, set: (value) => editor.setGlobal(karmaVar, Math.max(-99_999, Math.min(99_999, value))), min: -99_999, max: 99_999, step: 10, bigStep: 100, digits: 6 }),
      });
    }
    const repName = rules.pcStats[3]?.name || 'Reputation';
    lines.push({
      key: 'reputation',
      label: `${repName} statistic`,
      value: String(record.reputation),
      tone: record.reputation !== editor.original.record.reputation ? 'hot' : record.reputation ? undefined : 'dim',
      note: 'A statistic of the player that runs from -20 to 20. What scripts mostly ask about is karma, above. ←→ to change.',
      card: CARDS.reputation,
      title: repName,
      text: rules.pcStats[3]?.description ?? '',
      ...stepper({ current: record.reputation, set: (value) => editor.setReputation(value), min: -20, max: 20, digits: 3 }),
    });

    for (const title of world.titles) {
      const value = editor.global(title.variable);
      lines.push({
        key: `t${title.variable}`,
        group: 'REPUTATIONS',
        label: title.name,
        mark: value ? '*' : '',
        value: value ? (value === 1 ? 'EARNED' : `EARNED (${value})`) : '',
        tone: changed(title.variable) ? 'hot' : value ? undefined : 'dim',
        note: value ? 'ENTER to take it away.' : 'ENTER to give it: the character screen lists it, and scripts that ask for it see it.',
        card: title.picture,
        title: title.name,
        text: title.description,
        action: () => toggle(title.variable, title.name, 'Given: %.', `Taken away: ${title.name}.`),
      });
    }

    for (const town of world.towns) {
      const value = editor.global(town.variable);
      const standing = townStanding(value);
      lines.push({
        key: `r${town.variable}`,
        group: 'TOWNS',
        label: town.name,
        value: `${value} ${world.townWords[standing] ?? ''}`.trim(),
        tone: changed(town.variable) ? 'hot' : value === 0 ? 'dim' : undefined,
        note: `What ${town.name} thinks of the character. ←→ by 1 (SHIFT: by 5), ENTER to type.`,
        card: TOWN_PICTURES[standing]!,
        title: town.name,
        text: world.townNotes[standing] ?? '',
        facts: [`${world.townWords[standing] ?? ''}: ${value}`, 'Idolized from 30, liked from 15, accepted above 0; hated below -15, vilified below -30.'],
        ...stepper({ current: value, set: (next) => editor.setGlobal(town.variable, Math.max(-999, Math.min(999, next))), min: -999, max: 999, step: 1, bigStep: 5, digits: 4 }),
      });
    }

    const cure = editor.canCure();
    for (const addiction of world.addictions) {
      const value = editor.global(addiction.variable);
      const underway = value !== 0 && cure && editor.withdrawalUnderway(addiction.variable);
      lines.push({
        key: `a${addiction.variable}`,
        group: 'ADDICTIONS',
        label: addiction.name,
        mark: value ? '*' : '',
        value: value ? 'ADDICTED' : '',
        tone: changed(addiction.variable) ? 'hot' : value ? 'amber' : 'dim',
        note: value ? `ENTER to cure it${underway ? ', and end the withdrawal under way' : ''}.` : 'Not addicted. ENTER to make the character so (the withdrawal comes with the next dose).',
        card: addiction.picture,
        title: addiction.name,
        text: addiction.description,
        facts: underway ? ['A withdrawal is under way: curing it takes back what it costs.'] : undefined,
        action: () => toggle(addiction.variable, addiction.name, 'Addicted: %.', `Cured: ${addiction.name}.`),
      });
    }

    world.kills.forEach((kind, index) => {
      if (!kind.name || index >= record.kills.length) return;
      const count = record.kills[index]!;
      lines.push({
        key: `k${index}`,
        group: 'KILLS',
        label: kind.name,
        value: thousands(count),
        tone: count !== editor.original.record.kills[index] ? 'hot' : count ? undefined : 'dim',
        note: '←→ by 1 (SHIFT: by 10), ENTER to type.',
        card: CARDS.kills,
        title: kind.name,
        text: kind.description,
        ...stepper({ current: count, set: (value) => editor.setKills(index, value), min: 0, max: 999_999, digits: 6 }),
      });
    });
    return lines;
  });

  const current = $derived(rows[selected] ?? rows[0]!);
  const total = $derived(record.kills.reduce((sum, count) => sum + count, 0));
</script>

<div class="modify-main">
  <div class="modify-list">
    <p class="modify-status">
      {#if world.karma}<span class="pair"><b>Karma</b> {thousands(karma)}{#if editor.standing(karma)}&nbsp;· {editor.standing(karma).toUpperCase()}{/if}</span>{/if}
      <span class="pair"><b>Kills</b> {thousands(total)}</span>
    </p>
    <Ledger {rows} bind:selected label="Karma and kills" valueWidth={16} />
  </div>
  <Card picture={cardArt(editor.session.pictures, current.card)} title={current.title} description={current.text}>
    {#if current.facts}
      {#each current.facts as fact (fact)}<p>{fact}</p>{/each}
    {/if}
  </Card>
</div>
