/**
 * Has a running game saved every so many minutes of play, and on arriving on
 * another map, in turn in the last three save slots (see lib/autosave.ts).
 */
import { PlayClock, nextAutosaveSlot, type AutosavePlan } from '../lib/autosave';
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
    private readonly plan: AutosavePlan,
    private readonly hooks: AutosaveHooks,
  ) {
    this.clock = new PlayClock(plan.minutes * 60_000);
    // Also what calls off a save asked for (an arrival's, a new picture's) when the game ends before it could be made.
    this.timer = window.setInterval(() => void this.tick(), 1000);
  }

  /**
   * The player arrived on another map by going there. The save is made at the
   * next moment the game can make one: at once, or once a fight that greets
   * the player there is over.
   */
  arrived(): void {
    if (this.plan.maps) void this.request();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Saves now, however long it has been: for diagnostics and tests. */
  async now(): Promise<boolean> {
    return typeof (await this.request()) === 'number';
  }

  /**
   * Saves at the next moment the game can, whatever the setting says: before
   * the game is started again in another picture, to carry on from there.
   * The slot it was saved in; 'full' when slots 08 to 10 all hold saves the
   * player made there; 'failed' when the save was not made.
   */
  saveForRestart(): Promise<number | 'full' | 'failed'> {
    return this.request(true);
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

  private async request(asked = false): Promise<number | 'full' | 'failed'> {
    // One waiting for its moment is the one this would have been; asked for, it takes that one's place.
    if (this.choosing) return 'failed';
    if (this.pending !== null) {
      if (!asked) return 'failed';
      void this.engine.requestSave(0);
      this.pending = null;
    }
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
      if (asked) return 'full';
      this.clock.reset();
      if (!this.toldFull) this.hooks.say('NO AUTOSAVE: SLOTS 08 TO 10 HOLD SAVES YOU MADE THERE YOURSELF', true);
      this.toldFull = true;
      return 'full';
    }
    this.pending = slot;
    try {
      return (await this.engine.requestSave(slot)) ? slot : 'failed';
    } finally {
      if (this.pending === slot) this.pending = null;
    }
  }
}
