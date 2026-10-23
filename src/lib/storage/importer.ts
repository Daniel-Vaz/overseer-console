/**
 * Turns "a folder the user pointed at" into an installed game.
 *
 * The folder is whatever a store installed: executables, manuals and patch
 * tools next to the data that matters. Importing finds the game inside it,
 * keeps what the engine reads and leaves the rest.
 */
import { registerAddon } from '../addons';
import { GAMES, gameDef, gameForDatFormat, isBaseGame, registerMod, type BaseGameId, type DatFormat, type GameId } from '../games';
import { Ini } from '../ini';
import { KNOWN_MODS, isKnownMod } from '../mods/catalog';
import { ZipError, looksLikeZip, readZip } from '../zip';
import { isAddonShaped, planAddon } from './addons';
import { findEttu, planEttu } from './ettu';
import { findMod, installerOf, isInstaller, isOtherArchive, planFoundMod } from './mods';
import { MANIFEST_VERSION, basename, dirname, pathKey, type Manifest } from './manifest';
import { writeInstall, type ImportProgress, type SourceBlob } from './opfs';
import { clearOverlay, commitOverlay, countOverlay } from './overlay';
import { ImportError, isJunk, isLeftoverState, isSave, type ImportContext, type ImportPlan, type SourceFile } from './plan';

export { ImportError, type ImportContext, type ImportPlan, type SourceFile } from './plan';

/** Files picked through an <input type="file">, with or without webkitdirectory. */
export function sourcesFromFileList(files: FileList | File[]): SourceFile[] {
  return Array.from(files, (file) => ({ path: (file.webkitRelativePath || file.name).replace(/\\/g, '/'), file }));
}

/**
 * Looks inside zip archives: each is replaced by the files it holds, as if
 * its contents had been picked instead. By default that is done for the zips
 * that were picked or dropped as such, not for ones that happen to lie in a
 * picked folder, and a file that turns out not to be a zip is an error.
 * `anywhere` opens every zip, and passes over those it cannot read.
 */
export async function openArchives(sources: SourceFile[], anywhere = false): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const source of sources) {
    if (!looksLikeZip(source.path) || (!anywhere && source.path.includes('/'))) {
      out.push(source);
      continue;
    }
    try {
      const inside = dirname(source.path);
      const zip = basename(source.path);
      for (const { path, file } of await readZip(source.file)) out.push({ path: inside ? `${inside}/${path}` : path, file, zip });
    } catch (err) {
      if (!(err instanceof ZipError)) throw err;
      if (!anywhere) throw new ImportError(`${basename(source.path)}: ${err.message}`);
      out.push(source);
    }
  }
  return out;
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

async function readBytes(file: SourceBlob, start: number, length: number): Promise<DataView> {
  return new DataView(await file.slice(start, start + length).arrayBuffer());
}

/**
 * Tells the two archive formats apart.
 * DAT2 (Fallout 2) ends with its own size; DAT1 (Fallout 1) starts with a
 * small big-endian directory count followed by fixed header words.
 */
export async function detectDatFormat(file: SourceBlob): Promise<DatFormat | null> {
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

function wanted(key: string, game: BaseGameId): boolean {
  const parts = key.split('/');
  const name = parts[parts.length - 1] ?? '';
  if (isJunk(name)) return false;
  if (parts.length === 1) {
    // Game archives, plus the settings file as a reference.
    return name.endsWith('.dat') || name === gameDef(game).configFile;
  }
  const top = parts[0];
  if (top !== 'data' && top !== 'sound' && top !== 'mods') return false;
  return !isLeftoverState(key, game);
}

export interface Survey {
  /** Folders holding a MASTER.DAT that is one, with the game it belongs to. */
  candidates: { root: string; format: DatFormat; depth: number }[];
  /** How many files are called MASTER.DAT, archives or not. */
  masters: number;
  /** The games sold as such that the selection holds. */
  stock: BaseGameId[];
  /** Where a copy of Fallout Et Tu lies (see findEttu), or null. */
  conversion: string | null;
}

/**
 * Looks at what a selection holds without deciding anything. A conversion is
 * wherever its mods are; a game folder is wherever MASTER.DAT is.
 */
export async function surveySources(sources: SourceFile[]): Promise<Survey> {
  const masters = sources.filter((s) => basename(pathKey(s.path)) === 'master.dat');
  const candidates: Survey['candidates'] = [];
  for (const master of masters) {
    const format = await detectDatFormat(master.file);
    if (format) candidates.push({ root: dirname(master.path), format, depth: master.path.split('/').length });
  }
  return {
    candidates,
    masters: masters.length,
    stock: [...new Set(candidates.map((candidate) => gameForDatFormat(candidate.format)))],
    conversion: findEttu(sources),
  };
}

/** Whether what is asked for is a mod: any mod ('mod'), or one already loaded here by its id. */
export function wantsMod(preferred: GameId | 'mod' | undefined): boolean {
  return preferred !== undefined && !isBaseGame(preferred);
}

/**
 * Works out how to store a mod found in a selection. `target` is the mod
 * whose files are being replaced, if any.
 */
async function planMod(sources: SourceFile[], survey: Survey, target: GameId | undefined, context: ImportContext): Promise<ImportPlan> {
  // A mod asked for by its own name may not be loaded yet.
  const known = target ? (GAMES[target]?.mod?.known ?? (isKnownMod(target) ? target : undefined)) : undefined;
  if (survey.conversion !== null) {
    if (target && known !== 'ettu') throw new ImportError(`That is Fallout Et Tu, not ${GAMES[target]?.title ?? 'the mod that was asked for'}.`);
    return { ...(await planEttu(sources, survey.conversion, context)), also: survey.stock };
  }
  if (known === 'ettu') {
    throw new ImportError('No Fallout Et Tu in that selection. Pick the zip it is downloaded as, or its folder: the one that holds the MODS folder.');
  }
  if (isInstaller(sources)) {
    const mod = installerOf(sources);
    throw new ImportError(
      `That is a Windows installer: the console cannot run it. ${mod ? `${mod.handOver}` : 'Run it on a desktop, then hand the console the game folder it installed into, as a folder or a zip.'}`,
    );
  }
  const archive = isOtherArchive(sources);
  if (archive) throw new ImportError(`${archive}: the console opens zip archives only. Unpack it and pick the folder, or make a zip of it.`);
  // Nothing but what goes in Fallout 2's mods folder: an add-on, laid over a game or mod rather than played as one.
  if (!target && !survey.candidates.length && isAddonShaped(sources)) return planAddon(sources, 'fo2');
  const found = findMod(sources, survey.candidates);
  if (!found) {
    throw new ImportError(
      'No mod the console can load was found in that selection. Pick the zip a mod is downloaded as, its folder, or a game folder it was installed in.',
    );
  }
  if (target && known && found.known && found.known !== known) {
    throw new ImportError(`That is ${GAMES[found.known]?.title ?? found.known}, not ${GAMES[target]?.title ?? target}.`);
  }
  return planFoundMod(sources, found, context, target);
}

/**
 * Works out what to import. Throws ImportError with a message meant for the
 * user when the selection is not a usable game folder.
 *
 * A selection may hold more than one game: both in one folder, or a mod
 * installed inside the game it is played on. The one asked for is taken
 * ('mod' for a mod); the others are named in the plan.
 */
export async function planImport(sources: SourceFile[], preferred?: GameId | 'mod', context: ImportContext = {}): Promise<ImportPlan> {
  if (!sources.length) throw new ImportError('Nothing was selected.');

  const survey = await surveySources(sources);
  const { candidates, masters, stock, conversion } = survey;

  if (wantsMod(preferred)) return planMod(sources, survey, preferred === 'mod' ? undefined : preferred, context);
  // Nothing asked for, and nothing but a mod picked.
  if (conversion !== null && !candidates.length) return planMod(sources, survey, undefined, context);
  // A mod the console knows by a file of its own: for the Mod library, not for a deck.
  const mod = findMod(sources, candidates);
  const known = mod?.known ? KNOWN_MODS[mod.known] : undefined;
  if (mod && known && mod.byFile) {
    if (preferred === undefined) return planMod(sources, survey, undefined, context);
    if (known.standalone || !mod.complete) {
      throw new ImportError(
        `That is ${known.title}, a mod of ${GAMES[known.base]?.title}: it is loaded in the Mod library, and played over the game in deck ${GAMES[known.base]?.deck}.`,
      );
    }
  }
  // Nothing asked for, no game in it, and what a mod unpacks into a game folder, or an add-on.
  if (!masters && preferred === undefined && (mod || isAddonShaped(sources))) return planMod(sources, survey, undefined, context);
  if (!masters) {
    throw new ImportError(
      'No MASTER.DAT in that selection. Pick the folder the game was installed to: the one that contains MASTER.DAT and CRITTER.DAT.',
    );
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
  const def = gameDef(game);
  const rootPrefix = chosen.root ? `${chosen.root}/` : '';

  const entries: SourceFile[] = [];
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
  if (known && mod?.byFile && mod.complete && mod.root === chosen.root.toLowerCase()) {
    warnings.push(
      `This folder has ${known.title} installed in it: deck ${def.deck} now holds that, not ${def.title} as it was sold. ` +
        `To keep the two apart, load the game's own folder here, and the mod in the Mod library.`,
    );
  }
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
    sourceFiles: entries.length,
    skipped,
    saves,
    installConfig,
    language,
    hasMusic,
    warnings,
    notes: [],
    also: [...stock.filter((other) => other !== game), ...(conversion === null ? [] : (['mod'] as const))],
  };
}

/** Where the engine keeps what it works out from a mod's own settings files. */
const DERIVED_SETTINGS = 'data/config/';

/**
 * Copies the planned files into browser storage. `signal` stops the copy
 * (see writeInstall): nothing of the game is changed then.
 */
export async function runImport(plan: ImportPlan, onProgress?: (p: ImportProgress) => void, signal?: AbortSignal): Promise<Manifest> {
  if (plan.addon) return runAddonImport(plan, onProgress, signal);
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
      mod: plan.mod,
    }),
    onProgress,
    signal,
  );
  // A mod is one of the games here from now on, under its own name.
  if (plan.mod) registerMod(plan.mod.record);

  // The engine of Fallout 2 writes settings it derives from the files of a
  // mod into the game's data folder, and from then on prefers its copy. That
  // copy belongs to the holodisk that was just replaced.
  await clearOverlay(plan.game, DERIVED_SETTINGS);

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

/** Copies a planned add-on into storage, beside the games: it has no saves, and no settings of its own. */
async function runAddonImport(plan: ImportPlan, onProgress?: (p: ImportProgress) => void, signal?: AbortSignal): Promise<Manifest> {
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
      addon: plan.addon,
    }),
    onProgress,
    signal,
    'addons',
  );
  registerAddon(plan.addon!.record);
  return manifest;
}
