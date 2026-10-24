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
  /** How many times as fast as time the engine's clock runs. */
  speed: number;
  /** What the engine's clock reads, in milliseconds. */
  clock: number;
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
  /** Fast forward: 1 is the pace of the original. */
  setSpeed(speed: number): void;
  flush(): Promise<void>;
  onError(handler: (what: string, err: unknown) => void): void;
  /** Whether a game is in progress: not its menus or movies. */
  inGame(): boolean;
  /** Whether it is the player's turn in combat, when SPACE ends it. */
  playerTurn(): boolean;
  /**
   * Asks for a save in `slot` (1-based) at the next moment the game could
   * make one. True once made; false when it failed or was called off. Slot 0
   * calls off the one waiting.
   */
  requestSave(slot: number): Promise<boolean>;
  /** Hears how each quick save and quick load went. Both use slot 7 alone. */
  onQuick(handler: (kind: QuickKind, outcome: QuickOutcome) => void): void;
  /** Hears of each arrival on a map by going there (an exit grid, the world map, an encounter), with the map's number. */
  onArrive(handler: (map: number) => void): void;
  /** Hears of each game loaded from a save, with its slot (1-based), however the load was asked for. */
  onLoad(handler: (slot: number) => void): void;
  /**
   * Holds a key (a DirectInput scan code) down for the game's scripts alone, or
   * lets go of it: Fallout 2's scripts, and what Fallout's engine follows of a
   * mod's sfall settings (the key that lights up what lies on the ground).
   */
  holdScriptKey(key: number, held: boolean): void;
  /** The list that takes the mouse wheel at (x, y), in pixels of the game's screen (an inventory), or null. */
  scrollListAt(x: number, y: number): ScreenRect | null;
  stats(): OverseerStats;
}

/** A rectangle on the game's screen, in its pixels, edges included. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type QuickKind = 'save' | 'load';
/** Made; nothing in the slot to load; failed. */
export type QuickOutcome = 'done' | 'empty' | 'failed';

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
  /** A data file to put beside the games this engine runs, when the engine has one. */
  data?: string;
  hash: string;
  source: string;
  commit: string;
  patched: boolean;
  emsdk: string;
}
