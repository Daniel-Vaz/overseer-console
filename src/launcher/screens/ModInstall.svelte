<script lang="ts">
  // Installing a known mod's release: fetched by the player's Dropbox, or downloaded by this browser and handed over,
  // or, for those the console cannot take as they are downloaded, step by step.
  import { onMount } from 'svelte';
  import { activeCloud } from '../../lib/cloud/clouds';
  import { CloudError, LinkError } from '../../lib/cloud/errors';
  import { showFolder } from '../../lib/cloud/folders';
  import { modsFolder } from '../../lib/cloud/games';
  import { planPut } from '../../lib/cloud/put';
  import { BASE_GAMES, gameDef, isGameId, type GameId } from '../../lib/games';
  import { KNOWN_MODS, KNOWN_MOD_IDS, type KnownModId } from '../../lib/mods/catalog';
  import { cloudFetches, looksLikeMod, releaseInCloud } from '../../lib/mods/install';
  import { MOD_RELEASES, cloudCanFetch, isOlder, isZip, matchRelease, releaseOf, type ModRelease, type ZipRelease } from '../../lib/mods/releases';
  import { openArchives, sourcesFromFileList, type SourceFile } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { ImportError } from '../../lib/storage/plan';
  import { looksLikeZip } from '../../lib/zip';
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

  const INSTALLABLE = BASE_GAMES.flatMap((base) => KNOWN_MOD_IDS.filter((id) => KNOWN_MODS[id].base === base && MOD_RELEASES[id]));
  // Folder selection is a desktop browser feature; phones only pick files.
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;

  let zipInput: HTMLInputElement | undefined = $state();
  let folderInput: HTMLInputElement | undefined = $state();
  let selected = $state(0);
  /**
   * What was handed over that is not the release: a zip of another size or
   * name, or a folder that does not look like the mod. Shown, with the
   * choice to load it anyway.
   */
  let odd = $state.raw<{ sources: SourceFile[]; name: string; size: number; why: 'other-size' | 'other-name' | 'not-mod' } | null>(null);
  /** The release file handed over, kept to put in the cloud once it is in. */
  let handed = $state.raw<File | null>(null);
  /** This screen started the copy shown. */
  let mine = $state(false);
  /** Whether the cloud holds the release already: null while not known. */
  let inCloud = $state<boolean | null>(null);
  let message = $state<string | null>(null);

  const known = $derived(mod ? KNOWN_MODS[mod] : null);
  const release = $derived(releaseOf(mod));
  /** The release when it is one zip the console takes as it is, told by its size. */
  const zip = $derived(release && isZip(release) ? release : null);
  const linked = $derived.by(() => {
    void sys.cloud;
    return activeCloud();
  });
  /** Whether the linked cloud downloads this release itself. */
  const fetches = $derived(!!release && cloudCanFetch(release) && cloudFetches(linked));
  const cloudMods = $derived(linked ? showFolder(modsFolder(linked)) : '/Mods');

  // The copy in progress, when this screen started it.
  const job = $derived(mine && sys.job.phase !== 'idle' ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');

  /** What of this mod is here already. */
  const here = $derived(mod && isGameId(mod) && sys.installs[mod] ? (mod as GameId) : null);
  const hereVersion = $derived(here ? gameDef(here).mod?.version : undefined);

  /** Where a release is downloaded, as a sentence names it. */
  function siteOf(release: ModRelease): string {
    const host = new URL(release.url).hostname.replace(/^www\./, '');
    return host === 'nexusmods.com' ? 'Nexus Mods' : host === 'nma-fallout.com' ? 'No Mutants Allowed' : host;
  }

  /** How a release of each kind is had, in a few words. */
  const HOW: Record<ModRelease['kind'], string> = {
    zip: 'One zip, fetched and loaded.',
    'signed-in': 'One zip from a site that asks you to sign in: your browser downloads it, the console checks and loads it.',
    unpack: 'A 7z, which the console does not open: you unpack it, the console loads the folder.',
    installer: 'An installer for a desktop: you run it there, the console loads the folder it fills.',
  };

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
    const wanted = zip;
    inCloud = null;
    if (!cloud || !wanted) return;
    releaseInCloud(wanted, cloud).then(
      (file) => zip === wanted && (inCloud = !!file),
      () => undefined,
    );
  });

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  /** The release, through the cloud that downloads it. */
  function viaCloud(wanted: ZipRelease): void {
    message = null;
    handed = null;
    mine = true;
    void sys.installRelease(wanted, here ?? undefined);
  }

  /** Takes what was handed over: the release, or something to ask about first. */
  async function handOver(sources: SourceFile[]): Promise<void> {
    if (!release || !mod || !sources.length) return;
    message = null;
    const first = sources[0]!;
    const name = sources.length === 1 ? first.path.slice(first.path.lastIndexOf('/') + 1) : (first.path.split('/')[0] ?? `${sources.length} files`);
    const size = sources.reduce((sum, source) => sum + source.file.size, 0);
    if (zip) {
      const why = sources.length === 1 ? matchRelease(zip, { name, size }) : 'other-name';
      if (why !== 'same') {
        odd = { sources, name, size, why };
        sfx.deny();
        return;
      }
    } else {
      // A folder, or a zip of one: what it holds says what it is.
      let inside = sources;
      if (sources.length === 1 && looksLikeZip(first.path)) {
        try {
          inside = await openArchives(sources);
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
          sfx.deny();
          return;
        }
      }
      if (!looksLikeMod(mod, inside)) {
        odd = { sources, name, size, why: 'not-mod' };
        sfx.deny();
        return;
      }
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

  async function picked(input: HTMLInputElement | undefined): Promise<void> {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    input.value = '';
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

  const site = $derived(release ? siteOf(release) : '');
  const done = $derived(job?.phase === 'done' && !!mod && isGameId(mod) && !!sys.installs[mod]);

  const listItems = $derived<MenuItem[]>([
    ...INSTALLABLE.map((id, index): MenuItem => {
      const entry = KNOWN_MODS[id];
      const wanted = MOD_RELEASES[id]!;
      const loaded = isGameId(id) && !!sys.installs[id];
      const older = loaded && isOlder(gameDef(id).mod?.version, wanted);
      const offer = isZip(wanted)
        ? `${older ? 'UPDATE TO ' : ''}${wanted.version}, ${formatBytes(wanted.bytes)}`
        : wanted.kind === 'unpack'
          ? 'UNPACK FIRST'
          : 'DESKTOP INSTALLER';
      return {
        key: String(index + 1),
        group: `For ${gameDef(entry.base).title}`,
        label: entry.title,
        state: loaded && !older ? 'LOADED' : offer,
        tone: older ? 'amber' : undefined,
        note: `${entry.blurb} ${HOW[wanted.kind]} From ${siteOf(wanted)}.`,
        icon: 'mod',
        action: () => go(`mods/install/${id}`),
      };
    }),
    { key: '0', label: 'Back', icon: 'back', action: () => go('mods') },
  ]);

  const pageItems = $derived.by((): MenuItem[] => {
    if (!release || !known) return [];
    const blocked = missing ? `NEEDS DECK ${missing.deck}` : undefined;
    const blockedNote = missing ? `${known.title} needs ${missing.title} in deck ${missing.deck}: load it there first.` : '';
    const older = isOlder(hereVersion, release);
    const items: Omit<MenuItem, 'key'>[] = [];
    const download = (label: string, note: string): Omit<MenuItem, 'key'> => ({
      label,
      state: 'OPENS A NEW TAB',
      icon: 'external',
      note,
      action: () => void window.open(release.url, '_blank', 'noopener'),
    });
    const select = (label: string, note: string, input: () => void): Omit<MenuItem, 'key'> => ({
      label,
      state: blocked,
      tone: blocked ? 'amber' : undefined,
      disabled: !!missing,
      icon: 'folder',
      note: blockedNote || note,
      action: input,
    });
    if (done) {
      items.push({ label: `Open ${known.title}`, icon: 'play', note: 'Its page: begin, continue, its deck and its saves.', action: () => go(`mods/${mod}`) });
      if (zip && linked && handed && inCloud === false) {
        items.push({
          label: `Put it in your ${linked.name}`,
          icon: 'cloud',
          note: `Sends ${zip.file} as it is into ${cloudMods} in your ${linked.name}, to load it from there on your other devices.`,
          action: () => void putInCloud(),
        });
      }
    } else if (zip && fetches && linked) {
      items.push({
        label: here ? (older ? `Update to version ${zip.version}` : `Install version ${zip.version} again`) : `Install version ${zip.version}`,
        state: blocked ?? (inCloud ? `IN YOUR ${linked.name.toUpperCase()}` : `VIA ${linked.name.toUpperCase()}`),
        tone: blocked ? 'amber' : undefined,
        disabled: !!missing,
        icon: here ? 'update' : 'download',
        note:
          blockedNote ||
          (inCloud
            ? `${zip.file} is in ${cloudMods} in your ${linked.name} already: the console loads it from there.`
            : `Your ${linked.name} downloads ${zip.file} (${formatBytes(zip.bytes)}) from ${site} into ${cloudMods}, and the console loads it from there. It stays there for your other devices.`),
        action: () => viaCloud(zip),
      });
      items.push(download('Download it with this browser instead', `Downloads ${zip.file} from ${site}. Then select it here, or drop it on this screen.`));
      items.push(select('Select the downloaded file', `${zip.file}, ${formatBytes(zip.bytes)}.`, () => void pick()));
    } else if (zip) {
      items.push(
        release.kind === 'signed-in'
          ? download(`Get version ${zip.version} from ${site}`, `Opens its files page. ${site} asks you to sign in (an account is free); download ${zip.file}, ${formatBytes(zip.bytes)}.`)
          : download(`Download version ${zip.version}`, `Your browser downloads ${zip.file} (${formatBytes(zip.bytes)}) from ${site}, its makers' own link. The console cannot download it itself: ${site} does not let other sites read it.`),
      );
      items.push(
        select(
          here ? (older ? 'Update from the download' : 'Install the download again') : 'Install the download',
          `Select ${zip.file} once it has downloaded, or drop it on this screen. It is read where it lies.`,
          () => void pick(),
        ),
      );
    } else {
      items.push(
        release.kind === 'unpack'
          ? download(`Get ${release.file ?? 'it'} from ${site}`, `Opens its files page${site === 'Nexus Mods' ? `, which asks you to sign in (an account is free)` : ''}. Unpack what you download with 7-Zip or your system's own archive tool.`)
          : download(
              release.file ? 'Download its installer' : `Get it from ${site}`,
              release.file ? `${release.file}, from ${site}. Run it on a Windows desktop, or with Wine.` : `Where its installer and its English translation are had. Run the installer on a Windows desktop, or with Wine.`,
            ),
      );
      const what = release.kind === 'unpack' ? 'the folder it unpacks to' : 'the folder it was installed in';
      if (canPickFolder) items.push(select('Select the folder', `${what.charAt(0).toUpperCase()}${what.slice(1)}. The browser will ask you to confirm the "upload"; nothing leaves this device.`, () => folderInput?.click()));
      items.push(select('Select a zip of the folder', `A zip of ${what}, for a device that cannot pick folders.`, () => zipInput?.click()));
    }
    items.push({ label: `About ${known.title}`, icon: 'manual', note: 'Who makes it, how well it plays here, and the other ways to load it.', action: () => go(`mods/known/${known.id}`) });
    return [
      ...items.map((item, index): MenuItem => ({ ...item, key: item.label.startsWith('About ') ? 'k' : String(index + 1) })),
      { key: '0', label: 'Back', icon: 'back', action: () => go('mods/install') },
    ];
  });

  const oddItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: zip ? 'Select another file' : 'Select another',
      icon: 'folder',
      action: () => {
        odd = null;
        if (zip) void pick();
      },
    },
    {
      key: '2',
      label: 'Load it anyway',
      icon: 'mod',
      note: 'As any mod is loaded: the console finds out what it is.',
      action: () => odd && install(odd.sources, false),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => (odd = null) },
  ]);
</script>

<input class="sr-only" type="file" accept=".zip,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={() => picked(zipInput)} />
<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" webkitdirectory multiple bind:this={folderInput} onchange={() => picked(folderInput)} />

{#if known && release}
  <h1>Install {known.title}</h1>
  <p class="sub">
    {release.version ? `Version ${release.version}, the one the console's tests play` : "The one the console's tests play"}, from its makers' own link.
  </p>
{:else}
  <h1>Install a known mod</h1>
  <p class="sub">Each from its makers' own link: the console fetches what it can, and says what to do with the rest.</p>
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
              {#if zip && odd.why !== 'not-mod'}
                <p class="amber">THAT IS NOT {zip.file.toUpperCase()} OF VERSION {zip.version}</p>
                <p>
                  {odd.name} is {formatBytes(odd.size)}{odd.why === 'other-size' ? `, where version ${zip.version} is ${formatBytes(zip.bytes)}: another version, or a download that did not finish` : `; the console looked for ${zip.file}, ${formatBytes(zip.bytes)}`}.
                </p>
              {:else}
                <p class="amber">THAT DOES NOT LOOK LIKE {known.title.toUpperCase()}</p>
                <p>No file only {known.title} has was found in {odd.name}, nor a folder named after it.</p>
              {/if}
            </div>
          </div>
          <Menu items={oddItems} label="Not the release" bind:selected />
        {:else}
          {#if !job}
            <dl class="readout gap">
              {#if release.version}
                <dt>Version</dt>
                <dd>{release.version}</dd>
              {/if}
              {#if release.file}
                <dt>{release.kind === 'installer' ? 'Installer' : 'File'}</dt>
                <dd>{release.file}{release.bytes ? `, ${formatBytes(release.bytes)}` : ''}</dd>
              {/if}
              <dt>From</dt>
              <dd>{site}{release.kind === 'signed-in' || site === 'Nexus Mods' ? ', which asks you to sign in' : ''}</dd>
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
            {#if !zip}
              <p class="gap prose">
                {#if release.kind === 'unpack'}
                  <span class="hot">1.</span> Download {release.file ?? 'it'} from {site}. <span class="hot">2.</span> Unpack it on your
                  computer: the console opens zips only. <span class="hot">3.</span> Select the folder it unpacks to, or drop it
                  on this screen.
                {:else}
                  <span class="hot">1.</span> Download its installer from {site}. <span class="hot">2.</span> Run it on a Windows
                  desktop, or with Wine: it cannot run in a browser. <span class="hot">3.</span> Select the folder it installed
                  to, or drop it on this screen.
                {/if}
              </p>
              {#if release.note}
                <p class="gap dim prose">{release.note}</p>
              {/if}
            {/if}
            {#if here}
              <p class="gap dim prose">Installing it again replaces the files of the {known.title} loaded here. Its saved games are kept.</p>
            {/if}
          {:else if done && zip && linked && handed && inCloud === false}
            <p class="gap dim prose">It is loaded in this browser. Put it in your {linked.name} as well, and it can be loaded from there on any device.</p>
          {/if}
          <Menu items={pageItems} label={`Install ${known.title}`} bind:selected />
        {/if}
      {/if}
    {:else}
      <Menu items={listItems} label="Install a known mod" bind:selected />
    {/if}
  </div>

  <aside class="board gap" aria-label="Mod release">
    {#if known && release}
      <ModDisk label={`FOR DECK ${gameDef(known.base).deck}`} title={known.short} loaded={!!here} spinning={loading} />
      <p class="dim">
        {#if release.kind === 'signed-in'}
          {site} asks you to sign in before it lets anything be downloaded, so neither your cloud nor the console can: your
          browser downloads it, and the console checks it by its size.
        {:else if release.kind === 'unpack'}
          The console opens zips only: a 7z is unpacked on your computer first, and the folder handed over.
        {:else if release.kind === 'installer'}
          Its installer runs on a Windows desktop only: the console takes the folder it fills, and does the rest.
        {:else if fetches && linked}
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
        <dd>{cloudFetches(linked) ? linked!.name.toUpperCase() : 'THIS BROWSER'}</dd>
      </dl>
    {/if}
  </aside>
</div>
