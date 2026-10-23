<script lang="ts">
  // The add-ons laid over a game or mod: switched on and off, and loaded for it.
  import { onMount } from 'svelte';
  import { engineGame } from '../../lib/addons';
  import { activeCloud } from '../../lib/cloud/clouds';
  import { CloudError } from '../../lib/cloud/errors';
  import { showFolder } from '../../lib/cloud/folders';
  import { listCloudMods, modsFolder, type CloudMod } from '../../lib/cloud/games';
  import { gameDef, type GameId } from '../../lib/games';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { addonHolds, addonName } from '../mods';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';
  import Glyph from './Glyph.svelte';
  import JobResult from './JobResult.svelte';
  import Loading from './Loading.svelte';
  import Menu from './Menu.svelte';

  /** `game`: the game or mod they are laid over. `back`: leaves this view. */
  let { game, go, back }: { game: GameId; go: (path: string) => void; back: () => void } = $props();

  const def = $derived(gameDef(game));
  const base = $derived(engineGame(game));
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;
  let folderInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();
  let selected = $state(0);
  /** The mods folder of the player's cloud, while an add-on is picked from it. */
  let cloud = $state<{ mods: CloudMod[] | null; error: string | null } | null>(null);
  const linked = $derived.by(() => {
    void sys.cloud;
    return activeCloud();
  });
  const cloudMods = $derived(linked ? showFolder(modsFolder(linked)) : '/Mods');

  // An add-on being loaded for this game or mod.
  const job = $derived(sys.job.phase !== 'idle' && sys.job.game === 'addon' && sys.job.target === game ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');

  /** Those laid over it, the one under the others first; then the rest made for its game. */
  const laid = $derived(sys.laid[game] ?? []);
  const addons = $derived([
    ...laid.map((id) => sys.addons.find((record) => record.id === id)!).filter(Boolean),
    ...sys.addons.filter((record) => record.base === base && !laid.includes(record.id)),
  ]);

  function load(sources: Parameters<typeof sys.importAddon>[0]): void {
    void sys.importAddon(sources, { base, target: game });
  }

  onMount(() => {
    // An add-on dropped on the console while this is on the screen is one for this game or mod.
    sys.dropTarget = { take: load, label: `Release to load the add-on for ${def.title}`, blocked: () => sys.busy || !sys.supported };
    return () => {
      if (sys.dropTarget?.take === load) sys.dropTarget = null;
    };
  });

  /** Closes the list of the cloud's mods folder, where it is open: what ESC does here first. False when it is not. */
  export function stepBack(): boolean {
    if (!cloud) return false;
    cloud = null;
    return true;
  }

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  function picked(input: HTMLInputElement | undefined): void {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    input.value = '';
    load(sources);
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

  const KEYS = '123456789abeghijknpqrstuvwxy';

  const items = $derived<MenuItem[]>([
    ...addons.map((record, index): MenuItem => {
      const on = laid.includes(record.id);
      const position = laid.indexOf(record.id);
      const info = sys.addonInstalls[record.id];
      const under = laid.slice(0, position).map((id) => sys.addons.find((other) => other.id === id)?.title ?? id);
      return {
        key: KEYS[index] ?? `a${index}`,
        label: addonName(record),
        state: on ? (laid.length > 1 ? `ON, ${position + 1} OF ${laid.length}` : 'ON') : 'OFF',
        note: `${info ? `${addonHolds(info)}. ` : ''}${
          on
            ? `Laid over ${def.title} when it starts${under.length ? `, over ${under.join(' and ')}` : ''}.`
            : `Not laid over ${def.title}. Switched on, it goes over the others.`
        } A save made with an add-on may need it.`,
        action: () => sys.switchAddon(game, record.id, !on),
        adjust: () => sys.switchAddon(game, record.id, !on),
      };
    }),
    {
      key: 'z',
      label: 'Load an add-on: select a zip',
      note: `The zip an add-on for ${gameDef(base).title} is downloaded as, or the one archive it is. It is laid over ${def.title} once it is loaded.`,
      action: () => zipInput?.click(),
    },
    ...(canPickFolder
      ? [
          {
            key: 'f',
            label: 'Load an add-on: select a folder',
            note: `Its folder, as it would be unpacked into the game folder. It is laid over ${def.title} once it is loaded.`,
            action: () => folderInput?.click(),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: 'd',
      label: `Load an add-on from ${sys.cloud.linked ? sys.cloud.name : 'your cloud'}`,
      state: sys.cloud.linked ? undefined : 'NOT LINKED',
      note: sys.cloud.linked
        ? `From ${cloudMods} in your ${sys.cloud.name}, where add-ons are kept beside the mods.`
        : 'Optional. Link your own Dropbox or Google Drive and keep your mods and add-ons in its Mods folder.',
      action: () => (sys.cloud.linked ? void lookInCloud() : go('settings/cloud')),
    },
    { key: '0', label: 'Back', action: back },
  ]);

  const cloudItems = $derived<MenuItem[]>([
    ...(cloud?.mods ?? []).map(
      (entry, index): MenuItem => ({
        key: KEYS[index] ?? `d${index}`,
        label: entry.name,
        state: `${entry.zip ? 'ZIP' : `${entry.files} ${entry.files === 1 ? 'FILE' : 'FILES'}`}, ${formatBytes(entry.bytes)}`,
        note: `Loads the add-on in ${entry.name}, fetched from your ${sys.cloud.name}, and lays it over ${def.title}.`,
        action: () => {
          cloud = null;
          void sys.importAddonFromCloud(entry.name, { base, target: game });
        },
      }),
    ),
    { key: '0', label: 'Back', action: () => (cloud = null) },
  ]);
</script>

<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" webkitdirectory multiple bind:this={folderInput} onchange={() => picked(folderInput)} />
<input class="sr-only" type="file" accept=".zip,.dat,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={() => picked(zipInput)} />

{#if loading && job}
  <Loading {job} what="add-on" place={def.title} />
{:else}
  {#if job}
    <JobResult {job} place={def.title} />
  {/if}
  {#if cloud}
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
  {:else}
    <p class="gap">ADD-ONS OF {def.title.toUpperCase()}</p>
    {#if addons.length}
      <p class="dim prose">
        Laid over {def.title} when it starts, each over the ones switched on before it. ENTER or the arrows switch one.
      </p>
    {:else}
      <p class="dim prose">
        None for {gameDef(base).title} yet. An add-on is a small mod with no game of its own, laid over a game or a
        mod: archives for its load order, global scripts, music, loose data. Load one here, from the zip it is
        downloaded as, and it is laid over {def.title} at once.
      </p>
    {/if}
    <Menu {items} label={`Add-ons of ${def.title}`} bind:selected />
  {/if}
{/if}
