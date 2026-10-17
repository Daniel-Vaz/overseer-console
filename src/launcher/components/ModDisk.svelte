<script lang="ts">
  // A mod's holodisk: a cassette with the mod's name on its label, played in the deck of the game it was
  // made for. Its reels turn while it is copied, as a deck's do.
  let {
    label,
    title = '',
    loaded = false,
    spinning = false,
  }: { label: string; title?: string; loaded?: boolean; spinning?: boolean } = $props();

  const reels = [126, 194];
  const spokes = [0, 60, 120];
  const lit = $derived(loaded || spinning);
  // A long name is drawn narrower rather than cut short: the label holds about thirteen letters.
  const squeeze = $derived(title.length > 13 ? (13 / title.length).toFixed(3) : null);
</script>

<svg class="art" class:spinning viewBox="0 0 320 196" role="img" aria-label={`${label}: ${loaded ? title : 'empty'}`}>
  <!-- The shell, with the opening at its foot where the tape runs past. -->
  <path
    class:faint={!lit}
    stroke-dasharray={lit ? undefined : '6 7'}
    d="M14 3 H306 Q317 3 317 14 V193 H250 L234 170 H86 L70 193 H3 V14 Q3 3 14 3 Z"
  />
  <circle class="faint" cx="16" cy="16" r="3" />
  <circle class="faint" cx="304" cy="16" r="3" />
  <!-- The label: the mod's name, and the deck it is played in. -->
  <rect class="faint" x="24" y="16" width="272" height="92" rx="4" />
  {#if title}
    <text x="40" y="54" font-size="26" opacity={lit ? 1 : 0.55} transform={squeeze ? `translate(40 0) scale(${squeeze} 1) translate(-40 0)` : undefined}>{title}</text>
  {/if}
  <text x="40" y="92" font-size="20" opacity={loaded ? 1 : 0.55}>{spinning ? 'READING...' : label}</text>
  <rect x="262" y="82" width="20" height="10" fill={lit ? 'currentColor' : 'none'} />
  <!-- The window over the reels. -->
  <rect class="faint" x="88" y="118" width="144" height="40" rx="19" />
  {#each reels as cx (cx)}
    <g class="reel" class:faint={!lit}>
      <circle {cx} cy="138" r="14" stroke-dasharray={lit ? undefined : '4 5'} />
      {#if lit}
        {#each spokes as angle (angle)}
          <line x1={cx - 10} y1="138" x2={cx + 10} y2="138" transform={`rotate(${angle} ${cx} 138)`} />
        {/each}
      {/if}
    </g>
  {/each}
  {#if lit}
    <polyline class="faint" points="126,152 160,160 194,152" />
  {/if}
</svg>
