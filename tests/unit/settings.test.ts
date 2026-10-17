import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMod } from '../../src/lib/games';
import { DEFAULT_SETTINGS, deckGame, loadSettings, pictureOf, picturesFor, saveSettings } from '../../src/lib/settings';

const KEY = 'overseer-console:settings';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, String(value));
  removeItem = (key: string) => void this.items.delete(key);
}

beforeAll(() => {
  registerMod({ id: 'ettu', known: 'ettu', title: 'Fallout Et Tu', base: 'fo2', donor: 'fo1' });
  registerMod({ id: 'olympus', known: 'olympus', title: 'Olympus 2207', base: 'fo2' });
  registerMod({ id: 'my-mod', title: 'My Mod', base: 'fo2' });
});

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The picture each game is played at. */
const pictures = (settings = loadSettings()) => Object.fromEntries(['fo1', 'fo2', 'ettu', 'olympus', 'my-mod'].map((game) => [game, pictureOf(settings, game)]));

describe('the picture of each game', () => {
  it('is the one a game was made for until the player chooses: the original, and the one its makers meant for a mod', () => {
    expect(loadSettings().picture).toEqual({});
    expect(pictures()).toEqual({ fo1: 'classic', fo2: 'classic', ettu: 'high', olympus: 'high', 'my-mod': 'classic' });
    // Other settings having been stored makes no choice of a picture.
    localStorage.setItem(KEY, JSON.stringify({ sound: false }));
    expect(pictures()).toEqual({ fo1: 'classic', fo2: 'classic', ettu: 'high', olympus: 'high', 'my-mod': 'classic' });
  });

  it('is never one too small for the game', () => {
    // Olympus 2207 needs 600 lines: of the three pictures only the tallest has them.
    expect(picturesFor('olympus')).toEqual(['high']);
    expect(picturesFor('fo2')).toEqual(['classic', 'wide', 'high']);
    const settings = { ...loadSettings(), picture: { olympus: 'classic' as const } };
    expect(pictureOf(settings, 'olympus')).toBe('high');
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
    expect(pictures()).toMatchObject({ fo1: 'wide', fo2: 'wide', ettu: 'wide' });
  });

  it('does not take the original picture, where the one setting for all games stood untouched, for a choice', () => {
    localStorage.setItem(KEY, JSON.stringify({ display: 'classic', scaling: 'smooth' }));
    expect(loadSettings().picture).toEqual({});
    expect(pictures()).toMatchObject({ fo1: 'classic', fo2: 'classic', ettu: 'high' });
  });

  it('is kept game by game', () => {
    const settings = loadSettings();
    saveSettings({ ...settings, picture: { ...settings.picture, ettu: 'classic', fo2: 'wide', 'my-mod': 'high' } });
    expect(pictures()).toEqual({ fo1: 'classic', fo2: 'wide', ettu: 'classic', olympus: 'high', 'my-mod': 'high' });
  });

  it('a choice made game by game stands over the old one for all', () => {
    localStorage.setItem(KEY, JSON.stringify({ display: 'wide', picture: { ettu: 'classic' } }));
    expect(loadSettings().picture).toEqual({ fo1: 'wide', fo2: 'wide', ettu: 'classic' });
  });

  it('does not take a value it does not know', () => {
    localStorage.setItem(KEY, JSON.stringify({ display: 'huge', picture: { fo1: 'wide', fo2: 7, ettu: 'ultra', 'Not An Id': 'high', other: 'high' } }));
    // A game it does not know of yet may be a mod loaded later: its choice is kept.
    expect(loadSettings().picture).toEqual({ fo1: 'wide', other: 'high' });
    localStorage.setItem(KEY, JSON.stringify({ picture: 'wide' }));
    expect(loadSettings().picture).toEqual({});
  });

  it('never hands out the defaults themselves', () => {
    loadSettings().picture.fo1 = 'high';
    localStorage.setItem(KEY, 'not json');
    loadSettings().picture.fo2 = 'high';
    localStorage.setItem(KEY, JSON.stringify({ sound: false }));
    loadSettings().picture.ettu = 'wide';
    loadSettings().decks.fo2 = 'ettu';
    expect(DEFAULT_SETTINGS.picture).toEqual({});
    expect(DEFAULT_SETTINGS.decks).toEqual({});
  });
});

describe('what a deck plays', () => {
  it('is the game itself until a mod of it is put in it', () => {
    expect(deckGame(loadSettings(), 'fo2')).toBe('fo2');
    saveSettings({ ...loadSettings(), decks: { fo2: 'ettu' } });
    expect(deckGame(loadSettings(), 'fo2')).toBe('ettu');
    expect(deckGame(loadSettings(), 'fo1')).toBe('fo1');
  });

  it('is never a mod of another game, nor one that is not here', () => {
    localStorage.setItem(KEY, JSON.stringify({ decks: { fo1: 'ettu', fo2: 'gone', fo3: 'ettu', other: 7 } }));
    const settings = loadSettings();
    // What looks like a mod is kept: it may be loaded again. It is not played while it is not here.
    expect(settings.decks).toEqual({ fo1: 'ettu', fo2: 'gone' });
    expect(deckGame(settings, 'fo1')).toBe('fo1');
    expect(deckGame(settings, 'fo2')).toBe('fo2');
    localStorage.setItem(KEY, JSON.stringify({ decks: { fo2: 'fo1' } }));
    expect(loadSettings().decks).toEqual({});
  });
});
