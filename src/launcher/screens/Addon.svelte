<script lang="ts">
  // An add-on's own page: what it holds, and which games and mods it is laid over.
  import { onMount } from 'svelte';
  import { activeCloud } from '../../lib/cloud/clouds';
  import { CloudError } from '../../lib/cloud/errors';
  import { showFolder } from '../../lib/cloud/folders';
  import { listCloudMods, modsFolder, type CloudMod } from '../../lib/cloud/games';
  import { gameDef, type GameId } from '../../lib/games';
  import { changedSettings, installOpener, settingsFilesOf } from '../../lib/mods/settings';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { loadInstall } from '../../lib/storage/opfs';
  import { formatBytes } from '../../lib/storage/manifest';
  import Glyph from '../components/Glyph.svelte';
  import IniSettings from '../components/IniSettings.svelte';
  import JobResult from '../components/JobResult.svelte';
  import Loading from '../components/Loading.svelte';
  import Menu from '../components/Menu.svelte';
  import ModDisk from '../components/ModDisk.svelte';
  import { stamp } from '../format';
  import { addonHolds, addonName, modName } from '../mods';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, id }: { go: (path: string) => void; id: string } = $props();

  const record = $derived(sys.addons.find((addon) => addon.id === id) ?? null);
  const info = $derived(sys.addonInstalls[id]);
  const base = $derived(record ? gameDef(record.base) : null);
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;
  let folderInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();

  /** main: the add-on. settings: its settings files. holodisk: its files loaded again, or taken out. eject: asked first. */
  let view = $state<'main' | 'settings' | 'holodisk' | 'eject'>('main');
  let settingsView: IniSettings | undefined = $state();
  /** How many settings files it brings, and how many of them the player changed. */
  let settingsFiles = $state<{ files: number; changed: number } | null>(null);

  async function countSettings(): Promise<void> {
    const install = await loadInstall(id, 'addons').catch(() => null);
    const files = install ? await settingsFilesOf(install.manifest.files, installOpener(install)).catch(() => []) : [];
    settingsFiles = { files: files.length, changed: changedSettings(id).size };
  }

  $effect(() => {
    void info;
    if (view === 'main') void countSettings();
  });
  let cloud = $state<{ mods: CloudMod[] | null; error: string | null } | null>(null);
  const linked = $derived.by(() => {
    void sys.cloud;
    return activeCloud();
  });
  const cloudMods = $derived(linked ? showFolder(modsFolder(linked)) : '/Mods');

  // Its files on their way in, loaded anew or again.
  const job = $derived(sys.job.phase !== 'idle' && sys.job.game === 'addon' && sys.job.addon === id && !sys.job.target ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');

  /** What it can be laid over: the game it was made for, and that game's mods loaded here. */
  const targets = $derived<GameId[]>(record ? [record.base, ...sys.modsOf(record.base).filter((game) => sys.installs[game])] : []);
  const laidOn = $derived(targets.filter((game) => sys.laid[game]?.includes(id)));

  function replace(sources: Parameters<typeof sys.importAddon>[0]): void {
    view = 'main';
    void sys.importAddon(sources, { replacing: id });
  }

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    // What is dropped here is new files for this add-on.
    sys.dropTarget = { take: replace, label: 'Release to load the add-on again', blocked: () => sys.busy || !sys.supported };
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && (cloud || view !== 'main')) {
        // Typing a value: Backspace is the field's.
        if (event.key === 'Backspace' && view === 'settings' && (event.target as HTMLElement | null)?.tagName === 'INPUT') return;
        event.preventDefault();
        if (cloud) cloud = null;
        else if (view === 'settings' && settingsView?.stepBack()) return;
        else view = view === 'eject' ? 'holodisk' : 'main';
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (sys.dropTarget?.take === replace) sys.dropTarget = null;
    };
  });

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  function picked(input: HTMLInputElement | undefined): void {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    input.value = '';
    replace(sources);
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

  async function eject(): Promise<void> {
    view = 'main';
    if (await sys.ejectAddon(id)) go('mods');
  }

  // Not E (Holodisk), S (Settings) or 0 (Back).
  const KEYS = '123456789abcdfghijkmnpqrtuvwxyz';

  const mainItems = $derived.by((): MenuItem[] => {
    if (!record || !base) return [];
    return [
      ...targets.map((game, index): MenuItem => {
        const def = gameDef(game);
        const laid = sys.laid[game] ?? [];
        const on = laid.includes(id);
        const over = laid.slice(laid.indexOf(id) + 1).map((other) => sys.addons.find((addon) => addon.id === other)?.title ?? other);
        return {
          key: KEYS[index] ?? `g${index}`,
          group: 'Games and mods',
          label: def.mod ? modName(game) : def.title,
          state: on ? 'ON' : 'OFF',
          note: on
            ? `Laid over ${def.title} when it starts${over.length ? `, under ${over.join(' and ')}` : ''}. ENTER takes it off; a save made with it may need it.`
            : `Not laid over ${def.title}. ENTER lays it over ${def.title}, over the add-ons there already.`,
          action: () => sys.switchAddon(game, id, !on),
          adjust: () => sys.switchAddon(game, id, !on),
        };
      }),
      ...(settingsFiles?.files
        ? [
            {
              key: 's',
              label: 'Settings',
              state: settingsFiles.changed ? `${settingsFiles.changed} ${settingsFiles.changed === 1 ? 'FILE' : 'FILES'} CHANGED` : 'AS THEY CAME',
              tone: settingsFiles.changed ? ('amber' as const) : undefined,
              note: `What its ${settingsFiles.files === 1 ? 'settings file says' : `${settingsFiles.files} settings files say`}, as its scripts read it: parts of it switched on and off, values changed, as on a desktop you would edit the file.`,
              action: () => (view = 'settings'),
            } satisfies MenuItem,
          ]
        : []),
      {
        key: 'e',
        label: 'Holodisk',
        state: formatBytes(info?.totalBytes ?? 0),
        note: 'Load its files again, for example from a newer version, or eject them from this browser.',
        action: () => (view = 'holodisk'),
      },
      { key: '0', label: 'Back', action: () => go('mods') },
    ];
  });

  const holodiskItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: 'Replace holodisk: select a zip',
      note: 'The zip it was loaded from, a newer one, or the one archive it is. Where it is switched on stays as it is.',
      action: () => zipInput?.click(),
    },
    ...(canPickFolder
      ? [
          {
            key: '2',
            label: 'Replace holodisk: select a folder',
            note: 'Its folder, as it would be unpacked into the game folder. Where it is switched on stays as it is.',
            action: () => folderInput?.click(),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '3',
      label: `Replace holodisk from ${sys.cloud.linked ? sys.cloud.name : 'your cloud'}`,
      state: sys.cloud.linked ? undefined : 'NOT LINKED',
      note: sys.cloud.linked ? `From ${cloudMods} in your ${sys.cloud.name}.` : 'Optional. Link your own Dropbox or Google Drive and keep your mods and add-ons in its Mods folder.',
      action: () => (sys.cloud.linked ? void lookInCloud() : go('settings/cloud')),
    },
    {
      key: 'e',
      label: 'Eject holodisk',
      note: `Remove the ${formatBytes(info?.totalBytes ?? 0)} of ${record?.title ?? 'it'} from this browser. It is taken off whatever it is laid over.`,
      action: () => (view = 'eject'),
    },
    { key: '0', label: 'Back', action: () => (view = 'main') },
  ]);

  const cloudItems = $derived<MenuItem[]>([
    ...(cloud?.mods ?? []).map(
      (entry, index): MenuItem => ({
        key: KEYS[index] ?? `d${index}`,
        label: entry.name,
        state: `${entry.zip ? 'ZIP' : `${entry.files} ${entry.files === 1 ? 'FILE' : 'FILES'}`}, ${formatBytes(entry.bytes)}`,
        note: `Loads ${record?.title ?? 'it'} again from ${entry.name}, fetched from your ${sys.cloud.name}.`,
        action: () => {
          cloud = null;
          view = 'main';
          void sys.importAddonFromCloud(entry.name, { replacing: id });
        },
      }),
    ),
    { key: '0', label: 'Back', action: () => (cloud = null) },
  ]);

  const ejectItems: MenuItem[] = [
    { key: 'n', label: 'No, keep it', action: () => (view = 'holodisk') },
    { key: 'y', label: 'Yes, eject', danger: true, action: () => void eject() },
  ];
</script>

<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" webkitdirectory multiple bind:this={folderInput} onchange={() => picked(folderInput)} />
<input class="sr-only" type="file" accept=".zip,.dat,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={() => picked(zipInput)} />

{#if record && base}
  <h1>{addonName(record)}</h1>
  <p class="sub">An add-on of {base.title}, laid over it or over its mods when they start.</p>
{:else}
  <h1>Add-on</h1>
  <p class="sub">An add-on loaded in this browser.</p>
{/if}

<div class="columns">
  <div>
    {#if loading && job}
      <Loading {job} what="add-on" place="the add-on" />
    {:else}
      {#if job}
        <JobResult {job} place="the add-on" />
      {/if}
      {#if !record || !base}
        {#if info === undefined && sys.busy}
          <p class="gap">CHECKING<span class="cursor"></span></p>
        {:else}
          <p class="gap prose">No such add-on is loaded in this browser.</p>
          <Menu items={[{ key: '0', label: 'Back', action: () => go('mods') }]} label="Add-on" />
        {/if}
      {:else if cloud}
        {#if cloud.mods === null}
          <p class="gap">CONTACTING {sys.cloud.name.toUpperCase()}<span class="cursor"></span></p>
        {:else if cloud.error}
          <div class="panel signed bad" role="alert">
            <Glyph name="fault" tone="alert" />
            <p class="alert">{cloud.error}</p>
          </div>
        {:else if !cloud.mods.length}
          <p class="gap prose">There is nothing in <span class="hot">{cloudMods}</span> in {linked?.home} in your {sys.cloud.name}.</p>
        {/if}
        {#if cloud.mods !== null}
          <Menu items={cloudItems} label={`Mods folder in your ${sys.cloud.name}`} />
        {/if}
      {:else if view === 'settings'}
        <IniSettings owner={id} shelf="addons" title={record.title} back={() => (view = 'main')} bind:this={settingsView} />
      {:else if view === 'eject'}
        <div class="signed ask gap">
          <Glyph name="warning" tone="amber" />
          <div>
            <p class="amber">EJECT THE {record.title.toUpperCase()} HOLODISK?</p>
            <p>
              Its files are removed from this browser{laidOn.length ? `, and it is taken off ${laidOn.map((game) => gameDef(game).title).join(' and ')}` : ''}.
              A save made with it may need it; you can load it again later.
            </p>
          </div>
        </div>
        <Menu items={ejectItems} label="Confirm eject" />
      {:else if view === 'holodisk'}
        <dl class="readout gap">
          <dt>Holodisk</dt>
          <dd>{info ? `LOADED, ${formatBytes(info.totalBytes)}, ${stamp(info.importedAt, false)}` : 'NOT LOADED'}</dd>
        </dl>
        <Menu items={holodiskItems} label={`The ${record.title} holodisk`} />
      {:else}
        <dl class="readout gap">
          <dt>Holodisk</dt>
          <dd>{info ? `LOADED, ${formatBytes(info.totalBytes)}, ${stamp(info.importedAt, false)}` : 'CHECKING'}</dd>
          <dt>Made for</dt>
          <dd>{base.title.toUpperCase()}, DECK {base.deck}</dd>
          {#if record.version}
            <dt>Version</dt>
            <dd>{record.version}</dd>
          {/if}
          {#if info}
            <dt>Holds</dt>
            <dd>{addonHolds(info).toUpperCase()}</dd>
          {/if}
          <dt>Laid over</dt>
          <dd class:amber={!laidOn.length}>{laidOn.length ? laidOn.map((game) => gameDef(game).short).join(', ') : 'NOTHING YET'}</dd>
        </dl>
        {#if !laidOn.length}
          <p class="gap dim prose">Switch it on for {base.title}, or for one of its mods: it is laid over that when it starts.</p>
        {/if}
        <Menu items={mainItems} label={`${record.title} options`} />
      {/if}
    {/if}
  </div>

  <aside class="board gap" aria-label="Add-on holodisk">
    <ModDisk label={base ? `ADD-ON, DECK ${base.deck}` : 'ADD-ON'} title={record?.title.toUpperCase() ?? ''} loaded={!!info} spinning={loading} />
    <p class="dim">
      {#if info && record}
        Loaded {stamp(info.importedAt, false)}. {info.files} files, {formatBytes(info.totalBytes)}. It has no saves of its own: a game played with it saves as that game.
      {:else}
        Holds the files of an add-on.
      {/if}
    </p>
  </aside>
</div>
