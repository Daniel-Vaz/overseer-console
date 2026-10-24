import 'fake-indexeddb/auto';
import { zipSync } from 'fflate';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAddon, setAddonOn } from '../../src/lib/addons';
import { AUTOSAVE_PLANS, planIndex, planLabel } from '../../src/lib/autosave';
import { registerMod } from '../../src/lib/games';
import { saveMapFiles } from '../../src/lib/savefile';
import { addonList, addonsMissing, addonsToSwitchOn, encodeSaveMeta, parseSaveMeta, saveMetaPath } from '../../src/lib/savemeta';
import { readSaveArchive } from '../../src/lib/saves';
import { loadSettings } from '../../src/lib/settings';
import { buildSave } from '../saves';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, String(value));
  removeItem = (key: string) => void this.items.delete(key);
}

beforeAll(() => {
  registerMod({ id: 'sonora', known: 'sonora', title: 'Fallout: Sonora', base: 'fo2' });
});

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('when the game is autosaved', () => {
  it('steps from off to new maps alone, then new maps with each interval', () => {
    expect(AUTOSAVE_PLANS.map(planLabel)).toEqual(['OFF', 'NEW MAPS', 'MAPS + 5 MIN', 'MAPS + 10 MIN', 'MAPS + 15 MIN', 'MAPS + 30 MIN']);
    expect(planIndex({ minutes: 10, maps: true })).toBe(3);
    // A clock without the maps is no longer offered: it stands where the same clock with them does.
    expect(planIndex({ minutes: 15, maps: false })).toBe(4);
  });

  it('is on new maps by default, and was for anyone whose autosaves were on; off stays off', () => {
    expect(loadSettings()).toMatchObject({ autosave: 10, autosaveMaps: true });
    localStorage.setItem('overseer-console:settings', JSON.stringify({ autosave: 30 }));
    expect(loadSettings()).toMatchObject({ autosave: 30, autosaveMaps: true });
    localStorage.setItem('overseer-console:settings', JSON.stringify({ autosave: 0 }));
    expect(loadSettings()).toMatchObject({ autosave: 0, autosaveMaps: false });
    localStorage.setItem('overseer-console:settings', JSON.stringify({ autosave: 0, autosaveMaps: true }));
    expect(loadSettings()).toMatchObject({ autosave: 0, autosaveMaps: true });
  });
});

const tweaks = { id: 'fo2tweaks', title: 'FO2tweaks', version: '14.7', base: 'fo2' as const };
const orders = { id: 'party-orders', title: 'Party Orders', base: 'fo2' as const };

describe('what a save says it was made with', () => {
  it('is kept in a file of its own beside SAVE.DAT, and read back', () => {
    expect(saveMetaPath(3)).toEqual({ key: 'data/savegame/slot03/overseer.json', path: 'data/SAVEGAME/SLOT03/OVERSEER.JSON' });
    const meta = { game: 'fo2', addons: [{ id: 'fo2tweaks', title: 'FO2tweaks', version: '14.7' }] };
    expect(parseSaveMeta(encodeSaveMeta(meta))).toEqual(meta);
    expect(parseSaveMeta(new TextEncoder().encode('{"game":"../x"}'))).toBeNull();
    expect(parseSaveMeta(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('names the add-ons it was made with that are off now, and those that can be switched back on', () => {
    registerAddon(tweaks);
    registerAddon(orders);
    setAddonOn('fo2', 'fo2tweaks', true);
    const meta = { game: 'fo2', addons: [{ id: 'fo2tweaks', title: 'FO2tweaks' }, { id: 'party-orders', title: 'Party Orders' }, { id: 'gone', title: 'Gone Mod' }] };
    const missing = addonsMissing(meta, 'fo2');
    expect(missing.map((addon) => addon.id)).toEqual(['party-orders', 'gone']);
    expect(addonsToSwitchOn(missing, 'fo2').map((addon) => addon.id)).toEqual(['party-orders']);
    // A mod of the same game takes them too; the other game does not.
    expect(addonsToSwitchOn(missing, 'sonora').map((addon) => addon.id)).toEqual(['party-orders']);
    expect(addonsToSwitchOn(missing, 'fo1')).toEqual([]);
    expect(addonList(missing)).toBe('Party Orders and Gone Mod');
    expect(addonsMissing(null, 'fo2')).toEqual([]);
  });
});

describe('a save restored from a zip', () => {
  const slot = (files: Record<string, Uint8Array>) => new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [`SAVEGAME/SLOT04/${name}`, data])))]);
  const save = buildSave({ game: 'fo2', maps: ['ARTEMPLE.SAV', 'ARCAVES.SAV', 'DENBUS1.SAV'] });
  const map = new Uint8Array([1, 2, 3]);

  it('reads the map files its SAVE.DAT names', () => {
    expect(saveMapFiles(save, 'fo2')).toEqual(['ARTEMPLE.SAV', 'ARCAVES.SAV', 'DENBUS1.SAV']);
    expect(saveMapFiles(buildSave({ game: 'fo1', maps: ['V13ENT.SAV'] }), 'fo1')).toEqual(['V13ENT.SAV']);
    expect(saveMapFiles(save.subarray(0, 0x83 + 224 * 133 + 200), 'fo2')).toBeNull();
  });

  it('is turned away without a map file it names: the engines give up loading it at the first', async () => {
    await expect(readSaveArchive('fo2', slot({ 'SAVE.DAT': save, 'ARTEMPLE.SAV': map, 'ARCAVES.SAV': map }))).rejects.toThrow(
      'SLOT04 in that archive lacks a map file its SAVE.DAT names (DENBUS1.SAV). The game cannot load it without it.',
    );
    const whole = await readSaveArchive('fo2', slot({ 'SAVE.DAT': save, 'ARTEMPLE.SAV': map, 'arcaves.sav': map, 'DENBUS1.SAV': map }));
    expect(whole).toMatchObject({ slots: [4], warnings: [] });
  });

  it('says what may keep it from playing as it was made: another game, add-ons that are off', async () => {
    registerAddon(orders);
    const meta = encodeSaveMeta({ game: 'sonora', addons: [{ id: 'party-orders', title: 'Party Orders' }] });
    const found = await readSaveArchive('fo2', slot({ 'SAVE.DAT': save, 'ARTEMPLE.SAV': map, 'ARCAVES.SAV': map, 'DENBUS1.SAV': map, 'OVERSEER.JSON': meta }));
    expect(found.warnings).toEqual([
      'SLOT04 was saved in Fallout: Sonora, not in Fallout 2.',
      'SLOT04 was made with Party Orders on, which is not on for Fallout 2. The console offers to switch it on when the save is played.',
    ]);
  });

  it('is let through when its SAVE.DAT cannot be read past the header: what the console is not sure of, it does not hold against it', async () => {
    const found = await readSaveArchive('fo2', slot({ 'SAVE.DAT': save.subarray(0, 0x83 + 224 * 133 + 200) }));
    expect(found).toMatchObject({ slots: [4], warnings: [] });
  });
});
