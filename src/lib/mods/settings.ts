/**
 * The settings of add-ons and mods: the .ini files their scripts read (with
 * sfall's get_ini_setting), shown as switches and values the player changes
 * on the add-on's or the mod's page, as on a desktop they would edit the file.
 *
 * What the player changed is kept here, by add-on or mod and by file, apart
 * from the files themselves: an add-on loaded again keeps it. When a game
 * starts, each changed file is written whole, the changes made in it and its
 * comments kept, under overseer/settings/ by its path in the game folder,
 * where the engine reads it in place of the file as it came (Fallout 2's
 * engine, patches 0019). That works for a file inside an archive too: a mod's
 * folder in mods/ is packed into one here (Inventory Filter's settings are in
 * mods/InventoryFilter.dat/).
 */
import { readDatEntry, indexDat, type DatArchive } from '../dat';
import { HIGHLIGHTING_FILE } from '../engine/config';
import { pathKey } from '../storage/manifest';
import type { Mounted } from '../storage/mount';
import { openInstalled, type Install, type SourceBlob } from '../storage/opfs';

/** Where the engine reads the player's copy of a settings file, by the file's path in the game folder. */
export const COPIES = 'overseer/settings';

/** A settings file of an add-on or mod. */
export interface SettingsFile {
  /** Where the scripts find it, below the game folder, as spelled: mods/InventoryFilter.dat/InvenFilter.ini. */
  path: string;
  /** The archive in mods/ it is inside, where it is in one, as spelled. */
  archive?: string;
}

/** A setting of a settings file, as the file has it. */
export interface Setting {
  section: string;
  key: string;
  value: string;
  /** What the file says of it: the comment lines above it, as one text. */
  about: string;
}

/** What the player changed of one file: values by settingId. */
export type Changes = Record<string, string>;

export const settingId = (section: string, key: string): string => `${section.toLowerCase()}\n${key.toLowerCase()}`;

/** The settings files the console leaves alone: sfall's own, the high resolution patch's, the load order, and what it writes itself. */
const NOT_SETTINGS = new Set(['ddraw.ini', 'f2_res.ini', 'f1_res.ini', 'mods/mods_order.ini', pathKey(HIGHLIGHTING_FILE)]);
/** Archives in mods/ larger than this are a mod's data, not a folder of its own with settings in it. */
const SMALL_ARCHIVE = 16 << 20;
/** Settings files larger than this are not settings. */
const SMALL_FILE = 256 << 10;

const LINE = /^([ \t]*)([^;#=\s[][^=]*?)([ \t]*=[ \t]*)(.*?)([ \t]*)$/;

/** Text out of a settings file's bytes, one character a byte, as the games read them. */
export function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return text;
}

/** A settings file's bytes out of its text, one byte a character. */
export function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at) & 0xff;
  return bytes;
}

/** A value and what follows it on its line: sfall reads the value up to a comment that is set off by a space. */
function splitValue(rest: string): { value: string; tail: string } {
  const comment = rest.search(/\s;/);
  return comment < 0 ? { value: rest, tail: '' } : { value: rest.slice(0, comment).trimEnd(), tail: rest.slice(rest.slice(0, comment).trimEnd().length) };
}

/** The settings of a file, in its order, with what its comments say of each. The first of a setting given twice. */
export function readSettings(text: string): Setting[] {
  const settings: Setting[] = [];
  const seen = new Set<string>();
  let section = '';
  let about: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      about = [];
      continue;
    }
    if (line.startsWith(';') || line.startsWith('#')) {
      const words = line.replace(/^[;#]+\s*/, '');
      // A setting left in a comment (;Key=1) says nothing of the next one.
      if (/^[A-Za-z_][\w ]*=/.test(words)) about = [];
      else if (words) about.push(words);
      continue;
    }
    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      if (end > 0) section = line.slice(1, end).trim();
      about = [];
      continue;
    }
    const match = LINE.exec(raw);
    if (!match) continue;
    const key = match[2]!.trim();
    const id = settingId(section, key);
    if (!seen.has(id)) {
      seen.add(id);
      settings.push({ section, key, value: splitValue(match[4]!).value, about: about.join(' ') });
    }
    about = [];
  }
  return settings;
}

/** The file with the player's changes made in it, each on its own line, everything else as it was. */
export function withChanges(text: string, changes: Changes): string {
  if (!Object.keys(changes).length) return text;
  let section = '';
  const done = new Set<string>();
  const lines = text.split(/(?<=\n)/).map((raw) => {
    const line = raw.trim();
    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      if (end > 0) section = line.slice(1, end).trim();
      return raw;
    }
    if (!line || line.startsWith(';') || line.startsWith('#')) return raw;
    const ending = /\r?\n$/.exec(raw)?.[0] ?? '';
    const match = LINE.exec(raw.slice(0, raw.length - ending.length));
    if (!match) return raw;
    const id = settingId(section, match[2]!.trim());
    if (!(id in changes) || done.has(id)) return raw;
    done.add(id);
    const { tail } = splitValue(match[4]!);
    return `${match[1]}${match[2]}${match[3]}${changes[id]}${tail}${match[5]}${ending}`;
  });
  return lines.join('');
}

// --- What the player changed, by add-on or mod ----------------------------------------------------------------

interface Stored {
  [owner: string]: { [file: string]: { path: string; changes: Changes } };
}

const STORE_KEY = 'overseer-console:settings-files';

function readStore(): Stored {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as unknown;
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Stored) : {};
  } catch {
    return {};
  }
}

let store: Stored = readStore();

function writeStore(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // A private window: the changes last as long as the page.
  }
}

/** What the player changed of an add-on's or mod's settings files, by the file's lower-cased path. */
export function changedSettings(owner: string): Map<string, { path: string; changes: Changes }> {
  return new Map(Object.entries(store[owner] ?? {}));
}

/** The player's changes to one file of an add-on or mod. */
export function changesOf(owner: string, path: string): Changes {
  return { ...(store[owner]?.[pathKey(path)]?.changes ?? {}) };
}

/** Changes a setting, or puts it back as the file has it (`value` the same as `original`). */
export function changeSetting(owner: string, path: string, setting: Setting, value: string): void {
  const files = { ...(store[owner] ?? {}) };
  const key = pathKey(path);
  const changes = { ...(files[key]?.changes ?? {}) };
  const id = settingId(setting.section, setting.key);
  if (value === setting.value) delete changes[id];
  else changes[id] = value;
  if (Object.keys(changes).length) files[key] = { path, changes };
  else delete files[key];
  store = { ...store, [owner]: files };
  if (!Object.keys(files).length) delete store[owner];
  writeStore();
}

/** Puts one file of an add-on or mod back as it came, or all of them. */
export function forgetSettings(owner: string, path?: string): void {
  if (path === undefined) {
    const { [owner]: _, ...rest } = store;
    store = rest;
  } else {
    const files = { ...(store[owner] ?? {}) };
    delete files[pathKey(path)];
    store = { ...store, [owner]: files };
    if (!Object.keys(files).length) delete store[owner];
  }
  writeStore();
}

// --- The files themselves -------------------------------------------------------------------------------------

/** Whether a file of a game folder is a settings file the player may change. */
function isSettingsPath(path: string): boolean {
  const key = pathKey(path);
  return key.endsWith('.ini') && !NOT_SETTINGS.has(key);
}

/** The archives at the top of mods/ small enough to be a folder of settings and scripts. */
function smallArchives(files: { path: string; size: number }[]): { path: string; size: number }[] {
  return files.filter((file) => /^mods\/[^/]+\.dat$/.test(pathKey(file.path)) && file.size <= SMALL_ARCHIVE);
}

/** Opens a file of an install by its path, or null. */
export type Opener = (path: string) => Promise<SourceBlob | null>;

/** Opens the files of an install. */
export const installOpener =
  (install: Install): Opener =>
  (path) =>
    openInstalled(install, path);

/** The settings files an install brings (`files`, opened with `open`): loose, and inside its archives in mods/. */
export async function settingsFilesOf(files: { path: string; size: number }[], open: Opener): Promise<SettingsFile[]> {
  const found: SettingsFile[] = files.filter((file) => isSettingsPath(file.path) && file.size <= SMALL_FILE).map((file) => ({ path: file.path }));
  for (const archive of smallArchives(files)) {
    const blob = await open(archive.path).catch(() => null);
    if (!blob) continue;
    const index = await indexDat(blob as DatArchive, 'dat2').catch(() => null);
    for (const [name, entry] of index ?? []) {
      if (name.endsWith('.ini') && entry.size <= SMALL_FILE) found.push({ path: `${archive.path}/${entry.name.replace(/\\/g, '/')}`, archive: archive.path });
    }
  }
  return found.sort((a, b) => pathKey(a.path).localeCompare(pathKey(b.path)));
}

/** A settings file's text, out of the install that holds it (inside its archive, where it is in one). */
export async function readSettingsFile(file: SettingsFile, open: Opener): Promise<string | null> {
  if (!file.archive) {
    const blob = await open(file.path);
    return blob ? latin1(new Uint8Array(await blob.arrayBuffer())) : null;
  }
  return readInArchive(await open(file.archive), file.path.slice(file.archive.length + 1));
}

async function readInArchive(archive: SourceBlob | null, name: string): Promise<string | null> {
  if (!archive) return null;
  const index = await indexDat(archive as DatArchive, 'dat2').catch(() => null);
  const entry = index?.get(pathKey(name));
  return entry ? latin1(await readDatEntry(archive as DatArchive, 'dat2', entry)) : null;
}

/**
 * The copies of the settings files the player changed, for a game about to
 * start: by their place under overseer/settings/. A file counts as the one
 * whose add-on or mod laid it over the others (`mounted`), with the changes
 * made to that one; a file no longer there is passed over.
 */
export async function settingsCopies(game: string, mounted: Mounted, open: Opener): Promise<Record<string, Uint8Array>> {
  const copies: Record<string, Uint8Array> = {};
  for (const owner of [game, ...mounted.addons.map((addon) => addon.record.id)]) {
    for (const { path, changes } of changedSettings(owner).values()) {
      const key = pathKey(path);
      const archive = /^(mods\/[^/]+\.dat)\/(.+)$/.exec(key);
      const holder = mounted.files.get(archive ? archive[1]! : key);
      // Whose the file is, as laid: the add-on's, or the game's or mod's own.
      const whose = holder?.from === 'addon' ? holder.addon : holder?.from === 'own' ? game : undefined;
      if (whose !== owner) continue;
      const text = archive ? await readInArchive(await open(archive[1]!), archive[2]!) : await open(key).then(async (blob) => (blob ? latin1(new Uint8Array(await blob.arrayBuffer())) : null));
      if (text === null) continue;
      copies[`${COPIES}/${path}`] = latin1Bytes(withChanges(text, changes));
    }
  }
  return copies;
}
