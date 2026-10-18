<script lang="ts">
  import { onMount } from 'svelte';
  import { activeCloud } from '../../lib/cloud/clouds';
  import { CloudError } from '../../lib/cloud/errors';
  import { showFolder } from '../../lib/cloud/folders';
  import { listCloudMods, modsFolder, type CloudMod } from '../../lib/cloud/games';
  import { BASE_GAMES, gameDef, isGameId, type GameId } from '../../lib/games';
  import { KNOWN_MODS, KNOWN_MOD_IDS, type KnownModId } from '../../lib/mods/catalog';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import Glyph from '../components/Glyph.svelte';
  import JobResult from '../components/JobResult.svelte';
  import Loading from '../components/Loading.svelte';
  import Menu from '../components/Menu.svelte';
  import ModDisk from '../components/ModDisk.svelte';
  import { PICTURE_NAMES } from '../picture';
  import { STATUS_NAMES, STATUS_NOTES, modName } from '../mods';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  /**
   * library: the mods loaded here. load: loading one. known: the mods the
   * console knows by name, and with `known` one of them.
   */
  let { go, view, known = undefined }: { go: (path: string) => void; view: 'library' | 'load' | 'known'; known?: KnownModId } = $props();

  // Folder selection is a desktop browser feature; phones only pick files.
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;
  let folderInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();
  let selected = $state(0);

  /** The mods in the Mods folder of the player's cloud, once asked for. */
  let cloud = $state<{ mods: CloudMod[] | null; error: string | null } | null>(null);
  /** The cloud the console is linked to: looked at again whenever the link changes. */
  const linked = $derived.by(() => {
    void sys.cloud;
    return activeCloud();
  });
  /** Its Mods folder, as the console shows it, and where that is said in a sentence. */
  const cloudMods = $derived(linked ? showFolder(modsFolder(linked)) : '/Mods');
  const cloudHome = $derived(linked?.home ?? '');

  // A copy of a mod whose name is not known yet, or no longer (it was stopped before it arrived): it is shown here.
  const job = $derived(sys.job.phase !== 'idle' && (sys.job.game === undefined || !isGameId(sys.job.game)) ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && cloud) {
        event.preventDefault();
        cloud = null;
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  $effect(() => {
    // Once the mod is known, it is shown on its own page.
    const going = sys.job.game;
    if ((sys.job.phase === 'copying' || sys.job.phase === 'reading') && going && going !== 'mod' && isGameId(going)) {
      go(gameDef(going).mod ? `mods/${going}` : going);
    }
  });

  $effect(() => {
    if (job?.phase === 'failed') sfx.deny();
  });

  async function picked(input: HTMLInputElement | undefined): Promise<void> {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    input.value = '';
    await sys.importFrom(sources, 'mod');
  }

  async function lookInCloud(): Promise<void> {
    cloud = { mods: null, error: null };
    try {
      cloud = { mods: await listCloudMods(), error: null };
    } catch (err) {
      cloud = { mods: [], error: err instanceof CloudError || err instanceof Error ? err.message : String(err) };
      sfx.deny();
      sys.refreshCloud();
    }
  }

  const mods = $derived(sys.games.filter((game) => gameDef(game).mod));

  /** What a mod in the library is up to, in a word or two. */
  function standing(game: GameId): { state: string; tone?: 'amber' } {
    const def = gameDef(game);
    const base = gameDef(def.mod!.base);
    const install = sys.installs[game];
    if (sys.busy && sys.job.game === game) return { state: 'LOADING...' };
    if (install === undefined) return { state: 'CHECKING' };
    if (!install) return { state: 'NO HOLODISK', tone: 'amber' };
    if (!sys.installs[base.id]) return { state: `NEEDS DECK ${base.deck}`, tone: 'amber' };
    if (sys.deckGame(def.mod!.base) === game) return { state: `IN DECK ${base.deck}` };
    return { state: 'READY' };
  }

  const KEYS = '123456789abcdefghijmnopqrstuvwyz';

  /** The mods in the order the library lists them: those for Fallout first. */
  const listed = $derived(BASE_GAMES.flatMap((base) => mods.filter((game) => gameDef(game).mod!.base === base)));

  const libraryItems = $derived<MenuItem[]>([
    ...listed.map((game, index): MenuItem => {
      const def = gameDef(game);
      const base = gameDef(def.mod!.base);
      return {
        key: KEYS[index] ?? `m${index}`,
        group: `For ${base.title}`,
        label: modName(game),
        ...standing(game),
        note: sys.installs[game] === null ? `Its files were ejected. Its saves are kept: open it to load it again.` : `${def.blurb} ${STATUS_NOTES[def.mod!.status]}`,
        icon: 'gamedata',
        action: () => go(`mods/${game}`),
      };
    }),
    {
      key: 'l',
      label: 'Load a mod',
      icon: 'folder',
      note: 'From its zip, its folder or your cloud, or from a game folder it was installed in.',
      action: () => go('mods/load'),
    },
    {
      key: 'k',
      label: 'Mods the console knows',
      state: `${KNOWN_MOD_IDS.length} MODS`,
      icon: 'manual',
      note: 'What each is, where to get it, and what of it to hand the console.',
      action: () => go('mods/known'),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('') },
  ]);

  const loadItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: 'Select a zip',
      icon: 'folder',
      note: 'The zip a mod is downloaded as, or a zip of a game folder it was installed in. It is read where it lies, and nothing leaves this device.',
      action: () => zipInput?.click(),
    },
    ...(canPickFolder
      ? [
          {
            key: '2',
            label: 'Select a folder',
            icon: 'folder',
            note: 'A mod\'s folder, or a game folder it was installed in. The browser will ask you to confirm the "upload"; nothing leaves this device.',
            action: () => folderInput?.click(),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '3',
      label: sys.cloud.linked ? `From ${sys.cloud.name}` : 'From your cloud',
      state: sys.cloud.linked ? undefined : 'NOT LINKED',
      icon: 'uplink',
      note: sys.cloud.linked
        ? `The mods in ${cloudMods}, in ${cloudHome} in your ${sys.cloud.name}: each zip or folder there is one.`
        : 'Optional. Link your own Dropbox or Google Drive, put your mods in its Mods folder, and load them from there on any device.',
      action: () => (sys.cloud.linked ? void lookInCloud() : go('settings/cloud')),
    },
    {
      key: 'k',
      label: 'What to hand the console',
      icon: 'manual',
      note: 'Each mod the console knows, and which of its files it takes.',
      action: () => go('mods/known'),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('mods') },
  ]);

  const cloudItems = $derived<MenuItem[]>([
    ...(cloud?.mods ?? []).map(
      (mod, index): MenuItem => ({
        key: KEYS[index] ?? `d${index}`,
        label: mod.name,
        state: `${mod.zip ? 'ZIP' : `${mod.files} ${mod.files === 1 ? 'FILE' : 'FILES'}`}, ${formatBytes(mod.bytes)}`,
        icon: mod.zip ? 'folder' : 'gamedata',
        note: `Loads the mod in ${mod.name}, fetched from your ${sys.cloud.name}.`,
        action: () => {
          cloud = null;
          void sys.importModFromCloud(mod.name);
        },
      }),
    ),
    { key: '0', label: 'Back', icon: 'back', action: () => (cloud = null) },
  ]);

  const knownItems = $derived<MenuItem[]>([
    ...BASE_GAMES.flatMap((base) => KNOWN_MOD_IDS.filter((id) => KNOWN_MODS[id].base === base)).map((id, index): MenuItem => {
      const mod = KNOWN_MODS[id];
      return {
        key: KEYS[index]!,
        group: `For ${gameDef(mod.base).title}`,
        label: mod.title,
        state: STATUS_NAMES[mod.status],
        tone: mod.status === 'experimental' ? 'amber' : undefined,
        note: mod.blurb,
        icon: 'gamedata',
        action: () => go(`mods/known/${id}`),
      };
    }),
    { key: '0', label: 'Back', icon: 'back', action: () => go('mods') },
  ]);

  const page = $derived(known ? KNOWN_MODS[known] : null);
  const pageItems = $derived.by((): MenuItem[] => {
    if (!page) return [];
    const here = isGameId(page.id) && sys.installs[page.id];
    const home = page.project !== page.download;
    return [
      {
        key: '1',
        label: `Get ${page.title}`,
        state: 'OPENS A NEW TAB',
        icon: 'external',
        note: 'From the people who make it. The console hosts none of it.',
        action: () => void window.open(page.download, '_blank', 'noopener'),
      },
      ...(home
        ? [
            {
              key: '2',
              label: 'Its home page',
              state: 'OPENS A NEW TAB',
              icon: 'external',
              note: 'Where it is made, with its own notes and news.',
              action: () => void window.open(page.project, '_blank', 'noopener'),
            } satisfies MenuItem,
          ]
        : []),
      here
        ? { key: home ? '3' : '2', label: 'Open it', icon: 'play', note: 'It is loaded in this browser.', action: () => go(`mods/${page.id}`) }
        : { key: home ? '3' : '2', label: 'Load it', icon: 'folder', note: page.handOver, action: () => go('mods/load') },
      { key: '0', label: 'Back', icon: 'back', action: () => go('mods/known') },
    ];
  });

  const items = $derived(view === 'library' ? libraryItems : view === 'load' ? (cloud ? cloudItems : loadItems) : page ? pageItems : knownItems);
  const pointed = $derived(items[selected]);
  /** The mod under the cursor in the library, if it is one: they come first in its list. */
  const pointedMod = $derived(view === 'library' ? (listed[selected] ?? null) : null);
</script>

<!-- Hidden pickers behind the entries that load a mod. -->
<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" webkitdirectory multiple bind:this={folderInput} onchange={() => picked(folderInput)} />
<input class="sr-only" type="file" accept=".zip,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={() => picked(zipInput)} />

{#if view === 'known' && page}
  <h1>{page.title}</h1>
  <p class="sub">A mod of {gameDef(page.base).title}. {page.blurb}</p>
{:else if view === 'known'}
  <h1>Mods the console knows</h1>
  <p class="sub">Any mod loads; these are known by name, and started the way their makers meant.</p>
{:else if view === 'load'}
  <h1>Load a mod</h1>
  <p class="sub">From its zip or folder as it is downloaded, or from a game folder it was installed in.</p>
{:else}
  <h1>Mod library</h1>
  <p class="sub">Mods for Fallout and Fallout 2. Each is played on its own game, with saves of its own.</p>
{/if}

<div class="columns">
  <div>
    {#if view === 'load' && loading && job}
      <Loading {job} what="mod" />
    {:else}
      {#if (view === 'load' || view === 'library') && job}
        <JobResult {job} />
      {/if}
      {#if view === 'known' && page}
        <dl class="readout gap">
          <dt>Played on</dt>
          <dd>{gameDef(page.base).title.toUpperCase()}, DECK {gameDef(page.base).deck}</dd>
          {#if page.donor}
            <dt>Built from</dt>
            <dd>{gameDef(page.donor).title.toUpperCase()}, DECK {gameDef(page.donor).deck}, WHILE IT IS LOADED</dd>
          {/if}
          <dt>Made by</dt>
          <dd>{page.authors}</dd>
          <dt>On this engine</dt>
          <dd class:amber={page.status === 'experimental'}>{STATUS_NAMES[page.status]}. {STATUS_NOTES[page.status]}</dd>
          {#if page.caveat}
            <dt>Note</dt>
            <dd>{page.caveat}</dd>
          {/if}
          <dt>Starts at</dt>
          <dd>{PICTURE_NAMES[page.picture]}</dd>
        </dl>
        <p class="gap prose"><span class="hot">Hand the console:</span> {page.handOver}</p>
        <Menu items={pageItems} label={page.title} bind:selected />
      {:else if view === 'known'}
        <Menu items={knownItems} label="Mods the console knows" bind:selected />
      {:else if view === 'load' && cloud}
        {#if cloud.mods === null}
          <p class="gap">CONTACTING {sys.cloud.name.toUpperCase()}<span class="cursor"></span></p>
        {:else if cloud.error}
          <div class="panel signed bad" role="alert">
            <Glyph name="fault" tone="alert" />
            <p class="alert">{cloud.error}</p>
          </div>
        {:else if !cloud.mods.length}
          <p class="gap prose">
            There are no mods in <span class="hot">{cloudMods}</span> in {cloudHome} in your {sys.cloud.name}.
            {#if sys.cloud.id === 'drive'}
              Put each one there with <span class="hot">Put in Google Drive</span>, under Cloud link in Terminal settings,
              and look again: Google lets the console see only what it put there itself.
            {:else}
              Put each one there as the zip it is downloaded as, or as its folder, with Dropbox's own app or website or
              with <span class="hot">Put in Dropbox</span>, and look again.
            {/if}
          </p>
        {:else}
          <p class="gap dim">IN {cloudMods.toUpperCase()} IN YOUR {sys.cloud.name.toUpperCase()}:</p>
        {/if}
        {#if cloud.mods !== null}
          <Menu items={cloudItems} label={`Mods in your ${sys.cloud.name}`} bind:selected />
        {/if}
      {:else if view === 'load'}
        {#if sys.supported}
          <Menu items={loadItems} label="Load a mod" bind:selected />
          {#if canPickFolder}
            <p class="gap dim">OR DROP A MOD, ITS ZIP, OR A GAME FOLDER IT WAS INSTALLED IN, ANYWHERE ON THIS SCREEN.</p>
          {/if}
        {:else}
          <p class="gap alert">THIS BROWSER CANNOT STORE GAME DATA. SEE THE MAIN DIRECTORY.</p>
        {/if}
      {:else}
        {#if !mods.length}
          <p class="gap prose">
            A mod is played on the game it was made for: its own files over the game's, and saves of its own. The game
            stays as it was sold, one key away on its deck. Load a mod from the zip it is downloaded as, from its folder,
            or from a game folder it was installed in.
          </p>
        {/if}
        <Menu items={libraryItems} label="Mod library" bind:selected />
      {/if}
    {/if}
  </div>

  <aside class="board gap" aria-label="Mod library">
    {#if pointedMod}
      {@const def = gameDef(pointedMod)}
      {@const base = gameDef(def.mod!.base)}
      <ModDisk label={`FOR DECK ${base.deck}`} title={def.short} loaded={!!sys.installs[pointedMod]} />
      <dl class="readout">
        <dt>Played on</dt>
        <dd class:amber={!sys.installs[base.id]}>{base.title.toUpperCase()}</dd>
        <dt>Status</dt>
        <dd class:amber={def.mod!.status === 'experimental'}>{STATUS_NAMES[def.mod!.status]}</dd>
        <dt>Holodisk</dt>
        <dd>{sys.installs[pointedMod] ? formatBytes(sys.installs[pointedMod]!.totalBytes) : 'NOT LOADED'}</dd>
        <dt>Saves</dt>
        <dd>{sys.saves[pointedMod] || 'NONE'}</dd>
      </dl>
    {:else if view === 'known' && page}
      <ModDisk label={`FOR DECK ${gameDef(page.base).deck}`} title={page.short} loaded={isGameId(page.id) && !!sys.installs[page.id]} />
      <p class="dim">{isGameId(page.id) && sys.installs[page.id] ? 'Loaded in this browser.' : 'Not loaded in this browser.'}</p>
    {:else}
      <Glyph name={pointed?.icon ?? 'gamedata'} tone={pointed?.tone} />
      <dl class="readout">
        {#each BASE_GAMES as base (base)}
          <dt>Deck {gameDef(base).deck}</dt>
          <dd class:amber={sys.installs[base] === null}>
            {sys.installs[base] === undefined ? '...' : sys.installs[base] ? gameDef(sys.deckGame(base)).short : 'EMPTY'}
          </dd>
        {/each}
        <dt>Mods</dt>
        <dd>{mods.filter((game) => sys.installs[game]).length || 'NONE'}</dd>
      </dl>
    {/if}
  </aside>
</div>
