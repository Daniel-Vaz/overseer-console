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

import { bootEngine, NoInstallError, StorageUnavailableError, type Engine } from '../lib/engine/host';
import { GAMES, isGameId, type GameId } from '../lib/games';
import { loadSettings, recordLaunch } from '../lib/settings';
import { audioBridgeStats, installAudioBridge } from './audio-bridge';

type Phase = 'boot' | 'gate' | 'running' | 'menu' | 'fatal' | 'leaving';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const terminal = $('terminal');
const body = $('terminal-body');
const hints = $('terminal-hints');
const barTitle = $('bar-title');
const barState = $('bar-state');
const handle = $<HTMLButtonElement>('handle');
const toastEl = $('toast');

const settings = loadSettings();
if (settings.audio === 'buffered') installAudioBridge();
const requested = new URLSearchParams(location.search).get('game');
const consoleUrl = (game?: GameId) => `${import.meta.env.BASE_URL}${game ? `#/${game}` : ''}`;

let phase: Phase = 'boot';
let engine: Engine | null = null;
let keyboardLocked = false;
let hiddenPause = false;
let confirmingExit = false;
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
// Picture
// ---------------------------------------------------------------------

/** Sizes the canvas on the page. The game's own resolution never changes. */
function fit(): void {
  if (!engine) return;
  const { width, height } = engine.screen;
  const ratio = window.devicePixelRatio || 1;
  const availableWidth = window.innerWidth;
  const availableHeight = window.innerHeight;

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
}

// SDL sets the canvas size itself when it opens its window; put ours back.
new MutationObserver(fit).observe(canvas, { attributes: true, attributeFilter: ['style', 'width', 'height'] });
window.addEventListener('resize', fit);

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    toast('FULLSCREEN IS NOT AVAILABLE HERE');
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

function suspendEngine(): void {
  engine?.pause();
  void engine?.audioContext()?.suspend();
}

function resumeEngine(): void {
  void engine?.audioContext()?.resume();
  engine?.resume();
}

function begin(): void {
  if (phase !== 'gate' || !engine) return;
  phase = 'running';
  hideTerminal();
  handle.hidden = false;
  recordLaunch(engine.game);
  if (settings.fullscreen) void toggleFullscreen();
  canvas.focus({ preventScroll: true });
  try {
    engine.start();
  } catch (err) {
    fatal(`The engine failed to start: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  fit();
  toast('F9 CONSOLE MENU   F11 FULLSCREEN', 4500);
}

function openMenu(confirmExit = false): void {
  if (phase !== 'running' && phase !== 'menu') return;
  phase = 'menu';
  confirmingExit = confirmExit;
  suspendEngine();
  showTerminal({ centered: true, veil: true, state: 'SUSPENDED' });

  if (confirmExit) {
    body.replaceChildren(
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
    el('p', 'big', 'Simulation suspended'),
    actions([
      ['[R] Resume', closeMenu],
      [document.fullscreenElement ? '[F] Leave fullscreen' : '[F] Fullscreen', () => void toggleFullscreen().then(() => openMenu())],
      ['[X] Exit to console', () => openMenu(true)],
    ]),
    keys,
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
    else if (key === 'f' || key === 'f11') void toggleFullscreen().then(() => openMenu());
    else if (key === 'x') openMenu(true);
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
      { width: window.innerWidth, height: window.innerHeight },
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
  prompt.append('PRESS ANY KEY OR CLICK TO BEGIN', el('span', 'cursor'));
  body.replaceChildren(
    el('p', 'big', `${def.label} ready`),
    el('p', 'dim', `${def.title} - ${def.engine.name}`),
    prompt,
  );
  setHints([
    ['ANY KEY', 'BEGIN'],
    ['ESC', 'BACK TO CONSOLE'],
    ['F9', 'CONSOLE MENU IN GAME'],
  ]);
  terminal.addEventListener('pointerup', begin, { once: true });
}

void main();
