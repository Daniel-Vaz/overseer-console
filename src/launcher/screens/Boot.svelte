<script lang="ts">
  import { onMount } from 'svelte';
  import { GAMES, GAME_IDS } from '../../lib/games';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';

  let { ondone }: { ondone: () => void } = $props();

  interface Line {
    label: string;
    value: string;
    tone?: 'amber' | 'alert';
  }

  let lines = $state<Line[]>([]);
  let greeting = $state(false);
  let finished = false;

  function deck(game: 'fo1' | 'fo2'): Line {
    const install = sys.installs[game];
    return {
      label: `HOLODISK DECK ${game === 'fo1' ? 'A' : 'B'}`,
      value: install ? `${GAMES[game].title.toUpperCase()} LOADED` : 'EMPTY',
      tone: install ? undefined : 'amber',
    };
  }

  // Every line reports something real about this browser.
  const steps: (() => Line)[] = [
    () => ({ label: 'PHOSPHOR TUBE', value: 'WARM' }),
    () => ({ label: 'CORE MEMORY', value: `${navigator.hardwareConcurrency ?? 1} PROCESSORS ONLINE` }),
    () =>
      sys.supported
        ? { label: 'PRIVATE STORAGE', value: sys.storage?.persisted ? 'SEALED' : 'AVAILABLE' }
        : { label: 'PRIVATE STORAGE', value: 'UNAVAILABLE', tone: 'alert' },
    ...GAME_IDS.map((game) => () => deck(game)),
    () => ({ label: 'EXTERNAL NETWORK', value: 'NOT REQUIRED' }),
  ];

  function finish(): void {
    if (finished) return;
    finished = true;
    ondone();
  }

  onMount(() => {
    sys.hints = [['ANY KEY', 'SKIP']];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, reduced ? 0 : ms));

    void (async () => {
      await wait(650);
      for (const step of steps) {
        if (cancelled) return;
        lines.push(step());
        sfx.type();
        await wait(190);
      }
      greeting = true;
      await wait(900);
      if (!cancelled) finish();
    })();

    const skip = (event: Event) => {
      event.preventDefault();
      finish();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  });
</script>

<p class="hot">OVERSEER CONSOLE</p>
<p class="dim">UNIFIED VAULT TERMINAL, RELEASE 2.77</p>

<dl class="readout gap" aria-live="polite">
  {#each lines as line (line.label)}
    <dt>{line.label}</dt>
    <dd class:amber={line.tone === 'amber'} class:alert={line.tone === 'alert'}>{line.value}</dd>
  {/each}
</dl>

{#if greeting}
  <p class="gap">WELCOME BACK, OVERSEER.<span class="cursor"></span></p>
{:else}
  <p class="gap"><span class="cursor"></span></p>
{/if}
