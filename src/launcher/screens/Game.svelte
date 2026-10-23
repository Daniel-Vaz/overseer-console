<script lang="ts">
  import { onMount } from 'svelte';
  import { whereabouts } from '../../lib/gamefacts';
  import { gameDef, isGameId, type BaseGameId, type GameId } from '../../lib/games';
  import { loadGameStats, picturesFor } from '../../lib/settings';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import Addons from '../components/Addons.svelte';
  import Deck from '../components/Deck.svelte';
  import Glyph from '../components/Glyph.svelte';
  import JobResult from '../components/JobResult.svelte';
  import Loading from '../components/Loading.svelte';
  import Menu from '../components/Menu.svelte';
  import { ago, exportedState, stamp } from '../format';
  import { launchGame } from '../launch';
  import { addonName, modName } from '../mods';
  import { PICTURE_NAMES, PICTURE_NOTES, step } from '../picture';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game }: { go: (path: string) => void; game: BaseGameId } = $props();

  const def = $derived(gameDef(game));
  const install = $derived(sys.installs[game]);
  // Folder selection is a desktop browser feature; phones only pick files.
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;

  /**
   * main: the deck. stores: where the game is sold. holodisk: loading the
   * game again, or taking it out. eject: asked before it is done. addons:
   * those laid over what the deck plays.
   */
  let view = $state<'main' | 'stores' | 'holodisk' | 'eject' | 'addons'>('main');
  let addonsView: Addons | undefined = $state();
  let folderInput: HTMLInputElement | undefined = $state();
  let filesInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();

  // The import in progress, when it concerns this deck.
  const job = $derived(sys.job.phase !== 'idle' && (sys.job.game === undefined || sys.job.game === game) ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');
  // A mod that lies in the folder this deck was just loaded from.
  const offered = $derived(sys.offer && !sys.busy ? sys.offer : null);

  /** What the deck plays: the game, or the mod put in it. */
  const playing = $derived(sys.deckGame(game));
  const mods = $derived(sys.modsOf(game));
  const modded = $derived(playing !== game);
  const stats = $derived(loadGameStats(playing));

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    // ESC leaves the innermost view first; only then the console goes back a screen.
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && stepBack()) {
        event.preventDefault();
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /** Closes the innermost open view. False when there is none. */
  function stepBack(): boolean {
    if (view === 'main') return false;
    if (view === 'addons' && addonsView?.stepBack()) return true;
    view = view === 'eject' ? 'holodisk' : 'main';
    return true;
  }

  $effect(() => {
    // The folder turned out to hold another game, or a mod, or the console went on to one: follow it to its screen.
    const going = sys.job.game;
    if ((sys.job.phase === 'copying' || sys.job.phase === 'reading') && going && going !== game && going !== 'mod' && isGameId(going)) {
      go(gameDef(going).mod ? `mods/${going}` : going);
    }
  });

  // Mods that play from this deck's data.
  const dependents = $derived(mods.filter((other) => sys.installs[other]).map((other) => gameDef(other)));

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  async function picked(input: HTMLInputElement | undefined): Promise<void> {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    // Allow picking the same folder again after a failure.
    input.value = '';
    view = 'main';
    await sys.importFrom(sources, game);
  }

  async function fromCloud(): Promise<void> {
    view = 'main';
    await sys.importFromCloud(game);
  }

  async function eject(): Promise<void> {
    view = 'main';
    await sys.ejectGame(game);
  }

  type Entry = Omit<MenuItem, 'key'> & { key?: string };

  /** Gives the entries that came without a key the numbers 1, 2, 3... in the order they stand in. */
  function numbered(entries: Entry[]): MenuItem[] {
    let next = 1;
    return entries.map((entry) => ({ ...entry, key: entry.key ?? String(next++) }));
  }

  const cloudNote = $derived(
    sys.cloud.id === 'drive'
      ? `Fetches ${def.title} from what you put in your Google Drive with Put in Google Drive.`
      : `Fetches ${def.title} from the game folder you put in the console's app folder in your Dropbox.`,
  );

  /**
   * Ways of handing the console the game from this device: its folder, loose
   * files where a folder cannot be picked, or one zip.
   */
  const sourceItems = $derived.by((): Entry[] => {
    const verb = install ? 'Replace' : 'Load';
    const kept = install ? ' Saved games are kept.' : '';
    return [
      {
        label: `${verb} holodisk: select the game ${canPickFolder ? 'folder' : 'files'}`,
        note: install
          ? 'Load the game files again, for example after patching your copy. Saved games are kept.'
          : canPickFolder
            ? `Pick the folder ${def.title} is installed in. The browser will ask you to confirm the "upload"; nothing leaves this device.`
            : 'Select MASTER.DAT, CRITTER.DAT and the other data files together. The game then plays without its music: a zip brings all of it.',
        action: () => (canPickFolder ? folderInput : filesInput)?.click(),
      },
      {
        label: `${verb} holodisk: select a zip of the game folder`,
        note: `One zip file of the folder ${def.title} is installed in, music and all. It is read where it lies, and nothing leaves this device.${kept}`,
        action: () => zipInput?.click(),
      },
    ];
  });

  const loadItems = $derived(
    numbered([
      ...sourceItems,
      {
        label: `Load holodisk from ${sys.cloud.linked ? sys.cloud.name : 'your cloud'}`,
        state: sys.cloud.linked ? undefined : 'NOT LINKED',
        note: sys.cloud.linked
          ? cloudNote
          : `Optional. Link your own Dropbox or Google Drive, put ${def.title} in it, and load the game from there on any device.`,
        action: () => (sys.cloud.linked ? void fromCloud() : go('settings/cloud')),
      },
      {
        label: 'Where are the game files?',
        note: 'Steam, GOG and Epic install locations.',
        action: () => go('manual/files'),
      },
      {
        label: `Get ${def.title}`,
        note: 'The console needs a copy you own. It is sold on GOG, Steam and Epic.',
        action: () => (view = 'stores'),
      },
      { key: '0', label: 'Back', action: () => go('') },
    ]),
  );

  // The latest save of what the deck plays, when there is one.
  const resume = $derived(sys.continueFrom(playing)?.save ?? null);
  const playable = $derived(sys.playable(playing));
  const pictures = $derived(picturesFor(playing));
  const picture = $derived(sys.picture(playing));
  const playingDef = $derived(gameDef(playing));
  /** Said of what the deck plays, where it is a mod. */
  const forMod = $derived(modded ? ` of ${playingDef.title}` : '');
  /** The add-ons laid over what the deck plays, and those there are for its game. */
  const laid = $derived((sys.laid[playing] ?? []).map((id) => sys.addons.find((record) => record.id === id)).filter((record) => !!record));
  const addonsFor = $derived(sys.addons.filter((record) => record.base === game).length);

  /** The deck's choice of what it plays: the game itself, or one of the mods loaded for it. */
  const modChoice = $derived([game, ...mods.filter((other) => sys.installs[other])] as GameId[]);
  function stepMod(direction: 1 | -1 = 1): void {
    sys.setDeckGame(game, step(modChoice, modChoice.includes(playing) ? playing : game, direction));
  }

  const readyItems = $derived(
    numbered([
      ...(resume
        ? [
            {
              key: 'c',
              label: 'Continue',
              state: `SLOT ${String(resume.slot).padStart(2, '0')}, ${ago(resume.savedAt)}`,
              note: `Straight into your latest save${forMod}: "${resume.description || 'no description'}", ${resume.character}${resume.level ? ` (level ${resume.level})` : ''}, ${whereabouts(sys.places[playing], resume)}, ${resume.gameDate}.`,
              action: () => void launchGame(playing, resume.slot, game),
            },
          ]
        : []),
      {
        label: 'Begin simulation',
        state: playable ? undefined : 'MOD NOT LOADED',
        tone: playable ? undefined : 'amber',
        disabled: !playable,
        note: !playable
          ? `${playingDef.title} is not loaded any more: choose another mod, or load it again in the Mod library.`
          : modded
            ? `Starts at the main menu of ${modName(playing)}, played on ${def.title}: new game, load game, options.`
            : `Starts at the main menu of ${def.title}: new game, load game, options.`,
        action: () => void launchGame(playing, undefined, game),
      },
      {
        label: 'Mod',
        state: modded ? playingDef.short : 'NONE',
        note: modded
          ? `Deck ${def.deck} plays ${modName(playing)}, with saves of its own. ${modChoice.length > 2 ? 'The arrows choose another, or none' : 'The arrows go back to none'}: ${def.title} as it was sold.`
          : mods.length
            ? `${def.title} as it was sold. The arrows put one of its mods in this deck instead.`
            : `${def.title} as it was sold. Mods for it are loaded in the Mod library: open it to load one.`,
        action: () => (modChoice.length > 1 ? stepMod() : go('mods')),
        adjust: modChoice.length > 1 ? stepMod : undefined,
      },
      {
        label: 'Save archives',
        state: sys.saves[playing] ? `${sys.saves[playing]} ${sys.saves[playing] === 1 ? 'SAVE' : 'SAVES'}${sys.exported[playing] ? '' : ', NEVER EXPORTED'}` : 'EMPTY',
        tone: sys.unexported.includes(playing) ? 'amber' : undefined,
        note: sys.unexported.includes(playing)
          ? `Back up, restore or delete saved games${forMod}. These have never been exported: they are only in this browser's storage, which the browser may clear.`
          : `Back up, restore or delete saved games${forMod}.`,
        action: () => go(`saves/${playing}`),
      },
      {
        label: 'Picture',
        state: PICTURE_NAMES[picture],
        note: `${PICTURE_NOTES[picture]} For ${modded ? playingDef.title : 'this game'} only.`,
        action: () => sys.setPicture(playing, step(pictures, picture)),
        adjust: (direction) => sys.setPicture(playing, step(pictures, picture, direction)),
      },
      {
        label: 'Add-ons',
        state: laid.length ? `${laid.length} ON` : addonsFor ? 'NONE ON' : 'NONE',
        note: laid.length
          ? `Laid over ${modded ? playingDef.title : def.title} when it starts: ${laid.map((record) => record.title).join(', ')}. Switch them, or load another.`
          : `Small mods laid over ${modded ? playingDef.title : def.title} when it starts: archives for its load order, scripts, music. ${addonsFor ? 'Switch one on' : 'Load one'} here.`,
        action: () => (view = 'addons'),
      },
      {
        label: 'Holodisk',
        state: formatBytes(install?.totalBytes ?? 0),
        note: 'Load the game files again, for example after patching your copy, or eject them from this browser. Saved games are kept either way.',
        action: () => (view = 'holodisk'),
      },
      // A mod installed inside this game's folder came along in the selection.
      ...(offered
        ? [
            {
              key: 'e',
              label: `Load ${offered.title} from the same folder`,
              note: `The folder you picked holds ${offered.title} as well. This loads it into the Mod library without picking the folder again.`,
              action: () => void sys.importOffered(),
            },
          ]
        : []),
      { key: '0', label: 'Back', action: () => go('') },
    ]),
  );

  /** What can be done about the game data itself: loading it again, and taking it out. */
  const holodiskItems = $derived(
    numbered([
      ...sourceItems,
      // Offered once there is a link; the deck of an empty game says how to make one.
      ...(sys.cloud.linked
        ? [
            {
              label: `Replace holodisk from ${sys.cloud.name}`,
              note: `${cloudNote} Saved games are kept.`,
              action: () => void fromCloud(),
            },
          ]
        : []),
      {
        key: 'e',
        label: 'Eject holodisk',
        note: `Remove the ${formatBytes(install?.totalBytes ?? 0)} of game data from this browser. Saved games are kept.`,
        action: () => (view = 'eject'),
      },
      { key: '0', label: 'Back', action: () => (view = 'main') },
    ]),
  );

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

  // What cannot be had back at the press of a key is not what ENTER lands on.
  const ejectItems: MenuItem[] = [
    { key: 'n', label: 'No, keep it', action: () => (view = 'holodisk') },
    { key: 'y', label: 'Yes, eject', danger: true, action: () => void eject() },
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
<input
  class="sr-only"
  type="file"
  accept=".zip,application/zip"
  tabindex="-1"
  aria-hidden="true"
  bind:this={zipInput}
  onchange={() => picked(zipInput)}
/>

<div class="columns">
<div>
{#if loading && job}
  <Loading {job} what={def.title} place="the deck" />
{:else}
  {#if job}
    <JobResult {job} beside={offered?.title ?? null} place="the deck" />
  {/if}

  {#if view === 'stores'}
    <p class="gap">{def.title} is sold by:</p>
    <Menu items={storeItems} label="Stores" />
  {:else if view === 'addons' && install}
    <Addons game={playing} {go} back={() => (view = 'main')} bind:this={addonsView} />
  {:else if view === 'eject' && install}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">EJECT THE {def.title.toUpperCase()} HOLODISK?</p>
        <p>The game data is removed from this browser. Your saved games stay, and you can load the holodisk again later.</p>
        {#each dependents as other (other.id)}
          <p class="amber">{other.title}, in the Mod library, is played on this holodisk, and will not start without it.</p>
        {/each}
      </div>
    </div>
    <Menu items={ejectItems} label="Confirm eject" />
  {:else if view === 'holodisk' && install}
    <dl class="readout gap">
      <dt>Holodisk</dt>
      <dd>LOADED, {formatBytes(install.totalBytes)}, {stamp(install.importedAt, false)}</dd>
    </dl>
    <Menu items={holodiskItems} label={`The ${def.title} holodisk`} />
  {:else if install}
    <dl class="readout gap">
      <dt>Holodisk</dt>
      <dd>LOADED, {formatBytes(install.totalBytes)}, {stamp(install.importedAt, false)}</dd>
      <dt>Engine</dt>
      <dd>{def.engine.name.toUpperCase()}</dd>
      {#if modded}
        <dt>Mod</dt>
        <dd class:amber={!playable}>{modName(playing).toUpperCase()}{playable ? '' : ': NOT LOADED'}</dd>
      {/if}
      {#if laid.length}
        <dt>Add-ons</dt>
        <dd>{laid.map((record) => addonName(record).toUpperCase()).join(', ')}</dd>
      {/if}
      <dt>Saved games</dt>
      <dd>{sys.saves[playing] || 'NONE'}</dd>
      {#if sys.saves[playing]}
        <dt>Last exported</dt>
        <dd class:amber={!sys.exported[playing]}>{exportedState(sys.exported[playing] ?? null)}</dd>
      {/if}
      <dt>Last session</dt>
      <dd>{stats.lastPlayed ? stamp(stats.lastPlayed) : 'NEVER'}</dd>
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
        <p class="gap dim">OR DROP THE GAME FOLDER, OR A ZIP OF IT, ANYWHERE ON THIS SCREEN.</p>
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
  <Deck label={`DECK ${def.deck}`} title={def.title.toUpperCase()} loaded={!!install} spinning={loading} />
  <p class="dim">
    {#if install}
      Loaded {stamp(install.importedAt, false)}. {install.files} files, {formatBytes(install.totalBytes)}.
      {#if modded}Plays {playingDef.title}.{/if}
    {:else}
      Holds the data files of your copy of {def.title}.
    {/if}
  </p>
</aside>
</div>
