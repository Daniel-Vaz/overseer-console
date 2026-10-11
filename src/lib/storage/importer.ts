/**
 * Turns "a folder the user pointed at" into an installed game.
 *
 * The folder is whatever a store installed: executables, manuals and patch
 * tools next to the data that matters. Importing finds the game inside it,
 * keeps what the engine reads and leaves the rest.
 */
import { GAMES, gameForDatFormat, type DatFormat, type GameId } from '../games';
import { Ini } from '../ini';
import { MANIFEST_VERSION, basename, dirname, pathKey, type Manifest } from './manifest';
import { writeInstall, type ImportProgress } from './opfs';
import type { ImportEntry } from './opfs.worker';
import { commitOverlay, countOverlay } from './overlay';

export interface SourceFile {
  /** Path as the browser reported it, forward slashes. */
  path: string;
  file: File;
}

export class ImportError extends Error {
  override name = 'ImportError';
}

export interface ImportPlan {
  game: GameId;
  datFormat: DatFormat;
  /** Folder (inside the selection) the game was found in. */
  root: string;
  entries: ImportEntry[];
  dirs: string[];
  totalBytes: number;
  skipped: number;
  /** Saved games found in the install. */
  saves: SourceFile[];
  installConfig?: string;
  language?: string;
  hasMusic: boolean;
  warnings: string[];
}

const JUNK = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

/** Files picked through an <input type="file">, with or without webkitdirectory. */
export function sourcesFromFileList(files: FileList | File[]): SourceFile[] {
  return Array.from(files, (file) => ({ path: (file.webkitRelativePath || file.name).replace(/\\/g, '/'), file }));
}

/** Files and folders dropped onto the page. Must be called from the drop event. */
export async function sourcesFromDrop(transfer: DataTransfer): Promise<SourceFile[]> {
  // Entries have to be taken out of the event synchronously.
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
    } else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }

  const out: SourceFile[] = loose.map((file) => ({ path: file.name, file }));
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ path, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      // readEntries hands out the directory in batches until it returns none.
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, path);
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}

async function readBytes(file: File, start: number, length: number): Promise<DataView> {
  return new DataView(await file.slice(start, start + length).arrayBuffer());
}

/**
 * Tells the two archive formats apart.
 * DAT2 (Fallout 2) ends with its own size; DAT1 (Fallout 1) starts with a
 * small big-endian directory count followed by fixed header words.
 */
export async function detectDatFormat(file: File): Promise<DatFormat | null> {
  if (file.size < 16) return null;
  const tail = await readBytes(file, file.size - 8, 8);
  if (tail.getUint32(4, true) === file.size) {
    const treeSize = tail.getUint32(0, true);
    if (treeSize > 0 && treeSize < file.size) return 'dat2';
  }
  const head = await readBytes(file, 0, 16);
  const dirCount = head.getUint32(0, false);
  if (dirCount > 0 && dirCount < 0x10000 && head.getUint32(8, false) === 0) return 'dat1';
  return null;
}

function wanted(key: string, game: GameId): boolean {
  const parts = key.split('/');
  const name = parts[parts.length - 1] ?? '';
  if (JUNK.has(name)) return false;
  if (parts.length === 1) {
    // Game archives, plus the settings file as a reference.
    return name.endsWith('.dat') || name === GAMES[game].configFile;
  }
  const top = parts[0];
  if (top !== 'data' && top !== 'sound' && top !== 'mods') return false;
  // State of whatever game was last played in the install; the engine
  // rebuilds it and stale copies only cause trouble.
  if (/^data\/maps\/[^/]+\.sav$/.test(key)) return false;
  if (key.startsWith('data/proto/')) return false;
  return true;
}

function isSave(key: string): boolean {
  return /^data\/savegame\/slot\d+\//.test(key);
}

/**
 * Works out what to import. Throws ImportError with a message meant for the
 * user when the selection is not a usable game folder.
 */
export async function planImport(sources: SourceFile[], preferred?: GameId): Promise<ImportPlan> {
  if (!sources.length) throw new ImportError('Nothing was selected.');

  // The game folder is wherever master.dat is.
  const masters = sources.filter((s) => basename(pathKey(s.path)) === 'master.dat');
  if (!masters.length) {
    throw new ImportError(
      'No MASTER.DAT in that selection. Pick the folder the game was installed to: the one that contains MASTER.DAT and CRITTER.DAT.',
    );
  }

  const candidates: { root: string; format: DatFormat; depth: number }[] = [];
  for (const master of masters) {
    const format = await detectDatFormat(master.file);
    if (format) candidates.push({ root: dirname(master.path), format, depth: master.path.split('/').length });
  }
  if (!candidates.length) {
    throw new ImportError('MASTER.DAT was found but is not a Fallout or Fallout 2 archive. The file may be damaged.');
  }
  candidates.sort((a, b) => {
    const prefA = preferred && gameForDatFormat(a.format) === preferred ? 0 : 1;
    const prefB = preferred && gameForDatFormat(b.format) === preferred ? 0 : 1;
    return prefA - prefB || a.depth - b.depth;
  });
  const chosen = candidates[0]!;
  const game = gameForDatFormat(chosen.format);
  const def = GAMES[game];
  const rootPrefix = chosen.root ? `${chosen.root}/` : '';

  const entries: ImportEntry[] = [];
  const saves: SourceFile[] = [];
  const dirs = new Set<string>();
  const seen = new Set<string>();
  let skipped = 0;
  let totalBytes = 0;
  let installConfig: string | undefined;
  let hasMusic = false;

  for (const source of sources) {
    if (rootPrefix && !source.path.startsWith(rootPrefix)) {
      skipped++;
      continue;
    }
    const path = source.path.slice(rootPrefix.length);
    const key = pathKey(path);
    if (!key || !wanted(key, game) || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    for (let dir = dirname(path); dir; dir = dirname(dir)) dirs.add(dir);

    if (key === def.configFile) {
      installConfig = await source.file.text();
      continue;
    }
    if (isSave(key)) {
      saves.push({ path, file: source.file });
      continue;
    }
    if (key.endsWith('.acm') && def.musicDirs.some((dir) => key.startsWith(`${dir}/`))) hasMusic = true;
    entries.push({ path, file: source.file });
    totalBytes += source.file.size;
  }

  const missing = def.requiredFiles.filter((required) => !seen.has(required));
  if (missing.length) {
    throw new ImportError(
      `This looks like ${def.title}, but ${missing.map((m) => m.toUpperCase()).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing from the folder.`,
    );
  }

  const warnings: string[] = [];
  if (!hasMusic) warnings.push('No music files were found. The game will run without background music.');
  let language: string | undefined;
  if (installConfig) language = Ini.parse(installConfig).get('system', 'language');

  // Largest first is slightly friendlier to the progress bar.
  entries.sort((a, b) => b.file.size - a.file.size);

  return {
    game,
    datFormat: chosen.format,
    root: chosen.root,
    entries,
    dirs: [...dirs].sort(),
    totalBytes,
    skipped,
    saves,
    installConfig,
    language,
    hasMusic,
    warnings,
  };
}

/** Copies the planned files into browser storage. */
export async function runImport(plan: ImportPlan, onProgress?: (p: ImportProgress) => void): Promise<Manifest> {
  const manifest = await writeInstall(
    plan.game,
    plan.entries,
    (install, files) => ({
      version: MANIFEST_VERSION,
      game: plan.game,
      install,
      importedAt: Date.now(),
      totalBytes: plan.totalBytes,
      datFormat: plan.datFormat,
      files,
      dirs: plan.dirs,
      installConfig: plan.installConfig,
    }),
    onProgress,
  );

  // Saved games that came with the install become ordinary saves here, unless
  // this browser already holds saves for the game.
  if (plan.saves.length && (await countOverlay(plan.game, 'data/savegame/')) === 0) {
    const puts = await Promise.all(
      plan.saves.map(async ({ path, file }) => ({
        key: pathKey(path),
        path,
        mtime: file.lastModified || Date.now(),
        data: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    await commitOverlay(plan.game, { puts, deletes: [] });
  }
  return manifest;
}
