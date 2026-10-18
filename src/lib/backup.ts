/**
 * When a game's saves last left this browser: all of them exported to a zip
 * file, or uploaded to the player's Dropbox or Google Drive. Saves otherwise
 * live only in the browser's storage, which the browser may clear, so the
 * console says when that was, and says so loudly when it never was.
 */
import type { GameId } from './games';
import { loadSynced } from './dropbox/link';

const KEY = 'overseer-console:exported';

export type ExportedTo = 'dropbox' | 'drive' | 'zip';

const PLACES: readonly ExportedTo[] = ['dropbox', 'drive', 'zip'];

export interface ExportMark {
  at: number;
  to: ExportedTo;
}

type Marks = Partial<Record<GameId, ExportMark>>;

function readMarks(): Marks {
  try {
    const marks = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Marks | null;
    return marks && typeof marks === 'object' ? marks : {};
  } catch {
    return {};
  }
}

/** The last time this game's saves were exported, if ever. */
export function lastExport(game: GameId): ExportMark | null {
  const mark = readMarks()[game];
  if (mark && Number.isFinite(mark.at) && PLACES.includes(mark.to)) return mark;
  // Uploaded before the console kept track: Dropbox holds a save from here no older than the newest one it got.
  const synced = Object.values(loadSynced(game)).map((save) => save.savedAt).filter(Number.isFinite);
  return synced.length ? { at: Math.max(...synced), to: 'dropbox' } : null;
}

/** All of this game's saves were just exported. */
export function recordExport(game: GameId, to: ExportedTo, at = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readMarks(), [game]: { at, to } }));
  } catch {
    // Private windows may refuse storage: the console then keeps asking.
  }
}
