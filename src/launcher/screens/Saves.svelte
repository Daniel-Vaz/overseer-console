<script lang="ts">
  import { onMount } from 'svelte';
  import { DropboxError } from '../../lib/dropbox/api';
  import { eraseCloudSave, fetchSave, isSynced, sendSave, surveySaves, type SlotStanding } from '../../lib/dropbox/saves';
  import { gameFacts, paletteFor, whereabouts, type GameFacts } from '../../lib/gamefacts';
  import { GAMES, GAME_IDS, type GameId } from '../../lib/games';
  import { parseCharacter, parseSaveHeader, type Character } from '../../lib/savefile';
  import { deleteSave, exportSaves, listSaves, markForContinue, readSaveArchive, type SaveImport, type SaveSlot } from '../../lib/saves';
  import { ERASED_KEPT_MS, listErased, listVersions, readVersionSave, restoreVersion, type ErasedSlot, type SaveVersion } from '../../lib/storage/history';
  import { formatBytes } from '../../lib/storage/manifest';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Thumbnail from '../components/Thumbnail.svelte';
  import { ago, plural, stamp } from '../format';
  import { launchGame } from '../launch';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game }: { go: (path: string) => void; game: GameId | null } = $props();

  // Keys for what has no number of its own to go by: digits first, then letters that no action on this screen uses.
  const LIST_KEYS = '123456789abcghjklmnpqstvw';
  const SPARE_KEYS = LIST_KEYS.slice(9);

  /**
   * The key that opens each slot: the slot's own number, as far as one key
   * can say it. Slots past the ninth get a letter, and past those none.
   */
  function slotKeys(numbers: number[]): string[] {
    let spare = 0;
    return numbers.map((slot) => (slot >= 1 && slot <= 9 ? String(slot) : (SPARE_KEYS[spare++] ?? `s${slot}`)));
  }

  let slots = $state<SaveSlot[] | null>(null);
  let open = $state<SaveSlot | null>(null);
  let confirm = $state<'delete' | 'import' | 'rollback' | 'fetch' | null>(null);
  /** The earlier versions of the open slot, while they are being looked at. */
  let versions = $state<SaveVersion[] | null>(null);
  let rollback = $state<SaveVersion | null>(null);
  let versionSelected = $state(0);
  /** Slots that were erased and can still be put back, and whether they are being looked at. */
  let erased = $state<ErasedSlot[]>([]);
  let erasedOpen = $state(false);
  let erasedSelected = $state(0);
  /** Picture and character of the version under the cursor, once read. */
  let preview = $state<{ id: number; thumbnail?: Uint8Array; sheet: Character | null } | null>(null);
  /** What the installed game lends for describing saves: its colours and its names. */
  let palette = $state<Uint8Array | null>(null);
  let facts = $state<GameFacts | null>(null);
  let pendingImport = $state<SaveImport | null>(null);
  /** Saves to fetch from Dropbox, while the player is asked about the ones they replace. */
  let pendingFetch = $state<{ items: SlotStanding[]; left: number[] } | null>(null);
  /** What is going on with Dropbox right now, while something is. */
  let cloudBusy = $state<string | null>(null);
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
      pendingFetch = null;
    } else if (versions) {
      versions = null;
    } else if (open) {
      open = null;
    } else if (erasedOpen) {
      erasedOpen = false;
    } else {
      return false;
    }
    return true;
  }

  async function load(): Promise<void> {
    if (!game) return;
    slots = null;
    const current = game;
    // Not waited for: the list is useful before its pictures are.
    void paletteFor(current).then((colours) => current === game && (palette = colours));
    void gameFacts(current).then((known) => current === game && (facts = known));
    try {
      slots = await listSaves(game);
      // Changing saves under a running game would be overwritten by it.
      const held = (await navigator.locks?.query())?.held ?? [];
      running = held.some((lock) => lock.name === `overseer-console:play:${game}`);
    } catch (err) {
      slots = [];
      message = { text: `Could not read the save archives: ${err instanceof Error ? err.message : String(err)}`, bad: true };
    }
    // What was erased is a comfort, not a necessity: the list does without it.
    erased = await listErased(current).catch(() => []);
    if (!erased.length) erasedOpen = false;
    void sys.refresh();
  }

  $effect(() => {
    // Reload whenever the selected game changes.
    void game;
    open = null;
    confirm = null;
    versions = null;
    rollback = null;
    erasedOpen = false;
    message = null;
    void load();
  });

  /** The earlier state of a slot that is under the cursor, in whichever list of them is open. */
  const looking = $derived(versions ? versions[versionSelected] : erasedOpen ? erased[erasedSelected]?.version : undefined);

  $effect(() => {
    const version = looking;
    const current = game;
    if (!version || !current) {
      preview = null;
      return;
    }
    let stale = false;
    void readVersionSave(version)
      .then((data) => {
        if (stale || !data) return;
        preview = { id: version.id, thumbnail: parseSaveHeader(data)?.thumbnail, sheet: parseCharacter(data, GAMES[current].engine.id) };
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  });

  /** The slot under the cursor in the list, when the cursor is on a slot. */
  const pointed = $derived(slots?.[selected] ?? null);

  /** Where a save was made, in the game's own words where its data has them. */
  const where = (save: { map: string; mapIndex: number; elevation: number }) => whereabouts(facts?.places, save);

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
      versionSelected = 0;
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
    const inDropbox = sys.dropbox.linked && isSynced(game, slot);
    const kept = await deleteSave(game, slot);
    open = null;
    confirm = null;
    // What an erased slot held stays in its history for a while.
    const undo = kept ? ' It can be put back for a week: see Erased saves.' : '';
    message = { text: `${slotLabel(slot)} erased.${undo}` };
    if (inDropbox) {
      try {
        const there = await eraseCloudSave(game, slot);
        message = {
          text:
            there === 'erased'
              ? `${slotLabel(slot)} erased, here and in Dropbox.${undo}`
              : `${slotLabel(slot)} erased here. Dropbox holds a different save in that slot, which was left alone.${undo}`,
        };
      } catch (err) {
        message = {
          text: `${slotLabel(slot)} erased here, but not in Dropbox, so the next fetch brings it back. ${err instanceof Error ? err.message : String(err)}`,
          bad: true,
        };
        sys.refreshDropbox();
      }
    }
    await load();
  }

  /** Puts an erased slot back as it was, its earlier versions with it. */
  async function putBack(entry: ErasedSlot): Promise<void> {
    if (!game) return;
    try {
      await restoreVersion(game, entry.slot, entry.version.id);
      message = { text: `${slotLabel(entry.slot)} put back.` };
      sfx.done();
    } catch (err) {
      message = { text: `The save was not put back: ${err instanceof Error ? err.message : String(err)}`, bad: true };
      sfx.deny();
    }
    erasedSelected = 0;
    await load();
  }

  function slotList(list: number[]): string {
    return list.map(slotLabel).join(', ');
  }

  function cloudFailed(err: unknown): void {
    message = {
      text:
        err instanceof DropboxError && err.conflict
          ? 'Dropbox holds a different save than a moment ago: another device was quicker. Try again.'
          : err instanceof Error
            ? err.message
            : String(err),
      bad: true,
    };
    sfx.deny();
    // A link that Dropbox has cancelled is forgotten on the spot.
    sys.refreshDropbox();
  }

  /** Sends the saves that are newer here. One that is newer in Dropbox is never replaced from here. */
  async function uploadSaves(): Promise<void> {
    if (!game || cloudBusy) return;
    message = null;
    cloudBusy = 'CONTACTING DROPBOX';
    try {
      const standings = await surveySaves(game);
      const items = standings.filter((item) => item.standing === 'newer-here' || item.standing === 'only-here');
      const left = standings.filter((item) => item.standing === 'newer-there').map((item) => item.slot);
      for (const [index, item] of items.entries()) {
        cloudBusy = `UPLOADING ${slotLabel(item.slot)} (${index + 1} OF ${items.length})`;
        await sendSave(game, item);
      }
      const sent = items.length
        ? `${plural(items.length, 'save')} uploaded to Dropbox.`
        : standings.some((item) => item.here)
          ? 'Dropbox already holds every save that is in this browser.'
          : 'There are no saves here to upload.';
      const one = left.length === 1;
      message = {
        text: left.length ? `${sent} ${slotList(left)} ${one ? 'is' : 'are'} newer in Dropbox and ${one ? 'was' : 'were'} left alone: fetch ${one ? 'it' : 'them'} first.` : sent,
      };
      sfx.done();
    } catch (err) {
      cloudFailed(err);
    }
    cloudBusy = null;
  }

  /** Brings in the saves that are newer in Dropbox, asking first when they replace saves here. */
  async function fetchSaves(): Promise<void> {
    if (!game || cloudBusy) return;
    message = null;
    cloudBusy = 'CONTACTING DROPBOX';
    try {
      const standings = await surveySaves(game);
      const items = standings.filter((item) => item.standing === 'newer-there' || item.standing === 'only-there');
      const left = standings.filter((item) => item.standing === 'newer-here').map((item) => item.slot);
      if (!items.length) {
        const one = left.length === 1;
        const nothing = standings.some((item) => item.there) ? 'Dropbox holds nothing newer than this browser.' : `There are no saves for ${def?.title} in Dropbox yet.`;
        message = { text: left.length ? `${nothing} ${slotList(left)} ${one ? 'is' : 'are'} newer here: upload ${one ? 'it' : 'them'}.` : nothing };
      } else if (items.some((item) => item.standing === 'newer-there')) {
        pendingFetch = { items, left };
        confirm = 'fetch';
      } else {
        await commitFetch(items, left);
      }
    } catch (err) {
      cloudFailed(err);
    }
    cloudBusy = null;
  }

  async function commitFetch(items: SlotStanding[], left: number[]): Promise<void> {
    if (!game) return;
    pendingFetch = null;
    confirm = null;
    try {
      for (const [index, item] of items.entries()) {
        cloudBusy = `FETCHING ${slotLabel(item.slot)} (${index + 1} OF ${items.length})`;
        await fetchSave(game, item);
      }
      const one = left.length === 1;
      const fetched = `${plural(items.length, 'save')} fetched from Dropbox.`;
      message = { text: left.length ? `${fetched} ${slotList(left)} ${one ? 'is' : 'are'} newer here and ${one ? 'was' : 'were'} left alone.` : fetched };
      sfx.done();
    } catch (err) {
      cloudFailed(err);
    }
    cloudBusy = null;
    // Whatever arrived before a failure is in place.
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

  const listItems = $derived.by((): MenuItem[] => {
    const list = slots ?? [];
    const keys = slotKeys(list.map((save) => save.slot));
    return [
      ...list.map(
        (save, index): MenuItem => ({
          key: keys[index]!,
          label: `${slotLabel(save.slot)}  ${save.valid ? save.description || '(no description)' : 'UNREADABLE'}`,
          state: save.valid ? `${save.character}${save.sheet?.level ? `, LEVEL ${save.sheet.level}` : ''}  ${save.gameDate}` : '',
          tone: save.valid ? undefined : 'alert',
          note: save.valid
            ? `${where(save)}, ${save.gameClock} hours. ${formatBytes(save.bytes)} in ${save.files} files.` +
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
        disabled: !list.length,
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
      ...(sys.dropbox.linked
        ? ([
            {
              key: 'u',
              label: 'Upload to Dropbox',
              icon: 'export-save',
              disabled: cloudBusy !== null || !list.length,
              note: list.length
                ? 'Sends the saves that are newer here than in your Dropbox. A save that is newer there is never replaced.'
                : 'There are no saves here to upload.',
              action: () => void uploadSaves(),
            },
            {
              key: 'f',
              label: 'Fetch from Dropbox',
              icon: 'import-save',
              disabled: cloudBusy !== null || running,
              note: running
                ? 'Close the running simulation first.'
                : 'Brings in the saves that are newer in your Dropbox than here. What they replace is kept as an earlier version.',
              action: () => void fetchSaves(),
            },
          ] satisfies MenuItem[])
        : ([
            {
              key: 'u',
              label: 'Keep saves in your Dropbox',
              state: 'NOT LINKED',
              icon: 'uplink',
              note: 'Optional. Link your own Dropbox to carry saves between devices.',
              action: () => go('settings/dropbox'),
            },
          ] satisfies MenuItem[])),
      // Only while there is something to put back.
      ...(erased.length
        ? ([
            {
              key: 'r',
              label: 'Erased saves',
              state: `${erased.length} KEPT`,
              icon: 'save',
              note: 'Saves erased within the last week. Any of them can be put back in its slot.',
              action: () => {
                message = null;
                erasedSelected = 0;
                erasedOpen = true;
              },
            },
          ] satisfies MenuItem[])
        : []),
      { key: '0', label: 'Back', icon: 'back', action: () => go('saves') },
    ];
  });

  const slotItems = $derived<MenuItem[]>([
    {
      key: 'l',
      label: 'Load this save',
      icon: 'play',
      disabled: !open?.valid || !game || !sys.playable(game) || running,
      note: running
        ? 'The simulation is already running in another tab or window.'
        : game && !sys.installs[game]
          ? 'Load the holodisk first: the game data is not in this browser.'
          : game && !sys.playable(game)
            ? `Load ${GAMES[GAMES[game].conversion!.base].title} first: this game runs on it.`
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
      danger: !running,
      disabled: running,
      note: running
        ? 'Close the running simulation first.'
        : open?.valid
          ? 'Takes the save out of its slot. It can be put back for a week.'
          : 'Cannot be undone: the slot holds no save the console can read.',
      action: () => (confirm = 'delete'),
    },
    { key: '0', label: 'Back', action: () => (open = null) },
  ]);

  const CAUSES = {
    save: 'Replaced by a later save',
    import: 'Replaced when an archive was restored over the slot',
    restore: 'Replaced when the slot was rolled back',
    cloud: 'Replaced by a save fetched from Dropbox',
    erase: 'Erased',
  } as const;

  const versionItems = $derived<MenuItem[]>([
    ...(versions ?? []).map(
      (version, index): MenuItem => ({
        key: LIST_KEYS[index] ?? `v${index}`,
        label: `${stamp(version.id)}  ${version.header.description || '(no description)'}`,
        state: ago(version.id),
        icon: 'save',
        disabled: running,
        note: running
          ? 'Close the running simulation first.'
          : `${version.header.character}, ${where(version.header)}, ${version.header.gameDate}, ${version.header.gameClock} hours. ` +
            `${formatBytes(version.bytes)}. ${CAUSES[version.cause]}, ${stamp(version.replacedAt)}.`,
        action: () => {
          rollback = version;
          confirm = 'rollback';
        },
      }),
    ),
    { key: '0', label: 'Back', icon: 'back', action: () => (versions = null) },
  ]);

  const erasedItems = $derived.by((): MenuItem[] => {
    const keys = slotKeys(erased.map((entry) => entry.slot));
    return [
      ...erased.map(
        ({ slot, version, earlier }, index): MenuItem => ({
          key: keys[index]!,
          label: `${slotLabel(slot)}  ${version.header.description || '(no description)'}`,
          state: `ERASED ${ago(version.replacedAt)}`,
          icon: 'save',
          disabled: running,
          note: running
            ? 'Close the running simulation first.'
            : `${version.header.character}, ${where(version.header)}, ${version.header.gameDate}, ${version.header.gameClock} hours. ` +
              `${formatBytes(version.bytes)}${earlier ? `, with ${plural(earlier, 'earlier version')}` : ''}. ` +
              `Kept until ${stamp(version.replacedAt + ERASED_KEPT_MS, false)}.`,
          action: () => void putBack(erased[index]!),
        }),
      ),
      { key: '0', label: 'Back', icon: 'back', action: () => (erasedOpen = false) },
    ];
  });

  // In every one of these ENTER lands on leaving things as they are.
  const rollbackItems: MenuItem[] = [
    {
      key: 'n',
      label: 'No, leave the slot as it is',
      action: () => {
        rollback = null;
        confirm = null;
      },
    },
    { key: 'y', label: 'Yes, roll back', tone: 'amber', action: () => void rollBack() },
  ];

  const deleteItems: MenuItem[] = [
    { key: 'n', label: 'No, keep it', action: () => (confirm = null) },
    { key: 'y', label: 'Yes, erase it', danger: true, action: () => void remove() },
  ];

  const fetchItems: MenuItem[] = [
    {
      key: 'n',
      label: 'No, cancel',
      action: () => {
        pendingFetch = null;
        confirm = null;
      },
    },
    { key: 'y', label: 'Yes, fetch and replace', tone: 'amber', action: () => pendingFetch && void commitFetch(pendingFetch.items, pendingFetch.left) },
  ];

  const importItems: MenuItem[] = [
    {
      key: 'n',
      label: 'No, cancel',
      action: () => {
        pendingImport = null;
        confirm = null;
      },
    },
    { key: 'y', label: 'Yes, replace them', tone: 'amber', action: () => void commitImport() },
  ];
</script>

<input class="sr-only" type="file" accept=".zip,application/zip" tabindex="-1" aria-hidden="true" bind:this={zipInput} onchange={pickedArchive} />

<!-- Picture and character of an earlier state of a slot, beside the list it was picked from. -->
{#snippet earlier(label: string)}
  {#if preview && looking?.id === preview.id}
    <aside class="board gap" aria-label={label}>
      {#if preview.thumbnail && palette}
        <Thumbnail pixels={preview.thumbnail} {palette} label="The screen when this was saved" />
      {/if}
      {#if preview.sheet && game}
        <Sheet character={preview.sheet} {game} {facts} />
      {/if}
    </aside>
  {/if}
{/snippet}

{#if !game || !def}
  <h1>Save archives</h1>
  <p class="sub">Saved games are kept in this browser. Export them to keep a copy elsewhere.</p>
  <Menu items={gameItems} label="Choose a game" />
{:else}
  <h1>Save archives: {def.title}</h1>

  {#if message}
    <div class="panel signed" class:bad={message.bad} role="status">
      <Glyph name={message.bad ? 'fault' : 'ok'} tone={message.bad ? 'alert' : undefined} />
      <p class:alert={message.bad}>{message.text}</p>
    </div>
  {/if}

  {#if slots === null}
    <p class="gap">READING ARCHIVES<span class="cursor"></span></p>
  {:else if confirm === 'import' && pendingImport}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">
          {pendingImport.conflicts.map(slotLabel).join(', ')}
          {pendingImport.conflicts.length === 1 ? 'ALREADY HOLDS A SAVE' : 'ALREADY HOLD SAVES'}.
        </p>
        <p>Restoring the archive replaces them. What they hold now is kept as an earlier version.</p>
      </div>
    </div>
    <Menu items={importItems} label="Confirm import" />
  {:else if confirm === 'fetch' && pendingFetch}
    {@const replaced = pendingFetch.items.filter((item) => item.standing === 'newer-there').map((item) => item.slot)}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">
          {slotList(replaced)}
          {replaced.length === 1 ? 'HOLDS AN OLDER SAVE' : 'HOLD OLDER SAVES'} IN THIS BROWSER.
        </p>
        <p>
          Fetching replaces {replaced.length === 1 ? 'it' : 'them'} with what your Dropbox holds. What
          {replaced.length === 1 ? 'the slot holds' : 'the slots hold'} now is kept as an earlier version.
        </p>
      </div>
    </div>
    <Menu items={fetchItems} label="Confirm fetch" />
  {:else if open && confirm === 'delete'}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">ERASE {slotLabel(open.slot)} "{open.description}"?</p>
        <p>
          {#if open.valid}
            It is kept for a week under Erased saves{#if open.versions}, with its {plural(open.versions, 'earlier version')},{/if}
            and can be put back from there.
          {:else}
            This cannot be undone: the slot holds no save the console can read.
          {/if}
          {#if sys.dropbox.linked && isSynced(game, open.slot)}Its copy in your Dropbox is erased as well.{/if}
        </p>
      </div>
    </div>
    <Menu items={deleteItems} label="Confirm erase" />
  {:else if open && rollback && confirm === 'rollback'}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">ROLL {slotLabel(open.slot)} BACK TO THE SAVE OF {stamp(rollback.id)}?</p>
        <p>
          "{rollback.header.description || 'no description'}": {rollback.header.character}, {where(rollback.header)},
          {rollback.header.gameDate}, {rollback.header.gameClock} hours.
        </p>
        <p>The save now in the slot is kept as an earlier version, so you can change your mind.</p>
      </div>
    </div>
    <Menu items={rollbackItems} label="Confirm roll back" />
  {:else if open && versions}
    <div class="columns portrait">
      <div>
        <p class="gap">{slotLabel(open.slot)}: EARLIER VERSIONS</p>
        <p class="dim prose">
          The console keeps what a slot held each time it is saved over: the latest three, and a thinning trail of
          older ones reaching back days. Choose one to put it back in the slot.
        </p>
        <Menu items={versionItems} label="Earlier versions" bind:selected={versionSelected} />
      </div>
      {@render earlier('This version')}
    </div>
  {:else if open}
    <div class="columns portrait">
    <div>
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
      <dd>{where(open)}</dd>
      <dt>Saved</dt>
      <dd>{open.savedAt ? `${stamp(open.savedAt)} (${ago(open.savedAt)})` : 'UNKNOWN'}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(open.bytes)} in {open.files} files</dd>
    </dl>
    <Menu items={slotItems} label="Save options" />
    </div>
    <aside class="board gap" aria-label="Character">
      {#if open.thumbnail && palette}
        <Thumbnail pixels={open.thumbnail} {palette} label="The screen when this game was saved" />
      {:else}
        <Glyph name="save" tone={open.valid ? undefined : 'alert'} />
      {/if}
      {#if open.sheet}
        <Sheet character={open.sheet} {game} {facts} />
      {:else if open.valid}
        <p class="dim">THE CHARACTER SHEET OF THIS SAVE COULD NOT BE READ.</p>
      {/if}
    </aside>
    </div>
  {:else if erasedOpen}
    <div class="columns portrait">
      <div>
        <p class="gap">ERASED SAVES</p>
        <p class="dim prose">
          What an erased slot held is kept for a week, with its earlier versions. Choose one to put it back in its
          slot as it was.
        </p>
        <Menu items={erasedItems} label="Erased saves" bind:selected={erasedSelected} />
      </div>
      {@render earlier('This save')}
    </div>
  {:else}
    {#if !slots.length}
      <p class="gap dim">NO SAVED GAMES YET. Saves made in the game (F4, or F6 for a quick save) appear here.</p>
    {/if}
    {#if cloudBusy}
      <p class="gap" role="status">{cloudBusy}<span class="cursor"></span></p>
    {/if}
    <div class="columns">
      <div><Menu items={listItems} label="Saved games" bind:selected /></div>
      {#if pointed?.thumbnail && palette}
        <aside class="board gap" aria-label="Selected save">
          <Thumbnail pixels={pointed.thumbnail} {palette} label="The screen when this game was saved" />
          <dl class="readout">
            <dt>Character</dt>
            <dd>{pointed.character}{pointed.sheet?.level ? `, level ${pointed.sheet.level}` : ''}</dd>
            {#if pointed.sheet}
              <dt>Hit points</dt>
              <dd>{pointed.sheet.hitPoints}/{pointed.sheet.maxHitPoints}</dd>
            {/if}
            <dt>Saved</dt>
            <dd>{pointed.savedAt ? ago(pointed.savedAt) : 'UNKNOWN'}</dd>
          </dl>
        </aside>
      {:else}
        <aside class="board gap" aria-hidden="true">
          <Glyph name={listItems[selected]?.icon ?? 'save'} tone={listItems[selected]?.tone} />
        </aside>
      {/if}
    </div>
  {/if}
{/if}
