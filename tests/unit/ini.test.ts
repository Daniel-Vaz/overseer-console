import { describe, expect, it } from 'vitest';
import { Ini } from '../../src/lib/ini';

describe('Ini', () => {
  it('reads sections, keys and values', () => {
    const ini = Ini.parse('[sound]\r\nmusic_path1=sound\\music\\\r\nmaster_volume=22281\r\n\r\n[system]\r\nlanguage=english\r\n');
    expect(ini.get('sound', 'music_path1')).toBe('sound\\music\\');
    expect(ini.get('sound', 'master_volume')).toBe('22281');
    expect(ini.get('system', 'language')).toBe('english');
    expect(ini.get('system', 'missing')).toBeUndefined();
  });

  it('matches names without regard to case and keeps the original spelling', () => {
    const ini = Ini.parse('[MAIN]\nSCR_WIDTH=1024\n');
    expect(ini.get('main', 'scr_width')).toBe('1024');
    ini.set('main', 'scr_width', 640);
    expect(ini.toString()).toBe('[MAIN]\r\nSCR_WIDTH=640\r\n');
  });

  it('drops comments, including trailing ones', () => {
    const ini = Ini.parse('; a comment\n[MAPS]\nSCROLL_DIST_X=HALF_SCRN ; ORIGINAL 480\n# another\n');
    expect(ini.get('MAPS', 'SCROLL_DIST_X')).toBe('HALF_SCRN');
  });

  it('adds new sections and keys in order', () => {
    const ini = Ini.parse('[a]\nx=1\n');
    ini.set('b', 'y', 2).setDefault('a', 'x', 9).setDefault('a', 'z', 3);
    expect(ini.toString()).toBe('[a]\r\nx=1\r\nz=3\r\n\r\n[b]\r\ny=2\r\n');
  });

  it('survives an empty file', () => {
    expect(Ini.parse('').toString()).toBe('');
  });
});
