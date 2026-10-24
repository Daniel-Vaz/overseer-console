/**
 * Problem reports: everything the console knows about itself, a game and the
 * machine it runs on, written up the same way every time, so that a report
 * can be filed as an issue on GitHub as it is.
 *
 * Nothing is sent anywhere. The player sees the whole of it, copies it,
 * downloads it or opens a new issue with it filled in, and looks it over on
 * GitHub before posting. What could say who the player is (the account a
 * cloud is linked to, their saves, their file names) is never part of it.
 */
import { REPO_URL } from './project';

/** What the console was built from (see vite.config.ts). */
export const BUILD: { commit: string; date: string } = typeof __BUILD__ === 'object' ? __BUILD__ : { commit: 'dev', date: '' };

/** A part of a report: a heading and its lines, each a name and what it is. */
export interface ReportSection {
  title: string;
  rows: [name: string, value: string][];
}

/** Text that goes into a report as it is, in a block of its own (a log). */
export interface ReportBlock {
  title: string;
  lines: string[];
}

export interface Report {
  /** What kind of report: a fault the console caught, or one the player is making. */
  kind: 'fault' | 'problem';
  /** Where it happened: the game or mod, or the console itself. */
  where: string;
  /** For a fault, what the console said about it. */
  summary?: string;
  sections: ReportSection[];
  blocks: ReportBlock[];
}

/** Longest summary the title takes; the body has the rest. */
const TITLE_SUMMARY = 90;

/** Every title starts the same way, so that reports sort and search well. */
export function reportTitle(report: Report): string {
  const said = report.summary?.replace(/\s+/g, ' ').trim() ?? '';
  const short = said.length > TITLE_SUMMARY ? `${said.slice(0, TITLE_SUMMARY - 1).trimEnd()}…` : said;
  return report.kind === 'fault' ? `[${report.where}] Fault: ${short || 'the game stopped'}` : `[${report.where}] Problem: <say what went wrong>`;
}

const PROMPT_WHAT = '<!-- What did you do, and what happened? A screenshot helps. -->';
const PROMPT_EXPECTED = '<!-- What did you expect to happen instead? -->';

/** The report as the body of an issue, in GitHub's Markdown. `blockLines` caps each block, from its end. */
export function reportBody(report: Report, blockLines = Infinity): string {
  const out: string[] = ['### What happened', '', report.kind === 'fault' && report.summary ? `${report.summary}\n\n${PROMPT_WHAT}` : PROMPT_WHAT, '', '### What I expected', '', PROMPT_EXPECTED, ''];
  for (const section of report.sections) {
    if (!section.rows.length) continue;
    out.push(`### ${section.title}`, '', '| | |', '|---|---|');
    for (const [name, value] of section.rows) out.push(`| ${cell(name)} | ${cell(value)} |`);
    out.push('');
  }
  for (const block of report.blocks) {
    if (!block.lines.length) continue;
    const lines = block.lines.length > blockLines ? [`(${block.lines.length - blockLines} earlier lines left out)`, ...block.lines.slice(-blockLines)] : block.lines;
    out.push(`### ${block.title}`, '', '```text', ...lines.map((line) => line.replace(/```/g, "'''")), '```', '');
  }
  out.push(`<sub>Report written by the console, build ${BUILD.commit}${BUILD.date ? ` (${BUILD.date})` : ''}.</sub>`);
  return out.join('\n');
}

/** The report as plain text, for the clipboard or a file. */
export function reportText(report: Report): string {
  return `${reportTitle(report)}\n\n${reportBody(report)}\n`;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>') || '-';
}

/**
 * Longest address a new issue may be opened with. GitHub turns away much
 * longer ones; past this, the logs are shortened, and the full report is
 * on the clipboard to paste in.
 */
export const ISSUE_URL_LIMIT = 7500;

/** The address of a new issue on GitHub with the report filled in. `cut`: the logs had to be shortened to fit. */
export function issueUrl(report: Report): { url: string; cut: boolean } {
  const make = (lines: number) => {
    const query = new URLSearchParams({ title: reportTitle(report), body: reportBody(report, lines), labels: 'bug' });
    return `${REPO_URL}/issues/new?${query.toString()}`;
  };
  const longest = Math.max(0, ...report.blocks.map((block) => block.lines.length));
  for (const lines of [Infinity, 40, 20, 10, 5, 0]) {
    if (lines !== Infinity && lines >= longest) continue;
    const url = make(lines);
    if (url.length <= ISSUE_URL_LIMIT) return { url, cut: lines < longest };
  }
  // Even without its logs it is too long: the issue says so, and the clipboard has the rest.
  const query = new URLSearchParams({
    title: reportTitle(report),
    body: `${PROMPT_WHAT}\n\nThe console's report was too long for the link. It is on your clipboard: paste it here.`,
    labels: 'bug',
  });
  return { url: `${REPO_URL}/issues/new?${query.toString()}`, cut: true };
}

/** A short name for the file a report is downloaded as. */
export function reportFileName(report: Report, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const where = report.where.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `overseer-report-${where || 'console'}-${stamp}.md`;
}

// ---------------------------------------------------------------------
// What every report says about the browser and the machine
// ---------------------------------------------------------------------

/** The browser and its version, from what it says it is. */
export function browserName(agent = navigator.userAgent): string {
  // Those built on another say so after it: the most particular first.
  const known: [pattern: RegExp, name: string][] = [
    [/Edg(?:A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/FxiOS\/(\d+)/, 'Firefox (iOS)'],
    [/CriOS\/(\d+)/, 'Chrome (iOS)'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+).*Safari/, 'Safari'],
  ];
  for (const [pattern, name] of known) {
    const version = pattern.exec(agent)?.[1];
    if (version) return `${name} ${version}`;
  }
  return 'unknown browser';
}

/** The operating system, as far as the browser says. */
export function systemName(agent = navigator.userAgent): string {
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return /iPad|Macintosh/.test(agent) ? 'iPadOS' : 'iOS';
  if (/Android/.test(agent)) return `Android${/Android (\d+)/.exec(agent)?.[1] ? ` ${/Android (\d+)/.exec(agent)![1]}` : ''}`;
  if (/Windows/.test(agent)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(agent)) return 'macOS';
  if (/CrOS/.test(agent)) return 'ChromeOS';
  if (/Linux/.test(agent)) return 'Linux';
  return 'unknown system';
}

/** Megabytes, as reports give them. */
export function megabytes(bytes: number): string {
  return bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(2)} GB` : `${(bytes / (1 << 20)).toFixed(1)} MB`;
}

/** The section on the browser and the machine, the same in every report. */
export async function machineSection(): Promise<ReportSection> {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
  const rows: [string, string][] = [
    ['Browser', `${browserName()} on ${systemName()}`],
    ['User agent', navigator.userAgent],
    ['Window', `${window.innerWidth} x ${window.innerHeight} CSS px at ${window.devicePixelRatio || 1}x; screen ${screen.width} x ${screen.height}`],
    ['Input', `${navigator.maxTouchPoints > 0 ? `touch (${navigator.maxTouchPoints} points)` : 'no touch'}; ${matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'} pointer`],
    ['Processor, memory', `${navigator.hardwareConcurrency || '?'} cores; ${nav.deviceMemory ? `${nav.deviceMemory} GB or more` : 'memory not told'}`],
    ['Language', navigator.language],
  ];
  const features = [
    `private storage ${typeof navigator.storage?.getDirectory === 'function' ? 'yes' : 'no'}`,
    `web locks ${navigator.locks ? 'yes' : 'no'}`,
    `wake lock ${'wakeLock' in navigator ? 'yes' : 'no'}`,
    `keyboard lock ${'keyboard' in navigator ? 'yes' : 'no'}`,
    `audio worklet ${typeof AudioWorkletNode === 'function' ? 'yes' : 'no'}`,
    `cross-origin isolated ${window.crossOriginIsolated ? 'yes' : 'no'}`,
  ];
  rows.push(['Features', features.join(', ')]);
  try {
    const estimate = await navigator.storage?.estimate?.();
    const sealed = await navigator.storage?.persisted?.();
    if (estimate) rows.push(['Storage', `${megabytes(estimate.usage ?? 0)} used of ${megabytes(estimate.quota ?? 0)}; ${sealed ? 'sealed' : 'not sealed'}`]);
  } catch {
    rows.push(['Storage', 'the browser would not say']);
  }
  return { title: 'Browser and machine', rows };
}

/** The section on the console's own build, the same in every report. */
export function consoleSection(extra: [string, string][] = []): ReportSection {
  return {
    title: 'Console',
    rows: [
      ['Build', `${BUILD.commit}${BUILD.date ? ` (${BUILD.date})` : ''}`],
      ['Address', `${location.origin}${location.pathname}`],
      // (Not fullscreen: a page in the browser is that too, while a game is played full screen.)
      ['Installed as an app', matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone ? 'yes' : 'no'],
      ...extra,
    ],
  };
}

/**
 * The page's own errors, kept from the moment the page starts: what went
 * wrong in the console besides what the engine said.
 */
const pageErrors: string[] = [];
const PAGE_ERRORS_KEPT = 30;

function keepError(text: string): void {
  pageErrors.push(`${new Date().toISOString().slice(11, 19)} ${text.replace(/\s+/g, ' ').slice(0, 400)}`);
  if (pageErrors.length > PAGE_ERRORS_KEPT) pageErrors.shift();
}

let listening = false;

/** Starts keeping the page's errors (uncaught ones, and what is logged as an error). */
export function keepPageErrors(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('error', (event) => keepError(`error: ${event.message}${event.filename ? ` (${event.filename.split('/').pop()}:${event.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (event) => keepError(`unhandled: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    keepError(args.map(describe).join(' '));
    original(...args);
  };
}

/**
 * A short word for what was logged. Never the whole of an object: the
 * engine logs its own, which can hold the game's files.
 */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value === null || typeof value !== 'object') return String(value);
  const message = (value as { message?: unknown }).message;
  const name = (value as object).constructor?.name ?? 'Object';
  return typeof message === 'string' ? `${name}: ${message}` : `[${name}]`;
}

/** The page's errors so far, oldest first. */
export function pageErrorLines(): string[] {
  return [...pageErrors];
}

// ---------------------------------------------------------------------
// The last fault, for a report made from the console afterwards
// ---------------------------------------------------------------------

const FAULT_KEY = 'overseer-console:last-fault';
/** A fault older than this is no longer what a report is about. */
const FAULT_KEPT_MS = 24 * 60 * 60_000;

export interface RememberedFault {
  at: number;
  /** How the report names the game (see whereOf). */
  where: string;
  game: string;
  message: string;
  advice?: string;
  /** The engine's last lines before it stopped. */
  log: string[];
}

/** Keeps what the fault screen said, so that the console can still report it once the player is back there. */
export function rememberFault(fault: RememberedFault): void {
  try {
    localStorage.setItem(FAULT_KEY, JSON.stringify({ ...fault, log: fault.log.slice(-40) }));
  } catch {
    // A private window: the report from the fault screen itself has it all.
  }
}

/** The last fault, while it is recent. */
export function lastFault(now = Date.now()): RememberedFault | null {
  try {
    const fault = JSON.parse(localStorage.getItem(FAULT_KEY) ?? 'null') as RememberedFault | null;
    if (!fault || typeof fault.message !== 'string' || !Array.isArray(fault.log) || !(now - fault.at < FAULT_KEPT_MS)) return null;
    return fault;
  } catch {
    return null;
  }
}

export function forgetFault(): void {
  try {
    localStorage.removeItem(FAULT_KEY);
  } catch {
    // Nothing to forget.
  }
}
