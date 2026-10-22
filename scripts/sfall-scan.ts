// Says which of sfall's features a mod asks for that the engine it is played on lacks: the opcodes and metarules its
// scripts call, its hook scripts and the hooks it registers, and the settings of its ddraw.ini.
//
//   npm run sfall-scan -- <mod folder or zip>... [--engine fo1|fo2]
//
// Scripts are read wherever the mod keeps them: loose, in its .dat archives, in zips, and in archives in zips. The
// engine is the one whose MASTER.DAT is there (Fallout 2 when there is none) unless --engine names it.
//
// What each engine has is read from its source as patched here: the dev tree of engines/patches.sh import if there is
// one, else the tree engines/build.sh built. Fallout 2 CE's own source names every sfall opcode in its comments.
import { openAsBlob } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { indexDat, readDatEntry, type DatArchive } from '../src/lib/dat.ts';
import type { SourceBlob } from '../src/lib/storage/opfs.ts';
import { readZip } from '../src/lib/zip.ts';

type EngineId = 'fo1' | 'fo2';

const ROOT = new URL('..', import.meta.url).pathname;

// --- What an engine has --------------------------------------------------------------------------------------------

interface Engine {
  id: EngineId;
  /** Opcodes the interpreter knows, by number. */
  opcodes: Set<number>;
  /** Of those, the ones whose handler only says it cannot (memory access, Hero Appearance...). */
  stubs: Set<number>;
  /** Metarules (sfall_func0..8) it knows, by name. */
  metarules: Set<string>;
  /** Hooks it calls scripts for, by id. */
  fires: Set<number>;
  /** Whether it loads hook scripts by their file name (hs_tohit.int). */
  hookScripts: boolean;
  /** ddraw.ini keys it reads, as "section/key" lower-cased; a '*' ends a family (movie1..32). */
  settings: string[];
}

/** What sfall calls things, from Fallout 2 CE's source, which lists all of it. */
interface Names {
  opcodes: Map<number, string>;
  metarules: Set<string>;
  /** Hook ids by name (TOHIT), commented out or not. */
  hooks: Map<string, number>;
}

async function sourceTree(id: EngineId): Promise<string> {
  for (const dir of [`${ROOT}.cache/engines/${id}-dev`, `${ROOT}.cache/engines/${id}/src`]) {
    if (await stat(join(dir, 'src')).catch(() => null)) return join(dir, 'src');
  }
  throw new Error(`No source of the ${id} engine: run engines/patches.sh ${id} import, or engines/build.sh ${id}.`);
}

async function sourceFiles(dir: string, pattern: RegExp): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true })) {
    if (pattern.test(entry)) files.set(entry, await readFile(join(dir, entry), 'latin1'));
  }
  return files;
}

/** The body of a C++ function by name, to its first closing brace at the start of a line. */
function bodyOf(code: string, name: string): string {
  const at = code.search(new RegExp(`\\n(?:template[^\\n]*\\n)?static [\\w:<>*& ]+\\b${name}\\(`));
  if (at < 0) return '';
  const end = code.indexOf('\n}\n', at);
  return code.slice(at, end < 0 ? undefined : end);
}

const STUB = /warnMemoryAccess|not implemented|unavailable/i;

async function readNames(): Promise<Names> {
  const tree = await sourceTree('fo2');
  const opcodes = new Map<number, string>();
  const code = await readFile(join(tree, 'sfall_opcodes.cc'), 'latin1');
  for (const match of code.matchAll(/0x(8[0-9a-f]{3}) - [^\n(]*?\b(\w+)\(/gi)) opcodes.set(parseInt(match[1]!, 16), match[2]!);
  const header = await readFile(join(tree, 'scan_unimplemented_sfall.h'), 'latin1');
  const list = /sfall_metarules\[\] = \{([^}]*)\}/.exec(header)?.[1] ?? '';
  const metarules = new Set([...list.matchAll(/"(\w+)"/g)].map((match) => match[1]!));
  const hooks = new Map<string, number>();
  const hookHeader = await readFile(join(tree, 'sfall_script_hooks.h'), 'latin1');
  for (const match of hookHeader.matchAll(/HOOK_(\w+) = (\d+)/g)) hooks.set(match[1]!, Number(match[2]));
  return { opcodes, metarules, hooks };
}

async function readEngine(id: EngineId): Promise<Engine> {
  const tree = await sourceTree(id);
  const files = await sourceFiles(tree, /\.(cc|h)$/);
  const all = [...files.values()].join('\n');
  const opcodes = new Set<number>();
  const stubs = new Set<number>();
  const register = (opcode: number, handler: string) => {
    opcodes.add(opcode);
    const name = handler.replace(/<.*>$/, '');
    if (STUB.test(bodyOf(all, name))) stubs.add(opcode);
  };
  for (const match of all.matchAll(/(?:interpreterRegisterOpcode|interpretAddFunc)\(0x([0-9a-f]{4}), *([\w<>:]+)\)/gi)) {
    register(parseInt(match[1]!, 16), match[2]!);
  }
  // A range of opcodes given one handler.
  const loop = /for \(int (\w+) = 0x([0-9a-f]+); \1 <= 0x([0-9a-f]+); \1\+\+\) \{\s*interpreterRegisterOpcode\(\1, *([\w<>:]+)\)/gi;
  for (const match of all.matchAll(loop)) {
    for (let opcode = parseInt(match[2]!, 16); opcode <= parseInt(match[3]!, 16); opcode++) register(opcode, match[4]!);
  }
  const metarules = new Set<string>();
  for (const match of all.matchAll(/\{ "(\w+)", (\w+),/g)) {
    if (!STUB.test(bodyOf(all, match[2]!))) metarules.add(match[1]!);
  }
  // A hook is fired where the engine makes a call of it; its id is in the header, where the ones it lacks are commented out.
  const fires = new Set<number>();
  const hookHeader = files.get('sfall_script_hooks.h') ?? '';
  // (Not the table of hook scripts' names, which lists every hook.)
  const code = [...files]
    .filter(([name]) => name.endsWith('.cc'))
    .map(([, text]) => text.replace(/\{ HOOK_\w+, "hs_\w+" \},?/g, ''))
    .join('\n');
  for (const match of hookHeader.matchAll(/^\s*HOOK_(\w+) = (\d+)/gm)) {
    if (new RegExp(`\\bHOOK_${match[1]}\\b`).test(code)) fires.add(Number(match[2]));
  }
  const settings: string[] = [];
  const defines = new Map([...(files.get('sfall_config.h') ?? '').matchAll(/#define (SFALL_CONFIG_\w+) "(\w+)"/g)].map((m) => [m[1]!, m[2]!]));
  for (const match of all.matchAll(/gSfallConfig, *(\w+|"\w+"), *(\w+|"\w+")/g)) {
    const [section, key] = [match[1]!, match[2]!].map((part) => defines.get(part) ?? part.replace(/"/g, ''));
    settings.push(`${section}/${key}`.toLowerCase());
  }
  // What Fallout 2 CE moves from ddraw.ini into game.cfg the first time it starts a game.
  const migration = files.get('game_config_migration.cc') ?? '';
  const sections = new Map([...migration.matchAll(/(kSfall\w+)\[\] = "(\w+)"/g)].map((m) => [m[1]!, m[2]!]));
  for (const match of migration.matchAll(/\{ (kSfall\w+), "(\w+)",/g)) settings.push(`${sections.get(match[1]!)}/${match[2]}`.toLowerCase());
  for (const match of migration.matchAll(/kSfall(\w+), "([A-Z]\w+)"/g)) settings.push(`${match[1]}/${match[2]}`.toLowerCase());
  for (const match of migration.matchAll(/migrateStartInt\("(\w+)"/g)) settings.push(`misc/${match[1]}`.toLowerCase());
  if (/"Movie%d"/.test(migration)) settings.push('misc/movie*');
  return { id, opcodes, stubs, metarules, fires, hookScripts: /"hs_/.test(all), settings };
}

// --- What a mod asks for ------------------------------------------------------------------------------------------

/** What one compiled script calls. */
interface ScriptUse {
  opcodes: Set<number>;
  /** Its strings, among which the names of the metarules it calls. */
  strings: Set<string>;
  /** Hooks it registers (register_hook, register_hook_proc[_spec]) by a constant id. */
  hooks: Set<number>;
}

const PUSH = new Set([0xc001, 0xa001, 0x9001]);
const REGISTER_HOOK = 0x8207;
const REGISTER_HOOK_PROC = new Set([0x8262, 0x827d]);

/**
 * Reads a compiled script (.int): after a 42-byte start, its procedure table (24 bytes each, the body's offset at 16),
 * names and strings, then its code: two-byte opcodes, those that push a value followed by four bytes of it.
 */
function readScript(data: Uint8Array): ScriptUse | null {
  if (data.length < 46) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(42);
  if (46 + count * 24 > data.length) return null;
  let start = data.length;
  for (let i = 0; i < count; i++) {
    const body = view.getUint32(46 + i * 24 + 16);
    if (body > 0) start = Math.min(start, body);
  }
  const strings = new Set<string>();
  for (const text of new TextDecoder('latin1').decode(data.subarray(46 + count * 24, start)).split('\0')) {
    if (/^\w+$/.test(text)) strings.add(text.toLowerCase());
  }
  const opcodes = new Set<number>();
  const hooks = new Set<number>();
  const pushed: number[] = [];
  let at = start;
  while (at + 2 <= data.length) {
    const opcode = view.getUint16(at);
    at += 2;
    if (opcode < 0x8000) return null;
    if (PUSH.has(opcode)) {
      if (at + 4 > data.length) return null;
      pushed.push(opcode === 0xc001 ? view.getInt32(at) : NaN);
      at += 4;
      continue;
    }
    if (opcode === REGISTER_HOOK && pushed.length >= 1) hooks.add(pushed[pushed.length - 1]!);
    if (REGISTER_HOOK_PROC.has(opcode) && pushed.length >= 2) hooks.add(pushed[pushed.length - 2]!);
    pushed.length = 0;
    opcodes.add(opcode);
  }
  hooks.delete(NaN);
  return { opcodes, strings, hooks };
}

interface Mod {
  name: string;
  /** Scripts by lower-cased file name: what every copy of it calls. */
  scripts: Map<string, ScriptUse>;
  /** Global scripts (gl*.int) kept elsewhere than scripts/, where the engines look for them. */
  strayGlobals: Set<string>;
  unreadable: Set<string>;
  /** ddraw.ini files by where they are. */
  settings: Map<string, string>;
  /** A MASTER.DAT says which game this is played on. */
  base?: EngineId;
}

function fileSource(blob: Blob): SourceBlob {
  return {
    size: blob.size,
    lastModified: 0,
    slice: (start, end) => blob.slice(start, end),
    arrayBuffer: () => blob.arrayBuffer(),
    text: () => blob.text(),
  };
}

/** Fallout 2's archives end with their own size; Fallout 1's do not. */
async function datFormat(archive: DatArchive): Promise<'dat1' | 'dat2'> {
  const tail = new DataView(await archive.slice(archive.size - 4, archive.size).arrayBuffer());
  return tail.getUint32(0, true) === archive.size ? 'dat2' : 'dat1';
}

function addScript(mod: Mod, path: string, data: Uint8Array) {
  const name = basename(path.replace(/\\/g, '/')).toLowerCase();
  if (name.startsWith('gl') && !/(^|\/)scripts\/gl[^/]*$/i.test(path.replace(/\\/g, '/'))) mod.strayGlobals.add(path);
  const use = readScript(data);
  if (!use) {
    mod.unreadable.add(name);
    return;
  }
  const known = mod.scripts.get(name);
  if (!known) return void mod.scripts.set(name, use);
  for (const opcode of use.opcodes) known.opcodes.add(opcode);
  for (const text of use.strings) known.strings.add(text);
  for (const hook of use.hooks) known.hooks.add(hook);
}

async function readArchive(mod: Mod, path: string, archive: DatArchive) {
  const format = await datFormat(archive);
  if (/(^|\/)master\.dat$/i.test(path)) mod.base ??= format === 'dat1' ? 'fo1' : 'fo2';
  const entries = [...(await indexDat(archive, format)).values()].filter((entry) => entry.name.endsWith('.int'));
  // In the order they lie, so that one packed in a zip is read through once.
  entries.sort((a, b) => a.offset - b.offset);
  for (const entry of entries) addScript(mod, entry.name, await readDatEntry(archive, format, entry));
}

async function readFileOf(mod: Mod, path: string, file: SourceBlob) {
  const lower = path.toLowerCase();
  // What macOS adds to a zip made on it.
  if (lower.includes('__macosx/')) return;
  if (lower.endsWith('.int')) addScript(mod, path, new Uint8Array(await file.arrayBuffer()));
  else if (lower.endsWith('.dat') && file.size > 16) {
    await readArchive(mod, path, file).catch((err: unknown) => console.warn(`  ${path}: not read (${String(err)})`));
  } else if (lower.endsWith('.zip')) {
    const entries = await readZip(file).catch((err: unknown) => void console.warn(`  ${path}: not read (${String(err)})`));
    for (const entry of entries ?? []) await readFileOf(mod, `${path}/${entry.path}`, entry.file);
  } else if (basename(lower) === 'ddraw.ini') mod.settings.set(path, await file.text());
}

async function readMod(path: string): Promise<Mod> {
  const mod: Mod = { name: basename(path), scripts: new Map(), strayGlobals: new Set(), unreadable: new Set(), settings: new Map() };
  if ((await stat(path)).isDirectory()) {
    for (const entry of (await readdir(path, { recursive: true })).sort()) {
      const full = join(path, entry);
      if (/\.(int|dat|zip)$|(^|\/)ddraw\.ini$/i.test(entry) && (await stat(full)).isFile()) {
        await readFileOf(mod, entry, fileSource(await openAsBlob(full)));
      }
    }
  } else await readFileOf(mod, basename(path), fileSource(await openAsBlob(path)));
  return mod;
}

// --- The report ---------------------------------------------------------------------------------------------------

/** Hook scripts sfall does not name after their hook. */
const HOOK_FILES: Record<string, string> = { 'hs_subcombatdmg.int': 'SUBCOMBATDAMAGE' };

/** The first opcode an engine's scripts may call beyond the interpreter's own. */
const FIRST_GAME_OPCODE = 0x80a1;

function some(names: string[]): string {
  const shown = names.sort().slice(0, 4).join(', ');
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

function readSettings(text: string): { section: string; key: string; value: string }[] {
  const out: { section: string; key: string; value: string }[] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s;.*$/, '').trim();
    if (!line || line.startsWith(';')) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) section = head[1]!.trim();
    else if (line.includes('=')) {
      const at = line.indexOf('=');
      out.push({ section, key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
    }
  }
  return out;
}

function report(mod: Mod, engine: Engine, names: Names) {
  const hookName = new Map([...names.hooks].map(([name, id]) => [id, name]));
  // (Mods made for another build of sfall call things sfall itself does not have.)
  const opcodeName = (opcode: number) => `${names.opcodes.get(opcode) ?? 'not in sfall'} (0x${opcode.toString(16)})`;
  console.log(`\n== ${mod.name}: ${mod.scripts.size} scripts, played on the ${engine.id} engine`);
  if (mod.unreadable.size) console.log(`  not readable as scripts: ${some([...mod.unreadable])}`);

  const lacking = new Map<string, string[]>();
  const stubbed = new Map<string, string[]>();
  const metarules = new Map<string, string[]>();
  const hooks = new Map<string, string[]>();
  const add = (into: Map<string, string[]>, key: string, script: string) => into.set(key, [...(into.get(key) ?? []), script]);
  for (const [script, use] of mod.scripts) {
    for (const opcode of use.opcodes) {
      if (opcode < FIRST_GAME_OPCODE) continue;
      if (!engine.opcodes.has(opcode)) add(lacking, opcodeName(opcode), script);
      else if (engine.stubs.has(opcode)) add(stubbed, opcodeName(opcode), script);
    }
    for (const text of use.strings) {
      if (names.metarules.has(text) && !engine.metarules.has(text)) add(metarules, text, script);
    }
    for (const hook of use.hooks) {
      if (!engine.fires.has(hook)) add(hooks, `${hookName.get(hook) ?? 'not in sfall'} (${hook})`, script);
    }
  }
  const list = (title: string, found: Map<string, string[]>) => {
    if (!found.size) return;
    console.log(`  ${title}:`);
    for (const [what, scripts] of [...found].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${what} in ${scripts.length} script${scripts.length > 1 ? 's' : ''}: ${some(scripts)}`);
    }
  };
  list('opcodes the engine lacks', lacking);
  list('opcodes the engine takes and does nothing with', stubbed);
  list('metarules the engine lacks', metarules);
  list('hooks registered that the engine never calls', hooks);

  const hookScripts = [...mod.scripts.keys()].filter((script) => /^hs_\w+\.int$/.test(script));
  if (hookScripts.length) {
    const named = hookScripts.map((script) => {
      const id = names.hooks.get(HOOK_FILES[script] ?? script.slice(3, -4).toUpperCase());
      const fired = id !== undefined && engine.fires.has(id);
      return `${script}${id === undefined ? ' (no such hook)' : fired ? '' : ' (hook never called)'}`;
    });
    console.log(`  hook scripts${engine.hookScripts ? '' : ', which the engine never loads'}: ${named.sort().join(', ')}`);
  }

  if (mod.strayGlobals.size) console.log(`  global scripts outside scripts/ (the engine runs scripts/gl*.int only): ${some([...mod.strayGlobals])}`);

  // The game reads the ddraw.ini beside its program: the outermost one (the others are copies, or another engine's).
  const depth = (path: string) => path.split('/').length;
  const outermost = Math.min(...[...mod.settings.keys()].map(depth));
  for (const [path, text] of mod.settings) {
    if (depth(path) > outermost) continue;
    const ignored = readSettings(text).filter(({ section, key, value }) => {
      if (value === '' || value === '0') return false;
      const id = `${section}/${key}`.toLowerCase();
      return !engine.settings.some((setting) => (setting.endsWith('*') ? id.startsWith(setting.slice(0, -1)) : setting === id));
    });
    if (!ignored.length) continue;
    console.log(`  ${path}: settings the engine does not read`);
    const bySection = new Map<string, string[]>();
    for (const { section, key, value } of ignored) {
      bySection.set(section, [...(bySection.get(section) ?? []), `${key}=${value.length > 16 ? `${value.slice(0, 12)}...` : value}`]);
    }
    for (const [section, keys] of bySection) console.log(`    [${section}] ${keys.join(' ')}`);
  }
}

const args = process.argv.slice(2);
const forced = args.includes('--engine') ? (args[args.indexOf('--engine') + 1] as EngineId) : undefined;
const paths = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--engine');
if (!paths.length || (forced && forced !== 'fo1' && forced !== 'fo2')) {
  console.error('usage: npm run sfall-scan -- <mod folder or zip>... [--engine fo1|fo2]');
  process.exit(2);
}
const names = await readNames();
const engines = new Map<EngineId, Engine>();
for (const path of paths) {
  const mod = await readMod(path);
  const id = forced ?? mod.base ?? 'fo2';
  if (!engines.has(id)) engines.set(id, await readEngine(id));
  report(mod, engines.get(id)!, names);
}
