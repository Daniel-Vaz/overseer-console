import { describe, expect, it } from 'vitest';
import { CLASSIC_SCREEN, buildConfigFiles, musicPath, wideScreen } from '../../src/lib/engine/config';
import { Ini } from '../../src/lib/ini';
import type { Manifest } from '../../src/lib/storage/manifest';

function manifest(game: 'fo1' | 'fo2', paths: string[], installConfig?: string): Manifest {
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
});
