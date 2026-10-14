/** A copy of Fallout Et Tu made up for the tests: the layout of the real package, a few bytes in each file. */
import { ascii, dat1, dat2 } from './archives';

export const MOVIE = Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) % 251);
export const SPEECH = Uint8Array.from({ length: 700 }, (_, i) => (i * 13) % 241);
export const TILE = Uint8Array.from({ length: 400 }, (_, i) => (i * 3) % 199);

export const PERKS = Array.from({ length: 119 }, (_, i) => `{${101 + i}}{}{Et Tu perk ${i}}`).join('\r\n');
export const TRAITS = Array.from({ length: 16 }, (_, i) => `{${100 + i}}{}{${i === 13 ? 'Night Person' : `Trait ${i}`}}`).join('\r\n');
export const SKILLS = Array.from({ length: 18 }, (_, i) => `{${100 + i}}{}{Skill ${i}}`).join('\r\n');

/** A font file the engines accept: 256 glyphs of 8 by 8 pixels, all blank. Made up, like everything here. */
export function blankFont(): Uint8Array {
  const glyphs = 256;
  const out = new Uint8Array(20 + glyphs * 8 + 8 + (glyphs - 1) * 8);
  const view = new DataView(out.buffer);
  view.setInt32(0, glyphs, true);
  view.setInt32(4, 8, true);
  view.setInt32(8, 1, true);
  for (let i = 0; i < glyphs; i++) {
    view.setInt32(20 + i * 8, 8, true);
    view.setInt32(24 + i * 8, i * 8, true);
  }
  return out;
}

export interface EttuOptions {
  /** A package made since Et Tu took up the Community Edition engine. */
  forEngine?: boolean;
  /** Its own tool has already copied the Fallout files into the data folder. */
  extracted?: boolean;
  /** Without the list of Fallout files it needs. */
  withoutList?: boolean;
  /** Saved games in its data folder. */
  saves?: boolean;
  /** More files to ask of Fallout, as its list names them. */
  borrow?: string[];
  /** Has the engine say what it does, on its standard output. */
  engineLog?: boolean;
}

/** The files of the package, by path below its folder. */
export function ettuFiles(options: EttuOptions = {}): Record<string, Uint8Array> {
  const palette = Uint8Array.from({ length: 800 }, (_, i) => i % 64);
  const files: Record<string, Uint8Array> = {
    'Fallout2.cfg': ascii('[system]\r\nmaster_dat=..\\master.dat\r\ncritter_dat=..\\critter.dat\r\nmaster_patches=data\r\ncritter_patches=data\r\nlanguage=english\r\n[sound]\r\nmusic_path1=data\\sound\\music\\\r\nmusic_path2=..\\data\\sound\\music\\\r\n[preferences]\r\ntext_base_delay=3.5\r\n'),
    'Fallout2.exe': ascii('not a program'),
    'ddraw.dll': ascii('not a library'),
    'ddraw.ini': ascii('[Misc]\r\nStartingMap=V13ent.map\r\nPerksFile=config\\Perks.ini\r\n'),
    'f2_res.ini': ascii('[IFACE]\r\nIFACE_BAR_WIDTH=800\r\n'),
    'README.txt': ascii('read me'),
    'sfall.dat': ascii('for another engine'),
    'Appearance/HMR00S00.dat': new Uint8Array(2000).fill(4),
    'config/fo1_settings.ini': ascii('[Fo1in2]\r\nGVAR_ENABLE_MOTORCYCLE=0\r\n'),
    'config/Perks.ini': ascii('[Perks]\r\n'),
    'mods/mods_order.txt': ascii('fo1_base\r\nfo1_interface\r\n;InterfaceUpscaled\r\n;fo1_lang_german\r\n'),
    // As the package ships it: its own key for lighting things up is the left CTRL key.
    'mods/sfall-mods.ini': ascii('[Highlighting]\r\nKey=29\r\nCheckLOS=1\r\n'),
    'mods/fo1_base/color.pal': palette,
    'mods/fo1_base/text/english/game/perk.msg': ascii(PERKS),
    'mods/fo1_base/text/english/game/trait.msg': ascii(TRAITS),
    'mods/fo1_base/text/english/game/skill.msg': ascii(SKILLS),
    'mods/fo1_base/art/critters/HMJMPSAA.FRM': new Uint8Array(1500).fill(7),
    'mods/fo1_base/scripts/gl_fo1mechanics.int': new Uint8Array(900).fill(8),
    'mods/fo1_base/maps/V13ENT.MAP': new Uint8Array(2500).fill(9),
    'mods/fo1_interface/art/intrface/IFACE.FRM': new Uint8Array(1100).fill(10),
    'mods/InterfaceUpscaled/art/intrface/DEATH.FRM': new Uint8Array(5000).fill(11),
    'mods/fo1_lang_german/text/german/game/perk.msg': ascii('{101}{}{Wachsamkeit}'),
    'data/sound/music/01HUB.ACM': new Uint8Array(2048).fill(12),
    'data/text/english/Translations.ini': ascii('[Sfall]\r\nSaveInCombat=No\r\n'),
  };
  if (!options.withoutList) {
    files['undat_files.txt'] = ascii(['ART\\CUTS\\INTRO.MVE', 'SOUND\\SPEECH\\OVR\\OVR1.ACM', 'ART\\TILES\\EDG5000.FRM', ...(options.borrow ?? []), ''].join('\r\n'));
  }
  if (options.engineLog) files['Fallout2.cfg'] = ascii(`${new TextDecoder().decode(files['Fallout2.cfg'])}[debug]\r\nmode=screen\r\n`);
  if (options.forEngine) files['fallout2-ce.exe'] = ascii('not a program either');
  if (options.extracted) {
    files['data/ART/CUTS/INTRO.MVE'] = MOVIE;
    files['data/SOUND/SPEECH/OVR/OVR1.ACM'] = SPEECH;
    files['data/ART/TILES/EDG5000.FRM'] = TILE;
    // Left behind by a game that was played in the folder.
    files['data/maps/V13ENT.SAV'] = new Uint8Array(64).fill(1);
    files['data/proto/critters/00000001.pro'] = new Uint8Array(64).fill(2);
  }
  if (options.saves) files['data/SAVEGAME/SLOT01/SAVE.DAT'] = new Uint8Array(64).fill(3);
  return files;
}

/**
 * Fallout's MASTER.DAT, holding what Et Tu borrows in each of the three ways
 * a file can be stored there, and a font: packed, under an upper-case name.
 */
export function fallout1Master(): Blob {
  return dat1({
    '.': { 'COLOR.PAL': { data: Uint8Array.from({ length: 800 }, (_, i) => i % 64), mode: 0x20 }, 'FONT0.FON': { data: blankFont(), mode: 0x10 } },
    'ART\\CUTS': { 'INTRO.MVE': { data: MOVIE, mode: 0x20 }, 'OTHER.MVE': { data: new Uint8Array(50).fill(5), mode: 0x20 } },
    'SOUND\\SPEECH\\OVR': { 'OVR1.ACM': { data: SPEECH, mode: 0x10 } },
    'ART\\TILES': { 'EDG5000.FRM': { data: TILE, mode: 0x40 } },
  });
}

/** A Fallout 2 archive that really is one. */
export function fallout2Master(): Blob {
  return dat2({ 'color.pal': { data: Uint8Array.from({ length: 800 }, (_, i) => i % 64), packed: false } });
}
