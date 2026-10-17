import type { GameId } from '../lib/games';
import { closeAudio } from './sfx';

/**
 * Leaves the console for the player page. With a slot the game loads that
 * save as soon as it is up, instead of stopping at its main menu. `from` is
 * the console's screen to come back to, where that is not the game's own.
 */
export async function launchGame(game: GameId, slot?: number, from?: string): Promise<void> {
  // The game needs the sound card to itself.
  await closeAudio();
  const query = new URLSearchParams({ game });
  if (slot !== undefined) query.set('slot', String(slot));
  if (from !== undefined) query.set('from', from);
  location.href = `${import.meta.env.BASE_URL}play.html?${query.toString().replace(/%2F/g, '/')}`;
}
