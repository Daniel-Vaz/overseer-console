<script lang="ts">
  import { tick } from 'svelte';
  import type { ItemProto } from '../../lib/modify/catalog';
  import { sfx } from '../sfx';
  import { itemArt } from './art';
  import type { Editor } from './editor.svelte';
  import Ledger from './Ledger.svelte';
  import type { LedgerRow } from './section';

  // Everything the game has, to add from: a search, the kinds of things, and
  // the list. Whoever opens it (the player's inventory, a companion's) says
  // what adding does, and shows the card of the item under the cursor.
  let {
    editor,
    onadd,
    note,
    current = $bindable(),
  }: {
    editor: Editor;
    onadd: (item: ItemProto) => void;
    /** What ENTER does to the item under the cursor, said on the line under the screen. */
    note: (item: ItemProto) => string;
    current?: ItemProto;
  } = $props();

  let selected = $state(0);
  let query = $state('');
  let search: HTMLInputElement | undefined = $state();

  type Shelf = 'all' | 'weapon' | 'armor' | 'ammo' | 'drug' | 'other';
  let shelf = $state<Shelf>('all');
  const SHELVES: [Shelf, string][] = [
    ['all', 'ALL'],
    ['weapon', 'WEAPONS'],
    ['armor', 'ARMOR'],
    ['ammo', 'AMMO'],
    ['drug', 'DRUGS'],
    ['other', 'OTHER'],
  ];
  const shelfOf = (item: ItemProto): Shelf => (['weapon', 'armor', 'ammo', 'drug'].includes(item.kind) ? (item.kind as Shelf) : 'other');
  const SHELF_NAMES: Record<Shelf, string> = { all: '', weapon: 'WEAPONS', armor: 'ARMOR', ammo: 'AMMUNITION', drug: 'DRUGS', other: 'OTHER THINGS' };

  const pictures = $derived(editor.session.pictures);

  const offered = $derived(
    [...editor.catalog.items.values()]
      .filter((item) => item.offered)
      .sort((a, b) => SHELVES.findIndex(([id]) => id === shelfOf(a)) - SHELVES.findIndex(([id]) => id === shelfOf(b)) || a.name.localeCompare(b.name)),
  );

  const found = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return offered.filter((item) => (shelf === 'all' || shelfOf(item) === shelf) && words.every((word) => item.name.toLowerCase().includes(word)));
  });

  $effect(() => {
    current = found[Math.min(selected, found.length - 1)];
  });

  /** The figure that tells things of a kind apart, at the end of the line: damage, armour class, a box's rounds, weight. */
  function figure(item: ItemProto): string {
    if (item.weapon) return `${item.weapon.minDamage}-${item.weapon.maxDamage} DMG`;
    if (item.armor) return `AC ${item.armor.armorClass}`;
    if (item.ammo) return `×${item.ammo.quantity}`;
    return `${item.weight} LB`;
  }

  const rows = $derived(
    found.map(
      (item): LedgerRow => ({
        key: `o${item.pid}`,
        group: shelf === 'all' ? SHELF_NAMES[shelfOf(item)] : undefined,
        picture: itemArt(pictures, item),
        label: item.name,
        value: figure(item),
        note: `${note(item)} Type to search, [ ] for a kind, ESC when done.`,
        action: () => onadd(item),
      }),
    ),
  );

  function setShelf(next: Shelf): void {
    shelf = next;
    selected = 0;
    sfx.select();
  }

  function onkey(event: KeyboardEvent): boolean {
    if (event.key === '[' || event.key === ']') {
      const at = SHELVES.findIndex(([id]) => id === shelf);
      setShelf(SHELVES[(at + (event.key === ']' ? 1 : SHELVES.length - 1)) % SHELVES.length]![0]);
      return true;
    }
    // Anything typed is a search.
    if (event.key.length === 1 && event.key !== ' ' && search) {
      search.focus();
      query += event.key;
      selected = 0;
      return true;
    }
    if (event.key === 'Backspace' && search) {
      search.focus();
      query = query.slice(0, -1);
      return true;
    }
    return false;
  }

  function onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      search?.blur();
      if (event.key === 'Enter' && found.length === 1) onadd(found[0]!);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (query) query = '';
      else editor.picking = false;
    }
  }

  void tick().then(() => search?.focus());
</script>

<label class="field picker-search">
  <span>Find</span>
  <input type="text" bind:this={search} bind:value={query} placeholder="type a name" spellcheck="false" autocomplete="off" autocapitalize="off" onkeydown={onSearchKey} oninput={() => (selected = 0)} />
</label>
<div class="shelves" role="tablist" aria-label="Kinds of things">
  {#each SHELVES as [id, label] (id)}
    <button type="button" role="tab" class="chip" class:on={shelf === id} aria-selected={shelf === id} onclick={() => setShelf(id)}>{label}</button>
  {/each}
</div>
<Ledger {rows} bind:selected label="Everything the game has" {onkey} valueWidth={10} empty="NOTHING BY THAT NAME." />
