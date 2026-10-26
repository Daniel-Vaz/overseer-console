/**
 * What of sfall a mod's or add-on's scripts ask for, and what of it the engine
 * of Fallout 2 lacks: the opcodes and metarules they call, the hooks they
 * register and their hook scripts, the original program's memory they reach
 * into, the settings of its ddraw.ini, and the settings files they read.
 *
 * The console says so when an add-on is loaded, and on an add-on's or mod's
 * page (Check); `npm run sfall-scan` prints it for mods on disk. What the
 * engine has is in support-fo2.json, which that command writes from the
 * engine's patched source (`npm run sfall-scan -- --support`).
 */
import { indexDat, readDatEntry, type DatArchive } from '../dat';

/** What the engine has of sfall, and what sfall calls things. */
export interface Support {
  /** Opcodes the interpreter knows. */
  opcodes: number[];
  /** Of those, the ones whose handler only says it cannot (memory access, shaders...). */
  stubs: number[];
  /** Metarules (sfall_func0..8) it knows, by name. */
  metarules: string[];
  /** Hooks it calls scripts for, by id. */
  fires: number[];
  /** Whether it loads hook scripts by their file name (hs_tohit.int). */
  hookScripts: boolean;
  /** ddraw.ini keys it reads, as "section/key" lower-cased; a '*' ends a family (movie1..32). */
  settings: string[];
  /** What of the original program's memory it answers for: the stretches read and written, the functions called. */
  memory: { areas: [start: number, end: number][]; calls: number[] };
  names: {
    /** sfall's opcodes, by number. */
    opcodes: Record<string, string>;
    /** sfall's metarules. */
    metarules: string[];
    /** Hook ids by name (TOHIT), commented out or not. */
    hooks: Record<string, number>;
  };
}

/** What one compiled script calls. */
export interface ScriptUse {
  opcodes: Set<number>;
  /** Its strings, among which the names of the metarules it calls. */
  strings: Set<string>;
  /** Hooks it registers (register_hook, register_hook_proc[_spec]) by a constant id. */
  hooks: Set<number>;
  /** The addresses its memory opcodes are given, as "opcode:address". */
  memory: Set<string>;
  /** The settings files it names (mods\fo2tweaks.ini), as it spells them. */
  ini: Set<string>;
}

/** The scripts of a mod or add-on, read from wherever it keeps them. */
export interface Scripts {
  /** By lower-cased file name: what every copy of it calls. */
  scripts: Map<string, ScriptUse>;
  /** Global scripts (gl*.int) kept elsewhere than scripts/, where the engines look for them. */
  strayGlobals: Set<string>;
  unreadable: Set<string>;
}

const PUSH = new Set([0xc001, 0xa001, 0x9001]);
const REGISTER_HOOK = 0x8207;
const REGISTER_HOOK_PROC = new Set([0x8262, 0x827d]);

/** read_byte .. read_string, write_byte .. write_int, call_offset_v0 .. r4, write_string; and how many values each takes. */
export const MEMORY_OPCODES = new Map<number, number>([
  [0x8156, 1], [0x8157, 1], [0x8158, 1], [0x8159, 1], [0x81cf, 2], [0x81d0, 2], [0x81d1, 2],
  ...[0, 1, 2, 3, 4].flatMap((args) => [[0x81d2 + args, args + 1], [0x81d7 + args, args + 1]] as [number, number][]),
  [0x821b, 2],
]);
/** add, sub, mul. */
const ARITHMETIC = new Map<number, (a: number, b: number) => number>([
  [0x8039, (a, b) => a + b],
  [0x803a, (a, b) => a - b],
  [0x803b, (a, b) => a * b],
]);
/** Where the original Fallout 2 and Fallout keep their code and data. */
const isAddress = (value: number) => value >= 0x400000 && value < 0x700000;
/** A settings file named in a script, before the |section|key a call adds to it. */
const INI_PATH = /^[\w .\\/-]+\.ini(?=$|\|)/i;

/**
 * Reads a compiled script (.int): after a 42-byte start, its procedure table (24 bytes each, the body's offset at 16),
 * names and strings, then its code: two-byte opcodes, those that push a value followed by four bytes of it.
 */
export function readScript(data: Uint8Array): ScriptUse | null {
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
  const ini = new Set<string>();
  for (const piece of new TextDecoder('latin1').decode(data.subarray(46 + count * 24, start)).split('\0')) {
    // Each name and string comes after its length (two bytes, high first, with its end and padding to an even
    // length): the low byte is the first character here.
    const text = piece.length > 1 && [1, 2].includes(piece.charCodeAt(0) - (piece.length - 1)) ? piece.slice(1) : piece;
    if (/^\w+$/.test(text)) strings.add(text.toLowerCase());
    const path = INI_PATH.exec(text);
    if (path) ini.add(path[0]);
  }
  const opcodes = new Set<number>();
  const hooks = new Set<number>();
  const memory = new Set<string>();
  const pushed: number[] = [];
  // The constants pushed lately, and sums of them (an address and an offset), for the address a memory opcode is given
  // where its values are worked out.
  const recent: { value: number; step: number }[] = [];
  const sums: number[] = [];
  let step = 0;
  let at = start;
  while (at + 2 <= data.length) {
    const opcode = view.getUint16(at);
    at += 2;
    if (opcode < 0x8000) return null;
    if (PUSH.has(opcode)) {
      if (at + 4 > data.length) return null;
      pushed.push(opcode === 0xc001 ? view.getInt32(at) : NaN);
      if (opcode === 0xc001) recent.push({ value: view.getInt32(at), step });
      if (recent.length > 32) recent.shift();
      sums.push(opcode === 0xc001 ? view.getInt32(at) : NaN);
      at += 4;
      step++;
      continue;
    }
    step++;
    const arithmetic = ARITHMETIC.get(opcode);
    if (arithmetic && sums.length >= 2) {
      const b = sums.pop()!;
      const sum = arithmetic(sums.pop()!, b);
      sums.push(sum);
      if (isAddress(sum)) recent.push({ value: sum, step });
    } else sums.length = 0;
    const takes = MEMORY_OPCODES.get(opcode);
    if (takes !== undefined) {
      // All its values pushed as they are: the first is the address. Else the last address-like one, not long ago.
      let address = pushed.length >= takes ? pushed[pushed.length - takes]! : NaN;
      if (!isAddress(address)) address = recent.findLast((push) => isAddress(push.value) && step - push.step < 24)?.value ?? NaN;
      memory.add(`${opcode}:${Number.isNaN(address) ? '?' : address}`);
    }
    if (opcode === REGISTER_HOOK && pushed.length >= 1) hooks.add(pushed[pushed.length - 1]!);
    if (REGISTER_HOOK_PROC.has(opcode) && pushed.length >= 2) hooks.add(pushed[pushed.length - 2]!);
    pushed.length = 0;
    opcodes.add(opcode);
  }
  hooks.delete(NaN);
  return { opcodes, strings, hooks, memory, ini };
}

export function emptyScripts(): Scripts {
  return { scripts: new Map(), strayGlobals: new Set(), unreadable: new Set() };
}

const base = (path: string): string => path.replace(/\\/g, '/').split('/').pop() ?? path;

/** Adds a compiled script, found at `path`, to what is known of a mod's scripts. */
export function addScript(found: Scripts, path: string, data: Uint8Array): void {
  const name = base(path).toLowerCase();
  if (name.startsWith('gl') && !/(^|\/)scripts\/gl[^/]*$/i.test(path.replace(/\\/g, '/'))) found.strayGlobals.add(path);
  const use = readScript(data);
  if (!use) {
    found.unreadable.add(name);
    return;
  }
  const known = found.scripts.get(name);
  if (!known) return void found.scripts.set(name, use);
  for (const opcode of use.opcodes) known.opcodes.add(opcode);
  for (const text of use.strings) known.strings.add(text);
  for (const hook of use.hooks) known.hooks.add(hook);
  for (const access of use.memory) known.memory.add(access);
  for (const path of use.ini) known.ini.add(path);
}

/** Fallout 2's archives end with their own size; Fallout 1's do not. */
export async function datFormat(archive: DatArchive): Promise<'dat1' | 'dat2'> {
  const tail = new DataView(await archive.slice(archive.size - 4, archive.size).arrayBuffer());
  return tail.getUint32(0, true) === archive.size ? 'dat2' : 'dat1';
}

/** Adds the compiled scripts in an archive, found at `path`. */
export async function addArchive(found: Scripts, path: string, archive: DatArchive): Promise<void> {
  const format = await datFormat(archive);
  const entries = [...(await indexDat(archive, format)).values()].filter((entry) => entry.name.endsWith('.int'));
  // In the order they lie, so that one packed in a zip is read through once.
  entries.sort((a, b) => a.offset - b.offset);
  for (const entry of entries) addScript(found, `${path.replace(/\.dat$/i, '')}/${entry.name}`, await readDatEntry(archive, format, entry));
}

// --- What the engine lacks of it ----------------------------------------------------------------------------------

/** One thing the scripts ask for, and the scripts that ask for it. */
export interface Finding {
  kind: 'opcode' | 'stub' | 'memory' | 'metarule' | 'hook' | 'hookScript' | 'stray' | 'unreadable' | 'setting' | 'ini';
  /** What it is, as sfall names it: get_ini_section, ONEXPLOSION (36), read_int 0x51C720, [Misc] Foo=1. */
  what: string;
  /** The scripts, or settings files, that ask for it. */
  where: string[];
}

/** Hook scripts sfall does not name after their hook. */
const HOOK_FILES: Record<string, string> = { 'hs_subcombatdmg.int': 'SUBCOMBATDAMAGE' };
/** The first opcode an engine's scripts may call beyond the interpreter's own. */
const FIRST_GAME_OPCODE = 0x80a1;

function readIni(text: string): { section: string; key: string; value: string }[] {
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

/**
 * What the engine lacks of what the scripts ask for, the most asked-for first in each kind. `ddraw`: the sfall
 * settings it comes with, if any. `hasFile`: whether a settings file a script names is there to be read (a lower-cased
 * path below the game folder, with forward slashes), where that can be told.
 */
export function checkScripts(found: Scripts, support: Support, ddraw?: string, hasFile?: (path: string) => boolean): Finding[] {
  const opcodes = new Set(support.opcodes);
  const stubs = new Set(support.stubs);
  const metarules = new Set(support.metarules);
  const sfallMetarules = new Set(support.names.metarules);
  const fires = new Set(support.fires);
  const calls = new Set(support.memory.calls);
  const hookName = new Map(Object.entries(support.names.hooks).map(([name, id]) => [id, name]));
  const opcodeName = (opcode: number) => `${support.names.opcodes[opcode] ?? 'not in sfall'} (0x${opcode.toString(16)})`;

  const findings = new Map<string, Finding>();
  const add = (kind: Finding['kind'], what: string, where: string) => {
    const id = `${kind}\n${what}`;
    const finding = findings.get(id) ?? { kind, what, where: [] };
    if (!finding.where.includes(where)) finding.where.push(where);
    findings.set(id, finding);
  };

  for (const name of found.unreadable) add('unreadable', name, name);
  for (const [script, use] of found.scripts) {
    for (const access of use.memory) {
      const [opcode, address] = access.split(':').map(Number) as [number, number];
      const kind = opcode >= 0x81d2 && opcode <= 0x81db ? 'call' : opcode <= 0x8159 ? 'read' : 'write';
      const answered = kind === 'call' ? calls.has(address) : support.memory.areas.some(([start, end]) => address >= start && address < end);
      if (opcodes.has(opcode) && answered) continue;
      const name = support.names.opcodes[opcode]?.replace(/_[vr]\d$/, '') ?? `0x${opcode.toString(16)}`;
      add('memory', `${name} ${Number.isNaN(address) ? '(an address worked out)' : `0x${address.toString(16).toUpperCase()}`}`, script);
    }
    for (const opcode of use.opcodes) {
      if (opcode < FIRST_GAME_OPCODE || MEMORY_OPCODES.has(opcode)) continue;
      if (!opcodes.has(opcode)) add('opcode', opcodeName(opcode), script);
      else if (stubs.has(opcode)) add('stub', opcodeName(opcode), script);
    }
    for (const text of use.strings) {
      if (sfallMetarules.has(text) && !metarules.has(text)) add('metarule', text, script);
    }
    for (const hook of use.hooks) {
      if (!fires.has(hook)) add('hook', `${hookName.get(hook) ?? 'not in sfall'} (${hook})`, script);
    }
    if (hasFile) {
      for (const path of use.ini) {
        const key = path.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
        // ddraw.ini and f2_res.ini are read from what the engine has; the rest must be there.
        if (/^(ddraw|f2_res)\.ini$/.test(key) || hasFile(key)) continue;
        add('ini', path, script);
      }
    }
    if (/^hs_\w+\.int$/.test(script)) {
      const id = support.names.hooks[HOOK_FILES[script] ?? script.slice(3, -4).toUpperCase()];
      if (!support.hookScripts || id === undefined || !fires.has(id)) add('hookScript', script, script);
    }
  }
  for (const path of found.strayGlobals) add('stray', path, path);

  if (ddraw !== undefined) {
    for (const { section, key, value } of readIni(ddraw)) {
      if (value === '' || value === '0') continue;
      const id = `${section}/${key}`.toLowerCase();
      if (support.settings.some((setting) => (setting.endsWith('*') ? id.startsWith(setting.slice(0, -1)) : setting === id))) continue;
      add('setting', `[${section}] ${key}=${value.length > 16 ? `${value.slice(0, 12)}...` : value}`, 'ddraw.ini');
    }
  }
  return [...findings.values()].sort((a, b) => b.where.length - a.where.length);
}
