<script lang="ts">
  import { onMount } from 'svelte';
  import { isGameId, type GameId } from '../lib/games';
  import { sourcesFromDrop } from '../lib/storage/importer';
  import { isTyping } from './keys';
  import Boot from './screens/Boot.svelte';
  import Credits from './screens/Credits.svelte';
  import Dropbox from './screens/Dropbox.svelte';
  import Game from './screens/Game.svelte';
  import Main from './screens/Main.svelte';
  import Manual from './screens/Manual.svelte';
  import Saves from './screens/Saves.svelte';
  import Settings from './screens/Settings.svelte';
  import { sfx } from './sfx';
  import { consoleState as sys } from './state.svelte';

  const BOOTED_KEY = 'overseer-console:booted';

  function readRoute(): string[] {
    return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  }

  let route = $state(readRoute());
  // The power-on sequence plays once per browser session.
  let booted = $state(sessionStorage.getItem(BOOTED_KEY) === '1');
  let dragging = $state(0);
  let clock = $state('');
  let body: HTMLElement | undefined = $state();

  const section = $derived(route[0] ?? '');
  const game = $derived<GameId | null>(isGameId(route[0]) ? route[0] : isGameId(route[1]) ? route[1] : null);

  const title = $derived(
    !booted
      ? 'POWER-ON SELF TEST'
      : section === ''
        ? 'MAIN DIRECTORY'
        : section === 'saves'
          ? 'SAVE ARCHIVES'
          : section === 'settings'
            ? route[1] === 'dropbox'
              ? 'DROPBOX LINK'
              : 'TERMINAL SETTINGS'
            : section === 'manual'
              ? 'OPERATIONS MANUAL'
              : section === 'credits'
                ? 'CREDITS AND LEGAL'
                : game
                  ? `HOLODISK DECK ${game === 'fo1' ? 'A' : 'B'}`
                  : 'UNKNOWN',
  );

  function go(path: string): void {
    location.hash = path ? `#/${path}` : '#/';
    // The hashchange event arrives a moment later. Switch screens now, so a
    // key typed right after this one already belongs to the new screen.
    route = readRoute();
    body?.scrollTo(0, 0);
  }

  function back(): void {
    if (!route.length) return;
    sfx.back();
    go(route.slice(0, -1).join('/'));
  }

  function finishBoot(): void {
    booted = true;
    sessionStorage.setItem(BOOTED_KEY, '1');
  }

  function tick(): void {
    clock = new Date().toLocaleTimeString([], { hour12: false });
  }

  onMount(() => {
    void sys.refresh();
    tick();
    const timer = setInterval(tick, 1000);
    const onHash = () => {
      route = readRoute();
      // A new screen starts at its top.
      body?.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    // Coming back from a game: saves and timestamps may have changed.
    const onShow = () => void sys.refresh();
    window.addEventListener('pageshow', onShow);
    return () => {
      clearInterval(timer);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('pageshow', onShow);
    };
  });

  function onKeydown(event: KeyboardEvent): void {
    if (!booted || event.defaultPrevented || isTyping(event)) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      if (route.length) {
        event.preventDefault();
        back();
      }
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      body?.scrollBy({ top: (event.key === 'PageDown' ? 0.8 : -0.8) * body.clientHeight });
      event.preventDefault();
    }
  }

  // Dropping a game folder anywhere on the console imports it.
  function hasFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  }

  function onDragEnter(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragging++;
  }

  function onDragLeave(event: DragEvent): void {
    if (!hasFiles(event)) return;
    dragging = Math.max(0, dragging - 1);
  }

  function onDragOver(event: DragEvent): void {
    if (hasFiles(event)) event.preventDefault();
  }

  async function onDrop(event: DragEvent): Promise<void> {
    if (!hasFiles(event) || !event.dataTransfer) return;
    event.preventDefault();
    dragging = 0;
    if (!booted) finishBoot();
    if (sys.busy || !sys.supported) {
      sfx.deny();
      return;
    }
    const sources = await sourcesFromDrop(event.dataTransfer);
    const imported = await sys.importFrom(sources, game ?? undefined);
    // Show the result on the screen of the game that was found.
    go(imported ?? sys.job.game ?? game ?? 'fo2');
  }

  function toggle(key: 'crt' | 'sound'): void {
    sys.update({ [key]: !sys.settings[key] });
    sfx.switch();
  }
</script>

<svelte:window
  onkeydown={onKeydown}
  ondragenter={onDragEnter}
  ondragleave={onDragLeave}
  ondragover={onDragOver}
  ondrop={onDrop}
/>

<div class="room">
  <div class="housing warm-up" class:crt-on={sys.settings.crt} class:crt-off={!sys.settings.crt}>
    <span class="stamp" aria-hidden="true">OVERSEER'S OFFICE &#9670; AUTHORIZED PERSONNEL ONLY</span>
    <div class="tube-well">
      <div class="tube">
        <div class="refresh"></div>
        <div class="screen">
          <header class="bar">
            <span>OVERSEER CONSOLE // {title}</span>
            <span>{clock}</span>
          </header>

          <main class="body" bind:this={body} tabindex="-1">
            {#if !booted}
              <Boot ondone={finishBoot} />
            {:else if section === ''}
              <Main {go} />
            {:else if section === 'saves'}
              <Saves {go} {game} />
            {:else if section === 'settings' && route[1] === 'dropbox'}
              <Dropbox {go} />
            {:else if section === 'settings'}
              <Settings {go} />
            {:else if section === 'manual'}
              <Manual {go} />
            {:else if section === 'credits'}
              <Credits {go} />
            {:else if game}
              {#key game}
                <Game {go} {game} />
              {/key}
            {:else}
              <h1>Unknown directory</h1>
              <p class="gap"><a href="#/">Return to the main directory</a></p>
            {/if}
          </main>

          <footer class="hints">
            {#each sys.hints as [key, label] (key)}
              <span><b>{key}</b> {label}</span>
            {/each}
          </footer>
        </div>

        {#if dragging > 0}
          <div class="dropzone">Release to load holodisk</div>
        {/if}
      </div>
    </div>

    <div class="controls">
      <span class="nameplate">OVERSEER CONSOLE</span>
      <span class="lamp on" title="Power">PWR</span>
      <span class="lamp amber optional" class:on={sys.busy} class:busy={sys.busy} title="Disk activity">DISK</span>
      <span class="hazard"></span>
      <button class="switch" type="button" aria-pressed={sys.settings.crt} onclick={() => toggle('crt')}>
        CRT<span class="sr-only"> effects</span>
      </button>
      <button class="switch" type="button" aria-pressed={sys.settings.sound} onclick={() => toggle('sound')}>
        SND<span class="sr-only"> effects</span>
      </button>
    </div>
  </div>
</div>
