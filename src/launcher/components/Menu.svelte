<script lang="ts">
  import { sfx } from '../sfx';
  import type { MenuItem } from '../types';

  let { items, label = 'Options', selected = $bindable(0) }: { items: MenuItem[]; label?: string; selected?: number } = $props();

  $effect(() => {
    // Keep the selection on something that can be chosen as the list changes.
    if (selected >= items.length) selected = Math.max(0, items.length - 1);
  });

  function step(delta: number): void {
    if (!items.length) return;
    selected = (selected + delta + items.length) % items.length;
    sfx.move();
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

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowDown':
        step(1);
        break;
      case 'ArrowUp':
        step(-1);
        break;
      case 'Home':
        selected = 0;
        break;
      case 'End':
        selected = items.length - 1;
        break;
      case 'Enter':
      case ' ':
        activate(selected);
        break;
      default: {
        const index = items.findIndex((item) => item.key.toLowerCase() === event.key.toLowerCase());
        if (index < 0) return;
        activate(index);
      }
    }
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<ul class="menu" aria-label={label}>
  {#each items as item, index (item.key)}
    <li class:selected={index === selected}>
      <button
        type="button"
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
<p class="menu-note" aria-live="polite">{items[selected]?.note ?? ''}</p>
