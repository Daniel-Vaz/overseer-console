<script lang="ts">
  import { onMount } from 'svelte';
  import { GAMES, GAME_IDS } from '../../lib/games';
  import { PICTURES } from '../../lib/settings';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { PICTURE_NAMES, PICTURE_NOTES, nextPicture } from '../picture';
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

  const items = $derived<MenuItem[]>([
    ...GAME_IDS.map((game, index): MenuItem => {
      const picture = sys.settings.picture[game];
      const move = (direction: 1 | -1 = 1) => sys.setPicture(game, nextPicture(picture, direction));
      return {
        key: String(index + 1),
        label: `Deck ${GAMES[game].deck}: ${GAMES[game].title}`,
        state: PICTURE_NAMES[picture],
        note: PICTURE_NOTES[picture],
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
