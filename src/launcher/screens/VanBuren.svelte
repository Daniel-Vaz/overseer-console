<script lang="ts">
  // The Van Buren tech demo: the Fallout 3 Black Isle never finished. Fetched from the Internet Archive, or loaded
  // from the player's own copy, and played on Open Van Buren from a page of its own (see lib/vanburen/).
  import { onMount } from 'svelte';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { DEMO, DEMO_BYTES } from '../../lib/vanburen/demo';
  import Deck from '../components/Deck.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { stamp } from '../format';
  import { launchDemo } from '../launch';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  // Folder selection is a desktop browser feature; phones only pick files.
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;
  /** about: what the demo is and what of it plays. archive: loading it again, or taking it out. eject, stop: asked first. */
  let view = $state<'main' | 'about' | 'archive' | 'eject' | 'stop'>('main');
  let folderInput: HTMLInputElement | undefined = $state();
  let rarInput: HTMLInputElement | undefined = $state();

  const demo = $derived(sys.demo);
  const job = $derived(sys.demoJob);
  const loading = $derived(job.phase === 'working');
  const percent = $derived(job.totalBytes ? Math.min(100, (job.doneBytes / job.totalBytes) * 100) : 0);

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    void sys.refreshDemo();
    // Dropped here: its archive, its folder or a zip of it.
    const take = (sources: Parameters<typeof sys.loadDemo>[0]) => {
      view = 'main';
      void sys.loadDemo(sources);
    };
    sys.dropTarget = { take, label: 'Release to load the tech demo', blocked: () => sys.loadingDemo || !sys.supported };
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && view !== 'main') {
        event.preventDefault();
        event.stopImmediatePropagation();
        view = view === 'eject' ? 'archive' : 'main';
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      if (sys.dropTarget?.take === take) sys.dropTarget = null;
      window.removeEventListener('keydown', onKey, true);
      sys.clearDemoJob();
    };
  });

  $effect(() => {
    if (job.phase === 'done') sfx.done();
    else if (job.phase === 'failed') sfx.deny();
  });

  function picked(input: HTMLInputElement | undefined): void {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    // Allow picking the same again after a failure.
    input.value = '';
    view = 'main';
    void sys.loadDemo(sources);
  }

  async function eject(): Promise<void> {
    view = 'main';
    await sys.ejectDemo();
  }

  const fetchSize = formatBytes(DEMO.archive.size);
  const keptSize = formatBytes(DEMO_BYTES);

  /** Ways of getting the demo: from the Internet Archive, or from the player's own copy. */
  const sourceItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: `${demo ? 'Fetch again' : 'Fetch'} from the Internet Archive`,
      state: fetchSize,
      note: `Downloads ${DEMO.archive.name} (${fetchSize}) from archive.org into this browser and unpacks it here: ${keptSize} of it is kept. Nothing is uploaded.`,
      action: () => {
        view = 'main';
        void sys.loadDemo();
      },
    },
    {
      key: '2',
      label: `Load ${DEMO.archive.name} from this device`,
      note: `The archive as the Internet Archive has it, downloaded before. It is unpacked here, where it lies; nothing is uploaded.`,
      action: () => rarInput?.click(),
    },
    ...(canPickFolder
      ? [
          {
            key: '3',
            label: 'Load the unpacked folder from this device',
            note: 'The folder F3_Demo.rar was unpacked to: the one with resource.rht and data in it. The browser will ask you to confirm the "upload"; nothing leaves this device.',
            action: () => folderInput?.click(),
          } satisfies MenuItem,
        ]
      : []),
  ]);

  const emptyItems = $derived<MenuItem[]>([
    ...sourceItems,
    { key: 'a', label: 'About the tech demo', note: 'What it is, what of it plays, and who kept it.', action: () => (view = 'about') },
    { key: '0', label: 'Back', action: () => go('') },
  ]);

  const readyItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: 'Begin simulation',
      note: 'Starts at the tech demo\'s main menu: a new game in Junktown, or its map and model browsers. Played with a keyboard and a mouse.',
      action: () => void launchDemo(),
    },
    {
      key: '2',
      label: 'Archive',
      state: formatBytes(demo?.totalBytes ?? 0),
      note: 'Fetch or load the tech demo again, or eject it from this browser.',
      action: () => (view = 'archive'),
    },
    { key: 'a', label: 'About the tech demo', note: 'What it is, what of it plays, and who kept it.', action: () => (view = 'about') },
    { key: '0', label: 'Back', action: () => go('') },
  ]);

  const archiveItems = $derived<MenuItem[]>([
    ...sourceItems,
    {
      key: 'e',
      label: 'Eject the tech demo',
      note: `Removes its ${formatBytes(demo?.totalBytes ?? 0)} from this browser. It can be fetched again at any time.`,
      action: () => (view = 'eject'),
    },
    { key: '0', label: 'Back', action: () => (view = 'main') },
  ]);

  const aboutItems: MenuItem[] = [
    { key: '1', label: 'The tech demo at the Internet Archive', state: 'OPENS A NEW TAB', action: () => window.open(DEMO.archive.page, '_blank', 'noopener') },
    { key: '2', label: 'Open Van Buren, the engine', state: 'OPENS A NEW TAB', action: () => window.open(DEMO.engine.project, '_blank', 'noopener') },
    { key: '0', label: 'Back', action: () => (view = 'main') },
  ];

  // What cannot be had back at the press of a key is not what ENTER lands on.
  const ejectItems: MenuItem[] = [
    { key: 'n', label: 'No, keep it', action: () => (view = 'archive') },
    { key: 'y', label: 'Yes, eject', danger: true, action: () => void eject() },
  ];

  const loadingItems: MenuItem[] = [{ key: 'x', label: 'Stop loading', note: 'Calls it off. What was here before stays as it was.', action: () => (view = 'stop') }];
  const stopItems: MenuItem[] = [
    { key: 'n', label: 'No, carry on', action: () => (view = 'main') },
    {
      key: 'y',
      label: 'Yes, stop loading',
      danger: true,
      action: () => {
        view = 'main';
        sys.stopDemo();
      },
    },
  ];

  /** What the job is doing, in the console's words. */
  const doing = $derived(
    job.step === 'read'
      ? 'READING WHAT YOU SELECTED'
      : job.step === 'fetch'
        ? `FETCHING ${DEMO.archive.name.toUpperCase()} FROM THE INTERNET ARCHIVE`
        : job.step === 'unpack'
          ? 'UNPACKING THE ARCHIVE INTO PRIVATE STORAGE'
          : 'COPYING THE TECH DEMO INTO PRIVATE STORAGE',
  );
</script>

<h1>Simulation 03: {DEMO.title} ({DEMO.year})</h1>
<p class="sub">The Fallout 3 that was never finished. A prototype, kept by the Internet Archive.</p>

<!-- Hidden pickers behind the "load" entries. -->
<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" webkitdirectory multiple bind:this={folderInput} onchange={() => picked(folderInput)} />
<input class="sr-only" type="file" accept=".rar" tabindex="-1" aria-hidden="true" bind:this={rarInput} onchange={() => picked(rarInput)} />

<div class="columns">
  <div>
    {#if loading}
      <p class="gap">{doing}<span class="cursor"></span></p>
      {#if job.step !== 'read' && job.totalBytes}
        <div class="meter gap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)}>
          <div class="track"><div class="fill" style:width="{percent}%"></div></div>
          <span>{Math.round(percent)}%</span>
          <span class="dim">{formatBytes(job.doneBytes)} / {formatBytes(job.totalBytes)}</span>
        </div>
        <p class="dim">{job.path ? `${job.step === 'fetch' ? 'RECEIVING' : 'WRITING'} ${job.path.toUpperCase()}` : 'PREPARING'}</p>
      {/if}
      <p class="gap amber">KEEP THIS TAB OPEN UNTIL IT FINISHES.</p>
      {#if view === 'stop'}
        <div class="signed ask gap">
          <Glyph name="warning" tone="amber" />
          <div>
            <p class="amber">STOP LOADING THE TECH DEMO?</p>
            <p>{job.step === 'fetch' ? 'What was downloaded so far is thrown away.' : 'What was unpacked so far is thrown away.'} The tech demo can be loaded again.</p>
          </div>
        </div>
        <Menu items={stopItems} label="Confirm stop" />
      {:else}
        <Menu items={loadingItems} label="While loading" />
      {/if}
    {:else}
      {#if job.phase === 'failed'}
        <div class="panel signed bad" role="alert">
          <Glyph name="fault" tone="alert" />
          <div>
            <p class="alert">ARCHIVE REJECTED</p>
            <p>{job.error}</p>
          </div>
        </div>
      {:else if job.phase === 'stopped'}
        <div class="panel signed" role="status">
          <Glyph name="warning" tone="amber" />
          <div>
            <p class="amber">LOADING STOPPED</p>
            <p>Nothing was changed.</p>
          </div>
        </div>
      {:else if job.phase === 'done'}
        <div class="panel signed" role="status">
          <Glyph name="ok" />
          <div>
            <p class="hot">TECH DEMO LOADED</p>
            <p>
              {formatBytes(job.totalBytes)} unpacked into this browser's private storage.
              {#if !job.release}This copy differs from the archive.org release; it is played all the same.{/if}
            </p>
          </div>
        </div>
      {/if}

      {#if view === 'about'}
        <div class="gap prose">
          <p>
            In 2003 Black Isle Studios was making Fallout 3, under the name Van Buren, when Interplay cancelled it. This
            tech demo, made to show the game to the rest of Interplay, is all of it that was ever playable. It came to
            light in 2007, and the Internet Archive keeps it.
          </p>
          <p class="gap">
            It is played here on Open Van Buren, an engine written anew for it by sulkytroll, from the demo's own files
            and scripts: Junktown and the Vault, conversations, the journal, turn-based combat, and a browser of all of
            its 38 maps and 3,916 models on its main menu. It keeps no saves, and where the demo's files do not say how
            something worked, the engine makes its best guess.
          </p>
        </div>
        <dl class="readout gap">
          <dt>Made by</dt>
          <dd>{DEMO.maker.toUpperCase()}, {DEMO.year}</dd>
          <dt>Engine</dt>
          <dd>{DEMO.engine.name.toUpperCase()}</dd>
          <dt>Controls</dt>
          <dd>KEYBOARD AND MOUSE. F1 IN THE DEMO LISTS THEM.</dd>
        </dl>
        <Menu items={aboutItems} label="About the tech demo" />
      {:else if view === 'eject' && demo}
        <div class="signed ask gap">
          <Glyph name="eject" tone="amber" />
          <div>
            <p class="amber">EJECT THE TECH DEMO?</p>
            <p>Its files are removed from this browser. It keeps no saves, and can be fetched again at any time.</p>
          </div>
        </div>
        <Menu items={ejectItems} label="Confirm eject" />
      {:else if view === 'archive' && demo}
        <dl class="readout gap">
          <dt>Archive</dt>
          <dd>LOADED, {formatBytes(demo.totalBytes)}, {stamp(demo.importedAt, false)}</dd>
        </dl>
        <Menu items={archiveItems} label="The tech demo's files" />
      {:else if demo}
        <dl class="readout gap">
          <dt>Archive</dt>
          <dd>LOADED, {formatBytes(demo.totalBytes)}, {stamp(demo.importedAt, false)}</dd>
          <dt>Copy</dt>
          <dd class:amber={!demo.release}>{demo.release ? 'THE ARCHIVE.ORG RELEASE' : 'ANOTHER COPY'}</dd>
          <dt>Engine</dt>
          <dd>{DEMO.engine.name.toUpperCase()}</dd>
          <dt>Saved games</dt>
          <dd>NONE: THE DEMO KEEPS NO SAVES</dd>
        </dl>
        <Menu items={readyItems} label="Van Buren options" />
      {:else if demo === null}
        <dl class="readout gap">
          <dt>Archive</dt>
          <dd class="amber">NOT LOADED</dd>
        </dl>
        <p class="gap prose">
          The tech demo of the Fallout 3 Black Isle was making when it was cancelled in 2003, played on an engine
          written anew for it. The Internet Archive keeps the demo: the console fetches it from there into this
          browser's private storage, or loads a copy you already have.
        </p>
        {#if sys.supported}
          <Menu items={emptyItems} label="Load the tech demo" />
          {#if canPickFolder}
            <p class="gap dim">OR DROP {DEMO.archive.name.toUpperCase()} OR ITS UNPACKED FOLDER ANYWHERE ON THIS SCREEN.</p>
          {/if}
        {:else}
          <p class="gap alert">THIS BROWSER CANNOT STORE GAME DATA. SEE THE MAIN DIRECTORY.</p>
        {/if}
      {:else}
        <p class="gap">CHECKING ARCHIVE<span class="cursor"></span></p>
      {/if}
    {/if}
  </div>

  <aside class="board gap" aria-label="Prototype deck">
    <Deck label="PROTOTYPE" title="VAN BUREN" loaded={!!demo} spinning={loading} />
    <p class="dim">
      {#if demo}
        Loaded {stamp(demo.importedAt, false)}. {demo.files} files, {formatBytes(demo.totalBytes)}.
      {:else}
        Holds the files of the Fallout 3 tech demo, {DEMO.maker}, {DEMO.year}.
      {/if}
    </p>
  </aside>
</div>
