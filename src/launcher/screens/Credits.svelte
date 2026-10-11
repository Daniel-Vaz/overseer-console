<script lang="ts">
  import { onMount } from 'svelte';
  import type { EngineInfo } from '../../lib/engine/types';
  import { GAMES, GAME_IDS, type GameId } from '../../lib/games';
  import { REPO_URL } from '../../lib/project';
  import Menu from '../components/Menu.svelte';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  const base = import.meta.env.BASE_URL;
  let engines = $state<Partial<Record<GameId, EngineInfo>>>({});

  onMount(() => {
    sys.hints = [
      ['PGUP/PGDN', 'SCROLL'],
      ['ESC', 'BACK'],
    ];
    for (const game of GAME_IDS) {
      fetch(`${base}engines/${game}/engine.json`)
        .then((response) => (response.ok ? (response.json() as Promise<EngineInfo>) : null))
        .then((info) => {
          if (info) engines[game] = info;
        })
        .catch(() => undefined);
    }
  });

  const items: MenuItem[] = [{ key: '0', label: 'Back', action: () => go('') }];
</script>

<h1>Credits and legal</h1>

<div class="prose">
  <h2>The engines</h2>
  <p>
    The games run on the Community Edition engines: faithful re-implementations of the original Fallout engine,
    started by <span class="hot">alexbatalov</span> and carried on by their communities. The console is a browser
    front end for their work.
  </p>
  <dl class="readout gap">
    {#each GAME_IDS as game (game)}
      {@const info = engines[game]}
      <dt>{GAMES[game].title}</dt>
      <dd>
        <a href={GAMES[game].engine.project} target="_blank" rel="noopener">{GAMES[game].engine.name}</a>
        {#if info}
          at commit <a href={`${info.source}/commit/${info.commit}`} target="_blank" rel="noopener">{info.commit.slice(0, 7)}</a>,
          built with Emscripten {info.emsdk}.
          <a href={`${base}engines/${game}/LICENSE.txt`} target="_blank" rel="noopener">License</a>,
          <a href={`${base}engines/${game}/THIRD-PARTY.txt`} target="_blank" rel="noopener">third-party notices</a>.
        {/if}
      </dd>
    {/each}
  </dl>
  <p>
    Both engines are published under the Sustainable Use License, which allows free, non-commercial use and
    distribution. This site is free, shows no advertising and earns nothing.
  </p>
  <p class="amber">
    THE ENGINE BUILDS SERVED HERE ARE MODIFIED COPIES.
  </p>
  <p>
    Fallout Community Edition carries four patches: a fix for corrupted movie frames, waiting loops that sleep
    instead of spinning, direct pointer input, and a browser build target. Fallout 2 Community Edition is compiled
    from unchanged source. Both are linked with the console's own glue code, which gives them a pausable clock,
    on-demand file reading and save persistence. The patches and build scripts are in the
    <a href={REPO_URL} target="_blank" rel="noopener">console's repository</a>.
  </p>

  <h2>With thanks to</h2>
  <dl class="readout gap">
    <dt>fallout2-ce</dt>
    <dd>The maintainers and contributors who keep Fallout 2 Community Edition moving.</dd>
    <dt>ololoken</dt>
    <dd>The WebAssembly build target of Fallout 2 Community Edition.</dd>
    <dt>roginvs</dt>
    <dd>The first browser port of the engine, and the notes on browser pitfalls that came with it.</dd>
    <dt>K1ngst0m</dt>
    <dd>First published the movie decoder fix used here.</dd>
    <dt>Also built on</dt>
    <dd>SDL, Emscripten, zlib, fflate, Svelte, and the VT323 typeface by Peter Hull.</dd>
  </dl>

  <h2>The small print</h2>
  <p>
    Overseer Console is an unofficial fan project. It is not affiliated with, endorsed by or connected to Bethesda
    Softworks, ZeniMax Media, Microsoft or Interplay. Fallout is a trademark of Bethesda Softworks LLC; the name is
    used here only to say which games the engines run.
  </p>
  <p>
    No game data is hosted on or distributed by this site. To play you need your own copy of the games, sold on
    GOG, Steam and Epic. The files you load are read by your browser and stay on your device; the site has no
    server component, no accounts and no tracking.
  </p>
  <p>
    The console's own code is at <a href={REPO_URL} target="_blank" rel="noopener">{REPO_URL.replace('https://', '')}</a>.
  </p>
</div>

<Menu {items} label="Credits" />
