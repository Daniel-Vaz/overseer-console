/** How the console speaks of mods, and of add-ons. */
import type { AddonRecord } from '../lib/addons';
import { gameDef, type GameId } from '../lib/games';
import type { ModStatus } from '../lib/mods/catalog';
import type { AddonInfo } from './state.svelte';

export const STATUS_NAMES: Record<ModStatus, string> = {
  tested: 'TESTED HERE',
  supported: 'SUPPORTED',
  experimental: 'EXPERIMENTAL',
  unknown: 'NOT TESTED',
};

export const STATUS_NOTES: Record<ModStatus, string> = {
  tested: "The console's own tests play it from its real files.",
  supported: 'The makers of the engine say it plays on it.',
  experimental: 'It starts, and parts of it are known not to work on this engine.',
  unknown: 'Nobody has said how well it plays on this engine.',
};

/** A mod's name with its version, where it has one and its name does not already say it (Fallout 1.5: Resurrection 1.5). */
export function modName(game: GameId): string {
  const def = gameDef(game);
  const version = def.mod?.version;
  return version && !def.title.split(/[\s:]+/).includes(version) ? `${def.title} ${version}` : def.title;
}

/** The console's screen for a game: its deck, or a mod's own page. */
export function screenOf(game: GameId): string {
  return gameDef(game).mod ? `mods/${game}` : game;
}

/** An add-on's name with its version, where it has one. */
export function addonName(record: AddonRecord): string {
  return record.version ? `${record.title} ${record.version}` : record.title;
}

/** What an add-on brings, in a few words: its parts of the load order, its music, the rest of its files. */
export function addonHolds(info: AddonInfo): string {
  const parts: string[] = [];
  if (info.order.length) parts.push(`${info.order.join(', ')} for the load order`);
  if (info.music) parts.push(`${info.music} music ${info.music === 1 ? 'track' : 'tracks'}`);
  const rest = info.files - info.order.length - info.music;
  if (rest > 0) parts.push(`${rest} ${parts.length ? 'more ' : ''}${rest === 1 ? 'file' : 'files'}`);
  return parts.join(', ');
}
