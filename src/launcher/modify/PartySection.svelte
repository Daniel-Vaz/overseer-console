<script lang="ts">
  import { untrack } from 'svelte';
  import type { ItemProto } from '../../lib/modify/catalog';
  import { MAX_QUANTITY, equipped, type Carried } from '../../lib/modify/record';
  import Glyph from '../components/Glyph.svelte';
  import { cardArt, itemArt } from './art';
  import Card from './Card.svelte';
  import ItemFacts from './ItemFacts.svelte';
  import ItemPicker from './ItemPicker.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper, thousands } from './section';

  // Who travels with the player: their hit points, poison and radiation, and
  // what each carries, as the map they travel in keeps them.
  let { editor, say }: SectionProps = $props();
  let selected = $state(untrack(() => editor.cursor.party ?? 0));
  $effect(() => {
    editor.cursor.party = selected;
  });
  let picked = $state<ItemProto | undefined>();

  /** The character screen's cards for hit points, poison and radiation. */
  const CARD = { hitPoints: 10, poison: 11, radiation: 12, carry: 20 } as const;

  const pictures = $derived(editor.session.pictures);
  const members = $derived(editor.members);

  interface Line extends LedgerRow {
    member: number;
    pid?: number;
    card?: number;
  }

  const nameOf = (pid: number) => editor.proto(pid)?.name || `Item ${pid}`;

  function openPicker(member: number): void {
    editor.pickingFor = member;
    editor.picking = true;
  }

  function takeOut(member: number, item: Carried): void {
    if (equipped(item)) {
      say(`${nameOf(item.pid)} is in hand or worn: the game must take it off first.`, true);
      return;
    }
    editor.removeFromCompanion(member, item.key);
    say(`Took out ${nameOf(item.pid)}.`);
  }

  function heal(member: number, name: string): void {
    editor.healCompanion(member);
    say(`Healed ${name}: full hit points, no poison, no radiation.`);
  }

  const rows = $derived.by((): Line[] => {
    const lines: Line[] = [];
    for (const member of members) {
      const now = editor.companion(member.id);
      const then = editor.original.record.party.find((entry) => entry.id === member.id);
      if (!now || !then) continue;
      const group = member.name.toUpperCase();
      lines.push({
        key: `hp${member.id}`,
        member: member.id,
        group,
        label: 'Hit points',
        value: `${now.hitPoints} / ${member.maxHitPoints}`,
        tone: now.hitPoints !== then.hitPoints ? 'hot' : now.hitPoints < member.maxHitPoints / 2 ? 'amber' : undefined,
        note: 'H to heal fully. ←→ to change, ENTER to type.',
        card: CARD.hitPoints,
        ...stepper({ current: now.hitPoints, set: (value) => editor.setCompanion(member.id, 'hitPoints', value), min: 1, max: member.maxHitPoints, digits: 4 }),
      });
      lines.push({
        key: `poison${member.id}`,
        member: member.id,
        group,
        label: 'Poison',
        value: String(now.poison),
        tone: now.poison !== then.poison ? 'hot' : now.poison ? 'amber' : 'dim',
        note: 'How poisoned: 0 is not at all. ←→ to change, ENTER to type.',
        card: CARD.poison,
        ...stepper({ current: now.poison, set: (value) => editor.setCompanion(member.id, 'poison', value), min: 0, max: 2000, digits: 4 }),
      });
      lines.push({
        key: `rad${member.id}`,
        member: member.id,
        group,
        label: 'Radiation',
        value: String(now.radiation),
        tone: now.radiation !== then.radiation ? 'hot' : now.radiation ? 'amber' : 'dim',
        note: 'Rads absorbed: 0 is none. ←→ to change, ENTER to type.',
        card: CARD.radiation,
        ...stepper({ current: now.radiation, set: (value) => editor.setCompanion(member.id, 'radiation', value), min: 0, max: 2000, digits: 4 }),
      });
      lines.push({
        key: `add${member.id}`,
        member: member.id,
        group,
        label: 'Add an item',
        mark: '+',
        value: 'A',
        tone: 'dim',
        note: `Look through everything the game has, and give it to ${member.name}.`,
        card: CARD.carry,
        action: () => openPicker(member.id),
      });
      for (const item of now.items) {
        const locked = equipped(item);
        const was = then.items.find((entry) => entry.key === item.key);
        lines.push({
          key: `${member.id}:${item.key}`,
          member: member.id,
          pid: item.pid,
          group,
          picture: itemArt(pictures, editor.proto(item.pid) ?? { inventoryFid: -1, fid: -1 }),
          label: nameOf(item.pid),
          value: locked ? (item.original!.flags & 0x04000000 ? 'WORN' : 'IN HAND') : `×${thousands(item.quantity)}`,
          tone: !was || was.quantity !== item.quantity ? 'hot' : locked ? 'dim' : undefined,
          locked,
          note: locked ? 'In hand or worn: the editor leaves it as it is.' : '←→ to change how many (SHIFT: by 10), ENTER to type, D to take it out.',
          ...stepper({ current: item.quantity, set: (value) => editor.setCompanionQuantity(member.id, item.key, value), min: 1, max: MAX_QUANTITY, digits: 6 }),
        });
      }
    }
    return lines;
  });

  const row = $derived(rows[selected]);
  const member = $derived(members.find((entry) => entry.id === (editor.picking ? editor.pickingFor : row?.member)));
  const picking = $derived(editor.picking && editor.pickingFor !== 0);
  const item = $derived(picking ? picked : row?.pid !== undefined ? editor.proto(row.pid) : undefined);

  function add(proto: ItemProto): void {
    if (!member) return;
    editor.addToCompanion(member.id, proto.pid);
    say(`Gave ${member.name} ${proto.kind === 'ammo' ? 'a box of ' : ''}${proto.name}.`);
  }

  function onkey(event: KeyboardEvent, line: LedgerRow | undefined): boolean {
    const at = rows.find((entry) => entry.key === line?.key);
    if (!at) return false;
    const key = event.key.toLowerCase();
    const owner = members.find((entry) => entry.id === at.member);
    if (key === 'a' && owner) {
      openPicker(owner.id);
      return true;
    }
    if (key === 'h' && owner) {
      heal(owner.id, owner.name);
      return true;
    }
    if ((key === 'd' || event.key === 'Delete') && at.pid !== undefined) {
      const carried = editor.companion(at.member)?.items.find((entry) => `${at.member}:${entry.key}` === at.key);
      if (carried) takeOut(at.member, carried);
      return true;
    }
    return false;
  }
</script>

<div class="modify-main">
  <div class="modify-list">
    {#if !members.length}
      <div class="signed gap">
        <Glyph name={editor.session.partyProblem ? 'warning' : 'ok'} tone={editor.session.partyProblem ? 'amber' : undefined} />
        <div>
          {#if editor.session.partyProblem}
            <p class="amber">THE PARTY CANNOT BE CHANGED IN THIS SAVE.</p>
            <p class="dim">The editor could not read it: {editor.session.partyProblem}.</p>
          {:else}
            <p>{(editor.record.name || 'The character').toUpperCase()} TRAVELS ALONE.</p>
            <p class="dim">Companions recruited in the game are listed here, with their hit points and what they carry.</p>
          {/if}
        </div>
      </div>
    {:else if picking && member}
      <p class="modify-status"><span class="pair"><b>Giving to</b> {member.name}</span></p>
      <ItemPicker {editor} onadd={add} bind:current={picked} note={(proto) => `ENTER to give ${member.name} ${proto.kind === 'ammo' ? 'a box' : 'one'}.`} />
    {:else}
      {#if member}
        <p class="modify-status">
          <span class="pair"><b>Party</b> {members.length}</span>
          <span class="pair"><b>{member.name} carries</b> {thousands(editor.companionCarried(member.id))} lb</span>
        </p>
      {/if}
      <Ledger {rows} bind:selected label="The party" {onkey} valueWidth={10} />
    {/if}
  </div>
  {#if item}
    <Card picture={itemArt(pictures, item)} kind="item" title={item.name} description={item.description}>
      <ItemFacts {editor} {item} />
      {#if picking}
        <p><button type="button" class="card-button" onclick={() => add(item)}>[ENTER] Give {item.kind === 'ammo' ? 'a box' : 'one'}</button></p>
      {/if}
    </Card>
  {:else if member}
    {@const now = editor.companion(member.id)}
    <Card picture={cardArt(pictures, row?.card ?? CARD.hitPoints)} title={member.name} description="Travels with the character. The game keeps the party in the map they are on, and the editor changes them there.">
      {#if now}
        <p><span class="pair"><b>Hit points</b> {now.hitPoints} / {member.maxHitPoints}</span></p>
        <p><span class="pair"><b>Poison</b> {now.poison}</span><span class="pair"><b>Rads</b> {now.radiation}</span></p>
        <p><button type="button" class="card-button" onclick={() => heal(member.id, member.name)}>[H] Heal {member.name}</button></p>
      {/if}
    </Card>
  {:else}
    <Card picture={cardArt(pictures, CARD.hitPoints)} title="The party" description="Who travels with the character, as the save keeps them." />
  {/if}
</div>
