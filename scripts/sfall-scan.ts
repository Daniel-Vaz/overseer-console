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
//
//   npm run sfall-scan -- --support
//
// writes what the Fallout 2 engine has into src/lib/sfall/support-fo2.json, which the console checks add-ons and mods
// against (src/lib/sfall/scan.ts). Run it after each engine patch that adds any of these.
import { openAsBlob } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { addArchive, addScript, checkScripts, datFormat, emptyScripts, type Finding, type Scripts, type Support } from '../src/lib/sfall/scan.ts';
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
  /** What of the original program's memory it answers for: the stretches read and written, the functions called. */
  memory: { areas: [start: number, end: number][]; calls: Set<number> };
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
  // What of the original program's memory it answers for, as registered beside what stands for it (sfall_memory.h).
  const memory = { areas: [] as [number, number][], calls: new Set<number>() };
  for (const match of all.matchAll(/SFALL_MEMORY(_POINTER|_ACCESSOR|_CALL)?\(\s*0x([0-9a-f]+)(?:, *\w+, *(\d+)\))?/gi)) {
    const address = parseInt(match[2]!, 16);
    if (match[1] === '_CALL') memory.calls.add(address);
    else memory.areas.push([address, address + (match[3] ? Number(match[3]) : 4)]);
  }
  return { id, opcodes, stubs, metarules, fires, hookScripts: /"hs_/.test(all), settings, memory };
}

// --- What a mod asks for ------------------------------------------------------------------------------------------

interface Mod extends Scripts {
  name: string;
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

async function readFileOf(mod: Mod, path: string, file: SourceBlob) {
  const lower = path.toLowerCase();
  // What macOS adds to a zip made on it.
  if (lower.includes('__macosx/')) return;
  if (lower.endsWith('.int')) addScript(mod, path, new Uint8Array(await file.arrayBuffer()));
  else if (lower.endsWith('.dat') && file.size > 16) {
    if (/(^|\/)master\.dat$/i.test(path)) mod.base ??= (await datFormat(file)) === 'dat1' ? 'fo1' : 'fo2';
    await addArchive(mod, path, file).catch((err: unknown) => console.warn(`  ${path}: not read (${String(err)})`));
  } else if (lower.endsWith('.zip')) {
    const entries = await readZip(file).catch((err: unknown) => void console.warn(`  ${path}: not read (${String(err)})`));
    for (const entry of entries ?? []) await readFileOf(mod, `${path}/${entry.path}`, entry.file);
  } else if (basename(lower) === 'ddraw.ini') mod.settings.set(path, await file.text());
}

async function readMod(path: string): Promise<Mod> {
  const mod: Mod = { name: basename(path), ...emptyScripts(), settings: new Map() };
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

function some(names: string[]): string {
  const shown = names.sort().slice(0, 4).join(', ');
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

const HEADINGS: Record<Finding['kind'], string> = {
  unreadable: 'not readable as scripts',
  opcode: 'opcodes the engine lacks',
  stub: 'opcodes the engine takes and does nothing with',
  memory: "the original program's memory, which the engine does not answer for (a read gives 0, the rest does nothing)",
  metarule: 'metarules the engine lacks',
  hook: 'hooks registered that the engine never calls',
  hookScript: 'hook scripts the engine never runs',
  stray: 'global scripts outside scripts/ (the engine runs scripts/gl*.int only)',
  setting: 'ddraw.ini settings the engine does not read',
  ini: 'settings files the scripts read that are not there',
};

function report(mod: Mod, engine: Engine, names: Names) {
  console.log(`\n== ${mod.name}: ${mod.scripts.size} scripts, played on the ${engine.id} engine`);
  // The game reads the ddraw.ini beside its program: the outermost one (the others are copies, or another engine's).
  const depth = (path: string) => path.split('/').length;
  const outermost = [...mod.settings].sort((a, b) => depth(a[0]) - depth(b[0]))[0];
  const findings = checkScripts(mod, supportOf(engine, names), outermost?.[1]);
  for (const kind of Object.keys(HEADINGS) as Finding['kind'][]) {
    const found = findings.filter((finding) => finding.kind === kind);
    if (!found.length) continue;
    console.log(`  ${HEADINGS[kind]}${kind === 'setting' ? ` (${outermost![0]})` : ''}:`);
    for (const { what, where } of found) {
      console.log(kind === 'stray' || kind === 'unreadable' || kind === 'setting' ? `    ${what}` : `    ${what} in ${where.length} script${where.length > 1 ? 's' : ''}: ${some(where)}`);
    }
  }
}

/** What an engine has, as the console reads it. */
function supportOf(engine: Engine, names: Names): Support {
  return {
    opcodes: [...engine.opcodes].sort((a, b) => a - b),
    stubs: [...engine.stubs].sort((a, b) => a - b),
    metarules: [...engine.metarules].sort(),
    fires: [...engine.fires].sort((a, b) => a - b),
    hookScripts: engine.hookScripts,
    settings: [...new Set(engine.settings)].sort(),
    memory: { areas: engine.memory.areas.sort((a, b) => a[0] - b[0]), calls: [...engine.memory.calls].sort((a, b) => a - b) },
    names: {
      opcodes: Object.fromEntries([...names.opcodes].sort((a, b) => a[0] - b[0]).map(([opcode, name]) => [String(opcode), name])),
      metarules: [...names.metarules].sort(),
      hooks: Object.fromEntries([...names.hooks].sort((a, b) => a[1] - b[1])),
    },
  };
}

const args = process.argv.slice(2);
const names = await readNames();
if (args.includes('--support')) {
  const out = join(ROOT, 'src/lib/sfall/support-fo2.json');
  await writeFile(out, `${JSON.stringify(supportOf(await readEngine('fo2'), names))}\n`);
  console.log(`wrote ${out}`);
  process.exit(0);
}
const forced = args.includes('--engine') ? (args[args.indexOf('--engine') + 1] as EngineId) : undefined;
const paths = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--engine');
if (!paths.length || (forced && forced !== 'fo1' && forced !== 'fo2')) {
  console.error('usage: npm run sfall-scan -- <mod folder or zip>... [--engine fo1|fo2] | --support');
  process.exit(2);
}
const engines = new Map<EngineId, Engine>();
for (const path of paths) {
  const mod = await readMod(path);
  const id = forced ?? mod.base ?? 'fo2';
  if (!engines.has(id)) engines.set(id, await readEngine(id));
  report(mod, engines.get(id)!, names);
}
