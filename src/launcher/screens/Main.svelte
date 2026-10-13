<script lang="ts">
  import { onMount } from 'svelte';
  import mark from '../../assets/mark.webp';
  import { GAMES, GAME_IDS } from '../../lib/games';
  import { PROJECT_NAME } from '../../lib/project';
  import { formatBytes } from '../../lib/storage/manifest';
  import Emblem from '../components/Emblem.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { ago } from '../format';
  import { launchGame } from '../launch';
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

  // The games kept a surprise for whoever held Shift and asked for the credits. So does the console:
  // everything that lives in the vault behind it comes through at once.
  let shift = false;
  const noteShift = (event: KeyboardEvent | PointerEvent) => (shift = event.shiftKey);
  function credits(): void {
    if (shift) window.dispatchEvent(new CustomEvent('overseer:vault', { detail: 'parade' }));
    go('credits');
  }

  // The latest save of either game. Listed first, so ENTER alone continues.
  const resume = $derived(sys.continueFrom());
  let listed = false;
  $effect(() => {
    // The entry appears once storage has been read; keep the selection on
    // whatever the player had already moved it to.
    const has = resume !== null;
    if (has !== listed && selected > 0) selected += has ? 1 : -1;
    listed = has;
  });

  const items = $derived<MenuItem[]>([
    ...(resume
      ? [
          {
            key: 'c',
            label: `Continue: ${GAMES[resume.game].title}`,
            state: `SLOT ${String(resume.save.slot).padStart(2, '0')}, ${ago(resume.save.savedAt)}`,
            note: `Straight into your latest save: "${resume.save.description || 'no description'}", ${resume.save.character}${resume.save.level ? ` (level ${resume.save.level})` : ''}, ${resume.save.map}, ${resume.save.gameDate}.`,
            icon: 'play',
            action: () => void launchGame(resume.game, resume.save.slot),
          } satisfies MenuItem,
        ]
      : []),
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
        icon: game === 'fo1' ? 'holodisk-01' : 'holodisk-02',
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
      icon: 'manual',
      action: () => go('manual'),
    },
    { key: '6', label: 'Credits and legal', note: 'Who made the engines, and the small print.', icon: 'credits', action: credits },
  ]);

  const pointed = $derived(items[selected]);
</script>

<svelte:window onkeydowncapture={noteShift} onkeyupcapture={noteShift} onpointerdowncapture={noteShift} />

<header class="masthead">
  <img class="mark" src={mark} alt={PROJECT_NAME} width="288" height="288" />
  <div>
    <h1>Main directory</h1>
    <p class="sub">Fallout and Fallout 2 in this browser, from your own copy of the games.</p>
  </div>
</header>

{#if !sys.supported}
  <div class="panel signed bad">
    <Glyph name="fault" tone="alert" />
    <div>
      <p class="alert">PRIVATE STORAGE UNAVAILABLE</p>
      <p>
        This browser window will not let the console store game data. That happens in private windows and in old
        browsers. Open the console in a normal window of a current Chrome, Edge, Firefox or Safari.
      </p>
    </div>
  </div>
{/if}

<div class="columns">
  <div>
    <Menu {items} label="Main directory" bind:selected />
    <p class="gap dim">
      {sys.dropbox.linked
        ? 'GAME FILES AND SAVES STAY ON THIS DEVICE. ONLY THE SAVES YOU UPLOAD GO TO YOUR OWN DROPBOX.'
        : 'NOTHING IS UPLOADED. GAME FILES AND SAVES STAY ON THIS DEVICE.'}
    </p>
  </div>

  <aside class="board gap" aria-label="Status board">
    {#if pointed?.icon}
      <Glyph name={pointed.icon} tone={pointed.tone} />
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
