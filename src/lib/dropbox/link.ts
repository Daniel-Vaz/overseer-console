/**
 * The link to a player's own Dropbox: what this browser remembers about it.
 *
 * The console has no server and no Dropbox app of its own. Each player
 * creates an app with "App folder" access in their Dropbox account and gives
 * the console its app key. The token the console then holds reaches that one
 * folder (Apps/<app name>) of that one account and nothing else, and it never
 * leaves this browser.
 */
import { normaliseFolder } from '../cloud/folders';
import type { SyncedSave } from '../cloud/provider';
import type { GameId } from '../games';

export { normaliseFolder, showFolder } from '../cloud/folders';
export type { SyncedSave } from '../cloud/provider';

const CONFIG_KEY = 'overseer-console:dropbox';
const LINK_KEY = 'overseer-console:dropbox:link';
const SYNCED_KEY = 'overseer-console:dropbox:synced';

export interface DropboxConfig {
  /** Public identifier of the player's Dropbox app. Not a secret. */
  appKey: string;
  /**
   * Where the console looks for game folders, inside the app folder.
   * '' is the app folder itself. Everything below it is searched.
   */
  gamesFolder: string;
  /** Where saves are kept, one zip per slot in a folder per game. */
  savesFolder: string;
}

export const DEFAULT_CONFIG: DropboxConfig = { appKey: '', gamesFolder: '', savesFolder: '/Saves' };

export interface DropboxLink {
  appKey: string;
  /** Long-lived: trades for access tokens until the player unlinks. */
  refreshToken: string;
  /** Short-lived: what the requests carry. */
  accessToken: string;
  /** When the access token stops working. */
  expiresAt: number;
  /** Whose Dropbox this is, to show on the console. */
  account: { id: string; name: string; email: string };
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

export function loadConfig(): DropboxConfig {
  const stored = read<Partial<DropboxConfig>>(CONFIG_KEY) ?? {};
  const config = { ...DEFAULT_CONFIG };
  if (typeof stored.appKey === 'string') config.appKey = stored.appKey;
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

export function saveConfig(patch: Partial<DropboxConfig>): DropboxConfig {
  const config = { ...loadConfig(), ...patch };
  write(CONFIG_KEY, config);
  return config;
}

export function loadLink(): DropboxLink | null {
  const link = read<DropboxLink>(LINK_KEY);
  return link && typeof link.refreshToken === 'string' && typeof link.appKey === 'string' && link.account ? link : null;
}

/** False when the browser would not keep it: the link then lasts for this page only. */
export function storeLink(link: DropboxLink): boolean {
  return write(LINK_KEY, link);
}

/** Forgets the tokens and what was synced with them. The app key and folders stay. */
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
