/**
 * The calls the console makes to Google Drive, straight from the browser.
 *
 * Drive knows files by id, not by path: tree.ts turns the paths the rest of
 * the console speaks of into ids. Every file seen here is one the console
 * made itself. With the drive.file scope Drive lists nothing else, and what
 * the player puts in the Drive in other ways stays out of sight.
 */
import { CloudError } from '../cloud/errors';
import { validToken } from './auth';

const API_URL = 'https://www.googleapis.com/drive/v3/';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/';

export const FOLDER_TYPE = 'application/vnd.google-apps.folder';

/** What the console reads of a file. */
const FIELDS = 'id,name,mimeType,parents,size,modifiedTime,createdTime,headRevisionId,appProperties';

/** As for Dropbox: what the player waits on gives up soon, a piece of a large file much later. */
const ATTEMPTS = 3;
const PATIENT_ATTEMPTS = 6;

/** Files up to this size go up in one request, description and contents together. */
const ONE_REQUEST_BYTES = 5 << 20;
/** Larger ones go in pieces of this size: Drive wants a multiple of 256 KB. */
const PIECE_BYTES = 8 << 20;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  /** Drive writes numbers this large as strings. Folders have none. */
  size?: string;
  /** "2026-10-12T08:49:10.250Z". */
  modifiedTime?: string;
  createdTime?: string;
  /** Changes whenever the contents do. Files only. */
  headRevisionId?: string;
  /** What the console noted on the file. Only the player's own client sees these. */
  appProperties?: Record<string, string>;
}

export class DriveError extends CloudError {
  override name = 'DriveError';
}

/** Drive keeps times to the millisecond. */
export function toDriveTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function fromDriveTime(text: string | undefined): number {
  const time = Date.parse(text ?? '');
  return Number.isFinite(time) ? time : 0;
}

/** A name as a Drive query writes it. */
export function quoted(name: string): string {
  return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Google's advice: twice as long each time, give or take up to a second, never more than half a minute. */
function backoff(attempt: number): number {
  return Math.min(400 * 2 ** (attempt - 1) + Math.random() * 1000, 30_000);
}

function stopped(): DOMException {
  return new DOMException('stopped', 'AbortError');
}

interface GoogleError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: { reason?: string; message?: string }[];
    details?: { reason?: string }[];
  };
}

/** Turns Google's refusal into what the player is told. */
export async function failure(response: Response): Promise<DriveError> {
  const body = (await response.json().catch(() => null)) as GoogleError | null;
  const said = body?.error?.message ?? '';
  const reasons = [...(body?.error?.errors ?? []).map((error) => error.reason), ...(body?.error?.details ?? []).map((detail) => detail.reason), body?.error?.status];
  const reason = reasons.find((word): word is string => !!word) ?? '';
  const has = (...words: string[]) => reasons.some((word) => word && words.includes(word));
  const { status } = response;
  if (status === 404) return new DriveError(`Google Drive does not have that file (${said || 'not found'}).`, 404, reason || 'notFound');
  if (status === 401) return new DriveError('Google no longer accepts this link. Link the console again in Terminal settings.', 401, reason);
  if (has('accessNotConfigured', 'SERVICE_DISABLED') || /has not been used in project|is disabled/.test(said)) {
    return new DriveError(
      'The Google Drive API is not switched on in your Google Cloud project. Enable it there (APIs & Services, Library, Google Drive API), wait a minute, and try again.',
      status,
      'accessNotConfigured',
    );
  }
  if (has('storageQuotaExceeded', 'quotaExceeded')) {
    return new DriveError('Your Google Drive is full. Its room is shared with your Gmail and Google Photos.', status, reason);
  }
  if (has('insufficientPermissions', 'insufficientScopes', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return new DriveError(
      'The link does not let the console use its files in your Google Drive. Link the console again in Terminal settings, and leave the box for Drive ticked.',
      status,
      reason,
    );
  }
  if (status === 429 || has('userRateLimitExceeded', 'rateLimitExceeded')) return new DriveError('Google Drive is busy. Try again in a minute.', status, reason);
  return new DriveError(`Google Drive refused the request (${said || reason || `HTTP ${status}`}).`, status, reason);
}

/** Refusals that pass if asked again a little later. */
function passing(error: DriveError): boolean {
  return error.status === 429 || error.status >= 500 || error.summary === 'userRateLimitExceeded' || error.summary === 'rateLimitExceeded';
}

/**
 * Sends a request with a working token. Renews the token once when Google
 * says it ran out, waits and asks again when Drive is busy or has a fault
 * of its own, and tries again after network faults; anything else is
 * thrown as a DriveError.
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
      if (attempt >= attempts) throw new DriveError('Could not reach Google Drive. Check the connection and try again.', 0);
      await pause(backoff(attempt));
      continue;
    }
    if (response.ok) return response;
    if (response.status === 401 && !renewed) {
      renewed = true;
      await validToken(true);
      attempt--;
      continue;
    }
    const error = await failure(response);
    if (passing(error) && attempt < attempts) {
      await pause(backoff(attempt));
      continue;
    }
    throw error;
  }
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await send(url, (token) => ({
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=UTF-8' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return (await response.json()) as T;
}

/** Every file and folder a query finds, page by page. */
export async function query(q: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', spaces: 'drive' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await call<{ files?: DriveFile[]; nextPageToken?: string }>(`${API_URL}files?${params}`);
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

/** Makes a folder: in `parent`, or with null at the top of My Drive. */
export function createFolder(name: string, parent: string | null, appProperties?: Record<string, string>): Promise<DriveFile> {
  return call<DriveFile>(`${API_URL}files?fields=${FIELDS}`, 'POST', {
    name,
    mimeType: FOLDER_TYPE,
    ...(parent ? { parents: [parent] } : {}),
    ...(appProperties ? { appProperties } : {}),
  });
}

/** Puts a file in Drive's trash, where it stays for 30 days. */
export async function trash(id: string): Promise<void> {
  await call(`${API_URL}files/${id}?fields=id`, 'PATCH', { trashed: true });
}

/** Deletes a file outright: what the trash would keep for 30 days counts against the room in the Drive. */
export async function deleteForever(id: string): Promise<void> {
  await send(`${API_URL}files/${id}`, (token) => ({ method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }));
}

/**
 * Reads a file, or the bytes [start, end) of it. A file Google takes for
 * something harmful (a mod's installer can look like one) is read anyway:
 * the console made it, from the player's own files.
 */
export async function download(id: string, range?: { start: number; end: number }): Promise<ArrayBuffer> {
  const read = (acknowledge: boolean) =>
    send(
      `${API_URL}files/${id}?alt=media${acknowledge ? '&acknowledgeAbuse=true' : ''}`,
      (token) => ({ headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: `bytes=${range.start}-${range.end - 1}` } : {}) } }),
      // Pieces are how games are copied; whole files are small.
      range ? PATIENT_ATTEMPTS : ATTEMPTS,
    );
  let response: Response;
  try {
    response = await read(false);
  } catch (err) {
    if (!(err instanceof DriveError && err.summary === 'cannotDownloadAbusiveFile')) throw err;
    response = await read(true);
  }
  const data = await response.arrayBuffer();
  if (!range) return data;
  const length = range.end - range.start;
  // 200 instead of 206: the range was ignored and this is the whole file.
  if (response.status === 200 && data.byteLength >= range.end) return data.slice(range.start, range.end);
  if (data.byteLength !== length) throw new DriveError(`Google Drive sent ${data.byteLength} of the ${length} bytes asked for.`, response.status);
  return data;
}

/** A new file, or new contents for one that is there. */
export type Target = { name: string; parent: string } | { id: string };

function described(target: Target, modified: number, appProperties: Record<string, string>): Record<string, unknown> {
  const times = { modifiedTime: toDriveTime(modified), appProperties };
  return 'id' in target ? times : { name: target.name, parents: [target.parent], ...times };
}

function boundary(): string {
  return `overseer-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Writes a small file: its description and its contents in one request. */
export async function write(target: Target, data: Blob, modified: number, appProperties: Record<string, string> = {}): Promise<DriveFile> {
  if (data.size > ONE_REQUEST_BYTES) return sendInPieces(target, data, { modified, appProperties });
  const mark = boundary();
  // Read into memory (it is small): a body of bytes goes the same way in every browser.
  const body = await new Blob([
    `--${mark}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(described(target, modified, appProperties))}\r\n`,
    `--${mark}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    data,
    `\r\n--${mark}--`,
  ]).arrayBuffer();
  const url = 'id' in target ? `${UPLOAD_URL}files/${target.id}?uploadType=multipart&fields=${FIELDS}` : `${UPLOAD_URL}files?uploadType=multipart&fields=${FIELDS}`;
  const response = await send(url, (token) => ({
    method: 'id' in target ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${mark}` },
    body,
  }));
  return (await response.json()) as DriveFile;
}

export interface PieceOptions {
  modified: number;
  appProperties?: Record<string, string>;
  /** How many bytes Drive holds so far. */
  onProgress?(sentBytes: number): void;
  signal?: AbortSignal;
}

/**
 * One piece of a resumable upload, sent to the address Drive gave for it.
 * When the line drops, or Drive has a fault of its own, Drive is asked how
 * much it holds instead: the answer says where to go on from.
 */
async function sendPiece(session: string, data: Blob, start: number, signal?: AbortSignal): Promise<Response> {
  // One piece in memory at a time, as bytes: a body of bytes goes the same way in every browser.
  const piece = await data.slice(start, Math.min(data.size, start + PIECE_BYTES)).arrayBuffer();
  let range = piece.byteLength ? `bytes ${start}-${start + piece.byteLength - 1}/${data.size}` : `bytes */${data.size}`;
  let body: ArrayBuffer | null = piece;
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw stopped();
    let response: Response | null = null;
    try {
      response = await fetch(session, { method: 'PUT', headers: { 'Content-Range': range }, body, signal });
    } catch {
      if (signal?.aborted) throw stopped();
    }
    // 308: Drive holds part of the file and wants the rest. 200 or 201: all of it.
    if (response && (response.ok || response.status === 308)) return response;
    if (response?.status === 404 || response?.status === 410) {
      throw new DriveError('Google Drive gave up waiting for the rest of the file. Try again.', response.status);
    }
    if (response && response.status < 500 && response.status !== 429) throw await failure(response);
    if (attempt >= PATIENT_ATTEMPTS) throw new DriveError('Could not reach Google Drive. Check the connection and try again.', 0);
    await pause(backoff(attempt));
    // From now on only asking what arrived: the answer is a 308 that says.
    range = `bytes */${data.size}`;
    body = null;
  }
}

/**
 * Writes a file of any size, a piece at a time. Nothing appears in the
 * Drive until the last piece is in. A piece lost on the way is sent again
 * from where Drive says it stopped.
 */
export async function sendInPieces(target: Target, data: Blob, options: PieceOptions): Promise<DriveFile> {
  const { signal } = options;
  const url = 'id' in target ? `${UPLOAD_URL}files/${target.id}?uploadType=resumable&fields=${FIELDS}` : `${UPLOAD_URL}files?uploadType=resumable&fields=${FIELDS}`;
  const opened = await send(
    url,
    (token) => ({
      method: 'id' in target ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(data.size),
      },
      body: JSON.stringify(described(target, options.modified, options.appProperties ?? {})),
    }),
    PATIENT_ATTEMPTS,
    signal,
  );
  const session = opened.headers.get('Location');
  if (!session) throw new DriveError('Google Drive did not say where to send the file. Try again.', opened.status);

  let held = 0;
  let still = 0;
  for (;;) {
    const response = await sendPiece(session, data, held, signal);
    if (response.ok) {
      options.onProgress?.(data.size);
      return (await response.json()) as DriveFile;
    }
    // "bytes=0-1048575": what Drive holds. No Range at all: nothing yet.
    const last = /bytes=0-(\d+)/.exec(response.headers.get('Range') ?? '');
    const now = last ? Number(last[1]) + 1 : 0;
    // A Drive that takes the pieces and never holds more is not waited on for ever.
    still = now > held ? 0 : still + 1;
    if (still >= PATIENT_ATTEMPTS) throw new DriveError('Google Drive stopped taking the file. Try again.', 308);
    held = now;
    options.onProgress?.(held);
  }
}

/** How much room the account has, and uses, across Drive, Gmail and Photos. */
export async function storage(): Promise<{ used: number; total: number } | null> {
  const about = await call<{ storageQuota?: { limit?: string; usage?: string } }>(`${API_URL}about?fields=storageQuota(limit%2Cusage)`);
  const total = Number(about.storageQuota?.limit);
  const used = Number(about.storageQuota?.usage);
  // Some accounts have no limit, and say none.
  return total > 0 && Number.isFinite(used) ? { used, total } : null;
}
