<script lang="ts">
  import type { Snippet } from 'svelte';
  import Art from './Art.svelte';

  // What the line under the cursor is, the way the game's own character screen
  // shows it: its picture, its name, and the game's words for it.
  let {
    picture,
    kind = 'card',
    title,
    description = '',
    children,
  }: {
    picture: Promise<string | null> | null;
    kind?: 'card' | 'item';
    title: string;
    description?: string;
    children?: Snippet;
  } = $props();
</script>

<aside class="board card" aria-label={title}>
  <Art src={picture} {kind} />
  <div class="card-words">
    <h2 class="card-title">{title}</h2>
    {#if children}
      <div class="card-facts">{@render children()}</div>
    {/if}
    {#if description}
      <p class="card-text">{description}</p>
    {/if}
  </div>
</aside>
