import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/lib/settings';

const KEY = 'overseer-console:settings';

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

describe('the picture of each game', () => {
  it('is the one a game was made for until the player chooses: the original, and high resolution for Fallout Et Tu', () => {
    expect(loadSettings().picture).toEqual({ fo1: 'classic', fo2: 'classic', ettu: 'high' });
    // Other settings having been stored makes no choice of a picture.
    localStorage.setItem(KEY, JSON.stringify({ sound: false }));
    expect(loadSettings().picture).toEqual({ fo1: 'classic', fo2: 'classic', ettu: 'high' });
  });

  it('starts from the one picture the player had chosen for all games, so that nothing changes unasked', () => {
    // As stored before every game had its own.
    localStorage.setItem(KEY, JSON.stringify({ display: 'high', scaling: 'smooth' }));
    const settings = loadSettings();
    expect(settings.picture).toEqual({ fo1: 'high', fo2: 'high', ettu: 'high' });
    expect(settings.scaling).toBe('smooth');
    // The old entry is not carried along.
    expect(settings).not.toHaveProperty('display');

    localStorage.setItem(KEY, JSON.stringify({ display: 'wide' }));
    expect(loadSettings().picture).toEqual({ fo1: 'wide', fo2: 'wide', ettu: 'wide' });
  });

  it('does not take the original picture, where the one setting for all games stood untouched, for a choice', () => {
    localStorage.setItem(KEY, JSON.stringify({ display: 'classic', scaling: 'smooth' }));
    expect(loadSettings().picture).toEqual({ fo1: 'classic', fo2: 'classic', ettu: 'high' });
  });

  it('is kept game by game', () => {
    const settings = loadSettings();
    saveSettings({ ...settings, picture: { ...settings.picture, ettu: 'classic', fo2: 'wide' } });
    expect(loadSettings().picture).toEqual({ fo1: 'classic', fo2: 'wide', ettu: 'classic' });
  });

  it('a choice made game by game stands over the old one for all', () => {
    localStorage.setItem(KEY, JSON.stringify({ display: 'wide', picture: { ettu: 'classic' } }));
    expect(loadSettings().picture).toEqual({ fo1: 'wide', fo2: 'wide', ettu: 'classic' });
  });

  it('does not take a value it does not know', () => {
    localStorage.setItem(KEY, JSON.stringify({ display: 'huge', picture: { fo1: 'wide', fo2: 7, ettu: 'ultra', other: 'high' } }));
    expect(loadSettings().picture).toEqual({ fo1: 'wide', fo2: 'classic', ettu: 'high' });
    localStorage.setItem(KEY, JSON.stringify({ picture: 'wide' }));
    expect(loadSettings().picture).toEqual({ fo1: 'classic', fo2: 'classic', ettu: 'high' });
  });

  it('never hands out the defaults themselves', () => {
    loadSettings().picture.fo1 = 'high';
    localStorage.setItem(KEY, 'not json');
    loadSettings().picture.fo2 = 'high';
    localStorage.setItem(KEY, JSON.stringify({ sound: false }));
    loadSettings().picture.ettu = 'wide';
    expect(DEFAULT_SETTINGS.picture).toEqual({ fo1: 'classic', fo2: 'classic', ettu: 'high' });
  });
});
