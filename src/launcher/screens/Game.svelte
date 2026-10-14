<script lang="ts">
  import { onMount } from 'svelte';
  import { whereabouts } from '../../lib/gamefacts';
  import { GAMES, GAME_IDS, type GameId } from '../../lib/games';
  import { loadGameStats } from '../../lib/settings';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { removeInstall } from '../../lib/storage/opfs';
  import Deck from '../components/Deck.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { ago, exportedState, stamp } from '../format';
  import { launchGame } from '../launch';
  import { PICTURE_NAMES, PICTURE_NOTES, nextPicture } from '../picture';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game }: { go: (path: string) => void; game: GameId } = $props();

  const def = $derived(GAMES[game]);
  const install = $derived(sys.installs[game]);
  const stats = $derived(loadGameStats(game));
  // A conversion is not sold: it is put together from its own package and two games that are.
  const conversion = $derived(def.conversion ?? null);
  const base = $derived(conversion ? GAMES[conversion.base] : null);
  const donor = $derived(conversion ? GAMES[conversion.donor] : null);
  // Folder selection is a desktop browser feature; phones only pick files.
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;

  /**
   * main: the deck. stores: where the game is sold. holodisk: loading the
   * game again, or taking it out. eject, stop: asked before it is done.
   */
  let view = $state<'main' | 'stores' | 'holodisk' | 'eject' | 'stop'>('main');
  let folderInput: HTMLInputElement | undefined = $state();
  let filesInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();

  // The import in progress, when it concerns this deck.
  const job = $derived(sys.job.phase !== 'idle' && (sys.job.game === undefined || sys.job.game === game) ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');
  const percent = $derived(job && job.totalBytes ? Math.min(100, (job.doneBytes / job.totalBytes) * 100) : 0);
  // Another game that lies in the folder this deck was just loaded from, or this deck's own game found beside another.
  const offered = $derived(sys.offer && !sys.busy ? GAMES[sys.offer.game] : null);

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
    view = view === 'eject' ? 'holodisk' : 'main';
    return true;
  }

  $effect(() => {
    // The folder turned out to hold another game, or the console went on to one: follow it to its deck.
    if ((sys.job.phase === 'copying' || sys.job.phase === 'reading') && sys.job.game && sys.job.game !== game) go(sys.job.game);
  });

  // Games in other decks that play from this one's data.
  const dependents = $derived(GAME_IDS.filter((other) => GAMES[other].conversion?.base === game && sys.installs[other]).map((other) => GAMES[other]));

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  $effect(() => {
    // A copy that ended while it was asked about needs no answer any more.
    if (!loading && view === 'stop') view = 'main';
  });

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

  function stop(): void {
    view = 'main';
    sys.stopImport();
  }

  type Entry = Omit<MenuItem, 'key'> & { key?: string };

  /** Gives the entries that came without a key the numbers 1, 2, 3... in the order they stand in. */
  function numbered(entries: Entry[]): MenuItem[] {
    let next = 1;
    return entries.map((entry) => ({ ...entry, key: entry.key ?? String(next++) }));
  }

  const dropboxNote = $derived(
    conversion
      ? `Fetches ${def.title} from the zip or folder you put in the console's app folder in your Dropbox.`
      : `Fetches ${def.title} from the game folder you put in the console's app folder in your Dropbox.`,
  );

  /**
   * Ways of handing the console the game from this device: its folder, loose
   * files where a folder cannot be picked, or one zip. A conversion comes as
   * the zip it is downloaded as, or as its folder.
   */
  const sourceItems = $derived.by((): Entry[] => {
    const verb = install ? 'Replace' : 'Load';
    const kept = install ? ' Saved games are kept.' : '';
    if (conversion) {
      return [
        {
          label: `${verb} holodisk: select the package zip`,
          note: `The file ${def.title} is downloaded as. It is read where it lies, and nothing leaves this device.${kept}`,
          action: () => zipInput?.click(),
        },
        ...(canPickFolder
          ? [
              {
                label: `${verb} holodisk: select its folder`,
                note: `The ${def.steamFolder.split('/').pop()} folder of a desktop install, or the ${base!.title} folder it sits in.${kept}`,
                action: () => folderInput?.click(),
              },
            ]
          : []),
      ];
    }
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
      // Found beside the game that was loaded a moment ago: no need to pick the folder twice.
      ...(offered?.id === game
        ? [
            {
              key: 'e',
              label: 'Load holodisk from the folder you just picked',
              note: `That folder holds ${def.title} as well.`,
              action: () => void sys.importOffered(),
            },
          ]
        : []),
      ...sourceItems,
      {
        label: 'Load holodisk from Dropbox',
        state: sys.dropbox.linked ? undefined : 'NOT LINKED',
        note: sys.dropbox.linked
          ? dropboxNote
          : `Optional. Link your own Dropbox, put your ${def.title} ${conversion ? 'package' : 'folder'} in it, and load the game from there on any device.`,
        action: () => (sys.dropbox.linked ? void fromDropbox() : go('settings/dropbox')),
      },
      ...(conversion
        ? [
            {
              label: `Get ${def.title}`,
              state: 'OPENS A NEW TAB',
              note: 'A free download from the people who make it. Take the newest package there.',
              action: () => void window.open(conversion.download, '_blank', 'noopener'),
            },
            {
              label: 'What it is put together from',
              note: 'The package and the two games, and what the console does with them.',
              action: () => go('manual'),
            },
          ]
        : [
            {
              label: 'Where are the game files?',
              note: 'Steam, GOG and Epic install locations.',
              action: () => go('manual'),
            },
            {
              label: `Get ${def.title}`,
              note: 'The console needs a copy you own. It is sold on GOG, Steam and Epic.',
              action: () => (view = 'stores'),
            },
          ]),
      { key: '0', label: 'Back', action: () => go('') },
    ]),
  );

  // This game's latest save, when there is one.
  const resume = $derived(sys.continueFrom(game)?.save ?? null);
  const playable = $derived(sys.playable(game));
  const picture = $derived(sys.settings.picture[game]);

  const readyItems = $derived(
    numbered([
      ...(resume
        ? [
            {
              key: 'c',
              label: 'Continue',
              state: `SLOT ${String(resume.slot).padStart(2, '0')}, ${ago(resume.savedAt)}`,
              note: `Straight into your latest save: "${resume.description || 'no description'}", ${resume.character}${resume.level ? ` (level ${resume.level})` : ''}, ${whereabouts(sys.places[game], resume)}, ${resume.gameDate}.`,
              action: () => void launchGame(game, resume.slot),
            },
          ]
        : []),
      {
        label: 'Begin simulation',
        state: playable || !base ? undefined : `NEEDS DECK ${base.deck}`,
        tone: playable ? undefined : 'amber',
        disabled: !playable,
        note:
          !playable && base
            ? `${def.title} runs on ${base.title}: load it into deck ${base.deck} first.`
            : `Starts at the main menu of ${def.title}: new game, load game, options.`,
        action: () => void launchGame(game),
      },
      {
        label: 'Save archives',
        state: sys.saves[game] ? `${sys.saves[game]} ${sys.saves[game] === 1 ? 'SAVE' : 'SAVES'}${sys.exported[game] ? '' : ', NEVER EXPORTED'}` : 'EMPTY',
        tone: sys.unexported.includes(game) ? 'amber' : undefined,
        note: sys.unexported.includes(game)
          ? "Back up, restore or delete saved games. These have never been exported: they are only in this browser's storage, which the browser may clear."
          : 'Back up, restore or delete saved games.',
        action: () => go(`saves/${game}`),
      },
      {
        label: 'Picture',
        state: PICTURE_NAMES[picture],
        note: `${PICTURE_NOTES[picture]} For this game only.`,
        action: () => sys.setPicture(game, nextPicture(picture)),
        adjust: (direction) => sys.setPicture(game, nextPicture(picture, direction)),
      },
      {
        label: 'Holodisk',
        state: formatBytes(install?.totalBytes ?? 0),
        note: 'Load the game files again, for example after patching your copy, or eject them from this browser. Saved games are kept either way.',
        action: () => (view = 'holodisk'),
      },
      // A conversion installed inside this game's folder came along in the selection.
      ...(offered && offered.id !== game
        ? [
            {
              key: 'e',
              label: `Load ${offered.title} from the same folder`,
              note: `The folder you picked holds ${offered.title} as well. This loads it into deck ${offered.deck} without picking the folder again.`,
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
      ...(sys.dropbox.linked
        ? [
            {
              label: 'Replace holodisk from Dropbox',
              note: `${dropboxNote} Saved games are kept.`,
              action: () => void fromDropbox(),
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

  const loadingItems: MenuItem[] = [
    {
      key: 'x',
      label: 'Stop loading',
      note: 'Calls the copy off. What was copied so far is thrown away, and the deck stays as it was.',
      action: () => (view = 'stop'),
    },
  ];

  const stopItems: MenuItem[] = [
    { key: 'n', label: 'No, carry on', action: () => (view = 'main') },
    { key: 'y', label: 'Yes, stop loading', danger: true, action: stop },
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

<!-- The games a conversion is put together from, and whether each is in its deck. -->
{#snippet needs()}
  {#if base && donor}
    <dt>Runs on</dt>
    <dd class:amber={sys.installs[base.id] === null}>
      {base.title.toUpperCase()}, DECK {base.deck}{sys.installs[base.id] ? ': LOADED' : sys.installs[base.id] === null ? ': NOT LOADED' : ''}
    </dd>
    {#if !install}
      <dt>Built from</dt>
      <dd class:amber={sys.installs[donor.id] === null}>
        {donor.title.toUpperCase()}, DECK {donor.deck}{sys.installs[donor.id] ? ': LOADED' : sys.installs[donor.id] === null ? ': NOT LOADED' : ''}
      </dd>
    {/if}
  {/if}
{/snippet}

<div class="columns">
<div>
{#if loading && job}
  {#if job.phase === 'reading'}
    <p class="gap">READING HOLODISK<span class="cursor"></span></p>
    <p class="dim">Looking for {def.title} in {job.remote ? 'your Dropbox' : 'what you selected'}.</p>
  {:else}
    <p class="gap">{job.remote ? 'FETCHING HOLODISK FROM DROPBOX' : 'LOADING HOLODISK'} INTO PRIVATE STORAGE</p>
    <div class="meter gap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)}>
      <div class="track"><div class="fill" style:width="{percent}%"></div></div>
      <span>{Math.round(percent)}%</span>
      <span class="dim">{formatBytes(job.doneBytes)} / {formatBytes(job.totalBytes)}</span>
    </div>
    <p class="dim">{job.path ? `COPYING ${job.path.toUpperCase()}` : 'PREPARING'}</p>
    <p class="gap amber">KEEP THIS TAB OPEN UNTIL THE COPY FINISHES.</p>
  {/if}
  {#if view === 'stop'}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">STOP LOADING THE {def.title.toUpperCase()} HOLODISK?</p>
        <p>What was copied so far is thrown away. The deck stays as it was, and the holodisk can be loaded again.</p>
      </div>
    </div>
    <Menu items={stopItems} label="Confirm stop" />
  {:else}
    <Menu items={loadingItems} label="While loading" />
  {/if}
{:else}
  {#if job?.phase === 'failed'}
    <div class="panel signed bad" role="alert">
      <Glyph name="fault" tone="alert" />
      <div>
        <p class="alert">HOLODISK REJECTED</p>
        <p>{job.error}</p>
      </div>
    </div>
  {:else if job?.phase === 'stopped'}
    <div class="panel signed" role="status">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">LOADING STOPPED</p>
        <p>Nothing was changed: the deck is as it was.</p>
      </div>
    </div>
  {:else if job?.phase === 'done' && job.plan}
    <div class="panel signed" role="status">
      <Glyph name="ok" />
      <div>
        <p class="hot">HOLODISK LOADED</p>
        <p>
          {job.plan.sourceFiles.toLocaleString('en-US')} files, {formatBytes(job.plan.totalBytes)}.
          {#if job.plan.saves.length}Saved games found in the folder were added to the save archives.{/if}
        </p>
        {#each job.plan.notes as note (note)}
          <p>{note}</p>
        {/each}
        {#each job.plan.warnings as warning (warning)}
          <p class="amber">{warning}</p>
        {/each}
        {#if offered && offered.id !== game}
          <p class="hot">{offered.title.toUpperCase()} IS IN THAT FOLDER AS WELL.</p>
        {/if}
      </div>
    </div>
  {/if}

  {#if view === 'stores'}
    <p class="gap">{def.title} is sold by:</p>
    <Menu items={storeItems} label="Stores" />
  {:else if view === 'eject' && install}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">EJECT THE {def.title.toUpperCase()} HOLODISK?</p>
        <p>The game data is removed from this browser. Your saved games stay, and you can load the holodisk again later.</p>
        {#each dependents as other (other.id)}
          <p class="amber">{other.title} in deck {other.deck} runs on this holodisk, and will not start without it.</p>
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
      {@render needs()}
      <dt>Saved games</dt>
      <dd>{sys.saves[game] || 'NONE'}</dd>
      {#if sys.saves[game]}
        <dt>Last exported</dt>
        <dd class:amber={!sys.exported[game]}>{exportedState(sys.exported[game])}</dd>
      {/if}
      <dt>Last session</dt>
      <dd>{stats.lastPlayed ? stamp(stats.lastPlayed) : 'NEVER'}</dd>
    </dl>
    <Menu items={readyItems} label={`${def.title} options`} />
  {:else if install === null}
    <dl class="readout gap">
      <dt>Holodisk</dt>
      <dd class="amber">NOT LOADED</dd>
      {@render needs()}
    </dl>
    {#if base && donor}
      <p class="gap prose">
        {def.title} is the first {donor.title} rebuilt as a game for the engine of {base.title}: made by fans, free of
        charge. The console puts it together from its package, from your {base.title} in deck {base.deck}, which it
        plays on, and from your {donor.title} in deck {donor.deck}, where its speech, movies and map tiles come from.
        Nothing is uploaded.
      </p>
    {:else}
      <p class="gap prose">
        This console plays {def.title} from your own copy of the game. Point it at the folder the game is installed in
        and the data files are copied into this browser's private storage. Nothing is uploaded.
      </p>
    {/if}
    {#if sys.supported}
      <Menu items={loadItems} label={`Load ${def.title}`} />
      {#if canPickFolder}
        <p class="gap dim">OR DROP THE {conversion ? 'PACKAGE' : 'GAME FOLDER, OR A ZIP OF IT,'} ANYWHERE ON THIS SCREEN.</p>
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
    label={`DECK ${def.deck}`}
    title={def.title.toUpperCase()}
    loaded={!!install}
    spinning={loading}
  />
  <p class="dim">
    {#if install}
      Loaded {stamp(install.importedAt, false)}. {install.files} files, {formatBytes(install.totalBytes)}.
    {:else if base && donor}
      Holds {def.title}, put together from decks {donor.deck} and {base.deck}.
    {:else}
      Holds the data files of your copy of {def.title}.
    {/if}
  </p>
</aside>
</div>
