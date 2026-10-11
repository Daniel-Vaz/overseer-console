<script lang="ts">
  import { onMount } from 'svelte';
  import { GAMES, GAME_IDS, type GameId } from '../../lib/games';
  import { deleteSave, exportSaves, listSaves, readSaveArchive, type SaveImport, type SaveSlot } from '../../lib/saves';
  import { formatBytes } from '../../lib/storage/manifest';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game }: { go: (path: string) => void; game: GameId | null } = $props();

  // Slot keys: digits first, then letters that no action on this screen uses.
  const SLOT_KEYS = '123456789abcfghjklmnpqrstuvw';

  let slots = $state<SaveSlot[] | null>(null);
  let open = $state<SaveSlot | null>(null);
  let confirm = $state<'delete' | 'import' | null>(null);
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
  });

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
        note: save.valid ? `${save.map}, ${save.gameClock} hours. ${formatBytes(save.bytes)} in ${save.files} files.` : undefined,
        icon: 'save',
        action: () => (open = save),
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
    <p>Restoring the archive replaces them.</p>
    <Menu items={importItems} label="Confirm import" />
  {:else if open && confirm === 'delete'}
    <p class="gap amber">ERASE {slotLabel(open.slot)} "{open.description}"?</p>
    <p>This cannot be undone. Export it first if you may want it back.</p>
    <Menu items={deleteItems} label="Confirm erase" />
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
      <dd>{open.savedAt ? new Date(open.savedAt).toLocaleString().toUpperCase() : 'UNKNOWN'}</dd>
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
