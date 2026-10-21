/**
 * The release of each known mod the console installs, and how it goes about
 * it, from its makers' own link. One version of each: the one the console's
 * tests play.
 *
 * Kinds:
 *   zip        one zip from a link that needs no sign-in: the console takes
 *              it as it is, and Dropbox can download it by itself
 *   signed-in  one zip the console takes as it is, from a site that asks the
 *              player to sign in: downloaded by the player's browser only
 *   unpack     an archive the console cannot open (a 7z): the player unpacks
 *              it, and hands over the folder
 *   installer  an installer for a desktop: the player runs it there, and hands
 *              over the folder it filled
 *
 * A zip handed over is told by its exact size; a folder by the files of the
 * mod's own it holds (see install.ts).
 *
 * To move a mod to a newer release, change its entry here and play it from
 * its real files (docs/developing.md); `npm run mod-releases` says which
 * have a newer release on GitHub.
 *
 * None of the hosts lets a page of another site read what it serves, so the
 * console never downloads a release itself: Dropbox does, into the player's
 * Mods folder, or the player's browser does, and the player hands it over.
 */
import type { KnownModId } from './catalog';

export type ReleaseKind = 'zip' | 'signed-in' | 'unpack' | 'installer';

export interface ModRelease {
  mod: KnownModId;
  kind: ReleaseKind;
  /** As its makers number it, where one version is meant. */
  version?: string;
  /** What is downloaded, by the name it is downloaded as. */
  file?: string;
  /** Where it is downloaded: the file itself, or the page it is downloaded from. */
  url: string;
  /** The size of what is downloaded. For the two kinds of zip, what tells the file handed over is this one. */
  bytes?: number;
  /** What else there is to do before it is handed over, where there is something. */
  note?: string;
  /** Where newer releases are looked for, for `npm run mod-releases`: a GitHub repository. */
  github?: { repo: string; asset: RegExp };
}

export const MOD_RELEASES: Partial<Record<KnownModId, ModRelease>> = {
  ettu: {
    mod: 'ettu',
    kind: 'zip',
    version: '2.0.3911',
    file: 'Fallout1in2.zip',
    url: 'https://github.com/rotators/Fo1in2/releases/download/v2.0.3911/Fallout1in2.zip',
    bytes: 412_718_928,
    github: { repo: 'rotators/Fo1in2', asset: /^Fallout1in2\.zip$/ },
  },
  rpu: {
    mod: 'rpu',
    kind: 'zip',
    version: '2.4.34',
    file: 'rpu_v2.4.34.zip',
    url: 'https://github.com/BGforgeNet/Fallout2_Restoration_Project/releases/download/v2.4.34/rpu_v2.4.34.zip',
    bytes: 866_970_542,
    github: { repo: 'BGforgeNet/Fallout2_Restoration_Project', asset: /^rpu_v[\d.]+\.zip$/ },
  },
  sonora: {
    mod: 'sonora',
    kind: 'zip',
    version: '1.16.4E',
    file: 'Fallout_Sonora_1.16.4E.zip',
    url: 'https://github.com/cambragol/Fallout-Sonora-English/releases/download/1.16.4/Fallout_Sonora_1.16.4E.zip',
    bytes: 1_734_253_876,
    github: { repo: 'cambragol/Fallout-Sonora-English', asset: /^Fallout_Sonora_[\w.]+\.zip$/ },
  },
  olympus: {
    mod: 'olympus',
    kind: 'zip',
    version: '1.1',
    file: 'Olympus-2207-English.zip',
    url: 'https://github.com/HogLord69/olympus-2207-english/releases/download/v1.1/Olympus-2207-English.zip',
    bytes: 1_852_332_656,
    github: { repo: 'HogLord69/olympus-2207-english', asset: /^Olympus-2207-English\.zip$/ },
  },
  resurrection: {
    mod: 'resurrection',
    kind: 'zip',
    version: '1.5',
    file: 'FoRes_EN_1_5.zip',
    url: 'https://bitbucket.org/resurrection/fallout-resurrection/downloads/FoRes_EN_1_5.zip',
    bytes: 358_069_166,
  },
  megamod: {
    mod: 'megamod',
    kind: 'signed-in',
    version: '2.47.8',
    file: 'Fallout 2 Megamod 2.47.8.zip',
    url: 'https://www.nexusmods.com/fallout2/mods/116?tab=files',
    bytes: 1_046_861_474,
  },
  yesterday: {
    mod: 'yesterday',
    kind: 'unpack',
    version: '0.6.5',
    file: 'FYv065.1.7z',
    url: 'https://www.nexusmods.com/fallout2/mods/91?tab=files',
    note: 'It takes three archives of your Fallout 2 in deck B: there is no need to copy them into its folder.',
  },
  nevada: {
    mod: 'nevada',
    kind: 'installer',
    url: 'https://www.nma-fallout.com/threads/updated-english-translation-for-fallout-of-nevada.218882/',
    note: 'Copy its English translation over the folder it installed in first: without it the game is in Russian.',
  },
  fixt: {
    mod: 'fixt',
    kind: 'installer',
    version: '0.81alpha',
    file: 'Fallout_Fixt_0.81alpha_FULL_CUSTOM.exe',
    url: 'https://github.com/Sduibek/fixtsrc/releases/download/0.81alpha/Fallout_Fixt_0.81alpha_FULL_CUSTOM.exe',
    bytes: 214_049_816,
    note: 'Its installer goes into your Fallout folder and puts Fixt in a Fallout Fixt folder there: hand over either.',
    github: { repo: 'Sduibek/fixtsrc', asset: /^Fallout_Fixt_[\w.]+_FULL_CUSTOM\.exe$/ },
  },
};

/** A release that is one zip, the console is handed as it is downloaded. */
export type ZipRelease = ModRelease & { version: string; file: string; bytes: number };

/** Whether what is downloaded is what the console is handed: one zip, told by its size. */
export function isZip(release: ModRelease): release is ZipRelease {
  return (release.kind === 'zip' || release.kind === 'signed-in') && !!release.version && !!release.file && !!release.bytes;
}

/** Whether a cloud that downloads from the web (Dropbox) can download it: a zip from a link that needs no sign-in. */
export function cloudCanFetch(release: ModRelease): release is ZipRelease {
  return release.kind === 'zip' && isZip(release);
}

/** The release of a known mod the console installs, if it installs one. */
export function releaseOf(mod: KnownModId | undefined): ModRelease | undefined {
  return mod ? MOD_RELEASES[mod] : undefined;
}

/** What a file handed over is, against the release it should be. */
export function matchRelease(release: ZipRelease, file: { name: string; size: number }): 'same' | 'other-size' | 'other-name' {
  if (file.size === release.bytes) return 'same';
  // Browsers number a second download of the same name: "Fallout1in2 (1).zip".
  const name = file.name.replace(/ \(\d+\)(?=\.[^.]+$)/, '').toLowerCase();
  return name === release.file.toLowerCase() ? 'other-size' : 'other-name';
}

/**
 * Whether a mod loaded at `installed` is older than the release the console
 * installs. Unknown versions are not called older: there is nothing to say;
 * nor is anything older than a release the console cannot tell by its size.
 */
export function isOlder(installed: string | undefined, release: ModRelease): boolean {
  if (!installed || !isZip(release)) return false;
  const parts = (version: string) => version.match(/\d+/g)?.map(Number) ?? [];
  const [a, b] = [parts(installed), parts(release.version)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x < y;
  }
  return false;
}
