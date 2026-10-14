import { describe, expect, it } from 'vitest';
import { CLASSIC_SCREEN, baseFiles, buildConfigFiles, chooseScreen, highScreen, musicPath, wantsEngineData, wideScreen } from '../../src/lib/engine/config';
import type { GameId } from '../../src/lib/games';
import { Ini } from '../../src/lib/ini';
import type { Manifest } from '../../src/lib/storage/manifest';

function manifest(game: GameId, paths: string[], installConfig?: string): Manifest {
  return {
    version: 1,
    game,
    install: 'itest',
    importedAt: 0,
    totalBytes: 0,
    datFormat: game === 'fo1' ? 'dat1' : 'dat2',
    files: paths.map((path) => ({ path, size: 1, pack: [0, 1] })),
    dirs: [],
    installConfig,
  };
}

describe('wideScreen', () => {
  it('keeps the original height and widens to the window shape', () => {
    expect(wideScreen(1920, 1080)).toEqual({ width: 854, height: 480 });
    expect(wideScreen(1440, 900)).toEqual({ width: 768, height: 480 });
  });

  it('never goes below the classic picture or above the cap', () => {
    expect(wideScreen(600, 900)).toEqual(CLASSIC_SCREEN);
    expect(wideScreen(5120, 1440)).toEqual({ width: 1280, height: 480 });
    expect(wideScreen(1000, 0)).toEqual(CLASSIC_SCREEN);
  });
});

describe('highScreen', () => {
  it('is half as tall again as the original, and as wide as the window', () => {
    expect(highScreen(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(highScreen(1440, 900)).toEqual({ width: 1152, height: 720 });
    expect(highScreen(600, 900)).toEqual({ width: 960, height: 720 });
    expect(highScreen(5120, 1440)).toEqual({ width: 1280, height: 720 });
  });
});

describe('chooseScreen', () => {
  const window = { width: 1920, height: 1080 };

  it('follows the picture setting, whichever game it is', () => {
    expect(chooseScreen('classic', window)).toEqual(CLASSIC_SCREEN);
    expect(chooseScreen('wide', window)).toEqual({ width: 854, height: 480 });
    expect(chooseScreen('high', window)).toEqual({ width: 1280, height: 720 });
  });
});

describe('musicPath', () => {
  it('finds the music wherever the install keeps it', () => {
    expect(musicPath('fo2', manifest('fo2', ['sound/music/01hub.acm']))).toBe('sound\\music\\');
    expect(musicPath('fo2', manifest('fo2', ['data/sound/music/01hub.acm']))).toBe('data\\sound\\music\\');
    expect(musicPath('fo1', manifest('fo1', ['DATA/SOUND/MUSIC/01HUB.ACM']))).toBe('data\\sound\\music\\');
  });

  it('falls back to the stock location', () => {
    expect(musicPath('fo1', manifest('fo1', ['MASTER.DAT']))).toBe('data\\sound\\music\\');
  });
});

describe('buildConfigFiles', () => {
  it('keeps the player\'s choices and sets the machine-specific keys (Fallout 2)', () => {
    const saved = '[preferences]\ncombat_speed=50\n[system]\nmaster_dat=X:\\elsewhere\\master.dat\nlanguage=german\n[screen]\nwindowed=0\n';
    const files = buildConfigFiles({
      game: 'fo2',
      manifest: manifest('fo2', ['sound/music/a.acm']),
      savedConfig: saved,
      screen: { width: 854, height: 480 },
      skipIntro: true,
    });
    expect(Object.keys(files)).toEqual(['fallout2.cfg']);
    const ini = Ini.parse(files['fallout2.cfg']!);
    expect(ini.get('preferences', 'combat_speed')).toBe('50');
    expect(ini.get('system', 'language')).toBe('german');
    expect(ini.get('system', 'master_dat')).toBe('master.dat');
    expect(ini.get('system', 'master_patches')).toBe('data');
    expect(ini.get('sound', 'music_path1')).toBe('sound\\music\\');
    expect(ini.get('screen', 'resolution_x')).toBe('854');
    expect(ini.get('screen', 'resolution_y')).toBe('480');
    expect(ini.get('screen', 'windowed')).toBe('1');
    expect(ini.get('screen', 'mouse_lock')).toBe('0');
    expect(ini.get('ui', 'skip_opening_movies')).toBe('1');
  });

  it('starts from the install\'s settings when the engine never saved its own', () => {
    const files = buildConfigFiles({
      game: 'fo1',
      manifest: manifest('fo1', ['DATA/SOUND/MUSIC/A.ACM'], '[preferences]\nviolence_level=3\n'),
      screen: CLASSIC_SCREEN,
      skipIntro: false,
    });
    expect(Object.keys(files).sort()).toEqual(['f1_res.ini', 'fallout.cfg']);
    const cfg = Ini.parse(files['fallout.cfg']!);
    expect(cfg.get('preferences', 'violence_level')).toBe('3');
    expect(cfg.get('system', 'language')).toBe('english');
    expect(cfg.get('system', 'skip_opening_movies')).toBe('0');
    const res = Ini.parse(files['f1_res.ini']!);
    expect(res.get('MAIN', 'SCR_WIDTH')).toBe('640');
    expect(res.get('MAIN', 'SCR_HEIGHT')).toBe('480');
    expect(res.get('MAIN', 'WINDOWED')).toBe('1');
  });

  it('points a conversion at the game it runs on, and at what it borrowed', () => {
    const shipped =
      '[system]\nmaster_dat=..\\master.dat\ncritter_dat=..\\critter.dat\ncritter_patches=data\n[sound]\nmusic_path2=..\\data\\sound\\music\\\n[preferences]\ntext_base_delay=3.5\n';
    const base = manifest('fo2', ['MASTER.DAT', 'critter.dat', 'patch000.dat', 'sound/music/01hub.acm', 'sound/music/02mstrat.acm', 'sound/sfx/x.acm']);
    const files = buildConfigFiles({
      game: 'ettu',
      manifest: manifest('ettu', ['mods/fo1_base', 'fallout1.dat', 'data/sound/music/01HUB.ACM', 'mods/mods_order.txt'], shipped),
      base,
      screen: { width: 1280, height: 720 },
      skipIntro: false,
    });
    expect(Object.keys(files).sort()).toEqual(['fallout2.cfg', 'mods/sfall-mods.ini']);
    const ini = Ini.parse(files['fallout2.cfg']!);
    expect(ini.get('preferences', 'text_base_delay')).toBe('3.5');
    expect(ini.get('system', 'master_dat')).toBe('fo2\\master.dat');
    expect(ini.get('system', 'critter_dat')).toBe('fo2\\critter.dat');
    expect(ini.get('system', 'master_patches')).toBe('data');
    expect(ini.get('system', 'critter_patches')).toBe('fallout1.dat');
    expect(ini.get('sound', 'music_path1')).toBe('data\\sound\\music\\');
    expect(ini.get('sound', 'music_path2')).toBe('fo2\\sound\\music\\');
    expect(ini.get('screen', 'resolution_x')).toBe('1280');
    expect(ini.get('screen', 'resolution_y')).toBe('720');
    expect(ini.get('ui', 'skip_opening_movies')).toBe('0');

    // The archives and the music of the game underneath are all it is given of it.
    expect(baseFiles('fo2', base).sort()).toEqual(['MASTER.DAT', 'critter.dat', 'sound/music/01hub.acm', 'sound/music/02mstrat.acm']);

    // A copy whose Fallout files were never borrowed keeps the plain patch folder.
    const bare = buildConfigFiles({ game: 'ettu', manifest: manifest('ettu', ['mods/fo1_base']), base, screen: CLASSIC_SCREEN, skipIntro: true });
    expect(Ini.parse(bare['fallout2.cfg']!).get('system', 'critter_patches')).toBe('data');
  });

  it('switches on what the engine of Fallout 2 adds, and off again', () => {
    const start = { game: 'fo2' as const, manifest: manifest('fo2', ['master.dat']), screen: { width: 1280, height: 720 }, skipIntro: false };
    const improved = buildConfigFiles({ ...start, improvements: true });
    const ini = Ini.parse(improved['fallout2.cfg']!);
    expect(ini.get('ui', 'inventory_columns')).toBe('2');
    expect(ini.get('ui', 'extend_ap_bar')).toBe('1');
    expect(ini.get('ui', 'expand_barter_window')).toBe('1');
    expect(ini.get('qol', 'auto_open_doors')).toBe('1');
    expect(ini.get('qol', 'party_loot_and_barter')).toBe('1');
    // Quick saves keep asking for their slot: rotating ones would replace saves made by hand.
    expect(ini.get('ui', 'auto_quick_save')).toBeUndefined();
    // What the key that lights things up does is set in a file of the engine's own script.
    expect(Object.keys(improved).sort()).toEqual(['fallout2.cfg', 'mods/sfall-mods.ini']);
    expect(improved['mods/sfall-mods.ini']).toContain('[Highlighting]\r\nKey=42\r\n');
    // Nothing lies in the open in most of the games: a line-of-sight test hides the lot.
    expect(improved['mods/sfall-mods.ini']).toContain('CheckLOS=0');

    // Switched off, the engine is told so: it keeps what it was last told.
    const original = buildConfigFiles({ ...start, savedConfig: improved['fallout2.cfg'], improvements: false });
    const plain = Ini.parse(original['fallout2.cfg']!);
    expect(plain.get('ui', 'inventory_columns')).toBe('1');
    expect(plain.get('ui', 'extend_ap_bar')).toBe('0');
    expect(plain.get('qol', 'auto_open_doors')).toBe('0');
    expect(Object.keys(original)).toEqual(['fallout2.cfg']);

    // Settings a mod of the player's brought for other things are theirs.
    const theirs = ['; mine', '[Highlighting]', 'Key = 29 ; left ctrl', 'Corpses=0', '', '[CombatControl]', 'Mode=3', ''].join('\r\n');
    const modded = buildConfigFiles({ ...start, improvements: true, installMods: theirs });
    expect(modded['mods/sfall-mods.ini']).toContain('; mine\r\n[Highlighting]\r\nKey=42\r\n');
    expect(modded['mods/sfall-mods.ini']).toContain('[CombatControl]\r\nMode=3\r\n');
    expect(modded['mods/sfall-mods.ini']).not.toContain('Corpses=0');
  });

  it('lights things up the same way in every game the console has', () => {
    const start = { manifest: manifest('fo2', ['master.dat']), screen: CLASSIC_SCREEN, skipIntro: false, improvements: true };
    const CONSOLE = [
      '[Highlighting]',
      'Key=42',
      'Containers=1',
      'Corpses=1',
      'Critters=0',
      'CheckLOS=0',
      'OutlineColor=16',
      'OutlineColorContainers=32',
      'OutlineColorContainersEmpty=4',
      'OutlineColorCorpses=32',
      'OutlineColorCorpsesEmpty=4',
      'MotionScanner=0',
      '',
    ].join('\r\n');

    // Et Tu brings this file itself: the left CTRL key, and nothing lit that is not an item in plain sight.
    const base = manifest('fo2', ['master.dat', 'critter.dat']);
    const ettu = buildConfigFiles({
      ...start,
      game: 'ettu',
      manifest: manifest('ettu', ['mods/fo1_base', 'mods/sfall-mods.ini']),
      base,
      installMods: '[Highlighting]\r\nKey=29\r\nContainers=0\r\nCheckLOS=1\r\n',
    });
    expect(ettu['mods/sfall-mods.ini']).toBe(CONSOLE);

    // A file that says nothing about it keeps what it does say, and gets the console's.
    const quiet = buildConfigFiles({ ...start, game: 'fo2', installMods: '[CombatControl]\r\nMode=3\r\n' });
    expect(quiet['mods/sfall-mods.ini']).toBe(`[CombatControl]\r\nMode=3\r\n\r\n${CONSOLE}`);

    // Nothing to change: the game's own file is left where it is.
    const already = buildConfigFiles({ ...start, game: 'fo2', installMods: CONSOLE });
    expect(Object.keys(already)).toEqual(['fallout2.cfg']);

    // Switched off, Fallout 2 is not given the engine's script and nothing is written for it.
    const off = buildConfigFiles({ ...start, game: 'fo2', improvements: false, installMods: '[Highlighting]\r\nKey=29\r\n' });
    expect(Object.keys(off)).toEqual(['fallout2.cfg']);
  });

  it('leaves the other games as they are', () => {
    // Et Tu brings its makers' choice of the same settings; the engine of Fallout has none of them.
    const shipped = '[ui]\ninventory_columns=1\n[qol]\nparty_loot_and_barter=1\n';
    const base = manifest('fo2', ['master.dat', 'critter.dat']);
    const ettu = buildConfigFiles({ game: 'ettu', manifest: manifest('ettu', ['mods/fo1_base'], shipped), base, screen: CLASSIC_SCREEN, skipIntro: false, improvements: true });
    expect(Object.keys(ettu).sort()).toEqual(['fallout2.cfg', 'mods/sfall-mods.ini']);
    const ini = Ini.parse(ettu['fallout2.cfg']!);
    expect(ini.get('ui', 'inventory_columns')).toBe('1');
    expect(ini.get('ui', 'extend_ap_bar')).toBeUndefined();
    expect(ini.get('qol', 'party_loot_and_barter')).toBe('1');

    const fallout = buildConfigFiles({ game: 'fo1', manifest: manifest('fo1', ['MASTER.DAT']), screen: CLASSIC_SCREEN, skipIntro: false, improvements: true });
    expect(Object.keys(fallout).sort()).toEqual(['f1_res.ini', 'fallout.cfg']);
    expect(fallout['fallout.cfg']).not.toContain('inventory_columns');

    // The engine's own data file goes with the improvements, and with a game made for them.
    expect([wantsEngineData('fo2', true), wantsEngineData('fo2', false)]).toEqual([true, false]);
    expect([wantsEngineData('ettu', true), wantsEngineData('ettu', false)]).toEqual([true, true]);
    expect([wantsEngineData('fo1', true), wantsEngineData('fo1', false)]).toEqual([false, false]);
  });

  it('gives Fallout the taller picture too', () => {
    const files = buildConfigFiles({ game: 'fo1', manifest: manifest('fo1', ['MASTER.DAT']), screen: chooseScreen('high', { width: 1920, height: 1080 }), skipIntro: false });
    const res = Ini.parse(files['f1_res.ini']!);
    expect(res.get('MAIN', 'SCR_WIDTH')).toBe('1280');
    expect(res.get('MAIN', 'SCR_HEIGHT')).toBe('720');
  });
});
