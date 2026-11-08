import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { SourceFile } from '../../src/lib/storage/importer';
import { DEMO, DEMO_BYTES, DEMO_FILES, demoPath, isReleaseFile, missingDemoFiles } from '../../src/lib/vanburen/demo';
import { findDemo, looksLikeRar } from '../../src/lib/vanburen/store';

const file = (name: string, size = 4) => new File([new Uint8Array(size)], name.split('/').pop()!);

/** The demo's folder as a selection: every file the engine reads, and some it does not, below `root`. */
function demoFolder(root: string, leave: string[] = []): SourceFile[] {
  const paths = [...DEMO_FILES.map(([path]) => path).filter((path) => !leave.includes(path)), 'F3.exe', 'binkw32.dll', 'Movies/BISlogo.mve', 'data/Demo/data/Sounds.grp', 'readme.txt'];
  return paths.map((path) => ({ path: root ? `${root}/${path}` : path, file: file(path) }));
}

describe('the files of the tech demo', () => {
  it('are what the engine reads of the archive.org release', () => {
    expect(DEMO_FILES).toHaveLength(29);
    expect(DEMO_BYTES).toBe(587_262_534);
    expect(DEMO.archive.size).toBe(253_425_960);
  });

  it('are found by their path in any case, and the rest is left', () => {
    expect(demoPath('DATA/maps.GRP')).toBe('data/Maps.grp');
    expect(demoPath('data\\Critters.grp')).toBe('data/Critters.grp');
    expect(demoPath('fonts/tt0807m_.ttf')).toBe('Fonts/TT0807M_.TTF');
    expect(demoPath('F3.exe')).toBeNull();
    expect(demoPath('Movies/IPlogo.mve')).toBeNull();
    // The second copy of Sounds.grp is the first one again.
    expect(demoPath('data/Demo/data/Sounds.grp')).toBeNull();
  });

  it('keeps loose files that replace packaged ones, under Override', () => {
    expect(demoPath('override/Engine/sys.ini')).toBe('Override/Engine/sys.ini');
    expect(demoPath('Override')).toBeNull();
  });

  it('tells which are missing', () => {
    expect(missingDemoFiles(DEMO_FILES.map(([path]) => path.toUpperCase()))).toEqual([]);
    expect(missingDemoFiles(['resource.rht', 'English.stf'])).toContain('data/Maps.grp');
  });

  it('tells the release by its sizes and CRCs', () => {
    expect(isReleaseFile('data/Engine.grp', 870_872, 0xa5e771af)).toBe(true);
    expect(isReleaseFile('data/Engine.grp', 870_872)).toBe(true);
    // The copy that starts in the Vault has an Engine.grp of its own.
    expect(isReleaseFile('data/Engine.grp', 870_872, 0x12345678)).toBe(false);
    expect(isReleaseFile('data/Engine.grp', 870_900)).toBe(false);
    expect(isReleaseFile('F3.exe', 3_194_880)).toBe(false);
  });
});

describe('finding the tech demo in what was picked', () => {
  it('takes its archive', async () => {
    const rar = file('F3_Demo.rar');
    const found = await findDemo([{ path: 'Downloads/notes.txt', file: file('notes.txt') }, { path: 'Downloads/F3_Demo.rar', file: rar }]);
    expect(found).toEqual({ kind: 'archive', file: rar });
    expect(looksLikeRar('f3_demo.RAR')).toBe(true);
  });

  it('takes the folder it was unpacked to, wherever it lies in the selection', async () => {
    const found = await findDemo(demoFolder('Games/Fallout 3 Van Buren Tech Demo'));
    expect(found.kind).toBe('folder');
    const paths = found.kind === 'folder' ? found.files.map((source) => source.path) : [];
    expect(paths).toContain('resource.rht');
    expect(paths).toContain('data/Maps.grp');
    expect(paths.every((path) => !path.startsWith('Games/'))).toBe(true);
  });

  it('takes a zip of the folder', async () => {
    const files = Object.fromEntries(DEMO_FILES.map(([path]) => [`F3_Demo/${path}`, new Uint8Array(4)]));
    const zip = zipSync(files, { level: 0 });
    const found = await findDemo([{ path: 'F3_Demo.zip', file: new File([zip as Uint8Array<ArrayBuffer>], 'F3_Demo.zip') }]);
    expect(found.kind).toBe('folder');
    if (found.kind === 'folder') expect(found.files).toHaveLength(29);
  });

  it('turns down a folder that is missing files, and one that is not the demo', async () => {
    await expect(findDemo(demoFolder('', ['data/Maps.grp']))).rejects.toThrow('missing files of the tech demo: data/Maps.grp');
    await expect(findDemo([{ path: 'Fallout 2/master.dat', file: file('master.dat') }])).rejects.toThrow('not in what you selected');
  });
});
