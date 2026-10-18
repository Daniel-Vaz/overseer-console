/**
 * The few calls the console makes to Dropbox, straight from the browser.
 *
 * Every path here is inside the app folder: with "App folder" access Dropbox
 * treats that folder as the root, and '' names it.
 */
import { CloudError } from '../cloud/errors';
import type { SendOptions, UploadOptions } from '../cloud/provider';
import { validToken } from './auth';

export type { UploadOptions } from '../cloud/provider';

const API_URL = 'https://api.dropboxapi.com/2/';
const CONTENT_URL = 'https://content.dropboxapi.com/2/';

/**
 * How often a request is tried before a network fault is reported. What the
 * player is waiting on gives up within a second or two. A piece of a game
 * being copied keeps trying for a quarter of a minute: giving up there means
 * starting hundreds of megabytes over.
 */
const ATTEMPTS = 3;
const PATIENT_ATTEMPTS = 6;

/** What a large file is sent in. Dropbox takes up to 150 MB a request. */
const SEND_PIECE = 8 << 20;

export class DropboxError extends CloudError {
  override name = 'DropboxError';

  constructor(
    message: string,
    status: number,
    /** Dropbox's own word for what went wrong: "path/not_found/" and the like. */
    summary = '',
    /** The error itself, as Dropbox described it. */
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message, status, summary);
  }

  /** The file or folder is not there. */
  override get notFound(): boolean {
    return /(^|\/)not_found(\/|$)/.test(this.summary);
  }

  /** The file changed in Dropbox since it was last looked at. */
  override get conflict(): boolean {
    return /(^|\/)conflict(\/|$)/.test(this.summary);
  }
}

export interface DropboxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  /** Stable for as long as the file exists, whatever it is renamed to. */
  id?: string;
  path_lower?: string;
  /** The path as the player spelled it. */
  path_display?: string;
  size?: number;
  rev?: string;
  /** When the file was last changed, as its uploader said: "2026-10-12T08:49:10Z". */
  client_modified?: string;
}

export interface DropboxFile extends DropboxEntry {
  '.tag': 'file';
  path_lower: string;
  path_display: string;
  size: number;
  rev: string;
  client_modified: string;
}

function isFile(entry: DropboxEntry): entry is DropboxFile {
  return entry['.tag'] === 'file' && typeof entry.path_display === 'string' && typeof entry.size === 'number';
}

/** Dropbox keeps times to the second. */
export function toDropboxTime(timestamp: number): string {
  return `${new Date(timestamp).toISOString().slice(0, 19)}Z`;
}

export function fromDropboxTime(text: string | undefined): number {
  const time = Date.parse(text ?? '');
  return Number.isFinite(time) ? time : 0;
}

/** JSON for a request header: anything outside plain ASCII is escaped. */
export function headerJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function failure(response: Response): Promise<DropboxError> {
  const text = await response.text().catch(() => '');
  let summary = '';
  let detail: { '.tag'?: string; required_scope?: string } & Record<string, unknown> = {};
  try {
    const body = JSON.parse(text) as { error_summary?: string; error?: typeof detail };
    summary = body.error_summary ?? '';
    detail = body.error ?? {};
  } catch {
    // Faults in the request itself come back as plain text.
    summary = text.slice(0, 200);
  }
  if (detail['.tag'] === 'missing_scope') {
    return new DropboxError(
      `The Dropbox app does not allow ${detail.required_scope ?? 'this'}. Tick it on the app's Permissions tab, press Submit, then link the console again.`,
      response.status,
      summary,
      detail,
    );
  }
  if (response.status === 401) return new DropboxError('Dropbox no longer accepts this link. Link the console again in Terminal settings.', 401, summary, detail);
  if (response.status === 429) return new DropboxError('Dropbox is busy. Try again in a minute.', 429, summary, detail);
  if (summary.includes('insufficient_space')) return new DropboxError('Your Dropbox is full.', response.status, summary, detail);
  return new DropboxError(`Dropbox refused the request (${summary || `HTTP ${response.status}`}).`, response.status, summary, detail);
}

function stopped(): DOMException {
  return new DOMException('stopped', 'AbortError');
}

/**
 * How many seconds Dropbox asks to be left alone for. The header that says
 * so is hidden from pages of other sites; the answer itself repeats it.
 */
async function askedPause(response: Response): Promise<number> {
  const header = Number(response.headers.get('Retry-After'));
  if (header > 0) return header;
  const body = (await response.clone().json().catch(() => null)) as { error?: { retry_after?: number } } | null;
  return Number(body?.error?.retry_after) || 0;
}

/**
 * Sends a request with a working token. Renews the token once when Dropbox
 * says it ran out, waits when asked to slow down, and tries again after
 * network faults; anything else is thrown as a DropboxError.
 */
async function send(url: string, init: (token: string) => RequestInit, attempts = ATTEMPTS, signal?: AbortSignal): Promise<Response> {
  let renewed = false;
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw stopped();
    const token = await validToken();
    let response: Response;
    try {
      response = await fetch(url, { ...init(token), signal });
    } catch {
      if (signal?.aborted) throw stopped();
      if (attempt >= attempts) throw new DropboxError('Could not reach Dropbox. Check the connection and try again.', 0);
      await pause(400 * 2 ** (attempt - 1));
      continue;
    }
    if (response.ok) return response;

    if (response.status === 401 && !renewed) {
      const error = await failure(response);
      if (!/^(expired|invalid)_access_token/.test(error.summary)) throw error;
      renewed = true;
      await validToken(true);
      attempt--;
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
      const asked = await askedPause(response);
      await pause(asked > 0 ? Math.min(asked, 30) * 1000 : 400 * 2 ** (attempt - 1));
      continue;
    }
    throw await failure(response);
  }
}

async function rpc<T>(route: string, args: unknown): Promise<T> {
  const response = await send(`${API_URL}${route}`, (token) => ({
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }));
  return (await response.json()) as T;
}

interface FolderPage {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
}

/** The files in a folder, and with `recursive` in every folder below it. */
export async function listFiles(folder: string, recursive = false): Promise<DropboxFile[]> {
  let page = await rpc<FolderPage>('files/list_folder', { path: folder, recursive, limit: 2000, include_non_downloadable_files: false });
  const files = page.entries.filter(isFile);
  while (page.has_more) {
    page = await rpc<FolderPage>('files/list_folder/continue', { cursor: page.cursor });
    files.push(...page.entries.filter(isFile));
  }
  return files;
}

/**
 * Reads a file, or the bytes [start, end) of it. `file` is a path or an id.
 */
export async function download(file: string, range?: { start: number; end: number }): Promise<ArrayBuffer> {
  const response = await send(
    `${CONTENT_URL}files/download`,
    (token) => ({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': headerJson({ path: file }),
        ...(range ? { Range: `bytes=${range.start}-${range.end - 1}` } : {}),
      },
    }),
    // Pieces are how games are copied; whole files are small.
    range ? PATIENT_ATTEMPTS : ATTEMPTS,
  );
  const data = await response.arrayBuffer();
  if (!range) return data;
  const length = range.end - range.start;
  // 200 instead of 206: the range was ignored and this is the whole file.
  if (response.status === 200 && data.byteLength >= range.end) return data.slice(range.start, range.end);
  if (data.byteLength !== length) throw new DropboxError(`Dropbox sent ${data.byteLength} of the ${length} bytes asked for.`, response.status);
  return data;
}

/** Writes a file of up to 150 MB, creating the folders above it. */
export async function upload(path: string, data: Uint8Array, options: UploadOptions): Promise<DropboxFile> {
  const arg = {
    path,
    mode: options.replaces === null ? 'add' : { '.tag': 'update', update: options.replaces },
    autorename: false,
    mute: true,
    client_modified: toDropboxTime(options.modified),
  };
  const response = await send(`${CONTENT_URL}files/upload`, (token) => ({
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson(arg) },
    body: data as Uint8Array<ArrayBuffer>,
  }));
  return (await response.json()) as DropboxFile;
}

/**
 * Deletes a file, provided it is still at the given revision. Dropbox keeps
 * deleted files recoverable for a while.
 */
export async function remove(path: string, rev: string): Promise<void> {
  await rpc('files/delete_v2', { path, parent_rev: rev });
}

/**
 * Writes a file of any size, a piece at a time: an upload session, which
 * Dropbox puts together into the file only once the last piece is in. A
 * piece whose answer was lost on the way is not sent twice: Dropbox says
 * where it is at, and the next piece starts there.
 */
export async function sendLarge(path: string, data: Blob, options: SendOptions): Promise<DropboxFile> {
  const { signal } = options;
  // One piece in memory at a time, as bytes: a body of bytes goes the same way in every browser.
  const piece = (at: number) => data.slice(at, Math.min(data.size, at + SEND_PIECE)).arrayBuffer();
  const contentCall = (route: string, arg: unknown, body: ArrayBuffer) =>
    send(
      `${CONTENT_URL}${route}`,
      (token) => ({
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson(arg) },
        body,
      }),
      PATIENT_ATTEMPTS,
      signal,
    );

  const first = await piece(0);
  const started = (await (await contentCall('files/upload_session/start', { close: false }, first)).json()) as { session_id: string };
  let offset = first.byteLength;
  options.onProgress?.(offset);
  while (offset < data.size) {
    const next = await piece(offset);
    try {
      await contentCall('files/upload_session/append_v2', { cursor: { session_id: started.session_id, offset }, close: false }, next);
      offset += next.byteLength;
    } catch (err) {
      const correct = err instanceof DropboxError ? Number((err.detail as { correct_offset?: number }).correct_offset) : NaN;
      if (!(err instanceof DropboxError && /incorrect_offset/.test(err.summary) && Number.isFinite(correct))) throw err;
      offset = correct;
    }
    options.onProgress?.(offset);
  }
  const commit = {
    path,
    mode: options.replace ? 'overwrite' : 'add',
    autorename: false,
    mute: true,
    client_modified: toDropboxTime(options.modified),
  };
  const finished = await contentCall('files/upload_session/finish', { cursor: { session_id: started.session_id, offset }, commit }, new ArrayBuffer(0));
  return (await finished.json()) as DropboxFile;
}

/** How much room the Dropbox has, and how much of it is used. */
export async function spaceUsage(): Promise<{ used: number; total: number } | null> {
  const usage = await rpc<{ used?: number; allocation?: { allocated?: number } }>('users/get_space_usage', null);
  const total = Number(usage.allocation?.allocated);
  return Number.isFinite(usage.used) && total > 0 ? { used: usage.used!, total } : null;
}
