/**
 * The mods the console knows by name: what each is, where it is had, what to
 * hand the console, and how well it plays on the console's engines.
 *
 * Any other mod loads as well (see storage/mods.ts); one of these is
 * recognised for what it is, named, and started the way it is meant to be.
 */
import type { BaseGameId } from '../games';

export type KnownModId = 'ettu' | 'rpu' | 'megamod' | 'sonora' | 'nevada' | 'olympus' | 'resurrection' | 'yesterday' | 'fixt';

/**
 * How well a mod is known to play here.
 * tested: the console's own tests play it from its real files.
 * supported: the engine's makers say it plays.
 * experimental: it starts, and parts of it are known not to work.
 * unknown: nobody has said.
 */
export type ModStatus = 'tested' | 'supported' | 'experimental' | 'unknown';

/** The pictures a game can be started at; see settings.ts. */
type Picture = 'classic' | 'wide' | 'high';

export interface KnownMod {
  id: KnownModId;
  title: string;
  /** What the console calls it where room is short. */
  short: string;
  /** The game it is played on. */
  base: BaseGameId;
  /** The game whose own files it takes when it is put together, besides the one it is played on. */
  donor?: BaseGameId;
  /** Whose rules and words its saved games follow, where not those of the game it is played on. */
  world?: 'fo1' | 'fo2';
  blurb: string;
  /** Who made it, as its own credits name them. */
  authors: string;
  /** Its home. */
  project: string;
  /** Where it is downloaded. */
  download: string;
  /** What of it to hand the console, in a sentence. */
  handOver: string;
  status: ModStatus;
  /** What is known not to work, or what to know before playing. */
  caveat?: string;
  /** The picture it starts at, until the player chooses another. */
  picture: Picture;
  /** The fewest lines of picture it can be played at. */
  minHeight?: number;
  /**
   * When the engine's own data file goes beside it (see GameDef.engineData).
   * Unless given, as for the game it is played on.
   */
  engineData?: 'never' | 'improved' | 'always';
  /** Names for the parts its load order switches on and off, by file. */
  components?: Record<string, string>;
  /**
   * Words in the name of a folder or zip that it is usually kept in: a mod
   * installed by its own installer sits in a folder named after it.
   */
  names: RegExp;
  /** Files only it has, by lower-cased path in its folder: any one of them says it is this mod. */
  files?: string[];
  /** A whole game of its own, with its own archives: never the game in a deck. */
  standalone?: boolean;
  /** Where in the name of its zip or folder its version is. */
  version?: RegExp;
}

export const KNOWN_MODS: Record<KnownModId, KnownMod> = {
  ettu: {
    id: 'ettu',
    title: 'Fallout Et Tu',
    short: 'ET TU',
    base: 'fo2',
    donor: 'fo1',
    world: 'fo1',
    blurb: 'The first Fallout, rebuilt on the machinery of Fallout 2.',
    authors: 'Lexx, Wipe, Mayck and Ghosthack',
    project: 'https://github.com/rotators/Fo1in2',
    download: 'https://github.com/rotators/Fo1in2/releases',
    handOver: 'Fallout1in2.zip as it is downloaded, its Fallout1in2 folder, or the Fallout 2 folder that folder sits in. Fallout must be in deck A while it is loaded: speech, movies and map tiles are taken from it.',
    status: 'tested',
    picture: 'high',
    engineData: 'always',
    components: {
      fo1_base: 'The game itself',
      fo1_interface: 'The interface of the first Fallout',
      interfaceupscaled: 'The interface drawn twice as large',
    },
    names: /et.?tu|fo1in2|fallout ?1 ?in ?2/i,
  },
  rpu: {
    id: 'rpu',
    title: 'Restoration Project',
    short: 'RPU',
    base: 'fo2',
    blurb: 'Fallout 2 with what was cut from it put back, and its bugs fixed.',
    authors: 'Killap, carried on by BGforge',
    project: 'https://github.com/BGforgeNet/Fallout2_Restoration_Project',
    download: 'https://github.com/BGforgeNet/Fallout2_Restoration_Project/releases',
    handOver: 'The rpu zip from its releases page, not the installer: the console does what the installer does. A Fallout 2 folder it was installed in does as well.',
    status: 'tested',
    picture: 'classic',
    components: {
      'rpu.dat': 'The Restoration Project itself',
      'party_orders.dat': 'Orders for companions',
      'npc_armor.dat': 'Companions wear the armour they are given',
      'rpu_enhanced_worldmap.dat': 'A more detailed world map',
      'rpu_extended_flamer.dat': 'Longer flamer bursts',
      'rpu_rifle_animations.dat': 'Rifle animations',
      'rpu_wakizashi_animations.dat': 'Wakizashi animations',
      'rpu_alternative_explosions.dat': 'Other explosions',
      'cassidy_head.dat': "Cassidy's talking head",
      'cassidy_voice_joey_bracken_hq.dat': "Cassidy's voice",
      'rpu_improved_mysterious_stranger.dat': 'A better Mysterious Stranger',
    },
    names: /restoration|(^|[^a-z])rpu?([^a-z]|$)/i,
    files: ['mods/rpu.dat', 'rp-changelog.txt'],
    version: /\brpu[_ -]?v?(\d+(?:\.\d+)+)/i,
  },
  megamod: {
    id: 'megamod',
    title: 'Fallout 2 Megamod',
    short: 'MEGAMOD',
    base: 'fo2',
    blurb: "Fallout 2 with a world's worth of new places, people and quests.",
    authors: 'MIB88 and its many contributors',
    project: 'https://www.nma-fallout.com/resources/mib88-megamod.11/',
    download: 'https://www.nexusmods.com/fallout2/mods/116',
    handOver: 'The Megamod zip as it is downloaded, or a Fallout 2 folder it was installed in: the console does what its tool would have done.',
    status: 'tested',
    caveat: 'Made for the original engine with sfall; parts of it may not work on the Community Edition engine.',
    picture: 'classic',
    names: /mega.?mod|mib88/i,
    files: ['data/scripts/gl_is_megamod_installed.int', 'megamod.ini'],
    version: /mega.?mod[_ -]?v?(\d+(?:\.\d+)+)/i,
  },
  sonora: {
    id: 'sonora',
    standalone: true,
    title: 'Fallout: Sonora',
    short: 'SONORA',
    base: 'fo2',
    blurb: 'Arizona, years after Fallout 2: a whole new game on its engine.',
    authors: 'the Nevada Band (alposh), translated by cambragol',
    project: 'https://cambragol.github.io/Fallout-Sonora/',
    download: 'https://github.com/cambragol/Fallout-Sonora-English/releases',
    handOver: 'The Fallout_Sonora zip from its English releases page, as it is downloaded, or its folder.',
    status: 'tested',
    picture: 'classic',
    names: /sonora/i,
    files: ['fsonoradlc.exe', 'fsonora.exe', 'fallout-sonora-x64.exe', 'data/sound/music/fs_vault.acm'],
    version: /sonora[_ -]?v?(\d+(?:[._]\d+)+[a-z]?)/i,
  },
  nevada: {
    id: 'nevada',
    standalone: true,
    title: 'Fallout: Nevada',
    short: 'NEVADA',
    base: 'fo2',
    blurb: 'Nevada, before Fallout 1: a whole new game on the engine of Fallout 2.',
    authors: 'the Nevada Band (alposh), and the translators of its English version',
    project: 'https://github.com/BGforgeNet/fallout-nevada-english-translation',
    download: 'https://www.nma-fallout.com/threads/updated-english-translation-for-fallout-of-nevada.218882/',
    handOver: 'The folder Fallout: Nevada was installed in, with its English translation copied over it, as a folder or a zip.',
    status: 'tested',
    picture: 'classic',
    names: /nevada/i,
    version: /nevada[_ -]?v?(\d+(?:\.\d+)+[a-z]?)/i,
  },
  olympus: {
    id: 'olympus',
    standalone: true,
    title: 'Olympus 2207',
    short: 'OLYMPUS',
    base: 'fo2',
    blurb: 'A city under siege in the year 2207: a whole new game on the engine of Fallout 2.',
    authors: 'NEBESA GAMES, rebuilt by Foxx, translated by HogLord69',
    project: 'https://github.com/HogLord69/olympus-2207-english',
    download: 'https://github.com/HogLord69/olympus-2207-english/releases',
    handOver: 'Olympus-2207-English.zip as it is downloaded, or its folder.',
    status: 'tested',
    caveat: 'Made for sfall 5: what of it the Community Edition engine does not have is not there. It needs a picture at least 600 lines tall.',
    picture: 'high',
    minHeight: 600,
    names: /olympus/i,
    files: ['olympus.cfg', 'olympus.exe'],
  },
  resurrection: {
    id: 'resurrection',
    title: 'Fallout 1.5: Resurrection',
    short: 'RESURRECTION',
    base: 'fo2',
    blurb: 'New Mexico in 2170, between Fallout and Fallout 2: a whole new story on the engine of Fallout 2.',
    authors: 'the Resurrection Team: Daemon, Maryo, Ratman and Saruman',
    project: 'https://resurrection.cz/en/',
    download: 'https://resurrection.cz/en/download/',
    handOver: 'FoRes_EN_1_5.zip from its download page, not the installer; or a Fallout 2 folder it was installed in. It is played in a folder of its own, with the archives of your Fallout 2 in deck B.',
    status: 'tested',
    caveat: "What its scripts change in the original program itself does not come along.",
    picture: 'classic',
    names: /resurrection|(^|[^a-z])fores([^a-z]|$)/i,
    files: ['fores.dat', 'fores.exe', 'fores_critter.dat'],
    version: /fores[_ -]?(?:en[_ -])?v?(\d+(?:[._]\d+)+)/i,
  },
  yesterday: {
    id: 'yesterday',
    standalone: true,
    title: 'Fallout Yesterday',
    short: 'YESTERDAY',
    base: 'fo2',
    blurb: "Black Isle's lost Fallout 3, Van Buren, made into a whole game on the engine of Fallout 2.",
    authors: 'PJ Hexer and its many contributors',
    project: 'https://gitlab.com/falloutfans/fallouty',
    download: 'https://www.nexusmods.com/fallout2/mods/91',
    handOver: 'The folder its 7z unpacks to, as it is (the console opens zips only), or the folder it was installed in. The archives it takes from Fallout 2 are those of your Fallout 2 in deck B.',
    status: 'tested',
    caveat: "Made for sfall 4 on the original engine: Hero Appearance (the look picked for your character), its few MP3 sounds, and what its scripts change in the original program itself (its footstep sounds among them) are not there.",
    picture: 'wide',
    names: /yesterday|fallouty|van ?buren/i,
    files: ['fallouty.cfg', 'foyesterday.ico'],
    version: /(?:yesterday|fallouty|fy)[_ -]?v?(\d+(?:\.\d+)+)/i,
  },
  fixt: {
    id: 'fixt',
    title: 'Fallout Fixt',
    short: 'FIXT',
    base: 'fo1',
    blurb: 'The first Fallout with its bugs fixed and cut content put back.',
    authors: 'Sduibek',
    project: 'https://www.moddb.com/mods/fallout-fixt',
    download: 'https://www.moddb.com/mods/fallout-fixt/downloads',
    handOver: 'A Fallout folder Fixt was installed in, as a folder or a zip: its installer runs on a desktop only.',
    status: 'tested',
    caveat: "What Fixt changes in the game's program itself does not come along: its files do.",
    picture: 'classic',
    names: /fixt/i,
    // Its installer puts it in a folder of its own inside the Fallout folder, and writes a log there.
    files: ['data/fixt/install.log', 'troubleshooting fallout fixt.txt'],
    version: /fixt[_ -]?v?(\d+(?:\.\d+)+[a-z]?)/i,
  },
};

export const KNOWN_MOD_IDS = Object.keys(KNOWN_MODS) as KnownModId[];

export function isKnownMod(value: unknown): value is KnownModId {
  return typeof value === 'string' && Object.hasOwn(KNOWN_MODS, value);
}
