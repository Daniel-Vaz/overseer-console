<script lang="ts">
  import { onMount } from 'svelte';
  import { formatBytes } from '../../lib/storage/manifest';
  import { requestPersistence, storageStatus } from '../../lib/storage/opfs';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  const CACHE_STEPS = [96, 192, 384, 768];
  let persistNote = $state('');
  let selected = $state(0);

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'CHANGE'],
      ['ESC', 'BACK'],
    ];
  });

  async function seal(): Promise<void> {
    const granted = await requestPersistence();
    sys.storage = await storageStatus().catch(() => null);
    persistNote = granted
      ? 'Granted. The browser will not clear this data on its own.'
      : 'Not granted. Browsers decide this themselves; installing the console as an app or visiting often makes it more likely.';
    if (granted) sfx.done();
    else sfx.deny();
  }

  const s = $derived(sys.settings);

  const items = $derived<MenuItem[]>([
    {
      key: '1',
      label: 'Picture',
      state: s.display === 'classic' ? 'CLASSIC 4:3' : 'WIDE',
      note:
        s.display === 'classic'
          ? 'The original 640 x 480 picture. The most faithful choice.'
          : 'Same zoom as the original, widened to the shape of your window: more of the map is visible.',
      action: () => sys.update({ display: s.display === 'classic' ? 'wide' : 'classic' }),
    },
    {
      key: '2',
      label: 'Scaling',
      state: s.scaling === 'fill' ? 'FILL WINDOW' : s.scaling === 'integer' ? 'WHOLE PIXELS' : 'SMOOTH',
      note:
        s.scaling === 'fill'
          ? 'As large as the window allows, with hard-edged pixels.'
          : s.scaling === 'integer'
            ? 'Whole-number zoom only: every pixel exactly the same size, possibly with a black border.'
            : 'As large as the window allows, with pixels blended.',
      action: () => sys.update({ scaling: s.scaling === 'fill' ? 'integer' : s.scaling === 'integer' ? 'smooth' : 'fill' }),
    },
    {
      key: '3',
      label: 'Start in fullscreen',
      state: s.fullscreen ? 'ON' : 'OFF',
      note: 'F11 toggles fullscreen at any time while playing.',
      action: () => sys.update({ fullscreen: !s.fullscreen }),
    },
    {
      key: '4',
      label: 'Intro movies',
      state: s.skipIntro ? 'SKIP' : 'PLAY',
      note: s.skipIntro
        ? 'Games open on their main menu.'
        : 'Games open with their logo and intro movies, as originally. ESC skips a movie.',
      action: () => sys.update({ skipIntro: !s.skipIntro }),
    },
    {
      key: '5',
      label: 'Game sound',
      icon: 'audio',
      state: s.audio === 'buffered' ? 'BUFFERED' : 'DIRECT',
      note:
        s.audio === 'buffered'
          ? 'Sound is queued a moment ahead, so brief hiccups of the browser are not heard. Recommended.'
          : 'The lowest delay, but any hiccup of the browser is heard as a click or gap.',
      action: () => sys.update({ audio: s.audio === 'buffered' ? 'direct' : 'buffered' }),
    },
    // Only where there is a touch screen to speak of.
    ...(navigator.maxTouchPoints > 0 || 'ontouchstart' in window || matchMedia('(any-pointer: coarse)').matches
      ? [
          {
            key: 't',
            label: 'Touch pointer',
            state: s.touchPointer === 'direct' ? 'FOLLOWS FINGER' : 'TRACKPAD',
            note:
              s.touchPointer === 'direct'
                ? 'Tap what you want to click; the pointer goes where your finger is.'
                : 'The picture works like a laptop trackpad: drag to move the pointer, tap anywhere to click. Precise on small screens.',
            action: () => sys.update({ touchPointer: s.touchPointer === 'direct' ? 'trackpad' : 'direct' }),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '6',
      label: 'Tube effects',
      icon: 'terminal',
      state: s.crt ? 'ON' : 'OFF',
      note: 'Scanlines, glow and flicker on this console. Does not affect the games.',
      action: () => sys.update({ crt: !s.crt }),
    },
    {
      key: '7',
      label: 'Console sounds',
      icon: 'audio',
      state: s.sound ? 'ON' : 'OFF',
      note: 'Clicks and beeps on this console. Does not affect the games.',
      action: () => sys.update({ sound: !s.sound }),
    },
    {
      key: '8',
      label: 'Game data kept in memory',
      icon: 'gamedata',
      state: `${s.cacheMb} MB`,
      note: 'Game files are read from disk as needed and kept in memory up to this size. Lower it on devices with little memory.',
      action: () => {
        const next = CACHE_STEPS[(CACHE_STEPS.indexOf(s.cacheMb) + 1) % CACHE_STEPS.length] ?? 192;
        sys.update({ cacheMb: next });
      },
    },
    {
      key: '9',
      label: 'Seal private storage',
      icon: 'save',
      state: sys.storage?.persisted ? 'SEALED' : 'NOT SEALED',
      tone: sys.storage?.persisted ? undefined : 'amber',
      disabled: !sys.supported,
      note:
        persistNote ||
        'Asks the browser never to clear game data and saves on its own. Without it, a browser short on disk space may.',
      action: () => void seal(),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('') },
  ]);
</script>

<h1>Terminal settings</h1>
<p class="sub">Changes are stored as you make them.</p>

<div class="columns">
  <div>
    <Menu {items} label="Settings" bind:selected />
  </div>
  <aside class="board gap" aria-label="Private storage">
    <Glyph name={items[selected]?.icon ?? 'settings'} />
    {#if sys.storage}
      <dl class="readout">
        <dt>In use</dt>
        <dd>{formatBytes(sys.storage.usage)}</dd>
        {#if sys.storage.quota}
          <dt>Available</dt>
          <dd>{formatBytes(sys.storage.quota)}</dd>
        {/if}
        <dt>Seal</dt>
        <dd class:amber={!sys.storage.persisted}>{sys.storage.persisted ? 'SEALED' : 'OPEN'}</dd>
      </dl>
    {/if}
  </aside>
</div>
