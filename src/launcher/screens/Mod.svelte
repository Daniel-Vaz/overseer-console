<script lang="ts">
  import { onMount } from 'svelte';
  import { activeCloud } from '../../lib/cloud/clouds';
  import { CloudError } from '../../lib/cloud/errors';
  import { showFolder } from '../../lib/cloud/folders';
  import { listCloudMods, modsFolder, type CloudMod } from '../../lib/cloud/games';
  import { whereabouts } from '../../lib/gamefacts';
  import { gameDef, isGameId, type GameId } from '../../lib/games';
  import { KNOWN_MODS } from '../../lib/mods/catalog';
  import { readComponents, resetComponents, setComponent, type Components } from '../../lib/mods/components';
  import { isOlder, isZip, releaseOf } from '../../lib/mods/releases';
  import { picturesFor } from '../../lib/settings';
  import { sourcesFromFileList } from '../../lib/storage/importer';
  import { formatBytes } from '../../lib/storage/manifest';
  import { removeInstall } from '../../lib/storage/opfs';
  import Glyph from '../components/Glyph.svelte';
  import JobResult from '../components/JobResult.svelte';
  import Loading from '../components/Loading.svelte';
  import Menu from '../components/Menu.svelte';
  import ModDisk from '../components/ModDisk.svelte';
  import { ago, exportedState, stamp } from '../format';
  import { launchGame } from '../launch';
  import { STATUS_NAMES, STATUS_NOTES, modName } from '../mods';
  import { PICTURE_NAMES, PICTURE_NOTES, step } from '../picture';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game }: { go: (path: string) => void; game: GameId } = $props();

  const def = $derived(gameDef(game));
  const mod = $derived(def.mod!);
  const base = $derived(gameDef(mod.base));
  const donor = $derived(mod.donor ? gameDef(mod.donor) : null);
  const known = $derived(mod.known ? KNOWN_MODS[mod.known] : null);
  /** The release of it the console installs, and whether what is here is older. */
  const found = $derived(releaseOf(mod.known));
  // Only a zip told by its size: for the rest, its folder is handed over as below.
  const release = $derived(found && isZip(found) ? found : undefined);
  const outdated = $derived(!!release && isOlder(mod.version, release));
  const install = $derived(sys.installs[game]);
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;

  /** main: the mod. components: its parts switched on and off. holodisk: its files loaded again, or taken out. eject: asked first. */
  let view = $state<'main' | 'components' | 'holodisk' | 'eject'>('main');
  /** Its parts, once read. */
  let components = $state<Components | null>(null);
  let componentSelected = $state(0);
  /** The mods in the Mods folder of the player's cloud, while one is being picked to replace this one's files. */
  let cloud = $state<{ mods: CloudMod[] | null; error: string | null } | null>(null);
  /** The cloud the console is linked to: looked at again whenever the link changes. */
  const linked = $derived.by(() => {
    void sys.cloud;
    return activeCloud();
  });
  /** Its Mods folder, as the console shows it. */
  const cloudMods = $derived(linked ? showFolder(modsFolder(linked)) : '/Mods');
  let folderInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();

  // The copy in progress, when it concerns this mod.
  const job = $derived(sys.job.phase !== 'idle' && sys.job.game === game ? sys.job : null);
  const loading = $derived(job?.phase === 'reading' || job?.phase === 'copying');

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && stepBack()) {
        event.preventDefault();
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function stepBack(): boolean {
    if (cloud) cloud = null;
    else if (view !== 'main') view = view === 'eject' ? 'holodisk' : 'main';
    else return false;
    return true;
  }

  $effect(() => {
    if (job?.phase === 'done') sfx.done();
    else if (job?.phase === 'failed') sfx.deny();
  });

  /** Reads its parts again: after a change, and once its files are (newly) here. */
  async function lookAtComponents(): Promise<void> {
    components = await readComponents(game).catch(() => null);
  }

  $effect(() => {
    void install;
    void lookAtComponents();
  });

  async function switchComponent(name: string, on: boolean): Promise<void> {
    await setComponent(game, name, on);
    await lookAtComponents();
  }

  $effect(() => {
    // New files for this mod turned out to be another one: follow it.
    const going = sys.job.game;
    if ((sys.job.phase === 'copying' || sys.job.phase === 'reading') && going && going !== game && going !== 'mod' && isGameId(going)) {
      go(gameDef(going).mod ? `mods/${going}` : going);
    }
  });

  async function picked(input: HTMLInputElement | undefined): Promise<void> {
    if (!input?.files?.length) return;
    const sources = sourcesFromFileList(input.files);
    input.value = '';
    view = 'main';
    await sys.importFrom(sources, game);
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
    // A deck does not hold on to a mod that is gone.
    if (sys.deckGame(mod.base) === game) sys.setDeckGame(mod.base, mod.base);
    await removeInstall(game);
    sys.clearJob();
    await sys.refresh();
    // Without saves to keep its name for, the mod is forgotten.
    if (!isGameId(game)) go('mods');
  }

  type Entry = Omit<MenuItem, 'key'> & { key?: string };
  function numbered(entries: Entry[]): MenuItem[] {
    let next = 1;
    return entries.map((entry) => ({ ...entry, key: entry.key ?? String(next++) }));
  }

  const resume = $derived(sys.continueFrom(game)?.save ?? null);
  const playable = $derived(sys.playable(game));
  const pictures = $derived(picturesFor(game));
  const picture = $derived(sys.picture(game));
  const inDeck = $derived(sys.deckGame(mod.base) === game);

  /** Ways of handing the console this mod's files again. */
  const sourceItems = $derived.by((): Entry[] => {
    const verb = install ? 'Replace' : 'Load';
    const kept = ' Saved games are kept.';
    return [
      ...(release
        ? [
            {
              label: install ? `${outdated ? 'Update to' : 'Install again,'} version ${release.version}` : `Install version ${release.version}`,
              state: formatBytes(release.bytes),
              note: `${release.file} from its makers' own link, fetched by your Dropbox or downloaded by this browser.${kept}`,
              action: () => go(`mods/install/${known!.id}`),
            },
          ]
        : []),
      {
        label: `${verb} holodisk: select a zip`,
        note: `${known ? known.handOver : `The zip ${def.title} was loaded from, or a newer one.`}${kept}`,
        action: () => zipInput?.click(),
      },
      ...(canPickFolder
        ? [
            {
              label: `${verb} holodisk: select a folder`,
              note: `Its folder, or a game folder it was installed in.${kept}`,
              action: () => folderInput?.click(),
            },
          ]
        : []),
      {
        label: `${verb} holodisk from ${sys.cloud.linked ? sys.cloud.name : 'your cloud'}`,
        state: sys.cloud.linked ? undefined : 'NOT LINKED',
        note: sys.cloud.linked
          ? `From the mods in ${cloudMods} in your ${sys.cloud.name}.${kept}`
          : 'Optional. Link your own Dropbox or Google Drive and keep your mods in its Mods folder.',
        action: () => (sys.cloud.linked ? void lookInCloud() : go('settings/cloud')),
      },
    ];
  });

  const readyItems = $derived(
    numbered([
      ...(resume && playable
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
        state: playable ? undefined : `NEEDS DECK ${base.deck}`,
        tone: playable ? undefined : 'amber',
        disabled: !playable,
        note: playable
          ? `Starts at the main menu of ${modName(game)}, on ${base.title}: new game, load game, options.`
          : `${def.title} is played on ${base.title}: load it into deck ${base.deck} first.`,
        action: () => void launchGame(game),
      },
      {
        label: `In deck ${base.deck}`,
        state: inDeck ? 'YES' : 'NO',
        note: inDeck
          ? `Deck ${base.deck} plays ${def.title}: its Begin and Continue start it. ENTER puts ${base.title} as it was sold back in the deck.`
          : `Puts ${def.title} in deck ${base.deck}, which then plays it in place of ${base.title} as it was sold. The deck can go back with one key.`,
        action: () => sys.setDeckGame(mod.base, inDeck ? mod.base : game),
        adjust: () => sys.setDeckGame(mod.base, inDeck ? mod.base : game),
      },
      {
        label: 'Save archives',
        state: sys.saves[game] ? `${sys.saves[game]} ${sys.saves[game] === 1 ? 'SAVE' : 'SAVES'}${sys.exported[game] ? '' : ', NEVER EXPORTED'}` : 'EMPTY',
        tone: sys.unexported.includes(game) ? 'amber' : undefined,
        note: sys.unexported.includes(game)
          ? "Back up, restore or delete its saved games. These have never been exported: they are only in this browser's storage, which the browser may clear."
          : 'Back up, restore or delete its saved games. They are its own: neither the game it is played on nor another mod sees them.',
        action: () => go(`saves/${game}`),
      },
      {
        label: 'Picture',
        state: PICTURE_NAMES[picture],
        note: `${PICTURE_NOTES[picture]} For ${def.title} only.${pictures.length < 3 ? ` It needs a picture at least ${mod.minHeight} lines tall.` : ''}`,
        action: () => sys.setPicture(game, step(pictures, picture)),
        adjust: (direction) => sys.setPicture(game, step(pictures, picture, direction)),
      },
      ...(components && components.list.length > 1
        ? [
            {
              label: 'Components',
              state: `${components.list.filter((part) => part.on).length} OF ${components.list.length} ON${components.changed ? ', CHANGED' : ''}`,
              note: `The parts its load order switches on, as its installer would offer them: ${components.list
                .slice(0, 3)
                .map((part) => part.title.toLowerCase())
                .join(', ')}${components.list.length > 3 ? '...' : ''}.`,
              action: () => {
                componentSelected = 0;
                view = 'components';
              },
            },
          ]
        : []),
      ...(outdated
        ? [
            {
              label: `Update to version ${release!.version}`,
              state: `HERE: ${mod.version}`,
              tone: 'amber' as const,
              note: `A newer version than the ${mod.version} loaded here, the one the console's tests play. Saved games are kept; a save made with one version may not load in another.`,
              action: () => go(`mods/install/${known!.id}`),
            },
          ]
        : []),
      {
        label: 'Holodisk',
        state: formatBytes(install?.totalBytes ?? 0),
        note: 'Load its files again, for example from a newer version, or eject them from this browser. Saved games are kept either way.',
        action: () => (view = 'holodisk'),
      },
      ...(known
        ? [
            {
              label: `About ${known.title}`,
              note: 'Who makes it, where it is had, and how well it plays on this engine.',
              action: () => go(`mods/known/${known.id}`),
            },
          ]
        : []),
      { key: '0', label: 'Back', action: () => go('mods') },
    ]),
  );

  const holodiskItems = $derived(
    numbered([
      ...sourceItems,
      {
        key: 'e',
        label: 'Eject holodisk',
        note: `Remove the ${formatBytes(install?.totalBytes ?? 0)} of ${def.title} from this browser. Its saved games are kept.`,
        action: () => (view = 'eject'),
      },
      { key: '0', label: 'Back', action: () => (view = 'main') },
    ]),
  );

  /** Its files are not here (ejected), its saves are. */
  const loadItems = $derived(
    numbered([
      ...sourceItems,
      {
        label: 'Save archives',
        state: sys.saves[game] ? `${sys.saves[game]} ${sys.saves[game] === 1 ? 'SAVE' : 'SAVES'}` : 'EMPTY',
        note: 'Its saved games are kept while its files are not here.',
        action: () => go(`saves/${game}`),
      },
      ...(known
        ? [{ label: `About ${known.title}`, note: known.handOver, action: () => go(`mods/known/${known.id}`) }]
        : []),
      { key: '0', label: 'Back', action: () => go('mods') },
    ]),
  );

  const cloudItems = $derived<MenuItem[]>([
    ...(cloud?.mods ?? []).map(
      (entry, index): MenuItem => ({
        key: '123456789abcdfghijkmnpqrstuvwxyz'[index] ?? `d${index}`,
        label: entry.name,
        state: `${entry.zip ? 'ZIP' : `${entry.files} ${entry.files === 1 ? 'FILE' : 'FILES'}`}, ${formatBytes(entry.bytes)}`,
        note: `Loads ${def.title} again from ${entry.name}, fetched from your ${sys.cloud.name}. Saved games are kept.`,
        action: () => {
          cloud = null;
          view = 'main';
          void sys.importModFromCloud(entry.name, game);
        },
      }),
    ),
    { key: '0', label: 'Back', action: () => (cloud = null) },
  ]);

  const componentItems = $derived<MenuItem[]>([
    ...(components?.list ?? []).map(
      (part, index): MenuItem => ({
        key: '123456789abcdfghijklmnopqstuvwxyz'[index] ?? `p${index}`,
        label: part.title,
        state: part.on ? 'ON' : 'OFF',
        tone: part.on ? undefined : 'amber',
        note: `${part.name}: ${part.on ? 'loaded when the mod starts' : 'left out when the mod starts'}. A change takes hold the next time it starts; a save made with a part may need it.`,
        action: () => void switchComponent(part.name, !part.on),
        adjust: () => void switchComponent(part.name, !part.on),
      }),
    ),
    {
      key: 'r',
      label: 'As the mod comes',
      disabled: !components?.changed,
      note: components?.changed ? 'Puts its load order back as it came: every part as its makers switched it.' : 'Every part is as its makers switched it.',
      action: () => void resetComponents(game).then(lookAtComponents),
    },
    { key: '0', label: 'Back', action: () => (view = 'main') },
  ]);

  const ejectItems: MenuItem[] = [
    { key: 'n', label: 'No, keep it', action: () => (view = 'holodisk') },
    { key: 'y', label: 'Yes, eject', danger: true, action: () => void eject() },
  ];
</script>

<h1>{def.title}</h1>
<p class="sub">A mod of {base.title}. {def.blurb}</p>

<input class="sr-only" type="file" tabindex="-1" aria-hidden="true" webkitdirectory multiple bind:this={folderInput} onchange={() => picked(folderInput)} />
<input class="sr-only" type="file" accept=".zip,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={() => picked(zipInput)} />

<!-- The games it is put together from, and whether each is in its deck. -->
{#snippet needs()}
  <dt>Played on</dt>
  <dd class:amber={sys.installs[base.id] === null}>
    {base.title.toUpperCase()}, DECK {base.deck}{sys.installs[base.id] ? ': LOADED' : sys.installs[base.id] === null ? ': NOT LOADED' : ''}
  </dd>
  {#if donor && !install}
    <dt>Built from</dt>
    <dd class:amber={sys.installs[donor.id] === null}>
      {donor.title.toUpperCase()}, DECK {donor.deck}{sys.installs[donor.id] ? ': LOADED' : sys.installs[donor.id] === null ? ': NOT LOADED' : ''}
    </dd>
  {/if}
{/snippet}

<div class="columns">
  <div>
    {#if loading && job}
      <Loading {job} what={def.title} place="the mod" />
    {:else}
      {#if job}
        <JobResult {job} place="the mod" />
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
          <p class="gap prose">
            There are no mods in <span class="hot">{cloudMods}</span> in {linked?.home} in your {sys.cloud.name}.
          </p>
        {/if}
        {#if cloud.mods !== null}
          <Menu items={cloudItems} label={`Mods in your ${sys.cloud.name}`} />
        {/if}
      {:else if view === 'components' && components}
        <p class="gap">COMPONENTS OF {def.title.toUpperCase()}</p>
        <p class="dim prose">
          What its load order switches on: the parts its makers chose, and the ones they left to you. ENTER or the arrows
          switch a part.
        </p>
        <Menu items={componentItems} label="Components" bind:selected={componentSelected} />
      {:else if view === 'eject' && install}
        <div class="signed ask gap">
          <Glyph name="warning" tone="amber" />
          <div>
            <p class="amber">EJECT THE {def.title.toUpperCase()} HOLODISK?</p>
            <p>Its files are removed from this browser. Its saved games stay, and you can load the holodisk again later.</p>
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
          {@render needs()}
          {#if mod.version}
            <dt>Version</dt>
            <dd class:amber={outdated}>{mod.version}{outdated ? `, ${release!.version} IS OUT` : ''}</dd>
          {/if}
          <dt>Status</dt>
          <dd class:amber={mod.status === 'experimental'}>{STATUS_NAMES[mod.status]}</dd>
          <dt>Saved games</dt>
          <dd class:amber={!!sys.saves[game] && !sys.exported[game]}>
            {sys.saves[game] ? `${sys.saves[game]}, LAST EXPORTED ${exportedState(sys.exported[game] ?? null)}` : 'NONE'}
          </dd>
        </dl>
        {#if known?.caveat}
          <p class="gap dim prose">{known.caveat}</p>
        {/if}
        <Menu items={readyItems} label={`${def.title} options`} />
      {:else if install === null}
        <dl class="readout gap">
          <dt>Holodisk</dt>
          <dd class="amber">NOT LOADED</dd>
          {@render needs()}
        </dl>
        <p class="gap prose">
          {def.title}'s files are not in this browser; its saved games are. {known ? known.handOver : 'Load it again from the zip or folder it came from.'}
        </p>
        {#if sys.supported}
          <Menu items={loadItems} label={`Load ${def.title}`} />
        {/if}
      {:else}
        <p class="gap">CHECKING<span class="cursor"></span></p>
      {/if}
    {/if}
  </div>

  <aside class="board gap" aria-label="Mod holodisk">
    <ModDisk label={`FOR DECK ${base.deck}`} title={def.short} loaded={!!install} spinning={loading} />
    <p class="dim">
      {#if install}
        Loaded {stamp(install.importedAt, false)}. {install.files} files, {formatBytes(install.totalBytes)}. {STATUS_NOTES[mod.status]}
      {:else}
        Holds the files of {def.title}, played on {base.title}.
      {/if}
    </p>
  </aside>
</div>
