/**
 * Has a running game saved every so many minutes of play, in turn in the
 * last three save slots (see lib/autosave.ts).
 */
import { PlayClock, nextAutosaveSlot } from '../lib/autosave';
import type { Engine } from '../lib/engine/host';
import type { GameId } from '../lib/games';
import { briefSaves } from '../lib/saves';

export interface AutosaveHooks {
  /** Whether the player is at the game right now: it runs, and the page is in view. */
  playing(): boolean;
  /** Something the player should hear about. */
  say(text: string, bad?: boolean): void;
}

export class Autosaver {
  private readonly clock: PlayClock;
  /** The slot a save was asked for in, until the game made it or gave up. */
  private pending: number | null = null;
  private choosing = false;
  /** Said once: there is no slot this autosave may use. */
  private toldFull = false;
  private wasInGame = false;
  private timer = 0;

  constructor(
    private readonly game: GameId,
    private readonly engine: Engine,
    minutes: number,
    private readonly hooks: AutosaveHooks,
  ) {
    this.clock = new PlayClock(minutes * 60_000);
    if (minutes > 0) this.timer = window.setInterval(() => void this.tick(), 1000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Saves now, however long it has been: for diagnostics and tests. */
  now(): Promise<boolean> {
    return this.request();
  }

  /**
   * The game stored a save in these slots. True when it is the autosave
   * that was asked for; otherwise the player saved, and the next autosave is
   * a full interval away.
   */
  saved(slots: number[]): boolean {
    if (!slots.length) return false;
    this.clock.reset();
    if (this.pending !== null && slots.includes(this.pending)) return true;
    // Asked for before the player saved, and no longer needed.
    if (this.pending !== null) void this.engine.requestSave(0);
    return false;
  }

  private async tick(): Promise<void> {
    const inGame = this.engine.inGame();
    // A game begun or loaded from the main menu starts the count afresh.
    if (inGame && !this.wasInGame) this.clock.reset();
    this.wasInGame = inGame;
    if (this.pending !== null) {
      // A game that ended before the save could be made is not saved when the next one begins.
      if (!inGame) void this.engine.requestSave(0);
      return;
    }
    if (this.choosing) return;
    if (!this.clock.tick(performance.now(), this.hooks.playing() && inGame)) return;
    await this.request();
  }

  private async request(): Promise<boolean> {
    if (this.pending !== null || this.choosing) return false;
    this.choosing = true;
    let slot: number | null;
    try {
      slot = nextAutosaveSlot(await briefSaves(this.game));
    } catch {
      slot = null;
    } finally {
      this.choosing = false;
    }
    if (slot === null) {
      this.clock.reset();
      if (!this.toldFull) this.hooks.say('NO AUTOSAVE: SLOTS 08 TO 10 HOLD SAVES YOU MADE THERE YOURSELF', true);
      this.toldFull = true;
      return false;
    }
    this.pending = slot;
    try {
      return await this.engine.requestSave(slot);
    } finally {
      this.pending = null;
    }
  }
}
