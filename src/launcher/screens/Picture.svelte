<script lang="ts">
  import { onMount } from 'svelte';
  import { gameDef } from '../../lib/games';
  import { PICTURES, picturesFor } from '../../lib/settings';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { PICTURE_NAMES, PICTURE_NOTES, step } from '../picture';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  // The picture of every game, side by side. Each deck has the same choice for its own.
  let { go }: { go: (path: string) => void } = $props();

  let selected = $state(0);

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'CHANGE'],
      ['<- ->', 'EITHER WAY'],
      ['ESC', 'BACK'],
    ];
  });

  // The two games, and the mods that are loaded: one that is not has no picture to speak of.
  const games = $derived(sys.games.filter((game) => !gameDef(game).mod || sys.installs[game]));

  const items = $derived<MenuItem[]>([
    ...games.map((game, index): MenuItem => {
      const def = gameDef(game);
      const picture = sys.picture(game);
      const choices = picturesFor(game);
      const move = (direction: 1 | -1 = 1) => sys.setPicture(game, step(choices, picture, direction));
      return {
        key: '123456789abcdefghijklmnopqrstuvwxyz'[index] ?? `p${index}`,
        // Headed games and mods, where there are mods.
        group: games.length > 2 ? (def.mod ? 'Mods' : 'Games') : undefined,
        label: def.mod ? def.title : `Deck ${def.deck}: ${def.title}`,
        state: PICTURE_NAMES[picture],
        note: choices.length < PICTURES.length ? `${PICTURE_NOTES[picture]} ${def.title} needs a picture at least ${def.mod?.minHeight} lines tall.` : PICTURE_NOTES[picture],
        icon: 'picture',
        action: () => move(),
        adjust: move,
      };
    }),
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings') },
  ]);
</script>

<h1>Picture</h1>
<p class="sub">Every game is played at a picture of its own.</p>

<div class="columns">
  <div>
    <Menu {items} label="Picture of each game" bind:selected />
    <dl class="readout gap">
      {#each PICTURES as picture (picture)}
        <dt>{PICTURE_NAMES[picture]}</dt>
        <dd>{PICTURE_NOTES[picture]}</dd>
      {/each}
    </dl>
  </div>
  <aside class="board gap" aria-label="Picture">
    <Glyph name={items[selected]?.icon ?? 'picture'} />
    <p class="dim">A change takes hold the next time the game is started. The same choice is on each game's deck.</p>
  </aside>
</div>
