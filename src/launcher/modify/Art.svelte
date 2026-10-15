<script lang="ts">
  // A picture out of the game, once it is drawn. Until then, and where the
  // game has none, an empty frame of the same shape.
  let { src, alt = '', kind }: { src: Promise<string | null> | null; alt?: string; kind: 'card' | 'item' | 'thumb' } = $props();

  let url = $state<string | null>(null);

  $effect(() => {
    const promise = src;
    let current = true;
    url = null;
    void promise?.then((value) => current && (url = value));
    return () => {
      current = false;
    };
  });
</script>

<span class="art-frame art-{kind}" class:empty={!url}>
  {#if url}
    <img src={url} {alt} draggable="false" />
  {/if}
</span>
