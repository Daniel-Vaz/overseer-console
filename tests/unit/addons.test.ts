import { describe, expect, it } from 'vitest';
import { addonRecord, addonsOn, forgetAddon, gamesWith, newAddonId, registerAddon, setAddonOn } from '../../src/lib/addons';
import { findInDat } from '../../src/lib/dat';
import { buildConfigFiles } from '../../src/lib/engine/config';
import { registerMod } from '../../src/lib/games';
import { planAddon } from '../../src/lib/storage/addons';
import { ImportError, planImport, type ImportContext, type ImportPlan } from '../../src/lib/storage/importer';
import type { Manifest } from '../../src/lib/storage/manifest';
import { addonModsOrder, mountGame } from '../../src/lib/storage/mount';
import { dat1Bytes } from '../mods';
import {
  cassidyHeadFiles,
  fallout1Files,
  fallout2Files,
  fo2tweaksFiles,
  installOf,
  looseDataFiles,
  musicFiles,
  partyOrdersFiles,
  rpuFiles,
  sources,
} from '../mods';

const fallout2 = installOf('fo2', fallout2Files());
const fallout1 = installOf('fo1', fallout1Files());
const decks: ImportContext = { installOf: async (game) => (game === 'fo2' ? fallout2 : game === 'fo1' ? fallout1 : null) };

/** The manifest an import of `plan` writes, near enough. */
function manifestOf(plan: ImportPlan): Manifest {
  return {
    version: 1,
    game: plan.game,
    install: `i${plan.game}`,
    importedAt: 0,
    totalBytes: plan.totalBytes,
    datFormat: plan.datFormat,
    files: plan.entries.map((entry) => ({ path: entry.path, size: entry.file.size, blob: 'x' })),
    dirs: plan.dirs,
    installConfig: plan.installConfig,
    mod: plan.mod,
    addon: plan.addon,
  };
}

const paths = (plan: ImportPlan) => plan.entries.map((entry) => entry.path).sort();
const listedIn = async (plan: ImportPlan, archive: string, path: string): Promise<boolean> => {
  const entry = plan.entries.find((candidate) => candidate.path === archive);
  return !!entry && (await findInDat(entry.file, 'dat2', [path])).has(path.toLowerCase());
};

describe('an add-on of Fallout 2', () => {
  it('FO2tweaks: its archive and settings for the mods folder, sfall\'s library left out, its version from its zip', async () => {
    const plan = await planAddon(sources(fo2tweaksFiles(), '', 'fo2tweaks_v14.7.zip'), undefined);
    expect(plan.addon).toEqual({ record: { id: 'fo2tweaks', title: 'Fo2tweaks', version: '14.7', base: 'fo2' }, order: ['fo2tweaks.dat'] });
    expect(paths(plan)).toEqual(['mods/fo2tweaks.dat', 'mods/fo2tweaks.ini']);
    expect(plan.datFormat).toBe('dat2');
    expect(plan.saves).toEqual([]);
    expect(plan.notes).toContain('1 file only a desktop needs (programs, libraries) was left out.');
    expect(plan.notes).toContain('It adds fo2tweaks.dat to the load order of whatever it is laid over.');
  });

  it('is loaded as an add-on where a mod is asked for and it is nothing but what goes in the mods folder', async () => {
    const plan = await planImport(sources(fo2tweaksFiles(), '', 'fo2tweaks_v14.7.zip'), 'mod', decks);
    expect(plan.mod).toBeUndefined();
    expect(plan.addon?.record.base).toBe('fo2');
    // Also one archive dropped on the console with nothing asked for.
    expect((await planImport(sources(cassidyHeadFiles()), undefined, decks)).addon?.record.title).toBe('Cassidy head');
    // A mod with a data folder of its own stays a mod.
    expect((await planImport(sources(rpuFiles(), '', 'rpu_v2.4.34.zip'), 'mod', decks)).mod?.record.known).toBe('rpu');
  });

  it('Party Orders: the parts its own load order switches on, in its order; a folder of its mods folder made an archive', async () => {
    const plan = await planAddon(sources(partyOrdersFiles(), 'party_orders_v1.17/'), 'fo2');
    expect(plan.addon?.record).toMatchObject({ title: 'Party orders', version: '1.17' });
    expect(plan.addon?.order).toEqual(['party_orders.dat', 'party_orders_text']);
    expect(paths(plan)).toEqual(['mods/party_orders.dat', 'mods/party_orders.ini', 'mods/party_orders_extra.dat', 'mods/party_orders_text']);
    expect(await listedIn(plan, 'mods/party_orders_text', 'text/english/game/party.msg')).toBe(true);
  });

  it("Cassidy's head: one archive handed over on its own, for the mods folder", async () => {
    const plan = await planAddon(sources(cassidyHeadFiles()), undefined);
    expect(plan.addon).toMatchObject({ record: { title: 'Cassidy head', base: 'fo2' }, order: ['cassidy_head.dat'] });
    expect(paths(plan)).toEqual(['mods/cassidy_head.dat']);
  });

  it('loose data: in the folders of a data folder, kept as one archive at the bottom of its load order, its notes left out', async () => {
    const plan = await planAddon(sources(looseDataFiles()), 'fo2');
    const archive = 'mods/better-armour-data.dat';
    expect(paths(plan)).toEqual([archive]);
    expect(plan.addon?.order).toEqual(['better-armour-data.dat']);
    expect(await listedIn(plan, archive, 'proto/items/00000074.pro')).toBe(true);
    expect(await listedIn(plan, archive, 'text/english/game/pro_item.msg')).toBe(true);
  });

  it('keeps its record when its files are loaded again, and is refused for the other game', async () => {
    registerAddon({ id: 'fo2tweaks', title: 'Fo2tweaks', version: '14.6', base: 'fo2' });
    const again = await planAddon(sources(fo2tweaksFiles(), '', 'fo2tweaks_v14.7.zip'), undefined, 'fo2tweaks');
    expect(again.addon?.record).toEqual({ id: 'fo2tweaks', title: 'Fo2tweaks', version: '14.7', base: 'fo2' });
    await expect(planAddon(sources(fo2tweaksFiles()), 'fo1')).rejects.toThrow("made for Fallout 2's mods folder");
    forgetAddon('fo2tweaks');
  });
});

describe('an add-on of Fallout', () => {
  it('music: the tracks alone, put in the music folder, its licence left out', async () => {
    const plan = await planAddon(sources(musicFiles(), '', 'fallout_1_2_lq_ebur128_music_v2.zip'), 'fo1');
    expect(plan.addon).toEqual({ record: { id: 'fallout-1-2-lq-ebur128-music', title: 'Fallout 1 2 lq ebur128 music', version: '2', base: 'fo1' } });
    expect(paths(plan)).toEqual(['data/sound/music/01hub.acm', 'data/sound/music/02mstrlr.acm', 'data/sound/music/wind1.acm']);
    expect(plan.hasMusic).toBe(true);
    expect(plan.datFormat).toBe('dat1');
  });

  it('loose data stays loose files, for the engine of Fallout', async () => {
    const plan = await planAddon(sources(looseDataFiles()), 'fo1');
    expect(paths(plan)).toEqual(['data/art/critters/hmlthraa.frm', 'data/proto/items/00000074.pro', 'data/text/english/game/pro_item.msg']);
    expect(plan.addon?.order).toBeUndefined();
  });

  it('is refused where the console cannot tell the game, or where it is an archive of Fallout', async () => {
    await expect(planAddon(sources(musicFiles()), undefined)).rejects.toThrow('whether that add-on is for Fallout or for Fallout 2');
    await expect(planAddon(sources({ 'extra.dat': dat1Bytes(4096, 3) }), undefined)).rejects.toThrow("Fallout's engine reads only its own two archives");
    await expect(planAddon(sources({ 'readme.txt': 'nothing' }), 'fo1')).rejects.toBeInstanceOf(ImportError);
  });
});

describe('laid over a game or a mod', () => {
  it('over Fallout 2: its files from the add-on, over the game\'s, and its archives after the game\'s own in the load order', async () => {
    const tweaks = manifestOf(await planAddon(sources(fo2tweaksFiles(), '', 'fo2tweaks_v14.7.zip'), undefined));
    const mounted = mountGame('fo2', fallout2.manifest, undefined, [tweaks]);
    expect(mounted.files.get('mods/fo2tweaks.dat')).toMatchObject({ from: 'addon', addon: 'fo2tweaks' });
    expect(mounted.files.get('master.dat')?.from).toBe('own');
    // The game has no load order: the engine would make one of the archives in its mods folder.
    expect(addonModsOrder(mounted, undefined)).toBe('fo2tweaks.dat\r\n');
    expect(addonModsOrder(mountGame('fo2', fallout2.manifest), undefined)).toBeNull();
  });

  it('over a mod: after its load order, as the player left it; what the mod names as well moved up with the add-on', async () => {
    const rpu = await planImport(sources(rpuFiles(), '', 'rpu_v2.4.34.zip'), 'mod', decks);
    registerMod(rpu.mod!.record);
    const orders = manifestOf(await planAddon(sources(partyOrdersFiles(), '', 'party_orders_v1.17.zip'), 'fo2'));
    const tweaks = manifestOf(await planAddon(sources(fo2tweaksFiles()), 'fo2'));
    const mounted = mountGame('rpu', manifestOf(rpu), fallout2.manifest, [orders, tweaks]);
    expect(mounted.files.get('mods/party_orders.dat')?.from).toBe('addon');
    expect(mounted.files.get('mods/rpu.dat')?.from).toBe('own');
    const own = 'rpu.dat\r\nparty_orders.dat\r\nnpc_armor.dat\r\n;rpu_czech.dat\r\nfo2tweaks.dat\r\n';
    expect(addonModsOrder(mounted, own)).toBe('rpu.dat\r\nnpc_armor.dat\r\n;rpu_czech.dat\r\nparty_orders.dat\r\nparty_orders_text\r\nfo2tweaks.dat\r\n');
    // The mod's sfall settings are its own: an add-on's only stand in where it has none.
    const ddraw = manifestOf(await planAddon(sources({ ...fo2tweaksFiles(), 'ddraw.ini': '[Misc]\r\n' }), 'fo2'));
    expect(mountGame('rpu', manifestOf(rpu), fallout2.manifest, [ddraw]).files.get('ddraw.ini')?.from).toBe('own');
    expect(mountGame('fo2', fallout2.manifest, undefined, [ddraw]).files.get('ddraw.ini')?.from).toBe('addon');
  });

  it('its music where the game keeps its own, in place of the game\'s track of the same name', async () => {
    const music = manifestOf(await planAddon(sources(musicFiles()), 'fo1'));
    const fo1 = mountGame('fo1', fallout1.manifest, undefined, [music]);
    expect(fo1.files.get('data/sound/music/01hub.acm')).toMatchObject({ path: 'DATA/SOUND/MUSIC/01hub.acm', from: 'addon' });
    expect(fo1.files.get('data/sound/music/wind1.acm')?.from).toBe('addon');
    // Fallout 2 keeps its music in sound/music.
    const fo2 = mountGame('fo2', fallout2.manifest, undefined, [{ ...music, addon: { record: { ...music.addon!.record, base: 'fo2' } } }]);
    expect(fo2.files.get('sound/music/02mstrlr.acm')?.from).toBe('addon');
    expect(fo2.files.has('data/sound/music/02mstrlr.acm')).toBe(false);
  });

  it('starts the game with the load order written where an add-on adds to it, and its music found', async () => {
    const tweaks = manifestOf(await planAddon(sources(fo2tweaksFiles()), 'fo2'));
    const screen = { width: 640, height: 480 };
    const files = buildConfigFiles({ game: 'fo2', manifest: fallout2.manifest, screen, skipIntro: false, addons: [tweaks] });
    expect(files['mods/mods_order.txt']).toBe('fo2tweaks.dat\r\n');
    expect(buildConfigFiles({ game: 'fo2', manifest: fallout2.manifest, screen, skipIntro: false })['mods/mods_order.txt']).toBeUndefined();
    // A copy of Fallout without its music plays the add-on's.
    const music = manifestOf(await planAddon(sources(musicFiles()), 'fo1'));
    const { 'DATA/SOUND/MUSIC/01HUB.ACM': _, ...silent } = fallout1Files();
    const fo1 = buildConfigFiles({ game: 'fo1', manifest: installOf('fo1', silent).manifest, screen, skipIntro: false, addons: [music] });
    expect(mountGame('fo1', installOf('fo1', silent).manifest, undefined, [music]).files.has('data/sound/music/01hub.acm')).toBe(true);
    expect(fo1['fallout.cfg']).toContain('music_path1=data\\sound\\music\\');
    expect(fo1['mods/mods_order.txt']).toBeUndefined();
  });
});

describe('the add-ons a game has laid over it', () => {
  it('are those switched on for it and made for its game, the later over the earlier, and none once forgotten', () => {
    registerAddon({ id: 'tweaks', title: 'Tweaks', base: 'fo2' });
    registerAddon({ id: 'orders', title: 'Orders', base: 'fo2' });
    registerAddon({ id: 'music', title: 'Music', base: 'fo1' });
    setAddonOn('fo2', 'orders', true);
    setAddonOn('fo2', 'tweaks', true);
    setAddonOn('fo2', 'music', true);
    expect(addonsOn('fo2')).toEqual(['orders', 'tweaks']);
    // Switched off and on again, it goes over the others.
    setAddonOn('fo2', 'orders', false);
    setAddonOn('fo2', 'orders', true);
    expect(addonsOn('fo2')).toEqual(['tweaks', 'orders']);
    expect(gamesWith('orders')).toEqual(['fo2']);
    forgetAddon('orders');
    expect(addonsOn('fo2')).toEqual(['tweaks']);
    expect(addonRecord('orders')).toBeUndefined();
    // Loaded again for the other game, it is taken off this one's.
    registerAddon({ id: 'tweaks', title: 'Tweaks', base: 'fo1' });
    expect(addonsOn('fo2')).toEqual([]);
    forgetAddon('tweaks');
    forgetAddon('music');
  });

  it('have ids of their own, made from their names', () => {
    registerAddon({ id: 'party-orders', title: 'Party orders', base: 'fo2' });
    expect(newAddonId('Party orders')).toBe('party-orders-2');
    expect(newAddonId('Cassidy head')).toBe('cassidy-head');
    expect(newAddonId('fo2')).toBe('fo2-2');
    forgetAddon('party-orders');
  });
});
