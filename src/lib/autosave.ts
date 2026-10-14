/**
 * Autosaves: now and then the game is saved without being asked, in the last
 * three slots of the ten every game shows on the first page of its save
 * screen. The other seven are the player's own. The engines make the save
 * when the console asks for it (see the engines' patches), at a moment the player
 * could have made a quick save, and describe it as "AUTOSAVE hh:mm".
 */

/** The slots autosaves take turns in. */
export const AUTOSAVE_SLOTS: readonly number[] = [8, 9, 10];

/** Minutes of play between autosaves the setting offers. 0 is off. */
export const AUTOSAVE_MINUTES: readonly number[] = [0, 5, 10, 15, 30];

/** Whether a save is one the console had the game make. */
export function isAutosave(save: { slot: number; description: string }): boolean {
  return AUTOSAVE_SLOTS.includes(save.slot) && /^AUTOSAVE\b/.test(save.description.trim());
}

/**
 * Where the next autosave goes: an empty autosave slot first, then the one
 * holding the oldest autosave. A slot holding a save the player made there
 * is left alone. Null when all of them hold such saves.
 */
export function nextAutosaveSlot(saves: readonly { slot: number; description: string; savedAt: number }[]): number | null {
  let oldest: { slot: number; savedAt: number } | null = null;
  for (const slot of AUTOSAVE_SLOTS) {
    const save = saves.find((candidate) => candidate.slot === slot);
    if (!save) return slot;
    if (!isAutosave(save)) continue;
    if (!oldest || save.savedAt < oldest.savedAt) oldest = save;
  }
  return oldest?.slot ?? null;
}

/**
 * Time played since the game was last saved. Only what passes while the game
 * is being played counts: not its menus, not a suspended game, not a hidden
 * tab. A long gap between two looks at it (a computer asleep) counts as none.
 */
export class PlayClock {
  private played = 0;
  private last: number | null = null;

  constructor(private readonly everyMs: number) {}

  /** Looks at the clock. True once a save is due. */
  tick(now: number, playing: boolean): boolean {
    if (playing && this.last !== null) this.played += Math.min(Math.max(0, now - this.last), PlayClock.MAX_STEP_MS);
    this.last = playing ? now : null;
    return this.everyMs > 0 && this.played >= this.everyMs;
  }

  /** The game was just saved. */
  reset(): void {
    this.played = 0;
  }

  static readonly MAX_STEP_MS = 5000;
}
