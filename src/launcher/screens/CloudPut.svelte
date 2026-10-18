<script lang="ts">
  // Put in your cloud: a game or a mod from this device into the player's cloud, as one zip.
  import { onMount } from 'svelte';
  import { activeCloud } from '../../lib/cloud/clouds';
  import { CloudError, LinkError } from '../../lib/cloud/errors';
  import { showFolder } from '../../lib/cloud/folders';
  import { MODS_FOLDER } from '../../lib/cloud/games';
  import type { CloudFile } from '../../lib/cloud/provider';
  import { planPut, type PutKind, type PutPlan } from '../../lib/cloud/put';
  import { sourcesFromFileList, type SourceFile } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { ImportError } from '../../lib/storage/plan';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { ago } from '../format';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  /** Something the cloud holds, as the board lists it. */
  interface Held {
    name: string;
    bytes: number;
  }

  // Folder selection is a desktop browser feature; phones only pick files.
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;
  const cloud = activeCloud();
  const name = cloud?.name ?? 'your cloud';
  const drive = cloud?.id === 'drive';

  let folderInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();
  /** What the next pick is: a game or a mod. */
  let kind = $state<PutKind>('game');
  /** What was dropped, while the player is asked what it is. */
  let dropped = $state.raw<SourceFile[] | null>(null);
  /** Worked out and waiting for a yes, because it replaces what is there. */
  let pending = $state.raw<PutPlan | null>(null);
  let planning = $state(false);
  let message = $state<string | null>(null);
  let asking = $state(false);
  let selected = $state(0);
  /** What the cloud holds now: the games in the games folder (zips, and folders with a MASTER.DAT), and the mods. */
  let held = $state<{ games: Held[]; mods: Held[] } | null>(null);
  let room = $state<{ used: number; total: number } | null>(null);

  const job = $derived(sys.put);
  const sending = $derived(sys.sending);
  const percent = $derived(job?.totalBytes ? Math.min(100, (job.doneBytes / job.totalBytes) * 100) : 0);

  /** Looks at what the games folder holds: what the board lists. */
  async function look(): Promise<void> {
    if (!cloud) return;
    try {
      const { gamesFolder } = cloud.folders();
      const files: CloudFile[] = await cloud.listFiles(gamesFolder, true).catch((err: unknown) => {
        if (err instanceof CloudError && err.notFound) return [];
        throw err;
      });
      const tops = new Map<string, Held & { game: boolean }>();
      const mods = new Map<string, Held>();
      const add = (into: Map<string, Held>, key: string, bytes: number) => {
        const entry = into.get(key.toLowerCase()) ?? { name: key, bytes: 0 };
        entry.bytes += bytes;
        into.set(key.toLowerCase(), entry);
      };
      for (const file of files) {
        const parts = file.path.slice(gamesFolder.length + 1).split('/');
        const top = parts[0]!;
        if (top.toLowerCase() === MODS_FOLDER.toLowerCase()) {
          if (parts.length > 1) add(mods, parts[1]!, file.size);
          continue;
        }
        add(tops, parts.length === 1 ? top : `${top}/`, file.size);
        const entry = tops.get((parts.length === 1 ? top : `${top}/`).toLowerCase())!;
        // A zip at the top, or a folder with the game's archive in it.
        entry.game ||= parts.length === 1 ? /\.zip$/i.test(top) : /^master\.dat$/i.test(parts[parts.length - 1]!);
      }
      held = { games: [...tops.values()].filter((entry) => entry.game), mods: [...mods.values()] };
    } catch {
      held = null;
    }
    room = await cloud.space().catch(() => null);
  }

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    // Dropped here, a game or a mod goes to the cloud instead of into this browser.
    sys.dropTarget = (sources) => {
      if (sending || planning) return;
      message = null;
      dropped = sources;
      selected = 0;
    };
    // ESC takes back a question before it leaves the screen.
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && (asking || pending || dropped)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        asking = false;
        pending = null;
        dropped = null;
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    void look();
    return () => {
      sys.dropTarget = null;
      window.removeEventListener('keydown', onKey, true);
    };
  });

  $effect(() => {
    if (job?.phase === 'done') {
      sfx.done();
      void look();
    } else if (job?.phase === 'failed') sfx.deny();
  });

  async function begin(sources: SourceFile[], what: PutKind): Promise<void> {
    dropped = null;
    message = null;
    planning = true;
    try {
      const plan = await planPut(sources, what);
      if (plan.existing) pending = plan;
      else void sys.putInCloud(plan);
    } catch (err) {
      message = err instanceof ImportError || err instanceof CloudError || err instanceof LinkError ? err.message : String(err);
      sfx.deny();
      sys.refreshCloud();
    }
    planning = false;
  }

  function pick(what: PutKind, input: HTMLInputElement | undefined): void {
    kind = what;
    input?.click();
  }

  async function picked(input: HTMLInputElement | undefined): Promise<void> {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    // Allow picking the same thing again after a failure.
    input.value = '';
    await begin(sources, kind);
  }

  function replace(): void {
    const plan = pending;
    pending = null;
    if (plan) void sys.putInCloud(plan);
  }

  const gamesFolder = cloud ? showFolder(cloud.folders().gamesFolder) : '/';
  const modsAt = cloud ? showFolder(`${cloud.folders().gamesFolder}/${MODS_FOLDER}`) : `/${MODS_FOLDER}`;

  const items = $derived<MenuItem[]>([
    ...(canPickFolder
      ? [
          {
            key: '1',
            label: 'A game: select its folder',
            icon: 'folder',
            disabled: planning,
            note: `The folder the game is installed in, music and all. Once the browser has asked you to confirm, the console packs it into one zip and puts it in the games folder (${gamesFolder}).`,
            action: () => pick('game', folderInput),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '2',
      label: 'A game: select a zip of its folder',
      icon: 'gamedata',
      disabled: planning,
      note: `One zip of the folder the game is installed in. It goes as it is, into the games folder (${gamesFolder}).`,
      action: () => pick('game', zipInput),
    },
    ...(canPickFolder
      ? [
          {
            key: '3',
            label: 'A mod: select its folder',
            icon: 'folder',
            disabled: planning,
            note: `A mod's folder, or a game folder it was installed in. Once the browser has asked you to confirm, the console packs it into one zip and puts it in the Mods folder (${modsAt}).`,
            action: () => pick('mod', folderInput),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '4',
      label: 'A mod: select its zip',
      icon: 'gamedata',
      disabled: planning,
      note: `The zip a mod is downloaded as. It goes as it is, into the Mods folder (${modsAt}).`,
      action: () => pick('mod', zipInput),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings/cloud') },
  ]);

  const droppedItems: MenuItem[] = [
    { key: 'g', label: 'It is a game', icon: 'gamedata', note: `Into ${gamesFolder}, for a game's deck to load.`, action: () => dropped && void begin(dropped, 'game') },
    { key: 'm', label: 'It is a mod', icon: 'gamedata', note: `Into ${modsAt}, for the Mod library to load.`, action: () => dropped && void begin(dropped, 'mod') },
    { key: '0', label: 'Neither: put nothing', icon: 'back', action: () => (dropped = null) },
  ];

  const replaceItems = $derived<MenuItem[]>([
    { key: 'n', label: 'No, keep the one there', action: () => (pending = null) },
    { key: 'y', label: `Yes, replace it`, tone: 'amber', note: 'The one there now is deleted once the new one is all there.', action: replace },
  ]);

  const sendingItems: MenuItem[] = [
    { key: 'x', label: 'Stop', note: `Calls it off. Nothing is left half there in your ${name}.`, action: () => (asking = true) },
  ];

  const stopItems: MenuItem[] = [
    { key: 'n', label: 'No, carry on', action: () => (asking = false) },
    {
      key: 'y',
      label: 'Yes, stop',
      danger: true,
      action: () => {
        asking = false;
        sys.stopPut();
      },
    },
  ];
</script>

<h1>Put in {name}</h1>
<p class="sub">A game or a mod from this device into your {name}, packed into one zip on the way. Any device linked to it loads it from there.</p>

<input
  class="sr-only"
  type="file"
  tabindex="-1"
  aria-hidden="true"
  webkitdirectory
  multiple
  bind:this={folderInput}
  onchange={() => void picked(folderInput)}
/>
<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" accept=".zip,application/zip" bind:this={zipInput} onchange={() => void picked(zipInput)} />

<div class="columns">
  <div>
    {#if job && (job.phase === 'packing' || job.phase === 'sending')}
      <p class="gap">{job.phase === 'packing' ? 'PACKING' : 'SENDING'} {job.name.toUpperCase()} TO {job.cloud.toUpperCase()}</p>
      <div class="meter gap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)}>
        <div class="track"><div class="fill" style:width="{percent}%"></div></div>
        <span>{Math.round(percent)}%</span>
        <span class="dim">{formatBytes(job.doneBytes)} / {formatBytes(job.totalBytes)}</span>
      </div>
      <p class="dim">{job.phase === 'packing' ? `READING ${(job.path ?? '').toUpperCase()}` : 'ON ITS WAY'}</p>
      <p class="gap amber">KEEP THIS TAB OPEN UNTIL IT IS ALL IN YOUR {job.cloud.toUpperCase()}.</p>
      {#if asking}
        <div class="signed ask gap">
          <Glyph name="warning" tone="amber" />
          <div>
            <p class="amber">STOP PUTTING {job.name.toUpperCase()} IN YOUR {job.cloud.toUpperCase()}?</p>
            <p>Nothing of it is left there, and it can be put there again.</p>
          </div>
        </div>
        <Menu items={stopItems} label="Confirm stop" />
      {:else}
        <Menu items={sendingItems} label="While sending" />
      {/if}
    {:else if pending}
      <div class="signed ask gap">
        <Glyph name="warning" tone="amber" />
        <div>
          <p class="amber">
            YOUR {name.toUpperCase()} ALREADY HOLDS {pending.name.toUpperCase()}{pending.existing
              ? ` (${formatBytes(pending.existing.size)}${pending.existing.modified ? `, ${ago(pending.existing.modified)}` : ''})`
              : ''}.
          </p>
          <p>Putting this one there replaces it, once all of it has arrived.</p>
        </div>
      </div>
      <Menu items={replaceItems} label="Confirm replace" />
    {:else if dropped}
      <p class="gap amber">WHAT IS IT?</p>
      <p class="dim prose">Dropped here, it goes to your {name} rather than into this browser.</p>
      <Menu items={droppedItems} label="What was dropped" bind:selected />
    {:else}
      {#if planning}
        <p class="gap" role="status">CONTACTING {name.toUpperCase()}<span class="cursor"></span></p>
      {:else if message}
        <div class="panel signed bad" role="alert">
          <Glyph name="fault" tone="alert" />
          <p class="alert">{message}</p>
        </div>
      {:else if job?.phase === 'done' && job.stored}
        <div class="panel signed" role="status">
          <Glyph name="ok" />
          <p>
            {job.stored.name} ({formatBytes(job.stored.size)}) is in your {job.cloud}. On any device linked to it,
            {job.stored.path.toLowerCase().includes(`/${MODS_FOLDER.toLowerCase()}/`)
              ? `the Mod library loads it: Load a mod, From ${job.cloud}.`
              : `the game's deck loads it: Load holodisk from ${job.cloud}.`}
          </p>
        </div>
      {:else if job?.phase === 'failed'}
        <div class="panel signed bad" role="alert">
          <Glyph name="fault" tone="alert" />
          <p class="alert">{job.error}</p>
        </div>
      {:else if job?.phase === 'stopped'}
        <div class="panel signed" role="status">
          <Glyph name="ok" />
          <p>Stopped. Nothing of {job.name} was left in your {job.cloud}.</p>
        </div>
      {/if}
      {#if drive}
        <p class="prose">
          Google lets the console see only what it put in your Drive itself, so this is the way to get games and mods into
          it. A file put in the Overseer Console folder with Google's own app or website stays out of the console's sight.
        </p>
      {/if}
      <Menu {items} label={`Put in ${name}`} bind:selected />
      {#if canPickFolder}
        <p class="gap dim">OR DROP A GAME OR A MOD, OR ITS ZIP, ANYWHERE ON THIS SCREEN.</p>
      {/if}
    {/if}
  </div>

  <aside class="board gap" aria-label={`In your ${name}`}>
    <Glyph name="uplink" />
    <dl class="readout">
      <dt>Games</dt>
      <dd>{held ? held.games.length || 'NONE' : '...'}</dd>
      <dt>Mods</dt>
      <dd>{held ? held.mods.length || 'NONE' : '...'}</dd>
      {#if room}
        <dt>Room</dt>
        <dd>{formatBytes(Math.max(0, room.total - room.used))} FREE</dd>
      {/if}
    </dl>
    {#if held && (held.games.length || held.mods.length)}
      <ul class="held">
        {#each held.games as entry (entry.name)}
          <li><span>{entry.name}</span> <span class="dim">{formatBytes(entry.bytes)}</span></li>
        {/each}
        {#each held.mods as entry (entry.name)}
          <li><span>{MODS_FOLDER}/{entry.name}</span> <span class="dim">{formatBytes(entry.bytes)}</span></li>
        {/each}
      </ul>
    {/if}
  </aside>
</div>
