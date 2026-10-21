/**
 * What the console asks of the player's cloud, whichever it is: Dropbox or
 * Google Drive. Saves, games and mods are kept the same way in either, and
 * the code that keeps them (saves.ts, games.ts, put.ts) speaks only to this.
 *
 * The console has no app, client or server of its own in either. The player
 * makes one in their own account, and the link the console then holds
 * reaches the console's own files there and nothing else.
 */
import type { GameId } from '../games';
import type { VersionCause } from '../storage/history';

export type CloudId = 'dropbox' | 'drive';

export interface CloudFile {
  /** An address for reading it that survives renaming. */
  id: string;
  name: string;
  /** Inside the console's own folder, as the player spelled it: "/Saves/Fallout 2/SLOT01.zip". */
  path: string;
  size: number;
  /** Changes whenever the contents do. */
  rev: string;
  /** When the contents were written, as their uploader said. 0 when nobody did. */
  modified: number;
}

export interface UploadOptions {
  /**
   * The revision this upload replaces, or null when the file must not exist
   * yet. If the cloud holds something else by now the upload is refused (a
   * CloudError with `conflict`) instead of overwriting it.
   */
  replaces: string | null;
  /** When the contents were written. */
  modified: number;
}

export interface SendOptions {
  /** When the contents were written. */
  modified: number;
  /** Whether a file of that name already there is replaced. Otherwise it is a conflict. */
  replace: boolean;
  /** How many bytes have arrived so far. */
  onProgress?(sentBytes: number): void;
  signal?: AbortSignal;
}

/** A slot as it was when this browser and the cloud last held the same save. */
export interface SyncedSave {
  /** The cloud's revision of the zip. */
  rev: string;
  /** When the save in this browser was written. */
  savedAt: number;
}

export interface CloudLink {
  /** Whose cloud this is, to show on the console. */
  account: { name: string; email: string };
  linkedAt: number;
}

export interface Cloud {
  readonly id: CloudId;
  /** "Dropbox", "Google Drive". */
  readonly name: string;
  /** The console's own folder there, as a sentence names it: "the console's app folder". */
  readonly home: string;
  /** What a slot's history files a save fetched from here under. */
  readonly cause: VersionCause;

  /** The link this browser holds, if it holds one. */
  link(): CloudLink | null;
  /** Where games and saves are kept inside the console's folder. */
  folders(): { gamesFolder: string; savesFolder: string };

  /**
   * The files in a folder, and with `recursive` in every folder below it.
   * Throws a CloudError with `notFound` when there is no such folder.
   */
  listFiles(folder: string, recursive?: boolean): Promise<CloudFile[]>;
  /** Reads a file (by its id), or the bytes [start, end) of it. */
  download(file: string, range?: { start: number; end: number }): Promise<ArrayBuffer>;
  /** Writes a small file, creating the folders above it. */
  upload(path: string, data: Uint8Array, options: UploadOptions): Promise<CloudFile>;
  /** Deletes a file, provided it is still at the given revision (else a 409). The cloud keeps it recoverable a while. */
  remove(path: string, rev: string): Promise<void>;
  /** Writes a file of any size in pieces, read from `data` as they go. */
  send(path: string, data: Blob, options: SendOptions): Promise<CloudFile>;
  /**
   * Has the cloud itself download a file from the web into `path`, where it
   * can (Dropbox can; Google Drive cannot). The file may land under another
   * name when `path` is taken: the answer says where.
   */
  saveUrl?(path: string, url: string, signal?: AbortSignal): Promise<CloudFile>;
  /** How much room the account has and uses, when the cloud says. */
  space(): Promise<{ used: number; total: number } | null>;

  loadSynced(game: GameId): Record<string, SyncedSave>;
  /** Records (or with null, forgets) the state a slot was last synced in. */
  storeSynced(game: GameId, slot: number, synced: SyncedSave | null): void;
}
