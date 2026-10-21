<script lang="ts">
  // Installing a known mod's release: fetched by the player's Dropbox, or downloaded by this browser and handed over.
  import { onMount } from 'svelte';
  import { activeCloud } from '../../lib/cloud/clouds';
  import { CloudError, LinkError } from '../../lib/cloud/errors';
  import { showFolder } from '../../lib/cloud/folders';
  import { modsFolder } from '../../lib/cloud/games';
  import { planPut } from '../../lib/cloud/put';
  import { gameDef, isGameId, type GameId } from '../../lib/games';
  import { KNOWN_MODS, KNOWN_MOD_IDS, type KnownModId } from '../../lib/mods/catalog';
  import { cloudFetches, releaseInCloud } from '../../lib/mods/install';
  import { MOD_RELEASES, isOlder, matchRelease, releaseOf, type ModRelease } from '../../lib/mods/releases';
  import { sourcesFromFileList, type SourceFile } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { ImportError } from '../../lib/storage/plan';
  import Glyph from '../components/Glyph.svelte';
  import JobResult from '../components/JobResult.svelte';
  import Loading from '../components/Loading.svelte';
  import Menu from '../components/Menu.svelte';
  import ModDisk from '../components/ModDisk.svelte';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  /** `mod`: the one being installed; without it, the list of those the console installs. */
  let { go, mod = undefined }: { go: (path: string) => void; mod?: KnownModId } = $props();

  const INSTALLABLE = KNOWN_MOD_IDS.filter((id) => MOD_RELEASES[id]);

  let zipInput: HTMLInputElement | undefined = $state();
  let selected = $state(0);
  /** A file handed over that is not the release: shown, with the choice to load it anyway. */
  let odd = $state.raw<{ sources: SourceFile[]; name: string; size: number; why: 'other-size' | 'other-name' } | null>(null);
  /** The release file handed over, kept to put in the cloud once it is in. */
  let handed = $state.raw<File | null>(null);
  /** This screen started the copy shown. */
  let mine = $state(false);
  /** Whether the cloud holds the release already: null while not known. */
  let inCloud = $state<boolean | null>(null);
  let message = $state<string | null>(null);

  const known = $derived(mod ? KNOWN_MODS[mod] : null);
  const release = $derived(releaseOf(mod));
  const linked = $derived.by(() => {
    void sys.cloud;
    return activeCloud();
  });
  const fetches = $derived(cloudFetches(linked));
  const cloudMods = $derived(linked ? showFolder(modsFolder(linked)) : '/Mods');

  // The copy in progress, when this screen started it.
  const job = $derived(mine && sys.job.phase !== 'idle' ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');

  /** What of this mod is here already. */
  const here = $derived(mod && isGameId(mod) && sys.installs[mod] ? (mod as GameId) : null);
  const hereVersion = $derived(here ? gameDef(here).mod?.version : undefined);

  /** What it is played on and built from, and whether those are loaded: what stops it from installing. */
  const missing = $derived.by(() => {
    if (!known) return null;
    for (const game of [known.base, ...(known.donor ? [known.donor] : [])]) {
      if (!sys.installs[game]) return gameDef(game);
    }
    return null;
  });

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    // Dropped here, the download is handed over.
    sys.dropTarget = {
      label: 'Release to install it',
      blocked: () => sys.busy || !sys.supported || !release || !!missing,
      take: (sources) => void handOver(sources),
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && odd) {
        event.preventDefault();
        event.stopImmediatePropagation();
        odd = null;
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      sys.dropTarget = null;
      window.removeEventListener('keydown', onKey, true);
    };
  });

  $effect(() => {
    // Whether the cloud holds it already, looked at once per mod and link.
    const cloud = linked;
    const wanted = release;
    inCloud = null;
    if (!cloud || !wanted) return;
    releaseInCloud(wanted, cloud).then(
      (file) => release === wanted && (inCloud = !!file),
      () => undefined,
    );
  });

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  /** The release, through the cloud that downloads it. */
  function viaCloud(wanted: ModRelease): void {
    message = null;
    handed = null;
    mine = true;
    void sys.installRelease(wanted, here ?? undefined);
  }

  /** Takes a file handed over: the release, or something to ask about first. */
  async function handOver(sources: SourceFile[]): Promise<void> {
    if (!release || !sources.length) return;
    message = null;
    const first = sources[0]!;
    const name = first.path.slice(first.path.lastIndexOf('/') + 1);
    const why = sources.length === 1 ? matchRelease(release, { name, size: first.file.size }) : 'other-name';
    if (why !== 'same') {
      odd = { sources, name: sources.length === 1 ? name : `${sources.length} files`, size: sources.reduce((sum, source) => sum + source.file.size, 0), why };
      sfx.deny();
      return;
    }
    install(sources);
  }

  function install(sources: SourceFile[], asRelease = true): void {
    if (!release) return;
    odd = null;
    handed = sources.length === 1 && sources[0]!.file instanceof File ? sources[0]!.file : null;
    mine = true;
    if (asRelease) void sys.installReleaseFrom(release, sources, here ?? undefined);
    else void sys.importFrom(sources, here ?? 'mod');
  }

  /** Opens the file picker, where the browser keeps downloads when it can. */
  async function pick(): Promise<void> {
    const host = window as Window & { showOpenFilePicker?: (options: object) => Promise<{ getFile(): Promise<File> }[]> };
    if (!host.showOpenFilePicker) {
      zipInput?.click();
      return;
    }
    let file: File | undefined;
    try {
      const [handle] = await host.showOpenFilePicker({ startIn: 'downloads', types: [{ description: 'Zip', accept: { 'application/zip': ['.zip'] } }] });
      file = await handle?.getFile();
    } catch (err) {
      // Closed without a pick. Anything else is said: the user's click is spent, so another picker would not open.
      if (!(err instanceof DOMException && err.name === 'AbortError')) message = `The browser's file picker failed (${err instanceof Error ? err.message : String(err)}). Drop the file on this screen instead.`;
      return;
    }
    if (file) void handOver(sourcesFromFileList([file]));
  }

  async function picked(): Promise<void> {
    if (!zipInput?.files?.length) return;
    const sources = sourcesFromFileList(zipInput.files);
    zipInput.value = '';
    await handOver(sources);
  }

  /** Puts the release handed over in the cloud's Mods folder, and shows it going there. */
  async function putInCloud(): Promise<void> {
    if (!handed) return;
    message = null;
    try {
      const plan = await planPut([{ path: handed.name, file: handed }], 'mod');
      if (plan.existing && plan.existing.size === handed.size) {
        inCloud = true;
        return;
      }
      void sys.putInCloud(plan);
      go('settings/cloud/put');
    } catch (err) {
      message = err instanceof ImportError || err instanceof CloudError || err instanceof LinkError ? err.message : String(err);
      sfx.deny();
      sys.refreshCloud();
    }
  }

  const site = $derived(release ? new URL(release.url).hostname : '');
  const done = $derived(job?.phase === 'done' && !!mod && isGameId(mod) && !!sys.installs[mod]);

  const listItems = $derived<MenuItem[]>([
    ...INSTALLABLE.map((id, index): MenuItem => {
      const entry = KNOWN_MODS[id];
      const wanted = MOD_RELEASES[id]!;
      const loaded = isGameId(id) && !!sys.installs[id];
      const older = loaded && isOlder(gameDef(id).mod?.version, wanted);
      return {
        key: String(index + 1),
        group: `For ${gameDef(entry.base).title}`,
        label: entry.title,
        state: loaded && !older ? 'LOADED' : `${older ? 'UPDATE TO ' : ''}${wanted.version}, ${formatBytes(wanted.bytes)}`,
        tone: older ? 'amber' : undefined,
        note: `${entry.blurb} Version ${wanted.version}, ${wanted.file}, from ${new URL(wanted.url).hostname}.`,
        icon: 'gamedata',
        action: () => go(`mods/install/${id}`),
      };
    }),
    { key: '0', label: 'Back', icon: 'back', action: () => go('mods') },
  ]);

  const pageItems = $derived.by((): MenuItem[] => {
    if (!release || !known) return [];
    const blocked = missing ? `NEEDS DECK ${missing.deck}` : undefined;
    const blockedNote = missing ? `${known.title} needs ${missing.title} in deck ${missing.deck}: load it there first.` : '';
    const doing = here ? (isOlder(hereVersion, release) ? `Update to version ${release.version}` : `Install version ${release.version} again`) : `Install version ${release.version}`;
    const items: MenuItem[] = [];
    if (done) {
      items.push({ key: '1', label: `Open ${known.title}`, icon: 'play', note: 'Its page: begin, continue, its deck and its saves.', action: () => go(`mods/${mod}`) });
      if (linked && handed && inCloud === false) {
        items.push({
          key: '2',
          label: `Put it in your ${linked.name}`,
          icon: 'uplink',
          note: `Sends ${release.file} as it is into ${cloudMods} in your ${linked.name}, to load it from there on your other devices.`,
          action: () => void putInCloud(),
        });
      }
    } else if (fetches && linked) {
      items.push({
        key: '1',
        label: doing,
        state: blocked ?? (inCloud ? `IN YOUR ${linked.name.toUpperCase()}` : `VIA ${linked.name.toUpperCase()}`),
        tone: blocked ? 'amber' : undefined,
        disabled: !!missing,
        icon: 'uplink',
        note:
          blockedNote ||
          (inCloud
            ? `${release.file} is in ${cloudMods} in your ${linked.name} already: the console loads it from there.`
            : `Your ${linked.name} downloads ${release.file} (${formatBytes(release.bytes)}) from ${site} into ${cloudMods}, and the console loads it from there. It stays there for your other devices.`),
        action: () => viaCloud(release),
      });
      items.push({
        key: '2',
        label: 'Download it with this browser instead',
        state: 'OPENS A NEW TAB',
        icon: 'external',
        note: `Downloads ${release.file} from ${site}. Then select it here, or drop it on this screen.`,
        action: () => void window.open(release.url, '_blank', 'noopener'),
      });
      items.push({ key: '3', label: 'Select the downloaded file', icon: 'folder', disabled: !!missing, note: blockedNote || `${release.file}, ${formatBytes(release.bytes)}.`, action: () => void pick() });
    } else {
      items.push({
        key: '1',
        label: `Download version ${release.version}`,
        state: 'OPENS A NEW TAB',
        icon: 'external',
        note: `Your browser downloads ${release.file} (${formatBytes(release.bytes)}) from ${site}, its makers' own link. The console cannot download it itself: ${site} does not let other sites read it.`,
        action: () => void window.open(release.url, '_blank', 'noopener'),
      });
      items.push({
        key: '2',
        label: here ? (isOlder(hereVersion, release) ? 'Update from the download' : 'Install the download again') : 'Install the download',
        state: blocked,
        tone: blocked ? 'amber' : undefined,
        disabled: !!missing,
        icon: 'folder',
        note: blockedNote || `Select ${release.file} once it has downloaded, or drop it on this screen. It is read where it lies.`,
        action: () => void pick(),
      });
    }
    items.push({ key: 'k', label: `About ${known.title}`, icon: 'manual', note: 'Who makes it, how well it plays here, and the other ways to load it.', action: () => go(`mods/known/${known.id}`) });
    items.push({ key: '0', label: 'Back', icon: 'back', action: () => go('mods/install') });
    return items;
  });

  const oddItems = $derived<MenuItem[]>([
    { key: '1', label: 'Select another file', icon: 'folder', action: () => void pick() },
    {
      key: '2',
      label: 'Load it anyway',
      icon: 'gamedata',
      note: 'As any mod is loaded: the console finds out what it is.',
      action: () => odd && install(odd.sources, false),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => (odd = null) },
  ]);
</script>

<input class="sr-only" type="file" accept=".zip,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={() => picked()} />

{#if known && release}
  <h1>Install {known.title}</h1>
  <p class="sub">Version {release.version}, the one the console's tests play, from its makers' own link.</p>
{:else}
  <h1>Install a known mod</h1>
  <p class="sub">The mods that come as one zip the console takes as it is: no installer, no sign-in.</p>
{/if}

<div class="columns">
  <div>
    {#if !sys.supported}
      <p class="gap alert">THIS BROWSER CANNOT STORE GAME DATA. SEE THE MAIN DIRECTORY.</p>
    {:else if known && release}
      {#if loading && job}
        <Loading {job} what="mod" place={here ? 'the mod' : null} />
      {:else}
        {#if job}
          <JobResult {job} place={here ? 'the mod' : null} />
        {/if}
        {#if message}
          <div class="panel signed bad" role="alert">
            <Glyph name="fault" tone="alert" />
            <p class="alert">{message}</p>
          </div>
        {/if}
        {#if odd}
          <div class="signed ask gap">
            <Glyph name="warning" tone="amber" />
            <div>
              <p class="amber">THAT IS NOT {release.file.toUpperCase()} OF VERSION {release.version}</p>
              <p>
                {odd.name} is {formatBytes(odd.size)}{odd.why === 'other-size' ? `, where version ${release.version} is ${formatBytes(release.bytes)}: another version, or a download that did not finish` : `; the console looked for ${release.file}, ${formatBytes(release.bytes)}`}.
              </p>
            </div>
          </div>
          <Menu items={oddItems} label="Not the release" bind:selected />
        {:else}
          {#if !job}
            <dl class="readout gap">
              <dt>Version</dt>
              <dd>{release.version}</dd>
              <dt>File</dt>
              <dd>{release.file}, {formatBytes(release.bytes)}</dd>
              <dt>From</dt>
              <dd>{site}</dd>
              <dt>Played on</dt>
              <dd class:amber={!sys.installs[known.base]}>{gameDef(known.base).title.toUpperCase()}, DECK {gameDef(known.base).deck}{sys.installs[known.base] ? ': LOADED' : ': NOT LOADED'}</dd>
              {#if known.donor}
                <dt>Built from</dt>
                <dd class:amber={!sys.installs[known.donor]}>{gameDef(known.donor).title.toUpperCase()}, DECK {gameDef(known.donor).deck}{sys.installs[known.donor] ? ': LOADED' : ': NOT LOADED'}</dd>
              {/if}
              {#if here}
                <dt>Here</dt>
                <dd class:amber={isOlder(hereVersion, release)}>{hereVersion ? `VERSION ${hereVersion}` : 'LOADED'}{isOlder(hereVersion, release) ? ', OLDER' : ''}</dd>
              {/if}
            </dl>
            {#if here}
              <p class="gap dim prose">Installing it again replaces the files of the {known.title} loaded here. Its saved games are kept.</p>
            {/if}
          {:else if done && linked && handed && inCloud === false}
            <p class="gap dim prose">It is loaded in this browser. Put it in your {linked.name} as well, and it can be loaded from there on any device.</p>
          {/if}
          <Menu items={pageItems} label={`Install ${known.title}`} bind:selected />
        {/if}
      {/if}
    {:else}
      <Menu items={listItems} label="Install a known mod" bind:selected />
      <p class="gap dim prose">
        The others come with an installer for a desktop, or from a site that asks you to sign in: Mods the console knows
        says what of each to hand it.
      </p>
    {/if}
  </div>

  <aside class="board gap" aria-label="Mod release">
    {#if known && release}
      <ModDisk label={`FOR DECK ${gameDef(known.base).deck}`} title={known.short} loaded={!!here} spinning={loading} />
      <p class="dim">
        {#if fetches && linked}
          Your {linked.name} downloads it, server to server: this browser could not, as {site} does not let other sites read
          what it serves.
        {:else if linked}
          {linked.name} cannot download from the web by itself: this browser downloads it, and you hand it over.
        {:else}
          With your Dropbox linked, Dropbox downloads it for you, into its Mods folder.
        {/if}
      </p>
    {:else}
      <Glyph name="gamedata" />
      <dl class="readout">
        <dt>Installs</dt>
        <dd>{INSTALLABLE.length} MODS</dd>
        <dt>Fetched by</dt>
        <dd>{fetches && linked ? linked.name.toUpperCase() : 'THIS BROWSER'}</dd>
      </dl>
    {/if}
  </aside>
</div>
