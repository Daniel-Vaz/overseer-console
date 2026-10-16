<script lang="ts">
  import { untrack } from 'svelte';
  import type { ItemProto } from '../../lib/modify/catalog';
  import { MAX_QUANTITY, equipped } from '../../lib/modify/record';
  import { STAT } from '../../lib/modify/rules';
  import { MONEY_PID } from '../../lib/savefile';
  import { cardArt, itemArt } from './art';
  import Card from './Card.svelte';
  import ItemFacts from './ItemFacts.svelte';
  import ItemPicker from './ItemPicker.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper, thousands } from './section';

  /** The character screen's card for carry weight. */
  const CARRY_CARD = 20;

  let { editor, say }: SectionProps = $props();
  // Where the cursor was when the section was last open.
  let selected = $state(untrack(() => editor.cursor.inventory ?? 0));
  $effect(() => {
    editor.cursor.inventory = selected;
  });
  let picked = $state<ItemProto | undefined>();

  const pictures = $derived(editor.session.pictures);
  const record = $derived(editor.record);
  const carry = $derived(editor.stat(STAT.carryWeight));
  const money = $derived(record.items.filter((item) => item.pid === MONEY_PID).reduce((sum, item) => sum + item.quantity, 0));
  const moneyName = $derived(editor.proto(MONEY_PID)?.name || (editor.worldOf === 'fo1' ? 'Caps' : 'Money'));

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
    editor.pickingFor = 0;
    editor.picking = true;
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

  function add(item: ItemProto): void {
    const key = editor.addItem(item.pid);
    const total = record.items.find((entry) => entry.key === key)?.quantity ?? 1;
    say(`Added ${item.name}${total > 1 ? `: ${thousands(total)} carried` : ''}.`);
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

  const picking = $derived(editor.picking && editor.pickingFor === 0);
  const current = $derived(picking ? picked : editor.proto((rows[selected] as { pid?: number } | undefined)?.pid ?? -1));
  const currentEntry = $derived(picking ? undefined : record.items.find((item) => item.key === rows[selected]?.key));
</script>

<div class="modify-main">
  <div class="modify-list">
    {#if picking}
      <ItemPicker
        {editor}
        onadd={add}
        bind:current={picked}
        note={(item) => `ENTER to add ${item.kind === 'ammo' ? 'a box' : 'one'}${record.items.some((entry) => entry.pid === item.pid) ? ' more' : ''}.`}
      />
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
      <ItemFacts {editor} item={current} />
      {#if picking}
        <p><button type="button" class="card-button" onclick={() => add(current)}>[ENTER] Add {current.kind === 'ammo' ? 'a box' : 'one'}</button></p>
      {:else if currentEntry && !equipped(currentEntry)}
        <p><button type="button" class="card-button" onclick={() => takeOut(currentEntry.key)}>[D] Take it out</button></p>
      {/if}
    </Card>
  {:else if picking}
    <Card picture={null} kind="item" title="Nothing found" description="Nothing the game has goes by that name." />
  {:else}
    <Card picture={cardArt(pictures, CARRY_CARD)} title="Inventory" description="What the character carries. A to add anything the game has; what is in hand or worn stays as it is." />
  {/if}
</div>
