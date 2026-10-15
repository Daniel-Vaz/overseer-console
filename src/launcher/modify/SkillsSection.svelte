<script lang="ts">
  import { untrack } from 'svelte';
  import { pointValue, tagLimit } from '../../lib/modify/rules';
  import { cardArt } from './art';
  import Card from './Card.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, typed } from './section';

  let { editor, say }: SectionProps = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.skills ?? 0));
  $effect(() => {
    editor.cursor.skills = selected;
  });

  const rules = $derived(editor.rules);
  const record = $derived(editor.record);
  const tagged = $derived(record.tags.filter((tag) => tag >= 0).length);
  const limit = $derived(tagLimit(editor.sheet));

  const rows = $derived.by((): LedgerRow[] =>
    rules.skills.map((rule, skill): LedgerRow => {
      const value = editor.skill(skill);
      const points = record.skills[skill]!;
      const isTagged = record.tags.includes(skill);
      return {
        key: `k${skill}`,
        label: rule.name,
        mark: isTagged ? '*' : '',
        value: `${value}%`,
        tone: points !== editor.original.record.skills[skill] ? 'hot' : undefined,
        note: `${isTagged ? 'Tagged. ' : ''}←→ a point at a time (${pointValue(rules, editor.sheet, skill)}% each), ENTER to type a value, T to ${isTagged ? 'take the tag off' : 'tag'}.`,
        less: points > 0,
        more: value < rules.skillMax,
        adjust: (direction, big) => editor.setSkillPoints(skill, points + direction * (big ? 10 : 1)),
        input: {
          value: String(value),
          maxLength: 3,
          numeric: true,
          apply: (text) => {
            const target = typed(text);
            if (target !== null) editor.setSkillValue(skill, Math.min(rules.skillMax, target));
          },
        },
      };
    }),
  );

  const skill = $derived(Math.min(selected, rules.skills.length - 1));
  const rule = $derived(rules.skills[skill]!);

  function toggle(): void {
    const refused = editor.toggleTag(skill);
    if (refused) say(refused, true);
  }

  function onkey(event: KeyboardEvent): boolean {
    if (event.key.toLowerCase() !== 't') return false;
    toggle();
    return true;
  }
</script>

<div class="modify-main">
  <div class="modify-list">
    <p class="modify-status">
      <span class="pair"><b>Tagged</b> {tagged} of {limit}</span>
      <span class="pair"><b>Unspent points</b> {record.unspent}</span>
    </p>
    <Ledger {rows} bind:selected label="Skills" {onkey} valueWidth={5} />
  </div>
  <Card picture={cardArt(editor.session.pictures, rule.picture)} title={rule.name} description={rule.description}>
    <p>
      <span class="pair"><b>Now</b> {editor.skill(skill)}%</span>
      <span class="pair"><b>Points spent</b> {record.skills[skill]}</span>
    </p>
    {#if rule.attributes}<p class="dim">{rule.attributes}</p>{/if}
    <p>
      <button type="button" class="card-button" onclick={toggle}>
        [T] {record.tags.includes(skill) ? 'Take the tag off' : 'Tag this skill'}
      </button>
    </p>
  </Card>
</div>
