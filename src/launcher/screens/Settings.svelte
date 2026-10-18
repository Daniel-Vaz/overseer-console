<script lang="ts">
  import { onMount } from 'svelte';
  import { AUTOSAVE_MINUTES } from '../../lib/autosave';
  import { gameDef } from '../../lib/games';
  import { FAST_FORWARD_SPEEDS, type Settings } from '../../lib/settings';
  import { formatBytes } from '../../lib/storage/manifest';
  import { requestPersistence, storageStatus } from '../../lib/storage/opfs';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { PICTURE_NAMES, step } from '../picture';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  const CACHE_STEPS = [96, 192, 384, 768];
  const SCALINGS: readonly Settings['scaling'][] = ['fill', 'integer', 'smooth'];
  // What a setting belongs to. The list is long; these keep it readable. The console's storage is the console's:
  // a heading of its own would cost the line the list does not have.
  const GAMES_GROUP = 'The games';
  const CONSOLE_GROUP = 'This console';
  const STORAGE_GROUP = CONSOLE_GROUP;
  let persistNote = $state('');
  let selected = $state(0);

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'CHANGE'],
      ['<- ->', 'EITHER WAY'],
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
    else {
      sfx.deny();
      // The great door of the vault behind the console tries to shut, and cannot.
      window.dispatchEvent(new CustomEvent('overseer:vault', { detail: 'jam' }));
    }
  }

  const s = $derived(sys.settings);

  /** A setting that is on or off: ENTER and both arrows flip it. */
  function toggle(key: 'fullscreen' | 'skipIntro' | 'improvements' | 'crt' | 'sound' | 'vault'): Pick<MenuItem, 'action' | 'adjust'> {
    const flip = () => sys.update({ [key]: !s[key] });
    return { action: flip, adjust: flip };
  }

  /** A setting with a row of values: ENTER and the right arrow step on through them, the left arrow back. */
  function choice<K extends keyof Settings>(key: K, values: readonly Settings[K][]): Pick<MenuItem, 'action' | 'adjust'> {
    const move = (direction: 1 | -1 = 1) => sys.update({ [key]: step(values, s[key], direction) } as Partial<Settings>);
    return { action: () => move(), adjust: move };
  }

  // The same picture for every game is named once; otherwise each deck's, in the order of the decks, and
  // where mods are loaded besides, only that the games differ.
  const pictures = $derived.by(() => {
    const games = sys.games.filter((game) => !gameDef(game).mod || sys.installs[game]);
    const names = games.map((game) => PICTURE_NAMES[sys.picture(game)]);
    if (names.every((name) => name === names[0])) return names[0]!;
    return games.length > 2 ? 'EACH ITS OWN' : names.map((name) => name.split(' ')[0]).join(' / ');
  });

  const items = $derived<MenuItem[]>([
    {
      key: '1',
      group: GAMES_GROUP,
      label: 'Picture',
      icon: 'picture',
      state: pictures,
      note: 'Every game has its own picture: the original 640 x 480, widened to your window, or high resolution. Open to choose; each deck offers the same choice.',
      action: () => go('settings/picture'),
    },
    {
      key: '2',
      group: GAMES_GROUP,
      label: 'Scaling',
      icon: 'scaling',
      state: s.scaling === 'fill' ? 'FILL WINDOW' : s.scaling === 'integer' ? 'WHOLE PIXELS' : 'SMOOTH',
      note:
        s.scaling === 'fill'
          ? 'As large as the window allows, with hard-edged pixels.'
          : s.scaling === 'integer'
            ? 'Whole-number zoom only: every pixel exactly the same size, possibly with a black border.'
            : 'As large as the window allows, with pixels blended.',
      ...choice('scaling', SCALINGS),
    },
    {
      key: '3',
      group: GAMES_GROUP,
      label: 'Start in fullscreen',
      icon: 'fullscreen',
      state: s.fullscreen ? 'ON' : 'OFF',
      note: 'F11 toggles fullscreen at any time while playing.',
      ...toggle('fullscreen'),
    },
    {
      key: '4',
      group: GAMES_GROUP,
      label: 'Intro movies',
      icon: 'movies',
      state: s.skipIntro ? 'SKIP' : 'PLAY',
      note: s.skipIntro
        ? 'Games open on their main menu.'
        : 'Games open with their logo and intro movies, as originally. ESC skips a movie.',
      ...toggle('skipIntro'),
    },
    {
      key: '5',
      group: GAMES_GROUP,
      label: 'Game sound',
      icon: 'audio',
      state: s.audio === 'buffered' ? 'BUFFERED' : 'DIRECT',
      note:
        s.audio === 'buffered'
          ? 'Sound is queued a moment ahead, so brief hiccups of the browser are not heard. Recommended.'
          : 'The lowest delay, but any hiccup of the browser is heard as a click or gap.',
      ...choice('audio', ['buffered', 'direct']),
    },
    {
      key: '6',
      group: GAMES_GROUP,
      label: 'Game improvements',
      icon: 'holodisk-02',
      state: s.improvements ? 'ON' : 'OFF',
      // Kept to two lines: the list is long, and the manual has the whole of it.
      note: s.improvements
        ? 'Fallout 2 and its mods with what the engine adds: SHIFT lights up what lies on the ground, a wider inventory, doors that open by themselves. The manual lists it all.'
        : 'Fallout 2 and its mods as the original engine played them.',
      ...toggle('improvements'),
    },
    {
      key: '7',
      group: GAMES_GROUP,
      label: 'Fast forward',
      icon: 'play',
      state: `${s.fastForward} TIMES`,
      note: 'F8, or FAST on a touch screen, runs a game this many times as fast until pressed again: for long walks and long turns.',
      ...choice('fastForward', FAST_FORWARD_SPEEDS),
    },
    {
      key: 'a',
      group: GAMES_GROUP,
      label: 'Autosave',
      icon: 'save',
      state: s.autosave ? `EVERY ${s.autosave} MIN` : 'OFF',
      note: s.autosave
        ? `Every ${s.autosave} minutes of play the game is saved in slot 08, 09 or 10, in turn. A save you make in 08 to 10 yourself is never saved over. Quick saves go in 07.`
        : 'Games are saved only when you save them.',
      ...choice('autosave', AUTOSAVE_MINUTES),
    },
    // Only where there is a touch screen to speak of.
    ...(navigator.maxTouchPoints > 0 || 'ontouchstart' in window || matchMedia('(any-pointer: coarse)').matches
      ? [
          {
            key: 'p',
            group: GAMES_GROUP,
            label: 'Touch pointer',
            icon: s.touchPointer === 'direct' ? 'pointer-finger' : 'pointer-trackpad',
            state: s.touchPointer === 'direct' ? 'FOLLOWS FINGER' : 'TRACKPAD',
            note:
              s.touchPointer === 'direct'
                ? 'Tap what you want to click; the pointer goes where your finger is.'
                : 'The picture works like a laptop trackpad: drag to move the pointer, tap anywhere to click. Precise on small screens.',
            ...choice('touchPointer', ['direct', 'trackpad']),
          } satisfies MenuItem,
        ]
      : []),
    {
      key: '8',
      group: CONSOLE_GROUP,
      label: 'Tube effects',
      icon: 'tube',
      state: s.crt ? 'ON' : 'OFF',
      note: 'Scanlines, glow and flicker on this console. Does not affect the games.',
      ...toggle('crt'),
    },
    {
      key: '9',
      group: CONSOLE_GROUP,
      label: 'Console sounds',
      icon: 'audio',
      state: s.sound ? 'ON' : 'OFF',
      note: 'Clicks and beeps on this console. Does not affect the games.',
      ...toggle('sound'),
    },
    {
      key: 'v',
      group: CONSOLE_GROUP,
      label: 'Vault around the console',
      state: s.vault ? 'ON' : 'OFF',
      note: 'The vault a large window shows around this console, and what lives in it. Left alone, some of it comes out onto the glass.',
      ...toggle('vault'),
    },
    {
      key: 'm',
      group: STORAGE_GROUP,
      label: 'Game data kept in memory',
      icon: 'memory',
      state: `${s.cacheMb} MB`,
      note: 'Game files are read from disk as needed and kept in memory up to this size. Lower it on devices with little memory.',
      ...choice('cacheMb', CACHE_STEPS),
    },
    {
      key: 'l',
      group: STORAGE_GROUP,
      label: 'Seal private storage',
      icon: sys.storage?.persisted ? 'sealed' : 'unsealed',
      state: sys.storage?.persisted ? 'SEALED' : 'NOT SEALED',
      tone: sys.storage?.persisted ? undefined : 'amber',
      disabled: !sys.supported,
      note:
        persistNote ||
        'Asks the browser never to clear game data and saves on its own. Without it, a browser short on disk space may.',
      action: () => void seal(),
    },
    {
      key: 'c',
      group: STORAGE_GROUP,
      label: 'Cloud link',
      icon: 'uplink',
      state: sys.cloud.linked ? sys.cloud.name.toUpperCase() : 'NOT LINKED',
      note: sys.cloud.linked
        ? `Linked to the ${sys.cloud.name} of ${sys.cloud.account}. Open to put games and mods in it, change its folders or unlink.`
        : 'Optional. Keep saves in your own Dropbox or Google Drive to move them between devices, and load game files from it.',
      action: () => go('settings/cloud'),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('') },
  ]);
</script>

<h1>Terminal settings</h1>

<div class="columns">
  <div>
    <Menu {items} label="Settings" bind:selected />
  </div>
  <aside class="board gap" aria-label="Private storage">
    <Glyph name={items[selected]?.icon ?? 'settings'} tone={items[selected]?.tone} />
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
    <p class="dim">Changes are stored as you make them.</p>
  </aside>
</div>
