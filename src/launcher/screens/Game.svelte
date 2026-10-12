<script lang="ts">
  import { onMount } from 'svelte';
  import { GAMES, type GameId } from '../../lib/games';
  import { loadGameStats } from '../../lib/settings';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { removeInstall } from '../../lib/storage/opfs';
  import Deck from '../components/Deck.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { ago } from '../format';
  import { launchGame } from '../launch';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game }: { go: (path: string) => void; game: GameId } = $props();

  const def = $derived(GAMES[game]);
  const install = $derived(sys.installs[game]);
  const stats = $derived(loadGameStats(game));
  // Folder selection is a desktop browser feature; phones only pick files.
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;

  let view = $state<'main' | 'stores' | 'eject'>('main');
  let folderInput: HTMLInputElement | undefined = $state();
  let filesInput: HTMLInputElement | undefined = $state();

  // The import in progress, when it concerns this deck.
  const job = $derived(sys.job.phase !== 'idle' && (sys.job.game === undefined || sys.job.game === game) ? sys.job : null);
  const percent = $derived(job && job.totalBytes ? Math.min(100, (job.doneBytes / job.totalBytes) * 100) : 0);

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
  });

  $effect(() => {
    // The folder turned out to hold the other game: follow it to its deck.
    if (sys.job.phase === 'copying' && sys.job.game && sys.job.game !== game) go(sys.job.game);
  });

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  function date(timestamp: number, withTime = false): string {
    const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
    if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit', hour12: false });
    return new Date(timestamp).toLocaleString(undefined, options).toUpperCase();
  }

  async function picked(input: HTMLInputElement | undefined): Promise<void> {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    // Allow picking the same folder again after a failure.
    input.value = '';
    view = 'main';
    await sys.importFrom(sources, game);
  }

  async function fromDropbox(): Promise<void> {
    view = 'main';
    await sys.importFromDropbox(game);
  }

  async function eject(): Promise<void> {
    view = 'main';
    await removeInstall(game);
    sys.clearJob();
    await sys.refresh();
  }

  const loadItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: canPickFolder ? 'Load holodisk: select the game folder' : 'Load holodisk: select the game files',
      note: canPickFolder
        ? `Pick the folder ${def.title} is installed in. The browser will ask you to confirm the "upload"; nothing leaves this device.`
        : 'Select MASTER.DAT, CRITTER.DAT and the other data files together.',
      action: () => (canPickFolder ? folderInput : filesInput)?.click(),
    },
    {
      key: 'd',
      label: 'Load holodisk from Dropbox',
      state: sys.dropbox.linked ? undefined : 'NOT LINKED',
      note: sys.dropbox.linked
        ? `Fetches ${def.title} from the game folder you put in the console's app folder in your Dropbox.`
        : `Optional. Link your own Dropbox, put your ${def.title} folder in it, and load the game from there on any device.`,
      action: () => (sys.dropbox.linked ? void fromDropbox() : go('settings/dropbox')),
    },
    {
      key: '2',
      label: 'Where are the game files?',
      note: 'Steam, GOG and Epic install locations.',
      action: () => go('manual'),
    },
    {
      key: '3',
      label: `Get ${def.title}`,
      note: 'The console needs a copy you own. It is sold on GOG, Steam and Epic.',
      action: () => (view = 'stores'),
    },
    { key: '0', label: 'Back', action: () => go('') },
  ]);

  // This game's latest save, when there is one.
  const resume = $derived(sys.continueFrom(game)?.save ?? null);

  const readyItems = $derived<MenuItem[]>([
    ...(resume
      ? [
          {
            key: 'c',
            label: 'Continue',
            state: `SLOT ${String(resume.slot).padStart(2, '0')}, ${ago(resume.savedAt)}`,
            note: `Straight into your latest save: "${resume.description || 'no description'}", ${resume.character}${resume.level ? ` (level ${resume.level})` : ''}, ${resume.map}, ${resume.gameDate}.`,
            action: () => void launchGame(game, resume.slot),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '1',
      label: 'Begin simulation',
      note: resume ? `Starts at the main menu of ${def.title}: new game, load game, options.` : def.blurb,
      action: () => void launchGame(game),
    },
    {
      key: '2',
      label: 'Save archives',
      state: sys.saves[game] ? `${sys.saves[game]} ${sys.saves[game] === 1 ? 'SAVE' : 'SAVES'}` : 'EMPTY',
      note: 'Back up, restore or delete saved games.',
      action: () => go(`saves/${game}`),
    },
    {
      key: '3',
      label: 'Replace holodisk',
      note: 'Load the game files again, for example after patching your copy. Saved games are kept.',
      action: () => (canPickFolder ? folderInput : filesInput)?.click(),
    },
    // Offered once there is a link; the deck of an empty game says how to make one.
    ...(sys.dropbox.linked
      ? [
          {
            key: 'd',
            label: 'Replace holodisk from Dropbox',
            note: 'Fetches the game again from the folder in your Dropbox. Saved games are kept.',
            action: () => void fromDropbox(),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '4',
      label: 'Eject holodisk',
      note: `Remove the ${formatBytes(install?.totalBytes ?? 0)} of game data from this browser. Saved games are kept.`,
      action: () => (view = 'eject'),
    },
    { key: '0', label: 'Back', action: () => go('') },
  ]);

  const storeItems = $derived<MenuItem[]>([
    ...def.stores.map(
      (store, index): MenuItem => ({
        key: String(index + 1),
        label: store.name,
        state: 'OPENS A NEW TAB',
        action: () => window.open(store.url, '_blank', 'noopener'),
      }),
    ),
    { key: '0', label: 'Back', action: () => (view = 'main') },
  ]);

  const ejectItems: MenuItem[] = [
    { key: 'y', label: 'Yes, eject', tone: 'alert', action: () => void eject() },
    { key: 'n', label: 'No, keep it', action: () => (view = 'main') },
  ];
</script>

<h1>{def.label}: {def.title}</h1>
<p class="sub">{def.year}. {def.blurb}</p>

<!-- Hidden pickers behind the "load holodisk" entries. -->
<input
  class="sr-only"
  type="file"
  tabindex="-1"
  aria-hidden="true"
  webkitdirectory
  multiple
  bind:this={folderInput}
  onchange={() => picked(folderInput)}
/>
<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" multiple bind:this={filesInput} onchange={() => picked(filesInput)} />

<div class="columns">
<div>
{#if job?.phase === 'reading'}
  <p class="gap">READING HOLODISK<span class="cursor"></span></p>
  <p class="dim">Looking for {def.title} in {job.remote ? 'your Dropbox' : 'what you selected'}.</p>
{:else if job?.phase === 'copying'}
  <p class="gap">{job.remote ? 'FETCHING HOLODISK FROM DROPBOX' : 'LOADING HOLODISK'} INTO PRIVATE STORAGE</p>
  <div class="meter gap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)}>
    <div class="track"><div class="fill" style:width="{percent}%"></div></div>
    <span>{Math.round(percent)}%</span>
    <span class="dim">{formatBytes(job.doneBytes)} / {formatBytes(job.totalBytes)}</span>
  </div>
  <p class="dim">{job.path ? `COPYING ${job.path.toUpperCase()}` : 'PREPARING'}</p>
  <p class="gap amber">KEEP THIS TAB OPEN UNTIL THE COPY FINISHES.</p>
{:else}
  {#if job?.phase === 'failed'}
    <div class="panel signed bad" role="alert">
      <Glyph name="fault" tone="alert" />
      <div>
        <p class="alert">HOLODISK REJECTED</p>
        <p>{job.error}</p>
      </div>
    </div>
  {:else if job?.phase === 'done' && job.plan}
    <div class="panel signed" role="status">
      <Glyph name="ok" />
      <div>
        <p class="hot">HOLODISK LOADED</p>
        <p>
          {job.plan.entries.length} files, {formatBytes(job.plan.totalBytes)}.
          {#if job.plan.saves.length}Saved games found in the folder were added to the save archives.{/if}
        </p>
        {#each job.plan.warnings as warning (warning)}
          <p class="amber">{warning}</p>
        {/each}
      </div>
    </div>
  {/if}

  {#if view === 'stores'}
    <p class="gap">{def.title} is sold by:</p>
    <Menu items={storeItems} label="Stores" />
  {:else if view === 'eject'}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">EJECT THE {def.title.toUpperCase()} HOLODISK?</p>
        <p>The game data is removed from this browser. Your saved games stay, and you can load the holodisk again later.</p>
      </div>
    </div>
    <Menu items={ejectItems} label="Confirm eject" />
  {:else if install}
    <dl class="readout gap">
      <dt>Holodisk</dt>
      <dd>LOADED, {formatBytes(install.totalBytes)}, {date(install.importedAt)}</dd>
      <dt>Engine</dt>
      <dd>{def.engine.name.toUpperCase()}</dd>
      <dt>Saved games</dt>
      <dd>{sys.saves[game] || 'NONE'}</dd>
      <dt>Last session</dt>
      <dd>{stats.lastPlayed ? date(stats.lastPlayed, true) : 'NEVER'}</dd>
    </dl>
    <Menu items={readyItems} label={`${def.title} options`} />
  {:else if install === null}
    <dl class="readout gap">
      <dt>Holodisk</dt>
      <dd class="amber">NOT LOADED</dd>
    </dl>
    <p class="gap prose">
      This console plays {def.title} from your own copy of the game. Point it at the folder the game is installed in
      and the data files are copied into this browser's private storage. Nothing is uploaded.
    </p>
    {#if sys.supported}
      <Menu items={loadItems} label={`Load ${def.title}`} />
      {#if canPickFolder}
        <p class="gap dim">OR DROP THE GAME FOLDER ANYWHERE ON THIS SCREEN.</p>
      {/if}
    {:else}
      <p class="gap alert">THIS BROWSER CANNOT STORE GAME DATA. SEE THE MAIN DIRECTORY.</p>
    {/if}
  {:else}
    <p class="gap">CHECKING DECK<span class="cursor"></span></p>
  {/if}
{/if}
</div>

<aside class="board gap" aria-label="Holodisk deck">
  <Deck
    label={`DECK ${game === 'fo1' ? 'A' : 'B'}`}
    title={def.title.toUpperCase()}
    loaded={!!install}
    spinning={job?.phase === 'reading' || job?.phase === 'copying'}
  />
  <p class="dim">
    {#if install}
      Loaded {date(install.importedAt)}. {install.files} files, {formatBytes(install.totalBytes)}.
    {:else}
      Holds the data files of your copy of {def.title}.
    {/if}
  </p>
</aside>
</div>
