/**
 * Starts an engine against the installed game data.
 *
 * Nothing here copies the game into memory: large files are handed to the
 * engine as lazy files backed by the browser's private file system, small
 * ones come from a single packed read, and whatever the engine wrote before
 * (saves, settings) is layered on top from the overlay.
 */
import { GAMES, type GameId } from '../games';
import type { Settings } from '../settings';
import { pathKey } from '../storage/manifest';
import { StorageUnavailableError, loadInstall, openBlob, type Install } from '../storage/opfs';

export { StorageUnavailableError };
import { commitOverlay, listOverlay, type OverlayEntry } from '../storage/overlay';
import { CLASSIC_SCREEN, buildConfigFiles, wideScreen, type ScreenSize } from './config';
import type { EngineFactory, EngineInfo, EngineModule, PersistBatch } from './types';

const GAME_ROOT = '/game';

/** Folders the engines expect to find, whether or not the install had them. */
const REQUIRED_DIRS = ['data/SAVEGAME', 'data/MAPS', 'data/proto/items', 'data/proto/critters'];

export class NoInstallError extends Error {
  override name = 'NoInstallError';
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

export interface Engine {
  game: GameId;
  module: EngineModule;
  info: EngineInfo;
  screen: ScreenSize;
  /** Hands control to the game. Returns immediately; the game keeps running. */
  start(): void;
  pause(): void;
  resume(): void;
  audioContext(): AudioContext | undefined;
}

function engineBase(game: GameId): string {
  return `${import.meta.env.BASE_URL}engines/${game}/`;
}

async function fetchEngineInfo(game: GameId): Promise<EngineInfo> {
  const response = await fetch(`${engineBase(game)}engine.json`, { cache: 'no-cache' });
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

export function chooseScreen(settings: Settings, viewport: { width: number; height: number }): ScreenSize {
  if (settings.display !== 'wide') return CLASSIC_SCREEN;
  return wideScreen(viewport.width, viewport.height);
}

async function populate(
  module: EngineModule,
  install: Install,
  overlay: OverlayEntry[],
  configFiles: Record<string, string>,
): Promise<void> {
  const ov = module.overseer;
  const { manifest } = install;
  const changed = new Map(overlay.map((entry) => [entry.key, entry]));
  const generated = new Set(Object.keys(configFiles).map(pathKey));

  for (const dir of [...manifest.dirs, ...REQUIRED_DIRS]) ov.mkdir(`${GAME_ROOT}/${dir}`);

  // Small files: one read for all of them.
  const packed = manifest.files.filter((f) => f.pack);
  if (packed.length) {
    const pack = new Uint8Array(await (await openBlob(install, 'pack.bin')).arrayBuffer());
    for (const file of packed) {
      const key = pathKey(file.path);
      if (changed.has(key) || generated.has(key)) continue;
      const [offset, length] = file.pack!;
      ov.writeFile(`${GAME_ROOT}/${file.path}`, pack.subarray(offset, offset + length), manifest.importedAt);
    }
  }

  // Large files: opened, not read.
  const large = manifest.files.filter((f) => f.blob && !changed.has(pathKey(f.path)));
  const handles = await Promise.all(large.map((f) => openBlob(install, f.blob!)));
  large.forEach((file, i) => {
    const blob = handles[i]!;
    if (blob.size !== file.size) {
      throw new Error(`${file.path} is damaged in browser storage (${blob.size} of ${file.size} bytes). Import the game again.`);
    }
    ov.addLazyFile(`${GAME_ROOT}/${file.path}`, file.size, (offset, length) =>
      blob.slice(offset, offset + length).arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    );
  });

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
): Promise<Engine> {
  const def = GAMES[game];

  hooks.status('LOCATING HOLOTAPE');
  const install = await loadInstall(game);
  if (!install) throw new NoInstallError(`${def.title} has not been imported in this browser.`);

  hooks.status('READING ENGINE DESCRIPTOR');
  const info = await fetchEngineInfo(game);
  const base = engineBase(game);
  const version = `?v=${info.hash}`;

  hooks.status(`LOADING ${def.engine.name.toUpperCase()}`);
  const [wasmBinary] = await Promise.all([
    downloadEngine(`${base}${info.wasm}${version}`, info.wasmBytes, hooks.progress),
    loadScript(`${base}${info.script}${version}`),
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
      await commitOverlay(game, batch);
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
  const screen = chooseScreen(settings, viewport);
  const configFiles = buildConfigFiles({
    game,
    manifest: install.manifest,
    savedConfig: savedConfig ? new TextDecoder().decode(savedConfig.data) : undefined,
    screen,
    skipIntro: settings.skipIntro,
  });
  await populate(module, install, overlay, configFiles);
  module.FS.chdir(GAME_ROOT);
  hooks.status('SIMULATION READY');

  return {
    game,
    module,
    info,
    screen,
    start() {
      ov.start();
      module.callMain([]);
    },
    pause: () => ov.pause(),
    resume: () => ov.resume(),
    audioContext: () => module.SDL2?.audioContext,
  };
}
