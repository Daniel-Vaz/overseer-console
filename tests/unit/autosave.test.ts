import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_SLOTS, PlayClock, isAutosave, nextAutosaveSlot } from '../../src/lib/autosave';
import { lastExport, recordExport } from '../../src/lib/backup';
import { storeSynced } from '../../src/lib/dropbox/link';
import { loadSettings } from '../../src/lib/settings';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, String(value));
  removeItem = (key: string) => void this.items.delete(key);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const save = (slot: number, description: string, savedAt: number) => ({ slot, description, savedAt });

describe('the slot an autosave goes in', () => {
  it('is one of the last three of the first page', () => {
    expect(AUTOSAVE_SLOTS).toEqual([8, 9, 10]);
    expect(nextAutosaveSlot([])).toBe(8);
    // The player's own saves in the first seven slots do not come into it.
    expect(nextAutosaveSlot([save(1, 'temple', 5), save(7, 'klamath', 6)])).toBe(8);
  });

  it('is an empty one first, then the one holding the oldest autosave', () => {
    expect(nextAutosaveSlot([save(8, 'AUTOSAVE 10:00', 100)])).toBe(9);
    expect(nextAutosaveSlot([save(8, 'AUTOSAVE 10:00', 100), save(10, 'AUTOSAVE 10:20', 300)])).toBe(9);
    const full = [save(8, 'AUTOSAVE 10:30', 400), save(9, 'AUTOSAVE 10:10', 200), save(10, 'AUTOSAVE 10:20', 300)];
    expect(nextAutosaveSlot(full)).toBe(9);
  });

  it('is never one that holds a save the player made there', () => {
    const saves = [save(8, 'before the boss', 100), save(9, 'AUTOSAVE 10:30', 400), save(10, 'AUTOSAVE 10:20', 300)];
    expect(nextAutosaveSlot(saves)).toBe(10);
    expect(nextAutosaveSlot([save(8, 'mine', 1), save(9, 'mine too', 2), save(10, '', 3)])).toBeNull();
  });

  it('knows an autosave by its slot and its description', () => {
    expect(isAutosave(save(9, 'AUTOSAVE 21:05', 0))).toBe(true);
    expect(isAutosave(save(9, 'AUTOSAVE', 0))).toBe(true);
    expect(isAutosave(save(3, 'AUTOSAVE 21:05', 0))).toBe(false);
    expect(isAutosave(save(9, 'AUTOSAVED BY HAND', 0))).toBe(false);
  });
});

describe('the clock of time played', () => {
  it('counts only while the game is played, and says when a save is due', () => {
    const clock = new PlayClock(60_000);
    expect(clock.tick(0, true)).toBe(false);
    expect(clock.tick(30_000, true)).toBe(false); // more than a step at a time counts as one step
    for (let at = 31_000; at <= 59_000; at += 1000) clock.tick(at, true);
    expect(clock.tick(60_000, false)).toBe(false); // suspended: this second does not count
    expect(clock.tick(600_000, true)).toBe(false); // and neither does the time it stayed so
    let due = false;
    for (let at = 601_000; !due; at += 1000) due = clock.tick(at, true);
    expect(due).toBe(true);
    clock.reset();
    expect(clock.tick(700_000, true)).toBe(false);
  });

  it('is never due when autosaves are off', () => {
    const clock = new PlayClock(0);
    for (let at = 0; at < 100_000; at += 1000) expect(clock.tick(at, true)).toBe(false);
  });
});

describe('the autosave setting', () => {
  it('starts at every ten minutes, and takes only the values it offers', () => {
    expect(loadSettings().autosave).toBe(10);
    localStorage.setItem('overseer-console:settings', JSON.stringify({ autosave: 0 }));
    expect(loadSettings().autosave).toBe(0);
    localStorage.setItem('overseer-console:settings', JSON.stringify({ autosave: 7 }));
    expect(loadSettings().autosave).toBe(10);
  });
});

describe('when saves were last exported', () => {
  it('is never, until they are exported to a zip or uploaded to Dropbox', () => {
    expect(lastExport('fo2')).toBeNull();
    recordExport('fo2', 'zip', 1000);
    expect(lastExport('fo2')).toEqual({ at: 1000, to: 'zip' });
    recordExport('fo2', 'dropbox', 2000);
    expect(lastExport('fo2')).toEqual({ at: 2000, to: 'dropbox' });
    // Each game has its own.
    expect(lastExport('fo1')).toBeNull();
  });

  it('counts saves uploaded to Dropbox before the console kept track', () => {
    storeSynced('fo1', 2, { rev: 'a', savedAt: 5000 });
    storeSynced('fo1', 4, { rev: 'b', savedAt: 9000 });
    expect(lastExport('fo1')).toEqual({ at: 9000, to: 'dropbox' });
  });
});
