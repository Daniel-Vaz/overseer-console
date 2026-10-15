<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { isTyping } from '../keys';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import Art from './Art.svelte';
  import type { LedgerRow } from './section';

  let {
    rows,
    label,
    selected = $bindable(0),
    onkey,
    valueWidth = 8,
    empty = 'NOTHING HERE.',
  }: {
    rows: LedgerRow[];
    label: string;
    selected?: number;
    /** Keys of the section's own, for the row under the cursor. True when the key was used. */
    onkey?: (event: KeyboardEvent, row: LedgerRow | undefined) => boolean;
    /** Columns the values take. */
    valueWidth?: number;
    empty?: string;
  } = $props();

  let list: HTMLUListElement | undefined = $state();
  /** The row whose value is being typed, and what has been typed. */
  let editing = $state<string | null>(null);
  let draft = $state('');
  let field: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
  });

  const owner = {};
  $effect(() => {
    sys.explain(owner, rows[selected]?.note ?? '', true);
  });
  onDestroy(() => sys.explain(owner, null));

  /** Brings the row under the cursor into view, when a key moved it. */
  function reveal(): void {
    void tick().then(() => list?.querySelector('li.selected')?.scrollIntoView({ block: 'nearest' }));
  }

  // Coming back to a section: where the cursor was is in view.
  onMount(reveal);

  function move(delta: number): void {
    if (!rows.length) return;
    selected = Math.min(rows.length - 1, Math.max(0, selected + delta));
    sfx.move();
    reveal();
  }

  function step(index: number, direction: 1 | -1, big = false): void {
    const row = rows[index];
    if (!row?.adjust || row.locked || (direction < 0 ? row.less === false : row.more === false)) {
      sfx.deny();
      return;
    }
    selected = index;
    sfx.select();
    row.adjust(direction, big);
  }

  function activate(index: number): void {
    const row = rows[index];
    if (!row) return;
    selected = index;
    if (row.locked || (!row.action && !row.input)) {
      sfx.deny();
      return;
    }
    sfx.select();
    if (row.input) {
      editing = row.key;
      draft = row.input.value;
      void tick().then(() => {
        field?.focus();
        field?.select();
      });
    } else {
      row.action!();
    }
  }

  function finish(apply: boolean): void {
    const row = rows.find((entry) => entry.key === editing);
    editing = null;
    if (apply && row?.input) {
      row.input.apply(draft);
      sfx.select();
    } else {
      sfx.back();
    }
    // The keys belong to the list again.
    void tick().then(() => list?.querySelector<HTMLElement>('li.selected .main')?.focus({ preventScroll: true }));
  }

  function onFieldKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === 'Enter');
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) return;
    const row = rows[selected];
    if (onkey?.(event, row)) {
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        move(-rows.length);
        break;
      case 'End':
        move(rows.length);
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
        if (!row?.adjust) return;
        step(selected, event.key === 'ArrowRight' ? 1 : -1, event.shiftKey);
        break;
      case 'Enter':
      case ' ':
        activate(selected);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** A tap on a row picks it; a tap on the row already picked does what ENTER does. */
  function tapped(index: number): void {
    if (index === selected) activate(index);
    else {
      selected = index;
      sfx.move();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<ul class="ledger" aria-label={label} bind:this={list} style:--value-width="{valueWidth}ch">
  {#each rows as row, index (row.key)}
    {#if row.group !== rows[index - 1]?.group}
      <li class="group" class:none={!row.group} role="presentation">{row.group ?? ''}</li>
    {/if}
    <li class:selected={index === selected} class:locked={row.locked}>
      <div class="row">
        <button
          type="button"
          class="main"
          tabindex={index === selected ? 0 : -1}
          aria-current={index === selected ? 'true' : undefined}
          onclick={() => tapped(index)}
          onpointermove={(event) => event.pointerType === 'mouse' && (selected = index)}
        >
          <span class="sign" aria-hidden={!row.mark}>{row.mark ?? ''}</span>
          {#if row.picture !== undefined}
            <Art src={row.picture} kind="thumb" />
          {/if}
          <span class="label">{row.label}</span>
          <span class="leader" aria-hidden="true"></span>
        </button>
        {#if row.adjust && !row.locked}
          <button type="button" class="step" tabindex="-1" aria-label="Less" disabled={row.less === false} onclick={() => step(index, -1)}>&lsaquo;</button>
        {:else}
          <span></span>
        {/if}
        {#if editing === row.key && row.input}
          <input
            class="value-input"
            bind:this={field}
            bind:value={draft}
            maxlength={row.input.maxLength}
            inputmode={row.input.numeric ? 'numeric' : 'text'}
            spellcheck="false"
            autocomplete="off"
            aria-label={row.label}
            onkeydown={onFieldKey}
            onblur={() => editing === row.key && finish(true)}
          />
        {:else}
          <span class="value" class:amber={row.tone === 'amber'} class:alert={row.tone === 'alert'} class:hot={row.tone === 'hot'} class:dim={row.tone === 'dim'}>{row.value ?? ''}</span>
        {/if}
        {#if row.adjust && !row.locked}
          <button type="button" class="step" tabindex="-1" aria-label="More" disabled={row.more === false} onclick={() => step(index, 1)}>&rsaquo;</button>
        {:else}
          <span></span>
        {/if}
      </div>
    </li>
  {:else}
    <li class="empty dim">{empty}</li>
  {/each}
</ul>
