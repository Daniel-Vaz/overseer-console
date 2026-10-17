/** How the console speaks of mods. */
import { gameDef, type GameId } from '../lib/games';
import type { ModStatus } from '../lib/mods/catalog';

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

/** A mod's name with its version, where it has one. */
export function modName(game: GameId): string {
  const def = gameDef(game);
  return def.mod?.version ? `${def.title} ${def.mod.version}` : def.title;
}

/** The console's screen for a game: its deck, or a mod's own page. */
export function screenOf(game: GameId): string {
  return gameDef(game).mod ? `mods/${game}` : game;
}
