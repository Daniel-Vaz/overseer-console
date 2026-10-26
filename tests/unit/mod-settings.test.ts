import { describe, expect, it } from 'vitest';
import { packDat2 } from '../../src/lib/datpack';
import {
  COPIES,
  changeSetting,
  changedSettings,
  changesOf,
  forgetSettings,
  latin1,
  readSettings,
  readSettingsFile,
  settingId,
  settingsCopies,
  settingsFilesOf,
  withChanges,
  type Opener,
} from '../../src/lib/mods/settings';
import type { SourceBlob } from '../../src/lib/storage/opfs';
import { mountGame } from '../../src/lib/storage/mount';
import type { Manifest } from '../../src/lib/storage/manifest';

/** FO2tweaks' settings, as its file has them: a comment above each, a setting left in a comment. */
const TWEAKS = [
  '; set to 1/0 in main section to enable/disable the components',
  '[main]',
  '; set to 0 to disable',
  'worldmap_key=W',
  '; Enable bottomless trunk',
  'trunk_space=0',
  '; Automatically open/walk through unlocked doors when not in combat',
  '; Set to 2 to automatically close the doors then not in combat, too.',
  'autodoors=1',
  '',
  '[highlighting]',
  ';motion_scanner=1',
  'key=42 ; Left Shift',
  'Key=99',
  '',
].join('\r\n');

const blob = (text: string): SourceBlob => new Blob([text]) as unknown as SourceBlob;

describe('readSettings', () => {
  it('reads each setting in order, under its section, with the comments above it', () => {
    expect(readSettings(TWEAKS)).toEqual([
      { section: 'main', key: 'worldmap_key', value: 'W', about: 'set to 0 to disable' },
      { section: 'main', key: 'trunk_space', value: '0', about: 'Enable bottomless trunk' },
      {
        section: 'main',
        key: 'autodoors',
        value: '1',
        about: 'Automatically open/walk through unlocked doors when not in combat Set to 2 to automatically close the doors then not in combat, too.',
      },
      // A setting left in a comment says nothing of the next one; a comment after the value is not part of it; the
      // second of a setting given twice is not read.
      { section: 'highlighting', key: 'key', value: '42', about: '' },
    ]);
  });
});

describe('withChanges', () => {
  it('changes the values asked for in place, and keeps everything else as it was', () => {
    const changed = withChanges(TWEAKS, { [settingId('Main', 'TRUNK_SPACE')]: '1', [settingId('highlighting', 'key')]: '29' });
    expect(changed).toBe(TWEAKS.replace('trunk_space=0', 'trunk_space=1').replace('key=42 ; Left Shift', 'key=29 ; Left Shift'));
    // Only the first of a setting given twice, which is the one read.
    expect(changed).toContain('Key=99');
    expect(withChanges(TWEAKS, {})).toBe(TWEAKS);
  });
});

describe('what the player changed', () => {
  const autodoors = readSettings(TWEAKS)[2]!;

  it('is kept by add-on or mod and by file, and forgotten where it is as it came', () => {
    forgetSettings('fo2tweaks');
    changeSetting('fo2tweaks', 'mods/fo2tweaks.ini', autodoors, '2');
    expect(changesOf('fo2tweaks', 'MODS/FO2TWEAKS.INI')).toEqual({ [settingId('main', 'autodoors')]: '2' });
    expect([...changedSettings('fo2tweaks').keys()]).toEqual(['mods/fo2tweaks.ini']);
    changeSetting('fo2tweaks', 'mods/fo2tweaks.ini', autodoors, '1');
    expect(changedSettings('fo2tweaks').size).toBe(0);
  });
});

describe('settings files', () => {
  // An add-on's settings beside its archive, and a folder of its mods folder packed with its settings in it.
  const filter = packDat2([
    { name: 'InvenFilter.ini', file: blob('[InventoryFilter]\r\n;Set 1 to show the weight\r\nShowWeight=1\r\n') },
    { name: 'scripts/gl_invenfilter.int', file: blob('script') },
  ]);
  const files: Record<string, SourceBlob> = {
    'mods/fo2tweaks.ini': blob(TWEAKS),
    'mods/fo2tweaks.dat': packDat2([{ name: 'scripts/gl_g_autodoors.int', file: blob('script') }]),
    'mods/InventoryFilter.dat': filter,
    'mods/mods_order.ini': blob('InventoryFilter.dat=1\r\n'),
    'ddraw.ini': blob('[Misc]\r\nDamageFormula=0\r\n'),
  };
  const open: Opener = async (path) => files[Object.keys(files).find((name) => name.toLowerCase() === path.toLowerCase()) ?? ''] ?? null;
  const list = Object.entries(files).map(([path, file]) => ({ path, size: file.size }));

  it('are its .ini files, loose and in its archives, but not sfall’s, the load order or the console’s own', async () => {
    const found = await settingsFilesOf(list, open);
    expect(found).toEqual([
      { path: 'mods/fo2tweaks.ini' },
      { path: 'mods/InventoryFilter.dat/invenfilter.ini', archive: 'mods/InventoryFilter.dat' },
    ]);
    expect(await readSettingsFile(found[1]!, open)).toContain('ShowWeight=1');
  });

  it('are written whole for the engine where the player changed them, for the add-on whose file it is', async () => {
    forgetSettings('fo2tweaks');
    forgetSettings('fo2');
    const [weight] = readSettings((await readSettingsFile({ path: 'mods/InventoryFilter.dat/invenfilter.ini', archive: 'mods/InventoryFilter.dat' }, open))!);
    const autodoors = readSettings(TWEAKS)[2]!;
    changeSetting('fo2tweaks', 'mods/InventoryFilter.dat/invenfilter.ini', weight!, '0');
    changeSetting('fo2tweaks', 'mods/fo2tweaks.ini', autodoors, '0');
    // A change made for a file the add-on does not lay there (the game's own) is not its to make.
    changeSetting('fo2', 'mods/fo2tweaks.ini', autodoors, '2');

    const manifest = (game: string, paths: string[], addon?: boolean): Manifest => ({
      version: 1,
      game,
      install: `i${game}`,
      importedAt: 0,
      totalBytes: 0,
      datFormat: 'dat2',
      files: paths.map((path) => ({ path, size: files[path]?.size ?? 1, blob: 'x' })),
      dirs: ['mods'],
      ...(addon ? { addon: { record: { id: game, title: game, base: 'fo2' as const } } } : {}),
    });
    const mounted = mountGame('fo2', manifest('fo2', ['master.dat']), undefined, [manifest('fo2tweaks', Object.keys(files), true)]);
    const copies = await settingsCopies('fo2', mounted, open);
    expect(Object.keys(copies).sort()).toEqual([`${COPIES}/mods/InventoryFilter.dat/invenfilter.ini`, `${COPIES}/mods/fo2tweaks.ini`]);
    expect(latin1(copies[`${COPIES}/mods/InventoryFilter.dat/invenfilter.ini`]!)).toBe('[InventoryFilter]\r\n;Set 1 to show the weight\r\nShowWeight=0\r\n');
    expect(latin1(copies[`${COPIES}/mods/fo2tweaks.ini`]!)).toBe(TWEAKS.replace('autodoors=1', 'autodoors=0'));
    forgetSettings('fo2tweaks');
    forgetSettings('fo2');
  });
});
