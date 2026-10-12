/** What the page sees of a compiled engine (see engines/lib/overseer.js). */

export interface PersistBatch {
  puts: { key: string; path: string; mode: number; mtime: number; data: Uint8Array }[];
  deletes: { key: string; path: string }[];
}

export interface OverseerStats {
  yields: number;
  sleeps: number;
  stalls: number;
  /** Milliseconds the engine has spent computing (not waiting). */
  busyMs: number;
  blockReads: number;
  blockBytes: number;
  blockMs: number;
  evictions: number;
  syncs: number;
  cachedBytes: number;
  cachedBlocks: number;
  pausedMs: number;
  paused: boolean;
}

export interface OverseerApi {
  version: number;
  config: { sliceMs: number; blockSize: number; cacheBytes: number; stallMs: number };
  mount(path: string, persist: (batch: PersistBatch) => Promise<void>): unknown;
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array, mtime?: number): void;
  addLazyFile(path: string, size: number, read: (offset: number, length: number) => Promise<Uint8Array>): void;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  flush(): Promise<void>;
  onError(handler: (what: string, err: unknown) => void): void;
  stats(): OverseerStats;
}

export interface EngineModule {
  FS: {
    chdir(path: string): void;
    readFile(path: string): Uint8Array;
    analyzePath(path: string): { exists: boolean };
  };
  callMain(args: string[]): void;
  overseer: OverseerApi;
  /** Set by SDL once it opened the audio device. */
  SDL2?: { audioContext?: AudioContext };
  /** SDL's text input switch: the games turn it on while they wait for typing. */
  _SDL_IsTextInputActive?(): number;
  _SDL_StopTextInput?(): void;
  HEAPU8: Uint8Array;
}

export interface EngineModuleConfig {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  print(line: string): void;
  printErr(line: string): void;
  locateFile(name: string): string;
  onExit(code: number): void;
  onAbort(reason: unknown): void;
  /** The engine binary, already downloaded. */
  wasmBinary: Uint8Array;
}

export type EngineFactory = (config: EngineModuleConfig) => Promise<EngineModule>;

/** public/engines/<id>/engine.json, written by engines/build.sh. */
export interface EngineInfo {
  id: string;
  script: string;
  wasm: string;
  wasmBytes: number;
  hash: string;
  source: string;
  commit: string;
  patched: boolean;
  emsdk: string;
}
