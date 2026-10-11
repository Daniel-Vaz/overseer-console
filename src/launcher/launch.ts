import type { GameId } from '../lib/games';
import { closeAudio } from './sfx';

/**
 * Leaves the console for the player page. With a slot the game loads that
 * save as soon as it is up, instead of stopping at its main menu.
 */
export async function launchGame(game: GameId, slot?: number): Promise<void> {
  // The game needs the sound card to itself.
  await closeAudio();
  location.href = `${import.meta.env.BASE_URL}play.html?game=${game}${slot === undefined ? '' : `&slot=${slot}`}`;
}
