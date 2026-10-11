<script lang="ts">
  // A holodisk deck: two reels behind a window. They turn while data is copied.
  let {
    label,
    title = '',
    loaded = false,
    spinning = false,
  }: { label: string; title?: string; loaded?: boolean; spinning?: boolean } = $props();

  const reels = [92, 228];
  const spokes = [0, 60, 120];
</script>

<svg class="art" class:spinning viewBox="0 0 320 196" role="img" aria-label={`${label}: ${loaded ? title : 'empty'}`}>
  <rect x="3" y="3" width="314" height="190" rx="10" />
  <rect class="faint" x="22" y="22" width="276" height="100" rx="6" />
  {#each reels as cx (cx)}
    <g class="reel" class:faint={!loaded && !spinning}>
      <circle {cx} cy="72" r="36" stroke-dasharray={loaded || spinning ? undefined : '5 7'} />
      <circle {cx} cy="72" r="9" />
      {#if loaded || spinning}
        {#each spokes as angle (angle)}
          <line x1={cx - 30} y1="72" x2={cx + 30} y2="72" transform={`rotate(${angle} ${cx} 72)`} />
        {/each}
      {/if}
    </g>
  {/each}
  {#if loaded || spinning}
    <polyline points="92,36 228,36" />
    <polyline class="faint" points="62,92 116,112 204,112 258,92" />
  {/if}
  <text x="22" y="150" font-size="20">{label}</text>
  <text x="22" y="176" font-size="20" opacity={loaded ? 1 : 0.55}>{spinning ? 'READING...' : loaded ? title : 'NO HOLODISK'}</text>
  <rect x="270" y="140" width="28" height="12" fill={loaded || spinning ? 'currentColor' : 'none'} />
</svg>
