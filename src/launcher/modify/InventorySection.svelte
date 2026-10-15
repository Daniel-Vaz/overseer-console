<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { ItemProto } from '../../lib/modify/catalog';
  import { MAX_QUANTITY, equipped } from '../../lib/modify/record';
  import { MONEY_PID } from '../../lib/savefile';
  import { sfx } from '../sfx';
  import { cardArt, itemArt } from './art';

  /** The character screen's card for carry weight. */
  const CARRY_CARD = 20;
  import Card from './Card.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper, thousands } from './section';
  import { STAT } from '../../lib/modify/rules';

  let { editor, say }: SectionProps = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.inventory ?? 0));
  $effect(() => {
    editor.cursor.inventory = selected;
  });
  let pickSelected = $state(0);
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
  const record = $derived(editor.record);
  const carry = $derived(editor.stat(STAT.carryWeight));
  const money = $derived(record.items.filter((item) => item.pid === MONEY_PID).reduce((sum, item) => sum + item.quantity, 0));
  const moneyName = $derived(editor.proto(MONEY_PID)?.name || (editor.world === 'fo1' ? 'Caps' : 'Money'));

  const nameOf = (pid: number) => editor.proto(pid)?.name || `Item ${pid}`;

  /** "Bag, 3 things inside" and the like. */
  function describe(item: (typeof record.items)[number]): string {
    const inside = item.original?.contents.length ?? 0;
    return inside ? `${nameOf(item.pid)} (${inside} inside)` : nameOf(item.pid);
  }

  function wearing(flags: number): string {
    if (flags & 0x04000000) return 'WORN';
    return 'IN HAND';
  }

  function openPicker(): void {
    editor.picking = true;
    pickSelected = 0;
    void tick().then(() => search?.focus());
  }

  function takeOut(key: string): void {
    const item = record.items.find((entry) => entry.key === key);
    if (!item) return;
    if (equipped(item)) {
      say(`${nameOf(item.pid)} is ${wearing(item.original!.flags) === 'WORN' ? 'worn' : 'in hand'}: take it off in the game first.`, true);
      return;
    }
    editor.removeItem(key);
    say(`Took out ${nameOf(item.pid)}.`);
  }

  const rows = $derived.by((): (LedgerRow & { pid?: number })[] => [
    {
      key: 'add',
      label: 'Add an item',
      mark: '+',
      value: 'A',
      tone: 'dim',
      note: 'Look through everything the game has, and add to what is carried.',
      action: openPicker,
    },
    ...record.items.map((item): LedgerRow & { pid: number } => {
      const locked = equipped(item);
      const was = editor.original.record.items.find((entry) => entry.key === item.key);
      return {
        key: item.key,
        pid: item.pid,
        group: 'CARRIED',
        picture: itemArt(pictures, editor.proto(item.pid) ?? { inventoryFid: -1, fid: -1 }),
        label: describe(item),
        value: locked ? wearing(item.original!.flags) : `×${thousands(item.quantity)}`,
        tone: !was || was.quantity !== item.quantity ? 'hot' : locked ? 'dim' : undefined,
        locked,
        note: locked
          ? 'In hand or worn: the editor leaves it as it is. Take it off in the game to change it.'
          : `←→ to change how many (SHIFT: by 10), ENTER to type, D to take it out.${editor.proto(item.pid)?.kind === 'ammo' ? ' Ammunition counts in boxes.' : ''}`,
        ...stepper({ current: item.quantity, set: (value) => editor.setQuantity(item.key, value), min: 1, max: MAX_QUANTITY, digits: 6 }),
      };
    }),
  ]);

  // ---------------------------------------------------------------------
  // The picker
  // ---------------------------------------------------------------------

  const offered = $derived(
    [...editor.catalog.items.values()]
      .filter((item) => item.offered)
      .sort((a, b) => SHELVES.findIndex(([id]) => id === shelfOf(a)) - SHELVES.findIndex(([id]) => id === shelfOf(b)) || a.name.localeCompare(b.name)),
  );

  const found = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return offered.filter((item) => (shelf === 'all' || shelfOf(item) === shelf) && words.every((word) => item.name.toLowerCase().includes(word)));
  });

  function add(item: ItemProto): void {
    const key = editor.addItem(item.pid);
    const total = record.items.find((entry) => entry.key === key)?.quantity ?? 1;
    say(`Added ${item.name}${total > 1 ? `: ${thousands(total)} carried` : ''}.`);
  }

  const pickRows = $derived(
    found.map(
      (item): LedgerRow => ({
        key: `o${item.pid}`,
        group: shelf === 'all' ? SHELF_NAMES[shelfOf(item)] : undefined,
        picture: itemArt(pictures, item),
        label: item.name,
        value: `${item.weight} LB`,
        note: `ENTER to add ${item.kind === 'ammo' ? 'a box' : 'one'}${record.items.some((entry) => entry.pid === item.pid) ? ' more' : ''}. Type to search, ESC when done.`,
        action: () => add(item),
      }),
    ),
  );

  function setShelf(next: Shelf): void {
    shelf = next;
    pickSelected = 0;
    sfx.select();
  }

  function onPickKey(event: KeyboardEvent): boolean {
    if (event.key === '[' || event.key === ']') {
      const at = SHELVES.findIndex(([id]) => id === shelf);
      setShelf(SHELVES[(at + (event.key === ']' ? 1 : SHELVES.length - 1)) % SHELVES.length]![0]);
      return true;
    }
    // Anything typed is a search.
    if (event.key.length === 1 && event.key !== ' ' && search) {
      search.focus();
      query += event.key;
      pickSelected = 0;
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
      if (event.key === 'Enter' && found.length === 1) add(found[0]!);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (query) query = '';
      else editor.picking = false;
    }
  }

  function onkey(event: KeyboardEvent, row: LedgerRow | undefined): boolean {
    const key = event.key.toLowerCase();
    if (key === 'a') {
      openPicker();
      return true;
    }
    if ((key === 'd' || event.key === 'Delete') && row && row.key !== 'add') {
      takeOut(row.key);
      return true;
    }
    return false;
  }

  const current = $derived(editor.picking ? found[Math.min(pickSelected, found.length - 1)] : editor.proto((rows[selected] as { pid?: number } | undefined)?.pid ?? -1));
  const currentEntry = $derived(editor.picking ? undefined : record.items.find((item) => item.key === rows[selected]?.key));
</script>

{#snippet facts(item: ItemProto)}
  <p>
    <span class="pair"><b>Weight</b> {item.weight} lb</span>
    <span class="pair"><b>Value</b> ${thousands(item.cost)}</span>
  </p>
  {#if item.weapon}
    <p>
      <span class="pair"><b>Damage</b> {item.weapon.minDamage}-{item.weapon.maxDamage}</span>
      <span class="pair"><b>Range</b> {item.weapon.range}</span>
      {#if item.weapon.minStrength}<span class="pair"><b>Min ST</b> {item.weapon.minStrength}</span>{/if}
    </p>
    {#if item.weapon.capacity && editor.proto(item.weapon.ammoPid)}
      <p><span class="pair"><b>Takes</b> {editor.proto(item.weapon.ammoPid)!.name}, {item.weapon.capacity} a load</span></p>
    {/if}
  {:else if item.ammo}
    <p><span class="pair"><b>A box holds</b> {item.ammo.quantity}</span></p>
  {:else if item.armor}
    <p>
      <span class="pair"><b>Armor class</b> {item.armor.armorClass}</span>
      <span class="pair"><b>Damage res.</b> {item.armor.resistance[0]}%</span>
    </p>
  {/if}
{/snippet}

<div class="modify-main">
  <div class="modify-list">
    {#if editor.picking}
      <label class="field picker-search">
        <span>Find</span>
        <input type="text" bind:this={search} bind:value={query} placeholder="type a name" spellcheck="false" autocomplete="off" autocapitalize="off" onkeydown={onSearchKey} oninput={() => (pickSelected = 0)} />
      </label>
      <div class="shelves" role="tablist" aria-label="Kinds of things">
        {#each SHELVES as [id, label] (id)}
          <button type="button" role="tab" class="chip" class:on={shelf === id} aria-selected={shelf === id} onclick={() => setShelf(id)}>{label}</button>
        {/each}
      </div>
      <Ledger rows={pickRows} bind:selected={pickSelected} label="Everything the game has" onkey={onPickKey} valueWidth={6} empty="NOTHING BY THAT NAME." />
    {:else}
      <p class="modify-status">
        <span class="pair" class:amber={editor.carried > carry}><b>Carried</b> {thousands(editor.carried)} / {thousands(carry)} lb</span>
        <span class="pair"><b>{moneyName}</b> {thousands(money)}</span>
      </p>
      <Ledger {rows} bind:selected label="What the character carries" {onkey} valueWidth={9} />
    {/if}
  </div>
  {#if current}
    <Card picture={itemArt(pictures, current)} kind="item" title={current.name} description={current.description}>
      {@render facts(current)}
      {#if editor.picking}
        <p><button type="button" class="card-button" onclick={() => add(current)}>[ENTER] Add {current.kind === 'ammo' ? 'a box' : 'one'}</button></p>
      {:else if currentEntry && !equipped(currentEntry)}
        <p><button type="button" class="card-button" onclick={() => takeOut(currentEntry.key)}>[D] Take it out</button></p>
      {/if}
    </Card>
  {:else if editor.picking}
    <Card picture={null} kind="item" title="Nothing found" description="Nothing the game has goes by that name." />
  {:else}
    <Card picture={cardArt(pictures, CARRY_CARD)} title="Inventory" description="What the character carries. A to add anything the game has; what is in hand or worn stays as it is." />
  {/if}
</div>
