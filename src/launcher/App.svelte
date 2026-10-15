<script lang="ts">
  import { onMount, tick as settled } from 'svelte';
  import { GAMES, isGameId, type GameId } from '../lib/games';
  import { sourcesFromDrop } from '../lib/storage/importer';
  import Glyph from './components/Glyph.svelte';
  import Pest from './components/Pest.svelte';
  import Vault from './components/Vault.svelte';
  import { isTyping } from './keys';
  import Boot from './screens/Boot.svelte';
  import Credits from './screens/Credits.svelte';
  import Dropbox from './screens/Dropbox.svelte';
  import Game from './screens/Game.svelte';
  import Main from './screens/Main.svelte';
  import Manual from './screens/Manual.svelte';
  import Modify from './screens/Modify.svelte';
  import Picture from './screens/Picture.svelte';
  import Saves from './screens/Saves.svelte';
  import Settings from './screens/Settings.svelte';
  import { sfx } from './sfx';
  import { consoleState as sys } from './state.svelte';
  import { REMARKS } from './vault/remarks';

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
  let housing: HTMLElement | undefined = $state();
  /** There is more of the screen below what shows. */
  let more = $state(false);

  const section = $derived(route[0] ?? '');
  const game = $derived<GameId | null>(isGameId(route[0]) ? route[0] : isGameId(route[1]) ? route[1] : null);

  const title = $derived(
    !booted
      ? 'POWER-ON SELF TEST'
      : section === ''
        ? 'MAIN DIRECTORY'
        : section === 'saves'
          ? route[2] === 'modify'
            ? 'SAVE ARCHIVES // MODIFY'
            : 'SAVE ARCHIVES'
          : section === 'settings'
            ? route[1] === 'dropbox'
              ? 'DROPBOX LINK'
              : route[1] === 'picture'
                ? 'PICTURE'
                : 'TERMINAL SETTINGS'
            : section === 'manual'
              ? 'OPERATIONS MANUAL'
              : section === 'credits'
                ? 'CREDITS AND LEGAL'
                : game
                  ? `HOLODISK DECK ${GAMES[game].deck}`
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

  /** Finds out whether the screen runs on below what shows of it. */
  function gauge(): void {
    more = !!body && body.scrollHeight - body.scrollTop - body.clientHeight > 6;
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
    // A copy that is running ends with the page. The browser asks before it lets that happen.
    const onLeave = (event: BeforeUnloadEvent) => {
      if (sys.busy) event.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);

    // What is on the screen changes, and so does the room it has.
    let pending = 0;
    const regauge = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(gauge);
    };
    const watcher = new MutationObserver(regauge);
    const sizes = new ResizeObserver(regauge);
    if (body) {
      watcher.observe(body, { childList: true, subtree: true, characterData: true });
      sizes.observe(body);
    }
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(pending);
      watcher.disconnect();
      sizes.disconnect();
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('beforeunload', onLeave);
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

  // The tube warms up when the console is switched on; it can be made to do so again. Off and on
  // again never fixed a water chip, but it is always worth a try, and the vault is on the same circuit.
  let warming = $state(true);
  async function cyclePower(): Promise<void> {
    sfx.switch();
    sys.remark(REMARKS.power);
    window.dispatchEvent(new CustomEvent('overseer:vault', { detail: 'dip' }));
    // The tube has to have been cold for a moment before it can warm up afresh.
    warming = false;
    await settled();
    requestAnimationFrame(() => (warming = true));
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
  {#if sys.settings.vault}
    <Vault {housing} sealed={sys.storage ? sys.storage.persisted : null} />
  {/if}
  <div class="housing" class:warm-up={warming} class:crt-on={sys.settings.crt} class:crt-off={!sys.settings.crt} bind:this={housing}>
    <span class="stamp" aria-hidden="true">OVERSEER'S OFFICE &#9670; AUTHORIZED PERSONNEL ONLY</span>
    <div class="tube-well">
      <div class="tube">
        <div class="refresh"></div>
        <div class="screen">
          <header class="bar">
            <span>OVERSEER CONSOLE // {title}</span>
            <span>{clock}</span>
          </header>

          <main class="body" bind:this={body} tabindex="-1" onscroll={gauge}>
            {#if !booted}
              <Boot ondone={finishBoot} />
            {:else if section === ''}
              <Main {go} />
            {:else if section === 'saves' && game && route[2] === 'modify' && Number(route[3]) > 0}
              {#key `${game}/${route[3]}`}
                <Modify {go} {game} slot={Number(route[3])} />
              {/key}
            {:else if section === 'saves'}
              <Saves {go} {game} slot={Number(route[2]) || undefined} />
            {:else if section === 'settings' && route[1] === 'dropbox'}
              <Dropbox {go} />
            {:else if section === 'settings' && route[1] === 'picture'}
              <Picture {go} />
            {:else if section === 'settings'}
              <Settings {go} />
            {:else if section === 'manual'}
              {#key route[1]}
                <Manual {go} chapter={route[1]} />
              {/key}
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

          <footer class="foot">
            <!-- A screen longer than the tube says so, the way a pager does. -->
            {#if more}
              <span class="more" aria-hidden="true">-- MORE --</span>
            {/if}
            <!-- What the entry under the cursor does. Under the screen, so that it shows wherever the screen has been scrolled to. -->
            {#if sys.noted}
              <p class="menu-note" aria-live="polite">{sys.note}</p>
            {/if}
            <div class="hints">
              {#each sys.hints as [key, label] (key)}
                <span><b>{key}</b> {label}</span>
              {/each}
            </div>
          </footer>
        </div>

        {#if dragging > 0}
          <div class="dropzone">
            <Glyph name="folder" />
            <span>Release to load holodisk</span>
          </div>
        {/if}

        {#if sys.settings.vault}
          <Pest />
        {/if}
      </div>
    </div>

    <div class="controls">
      {#key sys.plate}
        <span class="nameplate" class:speaking={sys.plate !== ''}>{sys.plate || 'OVERSEER CONSOLE'}</span>
      {/key}
      <button class="lamp on" type="button" title="Power" onclick={cyclePower}>PWR<span class="sr-only"> off and on again</span></button>
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
