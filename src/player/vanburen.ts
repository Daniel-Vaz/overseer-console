/**
 * The player page of the Van Buren tech demo: boots Open Van Buren against
 * the demo's files in storage, and keeps the console's own keys (F9, F11)
 * and menu around it. A page of its own, apart from the Fallout games'
 * (main.ts): the demo has no saves, mods, add-ons or touch controls, and
 * draws with WebGL at the size of the window.
 */
import '@fontsource/vt323/latin-400.css';
import '../styles/terminal.css';
import '../styles/player.css';

import faultIcon from '../assets/icons/fault.png';
import suspendedIcon from '../assets/icons/suspended.png';
import warningIcon from '../assets/icons/warning.png';
import { loadSettings } from '../lib/settings';
import { StorageUnavailableError } from '../lib/storage/opfs';
import { bootDemo, NoDemoError, type DemoEngine } from '../lib/vanburen/boot';
import { DEMO, DEMO_LOCK } from '../lib/vanburen/demo';

type Phase = 'boot' | 'gate' | 'running' | 'menu' | 'leaving' | 'fatal';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const terminal = $('terminal');
const body = $('terminal-body');
const hints = $('terminal-hints');
const barState = $('bar-state');
const handle = $<HTMLButtonElement>('handle');
const toastEl = $('toast');

const settings = loadSettings();
/** The console's screen to go back to. */
const CONSOLE_URL = `${import.meta.env.BASE_URL}#/vanburen`;

let phase: Phase = 'boot';
let engine: DemoEngine | null = null;
let confirmingExit = false;
let hiddenPause = false;
let keyboardLocked = false;
let startedAt = 0;
let fault: string | null = null;
const engineLog: string[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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
  toastEl.classList.remove('show');
  terminal.hidden = false;
  terminal.classList.toggle('centered', !!options.centered);
  terminal.classList.toggle('veil', !!options.veil);
  barState.textContent = options.state;
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
function toast(text: string, ms = 2600): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

const logList = el('ul', 'log');
let meterFill: HTMLElement | null = null;
let meterText: HTMLElement | null = null;

function logLine(text: string): void {
  const previous = logList.lastElementChild;
  if (previous && !previous.classList.contains('meter-line')) previous.classList.add('ok');
  logList.append(el('li', undefined, text));
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

/** Played with a keyboard and a mouse: a phone or tablet is told so before it starts. */
const fingerFirst = (): boolean => matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

async function toggleFullscreen(quiet = false): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
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
    // Where the browser allows it, Esc stays the demo's while in fullscreen.
    keyboard
      ?.lock?.(['Escape'])
      .then(() => (keyboardLocked = true))
      .catch(() => (keyboardLocked = false));
    if (!keyboard?.lock && phase === 'running') toast('ESC LEAVES FULLSCREEN HERE - USE THE ` KEY AS ESC', 5000);
  } else {
    keyboard?.unlock?.();
    keyboardLocked = false;
  }
});

function suspendEngine(): void {
  engine?.pause();
  for (const context of engine?.audioContexts() ?? []) void context.suspend().catch(() => undefined);
}

function resumeEngine(): void {
  for (const context of engine?.audioContexts() ?? []) void context.resume().catch(() => undefined);
  engine?.resume();
}

function begin(): void {
  if (phase !== 'gate' || !engine) return;
  phase = 'running';
  terminal.hidden = true;
  handle.hidden = false;
  if (settings.fullscreen) void toggleFullscreen(true);
  canvas.focus({ preventScroll: true });
  startedAt = performance.now();
  try {
    engine.start();
  } catch (err) {
    fatal(`The engine failed to start: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  toast("F1 THE DEMO'S KEYS   F9 CONSOLE MENU   F11 FULLSCREEN", 5000);
}

function openMenu(confirmExit = false): void {
  if (phase !== 'running' && phase !== 'menu') return;
  phase = 'menu';
  confirmingExit = confirmExit;
  suspendEngine();
  showTerminal({ centered: true, veil: true, state: 'SUSPENDED' });

  if (confirmExit) {
    body.replaceChildren(
      glyph(warningIcon, 'amber'),
      el('p', 'big amber', 'End simulation?'),
      el('p', 'gap', 'The tech demo keeps no saves: it starts afresh next time.'),
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
    ['CLICK', 'Walk; use, talk to or pick up what is under the pointer'],
    ['W A S D', 'Move the camera (SHIFT: faster)'],
    ['Q / E, WHEEL', 'Turn the camera, zoom'],
    ['I / K / J', 'Inventory, character, journal'],
    ['ENTER', 'End your turn in combat'],
    ['1 - 9', 'Answer in a conversation'],
    ['ESC', "The demo's options"],
    ['F1', 'All of the demo\'s keys'],
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
  terminal.hidden = true;
  canvas.focus({ preventScroll: true });
  if (!document.hidden) resumeEngine();
}

function leave(): void {
  phase = 'leaving';
  location.replace(CONSOLE_URL);
}

/** Whether the player has done anything since the demo began. The way out of it is through its own menu. */
let touched = false;
for (const type of ['keydown', 'pointerdown'] as const) {
  window.addEventListener(type, (event) => (touched ||= phase === 'running' && event.isTrusted), { capture: true, passive: true });
}

/** The engine stopped: through the demo's Exit Game that is how a session ends; anything else is a fault. */
function ended(status: number): void {
  if (status === 0 && touched) {
    leave();
    return;
  }
  const starting = !touched || (startedAt > 0 && performance.now() - startedAt < 20_000);
  fatal(
    touched ? `The tech demo stopped unexpectedly (status ${status}).` : 'The tech demo stopped by itself before it was up.',
    starting ? 'It stopped while starting, which points at its files. Load the tech demo again on its screen in the console.' : undefined,
  );
}

function fatal(message: string, advice?: string): void {
  if (phase === 'fatal' || phase === 'leaving') return;
  const wasRunning = phase === 'running' || phase === 'menu';
  phase = 'fatal';
  handle.hidden = true;
  fault = message;
  showTerminal({ centered: true, veil: wasRunning, state: 'FAULT' });
  const detail = el('p', 'gap dim');
  detail.textContent = engineLog.slice(-4).join('\n');
  detail.style.whiteSpace = 'pre-wrap';
  body.replaceChildren(
    glyph(faultIcon, 'alert'),
    el('p', 'big alert', 'System fault'),
    el('p', 'gap', fault),
    ...(advice ? [el('p', 'gap', advice)] : []),
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

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function sendEscape(type: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
}

/** Keys are seen here before the engine sees them. While the demo runs only the console's own are held back. */
function onKey(event: KeyboardEvent): void {
  if (!event.isTrusted) return;
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
      event.preventDefault();
      event.stopImmediatePropagation();
      sendEscape(event.type);
    } else if (event.code === 'F1' || event.code === 'Tab') {
      // The browser's own help, and focus leaving the picture.
      event.preventDefault();
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

window.addEventListener('beforeunload', (event) => {
  if (phase === 'running' || phase === 'menu') event.preventDefault();
});

window.addEventListener('error', (event) => {
  if (phase === 'running' || phase === 'menu') fatal(`The engine crashed: ${event.message}`);
});
window.addEventListener('unhandledrejection', (event) => {
  if (phase === 'running' || phase === 'menu') fatal(`The engine crashed: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`);
});

async function main(): Promise<void> {
  showTerminal({ state: 'BOOT' });
  body.replaceChildren(logList);
  setHints([['ESC', 'ABORT']]);
  logLine(`PROTOTYPE: ${DEMO.full.toUpperCase()} (${DEMO.year})`);
  // Held while this page lives, so that the console does not eject the files it plays from.
  void navigator.locks?.request(DEMO_LOCK, () => new Promise<void>(() => undefined)).catch(() => undefined);
  if (!document.createElement('canvas').getContext('webgl2')) {
    fatal('This browser cannot draw the tech demo: it has no WebGL 2.', 'Every current Chrome, Edge, Firefox and Safari has it. It can be switched off in the browser\'s settings, or missing where the graphics driver is blocked.');
    return;
  }
  try {
    engine = await bootDemo(canvas, settings.cacheMb, {
      status: logLine,
      progress: showProgress,
      log: (line) => {
        engineLog.push(line);
        if (engineLog.length > 200) engineLog.shift();
        console.log(`[engine] ${line}`);
      },
      exit: ended,
      fatal: (message) => fatal(message),
    });
  } catch (err) {
    if (err instanceof NoDemoError || err instanceof StorageUnavailableError) {
      location.replace(CONSOLE_URL);
      return;
    }
    fatal(err instanceof Error ? err.message : String(err));
    return;
  }
  if (phase !== 'boot') return;
  Object.assign(window, { overseerEngine: engine });
  phase = 'gate';
  showTerminal({ centered: true, state: 'READY' });
  const prompt = el('p', 'gap');
  prompt.append(fingerFirst() ? 'TAP TO BEGIN' : 'PRESS ANY KEY OR CLICK TO BEGIN', el('span', 'cursor'));
  body.replaceChildren(
    el('p', 'big', 'Prototype ready'),
    el('p', 'dim', `${DEMO.full} - ${DEMO.engine.name}`),
    ...(fingerFirst() ? [el('p', 'gap amber', 'THE TECH DEMO IS PLAYED WITH A KEYBOARD AND A MOUSE.')] : []),
    prompt,
  );
  if (fingerFirst()) body.append(actions([['Back to console', leave]]));
  setHints([
    ['ANY KEY', 'BEGIN'],
    ['ESC', 'BACK TO CONSOLE'],
    ['F9', 'CONSOLE MENU IN GAME'],
  ]);
  terminal.addEventListener('pointerup', (event) => {
    if (!(event.target instanceof Element && event.target.closest('button'))) begin();
  });
}

void main();
