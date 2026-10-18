/**
 * The link to a player's own Google Drive: what this browser remembers about it.
 *
 * The console has no server and no Google client of its own. Each player
 * makes a Google Cloud project with an OAuth client of the kind meant for TVs
 * and other devices without a browser of their own, and gives the console
 * its ID and secret. The token the console then holds is limited to the
 * files the console made in that Drive (the drive.file scope), and it never
 * leaves this browser.
 */
import { normaliseFolder } from '../cloud/folders';
import type { SyncedSave } from '../cloud/provider';
import type { GameId } from '../games';

const CONFIG_KEY = 'overseer-console:drive';
const LINK_KEY = 'overseer-console:drive:link';
const SYNCED_KEY = 'overseer-console:drive:synced';

export interface DriveConfig {
  /** Names the player's OAuth client: "1234-abc.apps.googleusercontent.com". Not a secret. */
  clientId: string;
  /**
   * Google calls it a secret, and asks for it with every token. A client of
   * the kind the console uses runs where nothing stays secret, and Google
   * treats it so: like the ID, it names the client.
   */
  clientSecret: string;
  /** Where the console looks for games, inside its own folder. '' is that folder itself. */
  gamesFolder: string;
  /** Where saves are kept, one zip per slot in a folder per game. */
  savesFolder: string;
}

export const DEFAULT_CONFIG: DriveConfig = { clientId: '', clientSecret: '', gamesFolder: '', savesFolder: '/Saves' };

export interface DriveLink {
  clientId: string;
  clientSecret: string;
  /** Long-lived: trades for access tokens until the player unlinks or Google ends it. */
  refreshToken: string;
  /** Short-lived: what the requests carry. */
  accessToken: string;
  /** When the access token stops working. */
  expiresAt: number;
  /** Whose Drive this is, to show on the console. */
  account: { name: string; email: string };
  linkedAt: number;
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Private windows may refuse storage.
    return false;
  }
}

export function loadConfig(): DriveConfig {
  const stored = read<Partial<DriveConfig>>(CONFIG_KEY) ?? {};
  const config = { ...DEFAULT_CONFIG };
  if (typeof stored.clientId === 'string') config.clientId = stored.clientId;
  if (typeof stored.clientSecret === 'string') config.clientSecret = stored.clientSecret;
  // Guard against values from a hand-edited entry.
  for (const key of ['gamesFolder', 'savesFolder'] as const) {
    try {
      if (typeof stored[key] === 'string') config[key] = normaliseFolder(stored[key]);
    } catch {
      // Keep the default.
    }
  }
  return config;
}

export function saveConfig(patch: Partial<DriveConfig>): DriveConfig {
  const config = { ...loadConfig(), ...patch };
  write(CONFIG_KEY, config);
  return config;
}

export function loadLink(): DriveLink | null {
  const link = read<DriveLink>(LINK_KEY);
  return link && typeof link.refreshToken === 'string' && typeof link.clientId === 'string' && link.account ? link : null;
}

/** False when the browser would not keep it: the link then lasts for this page only. */
export function storeLink(link: DriveLink): boolean {
  return write(LINK_KEY, link);
}

/** Forgets the tokens and what was synced with them. The client and folders stay. */
export function forgetLink(): void {
  write(LINK_KEY, null);
  write(SYNCED_KEY, null);
}

type SyncedByGame = Partial<Record<GameId, Record<string, SyncedSave>>>;

export function loadSynced(game: GameId): Record<string, SyncedSave> {
  return read<SyncedByGame>(SYNCED_KEY)?.[game] ?? {};
}

/** Records (or with null, forgets) the state a slot was last synced in. */
export function storeSynced(game: GameId, slot: number, synced: SyncedSave | null): void {
  const all = read<SyncedByGame>(SYNCED_KEY) ?? {};
  const slots = { ...all[game] };
  if (synced) slots[slot] = synced;
  else delete slots[slot];
  write(SYNCED_KEY, { ...all, [game]: slots });
}
