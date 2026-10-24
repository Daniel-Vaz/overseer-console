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
import { QUICK_SAVE_SLOT } from '../lib/autosave';
import { setAddonOn } from '../lib/addons';
import { chooseScreen, wantsEngineData } from '../lib/engine/config';
import { bootEngine, NoInstallError, StorageUnavailableError, type Engine } from '../lib/engine/host';
import { gameDef, isGameId, type GameId } from '../lib/games';
import { syncMods } from '../lib/mods/sync';
import { issueUrl, keepPageErrors, rememberFault, reportFileName, reportText } from '../lib/report';
import { addonList, addonsMissing, addonsToSwitchOn, readSaveMeta, type SaveAddon } from '../lib/savemeta';
import { loadSettings, pictureOf, picturesFor, recordLaunch, saveSettings, type Picture } from '../lib/settings';
import { PICTURE_NAMES } from '../launcher/picture';
import { audioBridgeStats, installAudioBridge } from './audio-bridge';
import { Autosaver } from './autosave';
import { playerReport, whereOf } from './report';
import { TouchControls, fingerFirst } from './touch/controls';

keepPageErrors();

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
const fastEl = $('fast');

const settings = loadSettings();
if (settings.audio === 'buffered') installAudioBridge();
const query = new URLSearchParams(location.search);
const requested = query.get('game');
/** "Continue": the save slot to load as soon as the game is up. */
const loadSlot = /^[1-9]\d{0,3}$/.test(query.get('slot') ?? '') ? Number(query.get('slot')) : undefined;
/** The screen of the console the game was started from, to go back to. */
const from = query.get('from') ?? '';
/** The player was told the save is missing add-ons it was made with, and chose to play it as it is. */
const addonsAsIs = query.get('addons') === 'as-is';
/** The save asked for was checked against the add-ons on, and the player has heard what it found. */
let addonsChecked = addonsAsIs;
/** No game has been loaded from a save yet. */
let firstLoad = true;

/** This page again, for the same game: from a save, or (no slot) to its main menu. */
const playUrl = (game: GameId, slot?: number, asIs = false) => {
  const next = new URLSearchParams({ game });
  if (slot !== undefined) next.set('slot', String(slot));
  if (from) next.set('from', from);
  if (asIs) next.set('addons', 'as-is');
  return `${location.pathname}?${next.toString().replace(/%2F/g, '/')}`;
};
/**
 * The console, at the screen the game was started from, or (`own`) where the
 * game is, which says what it needs: its deck, or the mod's own page.
 */
const consoleUrl = (game?: GameId, own = false) => {
  const route = !own && /^[a-z0-9/-]{1,80}$/.test(from) ? from : !game ? '' : isGameId(game) && gameDef(game).mod ? `mods/${game}` : game;
  return `${import.meta.env.BASE_URL}${route ? `#/${route}` : ''}`;
};

/** Seen the touch controls explained once; they are not explained again unasked. */
const TOUCH_HELP_KEY = 'overseer-console:touch-help';

let phase: Phase = 'boot';
let engine: Engine | null = null;
/** Saves the game every so many minutes of play, once it has begun. */
let autosaver: Autosaver | null = null;
let startedAt = 0;
/** SDL starts with text input switched on; it is switched off once so that the games' own requests stand out. */
let textInputReset = false;
let keyboardLocked = false;
let hiddenPause = false;
/** Fast forward is on: the game's clock runs several times as fast as time. */
let fast = false;
let confirmingExit = false;
/** What the suspended screen shows: the menu itself, the touch help, the pictures or a problem report. */
let menuView: 'menu' | 'touch' | 'picture' | 'report' = 'menu';
/** What the fault screen said, for its report. */
let fault: { message: string; advice?: string } | null = null;
/** The keys of the screen on show while the game cannot have them (start-up, a report over a fault). */
let screenKeys: Record<string, () => void> | null = null;
/** The save last loaded was made with add-ons that are not on now. */
let missingAddons: { slot: number; addons: SaveAddon[] } | null = null;
/** A picture is to be changed once the game has been saved for it. */
let pictureWanted: Picture | null = null;
const engineLog: string[] = [];
/** What the engine last put in a message box, and when: its way of saying it cannot go on. */
let complaint: { text: string; at: number } | null = null;
/** Whether holding Shift lights up what lies on the ground in this game. */
let lights = false;
/** The touch deck's switch for that is on: it is lit up without a key being held. */
let lightsOn = false;
/**
 * When the engine last said it made a quick save, and when the quick save's
 * slot last reached the browser's storage. The engines wait for the storage
 * before they report, but either may be heard of first.
 */
let quickMadeAt = -Infinity;
let quickStoredAt = -Infinity;
const QUICK_PAIRING_MS = 3000;
const QUICK_SLOT_NAME = String(QUICK_SAVE_SLOT).padStart(2, '0');

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
  // A notice that was up over the game has no business showing through what now covers it.
  toastEl.classList.remove('show');
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
    playerTurn: () => engine?.playerTurn(),
    scrollListAt: (x, y) => engine?.scrollListAt(x, y),
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
    toggleFast: () => setFast(!fast),
    toggleLights: () => setLights(!lightsOn),
    say: (text) => toast(text, 3000),
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

/**
 * Fast forward: everything in the game happens several times as quickly, for
 * the long walk across a map and the turns of a dozen rats. Sound keeps its
 * own pace, so speech and movies are better watched without it.
 */
function setFast(on: boolean): void {
  if (!engine || (phase !== 'running' && phase !== 'menu')) return;
  fast = on;
  engine.setSpeed(on ? settings.fastForward : 1);
  fastEl.textContent = `FAST FORWARD x${settings.fastForward}`;
  fastEl.hidden = !on;
  touch.setFast(on);
}

/**
 * What lies on the ground lit up, for as long as the switch is on: on a touch
 * screen there is no key to hold for it. Only the game's script for it sees
 * the key held, so nothing else typed is shifted.
 */
function setLights(on: boolean): void {
  if (!engine || !lights || (phase !== 'running' && phase !== 'menu')) return;
  lightsOn = on;
  engine.setLights(on);
  touch.setLights(on);
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
  autosaver = new Autosaver(engine.game, engine, { minutes: settings.autosave, maps: settings.autosaveMaps }, {
    playing: () => phase === 'running' && !document.hidden,
    say: (text, bad) => toast(text, 6000, bad),
  });
  if (!touch.visible) toast('F8 FAST FORWARD   F9 CONSOLE MENU   F11 FULLSCREEN', 4500);
  else if (!touchHelpSeen()) openTouchHelp();
}

/** Explains the touch controls. Shown by itself once, and from the menu. */
function openTouchHelp(): void {
  if (phase !== 'running' && phase !== 'menu') return;
  phase = 'menu';
  menuView = 'touch';
  screenKeys = null;
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
    ['Drag', trackpad ? 'Move the pointer. Nothing is clicked' : 'Move the pointer, or scroll a list'],
    ['Hold', 'Keep the button pressed: action menus, dragging items'],
    ['2 fingers', 'Drag to scroll. Tap to switch the cursor'],
    ['CLICK', 'Clicks where the pointer is: drag to aim, then press it'],
    ['CURSOR', 'Switches the cursor between walking and using'],
    ['INV, MAP...', 'The small buttons: inventory, map, character, Pip-Boy, skilldex'],
    ['TURN', 'Ends your turn in a fight. Dim when it is not your turn'],
    ['MODE', 'Next attack mode of the weapon in hand'],
    ['QSAVE, QLOAD', `Quick save and quick load, slot ${QUICK_SLOT_NAME}. QLOAD asks twice`],
    ...(lights ? ([['HILITE', 'Highlights what lies on the ground until pressed again']] as const) : []),
    ['FAST', 'Fast forward, on and off'],
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
  screenKeys = null;
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
    ['F6 / F7', `Quick save / quick load, always in slot ${QUICK_SLOT_NAME}`],
    ['ESC', 'Game options'],
    ...(lights ? ([['SHIFT', 'Hold to light up what lies on the ground']] as const) : []),
    ['F8', `Fast forward, on and off (${settings.fastForward} times the speed)`],
    ['F9', 'This menu'],
    ['F11', 'Fullscreen'],
  ] as const) {
    keys.append(el('dt', undefined, key), el('dd', undefined, label));
  }
  keys.style.textAlign = 'left';

  const game = engine?.game;
  const switchable = game && missingAddons ? addonsToSwitchOn(missingAddons.addons, game) : [];
  body.replaceChildren(
    glyph(suspendedIcon),
    el('p', 'big', 'Simulation suspended'),
    actions([
      ['[R] Resume', closeMenu],
      [document.fullscreenElement ? '[F] Leave fullscreen' : '[F] Fullscreen', () => void toggleFullscreen().then(() => openMenu())],
      ['[X] Exit to console', () => openMenu(true)],
    ]),
    actions([
      [`[V] Picture: ${game ? PICTURE_NAMES[pictureWanted ?? pictureOf(settings, game)] : '-'}${pictureWanted ? ' (SOON)' : ''}`, openPictures],
      ['[D] Report a problem', () => void openReport()],
    ]),
    // The save last loaded was made with add-ons that are not on.
    ...(missingAddons
      ? [
          el(
            'p',
            'gap amber',
            `The save from slot ${String(missingAddons.slot).padStart(2, '0')} was made with ${addonList(missingAddons.addons)} on. ` +
              (switchable.length
                ? `Without ${missingAddons.addons.length > 1 ? 'them, what they' : 'it, what it'} added can be missing or break.`
                : `${missingAddons.addons.length > 1 ? 'They are' : 'It is'} no longer loaded in this browser.`),
          ),
          ...(switchable.length ? [actions([[`[A] Restart from that save with ${switchable.length > 1 ? 'them' : 'it'} on`, restartWithAddons]])] : []),
        ]
      : []),
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

// ---------------------------------------------------------------------
// Another picture, while the game runs
// ---------------------------------------------------------------------

/** The room the picture has on the page now, which the touch deck may have narrowed. */
const room = () => ({ width: stage.clientWidth || window.innerWidth, height: stage.clientHeight || window.innerHeight });

/**
 * The pictures a game can be played at, each with the size it would have in
 * this window. The engines draw at one size from start to end, so another
 * picture (or the same one, reshaped for a window that has changed shape:
 * a phone turned) means saving the game and starting it again from that
 * save, which takes a few seconds.
 */
function openPictures(): void {
  if (!engine || phase !== 'menu') return;
  menuView = 'picture';
  const { game, screen: now } = engine;
  const current = pictureOf(settings, game);
  const inGame = engine.inGame();
  const choices = picturesFor(game).map((picture, index): [string, () => void] => {
    const size = chooseScreen(picture, room());
    const inUse = picture === current;
    const same = inUse && size.width === now.width && size.height === now.height;
    const tag = !inUse ? '' : same ? '  (IN USE)' : `  (IN USE AT ${now.width} x ${now.height})`;
    return [`[${index + 1}] ${PICTURE_NAMES[picture]}  ${size.width} x ${size.height}${tag}`, () => void choosePicture(picture, same)];
  });
  const list = actions(choices);
  list.classList.add('stacked');
  body.replaceChildren(
    el('p', 'big', 'Picture'),
    el(
      'p',
      'gap',
      inGame
        ? 'The game is saved in slot 08, 09 or 10 at the first moment it can be, and carries on from that save in the new picture.'
        : 'The game starts again at its main menu in the new picture.',
    ),
    list,
    actions([['[B] Back', () => openMenu()]]),
  );
  screenKeys = Object.fromEntries([...choices.map(([, choose], index) => [String(index + 1), choose] as const), ['b', () => openMenu()]]);
  setHints([
    ['1-' + choices.length, 'CHOOSE'],
    ['B', 'BACK'],
  ]);
}

/** When each slot last reached the browser's storage, and who waits for one to. */
const storedAt = new Map<number, number>();
const storeWaiters = new Set<() => void>();

/** Whether `slot` reached the storage since `since` (performance.now()), waiting up to `ms` for it. */
function whenStored(slot: number, since: number, ms: number): Promise<boolean> {
  const done = () => (storedAt.get(slot) ?? -Infinity) >= since;
  if (done()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (stored: boolean) => {
      clearTimeout(timer);
      storeWaiters.delete(check);
      resolve(stored);
    };
    const check = () => done() && finish(true);
    const timer = window.setTimeout(() => finish(false), ms);
    storeWaiters.add(check);
  });
}

/** The picture a game is played at from its next start on. */
function keepPicture(game: GameId, picture: Picture): void {
  settings.picture = { ...settings.picture, [game]: picture };
  saveSettings(settings);
}

async function choosePicture(picture: Picture, same: boolean): Promise<void> {
  if (!engine) return;
  const game = engine.game;
  if (same) {
    // The one in use, while another waited for its save: that one is called off.
    if (pictureWanted) toast(`${PICTURE_NAMES[picture]} STAYS`);
    pictureWanted = null;
    openMenu();
    return;
  }
  if (!engine.inGame() || !autosaver) {
    keepPicture(game, picture);
    phase = 'leaving';
    location.replace(playUrl(game));
    return;
  }
  const waiting = pictureWanted !== null;
  pictureWanted = picture;
  closeMenu();
  toast(`${PICTURE_NAMES[picture]} AS SOON AS THE GAME CAN BE SAVED`, 4000);
  // Asked again while the first was waiting for its save: that save now carries this picture.
  if (waiting) return;
  const since = performance.now();
  const slot = await autosaver.saveForRestart();
  const wanted = pictureWanted as Picture | null;
  pictureWanted = null;
  if (!wanted) return;
  if (slot === 'full') {
    keepPicture(game, wanted);
    toast(`SLOTS 08 TO 10 HOLD YOUR OWN SAVES. ${PICTURE_NAMES[wanted]} FROM THE NEXT START`, 8000, true);
    return;
  }
  if (slot === 'failed' || !(await whenStored(slot, since, 10_000))) {
    toast('THE PICTURE WAS NOT CHANGED: THE GAME COULD NOT BE SAVED', 8000, true);
    return;
  }
  keepPicture(game, wanted);
  phase = 'leaving';
  location.replace(playUrl(game, slot, addonsChecked));
}

/** Starts again from the save just loaded, with the add-ons it was made with switched on. */
function restartWithAddons(): void {
  const game = engine?.game;
  if (!game || !missingAddons) return;
  const switchable = addonsToSwitchOn(missingAddons.addons, game);
  if (!switchable.length) return;
  for (const addon of switchable) setAddonOn(game, addon.id, true);
  phase = 'leaving';
  location.replace(playUrl(game, missingAddons.slot));
}

function leave(): void {
  phase = 'leaving';
  location.replace(consoleUrl(engine?.game ?? (isGameId(requested) ? requested : undefined)));
}

/**
 * The engines report what they cannot recover from in a message box, and
 * then stop. In a browser that box is the page's own alert: it stands in
 * front of the game in the browser's dress, and once it is dismissed nothing
 * is left of what it said. It is not shown. What the engine said is kept,
 * and the fault screen says it if the engine does stop (see `ended`).
 */
window.alert = (message?: unknown): void => {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  complaint = { text, at: performance.now() };
  console.warn(`[engine] ${text}`);
  // Should the game carry on regardless, the player has still been told.
  if (phase === 'running') toast(text, 8000, true);
};

/**
 * Whether the player has done anything since the game began: pressed a key,
 * a button of the mouse, or the screen. The way out of a game is through its
 * menus, so an engine that stops before then was not asked to.
 */
let touched = false;
for (const type of ['keydown', 'pointerdown', 'touchstart'] as const) {
  window.addEventListener(type, (event) => (touched ||= phase === 'running' && event.isTrusted), { capture: true, passive: true });
}

/**
 * The engine has stopped. Leaving through a game's own menu is how a session
 * ends: that goes back to the console. An engine that stops after
 * complaining, with anything but a clean status, or before the player has
 * touched the game at all has failed, and going back without a word would
 * leave the player on a deck with no idea why.
 *
 * (The status alone does not say: what an engine returns from its `main`
 * after it has once handed the thread back to the browser is lost, and that
 * is how both of them report a start-up that failed.)
 */
function ended(status: number): void {
  // An engine that cannot go on says so and stops at once. What it said about something it got over, an hour ago, is not why it stops now.
  const said = complaint && performance.now() - complaint.at < 10_000 ? complaint.text : null;
  if (status === 0 && !said && touched) {
    leave();
    return;
  }
  const title = engine ? gameDef(engine.game).title : 'The game';
  // An engine that gives up within moments of its start has found fault with what it was given to run.
  const starting = !touched || (startedAt > 0 && performance.now() - startedAt < 20_000);
  fatal(
    said
      ? `${title} stopped. The engine reports: ${said}`
      : touched
        ? `${title} stopped unexpectedly (status ${status}).`
        : `${title} stopped by itself before it was up.`,
    starting
      ? engine && gameDef(engine.game).mod
        ? 'It stopped while starting, which points at the mod\'s files. Load its holodisk again from the mod as it is downloaded, or from the newest version of it.'
        : 'It stopped while starting, which points at the game data. Load the holodisk again from the complete game folder.'
      : undefined,
  );
}

function fatal(message: string, advice?: string): void {
  if (phase === 'fatal' || phase === 'leaving') return;
  const wasRunning = phase === 'running' || phase === 'menu';
  phase = 'fatal';
  handle.hidden = true;
  fault = { message, advice };
  const game = engine?.game ?? (isGameId(requested) ? requested : null);
  rememberFault({ at: Date.now(), where: whereOf(game), game: game ?? '', message, advice, log: engineLog });
  showFault(wasRunning);
}

/** The fault screen: what went wrong, what to do, and the way to report it. */
function showFault(wasRunning = terminal.classList.contains('veil')): void {
  if (!fault) return;
  screenKeys = null;
  showTerminal({ centered: true, veil: wasRunning, state: 'FAULT' });
  const detail = el('p', 'gap dim');
  detail.textContent = engineLog.slice(-4).join('\n');
  detail.style.whiteSpace = 'pre-wrap';
  body.replaceChildren(
    glyph(faultIcon, 'alert'),
    el('p', 'big alert', 'System fault'),
    el('p', 'gap', fault.message),
    ...(fault.advice ? [el('p', 'gap', fault.advice)] : []),
    el('p', 'gap dim', wasRunning ? 'Games you saved before this point are safe.' : ''),
    actions([
      ['[R] Restart', () => location.reload()],
      ['[C] Return to console', leave],
      ['[D] Report it', () => void openReport()],
    ]),
    detail,
  );
  setHints([
    ['R', 'RESTART'],
    ['C', 'CONSOLE'],
    ['D', 'REPORT'],
  ]);
}

// ---------------------------------------------------------------------
// Problem reports
// ---------------------------------------------------------------------

/**
 * Everything the page knows that could help find what went wrong, written
 * up as a report to file on GitHub. Nothing is sent: the player opens the
 * issue, copies the report or saves it, and sees all of it first.
 */
async function openReport(): Promise<void> {
  const overFault = phase === 'fatal';
  if (!overFault) {
    if (phase !== 'running' && phase !== 'menu') return;
    if (phase === 'running') suspendEngine();
    phase = 'menu';
    menuView = 'report';
    showTerminal({ centered: true, veil: true, state: 'SUSPENDED' });
  }
  const back = overFault ? () => showFault() : () => openMenu();
  screenKeys = { b: back };
  body.replaceChildren(el('p', 'big', 'Problem report'), el('p', 'gap dim', 'GATHERING READINGS...'));
  setHints([['B', 'BACK']]);
  const report = await playerReport({
    game: engine?.game ?? (isGameId(requested) ? requested : null),
    engine,
    settings,
    phase: overFault ? 'fault screen' : 'suspended',
    playedMs: startedAt ? performance.now() - startedAt : 0,
    fast,
    lights: lightsOn,
    touch: touch.visible,
    loadSlot,
    audio: audioBridgeStats(),
    engineLog,
    complaint: complaint?.text,
    fault: fault ?? undefined,
  });
  // Gone on to something else while it was being gathered.
  if (screenKeys?.b !== back) return;

  const readout = el('div', 'report');
  for (const section of report.sections) {
    readout.append(el('p', 'hot', section.title.toUpperCase()));
    const rows = el('dl', 'readout');
    for (const [name, value] of section.rows) rows.append(el('dt', undefined, name), el('dd', undefined, value));
    readout.append(rows);
  }
  for (const block of report.blocks) {
    if (!block.lines.length) continue;
    readout.append(el('p', 'hot', `${block.title.toUpperCase()} (LAST ${Math.min(12, block.lines.length)} OF ${block.lines.length} LINES)`));
    readout.append(el('pre', 'dim', block.lines.slice(-12).join('\n')));
  }
  const status = el('p', 'gap dim report-status', '');
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('alert', bad);
  };

  const copy = async (quiet = false): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(reportText(report));
      if (!quiet) say('COPIED. PASTE IT INTO AN ISSUE, AN EMAIL OR A FORUM POST.');
      return true;
    } catch {
      if (!quiet) say('THE BROWSER WOULD NOT LET THE PAGE COPY. SAVE IT AS A FILE INSTEAD.', true);
      return false;
    }
  };
  const open = async () => {
    const { url, cut } = issueUrl(report);
    const copied = cut ? await copy(true) : false;
    // Asked for without "noopener", which would leave no way to tell a tab opened from one kept from opening.
    const opened = window.open(url, '_blank');
    if (opened) opened.opener = null;
    say(
      !opened && !cut
        ? 'THE BROWSER KEPT THE NEW TAB FROM OPENING. COPY THE REPORT, OR SAVE IT.'
        : cut
          ? copied
            ? 'THE LOGS WERE SHORTENED TO FIT THE LINK. THE WHOLE REPORT IS COPIED: PASTE IT IN IF YOU CAN.'
            : 'THE LOGS WERE SHORTENED TO FIT THE LINK. SAVE THE REPORT AND ATTACH IT FOR THE REST.'
          : 'OPENED ON GITHUB IN A NEW TAB. LOOK IT OVER, SAY WHAT HAPPENED, AND SUBMIT IT THERE.',
      !opened,
    );
  };
  const save = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([reportText(report)], { type: 'text/markdown' }));
    link.download = reportFileName(report);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    say(`SAVED AS ${link.download.toUpperCase()}.`);
  };

  body.replaceChildren(
    el('p', 'big', 'Problem report'),
    el('p', 'gap report-intro', 'Nothing leaves this page unless you send it. Open it as a new issue on GitHub to look it over and post it, or copy or save it to send another way.'),
    readout,
    actions([
      ['[O] Open on GitHub', () => void open()],
      ['[C] Copy', () => void copy()],
      ['[S] Save as file', save],
      ['[B] Back', back],
    ]),
    status,
  );
  screenKeys = { o: () => void open(), c: () => void copy(), s: save, b: back };
  setHints([
    ['O', 'GITHUB'],
    ['C', 'COPY'],
    ['S', 'SAVE'],
    ['B', 'BACK'],
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
    if (event.code === 'F8' || event.code === 'F9' || event.code === 'F11') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (down && !event.repeat) {
        if (event.code === 'F8') setFast(!fast);
        else if (event.code === 'F9') openMenu();
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
    if (screenKeys?.[key]) screenKeys[key]();
    else if (key === 'escape') leave();
  } else if (phase === 'gate') {
    if (['shift', 'control', 'alt', 'meta'].includes(key)) return;
    event.preventDefault();
    if (key === 'escape') leave();
    else begin();
  } else if (phase === 'menu') {
    event.preventDefault();
    if (menuView === 'picture' || menuView === 'report') {
      // Their own keys; ESC goes back to the menu, not into the game.
      if (screenKeys?.[key]) screenKeys[key]();
      else if (key === 'escape') openMenu();
    } else if (confirmingExit) {
      if (key === 'y') leave();
      else if (key === 'n' || key === 'escape') openMenu();
    } else if (key === 'r' || key === 'escape' || key === 'f9' || key === 'enter') closeMenu();
    else if (menuView === 'touch') return;
    else if (key === 'f' || key === 'f11') void toggleFullscreen().then(() => openMenu());
    else if (key === 'x') openMenu(true);
    else if (key === 't' && touch.visible) openTouchHelp();
    else if (key === 'p' && touch.visible) togglePointerMode();
    else if (key === 'v') openPictures();
    else if (key === 'd') void openReport();
    else if (key === 'a' && missingAddons) restartWithAddons();
  } else if (phase === 'fatal') {
    // The report over the fault screen has keys of its own.
    if (screenKeys) {
      if (screenKeys[key]) screenKeys[key]();
      else if (key === 'escape') showFault();
    } else if (key === 'r') location.reload();
    else if (key === 'c' || key === 'escape') leave();
    else if (key === 'd') void openReport();
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

// ---------------------------------------------------------------------
// Saves and the add-ons they were made with
// ---------------------------------------------------------------------

const slotName = (slot: number) => String(slot).padStart(2, '0');

/**
 * A game was loaded from a save. A save made with add-ons that are not on
 * now can miss what they added, or break on it: the player hears of it, and
 * the menu offers to start again from it with them on.
 */
async function checkLoaded(slot: number): Promise<void> {
  const game = engine?.game;
  if (!game) return;
  // The save the page was asked to start from was checked before the game started.
  const checked = firstLoad && slot === loadSlot && addonsChecked;
  firstLoad = false;
  const missing = addonsMissing(await readSaveMeta(game, slot), game);
  missingAddons = missing.length ? { slot, addons: missing } : null;
  if (!missing.length || checked) return;
  const names = addonList(missing).toUpperCase();
  toast(
    addonsToSwitchOn(missing, game).length
      ? `SAVE ${slotName(slot)} WAS MADE WITH ${names} ON. ${touch.visible ? 'MENU' : 'F9'} TO START IT AGAIN WITH ${missing.length > 1 ? 'THEM' : 'IT'}.`
      : `SAVE ${slotName(slot)} WAS MADE WITH ${names}, NO LONGER LOADED IN THIS BROWSER.`,
    9000,
    true,
  );
}

/**
 * Before a game starts from a save, the save is checked against the add-ons
 * that will be laid over it. True to go on (with them switched on, or as it
 * is); the player may also go back to the console instead.
 */
function askAboutAddons(game: GameId, slot: number, missing: SaveAddon[]): Promise<boolean> {
  const switchable = addonsToSwitchOn(missing, game);
  const them = missing.length > 1 ? 'them' : 'it';
  return new Promise((resolve) => {
    const go = (switchOn: boolean) => {
      screenKeys = null;
      if (switchOn) for (const addon of switchable) setAddonOn(game, addon.id, true);
      addonsChecked = true;
      showTerminal({ state: 'BOOT' });
      logList.replaceChildren();
      body.replaceChildren(logList);
      setHints([['ESC', 'ABORT']]);
      resolve(true);
    };
    showTerminal({ centered: true, state: 'CHECK' });
    body.replaceChildren(
      glyph(warningIcon, 'amber'),
      el('p', 'big amber', 'Add-ons missing'),
      el('p', 'gap', `The save in slot ${slotName(slot)} was made with ${addonList(missing)} on, and ${missing.length > 1 ? 'they are' : 'it is'} off now.`),
      el(
        'p',
        'gap',
        switchable.length === missing.length
          ? `Without ${them}, what ${them === 'it' ? 'it' : 'they'} added to the game can be missing from it, or break.`
          : `${addonList(missing.filter((addon) => !switchable.includes(addon)))} is no longer loaded in this browser: load it again from its files to play this save as it was made.`,
      ),
      actions([
        ...(switchable.length ? ([[`[A] Switch ${switchable.length < missing.length ? addonList(switchable) : them} on and play`, () => go(true)]] as [string, () => void][]) : []),
        ['[P] Play without', () => go(false)],
        ['[ESC] Back to console', leave],
      ]),
    );
    screenKeys = { ...(switchable.length ? { a: () => go(true) } : {}), p: () => go(false) };
    setHints([
      ...(switchable.length ? ([['A', 'SWITCH ON']] as [string, string][]) : []),
      ['P', 'PLAY WITHOUT'],
      ['ESC', 'BACK'],
    ]);
  });
}

async function main(): Promise<void> {
  // A mod this browser forgot it has (its settings were cleared) is found again from its files.
  if (requested && !isGameId(requested)) await syncMods().catch(() => false);
  if (!isGameId(requested)) {
    location.replace(consoleUrl());
    return;
  }
  const game = requested;
  const def = gameDef(game);
  // Lighting up what lies on the ground comes with the engine's additions, where a game has them.
  lights = wantsEngineData(game, settings.improvements);
  touch.offer('lights', lights);
  document.title = `${def.title} - Overseer Console`;
  barTitle.textContent = def.mod ? `OVERSEER CONSOLE // ${def.label} // ${def.short}` : `OVERSEER CONSOLE // ${def.label}`;
  showTerminal({ state: 'BOOT' });
  body.replaceChildren(logList);
  setHints([['ESC', 'ABORT']]);

  logLine(`${def.label}: ${def.title.toUpperCase()}${def.year ? ` (${def.year})` : ''}`);
  if (!(await claimGame(game))) {
    fatal(`${def.title} is already running in another tab or window. Close it there first.`);
    return;
  }

  if (loadSlot !== undefined && !addonsChecked) {
    const missing = addonsMissing(await readSaveMeta(game, loadSlot), game);
    if (missing.length) {
      await askAboutAddons(game, loadSlot, missing);
      logLine(`${def.label}: ${def.title.toUpperCase()}${def.year ? ` (${def.year})` : ''}`);
    }
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
        saved: (files, slots) => {
          const now = performance.now();
          for (const slot of slots) storedAt.set(slot, now);
          for (const check of [...storeWaiters]) check();
          if (slots.includes(QUICK_SAVE_SLOT)) quickStoredAt = now;
          if (autosaver?.saved(slots)) toast(`AUTOSAVED IN SLOT ${String(slots[0]).padStart(2, '0')}`);
          else if (slots.includes(QUICK_SAVE_SLOT) && now - quickMadeAt < QUICK_PAIRING_MS) toast(`QUICK SAVED IN SLOT ${QUICK_SLOT_NAME}`);
          else if (files > 1) toast('SAVED TO BROWSER STORAGE');
        },
        quick: (kind, outcome) => {
          if (kind === 'save') {
            // Said once the save is both made and in the browser's storage, whichever is heard of first.
            const now = performance.now();
            if (outcome === 'done') {
              quickMadeAt = now;
              if (now - quickStoredAt < QUICK_PAIRING_MS) toast(`QUICK SAVED IN SLOT ${QUICK_SLOT_NAME}`);
            } else {
              toast(`QUICK SAVE FAILED. NOTHING WAS WRITTEN TO SLOT ${QUICK_SLOT_NAME}.`, 8000, true);
            }
          } else if (outcome === 'empty') {
            toast(`NO QUICK SAVE IN SLOT ${QUICK_SLOT_NAME} YET. ${touch.visible ? 'QSAVE' : 'F6'} MAKES ONE.`, 5000);
          } else if (outcome === 'failed') {
            toast(`THE QUICK SAVE IN SLOT ${QUICK_SLOT_NAME} COULD NOT BE LOADED.`, 8000, true);
          } else {
            toast(`QUICK LOADED FROM SLOT ${QUICK_SLOT_NAME}`);
          }
        },
        arrived: () => autosaver?.arrived(),
        loaded: (slot) => void checkLoaded(slot),
        storageFailed: (reason) => toast(`NOT STORED: ${reason.toUpperCase()}. THIS SAVE WILL BE LOST WHEN YOU LEAVE.`, 20_000, true),
        exit: ended,
        fatal: (message) => fatal(message),
      },
      { loadSlot },
    );
  } catch (err) {
    // Nothing to play here; the console explains why and what to do.
    if (err instanceof NoInstallError || err instanceof StorageUnavailableError) {
      location.replace(consoleUrl(game, true));
      return;
    }
    fatal(err instanceof Error ? err.message : String(err));
    return;
  }

  if (phase !== 'boot') return;
  // A mod of Fallout may light things up of its own, through its sfall settings (Fallout Fixt).
  if (engine.lightsOfItsOwn && !lights) {
    lights = true;
    touch.offer('lights', true);
  }
  // For diagnostics from the browser console: overseerEngine.module.overseer.stats(), overseerEngine.reads(), overseerAudio(), overseerAutosave()
  Object.assign(window, { overseerEngine: engine, overseerAudio: audioBridgeStats, overseerAutosave: () => autosaver?.now() });
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
      ['F8', 'FAST FORWARD IN GAME'],
      ['F9', 'CONSOLE MENU IN GAME'],
    ]);
  }
  terminal.addEventListener('pointerup', (event) => {
    // A button on the gate does its own thing.
    if (!(event.target instanceof Element && event.target.closest('button'))) begin();
  });
}

void main();
