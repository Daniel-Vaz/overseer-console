/**
 * Whether an add-on or mod will work on the console's engine, as far as its
 * scripts tell: what they ask of sfall that the engine lacks (see scan.ts),
 * and the settings files they read that are not there. Said in words for the
 * player when an add-on is loaded, and on its page or a mod's (Check).
 */
import type { DatArchive } from '../dat';
import { pathKey } from '../storage/manifest';
import type { SourceBlob } from '../storage/opfs';
import { indexDat } from '../dat';
import { addArchive, addScript, checkScripts, datFormat, emptyScripts, type Finding, type Support } from './scan';

export interface Check {
  /** How many scripts were read. */
  scripts: number;
  findings: Finding[];
}

/** A file to look in: its path in the game folder, and how to read it. */
export interface CheckFile {
  path: string;
  size: number;
  open: () => Promise<SourceBlob | null>;
}

let support: Promise<Support> | null = null;

/** What the engine of Fallout 2 has of sfall, loaded when first asked for. */
function fo2Support(): Promise<Support> {
  support ??= import('./support-fo2.json').then((module) => module.default as unknown as Support);
  return support;
}

/**
 * Reads the scripts of a mod or add-on (loose, and in its archives) and says
 * what the engine lacks of what they ask for. `status` is told of each archive
 * as it is read.
 */
export async function checkFiles(files: CheckFile[], status?: (path: string) => void): Promise<Check> {
  const found = emptyScripts();
  /** What there is to read by plain path: its files, and what is in its archives in mods/. */
  const there = new Set(files.map((file) => pathKey(file.path)));
  for (const file of files) {
    const key = pathKey(file.path);
    if (key.endsWith('.int')) {
      const blob = await file.open();
      if (blob) addScript(found, file.path, new Uint8Array(await blob.arrayBuffer()));
    } else if (key.endsWith('.dat') && file.size > 16) {
      const blob = await file.open();
      if (!blob || (await datFormat(blob as DatArchive)) !== 'dat2') continue;
      status?.(file.path);
      await addArchive(found, file.path, blob as DatArchive).catch(() => undefined);
      if (/^mods\/[^/]+\.dat$/.test(key)) {
        for (const name of (await indexDat(blob as DatArchive, 'dat2').catch(() => new Map())).keys()) there.add(`${key}/${name}`);
      }
    }
  }
  const findings = checkScripts(found, await fo2Support(), undefined, (path) => there.has(path));
  return { scripts: found.scripts.size, findings };
}

const list = (names: string[]): string => {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
};

/** What a finding means for the player, in a sentence. */
export function describe(finding: Finding): string {
  const where = list(finding.where);
  switch (finding.kind) {
    case 'opcode':
      return `${where} calls ${finding.what}, which the engine does not have: the script stops there.`;
    case 'stub':
      return `${where} calls ${finding.what}, which the engine takes and does nothing with.`;
    case 'metarule':
      return `${where} calls ${finding.what}, which the engine does not have: it gives 0 and does nothing.`;
    case 'memory':
      return `${where} reaches into the original program at ${finding.what.replace(/^\w+ /, '')}, which the engine does not answer for: a read gives 0, the rest does nothing.`;
    case 'hook':
      return `${where} waits for sfall's ${finding.what.replace(/ \(\d+\)$/, '')} hook, which the engine never runs: what it does then does not happen.`;
    case 'hookScript':
      return `${finding.what} is a hook script the engine never runs.`;
    case 'stray':
      return `${finding.what} is a global script outside a scripts folder, where the engine does not look for it: it never runs.`;
    case 'unreadable':
      return `${finding.what} cannot be read as a script.`;
    case 'ini':
      return `${where} reads ${finding.what}, which is not there: it gets the values it falls back on.`;
    case 'setting':
      return `ddraw.ini sets ${finding.what}, which the engine does not read.`;
  }
}

/** The verdict in a few words, for a readout. */
export function verdict(check: Check): string {
  if (!check.scripts) return 'NO SCRIPTS TO CHECK';
  if (!check.findings.length) return 'NOTHING MISSING';
  return `${check.findings.length} ${check.findings.length === 1 ? 'THING' : 'THINGS'} MISSING`;
}

/** The verdict in a sentence, for the result of loading an add-on. */
export function summary(check: Check): string {
  const scripts = `${check.scripts.toLocaleString('en-US')} ${check.scripts === 1 ? 'script' : 'scripts'}`;
  if (!check.findings.length) return `Checked: its ${scripts} ${check.scripts === 1 ? 'asks' : 'ask'} for nothing the engine lacks.`;
  const first = describe(check.findings[0]!);
  return check.findings.length === 1
    ? `Checked its ${scripts}: ${first} See Check on its page.`
    : `Checked its ${scripts}: ${check.findings.length} things the engine lacks, such as: ${first} See Check on its page.`;
}
