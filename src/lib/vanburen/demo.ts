/**
 * The Fallout 3 "Van Buren" tech demo: the one playable build of Black Isle
 * Studios' Fallout 3, cancelled in 2003, kept by the Internet Archive. It is
 * played on Open Van Buren, an engine written anew for it.
 *
 * It is not a Fallout game to the console: no saves, mods, add-ons or deck.
 * Its files are kept on a shelf of their own (overseer-console/demos/vb/),
 * laid out as a game's are, and it starts on a page of its own.
 */
import { pathKey } from '../storage/manifest';

/** Its id in storage and in the player's address. */
export const DEMO_ID = 'vb';
export const DEMO_SHELF = 'demos';
/** Held by the page that plays the demo, for as long as it lives: its files are not taken from under it. */
export const DEMO_LOCK = 'overseer-console:play:vb';
/** What a fetched archive is kept as, beside the demo's files, until it is unpacked. */
export const DOWNLOAD = 'download.rar';

export const DEMO = {
  title: 'Van Buren',
  /** What it was. */
  full: 'Fallout 3 "Van Buren" tech demo',
  year: 2003,
  maker: 'Black Isle Studios',
  engine: {
    /** Its build under public/engines/. */
    id: 'vb',
    name: 'Open Van Buren',
    project: 'https://github.com/sulkytroll/open-vanburen',
    /** Global function the engine script defines. */
    factory: 'vanburen',
  },
  /** The release the Internet Archive keeps, as the console fetches it. */
  archive: {
    page: 'https://archive.org/details/f3demo',
    /** archive.org's address for a page on another site to read the file at (its /download/ one does not allow that). */
    url: 'https://archive.org/cors/f3demo/F3_Demo.rar',
    name: 'F3_Demo.rar',
    size: 253_425_960,
  },
} as const;

/**
 * What the engine reads of the demo, as the archive.org release has it: each
 * file's path, size and CRC-32 (from the archive's own headers). The rest of
 * the release is the original program, its libraries, two logo movies and a
 * second copy of Sounds.grp.
 */
export const DEMO_FILES: readonly (readonly [path: string, size: number, crc: number])[] = [
  ['resource.rht', 346_410, 0x0be9226a],
  ['English.stf', 254_846, 0xfdc86543],
  ['Fonts/JH_FALLOUT.TTF', 19_736, 0xcbce8098],
  ['Fonts/r_fallouty.ttf', 15_704, 0xa08f64ef],
  ['Fonts/TT0807M_.TTF', 55_872, 0xaba65a79],
  ['data/Critters.grp', 50_257_688, 0xc391eebe],
  ['data/Effects.grp', 1_896_473, 0x56eeb4c0],
  ['data/Engine.grp', 870_872, 0xa5e771af],
  ['data/Interface.grp', 33_265_532, 0xf3b83105],
  ['data/Items.grp', 2_876_542, 0x392d36e0],
  ['data/Maps.grp', 232_830_271, 0xa26e5087],
  ['data/Props.grp', 18_528_100, 0x7760c224],
  ['data/Scripts.grp', 5_832_974, 0x605b618e],
  ['data/Sounds.grp', 165_893_138, 0x53b91118],
  ['data/Templates.grp', 12, 0x5b44586e],
  ['data/Tiles.grp', 74_209_353, 0xf109cd59],
  ['data/_AMO.grp', 5_934, 0xa731feb7],
  ['data/_ARM.grp', 7_252, 0x0199299d],
  ['data/_CHM.grp', 12, 0x5b44586e],
  ['data/_CON.grp', 10_644, 0x088d9d6f],
  ['data/_CRT.grp', 55_984, 0x37a6ec38],
  ['data/_Dev.grp', 12, 0x5b44586e],
  ['data/_DOR.grp', 2_845, 0x2ef7428b],
  ['data/_ESF.grp', 12, 0x5b44586e],
  ['data/_ITM.grp', 1_297, 0x3571a441],
  ['data/_MSC.grp', 12, 0x5b44586e],
  ['data/_RLZ.grp', 12, 0x5b44586e],
  ['data/_USE.grp', 3_425, 0x3ceaeacd],
  ['data/_WEA.grp', 21_570, 0x1f8ac46c],
];

/** How much of the demo the console keeps. */
export const DEMO_BYTES = DEMO_FILES.reduce((sum, [, size]) => sum + size, 0);

const WANTED = new Map(DEMO_FILES.map(([path, size, crc]) => [pathKey(path), { path, size, crc }]));

/** Loose files the engine reads in place of packaged ones. */
const OVERRIDE = 'override/';

/**
 * Where a file of the demo's folder goes, by its path in that folder: the
 * path the engine reads it at, or null when the engine has no use for it.
 */
export function demoPath(path: string): string | null {
  const key = pathKey(path);
  const wanted = WANTED.get(key);
  if (wanted) return wanted.path;
  return key.startsWith(OVERRIDE) && key.length > OVERRIDE.length ? `Override/${path.replace(/\\/g, '/').split('/').slice(1).join('/')}` : null;
}

/** The files the engine reads that are not among `paths` (paths in the demo's folder). */
export function missingDemoFiles(paths: Iterable<string>): string[] {
  const have = new Set([...paths].map(pathKey));
  return DEMO_FILES.map(([path]) => path).filter((path) => !have.has(pathKey(path)));
}

/**
 * Whether a file is the one the archive.org release has: the same size and
 * CRC-32. Another copy of the demo (the one that starts in the Vault has its
 * own Engine.grp) is played all the same.
 */
export function isReleaseFile(path: string, size: number, crc?: number): boolean {
  const wanted = WANTED.get(pathKey(path));
  return !!wanted && wanted.size === size && (crc === undefined || wanted.crc === crc >>> 0);
}
