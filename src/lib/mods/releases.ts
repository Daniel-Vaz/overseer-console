/**
 * The releases of known mods the console can fetch and install by itself:
 * those that come as one zip the console takes as it is, from a link that
 * needs no sign-in. One version of each, the one the console's tests play.
 *
 * To move a mod to a newer release, change its entry here (version, file,
 * url, bytes) and play it from its real files (docs/developing.md);
 * `npm run mod-releases` says which mods have a newer release than this.
 *
 * None of the hosts lets a page of another site read what it serves, so the
 * console never downloads a release itself: Dropbox does, into the player's
 * Mods folder, or the player's browser does, and the player hands it over.
 */
import type { KnownModId } from './catalog';

export interface ModRelease {
  mod: KnownModId;
  /** As its makers number it. */
  version: string;
  /** The file's name as it is downloaded. */
  file: string;
  /** Where it is downloaded, with no sign-in. */
  url: string;
  /** Its exact size: what tells the file handed over is this one. */
  bytes: number;
  /** Where newer releases are looked for, for `npm run mod-releases`: a GitHub repository. */
  github?: { repo: string; asset: RegExp };
}

export const MOD_RELEASES: Partial<Record<KnownModId, ModRelease>> = {
  ettu: {
    mod: 'ettu',
    version: '2.0.3911',
    file: 'Fallout1in2.zip',
    url: 'https://github.com/rotators/Fo1in2/releases/download/v2.0.3911/Fallout1in2.zip',
    bytes: 412_718_928,
    github: { repo: 'rotators/Fo1in2', asset: /^Fallout1in2\.zip$/ },
  },
  rpu: {
    mod: 'rpu',
    version: '2.4.34',
    file: 'rpu_v2.4.34.zip',
    url: 'https://github.com/BGforgeNet/Fallout2_Restoration_Project/releases/download/v2.4.34/rpu_v2.4.34.zip',
    bytes: 866_970_542,
    github: { repo: 'BGforgeNet/Fallout2_Restoration_Project', asset: /^rpu_v[\d.]+\.zip$/ },
  },
  sonora: {
    mod: 'sonora',
    version: '1.16.4E',
    file: 'Fallout_Sonora_1.16.4E.zip',
    url: 'https://github.com/cambragol/Fallout-Sonora-English/releases/download/1.16.4/Fallout_Sonora_1.16.4E.zip',
    bytes: 1_734_253_876,
    github: { repo: 'cambragol/Fallout-Sonora-English', asset: /^Fallout_Sonora_[\w.]+\.zip$/ },
  },
  olympus: {
    mod: 'olympus',
    version: '1.1',
    file: 'Olympus-2207-English.zip',
    url: 'https://github.com/HogLord69/olympus-2207-english/releases/download/v1.1/Olympus-2207-English.zip',
    bytes: 1_852_332_656,
    github: { repo: 'HogLord69/olympus-2207-english', asset: /^Olympus-2207-English\.zip$/ },
  },
  resurrection: {
    mod: 'resurrection',
    version: '1.5',
    file: 'FoRes_EN_1_5.zip',
    url: 'https://bitbucket.org/resurrection/fallout-resurrection/downloads/FoRes_EN_1_5.zip',
    bytes: 358_069_166,
  },
};

/** The release of a known mod the console installs, if it installs one. */
export function releaseOf(mod: KnownModId | undefined): ModRelease | undefined {
  return mod ? MOD_RELEASES[mod] : undefined;
}

/** What a file handed over is, against the release it should be. */
export function matchRelease(release: ModRelease, file: { name: string; size: number }): 'same' | 'other-size' | 'other-name' {
  if (file.size === release.bytes) return 'same';
  // Browsers number a second download of the same name: "Fallout1in2 (1).zip".
  const name = file.name.replace(/ \(\d+\)(?=\.[^.]+$)/, '').toLowerCase();
  return name === release.file.toLowerCase() ? 'other-size' : 'other-name';
}

/**
 * Whether a mod loaded at `installed` is older than the release the console
 * installs. Unknown versions are not called older: there is nothing to say.
 */
export function isOlder(installed: string | undefined, release: ModRelease): boolean {
  if (!installed) return false;
  const parts = (version: string) => version.match(/\d+/g)?.map(Number) ?? [];
  const [a, b] = [parts(installed), parts(release.version)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x < y;
  }
  return false;
}
