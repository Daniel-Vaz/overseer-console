import { describe, expect, it } from 'vitest';
import { ImportError, detectDatFormat, planImport, type SourceFile } from '../../src/lib/storage/importer';

/** A Fallout 2 archive: the last four bytes hold the size of the whole file. */
function dat2(size = 64): File {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  view.setUint32(size - 8, 16, true);
  view.setUint32(size - 4, size, true);
  return new File([data], 'master.dat');
}

/** A Fallout 1 archive: big-endian directory count, then fixed header words. */
function dat1(size = 64): File {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x30, false);
  view.setUint32(4, 0x5e, false);
  view.setUint32(8, 0, false);
  return new File([data], 'MASTER.DAT');
}

const blob = (text = 'x') => new File([text], 'file');
const source = (path: string, file: File = blob()): SourceFile => ({ path, file });

describe('detectDatFormat', () => {
  it('tells the two archive formats apart', async () => {
    expect(await detectDatFormat(dat2())).toBe('dat2');
    expect(await detectDatFormat(dat1())).toBe('dat1');
  });

  it('rejects other files', async () => {
    expect(await detectDatFormat(new File([new Uint8Array(64).fill(0xff)], 'junk'))).toBeNull();
    expect(await detectDatFormat(new File(['tiny'], 'junk'))).toBeNull();
  });
});

describe('planImport', () => {
  const fallout2 = (prefix: string): SourceFile[] => [
    source(`${prefix}master.dat`, dat2()),
    source(`${prefix}critter.dat`, dat2()),
    source(`${prefix}patch000.dat`, dat2()),
    source(`${prefix}fallout2.cfg`, new File(['[system]\nlanguage=german\n'], 'fallout2.cfg')),
    source(`${prefix}fallout2.exe`),
    source(`${prefix}ddraw.dll`),
    source(`${prefix}Manual/manual.pdf`),
    source(`${prefix}sound/music/01hub.acm`),
    source(`${prefix}data/worldmap.dat`),
    source(`${prefix}data/maps/arcaves.sav`),
    source(`${prefix}data/proto/critters/00000001.pro`),
    source(`${prefix}data/SAVEGAME/SLOT01/SAVE.DAT`),
    source(`${prefix}data/Thumbs.db`),
  ];

  it('finds the game, keeps what the engine reads and drops the rest', async () => {
    const plan = await planImport(fallout2('Fallout 2/'));
    expect(plan.game).toBe('fo2');
    expect(plan.root).toBe('Fallout 2');
    expect(plan.entries.map((e) => e.path).sort()).toEqual([
      'critter.dat',
      'data/worldmap.dat',
      'master.dat',
      'patch000.dat',
      'sound/music/01hub.acm',
    ]);
    expect(plan.saves.map((s) => s.path)).toEqual(['data/SAVEGAME/SLOT01/SAVE.DAT']);
    expect(plan.language).toBe('german');
    expect(plan.hasMusic).toBe(true);
    expect(plan.warnings).toEqual([]);
    expect(plan.dirs).toContain('sound/music');
    expect(plan.dirs).toContain('data/SAVEGAME/SLOT01');
  });

  it('works when the files were picked without a folder', async () => {
    const plan = await planImport(fallout2(''));
    expect(plan.root).toBe('');
    expect(plan.entries).toHaveLength(5);
  });

  it('recognises Fallout 1 with upper-case names', async () => {
    const plan = await planImport([
      source('Fallout/MASTER.DAT', dat1()),
      source('Fallout/CRITTER.DAT', dat1()),
      source('Fallout/DATA/SOUND/MUSIC/01HUB.ACM'),
      source('Fallout/FALLOUTW.EXE'),
    ]);
    expect(plan.game).toBe('fo1');
    expect(plan.datFormat).toBe('dat1');
    expect(plan.hasMusic).toBe(true);
  });

  it('prefers the requested game when a selection holds both', async () => {
    const both = [...fallout2('games/Fallout 2/'), source('games/Fallout/MASTER.DAT', dat1()), source('games/Fallout/CRITTER.DAT', dat1())];
    expect((await planImport(both, 'fo1')).game).toBe('fo1');
    expect((await planImport(both, 'fo2')).game).toBe('fo2');
  });

  it('warns when there is no music', async () => {
    const plan = await planImport([source('master.dat', dat2()), source('critter.dat', dat2()), source('patch000.dat', dat2())]);
    expect(plan.hasMusic).toBe(false);
    expect(plan.warnings).toHaveLength(1);
  });

  it('explains what is wrong with an unusable selection', async () => {
    await expect(planImport([])).rejects.toBeInstanceOf(ImportError);
    await expect(planImport([source('readme.txt')])).rejects.toThrow(/MASTER\.DAT/);
    await expect(planImport([source('master.dat', new File([new Uint8Array(64).fill(0xff)], 'x'))])).rejects.toThrow(/not a Fallout/);
    await expect(planImport([source('master.dat', dat2()), source('critter.dat', dat2())])).rejects.toThrow(/PATCH000\.DAT is missing/);
  });
});
