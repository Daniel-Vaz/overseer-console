/**
 * The problem report of the player page: what is known of the game that was
 * started, how it was started and how it has gone, on top of what every
 * report says (see lib/report.ts).
 */
import { planLabel } from '../lib/autosave';
import type { Engine } from '../lib/engine/host';
import { gameDef, type GameId } from '../lib/games';
import { consoleSection, machineSection, megabytes, pageErrorLines, type Report, type ReportSection } from '../lib/report';
import { pictureOf, type Settings } from '../lib/settings';
import { PICTURE_NAMES } from '../launcher/picture';
import type { AudioBridgeStats } from './audio-bridge';

/** What the page knows besides the engine, when the report is made. */
export interface PlayerState {
  game: GameId | null;
  engine: Engine | null;
  settings: Settings;
  /** What the page is doing: booting, at the gate, running, suspended, failed. */
  phase: string;
  /** Milliseconds since the game began, or 0. */
  playedMs: number;
  fast: boolean;
  lights: boolean;
  touch: boolean;
  /** The save the game was asked to start from. */
  loadSlot?: number;
  audio: AudioBridgeStats;
  /** The engine's last lines, oldest first. */
  engineLog: string[];
  /** What the engine last said in a message box. */
  complaint?: string;
  /** For a fault: what the fault screen says. */
  fault?: { message: string; advice?: string };
}

/** How the report names the game: the mod and its version, and what it is played on. */
export function whereOf(game: GameId | null): string {
  if (!game) return 'Player';
  const def = gameDef(game);
  if (!def.mod) return def.title;
  return `${def.title}${def.mod.version ? ` ${def.mod.version}` : ''} on ${gameDef(def.mod.base).short}`;
}

function minutes(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
}

function date(ms: number): string {
  return ms ? new Date(ms).toISOString().slice(0, 10) : '-';
}

export async function playerReport(state: PlayerState): Promise<Report> {
  const { engine, settings } = state;
  const sections: ReportSection[] = [consoleSection()];

  if (state.game) {
    const def = gameDef(state.game);
    const rows: [string, string][] = [['Game', `${def.title} (${def.id})`]];
    if (def.mod) {
      rows.push(['Mod', `${def.mod.known ? `known as ${def.mod.known}` : 'not one the console knows'}${def.mod.version ? `, version ${def.mod.version}` : ''}; played on ${gameDef(def.mod.base).title}`]);
    }
    if (engine) {
      const { info, about, screen } = engine;
      rows.push(['Engine', `${def.engine.name}, ${info.source.replace(/^https:\/\/github\.com\//, '')} @ ${info.commit.slice(0, 10)}${info.patched ? ', patched' : ''}; build ${info.hash}; emsdk ${info.emsdk}`]);
      if (about.sfall) rows.push(['sfall', `${about.sfall} (as the mod came)`]);
      rows.push(['Installed', `${about.install.files} files, ${megabytes(about.install.bytes)}, imported ${date(about.install.importedAt)}`]);
      if (about.base) rows.push(['Game underneath', `${about.base.files} files, ${megabytes(about.base.bytes)}, imported ${date(about.base.importedAt)}`]);
      rows.push(['Add-ons on', about.addons.length ? about.addons.map((addon) => `${addon.title}${addon.version ? ` ${addon.version}` : ''}`).join(', ') : 'none']);
      rows.push(['Folder started', `${about.files} files; settings in ${about.configFile}`]);
      rows.push(['Picture', `${PICTURE_NAMES[pictureOf(settings, state.game)]}, ${screen.width} x ${screen.height}; scaling ${settings.scaling}`]);
    } else {
      rows.push(['Picture', PICTURE_NAMES[pictureOf(settings, state.game)]]);
    }
    rows.push([
      'Settings',
      [
        `improvements ${settings.improvements ? 'on' : 'off'}`,
        `sound ${settings.audio}`,
        `fast forward ${settings.fastForward}x`,
        `autosave ${planLabel({ minutes: settings.autosave, maps: settings.autosaveMaps }).toLowerCase()}`,
        `intro ${settings.skipIntro ? 'skipped' : 'played'}`,
        `memory ${settings.cacheMb} MB`,
        ...(state.touch ? [`touch pointer ${settings.touchPointer}`] : []),
      ].join(', '),
    ]);
    sections.push({ title: 'Game', rows });
  }

  const session: [string, string][] = [
    ['State', state.phase],
    ['Played', state.playedMs ? minutes(state.playedMs) : 'not begun'],
  ];
  if (state.loadSlot !== undefined) session.push(['Started from', `save slot ${String(state.loadSlot).padStart(2, '0')}`]);
  session.push(['Controls', `${state.touch ? 'touch deck' : 'keyboard and mouse'}${document.fullscreenElement ? ', fullscreen' : ''}${state.fast ? ', fast forward on' : ''}${state.lights ? ', highlights on' : ''}`]);
  if (engine) {
    const stats = engine.module.overseer.stats();
    session.push(['In a game', engine.inGame() ? 'yes' : 'no (menus or movies)']);
    session.push([
      'Engine',
      `${stats.yields} yields, ${stats.sleeps} sleeps, ${stats.stalls} stalls; ${Math.round(stats.busyMs)} ms busy; clock ${Math.round(stats.clock)} ms at ${stats.speed}x${stats.paused ? ', paused' : ''}`,
    ]);
    session.push([
      'Reads',
      `${stats.blockReads} reads, ${megabytes(stats.blockBytes)} in ${Math.round(stats.blockMs)} ms; ${megabytes(stats.cachedBytes)} kept in ${stats.cachedBlocks} blocks, ${stats.evictions} let go; ${stats.syncs} stores`,
    ]);
  }
  const audio = state.audio;
  session.push(['Sound', Object.entries(audio).map(([name, value]) => `${name} ${typeof value === 'number' ? Math.round(value * 100) / 100 : String(value)}`).join(', ') || '-']);
  if (state.complaint) session.push(['Engine said', state.complaint]);
  if (state.fault) session.push(['Fault', `${state.fault.message}${state.fault.advice ? ` ${state.fault.advice}` : ''}`]);
  sections.push({ title: 'Session', rows: session });
  sections.push(await machineSection());

  return {
    kind: state.fault ? 'fault' : 'problem',
    where: whereOf(state.game),
    summary: state.fault?.message,
    sections,
    blocks: [
      { title: 'Engine log', lines: state.engineLog.slice(-120) },
      { title: 'Page errors', lines: pageErrorLines() },
    ],
  };
}
