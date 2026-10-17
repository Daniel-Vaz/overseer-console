/**
 * Starts an engine against the installed game data.
 *
 * Nothing here copies the game into memory: large files are handed to the
 * engine as lazy files backed by the browser's private file system, small
 * ones come from a single packed read, and whatever the engine wrote before
 * (saves, settings) is layered on top from the overlay.
 */
import { gameDef, type EngineId, type GameId } from '../games';
import { isSaveData, slotOf } from '../savefile';
import { pictureOf, type Settings } from '../settings';
import { pathKey } from '../storage/manifest';
import { mountGame, type Mounted, type MountedFile } from '../storage/mount';
import { StorageUnavailableError, loadInstall, openBlob, openInstalled, type Install, type SourceBlob } from '../storage/opfs';

export { StorageUnavailableError };
import { commitWithHistory } from '../storage/history';
import { listOverlay, type OverlayEntry } from '../storage/overlay';
import { HIGHLIGHT_KEY, HIGHLIGHTING_FILE, buildConfigFiles, chooseScreen, settingsFileOf, wantsEngineData, type ScreenSize } from './config';
import type { EngineFactory, EngineInfo, EngineModule, PersistBatch, QuickKind, QuickOutcome, ScreenRect } from './types';

const GAME_ROOT = '/game';

/** Folders the engines expect to find, whether or not the install had them. */
const REQUIRED_DIRS = ['data/SAVEGAME', 'data/MAPS', 'data/proto/items', 'data/proto/critters'];

export class NoInstallError extends Error {
  override name = 'NoInstallError';
}

/** What a game is started from: its own install, and that of the game it is played on when it is a mod. */
export interface Installed {
  install: Install;
  base?: Install;
}

/** Looks up what `game` needs to start. Throws NoInstallError naming what is not in this browser. */
export async function loadInstalled(game: GameId): Promise<Installed> {
  const def = gameDef(game);
  if (!def) throw new NoInstallError('That game is not known in this browser.');
  const install = await loadInstall(game);
  if (!install) throw new NoInstallError(`${def.title} has not been imported in this browser.`);
  if (!def.mod) return { install };
  const base = await loadInstall(def.mod.base);
  if (!base) throw new NoInstallError(`${def.title} is played on ${gameDef(def.mod.base).title}, which has not been imported in this browser.`);
  return { install, base };
}

/** A file of the folder a game is started in, wherever it is stored. Null when the folder holds no such file. */
export async function openMounted({ install, base }: Installed, mounted: Mounted, path: string): Promise<SourceBlob | null> {
  const found = mounted.files.get(pathKey(path));
  if (!found) return null;
  const from = found.from === 'own' ? install : base;
  return from ? openInstalled(from, found.file.path) : null;
}

export interface BootHooks {
  /** A step of the start-up sequence, for the boot log. */
  status(line: string): void;
  /** Download progress of the engine binary. */
  progress(done: number, total: number): void;
  /** A line the engine printed. */
  log(line: string): void;
  /** The engine finished storing a batch of changes: a save (`slots` names it), settings. */
  saved(files: number, slots: number[]): void;
  /** Changes could not be written to browser storage. The player must be told. */
  storageFailed(reason: string): void;
  /** A quick save or quick load (F6, F7: slot 7 alone) was made, found nothing to load, or failed. */
  quick(kind: QuickKind, outcome: QuickOutcome): void;
  exit(code: number): void;
  fatal(message: string): void;
}

export interface BootOptions {
  /** Load the save in this slot (1-based) instead of stopping at the game's main menu. */
  loadSlot?: number;
}

export interface Engine {
  game: GameId;
  module: EngineModule;
  info: EngineInfo;
  screen: ScreenSize;
  /** Hands control to the game. Returns immediately; the game keeps running. */
  start(): void;
  pause(): void;
  resume(): void;
  /** Fast forward: how many times as fast as the original the game runs. 1 is the original's pace. */
  setSpeed(speed: number): void;
  /** Whether a game is in progress: not its menus or movies. */
  inGame(): boolean;
  /** Whether it is the player's turn in combat: the one time ending a turn does anything. */
  playerTurn(): boolean;
  /** The list at (x, y) on the game's screen that a finger swiping over should scroll, or null. */
  scrollListAt(x: number, y: number): ScreenRect | null;
  /** A save in `slot` at the next moment the game can make one; slot 0 calls it off. True once made. */
  requestSave(slot: number): Promise<boolean>;
  /** Lights up what lies on the ground, as holding the key for it does, until switched off. */
  setLights(on: boolean): void;
  audioContext(): AudioContext | undefined;
  /** The large files the engine has read from so far, by the path it reads them at. */
  reads(): Record<string, FileReads>;
}

/** How much the engine has read of one large file, and whose install it is from (see MountedFile). */
export interface FileReads {
  from: MountedFile['from'];
  reads: number;
  bytes: number;
}

function engineBase(engine: EngineId): string {
  return `${import.meta.env.BASE_URL}engines/${engine}/`;
}

async function fetchEngineInfo(engine: EngineId): Promise<EngineInfo> {
  const response = await fetch(`${engineBase(engine)}engine.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`engine description not found (HTTP ${response.status})`);
  return (await response.json()) as EngineInfo;
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`could not load ${url}`));
    document.head.appendChild(script);
  });
}

/** Fetches the data file that goes with an engine build: small, and the same for every game the engine runs. */
async function fetchEngineData(url: string, name: string): Promise<{ name: string; data: Uint8Array }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`engine data download failed (HTTP ${response.status})`);
  return { name, data: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * Downloads the engine binary, reporting progress.
 *
 * The bytes are handed to the runtime as `wasmBinary`. Emscripten's
 * `instantiateWasm` hook would allow compiling while downloading, but in the
 * pinned Emscripten release that hook returns the uninstrumented exports and
 * silently breaks Asyncify.
 */
async function downloadEngine(
  url: string,
  totalBytes: number,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`engine download failed (HTTP ${response.status})`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(Math.min(loaded, totalBytes), totalBytes);
  }
  const binary = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return binary;
}

/** Puts stored files where the engine will look for them: each at the path it is mounted at. */
async function place(module: EngineModule, install: Install, files: MountedFile[], reads: Map<string, FileReads>): Promise<void> {
  const ov = module.overseer;
  const { manifest } = install;

  // Small files: one read for all of them, unless only a small part of them is asked for.
  const packed = files.filter(({ file }) => file.pack);
  if (packed.length) {
    const pack = await openBlob(install, 'pack.bin');
    const asked = packed.reduce((sum, { file }) => sum + file.pack![1], 0);
    const whole = asked * 4 < pack.size ? null : new Uint8Array(await pack.arrayBuffer());
    for (const { path, file } of packed) {
      const [offset, length] = file.pack!;
      const data = whole ? whole.subarray(offset, offset + length) : new Uint8Array(await pack.slice(offset, offset + length).arrayBuffer());
      ov.writeFile(`${GAME_ROOT}/${path}`, data, manifest.importedAt);
    }
  }

  // Large files: opened, not read.
  const large = files.filter(({ file }) => file.blob);
  const handles = await Promise.all(large.map(({ file }) => openBlob(install, file.blob!)));
  large.forEach(({ path, file, from }, i) => {
    const blob = handles[i]!;
    if (blob.size !== file.size) {
      throw new Error(`${file.path} is damaged in browser storage (${blob.size} of ${file.size} bytes). Import the game again.`);
    }
    ov.addLazyFile(`${GAME_ROOT}/${path}`, file.size, (offset, length) => {
      const read = reads.get(path) ?? { from, reads: 0, bytes: 0 };
      read.reads++;
      read.bytes += length;
      reads.set(path, read);
      return blob.slice(offset, offset + length).arrayBuffer().then((buffer) => new Uint8Array(buffer));
    });
  });
}

async function populate(
  module: EngineModule,
  game: GameId,
  { install, base }: Installed,
  mounted: Mounted,
  overlay: OverlayEntry[],
  configFiles: Record<string, string>,
  engineData: { name: string; data: Uint8Array } | null,
  reads: Map<string, FileReads>,
): Promise<void> {
  const ov = module.overseer;
  const changed = new Map(overlay.map((entry) => [entry.key, entry]));
  const generated = new Set(Object.keys(configFiles).map(pathKey));

  for (const dir of [...mounted.dirs, ...REQUIRED_DIRS]) ov.mkdir(`${GAME_ROOT}/${dir}`);
  // What the game wrote itself, and the settings made for this start, take the place of what came with it.
  const shown = [...mounted.files.entries()].filter(([key]) => !changed.has(key) && !generated.has(key)).map(([, file]) => file);
  await place(module, install, shown.filter((file) => file.from === 'own'), reads);
  // A mod plays from what it uses of the game underneath.
  if (base) await place(module, base, shown.filter((file) => file.from === 'base'), reads);

  // What the engine adds to the games comes with its own pictures and words.
  if (engineData) ov.writeFile(`${GAME_ROOT}/${engineData.name}`, engineData.data);

  // What the game wrote in earlier sessions.
  for (const entry of overlay) {
    if (entry.deleted || !entry.data || generated.has(entry.key)) continue;
    ov.writeFile(`${GAME_ROOT}/${entry.path}`, entry.data, entry.mtime);
  }

  const encoder = new TextEncoder();
  for (const [name, text] of Object.entries(configFiles)) {
    ov.writeFile(`${GAME_ROOT}/${name}`, encoder.encode(text));
  }
}

export async function bootEngine(
  game: GameId,
  canvas: HTMLCanvasElement,
  settings: Settings,
  viewport: { width: number; height: number },
  hooks: BootHooks,
  options: BootOptions = {},
): Promise<Engine> {
  const def = gameDef(game);

  hooks.status('LOCATING HOLOTAPE');
  const installed = await loadInstalled(game);
  const { install } = installed;
  const mounted = mountGame(game, install.manifest, installed.base?.manifest);
  if (mounted.missing.length) {
    const under = gameDef(def.mod!.base);
    throw new Error(
      `${def.title} was loaded with files of the ${under.title} in deck ${under.deck} that are not there any more ` +
        `(${mounted.missing.slice(0, 3).join(', ')}). Load ${def.title} again from its files.`,
    );
  }

  hooks.status('READING ENGINE DESCRIPTOR');
  const info = await fetchEngineInfo(def.engine.id);
  const base = engineBase(def.engine.id);
  const version = `?v=${info.hash}`;

  hooks.status(`LOADING ${def.engine.name.toUpperCase()}`);
  const [wasmBinary, , engineData] = await Promise.all([
    downloadEngine(`${base}${info.wasm}${version}`, info.wasmBytes, hooks.progress),
    loadScript(`${base}${info.script}${version}`),
    wantsEngineData(game, settings.improvements) && info.data ? fetchEngineData(`${base}${info.data}${version}`, info.data) : null,
  ]);
  const factory = (window as unknown as Record<string, EngineFactory | undefined>)[def.engine.factory];
  if (!factory) throw new Error('the engine script did not define its entry point');

  const module = await factory({
    canvas,
    wasmBinary,
    noInitialRun: true,
    print: (line) => hooks.log(line),
    printErr: (line) => hooks.log(line),
    locateFile: (name) => `${base}${name}${version}`,
    onExit: (code) => hooks.exit(code),
    onAbort: (reason) => hooks.fatal(`The engine stopped unexpectedly: ${String(reason)}`),
  });

  const ov = module.overseer;
  ov.config.cacheBytes = settings.cacheMb << 20;
  ov.onError((what, err) => hooks.log(`[storage] ${what}: ${err instanceof Error ? err.message : String(err)}`));
  ov.onQuick((kind, outcome) => hooks.quick(kind, outcome));
  ov.mount(GAME_ROOT, async (batch: PersistBatch) => {
    try {
      // A save over a slot first moves the slot's old contents into its history.
      await commitWithHistory(game, batch);
    } catch (err) {
      // The game believes it saved. Nothing reached the disk; say so loudly.
      const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
      hooks.storageFailed(quota ? 'browser storage is full' : err instanceof Error ? err.message : String(err));
      throw err;
    }
    const slots = batch.puts.filter((put) => isSaveData(put.key)).map((put) => slotOf(put.key)!);
    hooks.saved(batch.puts.length + batch.deletes.length, slots);
  });

  hooks.status('MOUNTING GAME DATA');
  const overlay = await listOverlay(game);
  // The settings file the engine will read, which a mod's sfall settings may name otherwise than the game does.
  const ddraw = await openMounted(installed, mounted, 'ddraw.ini');
  const configFile = settingsFileOf(game, ddraw ? await ddraw.text() : undefined);
  const savedConfig = overlay.find((entry) => entry.key === pathKey(configFile) && !entry.deleted && entry.data);
  // What the game brought for the engine's own scripts: its key for lighting
  // things up is replaced with the console's, the rest of it stands.
  const mods = await openMounted(installed, mounted, HIGHLIGHTING_FILE);
  const highRes = await openMounted(installed, mounted, 'f2_res.ini');
  const screen = chooseScreen(pictureOf(settings, game), viewport);
  const configFiles = buildConfigFiles({
    game,
    manifest: install.manifest,
    base: installed.base?.manifest,
    savedConfig: savedConfig ? new TextDecoder().decode(savedConfig.data) : undefined,
    screen,
    // Someone who asked for their save does not want the opening movies first.
    skipIntro: settings.skipIntro || options.loadSlot !== undefined,
    improvements: settings.improvements,
    installMods: await mods?.text(),
    configFile,
    highRes: await highRes?.text(),
  });
  const reads = new Map<string, FileReads>();
  await populate(module, game, installed, mounted, overlay, configFiles, engineData, reads);
  module.FS.chdir(GAME_ROOT);
  hooks.status('SIMULATION READY');

  return {
    game,
    module,
    info,
    screen,
    start() {
      ov.start();
      // Both engines take the slot under this name (see engines/fallout1/patches).
      module.callMain(options.loadSlot === undefined ? [] : [`--dev-load-game=${options.loadSlot}`]);
    },
    pause: () => ov.pause(),
    resume: () => ov.resume(),
    setSpeed: (speed) => ov.setSpeed(speed),
    inGame: () => ov.inGame(),
    playerTurn: () => ov.playerTurn(),
    scrollListAt: (x, y) => ov.scrollListAt(x, y),
    requestSave: (slot) => ov.requestSave(slot),
    setLights: (on) => ov.holdScriptKey(HIGHLIGHT_KEY, on),
    audioContext: () => module.SDL2?.audioContext,
    reads: () => Object.fromEntries([...reads].map(([path, read]) => [path, { ...read }])),
  };
}
