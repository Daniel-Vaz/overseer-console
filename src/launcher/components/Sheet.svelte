<script lang="ts">
  import type { GameFacts } from '../../lib/gamefacts';
  import type { GameId } from '../../lib/games';
  import { SKILL_NAMES, SPECIAL_NAMES, traitNames, type Character } from '../../lib/savefile';

  // What a save says about its character. Names come from the player's own
  // game files where they were found, in English otherwise.
  let { character, game, facts }: { character: Character; game: GameId; facts: GameFacts | null } = $props();

  const skills = $derived(facts?.skills.length ? facts.skills : SKILL_NAMES);
  const traits = $derived(facts?.traits.length ? facts.traits : traitNames(game));

  /** "Awareness, Toughness x2", or just how many when the game's names are not at hand. */
  const perks = $derived.by(() => {
    const names = facts?.perks;
    if (!names?.length) return `${character.perks.length}`;
    const ranks = new Map<number, number>();
    for (const perk of character.perks) ranks.set(perk, (ranks.get(perk) ?? 0) + 1);
    return [...ranks].map(([perk, rank]) => `${names[perk] ?? `#${perk}`}${rank > 1 ? ` x${rank}` : ''}`).join(', ');
  });

  const number = (value: number) => value.toLocaleString('en-US');
</script>

<div class="sheet">
  <p>
    {#if character.level !== undefined}
      <b>Level</b> {character.level}{#if character.experience !== undefined}<span class="dim">, {number(character.experience)} XP</span>{/if}
      <span class="sep"></span>
    {/if}
    <b>HP</b> {character.hitPoints}/{character.maxHitPoints}
  </p>
  {#if character.poisoned || character.irradiated}
    <p class="amber">{[character.poisoned && 'POISONED', character.irradiated && 'IRRADIATED'].filter(Boolean).join(', ')}</p>
  {/if}
  <table aria-label="Primary statistics">
    <thead>
      <tr>
        {#each SPECIAL_NAMES as name (name)}<th scope="col">{name}</th>{/each}
      </tr>
    </thead>
    <tbody>
      <tr>
        {#each character.special as value, stat (stat)}<td>{value}</td>{/each}
      </tr>
    </tbody>
  </table>
  {#if character.tagged.length}
    <p><b>Tagged</b> {character.tagged.map((skill) => skills[skill] ?? `#${skill}`).join(', ')}</p>
  {/if}
  {#if character.traits?.length}
    <p><b>Traits</b> {character.traits.map((trait) => traits[trait] ?? `#${trait}`).join(', ')}</p>
  {/if}
  {#if character.perks.length}
    <p><b>Perks</b> {perks}</p>
  {/if}
  <p>
    <b>{game === 'fo1' ? 'Reputation' : 'Karma'}</b> {number(character.karma)}
    <span class="sep"></span>
    <b>Kills</b> {number(character.kills)}
    <span class="sep"></span>
    <b>{game === 'fo1' ? 'Caps' : 'Money'}</b> {number(character.money)}
  </p>
</div>
