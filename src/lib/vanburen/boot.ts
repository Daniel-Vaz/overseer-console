/**
 * Starts Open Van Buren against the tech demo's files in storage. The small
 * files are written into the engine's memory; the archives (up to 230 MB
 * each) are handed over as lazy files, read a block at a time as the engine
 * asks for them, as the Fallout engines' are (see engines/lib/overseer.js).
 */
import { downloadEngine, engineBase, fetchEngineInfo, loadScript } from '../engine/download';
import type { EngineFactory, EngineInfo, EngineModule } from '../engine/types';
import { openBlob } from '../storage/opfs';
import { DEMO } from './demo';
import { loadDemo } from './store';

const ROOT = '/game';

/** The demo's files are not in this browser. */
export class NoDemoError extends Error {
  override name = 'NoDemoError';
}

export interface DemoHooks {
  /** A step of the start-up, for the boot log. */
  status(line: string): void;
  /** Download progress of the engine binary. */
  progress(done: number, total: number): void;
  /** A line the engine printed. */
  log(line: string): void;
  exit(code: number): void;
  fatal(message: string): void;
}

export interface DemoEngine {
  module: EngineModule;
  info: EngineInfo;
  /** Hands control to the engine. Returns at once; the demo keeps running. */
  start(): void;
  pause(): void;
  resume(): void;
  /** The sound the engine plays, to be silenced while it is paused. */
  audioContexts(): readonly AudioContext[];
}

/**
 * Emscripten's OpenAL keeps the context it plays through to itself. The page
 * notes every one that is made, which is that one.
 */
const contexts: AudioContext[] = [];
function noteAudioContexts(): void {
  const Native = window.AudioContext;
  if (!Native || (Native as unknown as { noted?: boolean }).noted) return;
  window.AudioContext = class extends Native {
    static noted = true;
    constructor(options?: AudioContextOptions) {
      super(options);
      contexts.push(this);
    }
  };
}

export async function bootDemo(canvas: HTMLCanvasElement, cacheMb: number, hooks: DemoHooks): Promise<DemoEngine> {
  hooks.status('LOCATING ARCHIVE');
  const install = await loadDemo();
  if (!install) throw new NoDemoError('The Van Buren tech demo has not been loaded in this browser.');

  hooks.status('READING ENGINE DESCRIPTOR');
  const info = await fetchEngineInfo(DEMO.engine.id);
  const base = engineBase(DEMO.engine.id);
  const version = `?v=${info.hash}`;

  hooks.status(`LOADING ${DEMO.engine.name.toUpperCase()}`);
  const [wasmBinary] = await Promise.all([downloadEngine(`${base}${info.wasm}${version}`, info.wasmBytes, hooks.progress), loadScript(`${base}${info.script}${version}`)]);
  const factory = (window as unknown as Record<string, EngineFactory | undefined>)[DEMO.engine.factory];
  if (!factory) throw new Error('the engine script did not define its entry point');
  noteAudioContexts();

  // The engine hands the thread back once a frame, after drawing it; but reading a block of an archive for the
  // first time can make it wait in the middle of one, and the browser may show the frame then. Kept, the
  // drawing goes on over what is there instead of over a cleared picture.
  const getContext = canvas.getContext.bind(canvas) as (type: string, attributes?: object) => RenderingContext | null;
  (canvas as unknown as { getContext: typeof getContext }).getContext = (type, attributes) =>
    getContext(type, type === 'webgl2' ? { ...attributes, preserveDrawingBuffer: true } : attributes);

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
  // A map reads up to 150 MB of the archives as it loads; the Fallout engines' cache would throw half of that away.
  ov.config.cacheBytes = Math.max(cacheMb, 384) << 20;
  // The engine gives the browser its turn once a frame and never mid-frame for time: a read may only wait for data.
  ov.config.sliceMs = Number.MAX_SAFE_INTEGER;
  ov.onError((what, err) => hooks.log(`[storage] ${what}: ${err instanceof Error ? err.message : String(err)}`));
  // The demo writes nothing of its own: no saves, no settings.
  ov.mount(ROOT, async () => undefined);

  hooks.status('MOUNTING ARCHIVES');
  const { manifest } = install;
  for (const dir of manifest.dirs) ov.mkdir(`${ROOT}/${dir}`);
  const packed = manifest.files.filter((file) => file.pack);
  if (packed.length) {
    const pack = new Uint8Array(await (await openBlob(install, 'pack.bin')).arrayBuffer());
    for (const file of packed) {
      const [offset, length] = file.pack!;
      ov.writeFile(`${ROOT}/${file.path}`, pack.slice(offset, offset + length), manifest.importedAt);
    }
  }
  const large = manifest.files.filter((file) => file.blob);
  const blobs = await Promise.all(large.map((file) => openBlob(install, file.blob!)));
  large.forEach((file, i) => {
    const blob = blobs[i]!;
    if (blob.size !== file.size) throw new Error(`${file.path} is damaged in browser storage (${blob.size} of ${file.size} bytes). Load the tech demo again.`);
    ov.addLazyFile(`${ROOT}/${file.path}`, file.size, (offset, length) => blob.slice(offset, offset + length).arrayBuffer().then((buffer) => new Uint8Array(buffer)));
  });
  module.FS.chdir(ROOT);
  hooks.status('SIMULATION READY');

  return {
    module,
    info,
    start() {
      ov.start();
      module.callMain(['-game', ROOT]);
    },
    pause: () => ov.pause(),
    resume: () => ov.resume(),
    audioContexts: () => contexts,
  };
}
