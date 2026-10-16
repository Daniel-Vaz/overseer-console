<script lang="ts">
  import type { ItemProto } from '../../lib/modify/catalog';
  import type { Editor } from './editor.svelte';
  import { thousands } from './section';

  // What an item is, on its card: weight and worth, and what its kind has to tell.
  let { editor, item }: { editor: Editor; item: ItemProto } = $props();
</script>

<p>
  <span class="pair"><b>Weight</b> {item.weight} lb</span>
  <span class="pair"><b>Value</b> ${thousands(item.cost)}</span>
</p>
{#if item.weapon}
  <p>
    <span class="pair"><b>Damage</b> {item.weapon.minDamage}-{item.weapon.maxDamage}</span>
    <span class="pair"><b>Range</b> {item.weapon.range}</span>
    {#if item.weapon.actionPoints}<span class="pair"><b>AP</b> {item.weapon.actionPoints}</span>{/if}
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
    <span class="pair"><b>DT</b> {item.armor.threshold[0]}</span>
    <span class="pair"><b>DR</b> {item.armor.resistance[0]}%</span>
  </p>
{/if}
