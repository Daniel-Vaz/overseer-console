<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { gameFacts, paletteFor, type GameFacts } from '../../lib/gamefacts';
  import { GAMES, type GameId } from '../../lib/games';
  import { WriteError } from '../../lib/modify/record';
  import { STAT } from '../../lib/modify/rules';
  import { SessionError, openSession } from '../../lib/modify/session';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { plural } from '../format';
  import { isTyping } from '../keys';
  import { launchGame } from '../launch';
  import { Editor } from '../modify/editor.svelte';
  import InventorySection from '../modify/InventorySection.svelte';
  import PerksSection from '../modify/PerksSection.svelte';
  import RecordSection from '../modify/RecordSection.svelte';
  import SkillsSection from '../modify/SkillsSection.svelte';
  import SpecialSection from '../modify/SpecialSection.svelte';
  import TraitsSection from '../modify/TraitsSection.svelte';
  import WriteSection from '../modify/WriteSection.svelte';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, game, slot }: { go: (path: string) => void; game: GameId; slot: number } = $props();

  const SECTIONS = [
    { id: 'record', label: 'Record' },
    { id: 'special', label: 'S.P.E.C.I.A.L.' },
    { id: 'skills', label: 'Skills' },
    { id: 'traits', label: 'Traits' },
    { id: 'perks', label: 'Perks' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'write', label: 'Write' },
  ] as const;
  type SectionId = (typeof SECTIONS)[number]['id'];

  let editor = $state<Editor | null>(null);
  let failure = $state<string | null>(null);
  let section = $state<SectionId>('record');
  /** Asked before leaving with changes not written. */
  let leaving = $state(false);
  /** Shown once the changes are in the slot. */
  let written = $state<string | null>(null);
  let message = $state<{ text: string; bad?: boolean } | null>(null);
  let messageTimer = 0;
  let running = $state(false);
  let writing = $state(false);
  let palette = $state<Uint8Array | null>(null);
  let facts = $state<GameFacts | null>(null);

  const def = $derived(GAMES[game]);
  const slotName = $derived(`SLOT ${String(slot).padStart(2, '0')}`);
  const index = $derived(SECTIONS.findIndex((entry) => entry.id === section));

  const HINTS: Record<SectionId, [string, string][]> = {
    record: [['↑↓', 'SELECT'], ['←→', 'CHANGE'], ['ENTER', 'TYPE'], ['H', 'HEAL']],
    special: [['↑↓', 'SELECT'], ['←→', 'CHANGE'], ['ENTER', 'TYPE']],
    skills: [['↑↓', 'SELECT'], ['←→', 'POINTS'], ['ENTER', 'TYPE'], ['T', 'TAG']],
    traits: [['↑↓', 'SELECT'], ['ENTER', 'TAKE / GIVE UP']],
    perks: [['↑↓', 'SELECT'], ['←→', 'RANK'], ['F', 'FILTER']],
    inventory: [['↑↓', 'SELECT'], ['←→', 'HOW MANY'], ['A', 'ADD'], ['D', 'TAKE OUT']],
    write: [['↑↓', 'SELECT'], ['W', 'WRITE'], ['U', 'UNDO']],
  };

  $effect(() => {
    if (!editor || failure) {
      sys.hints = [['ESC', 'BACK']];
    } else if (leaving || written) {
      sys.hints = [['↑↓', 'SELECT'], ['ENTER', 'CHOOSE'], ['ESC', 'BACK']];
    } else if (editor.picking && section === 'inventory') {
      sys.hints = [['TYPE', 'FIND'], ['[ ]', 'KIND'], ['ENTER', 'ADD'], ['ESC', 'DONE']];
    } else {
      sys.hints = [...HINTS[section], ['TAB', 'SECTION'], ['ESC', 'BACK']];
    }
  });

  onMount(() => {
    void paletteFor(game).then((colours) => (palette = colours));
    void gameFacts(game).then((known) => (facts = known));
    void (async () => {
      try {
        const held = (await navigator.locks?.query())?.held ?? [];
        running = held.some((lock) => lock.name === `overseer-console:play:${game}`);
        editor = new Editor(await openSession(game, slot));
      } catch (err) {
        failure = err instanceof SessionError ? err.message : `The save could not be opened: ${err instanceof Error ? err.message : String(err)}`;
        sfx.deny();
      }
    })();

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) return;
      const key = event.key;
      if (key === 'Escape' || key === 'Backspace') {
        // Backspace is the search's own while the list of everything is open.
        if (editor?.picking && section === 'inventory') {
          if (key === 'Backspace') return;
          editor.picking = false;
        } else if (leaving) {
          leaving = false;
        } else if (!stepOut()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        sfx.back();
        return;
      }
      if (!editor || leaving || written) return;
      if (key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        show(SECTIONS[(index + (event.shiftKey ? SECTIONS.length - 1 : 1)) % SECTIONS.length]!.id);
      } else if (/^[1-7]$/.test(key) && !(editor.picking && section === 'inventory')) {
        event.preventDefault();
        event.stopPropagation();
        show(SECTIONS[Number(key) - 1]!.id);
      } else if (key.toLowerCase() === 'w' && section !== 'write' && !(editor.picking && section === 'inventory')) {
        event.preventDefault();
        event.stopPropagation();
        show('write');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      clearTimeout(messageTimer);
    };
  });

  function show(next: SectionId): void {
    if (next === section) return;
    if (editor) editor.picking = false;
    section = next;
    message = null;
    sfx.select();
  }

  /** Leaves, asking first when changes would be lost. False when there is nothing to leave to. */
  function stepOut(): boolean {
    if (editor?.changes.length && !written) {
      leaving = true;
      return true;
    }
    go(`saves/${game}/${slot}`);
    return true;
  }

  function say(text: string, bad = false): void {
    message = { text, bad };
    if (bad) sfx.deny();
    clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => (message = null), bad ? 7000 : 4000);
  }

  async function write(): Promise<void> {
    if (!editor || writing) return;
    const count = editor.changes.length;
    writing = true;
    try {
      const held = (await navigator.locks?.query())?.held ?? [];
      running = held.some((lock) => lock.name === `overseer-console:play:${game}`);
      if (running) throw new WriteError('the game is running in another tab or window: close it first');
      await editor.write();
      written = `${slotName} MODIFIED: ${plural(count, 'change')} written.`;
      sfx.done();
      void sys.refresh();
    } catch (err) {
      say(`The save was not changed: ${err instanceof Error ? err.message : String(err)}.`, true);
    }
    writing = false;
  }

  const leaveItems: MenuItem[] = [
    { key: 'n', label: 'No, keep changing it', action: () => (leaving = false) },
    { key: 'y', label: 'Yes, discard the changes', tone: 'amber', action: () => go(`saves/${game}/${slot}`) },
  ];

  const doneItems = $derived<MenuItem[]>([
    {
      key: 'l',
      label: 'Load this save',
      icon: 'play',
      disabled: running || !sys.playable(game),
      note: running ? 'The game is already running in another tab or window.' : 'Starts the game and goes straight into the changed save.',
      action: () => void launchGame(game, slot),
    },
    {
      key: 'm',
      label: 'Keep changing it',
      icon: 'terminal',
      note: 'Back to the editor, with the save as it now is.',
      action: async () => {
        written = null;
        section = 'record';
        await tick();
      },
    },
    { key: '0', label: 'Back to the save archives', icon: 'back', action: () => go(`saves/${game}/${slot}`) },
  ]);
</script>

<div class="modify">
  <header class="modify-head">
    <h1>Modify save: {slotName}</h1>
    {#if editor}
      <p class="modify-who">
        <span><span class="hot">{editor.record.name || '(nameless)'}</span>, LEVEL {editor.record.level}, {editor.hitPoints}/{editor.stat(STAT.maxHitPoints)} HP <span class="dim">· {def.title}</span></span>
        {#if editor.changes.length && !written}
          <span class="amber">{plural(editor.changes.length, 'CHANGE', 'CHANGES')} NOT WRITTEN</span>
        {/if}
      </p>
    {/if}
  </header>

  {#if failure}
    <div class="panel signed bad" role="alert">
      <Glyph name="fault" tone="alert" />
      <p class="alert">{failure}</p>
    </div>
    <Menu items={[{ key: '0', label: 'Back to the save archives', icon: 'back', action: () => go(`saves/${game}/${slot}`) }]} label="Back" />
  {:else if !editor}
    <p class="gap">READING THE GAME'S RECORDS<span class="cursor"></span></p>
  {:else if written}
    <div class="panel signed" role="status">
      <Glyph name="ok" />
      <div>
        <p>{written}</p>
        <p class="dim">The save as it was is kept under Earlier versions: it can be put back from there.</p>
      </div>
    </div>
    <Menu items={doneItems} label="Written" />
  {:else if leaving}
    <div class="signed ask gap">
      <Glyph name="warning" tone="amber" />
      <div>
        <p class="amber">DISCARD {plural(editor.changes.length, 'CHANGE', 'CHANGES')} NOT WRITTEN?</p>
        <p>Leaving now leaves {slotName} as it is in its slot.</p>
      </div>
    </div>
    <Menu items={leaveItems} label="Confirm leaving" />
  {:else}
    <nav class="sections" aria-label="Sections">
      {#each SECTIONS as entry, number (entry.id)}
        <button type="button" class="section-tab" class:on={entry.id === section} aria-current={entry.id === section ? 'page' : undefined} onclick={() => show(entry.id)}>
          <span class="key">{number + 1}</span>{entry.label}{#if entry.id === 'write' && editor.changes.length}<span class="count">{editor.changes.length}</span>{/if}
        </button>
      {/each}
    </nav>
    <div class="section-switch" aria-hidden="true">
      <button type="button" tabindex="-1" onclick={() => show(SECTIONS[(index + SECTIONS.length - 1) % SECTIONS.length]!.id)}>&lsaquo;</button>
      <span>{SECTIONS[index]!.label}{#if section === 'write' && editor.changes.length}&nbsp;({editor.changes.length}){/if} <span class="dim">{index + 1}/{SECTIONS.length}</span></span>
      <button type="button" tabindex="-1" onclick={() => show(SECTIONS[(index + 1) % SECTIONS.length]!.id)}>&rsaquo;</button>
    </div>
    <p class="modify-message" class:alert={message?.bad} role="status">{message?.text ?? ''}</p>

    {#key section}
      {#if section === 'record'}
        <RecordSection {editor} {say} />
      {:else if section === 'special'}
        <SpecialSection {editor} {say} />
      {:else if section === 'skills'}
        <SkillsSection {editor} {say} />
      {:else if section === 'traits'}
        <TraitsSection {editor} {say} />
      {:else if section === 'perks'}
        <PerksSection {editor} {say} />
      {:else if section === 'inventory'}
        <InventorySection {editor} {say} />
      {:else}
        <WriteSection {editor} {say} {running} {palette} {facts} write={() => void write()} />
      {/if}
    {/key}
  {/if}
</div>
