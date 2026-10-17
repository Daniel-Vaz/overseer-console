import { beforeAll, describe, expect, it } from 'vitest';
import { findInDat, readDatEntry } from '../../src/lib/dat';
import { buildConfigFiles, settingsFileOf } from '../../src/lib/engine/config';
import { registerMod, type GameId } from '../../src/lib/games';
import { Ini } from '../../src/lib/ini';
import { ImportError, planImport, surveySources, type ImportContext, type ImportPlan } from '../../src/lib/storage/importer';
import type { Manifest } from '../../src/lib/storage/manifest';
import { findMod, MOD_DATA } from '../../src/lib/storage/mods';
import { mountGame } from '../../src/lib/storage/mount';
import { ascii } from '../archives';
import { fallout1Files, fallout2Files, fixtFiles, installOf, moddedFallout2Files, nevadaFiles, olympusFiles, rpuFiles, sonoraFiles, sources } from '../mods';

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
    expect(plan.notes).toContain('Left out: its Hero Appearance art, a feature the engine does not have (1 file).');
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
    expect(plan.warnings[0]).toMatch(/^Made for sfall 5: what of it the Community Edition engine does not have is not there\./);
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

describe('what cannot be loaded', () => {
  it('says so of an installer, and of an archive the console cannot open', async () => {
    await expect(planImport(sources({ 'rpu_v2.4.34.exe': new Uint8Array(5 << 20) }), 'mod', decks)).rejects.toThrow(
      'That is a Windows installer: the console cannot run it. The rpu zip from its releases page, not the installer',
    );
    await expect(planImport(sources({ 'megamod.7z': ascii('7z') }), 'mod', decks)).rejects.toThrow('megamod.7z: the console opens zip archives only.');
    await expect(planImport(sources({ 'beach.jpg': ascii('pixels') }), 'mod', decks)).rejects.toBeInstanceOf(ImportError);
  });
});
