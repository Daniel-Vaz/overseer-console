/**
 * Installing a known mod's release (see releases.ts) without the player
 * downloading it: the cloud they linked downloads it into its Mods folder,
 * server to server, and the console loads it from there as from any mod
 * kept in the cloud. Only a cloud that can download from the web does it
 * (Dropbox); the rest of the time the player's browser downloads it and the
 * player hands it over.
 */
import { CloudError } from '../cloud/errors';
import { modsFolder } from '../cloud/games';
import type { Cloud, CloudFile } from '../cloud/provider';
import { formatBytes } from '../storage/manifest';
import { ImportError } from '../storage/plan';
import { KNOWN_MODS, type KnownModId } from './catalog';
import type { ZipRelease } from './releases';

/** Whether the cloud can download a release by itself. */
export function cloudFetches(cloud: Cloud | null): boolean {
  return !!cloud?.saveUrl;
}

/**
 * The release as the cloud's Mods folder holds it already, if it does: by
 * its name, or under another name at its exact size (a second copy Dropbox
 * numbered, or one the player renamed).
 */
export async function releaseInCloud(release: ZipRelease, cloud: Cloud): Promise<CloudFile | null> {
  let files: CloudFile[];
  try {
    files = await cloud.listFiles(modsFolder(cloud));
  } catch (err) {
    if (err instanceof CloudError && err.notFound) return null;
    throw err;
  }
  const zips = files.filter((file) => file.size === release.bytes && /\.zip$/i.test(file.name));
  return zips.find((file) => file.name.toLowerCase() === release.file.toLowerCase()) ?? zips[0] ?? null;
}

/**
 * Has the cloud download the release into its Mods folder, unless it is
 * there already, and returns it as the cloud holds it. `started` is called
 * when the cloud has been asked to download it.
 */
export async function fetchIntoCloud(release: ZipRelease, cloud: Cloud, signal?: AbortSignal, started?: () => void): Promise<CloudFile> {
  const held = await releaseInCloud(release, cloud);
  if (held) return held;
  if (!cloud.saveUrl) throw new ImportError(`${cloud.name} cannot download from the web by itself: download ${release.file} with this browser and hand it over.`);
  started?.();
  const file = await cloud.saveUrl(`${modsFolder(cloud)}/${release.file}`, release.url, signal);
  if (file.size !== release.bytes) {
    // A page instead of the file, or another version under the same address.
    throw new ImportError(
      `What ${cloud.name} downloaded as ${file.name} is ${formatBytes(file.size)}, not the ${formatBytes(release.bytes)} of ${release.file}. ` +
        `Delete it from the Mods folder of your ${cloud.name}, and download it with this browser instead.`,
    );
  }
  return file;
}

/**
 * Whether what was handed over looks like the mod: a file only it has, or a
 * folder (or zip) named after it. For a mod handed over as a folder, where no
 * one file can be told by its size.
 */
export function looksLikeMod(mod: KnownModId, sources: { path: string; zip?: string }[]): boolean {
  const known = KNOWN_MODS[mod];
  const paths = sources.map((source) => source.path.replace(/\\/g, '/').toLowerCase());
  if (known.files?.some((file) => paths.some((path) => path === file || path.endsWith(`/${file}`)))) return true;
  const folders = new Set(paths.flatMap((path) => path.split('/').slice(0, -1)));
  for (const source of sources) if (source.zip) folders.add(source.zip);
  return [...folders].some((name) => known.names.test(name));
}
