<script lang="ts">
  import { onMount } from 'svelte';
  import type { EngineInfo } from '../../lib/engine/types';
  import { BASE_GAMES, gameDef, type EngineId } from '../../lib/games';
  import { KNOWN_MODS, KNOWN_MOD_IDS } from '../../lib/mods/catalog';
  import { REPO_URL } from '../../lib/project';
  import Menu from '../components/Menu.svelte';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  const base = import.meta.env.BASE_URL;
  let engines = $state<Partial<Record<EngineId, EngineInfo>>>({});
  // One build per engine; a mod plays on the build of the game it was made for.
  const ENGINE_GAMES = BASE_GAMES;

  onMount(() => {
    sys.hints = [
      ['PGUP/PGDN', 'SCROLL'],
      ['ESC', 'BACK'],
    ];
    for (const game of ENGINE_GAMES) {
      const engine = gameDef(game).engine.id;
      fetch(`${base}engines/${engine}/engine.json`)
        .then((response) => (response.ok ? (response.json() as Promise<EngineInfo>) : null))
        .then((info) => {
          if (info) engines[engine] = info;
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
    {#each ENGINE_GAMES as game (game)}
      {@const def = gameDef(game)}
      {@const info = engines[def.engine.id]}
      <dt>{def.title}</dt>
      <dd>
        <a href={def.engine.project} target="_blank" rel="noopener">{def.engine.name}</a>
        {#if info}
          at commit <a href={`${info.source}/commit/${info.commit}`} target="_blank" rel="noopener">{info.commit.slice(0, 7)}</a>,
          built with Emscripten {info.emsdk}.
          <a href={`${base}engines/${def.engine.id}/LICENSE.txt`} target="_blank" rel="noopener">License</a>,
          <a href={`${base}engines/${def.engine.id}/THIRD-PARTY.txt`} target="_blank" rel="noopener">third-party notices</a>.
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
    Fallout Community Edition carries patches for corrupted movie frames, waiting loops that sleep instead of
    spinning, direct pointer input, a browser build target, skipping the opening movies, starting straight into a
    save, and reading a mod's loose text files as Windows does. Both engines carry patches for autosaves, for quick saves that always use slot 07 and for telling the page
    when it is the player's turn in a fight; Fallout 2's also lets the page hold a key down for its scripts, for the
    touch screen's switch that lights things up. Both are linked with the console's own glue code, which gives them a pausable clock, on-demand file reading and save persistence. The
    patches and build scripts are in the
    <a href={REPO_URL} target="_blank" rel="noopener">console's repository</a>.
  </p>

  <h2>The mods</h2>
  <p>
    The mods the console knows by name are the work of their makers, and of the many more their own credits name. They
    are theirs, they are free, and none of them is hosted here: you download them from their makers, and the console
    puts them together in this browser with your own copies of the games. Each plays on the engine build of the game
    it was made for.
  </p>
  <dl class="readout gap">
    {#each KNOWN_MOD_IDS as id (id)}
      {@const mod = KNOWN_MODS[id]}
      <dt><a href={mod.project} target="_blank" rel="noopener">{mod.title}</a></dt>
      <dd>{mod.authors}</dd>
    {/each}
  </dl>

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
