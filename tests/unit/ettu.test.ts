import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readRange } from '../../src/lib/blobs';
import { findInDat, readDatEntry } from '../../src/lib/dat';
import { BORROWED_ARCHIVE, enabledMods, findEttu } from '../../src/lib/storage/ettu';
import { ImportError, openArchives, planImport, type ImportContext, type SourceFile } from '../../src/lib/storage/importer';
import { ascii } from '../archives';
import { MOVIE, PERKS, SPEECH, TILE, ettuFiles, fallout1Master, fallout2Master, type EttuOptions } from '../ettu';

const file = (data: Uint8Array | Blob, name = 'file') => new File([data as Uint8Array<ArrayBuffer>], name);

/** The package as a folder picked from disk. */
function packageSources(prefix: string, options: EttuOptions = {}): SourceFile[] {
  return Object.entries(ettuFiles(options)).map(([path, data]) => ({ path: `${prefix}${path}`, file: file(data) }));
}

const withFallout: ImportContext = { archiveOf: async (game) => (game === 'fo1' ? fallout1Master() : null) };
const withoutFallout: ImportContext = { archiveOf: async () => null };

/** Reads a file out of one of the archives a plan stores. */
async function inArchive(plan: { entries: SourceFile[] }, archive: string, path: string): Promise<Uint8Array | null> {
  const entry = plan.entries.find((candidate) => candidate.path === archive);
  if (!entry) return null;
  const found = (await findInDat(entry.file, 'dat2', [path])).get(path.toLowerCase());
  return found ? readDatEntry(entry.file, 'dat2', found) : null;
}

describe('findEttu', () => {
  it('finds the folder that holds the mods, wherever it is', () => {
    expect(findEttu(packageSources('Fallout1in2/'))).toBe('fallout1in2');
    expect(findEttu(packageSources('Fallout 2/Fallout1in2/'))).toBe('fallout 2/fallout1in2');
    expect(findEttu(packageSources(''))).toBe('');
    expect(findEttu(packageSources('Fo1in2-master/Fallout2/Fallout1in2/'))).toBe('fo1in2-master/fallout2/fallout1in2');
  });

  it('is not fooled by a Fallout 2 with other mods', () => {
    expect(findEttu([{ path: 'Fallout 2/mods/mods_order.txt', file: file(ascii('rpu.dat')) }, { path: 'Fallout 2/mods/rpu.dat', file: file(ascii('x')) }])).toBeNull();
    expect(findEttu([])).toBeNull();
  });
});

describe('enabledMods', () => {
  it('reads the load order as the engine does', () => {
    expect(enabledMods('fo1_base\r\n  fo1_interface  \r\n;InterfaceUpscaled\r\n\r\n# a note\nSome_Mod.dat\nhalf ; commented\nfo1_base\n')).toEqual([
      'fo1_base',
      'fo1_interface',
      'some_mod.dat',
    ]);
  });
});

describe('planning Fallout Et Tu', () => {
  it('stores the mods and the borrowed files as archives, and what is read by path as files', async () => {
    const plan = await planImport(packageSources('Fallout1in2/', { forEngine: true }), 'ettu', withFallout);
    expect(plan.game).toBe('ettu');
    expect(plan.root).toBe('Fallout1in2');
    expect(plan.entries.map((entry) => entry.path).sort()).toEqual([
      'config/Perks.ini',
      'config/fo1_settings.ini',
      'data/sound/music/01HUB.ACM',
      'data/text/english/Translations.ini',
      'ddraw.ini',
      'f2_res.ini',
      BORROWED_ARCHIVE,
      'mods/fo1_base',
      'mods/fo1_interface',
      'mods/mods_order.txt',
      'mods/sfall-mods.ini',
    ]);
    // Folders the engine will be given: none where an archive takes a folder's place.
    expect(plan.dirs).toEqual(['config', 'data', 'data/sound', 'data/sound/music', 'data/text', 'data/text/english', 'mods']);
    expect(plan.installConfig).toContain('text_base_delay=3.5');
    expect(plan.language).toBe('english');
    expect(plan.hasMusic).toBe(true);
    expect(plan.warnings).toEqual([]);
    expect(plan.notes).toEqual(['3 files taken from your Fallout in deck A.', '2 optional mods switched off in mods_order.txt were left out.']);
    // 8 files kept as files, 8 in the two mods, 3 borrowed.
    expect(plan.sourceFiles).toBe(19);
    expect(plan.totalBytes).toBe(plan.entries.reduce((sum, entry) => sum + entry.file.size, 0));

    expect(await inArchive(plan, 'mods/fo1_base', 'text/english/game/perk.msg')).toEqual(ascii(PERKS));
    expect(await inArchive(plan, 'mods/fo1_base', 'ART/CRITTERS/hmjmpsaa.frm')).toEqual(new Uint8Array(1500).fill(7));
    expect(await inArchive(plan, 'mods/fo1_interface', 'art/intrface/iface.frm')).toEqual(new Uint8Array(1100).fill(10));
    expect(await inArchive(plan, 'mods/fo1_base', 'art/intrface/iface.frm')).toBeNull();
  });

  it('takes what Et Tu needs of Fallout out of its MASTER.DAT, however it is stored there', async () => {
    const plan = await planImport(packageSources(''), 'ettu', withFallout);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'art/cuts/intro.mve')).toEqual(MOVIE);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'sound/speech/ovr/ovr1.acm')).toEqual(SPEECH);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'art/tiles/edg5000.frm')).toEqual(TILE);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'art/cuts/other.mve')).toBeNull();
    // The whole archive can be copied in pieces, as an import does.
    const archive = plan.entries.find((entry) => entry.path === BORROWED_ARCHIVE)!.file;
    const whole = await readRange(archive, 0, archive.size);
    const pieces: Uint8Array[] = [];
    for (let at = 0; at < archive.size; at += 333) pieces.push(await readRange(archive, at, Math.min(archive.size, at + 333)));
    expect(Buffer.concat(pieces).equals(whole)).toBe(true);
  });

  it('needs Fallout loaded, unless the files were already copied out of it', async () => {
    await expect(planImport(packageSources(''), 'ettu', withoutFallout)).rejects.toThrow(/Load Fallout into deck A first/);
    await expect(planImport(packageSources(''), 'ettu')).rejects.toBeInstanceOf(ImportError);

    const plan = await planImport(packageSources('Fallout1in2/', { extracted: true, saves: true }), 'ettu', withoutFallout);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'art/cuts/intro.mve')).toEqual(MOVIE);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'sound/speech/ovr/ovr1.acm')).toEqual(SPEECH);
    expect(plan.notes).toEqual(['2 optional mods switched off in mods_order.txt were left out.']);
    // Saves come along as saves; what a played game left behind does not come at all.
    expect(plan.saves.map((save) => save.path)).toEqual(['data/SAVEGAME/SLOT01/SAVE.DAT']);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'maps/v13ent.sav')).toBeNull();
    expect(plan.entries.some((entry) => /savegame|proto/i.test(entry.path))).toBe(false);
  });

  it('says what is missing from Fallout, and when a package predates the engine', async () => {
    const half: ImportContext = { archiveOf: async () => fallout1Master() };
    const sources = packageSources('').map((source) =>
      source.path === 'undat_files.txt' ? { path: source.path, file: file(ascii('ART\\CUTS\\INTRO.MVE\r\nART\\CUTS\\NOSUCH.MVE\r\n')) } : source,
    );
    const plan = await planImport(sources, 'ettu', half);
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toMatch(/^1 file that Et Tu asks for is not in your Fallout's MASTER\.DAT/);
    expect(plan.warnings[1]).toMatch(/no fallout2-ce\.exe/);
  });

  it('refuses a copy it cannot complete, and says why', async () => {
    await expect(planImport(packageSources('', { withoutList: true }), 'ettu', withFallout)).rejects.toThrow(/undat_files\.txt/);
    // The list may also lie elsewhere in the selection, as in the project's own repository.
    const elsewhere = [...packageSources('repo/Fallout2/Fallout1in2/', { withoutList: true }), { path: 'repo/Tools/UndatUI/undat_files.txt', file: file(ascii('ART\\CUTS\\INTRO.MVE\r\n')) }];
    const plan = await planImport(elsewhere, 'ettu', withFallout);
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'art/cuts/intro.mve')).toEqual(MOVIE);
    await expect(planImport([{ path: 'holiday.jpg', file: file(ascii('x')) }], 'ettu', withFallout)).rejects.toThrow(/No Fallout Et Tu in that selection/);
  });

  it('reads the package straight from the zip it is downloaded as', async () => {
    const zipped = zipSync(Object.fromEntries(Object.entries(ettuFiles({ forEngine: true })).map(([path, data]) => [`Fallout1in2/${path}`, data])));
    const sources = await openArchives([{ path: 'Fallout1in2.zip', file: file(zipped, 'Fallout1in2.zip') }]);
    const plan = await planImport(sources, undefined, withFallout);
    expect(plan.game).toBe('ettu');
    expect(plan.warnings).toEqual([]);
    expect(await inArchive(plan, 'mods/fo1_base', 'maps/v13ent.map')).toEqual(new Uint8Array(2500).fill(9));
    expect(await inArchive(plan, BORROWED_ARCHIVE, 'art/tiles/edg5000.frm')).toEqual(TILE);
    // A zip lying inside a picked folder is left alone; one that is not a zip is named.
    expect(await openArchives([{ path: 'Fallout 2/backup.zip', file: file(ascii('junk')) }])).toHaveLength(1);
    await expect(openArchives([{ path: 'broken.zip', file: file(ascii('junk')) }])).rejects.toThrow(/broken\.zip: That file is not a zip archive/);
  });
});

describe('a selection holding more than one game', () => {
  const fallout2 = (prefix: string): SourceFile[] => [
    { path: `${prefix}master.dat`, file: file(fallout2Master()) },
    { path: `${prefix}critter.dat`, file: file(fallout2Master()) },
    { path: `${prefix}patch000.dat`, file: file(fallout2Master()) },
    { path: `${prefix}sound/music/01hub.acm`, file: file(ascii('x')) },
  ];
  // Et Tu as it is installed on a desktop: in a folder inside Fallout 2.
  const both = [...fallout2('Fallout 2/'), ...packageSources('Fallout 2/Fallout1in2/', { extracted: true })];

  it('loads the game asked for and names the other', async () => {
    const game = await planImport(both, 'fo2');
    expect(game.game).toBe('fo2');
    expect(game.also).toEqual(['ettu']);
    // Nothing of the conversion ends up in the game it sits in.
    expect(game.entries.map((entry) => entry.path).sort()).toEqual(['critter.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm']);

    const conversion = await planImport(both, 'ettu');
    expect(conversion.game).toBe('ettu');
    expect(conversion.root).toBe('Fallout 2/Fallout1in2');
    expect(conversion.also).toEqual(['fo2']);
    expect(conversion.entries.some((entry) => entry.path === 'master.dat')).toBe(false);
  });

  it('takes the game when nothing was asked for, and the conversion when that is all there is', async () => {
    expect((await planImport(both)).game).toBe('fo2');
    expect((await planImport(packageSources('', { extracted: true }))).game).toBe('ettu');
    expect((await planImport(packageSources('', { extracted: true }), 'fo2')).game).toBe('ettu');
  });
});
