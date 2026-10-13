<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { isTyping } from '../keys';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { items, label = 'Options', selected = $bindable(0) }: { items: MenuItem[]; label?: string; selected?: number } = $props();

  let list: HTMLUListElement | undefined = $state();

  $effect(() => {
    // Keep the selection on something that can be chosen as the list changes.
    if (selected >= items.length) selected = Math.max(0, items.length - 1);
  });

  // What the selected entry does is said on the line under the screen: a list
  // longer than the screen would otherwise scroll its own explanation away.
  const owner = {};
  $effect(() => {
    sys.explain(owner, items[selected]?.note ?? '', items.some((item) => item.note));
  });
  onDestroy(() => sys.explain(owner, null));

  /**
   * Brings the selected entry into view. Asked for when a key moved the
   * selection, never when the pointer did: a list must not move under it.
   */
  function reveal(): void {
    void tick().then(() => list?.querySelector('li.selected')?.scrollIntoView({ block: 'nearest' }));
  }

  function step(delta: number): void {
    if (!items.length) return;
    selected = (selected + delta + items.length) % items.length;
    sfx.move();
    reveal();
  }

  function activate(index: number): void {
    const item = items[index];
    if (!item) return;
    selected = index;
    if (item.disabled) {
      sfx.deny();
      return;
    }
    if (item.key === '0') sfx.back();
    else sfx.select();
    item.action();
  }

  /** Steps the choice an entry holds, where it holds one. */
  function adjust(direction: 1 | -1): boolean {
    const item = items[selected];
    if (!item?.adjust || item.disabled) return false;
    sfx.select();
    item.adjust(direction);
    return true;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) return;
    switch (event.key) {
      case 'ArrowDown':
        step(1);
        break;
      case 'ArrowUp':
        step(-1);
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
        if (!adjust(event.key === 'ArrowRight' ? 1 : -1)) return;
        break;
      case 'Home':
        selected = 0;
        reveal();
        break;
      case 'End':
        selected = items.length - 1;
        reveal();
        break;
      case 'Enter':
      case ' ':
        activate(selected);
        break;
      default: {
        const index = items.findIndex((item) => item.key.toLowerCase() === event.key.toLowerCase());
        if (index < 0) return;
        activate(index);
        reveal();
      }
    }
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<ul class="menu" aria-label={label} bind:this={list}>
  {#each items as item, index (item.key)}
    {#if item.group !== items[index - 1]?.group}
      {#if item.group}
        <li class="group" role="presentation">{item.group}</li>
      {:else if index > 0}
        <li class="group none" role="presentation"></li>
      {/if}
    {/if}
    <li class:selected={index === selected}>
      <button
        type="button"
        class:danger={item.danger}
        tabindex={index === selected ? 0 : -1}
        disabled={item.disabled}
        aria-current={index === selected ? 'true' : undefined}
        onclick={() => activate(index)}
        onpointermove={() => (selected = index)}
        onfocus={() => (selected = index)}
      >
        <span class="key">[{item.key.toUpperCase()}]</span>
        <span class="label">{item.label}</span>
        <span class="leader" aria-hidden="true"></span>
        <span class="state" class:amber={item.tone === 'amber'} class:alert={item.tone === 'alert'}>{item.state ?? ''}</span>
      </button>
    </li>
  {/each}
</ul>
