/**
 * Putting a game or a mod into the player's cloud, from this device.
 *
 * Google lets the console see only what the console itself put in a Drive,
 * so this is how games and mods get into one. In Dropbox it spares a trip to
 * Dropbox's own app. Whatever is handed over arrives as one zip: a zip as it
 * is, a folder packed into one on the way. One file arrives whole or not at
 * all, is one entry to list, and spares the cloud the thousands of small
 * files some mods are made of (Fallout: Nevada is close to fifty thousand).
 */
import { gameDef } from '../games';
import { detectDatFormat, type SourceFile } from '../storage/importer';
import { basename, formatBytes } from '../storage/manifest';
import type { SourceBlob } from '../storage/opfs';
import { ImportError, isJunk } from '../storage/plan';
import { looksLikeZip, readZip } from '../zip';
import { packZip } from '../zipwriter';
import { requireCloud } from './clouds';
import { CloudError } from './errors';
import { modsFolder } from './games';
import type { Cloud, CloudFile } from './provider';

export type PutKind = 'game' | 'mod';

export interface PutPlan {
  kind: PutKind;
  /** The zip's name in the cloud. */
  name: string;
  /** Its path below the console's folder: in the games folder, or in its Mods folder. */
  path: string;
  /** What is packed into the zip; null when a zip was handed over, to go as it is. */
  files: { path: string; file: Blob; modified: number }[] | null;
  /** The zip handed over. */
  zip: Blob | null;
  /** About what the zip will take up. */
  bytes: number;
  modified: number;
  /** What the cloud holds of that name already: it is replaced, once the player says so. */
  existing: CloudFile | null;
}

/** A file from this device: one the browser can send as it reads it. */
function isBlob(file: unknown): file is Blob {
  return typeof Blob !== 'undefined' && file instanceof Blob;
}

interface LocalFile {
  path: string;
  file: SourceBlob & Blob;
}

/** The folder everything picked lies in, when it all lies in one. */
function commonFolder(sources: LocalFile[]): string {
  const first = sources[0]?.path.split('/')[0] ?? '';
  return sources.every((source) => source.path.includes('/') && source.path.split('/')[0] === first) ? first : '';
}

function zipNameFor(name: string): string {
  // Neither cloud takes these in a name.
  const tidy = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return looksLikeZip(tidy) ? tidy : `${tidy}.zip`;
}

/** What the folder `name` holds directly, in the cloud; null where it holds nothing of that name. */
async function lookFor(cloud: Cloud, folder: string, name: string): Promise<CloudFile | null> {
  try {
    return (await cloud.listFiles(folder)).find((file) => file.name.toLowerCase() === name.toLowerCase()) ?? null;
  } catch (err) {
    if (err instanceof CloudError && err.notFound) return null;
    throw err;
  }
}

/**
 * Works out what goes where, and checks it before anything is sent: that a
 * game holds a game, and that the cloud has room for it.
 */
export async function planPut(sources: SourceFile[], kind: PutKind, cloud: Cloud = requireCloud()): Promise<PutPlan> {
  const picked: LocalFile[] = [];
  for (const source of sources) {
    if (isJunk(basename(source.path).toLowerCase())) continue;
    if (!isBlob(source.file)) throw new ImportError('Only files from this device can be put in your cloud.');
    picked.push({ path: source.path, file: source.file });
  }
  if (!picked.length) throw new ImportError('Nothing was picked.');
  const what = kind === 'game' ? 'game' : 'mod';

  let name: string;
  let files: PutPlan['files'] = null;
  let zip: Blob | null = null;
  let modified = Date.now();
  if (picked.length === 1 && looksLikeZip(picked[0]!.path)) {
    // A zip goes as it is.
    zip = picked[0]!.file;
    name = zipNameFor(basename(picked[0]!.path));
    modified = picked[0]!.file.lastModified || modified;
    if (kind === 'game') {
      let inside: { path: string }[];
      try {
        inside = await readZip(picked[0]!.file);
      } catch (err) {
        throw new ImportError(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!inside.some((file) => /(^|\/)master\.dat$/i.test(file.path))) {
        throw new ImportError(`There is no MASTER.DAT in ${name}. Pick a zip of the folder the game is installed in.`);
      }
    }
  } else {
    const master = picked.find((source) => /(^|\/)master\.dat$/i.test(source.path));
    if (kind === 'game' && !master) {
      throw new ImportError('There is no MASTER.DAT in what you picked. Pick the folder the game is installed in: the one that holds MASTER.DAT and CRITTER.DAT.');
    }
    let folder = commonFolder(picked);
    if (!folder && master) {
      // Loose files: named after the game they are.
      const format = await detectDatFormat(master.file);
      folder = format === 'dat1' ? gameDef('fo1').title : format === 'dat2' ? gameDef('fo2').title : '';
    }
    name = zipNameFor(folder || (kind === 'game' ? 'Game' : 'Mod'));
    files = picked.map((source) => ({ path: source.path, file: source.file, modified: source.file.lastModified || Date.now() }));
  }

  const bytes = zip ? zip.size : files!.reduce((sum, file) => sum + file.file.size + 128 + file.path.length * 2, 22);
  const folder = kind === 'game' ? cloud.folders().gamesFolder : modsFolder(cloud);
  const path = `${folder}/${name}`;
  const [existing, space] = await Promise.all([lookFor(cloud, folder, name), cloud.space().catch(() => null)]);
  if (space) {
    const free = Math.max(0, space.total - space.used);
    if (free < bytes) {
      throw new ImportError(
        `Your ${cloud.name} has ${formatBytes(free)} free, and this ${what} needs ${formatBytes(bytes)}.` +
          (cloud.id === 'drive' ? ' Its room is shared with your Gmail and Google Photos.' : ''),
      );
    }
  }
  return { kind, name, path, files, zip, bytes, modified, existing };
}

export interface PutProgress {
  /** packing: reading the files for their checksums. sending: on the way. */
  phase: 'packing' | 'sending';
  doneBytes: number;
  totalBytes: number;
  /** The file being read, while packing. */
  path?: string;
}

/** Sends what planPut worked out. Returns the zip as the cloud now holds it. */
export async function runPut(plan: PutPlan, onProgress: (progress: PutProgress) => void, signal?: AbortSignal, cloud: Cloud = requireCloud()): Promise<CloudFile> {
  const data =
    plan.zip ??
    (await packZip(plan.files!, {
      signal,
      onProgress: (doneBytes, totalBytes, path) => onProgress({ phase: 'packing', doneBytes, totalBytes, path }),
    }));
  onProgress({ phase: 'sending', doneBytes: 0, totalBytes: data.size });
  return cloud.send(plan.path, data, {
    modified: plan.modified,
    replace: plan.existing !== null,
    signal,
    onProgress: (sent) => onProgress({ phase: 'sending', doneBytes: sent, totalBytes: data.size }),
  });
}
