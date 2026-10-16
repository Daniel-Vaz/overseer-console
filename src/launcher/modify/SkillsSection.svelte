<script lang="ts">
  import { untrack } from 'svelte';
  import { pointValue, skillCost, tagLimit } from '../../lib/modify/rules';
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

  /** By the rules: points bought with unspent points, a step at a time. */
  function pay(skill: number, direction: 1 | -1, times: number): void {
    const refused = editor.paySkill(skill, direction, times);
    if (refused) say(refused, true);
  }

  const rows = $derived.by((): LedgerRow[] =>
    rules.skills.map((rule, skill): LedgerRow => {
      const value = editor.skill(skill);
      const points = record.skills[skill]!;
      const isTagged = record.tags.includes(skill);
      const cost = skillCost(rules, editor.sheet, skill);
      const bought = points - (editor.original.record.skills[skill] ?? 0);
      return {
        key: `k${skill}`,
        label: rule.name,
        mark: isTagged ? '*' : '',
        value: `${value}%`,
        tone: points !== editor.original.record.skills[skill] ? 'hot' : undefined,
        note: editor.byRules
          ? `${isTagged ? 'Tagged. ' : ''}→ buys a point for ${cost} unspent (${pointValue(rules, editor.sheet, skill)}% a point), ← sells one bought here. ENTER to type a value.`
          : `${isTagged ? 'Tagged. ' : ''}←→ a point at a time (${pointValue(rules, editor.sheet, skill)}% each), ENTER to type a value, T to ${isTagged ? 'take the tag off' : 'tag'}.`,
        less: editor.byRules ? bought > 0 : points > 0,
        more: value < rules.skillMax && (!editor.byRules || record.unspent >= cost),
        adjust: (direction, big) => (editor.byRules ? pay(skill, direction, big ? 10 : 1) : editor.setSkillPoints(skill, points + direction * (big ? 10 : 1))),
        input: {
          value: String(value),
          maxLength: 3,
          numeric: true,
          apply: (text) => {
            const target = typed(text);
            if (target === null) return;
            if (!editor.byRules) {
              editor.setSkillValue(skill, Math.min(rules.skillMax, target));
              return;
            }
            // Bought or sold a point at a time, as far as the points allow.
            const direction = target > value ? 1 : -1;
            let refused: string | null = null;
            for (let guard = 0; guard < 600 && (direction > 0 ? editor.skill(skill) < Math.min(target, rules.skillMax) : editor.skill(skill) > target) && !refused; guard++) {
              refused = editor.paySkill(skill, direction);
            }
            if (refused) say(refused, true);
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

  function switchRules(): void {
    editor.byRules = !editor.byRules;
    say(editor.byRules ? 'By the rules: skills cost unspent points, as on the character screen.' : 'Free: skills are set as wanted.');
  }

  function onkey(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    if (key === 't') {
      toggle();
      return true;
    }
    if (key === 'p') {
      switchRules();
      return true;
    }
    return false;
  }
</script>

<div class="modify-main">
  <div class="modify-list">
    <p class="modify-status">
      <span class="pair"><b>Tagged</b> {tagged} of {limit}</span>
      <span class="pair"><b>Unspent points</b> {record.unspent}</span>
      <button type="button" class="chip" class:on={editor.byRules} onclick={switchRules}>[P] {editor.byRules ? 'BY THE RULES' : 'FREE'}</button>
    </p>
    <Ledger {rows} bind:selected label="Skills" {onkey} valueWidth={5} />
  </div>
  <Card picture={cardArt(editor.session.pictures, rule.picture)} title={rule.name} description={rule.description}>
    <p>
      <span class="pair"><b>Now</b> {editor.skill(skill)}%</span>
      <span class="pair"><b>Points spent</b> {record.skills[skill]}</span>
    </p>
    {#if rules.costs}<p><span class="pair"><b>Next point costs</b> {skillCost(rules, editor.sheet, skill)}</span></p>{/if}
    {#if rule.attributes}<p class="dim">{rule.attributes}</p>{/if}
    <p>
      <button type="button" class="card-button" onclick={toggle}>
        [T] {record.tags.includes(skill) ? 'Take the tag off' : 'Tag this skill'}
      </button>
    </p>
  </Card>
</div>
