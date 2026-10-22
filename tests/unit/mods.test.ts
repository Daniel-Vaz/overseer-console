import { beforeAll, describe, expect, it } from 'vitest';
import { findInDat, readDatEntry } from '../../src/lib/dat';
import { buildConfigFiles, settingsFileOf } from '../../src/lib/engine/config';
import { registerMod, type GameId } from '../../src/lib/games';
import { bytesSource } from '../../src/lib/blobs';
import { Ini } from '../../src/lib/ini';
import { ImportError, planImport, surveySources, type ImportContext, type ImportPlan } from '../../src/lib/storage/importer';
import type { Manifest } from '../../src/lib/storage/manifest';
import { findMod, MOD_DATA, sfallVersionOf } from '../../src/lib/storage/mods';
import { mountGame } from '../../src/lib/storage/mount';
import { ascii } from '../archives';
import {
  fallout1Files,
  fallout2Files,
  fixtFiles,
  fixtInstalledFiles,
  installOf,
  megamodFiles,
  moddedFallout2Files,
  nevadaFiles,
  olympusFiles,
  resurrectionFiles,
  resurrectionInstalledFiles,
  rpuFiles,
  sfallLibrary,
  sonoraFiles,
  sources,
  yesterdayFiles,
} from '../mods';

const fallout2 = installOf('fo2', fallout2Files());
const fallout1 = installOf('fo1', fallout1Files());
/** Both games in their decks. */
const decks: ImportContext = { installOf: async (game) => (game === 'fo2' ? fallout2 : game === 'fo1' ? fallout1 : null) };

/** The manifest an import of `plan` writes, near enough: where each file goes, and what the mod is. */
function manifestOf(plan: ImportPlan): Manifest {
  return {
    version: 1,
    game: plan.game,
    install: 'itest',
    importedAt: 0,
    totalBytes: plan.totalBytes,
    datFormat: plan.datFormat,
    files: plan.entries.map((entry) => ({ path: entry.path, size: entry.file.size, blob: 'x' })),
    dirs: plan.dirs,
    installConfig: plan.installConfig,
    mod: plan.mod,
  };
}

/** Plans a mod as the console loads one, and makes it one of the games here, as an import does. */
async function load(files: Parameters<typeof sources>[0], prefix = '', zip?: string, target?: GameId): Promise<ImportPlan> {
  const plan = await planImport(sources(files, prefix, zip), target ?? 'mod', decks);
  registerMod(plan.mod!.record);
  return plan;
}

const paths = (plan: ImportPlan) => plan.entries.map((entry) => entry.path).sort();
const inArchive = async (plan: ImportPlan, archive: string, path: string): Promise<string | null> => {
  const entry = plan.entries.find((candidate) => candidate.path === archive);
  if (!entry) return null;
  const found = (await findInDat(entry.file, 'dat2', [path])).get(path.toLowerCase());
  return found ? new TextDecoder().decode(await readDatEntry(entry.file, 'dat2', found)) : null;
};
/** Whether an archive of the plan holds a file, without reading the file. */
const listedIn = async (plan: ImportPlan, archive: string, path: string): Promise<boolean> => {
  const entry = plan.entries.find((candidate) => candidate.path === archive);
  return !!entry && (await findInDat(entry.file, 'dat2', [path])).has(path.toLowerCase());
};

describe('finding a mod', () => {
  const find = async (files: Parameters<typeof sources>[0], prefix = '', zip?: string) => {
    const picked = sources(files, prefix, zip);
    return findMod(picked, (await surveySources(picked)).candidates);
  };

  it('knows the mods it knows by a file only they have, or by the name of their folder', async () => {
    expect(await find(rpuFiles(), '', 'rpu_v2.4.34.zip')).toEqual({ root: '', name: 'rpu_v2.4.34', complete: false, base: 'fo2', known: 'rpu', byFile: true });
    expect(await find(rpuFiles(), 'rpu_v2.4.34/')).toMatchObject({ root: 'rpu_v2.4.34', complete: false, known: 'rpu' });
    expect(await find(sonoraFiles(), 'Fallout_Sonora_1_16_E/')).toMatchObject({ root: 'fallout_sonora_1_16_e', complete: true, base: 'fo2', known: 'sonora' });
    expect(await find(olympusFiles(), 'Olympus-2207-English/')).toMatchObject({ complete: true, known: 'olympus' });
    // Nevada has no file of its own the console knows: its folder's name says what it is.
    expect(await find(nevadaFiles(), 'Fallout Nevada/')).toMatchObject({ root: 'fallout nevada', complete: true, base: 'fo2', known: 'nevada' });
    expect((await find(nevadaFiles(), 'Fallout Nevada/'))?.byFile).toBeUndefined();
    expect(await find(fixtFiles(), 'Fallout Fixt/')).toMatchObject({ complete: true, base: 'fo1', known: 'fixt' });
  });

  it('finds an installer\'s own folder inside a game folder by a file of its own', async () => {
    // A Fallout folder Fixt's installer ran in: the game is not the mod, the folder the installer made is.
    expect(await find(fixtInstalledFiles(), 'Fallout/')).toEqual({ root: 'fallout/fallout fixt', name: 'Fallout Fixt', complete: false, base: 'fo1', known: 'fixt', byFile: true });
    // A game folder with no such folder inside stays the mod itself.
    expect(await find(moddedFallout2Files(), 'Fallout 2/')).toMatchObject({ root: 'fallout 2', complete: true });
    // Resurrection's, in Fallout 2's; also where the game's folder is named after the mod.
    expect(await find(resurrectionInstalledFiles(), 'Fallout 2/')).toEqual({ root: 'fallout 2/resurrection', name: 'Resurrection', complete: false, base: 'fo2', known: 'resurrection', byFile: true });
    expect(await find(resurrectionInstalledFiles(), 'Fallout 2 Resurrection/')).toMatchObject({ root: 'fallout 2 resurrection/resurrection', known: 'resurrection' });
  });

  it('knows Resurrection and Fallout Yesterday by files of their own', async () => {
    expect(await find(resurrectionFiles(), '', 'FoRes_EN_1_5.zip')).toEqual({ root: 'resurrection', name: 'Resurrection', complete: false, base: 'fo2', known: 'resurrection', byFile: true });
    expect(await find(yesterdayFiles(), 'FalloutYesterday/')).toEqual({ root: 'falloutyesterday', name: 'FalloutYesterday', complete: false, base: 'fo2', known: 'yesterday', byFile: true });
  });

  it('takes any other mod for what it is: a game folder, or files to unpack into one', async () => {
    expect(await find(moddedFallout2Files(), 'Fallout 2/')).toEqual({ root: 'fallout 2', name: 'Fallout 2', complete: true, base: 'fo2', known: undefined });
    expect(await find({ 'mods/better.dat': 'x', 'mods/better.ini': 'y' }, 'Better Things/')).toMatchObject({ root: 'better things', complete: false, known: undefined });
    // The folders inside a mod's mods folder are not mods of their own.
    expect(await find({ 'mods/a/data/x.int': 'x', 'mods/mods_order.txt': 'a' }, 'Something/')).toMatchObject({ root: 'something' });
    expect(await find({ 'beach.jpg': 'pixels' }, 'Holiday/')).toBeNull();
  });
});

describe('the Restoration Project from its zip', () => {
  let plan: ImportPlan;
  beforeAll(async () => {
    plan = await load(rpuFiles(), '', 'rpu_v2.4.34.zip');
  });

  it('is stored as its installer leaves it in the game folder, less what only a desktop needs', () => {
    expect(plan.game).toBe('rpu');
    expect(plan.mod?.record).toEqual({ id: 'rpu', known: 'rpu', title: 'Restoration Project', version: '2.4.34', base: 'fo2' });
    expect(paths(plan)).toEqual([
      // Its Hero Appearance art, which the engine draws the player with.
      'appearance/hmr00s01.dat',
      'data/scripts/gl_ammomod.int',
      'data/sound/music/01hub.acm',
      'ddraw.ini',
      'f2_res.ini',
      'mods/f2_res.dat',
      'mods/mods_order.txt',
      'mods/npc_armor.dat',
      'mods/party_orders.dat',
      'mods/rpu.dat',
      'mods/rpu.ini',
      'mods/rpu_alternative_explosions.dat',
      'mods/rpu_enhanced_worldmap.dat',
      'mods/sfall-mods.ini',
    ]);
    // What its installer moves out of the game's way.
    expect(plan.mod?.layout).toBe('over');
    expect(plan.mod?.hides).toEqual(['patch000.dat', 'f2_res.dat', 'data/']);
    expect(plan.mod?.keeps).toEqual(['data/savegame/', 'data/*.txt', 'data/*.gcd', 'data/sound/music/']);
    expect(plan.notes).toContain('4 files only a desktop needs (programs, installers) were left out.');
  });

  it('is started over Fallout 2, as a desktop has it once its installer ran', () => {
    const mounted = mountGame('rpu', manifestOf(plan), fallout2.manifest);
    const at = (path: string) => mounted.files.get(path)?.from ?? null;
    expect(at('mods/rpu.dat')).toBe('own');
    expect(at('master.dat')).toBe('base');
    expect(at('critter.dat')).toBe('base');
    expect(at('sound/music/01hub.acm')).toBe('base');
    // Moved aside by its installer: the game's patch archive and its loose data.
    expect(at('patch000.dat')).toBeNull();
    expect(at('f2_res.dat')).toBeNull();
    expect(at('data/worldmap.dat')).toBeNull();
    expect(at('data/art/tiles/grid000.frm')).toBeNull();

    // Its own music first, the game's after it; the game's settings file, as the installer edits it.
    const config = Ini.parse(buildConfigFiles({ game: 'rpu', manifest: manifestOf(plan), base: fallout2.manifest, screen: { width: 640, height: 480 }, skipIntro: false })['fallout2.cfg']!);
    expect(config.get('sound', 'music_path1')).toBe('data\\sound\\music\\');
    expect(config.get('sound', 'music_path2')).toBe('sound\\music\\');
    expect(config.get('preferences', 'combat_speed')).toBe('50');
    expect(config.get('system', 'master_dat')).toBe('master.dat');
    expect(config.get('system', 'critter_patches')).toBe('data');
    expect(config.get('system', 'f2_res_dat')).toBeUndefined();
    // The high resolution patch's art: the game's own is moved aside, the mod's is where its settings for that patch say.
    const highRes = '[MAIN]\r\nSCR_WIDTH=1280\r\nf2_res_dat=mods\\f2_res.dat\r\n';
    const withArt = Ini.parse(buildConfigFiles({ game: 'rpu', manifest: manifestOf(plan), base: fallout2.manifest, screen: { width: 640, height: 480 }, skipIntro: false, highRes })['fallout2.cfg']!);
    expect(withArt.get('system', 'f2_res_dat')).toBe('mods\\f2_res.dat');
    // Not a file it has: left to the engine.
    const elsewhere = Ini.parse(buildConfigFiles({ game: 'rpu', manifest: manifestOf(plan), base: fallout2.manifest, screen: { width: 640, height: 480 }, skipIntro: false, highRes: '[MAIN]\r\nf2_res_dat=hires\\art.dat\r\n' })['fallout2.cfg']!);
    expect(elsewhere.get('system', 'f2_res_dat')).toBeUndefined();
  });

  it('keeps its name when its files are loaded again, and is not taken for another mod', async () => {
    const again = await load(rpuFiles(), 'rpu_v2.4.35/', undefined, 'rpu');
    expect(again.game).toBe('rpu');
    registerMod({ id: 'sonora', known: 'sonora', title: 'Fallout: Sonora', base: 'fo2' });
    await expect(planImport(sources(rpuFiles()), 'sonora', decks)).rejects.toThrow('That is Restoration Project, not Fallout: Sonora.');
  });
});

describe('the Megamod from its zip', () => {
  it('is known by a file of its own, and its tool\'s step is done: its protos into the game\'s data, the patch archive out', async () => {
    const plan = await load(megamodFiles(), '', 'Fallout 2 Megamod 2.47.8.zip');
    expect(plan.game).toBe('megamod');
    expect(plan.mod?.record).toMatchObject({ known: 'megamod', version: '2.47.8', base: 'fo2' });
    expect(plan.notes.join(' ')).toContain('1 of its protos put where its tool would have put them.');
    // The data folder is packed into an archive the engine reads before master.dat: both protos are in it.
    expect(await inArchive(plan, MOD_DATA, 'proto/critters/00000660.pro')).not.toBeNull();
    expect(await inArchive(plan, MOD_DATA, 'proto/critters/00000062.pro')).not.toBeNull();
    expect(paths(plan).some((path) => /^proto\//i.test(path))).toBe(false);
    expect(plan.mod?.hides).toContain('patch000.dat');
    const mounted = mountGame('megamod', manifestOf(plan), fallout2.manifest);
    expect(mounted.files.has('patch000.dat')).toBe(false);
    expect(mounted.files.get('master.dat')?.from).toBe('base');
  });
});

describe('a game folder a mod was installed in', () => {
  let plan: ImportPlan;
  beforeAll(async () => {
    plan = await load(moddedFallout2Files(), 'Fallout 2/');
  });

  it('stores only what differs from the game in the deck, and packs its many small files', async () => {
    expect(plan.game).toBe('fallout-2');
    expect(plan.mod?.record).toEqual({ id: 'fallout-2', title: 'Fallout 2', base: 'fo2', known: undefined, version: undefined });
    expect(paths(plan)).toEqual(['data/config/game.cfg', 'ddraw.ini', MOD_DATA, 'mods/mods_order.txt', 'mods/my_mod']);
    // The game's archives and music are the deck's: started from there, not stored again.
    expect(plan.mod?.reuses?.map((reuse) => reuse.path).sort()).toEqual(['critter.dat', 'master.dat', 'sound/music/01hub.acm', 'sound/music/02mstrlr.acm']);
    expect(plan.notes[1]).toMatch(/^4 files \(3\.\d MB\) the same as your Fallout 2 in deck B are not stored again\.$/);
    expect(plan.mod?.patches).toBe(MOD_DATA);
    expect(await inArchive(plan, MOD_DATA, 'text/english/game/misc.msg')).toBe('{100}{}{hello}');
    expect(await inArchive(plan, MOD_DATA, 'scripts/script7.int')).not.toBeNull();
    expect(await inArchive(plan, MOD_DATA, 'proto/items/items.lst')).toBe('00000001.pro\r\n00000002.pro\r\n');
    // The protos Fallout 2's engine wrote for the last game played, and wipes at the next, are not the mod's.
    expect(await inArchive(plan, MOD_DATA, 'proto/items/00000001.pro')).toBeNull();
    expect(await inArchive(plan, 'mods/my_mod', 'text/english/game/perk.msg')).toBe('{101}{}{Something Else}');
    // Its saves come along as saves; what a played game left behind does not come at all.
    expect(plan.saves.map((save) => save.path)).toEqual(['data/SAVEGAME/SLOT01/SAVE.DAT']);
    expect(plan.installConfig).toContain('combat_speed=75');
  });

  it('is started with nothing else of the game: its patch archive was moved aside by the installer', () => {
    const mounted = mountGame('fallout-2', manifestOf(plan), fallout2.manifest);
    expect(mounted.files.get('master.dat')?.from).toBe('base');
    expect(mounted.files.get('patch000.dat')).toBeUndefined();
    expect(mounted.files.get('data/worldmap.dat')).toBeUndefined();
    expect(mounted.files.get(MOD_DATA)?.from).toBe('own');
    const config = Ini.parse(buildConfigFiles({ game: 'fallout-2', manifest: manifestOf(plan), base: fallout2.manifest, screen: { width: 640, height: 480 }, skipIntro: false })['fallout2.cfg']!);
    expect(config.get('system', 'critter_patches')).toBe(MOD_DATA);
    expect(config.get('preferences', 'combat_speed')).toBe('75');
    // The deck's copy changed since: the mod says it cannot start as it was loaded.
    const changed = { ...fallout2.manifest, files: fallout2.manifest.files.map((file) => (file.path === 'master.dat' ? { ...file, size: 1 } : file)) };
    expect(mountGame('fallout-2', manifestOf(plan), changed).missing).toEqual(['master.dat']);
  });

  it('is refused when it is the game as it was sold, or the game it is played on is not loaded', async () => {
    await expect(planImport(sources(fallout2Files(), 'Fallout 2/'), 'mod', decks)).rejects.toThrow(/^That is Fallout 2 as it was sold/);
    await expect(planImport(sources(moddedFallout2Files(), 'Fallout 2/'), 'mod', {})).rejects.toThrow(/load Fallout 2 into deck B first/);
  });
});

describe('the whole games of their own', () => {
  it('Sonora: its own archives, its engine builds left out, the game\'s music under another name used from the deck', async () => {
    const plan = await load(sonoraFiles(), 'Fallout_Sonora_1_16_E/', 'Fallout_Sonora_1.16.4E.zip');
    expect(plan.game).toBe('sonora');
    expect(plan.mod?.record.version).toBe('1.16.4E');
    expect(paths(plan)).toEqual(['critter.dat', 'data/sound/music/fs_vault.acm', 'fission.dat', 'master.dat']);
    expect(plan.mod?.reuses).toEqual([{ path: 'data/sound/music/f1_nueva.acm', size: 90 << 10, from: 'sound/music/01hub.acm' }]);
    const mounted = mountGame('sonora', manifestOf(plan), fallout2.manifest);
    expect(mounted.files.get('data/sound/music/f1_nueva.acm')?.from).toBe('base');
    // Nothing else of Fallout 2: its patch archive would stand above Sonora's own.
    expect(mounted.files.get('patch000.dat')).toBeUndefined();
    expect(mounted.files.get('sound/music/02mstrlr.acm')).toBeUndefined();
  });

  it('Olympus: its load order and scripts put where the engine reads them, its own settings file taken', async () => {
    const plan = await load(olympusFiles(), 'Olympus-2207-English/', 'Olympus-2207-English.zip');
    expect(plan.game).toBe('olympus');
    expect(plan.mod?.record.version).toBeUndefined();
    expect(paths(plan)).toEqual([
      'critter.dat',
      'data/art/cuts/intro.mve',
      'ddraw.ini',
      'f2_res.dat',
      'master.dat',
      MOD_DATA,
      'mods/InventoryFilter.dat',
      'mods/KeysHelp.dat',
      'mods/NoRadiationDesert.dat',
      'mods/mods_order.ini',
      'mods/mods_order.txt',
      'olympus.cfg',
      'sfall/scripts/gl_hms.int',
      'sfall/scripts/hs_combatdamage.int',
      'sfall/sfall-mods.ini',
    ]);
    // Its scripts and words in the archive standing in for its data folder; the film, large, a file of its own.
    expect(await inArchive(plan, MOD_DATA, 'scripts/gl_hms.int')).not.toBeNull();
    expect(await inArchive(plan, MOD_DATA, 'text/english/dialog/oly7.msg')).toBe('{100}{}{English 7}');
    const order = await plan.entries.find((entry) => entry.path === 'mods/mods_order.txt')!.file.text();
    expect(order).toBe('InventoryFilter.dat\r\nKeysHelp.dat\r\n;NoRadiationDesert.dat\r\n');
    expect(await inArchive(plan, 'mods/InventoryFilter.dat', 'text/english/game/inventory_filter.msg')).toBe('{100}{}{Filter}');
    expect(plan.installConfig).toContain('text_base_delay=6.000000');
    // Its sfall settings send the engine to its own settings file: that is the one the console writes.
    const ddraw = '[Misc]\r\nConfigFile=olympus.cfg\r\n';
    expect(settingsFileOf('olympus', ddraw)).toBe('olympus.cfg');
    expect(settingsFileOf('olympus', '[Misc]\r\nConfigFile=..\\elsewhere.cfg\r\n')).toBe('fallout2.cfg');
    expect(settingsFileOf('olympus', undefined)).toBe('fallout2.cfg');
    const files = buildConfigFiles({ game: 'olympus', manifest: manifestOf(plan), base: fallout2.manifest, screen: { width: 1152, height: 720 }, skipIntro: false, configFile: settingsFileOf('olympus', ddraw) });
    expect(Object.keys(files)).toContain('olympus.cfg');
    expect(Object.keys(files)).not.toContain('fallout2.cfg');
    const config = Ini.parse(files['olympus.cfg']!);
    expect(config.get('system', 'critter_patches')).toBe(MOD_DATA);
    expect(config.get('screen', 'resolution_y')).toBe('720');
    expect(config.get('preferences', 'text_base_delay')).toBe('6.000000');
    // The sfall it came with, which its scripts are told they run on.
    expect(manifestOf(plan).mod?.sfall).toBe('5.1.6');
    expect(config.get('sfall', 'version')).toBe('5.1.6');
    expect(plan.warnings[0]).toBe('It needs a picture at least 600 lines tall.');
    expect(plan.notes).toContain('2 of its sfall scripts were put where the engine looks for them.');
  });

  it('Nevada: its MASTER.DAT, a folder, made an archive the engine opens the same way', async () => {
    const plan = await load(nevadaFiles(), 'Fallout Nevada/');
    expect(plan.game).toBe('nevada');
    expect(paths(plan)).toEqual(['critter.dat', 'master.dat', 'patch000.dat', 'patch001.dat']);
    expect(await inArchive(plan, 'master.dat', 'text/english/dialog/npc7.msg')).toBe('{100}{}{Line 7}');
    const config = Ini.parse(buildConfigFiles({ game: 'nevada', manifest: manifestOf(plan), base: fallout2.manifest, screen: { width: 640, height: 480 }, skipIntro: false })['fallout2.cfg']!);
    expect(config.get('system', 'master_dat')).toBe('master.dat');
  });
});

describe('Resurrection, in a folder of its own inside Fallout 2\'s', () => {
  let plan: ImportPlan;
  beforeAll(async () => {
    plan = await load(resurrectionFiles(), '', 'FoRes_EN_1_5.zip');
  });
  const ddraw = resurrectionFiles()['Resurrection/ddraw.ini'] as string;
  const highRes = resurrectionFiles()['Resurrection/f2_res.ini'] as string;
  const configOf = (from: ImportPlan) =>
    Ini.parse(
      buildConfigFiles({
        game: 'resurrection',
        manifest: manifestOf(from),
        base: fallout2.manifest,
        screen: { width: 640, height: 480 },
        skipIntro: false,
        configFile: settingsFileOf('resurrection', ddraw),
        highRes,
      })['fores.cfg']!,
    );

  it('is stored as its folder, with the music its zip puts beside it, less what only a desktop needs', () => {
    expect(plan.game).toBe('resurrection');
    expect(plan.mod?.record).toEqual({ id: 'resurrection', known: 'resurrection', title: 'Fallout 1.5: Resurrection', version: '1.5', base: 'fo2' });
    expect(plan.mod?.layout).toBe('nested');
    expect(paths(plan)).toEqual([
      'CriticalOverrides.ini',
      'data/art/cuts/intro.mve',
      'data/art/cuts/intro.pal',
      'ddraw.ini',
      'f2_res.ini',
      'fores.cfg',
      'fores.dat',
      'fores_critter.dat',
      'sound/music/06VAULT.ACM',
      'sound/music/25albuq.acm',
    ]);
    expect(plan.notes).toContain('3 files only a desktop needs (programs, installers) were left out.');
    expect(plan.installConfig).toContain('critter_patches=fores_critter.dat');
  });

  it('is started in its folder, with Fallout 2\'s archives and music below it', () => {
    const mounted = mountGame('resurrection', manifestOf(plan), fallout2.manifest);
    const at = (path: string) => mounted.files.get(path)?.from ?? null;
    expect(at('fores.dat')).toBe('own');
    expect(at('sound/music/06vault.acm')).toBe('own');
    expect(at('fo2/master.dat')).toBe('base');
    expect(at('fo2/critter.dat')).toBe('base');
    expect(at('fo2/sound/music/01hub.acm')).toBe('base');
    // Not in its folder on a desktop: the game's patch archive, its loose data.
    expect(at('patch000.dat')).toBeNull();
    expect(at('fo2/patch000.dat')).toBeNull();
    expect(at('master.dat')).toBeNull();

    // Its own settings file, as its sfall settings name it, with the archives where they are here.
    expect(settingsFileOf('resurrection', ddraw)).toBe('fores.cfg');
    const config = configOf(plan);
    expect(config.get('system', 'master_dat')).toBe('fo2\\master.dat');
    expect(config.get('system', 'critter_dat')).toBe('fo2\\critter.dat');
    // Its new critters, and its content: the archive its high resolution patch's settings name.
    expect(config.get('system', 'critter_patches')).toBe('fores_critter.dat');
    expect(config.get('system', 'f2_res_dat')).toBe('fores.dat');
    expect(config.get('sound', 'music_path1')).toBe('sound\\music\\');
    expect(config.get('sound', 'music_path2')).toBe('fo2\\sound\\music\\');
    expect(config.get('preferences', 'combat_speed')).toBe('60');
  });

  it('is taken out of a Fallout 2 folder it was unpacked into, the game\'s own music used from the deck', async () => {
    const installed = await load(resurrectionInstalledFiles(), 'Fallout 2/', undefined, 'resurrection');
    expect(installed.game).toBe('resurrection');
    expect(installed.mod?.record.version).toBeUndefined();
    expect(paths(installed)).toEqual(paths(plan));
    // The game's music in the folder beside it is the deck's: not stored again, and there where the mod looks.
    expect(installed.mod?.reuses?.map((reuse) => reuse.path).sort()).toEqual(['sound/music/01hub.acm', 'sound/music/02mstrlr.acm']);
    const mounted = mountGame('resurrection', manifestOf(installed), fallout2.manifest);
    expect(mounted.files.get('sound/music/01hub.acm')?.from).toBe('base');
    expect(mounted.files.get('data/worldmap.dat')).toBeUndefined();
    expect(configOf(installed).get('system', 'critter_patches')).toBe('fores_critter.dat');
  });

  it('says what is missing when its folder is handed over alone', async () => {
    const alone = Object.fromEntries(Object.entries(resurrectionFiles()).filter(([path]) => path.startsWith('Resurrection/')));
    const plan = await load(alone, '', undefined, 'resurrection');
    expect(paths(plan)).toContain('fores.dat');
    expect(plan.notes).toContain(
      'Its zip also puts files in sound/music/, beside its own folder, and none were handed over. Hand the console the zip, or the game folder it was installed in, for all of it.',
    );
  });
});

describe('Fallout Yesterday, a game of its own on three of Fallout 2\'s archives', () => {
  let plan: ImportPlan;
  beforeAll(async () => {
    plan = await load(yesterdayFiles(), 'FalloutYesterday/');
  });

  it('is stored as its folder, its patch archive too large for one made into two, those after it numbered on', async () => {
    expect(plan.game).toBe('yesterday');
    expect(plan.mod?.record).toMatchObject({ known: 'yesterday', title: 'Fallout Yesterday', base: 'fo2' });
    expect(paths(plan)).toEqual([
      'appearance/hmr00s01/art/critters/hmjmpsaa.frm',
      'data/art/cuts/title.mve',
      'data/sound/music/45mesa.wav',
      'ddraw.ini',
      'f2_res.dat',
      'f2_res.ini',
      'fallouty.cfg',
      MOD_DATA,
      'mods/FalloutYesterday.ini',
      'mods/mods_order.txt',
      'mods/sfall-mods.ini',
      'patch001.dat',
      'patch002.dat',
      'patch003.dat',
    ]);
    expect(plan.notes).toContain('Its patch001.dat folder is more than one archive holds: it is stored as patch001.dat to patch002.dat.');
    expect(plan.notes).toContain('The engine opens patch archives by number: its patch002.dat is patch003.dat here.');
    // Each of its files in one of the two, under the archives' limit; its own patch002.dat after them.
    const sizes = plan.entries.filter((entry) => /^patch00[12]\.dat$/.test(entry.path)).map((entry) => entry.file.size);
    expect(sizes.every((size) => size <= 0x7fffffff)).toBe(true);
    expect(await inArchive(plan, 'patch001.dat', 'text/english/game/map.msg')).toBe('{100}{}{Tibbets}');
    expect(await listedIn(plan, 'patch001.dat', 'art/critters/margosaa.frm')).toBe(true);
    expect(await listedIn(plan, 'patch002.dat', 'art/walls/wpool.frm')).toBe(true);
    expect(await listedIn(plan, 'patch001.dat', 'art/walls/wpool.frm')).toBe(false);
    expect(await inArchive(plan, 'patch003.dat', 'text/english/game/misc.msg')).toBe('{100}{}{Fixed}');
    expect(await inArchive(plan, 'f2_res.dat', 'maps/artemple.edg')).not.toBeNull();
    expect(await listedIn(plan, MOD_DATA, 'scripts/gl_fy7.int')).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it('is started over Fallout 2\'s master.dat, critter.dat and patch000.dat, and nothing else of the game', () => {
    const mounted = mountGame('yesterday', manifestOf(plan), fallout2.manifest);
    const at = (path: string) => mounted.files.get(path)?.from ?? null;
    expect(at('master.dat')).toBe('base');
    expect(at('critter.dat')).toBe('base');
    expect(at('patch000.dat')).toBe('base');
    expect(at('f2_res.dat')).toBe('own');
    expect(at('patch003.dat')).toBe('own');
    expect(at('sound/music/01hub.acm')).toBeNull();
    expect(at('data/worldmap.dat')).toBeNull();
    expect(at('data/art/tiles/grid000.frm')).toBeNull();

    const ddraw = yesterdayFiles()['ddraw.ini'] as string;
    expect(settingsFileOf('yesterday', ddraw)).toBe('fallouty.cfg');
    const files = buildConfigFiles({
      game: 'yesterday',
      manifest: manifestOf(plan),
      base: fallout2.manifest,
      screen: { width: 854, height: 480 },
      skipIntro: false,
      configFile: settingsFileOf('yesterday', ddraw),
      highRes: yesterdayFiles()['f2_res.ini'] as string,
    });
    expect(Object.keys(files)).not.toContain('fallout2.cfg');
    const config = Ini.parse(files['fallouty.cfg']!);
    expect(config.get('system', 'master_dat')).toBe('master.dat');
    expect(config.get('system', 'critter_patches')).toBe(MOD_DATA);
    expect(config.get('system', 'f2_res_dat')).toBe('f2_res.dat');
    expect(config.get('sound', 'music_path1')).toBe('data\\sound\\music\\');
  });

  it('is loaded as well from the folder it was installed in, with the game\'s archives copied into it, and never into a deck', async () => {
    const game = fallout2Files();
    const installed = { ...yesterdayFiles(), 'master.dat': game['master.dat']!, 'critter.dat': game['critter.dat']!, 'patch000.dat': game['patch000.dat']!, 'fallout2.exe': 'not a program' };
    const again = await load(installed, 'Fallout Yesterday/', undefined, 'yesterday');
    expect(again.game).toBe('yesterday');
    expect(again.mod?.reuses?.map((reuse) => reuse.path).sort()).toEqual(['critter.dat', 'master.dat', 'patch000.dat']);
    expect(paths(again)).toEqual(paths(plan));
    const mounted = mountGame('yesterday', manifestOf(again), fallout2.manifest);
    expect(mounted.files.get('patch000.dat')?.from).toBe('base');
    expect(mounted.files.get('patch003.dat')?.from).toBe('own');
    await expect(planImport(sources(installed, 'Fallout Yesterday/'), 'fo2', decks)).rejects.toThrow(
      'That is Fallout Yesterday, a mod of Fallout 2: it is loaded in the Mod library, and played over the game in deck B.',
    );
  });
});

describe('a mod of Fallout', () => {
  it('Fixt: over Fallout in deck A, its loose files kept loose for the engine of Fallout', async () => {
    const plan = await load(fixtFiles(), 'Fallout Fixt/');
    expect(plan.game).toBe('fixt');
    expect(plan.datFormat).toBe('dat1');
    // Fallout's engine never writes protos, so those in a Fallout folder are the mod's; only the maps are a game's.
    expect(paths(plan)).toEqual([
      'DATA/PROTO/ITEMS/00000001.PRO',
      'DATA/PROTO/ITEMS/ITEMS.LST',
      'DATA/SCRIPTS/SCRIPTS.LST',
      'DATA/SCRIPTS/TEST.INT',
      'DATA/TEXT/ENGLISH/GAME/MISC.MSG',
    ]);
    expect(plan.mod?.reuses?.map((reuse) => reuse.path).sort()).toEqual(['CRITTER.DAT', 'DATA/SOUND/MUSIC/01HUB.ACM', 'MASTER.DAT']);
    const files = buildConfigFiles({ game: 'fixt', manifest: manifestOf(plan), base: fallout1.manifest, screen: { width: 640, height: 480 }, skipIntro: false });
    // Fixt's own settings say where its data is with a slash the engine does not take; the console says it.
    expect(Ini.parse(files['fallout.cfg']!).get('system', 'master_patches')).toBe('data');
  });
});

describe('a mod of Fallout, as its installer leaves it', () => {
  it('Fixt: its own folder laid over Fallout, whose loose data its settings do not read', async () => {
    const plan = await load(fixtInstalledFiles(), 'Fallout/');
    expect(plan.game).toBe('fixt');
    expect(plan.mod?.record).toMatchObject({ known: 'fixt', title: 'Fallout Fixt', base: 'fo1' });
    // Its files, not the game's around it, nor what only a desktop needs.
    expect(paths(plan)).toEqual([
      'DATA/FIXT/install.log',
      'DATA/MAPS/V13ENT.MAP',
      'DATA/SCRIPTS/SCRIPTS.LST',
      'DATA/SCRIPTS/TEST.INT',
      'DATA/TEXT/ENGLISH/GAME/MISC.MSG',
    ]);
    expect(plan.installConfig).toContain('master_patches=data');
    // Played with the game's archives and music, not the game's own loose data.
    const mounted = mountGame('fixt', manifestOf(plan), fallout1.manifest);
    expect(mounted.files.get('master.dat')?.from).toBe('base');
    expect(mounted.files.get('critter.dat')?.from).toBe('base');
    expect(mounted.files.get('data/sound/music/01hub.acm')?.from).toBe('base');
    expect(mounted.files.get('data/maps/v13ent.map')?.from).toBe('own');
    const files = buildConfigFiles({ game: 'fixt', manifest: manifestOf(plan), base: fallout1.manifest, screen: { width: 640, height: 480 }, skipIntro: false });
    const config = Ini.parse(files['fallout.cfg']!);
    // Its settings point one folder up for the game's archives: here they sit beside it.
    expect(config.get('system', 'master_dat')).toBe('master.dat');
    expect(config.get('system', 'critter_dat')).toBe('critter.dat');
  });

  it('Fixt: its own folder handed over alone', async () => {
    const files = Object.fromEntries(
      Object.entries(fixtInstalledFiles())
        .filter(([path]) => path.startsWith('Fallout Fixt/'))
        .map(([path, data]) => [path.slice('Fallout Fixt/'.length), data]),
    );
    const plan = await load(files, 'Fallout Fixt/');
    expect(plan.game).toBe('fixt');
    expect(paths(plan)).toContain('DATA/MAPS/V13ENT.MAP');
  });
});

describe('a mod picked where a game is asked for', () => {
  it('is taken for the mod it is when nothing was asked for', async () => {
    expect((await planImport(sources(rpuFiles(), '', 'rpu_v2.4.34.zip'), undefined, decks)).game).toBe('rpu');
    expect((await planImport(sources(sonoraFiles(), 'Fallout_Sonora_1_16_E/'), undefined, decks)).game).toBe('sonora');
  });

  it('is refused by a deck when it is a whole game of its own, or files to unpack', async () => {
    await expect(planImport(sources(sonoraFiles(), 'Fallout_Sonora_1_16_E/'), 'fo2', decks)).rejects.toThrow(
      'That is Fallout: Sonora, a mod of Fallout 2: it is loaded in the Mod library, and played over the game in deck B.',
    );
    await expect(planImport(sources(rpuFiles()), 'fo2', decks)).rejects.toThrow(/^That is Restoration Project, a mod of Fallout 2/);
  });

  it('is loaded as the game it was installed in, with a word, where a deck is given that folder', async () => {
    const installed = { ...fallout2Files(), 'mods/rpu.dat': rpuFiles()['mods/rpu.dat']!, 'mods/mods_order.txt': 'rpu.dat\r\n' };
    const plan = await planImport(sources(installed, 'Fallout 2/'), 'fo2', decks);
    expect(plan.game).toBe('fo2');
    expect(plan.warnings).toContain(
      'This folder has Restoration Project installed in it: deck B now holds that, not Fallout 2 as it was sold. To keep the two apart, load the game\'s own folder here, and the mod in the Mod library.',
    );
    // A folder merely named like a mod is not taken for one.
    expect((await planImport(sources(fallout2Files(), 'Fallout 2 RP/'), 'fo2', decks)).warnings.join(' ')).not.toContain('installed in it');
  });
});

describe('the sfall a mod came with', () => {
  it('is read from its ddraw.dll: the version it says, else the numbers it has', async () => {
    expect(await sfallVersionOf(bytesSource(sfallLibrary(['4.4.5.1', [4, 4, 5]])))).toBe('4.4.5');
    // The Megamod's.
    expect(await sfallVersionOf(bytesSource(sfallLibrary(['3.7b', [3, 7, 2]])))).toBe('3.7.2');
    expect(await sfallVersionOf(bytesSource(ascii('not a library')))).toBeUndefined();
    expect(await sfallVersionOf(undefined)).toBeUndefined();
  });

  it('is not said to the engine of a mod without one', async () => {
    const plan = await load(rpuFiles(), '', 'rpu_v2.4.34.zip');
    expect(manifestOf(plan).mod?.sfall).toBeUndefined();
    const files = buildConfigFiles({ game: plan.game, manifest: manifestOf(plan), base: fallout2.manifest, screen: { width: 1152, height: 720 }, skipIntro: false });
    expect(Ini.parse(files['fallout2.cfg']!).get('sfall', 'version')).toBeUndefined();
  });
});

describe('what cannot be loaded', () => {
  it('says so of an installer, and of an archive the console cannot open', async () => {
    await expect(planImport(sources({ 'rpu_v2.4.34.exe': new Uint8Array(5 << 20) }), 'mod', decks)).rejects.toThrow(
      'That is a Windows installer: the console cannot run it. The rpu zip from its releases page, not the installer',
    );
    await expect(planImport(sources({ 'megamod.7z': ascii('7z') }), 'mod', decks)).rejects.toThrow('megamod.7z: the console opens zip archives only.');
    await expect(planImport(sources({ 'beach.jpg': ascii('pixels') }), 'mod', decks)).rejects.toBeInstanceOf(ImportError);
  });
});
