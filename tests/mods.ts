/**
 * Mods made up for the tests, laid out as the real ones are: the Restoration
 * Project's zip, a game folder a mod was installed in, Sonora and Olympus as
 * whole games of their own, Nevada with its MASTER.DAT as a folder,
 * Resurrection in a folder of its own inside Fallout 2's, Fallout Yesterday
 * with a patch archive larger than one archive holds, and the game in the
 * deck they are laid over. A few bytes in each file, but for the large ones,
 * which are never read.
 */
import { sourceOf } from '../src/lib/blobs';
import type { Manifest } from '../src/lib/storage/manifest';
import type { Install, SourceBlob } from '../src/lib/storage/opfs';
import type { SourceFile } from '../src/lib/storage/plan';
import { ascii, dat2 } from './archives';

/** Bytes that are the same however often they are made: a file of the game in the deck. */
export const pattern = (size: number, seed: number): Uint8Array => Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed * 7 + (i >>> 9)) & 0xff);

/**
 * sfall's ddraw.dll as far as its version goes: for each version information it has, the mark 0xFEEF04BD with the
 * numbers after it and the FileVersion text.
 */
export function sfallLibrary(...versions: [text: string, numbers: [number, number, number]][]): Uint8Array {
  const parts: Uint8Array[] = [pattern(64, 70)];
  for (const [text, [major, minor, build]] of versions) {
    const fixed = new DataView(new ArrayBuffer(52));
    fixed.setUint32(0, 0xfeef04bd, true);
    fixed.setUint32(4, 0x10000, true);
    fixed.setUint32(8, (major << 16) | minor, true);
    fixed.setUint32(12, build << 16, true);
    const strings = Uint8Array.from(`StringFileInfo\0\0FileVersion\0\0${text}\0`, (char) => char.charCodeAt(0));
    const wide = new Uint8Array(strings.length * 2);
    strings.forEach((char, i) => (wide[i * 2] = char));
    parts.push(new Uint8Array(fixed.buffer), wide, new Uint8Array(4 - (wide.length % 4 || 4)));
  }
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** A file far larger than memory would hold, whose bytes are only made when they are read. */
export const huge = (size: number, seed: number): SourceBlob =>
  sourceOf(size, 0, async (start, end) => Uint8Array.from({ length: end - start }, (_, i) => (start + i + seed) & 0xff));

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
/** Data, or a file whose bytes are made as they are read (see huge). */
type AnyData = Data | SourceBlob;

const isMade = (data: AnyData): data is SourceBlob => typeof data === 'object' && !(data instanceof Uint8Array) && !(data instanceof Blob);
const file = (data: AnyData, name = 'file'): SourceBlob =>
  isMade(data) ? data : new File([typeof data === 'string' ? ascii(data) : data instanceof Blob ? data : (data as Uint8Array<ArrayBuffer>)], name);

/** Files as a picked folder gives them, below `prefix`; `zip` as if they came out of one. */
export function sources(files: Record<string, AnyData>, prefix = '', zip?: string): SourceFile[] {
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
  const blobs = new Map<string, SourceBlob>();
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
    // sfall 5's, which keeps an older version's information after its own.
    'ddraw.dll': sfallLibrary(['5.1.6.1', [5, 0, 7]], ['5.0.7.0', [5, 0, 7]]),
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

/**
 * Fallout Fixt as its installer leaves a Fallout folder: the game as it was, and Fixt in a folder of its
 * own inside it, whose settings name the game's archives and music and its own data folder.
 */
export function fixtInstalledFiles(): Record<string, Data> {
  const game = fallout1Files();
  return {
    ...game,
    'DATA/MAPS/V13ENT.MAP': pattern(96, 84),
    'unins000.exe': 'not a program',
    'Play Fallout Fixt.lnk': 'a shortcut',
    'Fallout Fixt/FALLOUTW.exe': 'not a program',
    'Fallout Fixt/ddraw.dll': 'sfall',
    'Fallout Fixt/Troubleshooting Fallout Fixt.txt': 'Read me first.',
    'Fallout Fixt/fallout.cfg':
      '[sound]\r\nmusic_path1=..\\data\\sound\\music\r\nmusic_path2=data\\sound\\music\r\n[system]\r\nmaster_dat=..\\master.dat\r\ncritter_dat=..\\critter.dat\r\nmaster_patches=data\r\nlanguage=english\r\n',
    'Fallout Fixt/DATA/FIXT/install.log': '----------------INSTALL FINISHED----------------\r\n',
    'Fallout Fixt/DATA/SCRIPTS/SCRIPTS.LST': 'test.int ; a script\r\n',
    'Fallout Fixt/DATA/SCRIPTS/TEST.INT': pattern(800, 81),
    'Fallout Fixt/DATA/MAPS/V13ENT.MAP': pattern(96, 85),
    'Fallout Fixt/DATA/TEXT/ENGLISH/GAME/MISC.MSG': '{100}{}{Fixt}',
  };
}

/** The Megamod's zip, files to unzip over Fallout 2, with critter protos its tool puts into master.dat. */
export function megamodFiles(): Record<string, Data> {
  const files: Record<string, Data> = {
    'megamod.ini': '[SETTINGS]\r\nparty_armor_graphic=1\r\n',
    'ddraw.ini': '[Misc]\r\nElevatorsFile=Elevators.ini\r\n',
    'Elevators.ini': '[0]\r\nImage=143\r\n',
    'ddraw.dll': 'not a library',
    'proto/dat2.exe': 'not a program',
    'proto/Dat Replace.txt': 'critters\\00000062.pro\r\n',
    'proto/CRITTERS/00000062.pro': pattern(416, 91),
    'proto/CRITTERS/00000660.pro': pattern(416, 92),
    'Data/proto/critters/00000062.pro': pattern(416, 91),
    'Data/scripts/GL_Is_Megamod_Installed.int': pattern(300, 93),
    'Appearance/HMR00S01/art/critters/hmjmpsaa.frm': pattern(900, 94),
    'readme files/Abbey Readme.txt': 'Read me.',
  };
  for (let i = 0; i < 20; i++) files[`Data/text/english/dialog/mm${i}.msg`] = `{100}{}{Line ${i}}`;
  return files;
}

/**
 * Fallout 1.5: Resurrection as its zip holds it, to be unpacked into the Fallout 2 folder: a folder of its own
 * whose settings reach up for the game's archives and music, and its new music in the game's music folder.
 */
export function resurrectionFiles(): Record<string, Data> {
  return {
    'Resurrection/fores.dat': dat2({ 'text\\english\\game\\map.msg': { data: ascii('{100}{}{Albuquerque}'), packed: false } }),
    'Resurrection/fores_critter.dat': pattern(4000, 101),
    'Resurrection/fores.cfg':
      '[sound]\r\nmusic_path1=..\\data\\sound\\music\\\r\nmusic_path2=..\\sound\\music\\\r\n[system]\r\ncritter_dat=..\\critter.dat\r\ncritter_patches=fores_critter.dat\r\nmaster_dat=..\\master.dat\r\nmaster_patches=data\r\nlanguage=english\r\n[preferences]\r\ncombat_speed=60\r\n',
    'Resurrection/ddraw.ini': '[Misc]\r\nStartingMap=nh_cave.map\r\nConfigFile=fores.cfg\r\n',
    'Resurrection/f2_res.ini': '[MAIN]\r\nSCR_WIDTH=640\r\nf2_res_dat=fores.dat\r\nf2_res_patches=data\\\r\n',
    'Resurrection/CriticalOverrides.ini': '[c_00_0]\r\n',
    'Resurrection/fores.exe': 'not a program',
    'Resurrection/fores_config.exe': 'not a program either',
    // A copy of the game's program, named without its extension.
    'Resurrection/FALLOUT2': 'not a program',
    'Resurrection/ddraw.dll': 'sfall',
    'Resurrection/fores_readme.txt': 'read me',
    'Resurrection/data/art/cuts/intro.mve': pattern(1200 << 10, 102),
    'Resurrection/data/art/cuts/intro.pal': pattern(768, 103),
    'sound/music/06VAULT.ACM': pattern(120 << 10, 104),
    'sound/music/25albuq.acm': pattern(130 << 10, 105),
  };
}

/** A Fallout 2 folder Resurrection was unpacked into: the game as it was, Resurrection's folder and music in it. */
export function resurrectionInstalledFiles(): Record<string, Data> {
  return { ...fallout2Files(), ...resurrectionFiles() };
}

/**
 * Fallout Yesterday as its folder holds it, before Fallout 2's archives are copied in: a game of its own on
 * those three, with its patch001.dat a folder larger than one archive holds and a patch002.dat after it.
 */
export function yesterdayFiles(): Record<string, AnyData> {
  const files: Record<string, AnyData> = {
    'fallouty.cfg': '[sound]\r\nmusic_path1=data\\sound\\music\\\r\nmusic_path2=data\\sound\\music\\\r\n[system]\r\ncritter_dat=critter.dat\r\ncritter_patches=data\r\nmaster_dat=master.dat\r\nmaster_patches=data\r\nlanguage=english\r\n',
    'ddraw.ini': '[Misc]\r\nStartingMap=tbcb13.map\r\nConfigFile=fallouty.cfg\r\nPatchFile=patch%03d.dat\r\n',
    'f2_res.ini': '[MAIN]\r\nSCR_WIDTH=960\r\nSCR_HEIGHT=540\r\nf2_res_dat=f2_res.dat\r\nf2_res_patches=data\\\r\n',
    'FOYesterday.ico': 'an icon',
    'FY_v0.65_Walkthrough.pdf': 'a walkthrough',
    'ddraw.dll': 'sfall',
    'f2_res.dll': 'the high resolution patch',
    'f2_res_Config.exe': 'not a program',
    'install.sh': '#!/usr/bin/env bash\n',
    'sfall.dat': pattern(2000, 111),
    'patch002.dat': dat2({ 'text\\english\\game\\misc.msg': { data: ascii('{100}{}{Fixed}'), packed: false } }),
    'f2_res.dat/maps/artemple.edg': pattern(100, 112),
    'f2_res.dat/art/intrface/hr_iface_800.frm': pattern(900, 113),
    'patch001.dat/premade/combat.gcd': pattern(600, 114),
    'patch001.dat/text/english/game/map.msg': '{100}{}{Tibbets}',
    // 2.7 GB of art: more than one archive holds.
    'patch001.dat/art/critters/margosaa.frm': huge(900 << 20, 115),
    'patch001.dat/art/critters/maprtrbl.frm': huge(900 << 20, 116),
    'patch001.dat/art/walls/wpool.frm': huge(900 << 20, 117),
    'mods/mods_order.txt': '',
    'mods/FalloutYesterday.ini': '[Main]\r\nHunger=0\r\n',
    'mods/sfall-mods.ini': '[Highlighting]\r\nKey=42\r\n',
    'data/sound/music/45mesa.wav': pattern(150 << 10, 118),
    'data/art/cuts/title.mve': pattern(1100 << 10, 119),
    'appearance/hmr00s01/art/critters/hmjmpsaa.frm': pattern(900, 120),
    'translations/german/patch001.dat/text/german/game/map.msg': '{100}{}{Tibbets}',
    '_tools/Art/Tiles/PS - Tile Cutter.psd': 'tools',
  };
  for (let i = 0; i < 20; i++) files[`data/scripts/gl_fy${i}.int`] = pattern(300 + i, 130 + i);
  return files;
}

/** FO2tweaks as its zip holds it: sfall's library, and its archive and settings for the mods folder. */
export function fo2tweaksFiles(): Record<string, Data> {
  return {
    'ddraw.dll': sfallLibrary(['4.4.9.1', [4, 4, 9]]),
    'mods/fo2tweaks.ini': '[main]\r\nunlimited_trunk=1\r\n',
    'mods/fo2tweaks.dat': dat2({ 'scripts\\gl_fo2tweaks.int': { data: pattern(400, 140), packed: false } }),
  };
}

/** Party Orders as its zip holds it, with a load order of its own and a folder in its mods folder. */
export function partyOrdersFiles(): Record<string, Data> {
  return {
    'ddraw.dll': 'sfall',
    'mods/mods_order.txt': 'party_orders.dat\r\n;party_orders_extra.dat\r\nparty_orders_text\r\n',
    'mods/party_orders.dat': dat2({ 'scripts\\gl_partycontrol.int': { data: pattern(300, 141), packed: false } }),
    'mods/party_orders_extra.dat': dat2({ 'scripts\\gl_partyextra.int': { data: pattern(200, 142), packed: false } }),
    'mods/party_orders.ini': '[Keys]\r\nHeal=33\r\n',
    'mods/party_orders_text/text/english/game/party.msg': '{100}{}{Heal}',
    'readme.txt': 'Party Orders',
  };
}

/** Cassidy's talking head: one archive, handed over on its own. */
export function cassidyHeadFiles(): Record<string, Data> {
  return { 'cassidy_head.dat': dat2({ 'art\\heads\\cassidy.frm': { data: pattern(700, 143), packed: false } }) };
}

/** The music for both games, as its zip holds it: the tracks alone, to be put where the game keeps its own. */
export function musicFiles(): Record<string, Data> {
  return {
    '01hub.acm': pattern(120 << 10, 144),
    '02mstrlr.acm': pattern(110 << 10, 145),
    'wind1.acm': pattern(30 << 10, 146),
    'LICENSE.md': 'CC BY-NC-SA',
  };
}

/** An add-on of loose data in the folders of a data folder, as one "extracted into data" is. */
export function looseDataFiles(): Record<string, Data> {
  return {
    'Better Armour/art/critters/hmlthraa.frm': pattern(800, 147),
    'Better Armour/proto/items/00000074.pro': pattern(120, 148),
    'Better Armour/text/english/game/pro_item.msg': '{100}{}{Leather Armor Mk II}',
    'Better Armour/readme.txt': 'Unpack into data.',
  };
}
