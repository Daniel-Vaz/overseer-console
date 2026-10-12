/**
 * The player page: boots an engine, then gets out of the way.
 *
 * It is deliberately a separate document from the console. Leaving it is a
 * navigation, which reliably frees the engine's memory, and an engine crash
 * cannot take the console down with it.
 */
import '@fontsource/vt323/latin-400.css';
import '../styles/terminal.css';
import '../styles/player.css';

import faultIcon from '../assets/icons/fault.png';
import rotateIcon from '../assets/icons/rotate.png';
import suspendedIcon from '../assets/icons/suspended.png';
import warningIcon from '../assets/icons/warning.png';
import { bootEngine, NoInstallError, StorageUnavailableError, type Engine } from '../lib/engine/host';
import { GAMES, isGameId, type GameId } from '../lib/games';
import { loadSettings, recordLaunch, saveSettings } from '../lib/settings';
import { audioBridgeStats, installAudioBridge } from './audio-bridge';
import { TouchControls, fingerFirst } from './touch/controls';

type Phase = 'boot' | 'gate' | 'running' | 'menu' | 'fatal' | 'leaving';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const stage = $('stage');
const terminal = $('terminal');
const body = $('terminal-body');
const hints = $('terminal-hints');
const barTitle = $('bar-title');
const barState = $('bar-state');
const handle = $<HTMLButtonElement>('handle');
const toastEl = $('toast');

const settings = loadSettings();
if (settings.audio === 'buffered') installAudioBridge();
const query = new URLSearchParams(location.search);
const requested = query.get('game');
/** "Continue": the save slot to load as soon as the game is up. */
const loadSlot = /^[1-9]\d{0,3}$/.test(query.get('slot') ?? '') ? Number(query.get('slot')) : undefined;
const consoleUrl = (game?: GameId) => `${import.meta.env.BASE_URL}${game ? `#/${game}` : ''}`;

/** Seen the touch controls explained once; they are not explained again unasked. */
const TOUCH_HELP_KEY = 'overseer-console:touch-help';

let phase: Phase = 'boot';
let engine: Engine | null = null;
let startedAt = 0;
/** SDL starts with text input switched on; it is switched off once so that the games' own requests stand out. */
let textInputReset = false;
let keyboardLocked = false;
let hiddenPause = false;
let confirmingExit = false;
/** What the suspended screen shows: the menu itself, or the touch help. */
let menuView: 'menu' | 'touch' = 'menu';
const engineLog: string[] = [];

// ---------------------------------------------------------------------
// The terminal overlay
// ---------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One of the console's pictures, drawn in phosphor or in the colour of a caution or a fault. */
function glyph(image: string, tone?: 'amber' | 'alert'): HTMLElement {
  const node = el('div', tone ? `glyph ${tone}` : 'glyph');
  node.style.setProperty('--glyph', `url(${image})`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function setHints(pairs: [key: string, label: string][]): void {
  hints.replaceChildren(
    ...pairs.map(([key, label]) => {
      const span = el('span');
      span.append(el('b', undefined, key), ` ${label}`);
      return span;
    }),
  );
}

function showTerminal(options: { centered?: boolean; veil?: boolean; state: string }): void {
  terminal.hidden = false;
  terminal.classList.toggle('centered', !!options.centered);
  terminal.classList.toggle('veil', !!options.veil);
  barState.textContent = options.state;
}

function hideTerminal(): void {
  terminal.hidden = true;
}

function actions(buttons: [label: string, onClick: () => void][]): HTMLElement {
  const row = el('div', 'actions');
  for (const [label, onClick] of buttons) {
    const button = el('button', undefined, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    row.append(button);
  }
  return row;
}

let toastTimer = 0;
function toast(text: string, ms = 2600, bad = false): void {
  toastEl.textContent = text;
  toastEl.classList.toggle('bad', bad);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------
// Boot log
// ---------------------------------------------------------------------

const logList = el('ul', 'log');
let meterFill: HTMLElement | null = null;
let meterText: HTMLElement | null = null;

function logLine(text: string): HTMLLIElement {
  const previous = logList.lastElementChild;
  if (previous && !previous.classList.contains('meter-line')) previous.classList.add('ok');
  const line = el('li', undefined, text);
  logList.append(line);
  return line;
}

function showProgress(done: number, total: number): void {
  if (!meterFill) {
    const line = el('li', 'meter-line');
    const meter = el('div', 'meter');
    const track = el('div', 'track');
    meterFill = el('div', 'fill');
    meterText = el('span');
    track.append(meterFill);
    meter.append(track, meterText);
    line.append(meter);
    logList.append(line);
  }
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  meterFill.style.width = `${(fraction * 100).toFixed(1)}%`;
  meterText!.textContent = `${Math.round(fraction * 100)}%  ${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------

const touch = new TouchControls(
  {
    stage,
    canvas,
    deck: $('deck'),
    keys: $('keys'),
    turns: () => engine?.module.overseer.stats().sleeps ?? 0,
    playing: () => phase === 'running',
    wantsText: () => {
      const module = engine?.module;
      if (!module?._SDL_IsTextInputActive || !module._SDL_StopTextInput) return undefined;
      if (!textInputReset) {
        // Not before the game is past its start-up.
        if (performance.now() - startedAt < 1500) return undefined;
        module._SDL_StopTextInput();
        textInputReset = true;
      }
      return module._SDL_IsTextInputActive() !== 0;
    },
    openMenu: () => openMenu(),
    layoutChanged: () => fit(),
  },
  settings.touchPointer,
);
// Phones and tablets get the deck from the start, so that the picture is
// sized for it; elsewhere it appears with the first touch.
if (fingerFirst()) touch.show();

/** A phone: held upright, its screen leaves the picture very small. */
const handheld = (): boolean => fingerFirst() && Math.min(screen.width, screen.height) < 600;

function touchHelpSeen(): boolean {
  try {
    return localStorage.getItem(TOUCH_HELP_KEY) === '1';
  } catch {
    return true;
  }
}

touch.onFirstShown = () => {
  if (phase === 'running' && !touchHelpSeen()) openTouchHelp();
};

// ---------------------------------------------------------------------
// Picture
// ---------------------------------------------------------------------

/** Sizes the canvas on the page. The game's own resolution never changes. */
function fit(): void {
  if (!engine) return;
  const { width, height } = engine.screen;
  const ratio = window.devicePixelRatio || 1;
  // The stage is the window, less the touch deck and keyboard when they are shown.
  const availableWidth = stage.clientWidth;
  const availableHeight = stage.clientHeight;
  if (availableWidth <= 0 || availableHeight <= 0) return;

  let cssWidth = 0;
  let cssHeight = 0;
  if (settings.scaling === 'integer') {
    // Whole device pixels per game pixel, so every pixel is the same size.
    const zoom = Math.floor(Math.min((availableWidth * ratio) / width, (availableHeight * ratio) / height));
    if (zoom >= 1) {
      cssWidth = (width * zoom) / ratio;
      cssHeight = (height * zoom) / ratio;
    }
  }
  if (!cssWidth) {
    const scale = Math.min(availableWidth / width, availableHeight / height);
    cssWidth = Math.floor(width * scale);
    cssHeight = Math.floor(height * scale);
  }

  const wantWidth = `${cssWidth}px`;
  const wantHeight = `${cssHeight}px`;
  if (canvas.style.width !== wantWidth) canvas.style.width = wantWidth;
  if (canvas.style.height !== wantHeight) canvas.style.height = wantHeight;
  canvas.classList.toggle('smooth', settings.scaling === 'smooth');
  touch.resized(cssWidth, cssHeight, cssWidth / width);
}

// SDL sets the canvas size itself when it opens its window; put ours back.
new MutationObserver(fit).observe(canvas, { attributes: true, attributeFilter: ['style', 'width', 'height'] });
window.addEventListener('resize', fit);
new ResizeObserver(fit).observe(stage);

async function toggleFullscreen(quiet = false): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      // A phone held upright shows a tiny picture; turn it, where the browser lets a page do that.
      const orientation = screen.orientation as ScreenOrientation & { lock?(orientation: string): Promise<void> };
      if (handheld()) void orientation.lock?.('landscape').catch(() => undefined);
    }
  } catch {
    if (!quiet) toast('FULLSCREEN IS NOT AVAILABLE HERE');
  }
}

interface KeyboardLock {
  lock?(keys: string[]): Promise<void>;
  unlock?(): void;
}

document.addEventListener('fullscreenchange', () => {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  if (document.fullscreenElement) {
    // Where the browser allows it, keep Esc for the game while in fullscreen.
    keyboard
      ?.lock?.(['Escape'])
      .then(() => (keyboardLocked = true))
      .catch(() => (keyboardLocked = false));
    if (!keyboard?.lock && phase === 'running') toast('ESC LEAVES FULLSCREEN HERE - USE THE ` KEY AS ESC', 5000);
  } else {
    keyboard?.unlock?.();
    keyboardLocked = false;
  }
  fit();
});

// ---------------------------------------------------------------------
// Running, pausing, leaving
// ---------------------------------------------------------------------

/**
 * Keeps the screen on while the game runs. A movie or a long read does not
 * touch the screen, and a phone would dim and lock in the middle of it.
 */
interface WakeLockHandle {
  release(): Promise<void>;
}
let wakeLock: WakeLockHandle | null = null;

function stayAwake(awake: boolean): void {
  const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockHandle> } }).wakeLock;
  if (!awake) {
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  } else if (api && !wakeLock && !document.hidden) {
    // Refused on low battery and the like; the game is no worse off.
    void api
      .request('screen')
      .then((lock) => {
        if (phase === 'running') wakeLock = lock;
        else void lock.release().catch(() => undefined);
      })
      .catch(() => undefined);
  }
}

function suspendEngine(): void {
  // No button may stay down while the game cannot see it come up.
  touch.releaseAll();
  stayAwake(false);
  engine?.pause();
  void engine?.audioContext()?.suspend();
}

function resumeEngine(): void {
  void engine?.audioContext()?.resume();
  engine?.resume();
  stayAwake(true);
}

function begin(): void {
  if (phase !== 'gate' || !engine) return;
  phase = 'running';
  hideTerminal();
  handle.hidden = false;
  recordLaunch(engine.game);
  // On a phone the browser's own bars take a third of the screen; ask to be rid of them.
  if (settings.fullscreen) void toggleFullscreen();
  else if (fingerFirst()) void toggleFullscreen(true);
  canvas.focus({ preventScroll: true });
  startedAt = performance.now();
  try {
    engine.start();
  } catch (err) {
    fatal(`The engine failed to start: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  fit();
  stayAwake(true);
  if (!touch.visible) toast('F9 CONSOLE MENU   F11 FULLSCREEN', 4500);
  else if (!touchHelpSeen()) openTouchHelp();
}

/** Explains the touch controls. Shown by itself once, and from the menu. */
function openTouchHelp(): void {
  if (phase !== 'running' && phase !== 'menu') return;
  phase = 'menu';
  menuView = 'touch';
  suspendEngine();
  showTerminal({ centered: true, veil: true, state: 'SUSPENDED' });
  try {
    localStorage.setItem(TOUCH_HELP_KEY, '1');
  } catch {
    // Then it is explained again next time.
  }

  const help = el('dl', 'readout touch-help');
  const trackpad = settings.touchPointer === 'trackpad';
  for (const [what, meaning] of [
    ['Tap', trackpad ? 'Click where the pointer is' : 'Click'],
    ['Drag', 'Move the pointer. Nothing is clicked'],
    ['Hold', 'Keep the button pressed: action menus, dragging items'],
    ['2 fingers', 'Drag to scroll. Tap to switch the cursor'],
    ['CLICK', 'Clicks where the pointer is: drag to aim, then press it'],
    ['CURSOR', 'Switches the cursor between walking and using'],
    ['KEYS', 'Keyboard. Comes up by itself when the game wants text'],
    ['ESC, MENU', 'Skip or close. Pause, this help, leave the game'],
  ] as const) {
    help.append(el('dt', undefined, what), el('dd', undefined, meaning));
  }

  body.replaceChildren(
    el('p', 'hot', 'TOUCH CONTROLS'),
    help,
    // The first thing a newcomer taps is a label, and nothing happens.
    el('p', 'dim touch-tip', 'In the games, tap the small round buttons, not the words beside them.'),
    actions([['[R] Got it', closeMenu]]),
  );
  setHints([['R', 'RESUME']]);
}

function togglePointerMode(): void {
  settings.touchPointer = settings.touchPointer === 'direct' ? 'trackpad' : 'direct';
  saveSettings(settings);
  touch.setMode(settings.touchPointer);
  openMenu();
}

function openMenu(confirmExit = false): void {
  if (phase !== 'running' && phase !== 'menu') return;
  phase = 'menu';
  menuView = 'menu';
  confirmingExit = confirmExit;
  suspendEngine();
  showTerminal({ centered: true, veil: true, state: 'SUSPENDED' });

  if (confirmExit) {
    body.replaceChildren(
      glyph(warningIcon, 'amber'),
      el('p', 'big amber', 'End simulation?'),
      el('p', 'gap', 'Progress since your last save will be lost.'),
      actions([
        ['[Y] Exit to console', leave],
        ['[N] Stay', () => openMenu()],
      ]),
    );
    setHints([
      ['Y', 'EXIT'],
      ['N', 'STAY'],
    ]);
    return;
  }

  const keys = el('dl', 'readout gap');
  for (const [key, label] of [
    ['F4 / F5', 'Save / load game'],
    ['F6 / F7', 'Quick save / quick load'],
    ['ESC', 'Game options'],
    ['F9', 'This menu'],
    ['F11', 'Fullscreen'],
  ] as const) {
    keys.append(el('dt', undefined, key), el('dd', undefined, label));
  }
  keys.style.textAlign = 'left';

  body.replaceChildren(
    glyph(suspendedIcon),
    el('p', 'big', 'Simulation suspended'),
    actions([
      ['[R] Resume', closeMenu],
      [document.fullscreenElement ? '[F] Leave fullscreen' : '[F] Fullscreen', () => void toggleFullscreen().then(() => openMenu())],
      ['[X] Exit to console', () => openMenu(true)],
    ]),
    // Players using the touch controls get their help and their one setting here.
    ...(touch.visible
      ? [
          actions([
            ['[T] Touch controls', openTouchHelp],
            [`[P] Pointer: ${settings.touchPointer === 'direct' ? 'follows finger' : 'trackpad'}`, togglePointerMode],
          ]),
        ]
      : [keys]),
  );
  setHints([
    ['R', 'RESUME'],
    ['F', 'FULLSCREEN'],
    ['X', 'EXIT'],
  ]);
}

function closeMenu(): void {
  if (phase !== 'menu') return;
  phase = 'running';
  hideTerminal();
  canvas.focus({ preventScroll: true });
  if (!document.hidden) resumeEngine();
}

function leave(): void {
  phase = 'leaving';
  location.replace(consoleUrl(engine?.game ?? (isGameId(requested) ? requested : undefined)));
}

function fatal(message: string): void {
  if (phase === 'fatal' || phase === 'leaving') return;
  const wasRunning = phase === 'running' || phase === 'menu';
  phase = 'fatal';
  handle.hidden = true;
  showTerminal({ centered: true, veil: wasRunning, state: 'FAULT' });
  const detail = el('p', 'gap dim');
  detail.textContent = engineLog.slice(-4).join('\n');
  detail.style.whiteSpace = 'pre-wrap';
  body.replaceChildren(
    glyph(faultIcon, 'alert'),
    el('p', 'big alert', 'System fault'),
    el('p', 'gap', message),
    el('p', 'gap dim', wasRunning ? 'Games you saved before this point are safe.' : ''),
    actions([
      ['[R] Restart', () => location.reload()],
      ['[C] Return to console', leave],
    ]),
    detail,
  );
  setHints([
    ['R', 'RESTART'],
    ['C', 'CONSOLE'],
  ]);
}

handle.addEventListener('click', () => openMenu());

document.addEventListener('visibilitychange', () => {
  if (phase !== 'running') return;
  if (document.hidden) {
    hiddenPause = true;
    suspendEngine();
  } else if (hiddenPause) {
    hiddenPause = false;
    resumeEngine();
  }
});

// The engine draws its own menu for the right button.
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('beforeunload', (event) => {
  if (phase === 'running' || phase === 'menu') event.preventDefault();
});

function sendEscape(type: string): void {
  window.dispatchEvent(
    new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }),
  );
}

/**
 * Keys are seen here before the engine sees them. While the game runs only
 * the console's own keys are held back; in every other phase the game gets
 * nothing, so a key that closes a menu does not also land in the game.
 */
function onKey(event: KeyboardEvent): void {
  if (!event.isTrusted) return; // our own synthetic Escape
  const down = event.type === 'keydown';

  if (phase === 'running') {
    if (event.code === 'F9' || event.code === 'F11') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (down && !event.repeat) {
        if (event.code === 'F9') openMenu();
        else void toggleFullscreen();
      }
    } else if (event.code === 'Backquote' && document.fullscreenElement && !keyboardLocked) {
      // Without keyboard lock the browser takes Esc to leave fullscreen.
      event.preventDefault();
      event.stopImmediatePropagation();
      sendEscape(event.type);
    }
    return;
  }

  event.stopImmediatePropagation();
  if (!down || event.repeat) return;
  const key = event.key.toLowerCase();

  if (phase === 'boot') {
    if (key === 'escape') leave();
  } else if (phase === 'gate') {
    if (['shift', 'control', 'alt', 'meta'].includes(key)) return;
    event.preventDefault();
    if (key === 'escape') leave();
    else begin();
  } else if (phase === 'menu') {
    event.preventDefault();
    if (confirmingExit) {
      if (key === 'y') leave();
      else if (key === 'n' || key === 'escape') openMenu();
    } else if (key === 'r' || key === 'escape' || key === 'f9' || key === 'enter') closeMenu();
    else if (menuView === 'touch') return;
    else if (key === 'f' || key === 'f11') void toggleFullscreen().then(() => openMenu());
    else if (key === 'x') openMenu(true);
    else if (key === 't' && touch.visible) openTouchHelp();
    else if (key === 'p' && touch.visible) togglePointerMode();
  } else if (phase === 'fatal') {
    if (key === 'r') location.reload();
    else if (key === 'c' || key === 'escape') leave();
  }
}

window.addEventListener('keydown', onKey, true);
window.addEventListener('keyup', onKey, true);

window.addEventListener('error', (event) => {
  if (phase === 'running' || phase === 'menu') fatal(`The engine crashed: ${event.message}`);
});
window.addEventListener('unhandledrejection', (event) => {
  if (phase === 'running' || phase === 'menu') {
    fatal(`The engine crashed: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`);
  }
});

// ---------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------

/** Two tabs running the same game would overwrite each other's saves. */
function claimGame(game: GameId): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks.request(`overseer-console:play:${game}`, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      // Held for as long as this page lives.
      return lock ? new Promise<void>(() => {}) : undefined;
    });
  });
}

async function main(): Promise<void> {
  if (!isGameId(requested)) {
    location.replace(consoleUrl());
    return;
  }
  const game = requested;
  const def = GAMES[game];
  document.title = `${def.title} - Overseer Console`;
  barTitle.textContent = `OVERSEER CONSOLE // ${def.label}`;
  showTerminal({ state: 'BOOT' });
  body.replaceChildren(logList);
  setHints([['ESC', 'ABORT']]);

  logLine(`${def.label}: ${def.title.toUpperCase()} (${def.year})`);
  if (!(await claimGame(game))) {
    fatal(`${def.title} is already running in another tab or window. Close it there first.`);
    return;
  }

  try {
    engine = await bootEngine(
      game,
      canvas,
      settings,
      // The room the picture will have, which the touch deck may have narrowed.
      { width: stage.clientWidth || window.innerWidth, height: stage.clientHeight || window.innerHeight },
      {
        status: (line) => logLine(line),
        progress: showProgress,
        log: (line) => {
          engineLog.push(line);
          if (engineLog.length > 200) engineLog.shift();
          console.log(`[engine] ${line}`);
        },
        saved: (files) => {
          if (files > 1) toast('SAVED TO BROWSER STORAGE');
        },
        storageFailed: (reason) => toast(`NOT STORED: ${reason.toUpperCase()}. THIS SAVE WILL BE LOST WHEN YOU LEAVE.`, 20_000, true),
        exit: () => leave(),
        fatal,
      },
      { loadSlot },
    );
  } catch (err) {
    // Nothing to play here; the console explains why and what to do.
    if (err instanceof NoInstallError || err instanceof StorageUnavailableError) {
      location.replace(consoleUrl(game));
      return;
    }
    fatal(err instanceof Error ? err.message : String(err));
    return;
  }

  if (phase !== 'boot') return;
  // For diagnostics from the browser console: overseerEngine.module.overseer.stats(), overseerAudio()
  Object.assign(window, { overseerEngine: engine, overseerAudio: audioBridgeStats });
  phase = 'gate';
  fit();
  showTerminal({ centered: true, state: 'READY' });
  const prompt = el('p', 'gap');
  prompt.append(fingerFirst() ? 'TAP TO BEGIN' : 'PRESS ANY KEY OR CLICK TO BEGIN', el('span', 'cursor'));
  body.replaceChildren(
    el('p', 'big', `${def.label} ready`),
    el('p', 'dim', `${def.title} - ${def.engine.name}`),
    ...(loadSlot === undefined ? [] : [el('p', 'gap', `CONTINUING FROM SAVE SLOT ${String(loadSlot).padStart(2, '0')}`)]),
    prompt,
  );
  if (fingerFirst()) {
    setHints([['TAP', 'BEGIN']]);
    if (handheld()) {
      // The style sheet shows it only while the phone is held upright.
      const turn = el('div', 'turn-hint dim');
      turn.append(glyph(rotateIcon), 'Turn the phone sideways for a larger picture.');
      body.append(turn);
    }
    body.append(actions([['Back to console', leave]]));
  } else {
    setHints([
      ['ANY KEY', 'BEGIN'],
      ['ESC', 'BACK TO CONSOLE'],
      ['F9', 'CONSOLE MENU IN GAME'],
    ]);
  }
  terminal.addEventListener('pointerup', (event) => {
    // A button on the gate does its own thing.
    if (!(event.target instanceof Element && event.target.closest('button'))) begin();
  });
}

void main();
