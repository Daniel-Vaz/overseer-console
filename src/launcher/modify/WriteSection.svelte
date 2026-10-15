<script lang="ts">
  import { untrack } from 'svelte';
  import type { GameFacts } from '../../lib/gamefacts';
  import { STAT } from '../../lib/modify/rules';
  import Glyph from '../components/Glyph.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Thumbnail from '../components/Thumbnail.svelte';
  import { parseCharacter, parseSaveHeader } from '../../lib/savefile';
  import { plural } from '../format';
  import Ledger from './Ledger.svelte';
  import type { LedgerRow, SectionProps } from './section';

  let {
    editor,
    say,
    running,
    write,
    palette,
    facts,
  }: SectionProps & { running: boolean; write: () => void; palette: Uint8Array | null; facts: GameFacts | null } = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.write ?? 0));
  $effect(() => {
    editor.cursor.write = selected;
  });

  const changes = $derived(editor.changes);
  const header = $derived(parseSaveHeader(editor.original.data));

  const rows = $derived.by((): LedgerRow[] => [
    ...changes.map(
      (change): LedgerRow => ({
        key: change.id,
        group: 'CHANGES',
        label: change.text,
        value: 'UNDO',
        tone: 'dim',
        note: 'ENTER or U to undo this change.',
        action: () => {
          change.undo();
          say(`Undone: ${change.text}.`);
        },
      }),
    ),
    {
      key: 'write',
      group: 'THE SAVE',
      label: `Write ${plural(changes.length, 'change')} to slot ${String(editor.session.slot).padStart(2, '0')}`,
      mark: '>',
      value: 'W',
      tone: changes.length && !running ? 'hot' : 'dim',
      locked: !changes.length || running,
      note: running
        ? 'The game is running in another tab or window: close it first, or it would save over this.'
        : changes.length
          ? 'The save as it is now is kept under Earlier versions, and can be put back from there.'
          : 'Nothing has been changed yet.',
      action: write,
    },
    {
      key: 'discard',
      group: 'THE SAVE',
      label: 'Discard every change',
      mark: 'x',
      value: 'X',
      tone: 'dim',
      locked: !changes.length,
      note: 'Back to the save as it is in its slot.',
      action: () => {
        editor.reset();
        say('Every change discarded.');
      },
    },
  ]);

  function onkey(event: KeyboardEvent, row: LedgerRow | undefined): boolean {
    const key = event.key.toLowerCase();
    if (key === 'w') {
      if (changes.length && !running) write();
      else say(running ? 'Close the running game first.' : 'Nothing has been changed yet.', true);
      return true;
    }
    if (key === 'x' && changes.length) {
      editor.reset();
      say('Every change discarded.');
      return true;
    }
    if (key === 'u' && row && changes.some((change) => change.id === row.key)) {
      row.action?.();
      return true;
    }
    return false;
  }

  // The sheet the archives will show for the save once written.
  const preview = $derived(parseCharacter(editor.original.data, editor.original.layout));
</script>

<div class="modify-main">
  <div class="modify-list">
    {#if !changes.length}
      <div class="signed gap">
        <Glyph name="ok" />
        <p class="dim">NOTHING CHANGED YET. Every change made in the other sections is listed here, each to be undone on its own.</p>
      </div>
    {/if}
    <Ledger {rows} bind:selected label="Changes" {onkey} valueWidth={5} />
  </div>
  <aside class="board card" aria-label="The save">
    {#if header?.thumbnail && palette}
      <Thumbnail pixels={header.thumbnail} {palette} label="The screen when this game was saved" />
    {/if}
    <div class="card-words">
      <h2 class="card-title">{editor.record.name || header?.character}</h2>
      <p>
        <span class="pair"><b>Level</b> {editor.record.level}</span>
        <span class="pair"><b>HP</b> {editor.hitPoints}/{editor.stat(STAT.maxHitPoints)}</span>
      </p>
      {#if preview && !changes.length}
        <Sheet character={preview} game={editor.session.game} {facts} />
      {:else if changes.length}
        <p class="amber">{plural(changes.length, 'CHANGE', 'CHANGES')} NOT WRITTEN.</p>
      {/if}
    </div>
  </aside>
</div>
