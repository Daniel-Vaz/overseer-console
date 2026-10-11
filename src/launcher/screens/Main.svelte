<script lang="ts">
  import { onMount } from 'svelte';
  import { GAMES, GAME_IDS } from '../../lib/games';
  import { formatBytes } from '../../lib/storage/manifest';
  import Emblem from '../components/Emblem.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['1-6', 'JUMP'],
    ];
  });

  const totalSaves = $derived(sys.saves.fo1 + sys.saves.fo2);
  let selected = $state(0);

  const items = $derived<MenuItem[]>([
    ...GAME_IDS.map((game, index): MenuItem => {
      const def = GAMES[game];
      const install = sys.installs[game];
      const copying = sys.job.game === game && sys.busy;
      return {
        key: String(index + 1),
        label: `${def.label}: ${def.title} (${def.year})`,
        state: copying ? 'LOADING...' : install === undefined ? 'CHECKING' : install ? 'READY' : 'NO HOLODISK',
        tone: install || install === undefined ? undefined : 'amber',
        note: install ? def.blurb : `Needs your own copy of ${def.title}. Open to load it.`,
        icon: 'gamedata',
        action: () => go(game),
      };
    }),
    {
      key: '3',
      label: 'Save archives',
      state: totalSaves ? `${totalSaves} ${totalSaves === 1 ? 'SAVE' : 'SAVES'}` : 'EMPTY',
      note: 'Back up, restore or delete saved games.',
      icon: 'save',
      action: () => go('saves'),
    },
    { key: '4', label: 'Terminal settings', note: 'Picture, sound and storage.', icon: 'settings', action: () => go('settings') },
    {
      key: '5',
      label: 'Operations manual',
      note: 'Where the game files are, controls, and what to do when something fails.',
      icon: 'terminal',
      action: () => go('manual'),
    },
    { key: '6', label: 'Credits and legal', note: 'Who made the engines, and the small print.', action: () => go('credits') },
  ]);

  const icon = $derived(items[selected]?.icon);
</script>

<h1>Main directory</h1>
<p class="sub">Fallout and Fallout 2 in this browser, from your own copy of the games.</p>

{#if !sys.supported}
  <div class="panel bad">
    <p class="alert">PRIVATE STORAGE UNAVAILABLE</p>
    <p>
      This browser will not let the console store game data. That happens in some private windows and in old
      browsers. Try a normal window in a current version of Chrome, Edge, Firefox or Safari.
    </p>
  </div>
{/if}

<div class="columns">
  <div>
    <Menu {items} label="Main directory" bind:selected />
    <p class="gap dim">NOTHING IS UPLOADED. GAME FILES AND SAVES STAY ON THIS DEVICE.</p>
  </div>

  <aside class="board gap" aria-label="Status board">
    {#if icon}
      <Glyph name={icon} />
    {:else}
      <Emblem />
    {/if}
    <dl class="readout">
      {#each GAME_IDS as game (game)}
        <dt>Deck {game === 'fo1' ? 'A' : 'B'}</dt>
        <dd class:amber={sys.installs[game] === null}>
          {sys.installs[game] === undefined ? '...' : sys.installs[game] ? GAMES[game].title.toUpperCase() : 'EMPTY'}
        </dd>
      {/each}
      <dt>Archives</dt>
      <dd>{totalSaves} {totalSaves === 1 ? 'SAVE' : 'SAVES'}</dd>
      <dt>Storage</dt>
      <dd>{sys.storage ? formatBytes(sys.storage.usage) : '...'}</dd>
      <dt>Seal</dt>
      <dd class:amber={sys.storage !== null && !sys.storage.persisted}>{sys.storage?.persisted ? 'SEALED' : 'OPEN'}</dd>
    </dl>
  </aside>
</div>
