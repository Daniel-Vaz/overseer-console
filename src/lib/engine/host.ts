/**
 * Starts an engine against the installed game data.
 *
 * Nothing here copies the game into memory: large files are handed to the
 * engine as lazy files backed by the browser's private file system, small
 * ones come from a single packed read, and whatever the engine wrote before
 * (saves, settings) is layered on top from the overlay.
 */
import { GAMES, type EngineId, type GameId } from '../games';
import type { Settings } from '../settings';
import { pathKey } from '../storage/manifest';
import { StorageUnavailableError, loadInstall, openBlob, openInstalled, type Install } from '../storage/opfs';

export { StorageUnavailableError };
import { commitWithHistory } from '../storage/history';
import { listOverlay, type OverlayEntry } from '../storage/overlay';
import { HIGHLIGHTING_FILE, baseFiles, baseFolder, buildConfigFiles, chooseScreen, wantsEngineData, type ScreenSize } from './config';
import type { EngineFactory, EngineInfo, EngineModule, PersistBatch } from './types';

const GAME_ROOT = '/game';

/** Folders the engines expect to find, whether or not the install had them. */
const REQUIRED_DIRS = ['data/SAVEGAME', 'data/MAPS', 'data/proto/items', 'data/proto/critters'];

export class NoInstallError extends Error {
  override name = 'NoInstallError';
}

/** What a game is started from: its own install, and that of the game it runs on when it is a conversion. */
export interface Installed {
  install: Install;
  base?: Install;
}

/** Looks up what `game` needs to start. Throws NoInstallError naming what is not in this browser. */
export async function loadInstalled(game: GameId): Promise<Installed> {
  const def = GAMES[game];
  const install = await loadInstall(game);
  if (!install) throw new NoInstallError(`${def.title} has not been imported in this browser.`);
  if (!def.conversion) return { install };
  const base = await loadInstall(def.conversion.base);
  if (!base) throw new NoInstallError(`${def.title} runs on ${GAMES[def.conversion.base].title}, which has not been imported in this browser.`);
  return { install, base };
}

export interface BootHooks {
  /** A step of the start-up sequence, for the boot log. */
  status(line: string): void;
  /** Download progress of the engine binary. */
  progress(done: number, total: number): void;
  /** A line the engine printed. */
  log(line: string): void;
  /** The engine finished storing a batch of changes (a save, settings). */
  saved(files: number): void;
  /** Changes could not be written to browser storage. The player must be told. */
  storageFailed(reason: string): void;
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
  audioContext(): AudioContext | undefined;
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

/**
 * Puts stored files where the engine will look for them, below `root`.
 * `wanted` picks among the install's files, by lower-cased path.
 */
async function place(module: EngineModule, install: Install, root: string, wanted: (key: string) => boolean): Promise<void> {
  const ov = module.overseer;
  const { manifest } = install;

  // Small files: one read for all of them, unless only a small part of them is asked for.
  const packed = manifest.files.filter((f) => f.pack && wanted(pathKey(f.path)));
  if (packed.length) {
    const pack = await openBlob(install, 'pack.bin');
    const asked = packed.reduce((sum, file) => sum + file.pack![1], 0);
    const whole = asked * 4 < pack.size ? null : new Uint8Array(await pack.arrayBuffer());
    for (const file of packed) {
      const [offset, length] = file.pack!;
      const data = whole ? whole.subarray(offset, offset + length) : new Uint8Array(await pack.slice(offset, offset + length).arrayBuffer());
      ov.writeFile(`${root}/${file.path}`, data, manifest.importedAt);
    }
  }

  // Large files: opened, not read.
  const large = manifest.files.filter((f) => f.blob && wanted(pathKey(f.path)));
  const handles = await Promise.all(large.map((f) => openBlob(install, f.blob!)));
  large.forEach((file, i) => {
    const blob = handles[i]!;
    if (blob.size !== file.size) {
      throw new Error(`${file.path} is damaged in browser storage (${blob.size} of ${file.size} bytes). Import the game again.`);
    }
    ov.addLazyFile(`${root}/${file.path}`, file.size, (offset, length) =>
      blob.slice(offset, offset + length).arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    );
  });
}

async function populate(
  module: EngineModule,
  game: GameId,
  { install, base }: Installed,
  overlay: OverlayEntry[],
  configFiles: Record<string, string>,
  engineData: { name: string; data: Uint8Array } | null,
): Promise<void> {
  const ov = module.overseer;
  const { manifest } = install;
  const changed = new Map(overlay.map((entry) => [entry.key, entry]));
  const generated = new Set(Object.keys(configFiles).map(pathKey));

  for (const dir of [...manifest.dirs, ...REQUIRED_DIRS]) ov.mkdir(`${GAME_ROOT}/${dir}`);
  await place(module, install, GAME_ROOT, (key) => !changed.has(key) && !generated.has(key));

  // A conversion plays from the archives of the game it runs on.
  const conversion = GAMES[game].conversion;
  if (conversion && base) {
    const borrowed = new Set(baseFiles(conversion.base, base.manifest).map(pathKey));
    await place(module, base, `${GAME_ROOT}/${baseFolder(conversion.base)}`, (key) => borrowed.has(key));
  }

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
  const def = GAMES[game];

  hooks.status('LOCATING HOLOTAPE');
  const installed = await loadInstalled(game);
  const { install } = installed;

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
    hooks.saved(batch.puts.length + batch.deletes.length);
  });

  hooks.status('MOUNTING GAME DATA');
  const overlay = await listOverlay(game);
  const savedConfig = overlay.find((entry) => entry.key === def.configFile && !entry.deleted && entry.data);
  // What the game brought for the engine's own scripts: its key for lighting
  // things up is replaced with the console's, the rest of it stands.
  const mods = await openInstalled(install, HIGHLIGHTING_FILE);
  const screen = chooseScreen(settings.picture[game], viewport);
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
  });
  await populate(module, game, installed, overlay, configFiles, engineData);
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
    audioContext: () => module.SDL2?.audioContext,
  };
}
