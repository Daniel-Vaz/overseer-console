<script lang="ts">
  import { onMount } from 'svelte';
  import { GAMES, GAME_IDS, type GameId } from '../../lib/games';
  import { deleteSave, exportSaves, listSaves, markForContinue, readSaveArchive, type SaveImport, type SaveSlot } from '../../lib/saves';
  import { listVersions, restoreVersion, type SaveVersion } from '../../lib/storage/history';
  import { formatBytes } from '../../lib/storage/manifest';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { ago, plural, stamp } from '../format';
  import { launchGame } from '../launch';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game }: { go: (path: string) => void; game: GameId | null } = $props();

  // Slot keys: digits first, then letters that no action on this screen uses.
  const SLOT_KEYS = '123456789abcfghjklmnpqrstuvw';

  let slots = $state<SaveSlot[] | null>(null);
  let open = $state<SaveSlot | null>(null);
  let confirm = $state<'delete' | 'import' | 'rollback' | null>(null);
  /** The earlier versions of the open slot, while they are being looked at. */
  let versions = $state<SaveVersion[] | null>(null);
  let rollback = $state<SaveVersion | null>(null);
  let pendingImport = $state<SaveImport | null>(null);
  let message = $state<{ text: string; bad?: boolean } | null>(null);
  let running = $state(false);
  let selected = $state(0);
  let zipInput: HTMLInputElement | undefined = $state();

  const def = $derived(game ? GAMES[game] : null);

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
    if (confirm) {
      confirm = null;
      rollback = null;
      pendingImport = null;
    } else if (versions) {
      versions = null;
    } else if (open) {
      open = null;
    } else {
      return false;
    }
    return true;
  }

  async function load(): Promise<void> {
    if (!game) return;
    slots = null;
    try {
      slots = await listSaves(game);
      // Changing saves under a running game would be overwritten by it.
      const held = (await navigator.locks?.query())?.held ?? [];
      running = held.some((lock) => lock.name === `overseer-console:play:${game}`);
    } catch (err) {
      slots = [];
      message = { text: `Could not read the save archives: ${err instanceof Error ? err.message : String(err)}`, bad: true };
    }
    void sys.refresh();
  }

  $effect(() => {
    // Reload whenever the selected game changes.
    void game;
    open = null;
    confirm = null;
    versions = null;
    rollback = null;
    message = null;
    void load();
  });

  function slotLabel(slot: number): string {
    return `SLOT ${String(slot).padStart(2, '0')}`;
  }

  function download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function exportNow(slot?: number): Promise<void> {
    if (!game) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = slot === undefined ? 'saves' : `slot${String(slot).padStart(2, '0')}`;
    download(await exportSaves(game, slot), `overseer-${game}-${suffix}-${stamp}.zip`);
    message = { text: slot === undefined ? 'All saves written to a zip file.' : `${slotLabel(slot)} written to a zip file.` };
    sfx.done();
  }

  async function showVersions(): Promise<void> {
    if (!game || !open) return;
    try {
      versions = await listVersions(game, open.slot);
    } catch (err) {
      message = { text: `Could not read the save history: ${err instanceof Error ? err.message : String(err)}`, bad: true };
    }
  }

  async function rollBack(): Promise<void> {
    if (!game || !open || !rollback) return;
    const slot = open.slot;
    const version = rollback;
    try {
      await restoreVersion(game, slot, version.id);
      // The save the player just chose is the one to continue from.
      markForContinue(game, slot, version.id);
      message = { text: `${slotLabel(slot)} rolled back to the save of ${stamp(version.id)}.` };
      sfx.done();
    } catch (err) {
      message = { text: `The slot was not changed: ${err instanceof Error ? err.message : String(err)}`, bad: true };
      sfx.deny();
    }
    confirm = null;
    rollback = null;
    versions = null;
    await load();
    // Stay on the slot, now showing what was put back.
    open = slots?.find((save) => save.slot === slot) ?? null;
  }

  async function remove(): Promise<void> {
    if (!game || !open) return;
    const slot = open.slot;
    await deleteSave(game, slot);
    open = null;
    confirm = null;
    message = { text: `${slotLabel(slot)} erased.` };
    await load();
  }

  async function pickedArchive(): Promise<void> {
    const file = zipInput?.files?.[0];
    if (!file || !game) return;
    zipInput!.value = '';
    try {
      pendingImport = await readSaveArchive(game, file);
      if (pendingImport.conflicts.length) {
        confirm = 'import';
      } else {
        await commitImport();
      }
    } catch (err) {
      pendingImport = null;
      message = { text: err instanceof Error ? err.message : String(err), bad: true };
      sfx.deny();
    }
  }

  async function commitImport(): Promise<void> {
    if (!pendingImport) return;
    const count = pendingImport.slots.length;
    await pendingImport.commit();
    pendingImport = null;
    confirm = null;
    message = { text: `${count} ${count === 1 ? 'save' : 'saves'} restored from the archive.` };
    sfx.done();
    await load();
  }

  const gameItems = $derived<MenuItem[]>([
    ...GAME_IDS.map(
      (id, index): MenuItem => ({
        key: String(index + 1),
        label: GAMES[id].title,
        state: sys.saves[id] ? `${sys.saves[id]} ${sys.saves[id] === 1 ? 'SAVE' : 'SAVES'}` : 'EMPTY',
        action: () => go(`saves/${id}`),
      }),
    ),
    { key: '0', label: 'Back', action: () => go('') },
  ]);

  const listItems = $derived<MenuItem[]>([
    ...(slots ?? []).map(
      (save, index): MenuItem => ({
        key: SLOT_KEYS[index] ?? '?',
        label: `${slotLabel(save.slot)}  ${save.valid ? save.description || '(no description)' : 'UNREADABLE'}`,
        state: save.valid ? `${save.character}  ${save.gameDate}` : '',
        tone: save.valid ? undefined : 'alert',
        note: save.valid
          ? `${save.map}, ${save.gameClock} hours. ${formatBytes(save.bytes)} in ${save.files} files.` +
            (save.versions ? ` ${plural(save.versions, 'earlier version')} kept.` : '')
          : undefined,
        icon: 'save',
        action: () => {
          message = null;
          open = save;
        },
      }),
    ),
    {
      key: 'x',
      label: 'Export all to a zip file',
      icon: 'export-save',
      disabled: !slots?.length,
      note: 'A backup you can keep, move to another browser, or unpack into a desktop install.',
      action: () => void exportNow(),
    },
    {
      key: 'i',
      label: 'Import from a zip file',
      icon: 'import-save',
      disabled: running,
      note: running
        ? 'Close the running simulation first.'
        : 'Accepts archives exported here, or a zipped SAVEGAME folder from a desktop install.',
      action: () => zipInput?.click(),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('saves') },
  ]);

  const slotItems = $derived<MenuItem[]>([
    {
      key: 'l',
      label: 'Load this save',
      icon: 'play',
      disabled: !open?.valid || !game || !sys.installs[game] || running,
      note: running
        ? 'The simulation is already running in another tab or window.'
        : game && !sys.installs[game]
          ? 'Load the holodisk first: the game data is not in this browser.'
          : 'Starts the game and goes straight into this save.',
      action: () => game && open && void launchGame(game, open.slot),
    },
    {
      key: 'v',
      label: 'Earlier versions',
      state: open?.versions ? `${open.versions} KEPT` : 'NONE YET',
      disabled: !open?.versions,
      note: open?.versions
        ? 'What this slot held before it was saved over. Any of them can be put back.'
        : 'Each time this slot is saved over, what it held before is kept here.',
      action: () => void showVersions(),
    },
    { key: 'e', label: 'Export this save to a zip file', action: () => void exportNow(open?.slot) },
    {
      key: 'd',
      label: 'Erase this save',
      tone: 'alert',
      disabled: running,
      note: running ? 'Close the running simulation first.' : 'Cannot be undone.',
      action: () => (confirm = 'delete'),
    },
    { key: '0', label: 'Back', action: () => (open = null) },
  ]);

  const CAUSES = {
    save: 'Replaced by a later save',
    import: 'Replaced when an archive was restored over the slot',
    restore: 'Replaced when the slot was rolled back',
  } as const;

  const versionItems = $derived<MenuItem[]>([
    ...(versions ?? []).map(
      (version, index): MenuItem => ({
        key: SLOT_KEYS[index] ?? '?',
        label: `${stamp(version.id)}  ${version.header.description || '(no description)'}`,
        state: ago(version.id),
        icon: 'save',
        disabled: running,
        note: running
          ? 'Close the running simulation first.'
          : `${version.header.character}, ${version.header.map}, ${version.header.gameDate}, ${version.header.gameClock} hours. ` +
            `${formatBytes(version.bytes)}. ${CAUSES[version.cause]}, ${stamp(version.replacedAt)}.`,
        action: () => {
          rollback = version;
          confirm = 'rollback';
        },
      }),
    ),
    { key: '0', label: 'Back', icon: 'back', action: () => (versions = null) },
  ]);

  const rollbackItems: MenuItem[] = [
    { key: 'y', label: 'Yes, roll back', tone: 'amber', action: () => void rollBack() },
    {
      key: 'n',
      label: 'No, leave the slot as it is',
      action: () => {
        rollback = null;
        confirm = null;
      },
    },
  ];

  const deleteItems: MenuItem[] = [
    { key: 'y', label: 'Yes, erase it', tone: 'alert', action: () => void remove() },
    { key: 'n', label: 'No, keep it', action: () => (confirm = null) },
  ];

  const importItems: MenuItem[] = [
    { key: 'y', label: 'Yes, replace them', tone: 'alert', action: () => void commitImport() },
    {
      key: 'n',
      label: 'No, cancel',
      action: () => {
        pendingImport = null;
        confirm = null;
      },
    },
  ];
</script>

<input class="sr-only" type="file" accept=".zip,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={pickedArchive} />

{#if !game || !def}
  <h1>Save archives</h1>
  <p class="sub">Saved games are kept in this browser. Export them to keep a copy elsewhere.</p>
  <Menu items={gameItems} label="Choose a game" />
{:else}
  <h1>Save archives: {def.title}</h1>

  {#if message}
    <div class="panel" class:bad={message.bad} role="status">
      <p class:alert={message.bad}>{message.text}</p>
    </div>
  {/if}

  {#if slots === null}
    <p class="gap">READING ARCHIVES<span class="cursor"></span></p>
  {:else if confirm === 'import' && pendingImport}
    <p class="gap amber">
      {pendingImport.conflicts.map(slotLabel).join(', ')}
      {pendingImport.conflicts.length === 1 ? 'ALREADY HOLDS A SAVE' : 'ALREADY HOLD SAVES'}.
    </p>
    <p>Restoring the archive replaces them. What they hold now is kept as an earlier version.</p>
    <Menu items={importItems} label="Confirm import" />
  {:else if open && confirm === 'delete'}
    <p class="gap amber">ERASE {slotLabel(open.slot)} "{open.description}"?</p>
    <p>
      This cannot be undone. Export it first if you may want it back.
      {#if open.versions}Its {plural(open.versions, 'earlier version')} {open.versions === 1 ? 'is' : 'are'} erased with it.{/if}
    </p>
    <Menu items={deleteItems} label="Confirm erase" />
  {:else if open && rollback && confirm === 'rollback'}
    <p class="gap amber">ROLL {slotLabel(open.slot)} BACK TO THE SAVE OF {stamp(rollback.id)}?</p>
    <p>
      "{rollback.header.description || 'no description'}": {rollback.header.character}, {rollback.header.map},
      {rollback.header.gameDate}, {rollback.header.gameClock} hours.
    </p>
    <p>The save now in the slot is kept as an earlier version, so you can change your mind.</p>
    <Menu items={rollbackItems} label="Confirm roll back" />
  {:else if open && versions}
    <p class="gap">{slotLabel(open.slot)}: EARLIER VERSIONS</p>
    <p class="dim prose">
      The console keeps what a slot held each time it is saved over: the latest three, and a thinning trail of older
      ones reaching back days. Choose one to put it back in the slot.
    </p>
    <Menu items={versionItems} label="Earlier versions" />
  {:else if open}
    <dl class="readout gap">
      <dt>Slot</dt>
      <dd>{String(open.slot).padStart(2, '0')}</dd>
      <dt>Description</dt>
      <dd>{open.description || '(none)'}</dd>
      <dt>Character</dt>
      <dd>{open.character}</dd>
      <dt>Game date</dt>
      <dd>{open.gameDate}, {open.gameClock} hours</dd>
      <dt>Location</dt>
      <dd>{open.map}</dd>
      <dt>Saved</dt>
      <dd>{open.savedAt ? `${stamp(open.savedAt)} (${ago(open.savedAt)})` : 'UNKNOWN'}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(open.bytes)} in {open.files} files</dd>
    </dl>
    <Menu items={slotItems} label="Save options" />
  {:else}
    {#if !slots.length}
      <p class="gap dim">NO SAVED GAMES YET. Saves made in the game (F4, or F6 for a quick save) appear here.</p>
    {/if}
    <div class="columns">
      <div><Menu items={listItems} label="Saved games" bind:selected /></div>
      <aside class="board gap" aria-hidden="true">
        <Glyph name={listItems[selected]?.icon ?? 'save'} />
      </aside>
    </div>
  {/if}
{/if}
