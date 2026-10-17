<script lang="ts">
  import { onMount } from 'svelte';
  import mark from '../../assets/mark.webp';
  import { whereabouts } from '../../lib/gamefacts';
  import { BASE_GAMES, gameDef } from '../../lib/games';
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
      ['1-7', 'JUMP'],
    ];
  });

  const totalSaves = $derived(sys.games.reduce((sum, game) => sum + (sys.saves[game] ?? 0), 0));
  // Saves that have never left this browser are worth a word: a browser short of room may clear them.
  const unexported = $derived(sys.unexported);
  // The game whose saves went out longest ago speaks for all of them.
  const exportedAt = $derived(Math.min(...sys.games.filter((game) => sys.saves[game]).map((game) => sys.exported[game]?.at ?? 0)));
  const ICONS = { fo1: 'holodisk-01', fo2: 'holodisk-02' } as const;
  const mods = $derived(sys.games.filter((game) => gameDef(game).mod));
  const loadedMods = $derived(mods.filter((game) => sys.installs[game]));
  let selected = $state(0);

  // An unsealed store is worth a word once it holds something a browser short of room could clear.
  const unsealed = $derived(
    sys.storage !== null && !sys.storage.persisted && (totalSaves > 0 || sys.games.some((game) => !!sys.installs[game])),
  );

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
            label: `Continue: ${gameDef(resume.game).title}`,
            state: `SLOT ${String(resume.save.slot).padStart(2, '0')}, ${ago(resume.save.savedAt)}`,
            note: `Straight into your latest save: "${resume.save.description || 'no description'}", ${resume.save.character}${resume.save.level ? ` (level ${resume.save.level})` : ''}, ${whereabouts(sys.places[resume.game], resume.save)}, ${resume.save.gameDate}.`,
            icon: 'play',
            action: () => void launchGame(resume.game, resume.save.slot),
          } satisfies MenuItem,
        ]
      : []),
    ...BASE_GAMES.map((game, index): MenuItem => {
      const def = gameDef(game);
      const install = sys.installs[game];
      const copying = sys.job.game === game && sys.busy;
      // What the deck plays, where it is a mod.
      const playing = sys.deckGame(game);
      const mod = playing === game ? null : gameDef(playing);
      return {
        key: String(index + 1),
        label: `${def.label}: ${def.title} (${def.year})`,
        state: copying ? 'LOADING...' : install === undefined ? 'CHECKING' : install ? (mod ? `READY, ${mod.short}` : 'READY') : 'NO HOLODISK',
        tone: install || install === undefined ? undefined : 'amber',
        note: install
          ? mod
            ? `Plays ${mod.title}, a mod of it. The deck has the choice of mods.`
            : def.blurb
          : `Needs your own copy of ${def.title}. Open to load it.`,
        icon: ICONS[game],
        action: () => go(game),
      };
    }),
    {
      key: '3',
      label: 'Mod library',
      state: sys.job.game === 'mod' && sys.busy ? 'LOADING...' : loadedMods.length ? `${loadedMods.length} ${loadedMods.length === 1 ? 'MOD' : 'MODS'}` : 'EMPTY',
      note: loadedMods.length
        ? `${loadedMods.map((game) => gameDef(game).title).join(', ')}. Each is played on its own game, with saves of its own.`
        : 'Mods for Fallout and Fallout 2, from their zips or folders: Fallout Et Tu, the Restoration Project, Sonora and more.',
      icon: 'gamedata',
      action: () => go('mods'),
    },
    {
      key: '4',
      label: 'Save archives',
      state: totalSaves ? `${totalSaves} ${totalSaves === 1 ? 'SAVE' : 'SAVES'}${unexported.length ? ', NEVER EXPORTED' : ''}` : 'EMPTY',
      tone: unexported.length ? 'amber' : undefined,
      note: unexported.length
        ? `Back up, restore or delete saved games. Those of ${unexported.map((game) => gameDef(game).title).join(' and ')} have never been exported: they are only in this browser's storage, which the browser may clear.`
        : 'Back up, restore or delete saved games.',
      icon: 'save',
      action: () => go('saves'),
    },
    {
      key: '5',
      label: 'Terminal settings',
      state: unsealed ? 'STORAGE NOT SEALED' : undefined,
      tone: unsealed ? 'amber' : undefined,
      note: unsealed
        ? 'Picture, sound and storage. The storage is not sealed: a browser short of disk space may clear the games and saves kept here. Seal it in these settings.'
        : 'Picture, sound and storage.',
      icon: 'settings',
      action: () => go('settings'),
    },
    {
      key: '6',
      label: 'Operations manual',
      note: 'Nine short chapters: loading a game, controls, touch screens, saving, and what to do when something fails.',
      icon: 'manual',
      action: () => go('manual'),
    },
    { key: '7', label: 'Credits and legal', note: 'Who made the engines, and the small print.', icon: 'credits', action: credits },
  ]);

  const pointed = $derived(items[selected]);
</script>

<svelte:window onkeydowncapture={noteShift} onkeyupcapture={noteShift} onpointerdowncapture={noteShift} />

<header class="masthead">
  <img class="mark" src={mark} alt={PROJECT_NAME} width="288" height="288" />
  <div>
    <h1>Main directory</h1>
    <p class="sub">Fallout and Fallout 2 in this browser, with their mods, from your own copy of the games.</p>
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
      {#each BASE_GAMES as game (game)}
        <dt>Deck {gameDef(game).deck}</dt>
        <dd class:amber={sys.installs[game] === null}>
          {sys.installs[game] === undefined ? '...' : sys.installs[game] ? gameDef(game).title.toUpperCase() : 'EMPTY'}
        </dd>
      {/each}
      <dt>Mods</dt>
      <dd>{loadedMods.length || 'NONE'}</dd>
      <dt>Archives</dt>
      <dd>{totalSaves} {totalSaves === 1 ? 'SAVE' : 'SAVES'}</dd>
      {#if totalSaves}
        <dt>Exported</dt>
        <dd class:amber={unexported.length > 0}>{unexported.length ? 'NEVER' : ago(exportedAt)}</dd>
      {/if}
      <dt>Storage</dt>
      <dd>{sys.storage ? formatBytes(sys.storage.usage) : '...'}</dd>
      <dt>Seal</dt>
      <dd class:amber={unsealed}>{sys.storage?.persisted ? 'SEALED' : 'OPEN'}</dd>
    </dl>
  </aside>
</div>
