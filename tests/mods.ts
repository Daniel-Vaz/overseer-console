/**
 * Mods made up for the tests, laid out as the real ones are: the Restoration
 * Project's zip, a game folder a mod was installed in, Sonora and Olympus as
 * whole games of their own, Nevada with its MASTER.DAT as a folder, and the
 * game in the deck they are laid over. A few bytes in each file.
 */
import type { Manifest } from '../src/lib/storage/manifest';
import type { Install } from '../src/lib/storage/opfs';
import type { SourceFile } from '../src/lib/storage/plan';
import { ascii, dat2 } from './archives';

/** Bytes that are the same however often they are made: a file of the game in the deck. */
export const pattern = (size: number, seed: number): Uint8Array => Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed * 7 + (i >>> 9)) & 0xff);

/** An archive of Fallout 2 as far as telling one apart goes: its last eight bytes the size of its directory, and its own. */
export function dat2Bytes(size: number, seed: number): Uint8Array {
  const data = pattern(size, seed);
  const view = new DataView(data.buffer);
  view.setUint32(size - 8, 16, true);
  view.setUint32(size - 4, size, true);
  return data;
}

/** An archive of Fallout, as far as telling one apart goes: a small count of folders first, then a word of nothing. */
export function dat1Bytes(size: number, seed: number): Uint8Array {
  const data = pattern(size, seed);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x30, false);
  view.setUint32(4, 0x5e, false);
  view.setUint32(8, 0, false);
  return data;
}

type Data = Uint8Array | string | Blob;

const file = (data: Data, name = 'file') => new File([typeof data === 'string' ? ascii(data) : data instanceof Blob ? data : (data as Uint8Array<ArrayBuffer>)], name);

/** Files as a picked folder gives them, below `prefix`; `zip` as if they came out of one. */
export function sources(files: Record<string, Data>, prefix = '', zip?: string): SourceFile[] {
  return Object.entries(files).map(([path, data]) => ({ path: `${prefix}${path}`, file: file(data, path.split('/').pop()), ...(zip ? { zip } : {}) }));
}

/** Fallout 2 as a store installs it, the copy in deck B. Its archives are big enough to be stored as files of their own. */
export function fallout2Files(): Record<string, Data> {
  return {
    'master.dat': dat2Bytes(2 << 20, 1),
    'critter.dat': dat2Bytes(1536 << 10, 2),
    'patch000.dat': dat2Bytes(300 << 10, 3),
    'f2_res.dat': pattern(70 << 10, 4),
    'fallout2.cfg': '[system]\r\nlanguage=english\r\n[preferences]\r\ncombat_speed=50\r\n',
    'sound/music/01hub.acm': pattern(90 << 10, 5),
    'sound/music/02mstrlr.acm': pattern(80 << 10, 6),
    'data/worldmap.dat': pattern(512, 7),
    'data/art/tiles/grid000.frm': pattern(200, 8),
  };
}

/** Fallout as a store installs it, the copy in deck A. */
export function fallout1Files(): Record<string, Data> {
  return {
    'MASTER.DAT': dat1Bytes(2 << 20, 11),
    'CRITTER.DAT': dat1Bytes(1 << 20, 12),
    'fallout.cfg': '[system]\r\nlanguage=english\r\n',
    'DATA/SOUND/MUSIC/01HUB.ACM': pattern(70 << 10, 13),
  };
}

/** An install as the console stores one: every file in a blob of its own, read through a stand-in for the browser's storage. */
export function installOf(game: 'fo1' | 'fo2', files: Record<string, Data>): Install {
  const blobs = new Map<string, File>();
  const manifest: Manifest = {
    version: 1,
    game,
    install: `i${game}`,
    importedAt: 0,
    totalBytes: 0,
    datFormat: game === 'fo1' ? 'dat1' : 'dat2',
    files: [],
    dirs: [],
    installConfig: typeof files[game === 'fo1' ? 'fallout.cfg' : 'fallout2.cfg'] === 'string' ? (files[game === 'fo1' ? 'fallout.cfg' : 'fallout2.cfg'] as string) : undefined,
  };
  for (const [index, [path, data]] of Object.entries(files).entries()) {
    if (/\.cfg$/.test(path)) continue;
    const blob = `b${String(index).padStart(4, '0')}.bin`;
    const stored = file(data, blob);
    blobs.set(blob, stored);
    manifest.files.push({ path, size: stored.size, blob });
    manifest.totalBytes += stored.size;
    for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) if (!manifest.dirs.includes(path.slice(0, at))) manifest.dirs.push(path.slice(0, at));
  }
  const dir = { getFileHandle: async (name: string) => ({ getFile: async () => blobs.get(name)! }) } as unknown as FileSystemDirectoryHandle;
  return { manifest, dir };
}

/** The Restoration Project as its zip holds it: to be unpacked into the Fallout 2 folder, and its installer run there. */
export function rpuFiles(): Record<string, Data> {
  return {
    'mods_order.txt': 'rpu.dat\r\nparty_orders.dat\r\nnpc_armor.dat\r\nrpu_czech.dat\r\nrpu_enhanced_worldmap.dat\r\nfo2tweaks.dat\r\n',
    'mods/rpu.dat': dat2({ 'text\\english\\game\\perk.msg': { data: ascii('{101}{}{Awareness}'), packed: false } }),
    'mods/party_orders.dat': pattern(3000, 21),
    'mods/npc_armor.dat': pattern(5000, 22),
    'mods/rpu_enhanced_worldmap.dat': pattern(4000, 23),
    // One of its installer's options, not chosen: in the mods folder, not in the load order.
    'mods/rpu_alternative_explosions.dat': pattern(2500, 28),
    // The high resolution patch's art, its own: its settings for that patch say so.
    'mods/f2_res.dat': pattern(3500, 29),
    'mods/rpu.ini': '[main]\r\nmarcus_armor=1\r\n',
    'mods/sfall-mods.ini': '[Highlighting]\r\nKey=42\r\n',
    'gl_ammomod.int': pattern(1620, 24),
    'data/sound/music/01hub.acm': pattern(160 << 10, 25),
    'appearance/hmr00s01.dat': pattern(40 << 10, 26),
    'translations/german.ini': '[Translations]\r\n',
    'ddraw.ini': '[Misc]\r\nPerksFile=mods\\rpu.ini\r\n',
    'f2_res.ini': '[MAIN]\r\nSCR_WIDTH=1280\r\nf2_res_dat=mods\\f2_res.dat\r\nf2_res_patches=data\\\r\n',
    'ddraw.dll': 'not a library',
    'fallout2.exe': 'not a program',
    'f2_res_config.exe': 'not a program either',
    'rpu-install.sh': '#!/bin/bash\r\n',
    'sfall.dat': pattern(2000, 27),
    'sfall-readme.txt': 'read me',
  };
}

/** A Fallout 2 folder a mod was installed in: the game's archives as they were, the mod's files around them. */
export function moddedFallout2Files(): Record<string, Data> {
  const game = fallout2Files();
  const files: Record<string, Data> = {
    'master.dat': game['master.dat']!,
    'critter.dat': game['critter.dat']!,
    'sound/music/01hub.acm': game['sound/music/01hub.acm']!,
    'sound/music/02mstrlr.acm': game['sound/music/02mstrlr.acm']!,
    // Its installer moved the game's patch archive away: that is not part of the modded game.
    'backup/patch000.dat': game['patch000.dat']!,
    'fallout2.cfg': '[system]\r\nlanguage=english\r\n[preferences]\r\ncombat_speed=75\r\n',
    'ddraw.ini': '[Misc]\r\nStartingMap=artemple.map\r\n',
    'mods/mods_order.txt': 'my_mod\r\n',
    'mods/my_mod/art/items/thing.frm': pattern(700, 31),
    'mods/my_mod/text/english/game/perk.msg': '{101}{}{Something Else}',
    'fallout2.exe': 'not a program',
    'data/SAVEGAME/SLOT01/SAVE.DAT': pattern(300, 32),
    'data/maps/artemple.sav': pattern(64, 33),
    'data/proto/items/00000001.pro': pattern(64, 34),
    'data/proto/items/items.lst': '00000001.pro\r\n00000002.pro\r\n',
    'data/text/english/game/misc.msg': '{100}{}{hello}',
    'data/config/game.cfg': '[start]\r\nmap=arvillag.map\r\n',
  };
  for (let i = 0; i < 20; i++) files[`data/scripts/script${i}.int`] = pattern(400 + i, 40 + i);
  return files;
}

/** Sonora as its zip holds it: a whole game, its own archives, the engine builds of its makers beside them. */
export function sonoraFiles(): Record<string, Data> {
  return {
    'master.dat': dat2Bytes(2 << 20, 51),
    'critter.dat': dat2Bytes(1536 << 10, 52),
    'fission.dat': pattern(2000, 53),
    'fallout-sonora-x64.exe': 'not a program',
    'fallout-sonora-android.zip': 'not for here',
    'FSonoraDLC.exe': 'not a program',
    'readme.txt': 'read me',
    'log_develop.txt': 'what changed',
    'BIS_mapper/mapper2.exe': 'not a program',
    'data/sound/music/fs_vault.acm': pattern(100 << 10, 54),
    // The game's own music under another name: the same bytes as Fallout 2's.
    'data/sound/music/f1_nueva.acm': fallout2Files()['sound/music/01hub.acm']!,
    'data/.DS_Store': 'mac',
  };
}

/** Olympus 2207 as its zip holds it: made for sfall 5, with its load order as an INI file and its scripts in sfall's folder. */
export function olympusFiles(): Record<string, Data> {
  return {
    'master.dat': dat2Bytes(1 << 20, 61),
    'critter.dat': dat2Bytes(1536 << 10, 62),
    'f2_res.dat': pattern(90 << 10, 63),
    'olympus.cfg': '[system]\r\nmaster_dat=master.dat\r\ncritter_dat=critter.dat\r\nmaster_patches=data\r\nlanguage=english\r\n[preferences]\r\ntext_base_delay=6.000000\r\n',
    'OLYMPUS.EXE': 'not a program',
    'ddraw.ini': '[Scripts]\r\nGlobalScriptPaths=sfall\\scripts\\gl*.int\r\n',
    'mods/mods_order.ini': 'InventoryFilter.dat=1\r\nKeysHelp.dat=1\r\nNoRadiationDesert.dat=0\r\n',
    'mods/InventoryFilter.dat/scripts/gl_InvenFilter.int': pattern(3000, 64),
    'mods/InventoryFilter.dat/text/english/game/inventory_filter.msg': '{100}{}{Filter}',
    'mods/KeysHelp.dat/scripts/gl_keyshelp.int': pattern(1800, 65),
    'mods/NoRadiationDesert.dat': pattern(900, 66),
    'sfall/scripts/gl_hms.int': pattern(5000, 67),
    'sfall/scripts/hs_combatdamage.int': pattern(5200, 68),
    'sfall/sfall-mods.ini': '[Highlighting]\r\nKey=42\r\n',
    'data/art/cuts/intro.mve': pattern(1200 << 10, 69),
    'data/text/english/game/map.msg': '{100}{}{Olympus}',
    // Its English words, loose over the Russian of its own MASTER.DAT.
    ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`data/text/english/dialog/oly${i}.msg`, `{100}{}{English ${i}}`])),
  };
}

/** Fallout: Nevada as it is installed: its MASTER.DAT a folder of loose files. */
export function nevadaFiles(): Record<string, Data> {
  const files: Record<string, Data> = {
    'critter.dat': dat2Bytes(1536 << 10, 71),
    'patch000.dat': pattern(500, 72),
    'patch001.dat': pattern(600, 73),
    'fallout2.cfg': '[system]\r\nmaster_dat=master.dat\r\ncritter_dat=critter.dat\r\nlanguage=english\r\n',
    'FalloutNevada.exe': 'not a program',
  };
  for (let i = 0; i < 30; i++) files[`master.dat/text/english/dialog/npc${i}.msg`] = `{100}{}{Line ${i}}`;
  files['master.dat/art/intrface/iface.frm'] = pattern(900, 74);
  return files;
}

/** Fallout Fixt as it is installed over Fallout: the game's archives as they were, loose files in its data folder. */
export function fixtFiles(): Record<string, Data> {
  const game = fallout1Files();
  return {
    'MASTER.DAT': game['MASTER.DAT']!,
    'CRITTER.DAT': game['CRITTER.DAT']!,
    'DATA/SOUND/MUSIC/01HUB.ACM': game['DATA/SOUND/MUSIC/01HUB.ACM']!,
    'falloutw.exe': 'not a program',
    'ddraw.dll': 'sfall',
    'fallout.cfg': '[system]\r\nmaster_patches=data\\\r\nlanguage=english\r\n',
    'DATA/SCRIPTS/SCRIPTS.LST': 'test.int ; a script\r\n',
    'DATA/SCRIPTS/TEST.INT': pattern(800, 81),
    'DATA/PROTO/ITEMS/ITEMS.LST': '00000001.pro\r\n',
    'DATA/PROTO/ITEMS/00000001.PRO': pattern(120, 82),
    'DATA/MAPS/V13ENT.SAV': pattern(64, 83),
    'DATA/TEXT/ENGLISH/GAME/MISC.MSG': '{100}{}{Fixt}',
  };
}
