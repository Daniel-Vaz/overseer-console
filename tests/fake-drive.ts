/**
 * A stand-in for Google, for tests: the sign-in of the device flow, and the
 * part of the Drive API the console calls, answering as the real ones do as
 * far as the console can tell.
 *
 * The unit tests put it behind `fetch`; the browser tests put it behind
 * Google's hosts. Its files live in memory. Drive's rule for the drive.file
 * scope is kept: the console sees only what it made. `putByPlayer` adds a
 * file as Google's own app or website would, out of the console's sight.
 */
import type { FakeRequest, FakeResponse } from './fake-dropbox';

export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';
const SESSION_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=';

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  data: Uint8Array;
  modifiedTime: string;
  createdTime: string;
  headRevisionId: string;
  appProperties: Record<string, string>;
  trashed: boolean;
  /** Made by the console, or chosen for it: the only files the console's token reaches. */
  visible: boolean;
}

interface Session {
  /** A new file's description, or the id of the file it gives new contents. */
  create: Record<string, unknown> | null;
  update: string | null;
  metadata: Record<string, unknown>;
  total: number;
  received: Uint8Array[];
  bytes: number;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Location, Range, Content-Range, X-GUploader-UploadID',
};

function json(status: number, value: unknown, headers: Record<string, string> = {}): FakeResponse {
  return { status, headers: { ...CORS, 'content-type': 'application/json; charset=UTF-8', ...headers }, body: JSON.stringify(value) };
}

/** An error as Google's APIs send one. */
function googleError(code: number, message: string, reason: string, status: string, details: string[] = []): FakeResponse {
  return json(code, {
    error: { code, message, errors: [{ message, domain: 'global', reason }], status, ...(details.length ? { details: details.map((detail) => ({ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: detail })) } : {}) },
  });
}

/** The fields a request asks for: "id,name,files(id,name)" read as what lies at the top and inside each pair of brackets. */
function wantedFields(text: string | null): { top: Set<string>; inner: Map<string, Set<string>> } {
  const top = new Set<string>();
  const inner = new Map<string, Set<string>>();
  if (!text) return { top, inner };
  let depth = 0;
  let word = '';
  let group = '';
  for (const char of `${text},`) {
    if (char === '(') {
      group = word.trim();
      inner.set(group, new Set());
      word = '';
      depth++;
    } else if (char === ')') {
      if (word.trim()) inner.get(group)!.add(word.trim());
      top.add(group);
      word = '';
      depth--;
    } else if (char === ',' && depth === 0) {
      if (word.trim()) top.add(word.trim());
      word = '';
    } else if (char === ',') {
      if (word.trim()) inner.get(group)!.add(word.trim());
      word = '';
    } else {
      word += char;
    }
  }
  return { top, inner };
}

function pick(value: Record<string, unknown>, fields: Set<string> | undefined): Record<string, unknown> {
  // Without fields, Drive answers with a few of them.
  const keep = fields?.size ? fields : new Set(['kind', 'id', 'name', 'mimeType']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => keep.has(key)));
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** The parts of a multipart/related body: each one's headers and its bytes. */
function multipart(body: Uint8Array, boundary: string): { type: string; data: Uint8Array }[] {
  const mark = new TextEncoder().encode(`--${boundary}`);
  const parts: { type: string; data: Uint8Array }[] = [];
  let at = indexOf(body, mark);
  while (at >= 0) {
    const start = at + mark.length;
    if (body[start] === 45 && body[start + 1] === 45) break;
    const next = indexOf(body, mark, start);
    if (next < 0) break;
    const part = body.subarray(start + 2, next - 2);
    const split = indexOf(part, new TextEncoder().encode('\r\n\r\n'));
    const head = new TextDecoder().decode(part.subarray(0, split));
    parts.push({ type: /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1] ?? '', data: part.slice(split + 4) });
    at = next;
  }
  return parts;
}

export class FakeDrive {
  /** The client the player made, and what kind it is: TVs and limited-input devices, or (by mistake) a web client. */
  // Made up, and put together from pieces so that secret scanners do not take them for a real client's.
  clientId = ['123456789012', 'abcdefghijklmnopqrstuvwxyz012345'].join('-') + ['.apps', 'googleusercontent', 'com'].join('.');
  clientSecret = ['GOC', 'SPX'].join('') + '-' + 'abcdefghijklmnopqrstuvwxyz12';
  clientType: 'tv' | 'web' = 'tv';
  account = { displayName: 'Chosen One', emailAddress: 'chosen@arroyo.example' };
  /** Whether the Google Drive API is switched on in the player's project. */
  apiEnabled = true;
  /** Whether the player leaves the box for Drive ticked on Google's page. */
  grantDrive = true;
  /** Entries per page of a listing. */
  pageSize = 1000;
  /** How many seconds Google wants between asks whether a code was entered. */
  interval = 5;
  /** Room in the account, across Drive, Gmail and Photos. */
  limit = 15 * 2 ** 30;
  /** What Gmail and Photos take of it. */
  elsewhere = 0;
  /** Files Google takes for something harmful, by id: read only with acknowledgeAbuse. */
  readonly flagged = new Set<string>();

  /** By id. */
  readonly items = new Map<string, DriveItem>();
  /** Every call made, in order: "files.list", "files.get:media", "upload:resumable", "token:device_code"... */
  readonly calls: string[] = [];

  private readonly codes = new Map<string, { userCode: string; approved: boolean; denied: boolean; expiresAt: number }>();
  private readonly accessTokens = new Set<string>();
  private readonly spentTokens = new Set<string>();
  private readonly refreshTokens = new Set<string>();
  private readonly sessions = new Map<string, Session>();
  private counter = 0;
  private clock = Date.UTC(2026, 9, 1, 12, 0, 0);

  private next(prefix: string): string {
    return `${prefix}${String(++this.counter).padStart(6, '0')}`;
  }

  /** A time a little after the last one, so that what was made later is newer. */
  private tick(): string {
    this.clock = Math.max(this.clock + 1000, Date.now());
    return new Date(this.clock).toISOString();
  }

  // -------------------------------------------------------------------
  // What the player does at Google
  // -------------------------------------------------------------------

  /** The codes handed out, newest last. */
  get userCodes(): string[] {
    return [...this.codes.values()].map((code) => code.userCode);
  }

  /** The player entering a code at google.com/device and allowing the console. */
  approve(userCode = this.userCodes.at(-1) ?? ''): void {
    const code = [...this.codes.values()].find((entry) => entry.userCode === userCode);
    if (!code) throw new Error(`no such code: ${userCode}`);
    code.approved = true;
  }

  /** The player saying no. */
  deny(userCode = this.userCodes.at(-1) ?? ''): void {
    const code = [...this.codes.values()].find((entry) => entry.userCode === userCode);
    if (code) code.denied = true;
  }

  /** The codes run out, as they do after half an hour. */
  expireCodes(): void {
    for (const code of this.codes.values()) code.expiresAt = 0;
  }

  /** Every access token handed out so far stops working, as they do after an hour. */
  expireAccessTokens(): void {
    for (const token of this.accessTokens) this.spentTokens.add(token);
    this.accessTokens.clear();
  }

  /**
   * What Google does when the player removes the console's project from
   * their account, or the console ends its access: every token ends, and
   * the files it made are out of its sight.
   */
  disconnectApp(): void {
    this.expireAccessTokens();
    this.refreshTokens.clear();
    for (const item of this.items.values()) item.visible = false;
  }

  /** Whether any link made through this client is still alive. */
  get linked(): boolean {
    return this.refreshTokens.size > 0;
  }

  // -------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------

  /** The console's own folder: the one it marked. */
  get root(): DriveItem | undefined {
    return [...this.items.values()].find((item) => item.mimeType === FOLDER && item.appProperties.overseerConsole === 'root' && !item.trashed);
  }

  private add(fields: Partial<DriveItem> & { name: string }): DriveItem {
    const now = this.tick();
    const item: DriveItem = {
      id: this.next('drive-'),
      mimeType: 'application/octet-stream',
      parents: [],
      data: new Uint8Array(0),
      modifiedTime: now,
      createdTime: now,
      headRevisionId: this.next('rev-'),
      appProperties: {},
      trashed: false,
      visible: true,
      ...fields,
    };
    this.items.set(item.id, item);
    return item;
  }

  private folderIn(parent: string, name: string, visible: boolean): DriveItem {
    const found = [...this.items.values()].find((item) => item.mimeType === FOLDER && !item.trashed && item.parents.includes(parent) && item.name.toLowerCase() === name.toLowerCase());
    return found ?? this.add({ name, mimeType: FOLDER, parents: [parent], visible });
  }

  /** Puts a file below the console's folder, made as the player says: by the console (seen), or by the player (unseen). */
  private place(path: string, data: Uint8Array | string, modified: string | undefined, visible: boolean): DriveItem {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const root = this.root ?? this.add({ name: 'Overseer Console', mimeType: FOLDER, parents: ['my-drive'], appProperties: { overseerConsole: 'root' } });
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    let parent = root;
    for (const part of parts) parent = this.folderIn(parent.id, part, visible);
    const existing = [...this.items.values()].find((item) => !item.trashed && item.parents.includes(parent.id) && item.name === name && item.mimeType !== FOLDER);
    if (existing) {
      existing.data = bytes;
      existing.headRevisionId = this.next('rev-');
      existing.modifiedTime = modified ?? this.tick();
      return existing;
    }
    return this.add({ name, parents: [parent.id], data: bytes, visible, ...(modified ? { modifiedTime: modified } : {}) });
  }

  /** Puts a file in the console's folder as the console did, from this or another device. */
  put(path: string, data: Uint8Array | string, modified?: string): DriveItem {
    return this.place(path, data, modified, true);
  }

  /** Puts a file there as the player would with Google's own app or website: the console never sees it. */
  putByPlayer(path: string, data: Uint8Array | string): DriveItem {
    return this.place(path, data, undefined, false);
  }

  /** Where a file lies below the console's folder: "/Saves/Fallout 2/SLOT03.zip". Null for one elsewhere. */
  pathOf(item: DriveItem): string | null {
    const names: string[] = [];
    let current: DriveItem | undefined = item;
    for (let depth = 0; current && depth < 64; depth++) {
      if (current.mimeType === FOLDER && current.appProperties.overseerConsole === 'root') return `/${names.reverse().join('/')}`;
      names.push(current.name);
      current = this.items.get(current.parents[0] ?? '');
    }
    return null;
  }

  /** The file at a path below the console's folder, if it is not in the trash. */
  file(path: string): DriveItem | undefined {
    return [...this.items.values()].find((item) => !item.trashed && item.mimeType !== FOLDER && this.pathOf(item)?.toLowerCase() === path.toLowerCase());
  }

  /** The paths of the files below the console's folder, trash left out. */
  get paths(): string[] {
    return [...this.items.values()]
      .filter((item) => !item.trashed && item.mimeType !== FOLDER)
      .map((item) => this.pathOf(item))
      .filter((path): path is string => path !== null)
      .sort();
  }

  /** What the account uses: the files and the trash, and what Gmail and Photos take. */
  get usage(): number {
    let used = this.elsewhere;
    for (const item of this.items.values()) used += item.data.length;
    return used;
  }

  private resource(item: DriveItem): Record<string, unknown> {
    return {
      kind: 'drive#file',
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      parents: item.parents,
      ...(item.mimeType === FOLDER ? {} : { size: String(item.data.length), headRevisionId: item.headRevisionId }),
      modifiedTime: item.modifiedTime,
      createdTime: item.createdTime,
      appProperties: item.appProperties,
      trashed: item.trashed,
    };
  }

  // -------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------

  handle(request: FakeRequest): FakeResponse {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: { ...CORS, 'access-control-allow-methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT', 'access-control-allow-headers': 'authorization,content-type,content-range,range,x-upload-content-type,x-upload-content-length' },
        body: '',
      };
    }
    if (url.hostname === 'oauth2.googleapis.com') return this.oauth(url.pathname, new URLSearchParams(request.body ? new TextDecoder().decode(request.body) : ''));
    if (url.hostname === 'www.google.com' && url.pathname === '/device') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>Google</title><h1>Connect a device</h1><input id="code">' };
    }
    if (url.searchParams.has('upload_id')) return this.piece(url.searchParams.get('upload_id')!, request);

    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    if (!this.accessTokens.has(bearer)) {
      this.calls.push('unauthenticated');
      return googleError(401, 'Request had invalid authentication credentials. Expected OAuth 2 access token.', 'authError', 'UNAUTHENTICATED');
    }
    if (!this.apiEnabled) {
      this.calls.push('disabled');
      const project = this.clientId.split('-')[0];
      return googleError(
        403,
        `Google Drive API has not been used in project ${project} before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${project} then retry.`,
        'accessNotConfigured',
        'PERMISSION_DENIED',
        ['SERVICE_DISABLED'],
      );
    }

    const fields = wantedFields(url.searchParams.get('fields'));
    const path = url.pathname;
    if (path === '/drive/v3/about') {
      this.calls.push('about.get');
      const about = { user: this.account, storageQuota: { limit: String(this.limit), usage: String(this.usage) } };
      return json(200, Object.fromEntries([...fields.top].map((key) => [key, pick((about as Record<string, Record<string, unknown>>)[key] ?? {}, fields.inner.get(key))])));
    }
    if (path === '/drive/v3/files' && request.method === 'GET') return this.list(url, fields);
    if (path === '/drive/v3/files' && request.method === 'POST') return this.create(this.metadataOf(request.body), null, fields);

    const id = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)?.[1];
    if (id) {
      const item = this.items.get(id);
      if (!item || !item.visible) {
        this.calls.push(`files.${request.method.toLowerCase()}:missing`);
        return googleError(404, `File not found: ${id}.`, 'notFound', 'NOT_FOUND');
      }
      if (request.method === 'GET' && url.searchParams.get('alt') === 'media') return this.download(item, url, request.headers.range);
      if (request.method === 'GET') {
        this.calls.push('files.get');
        return json(200, pick(this.resource(item), fields.top));
      }
      if (request.method === 'PATCH') {
        this.calls.push('files.update');
        this.describe(item, this.metadataOf(request.body));
        return json(200, pick(this.resource(item), fields.top));
      }
      if (request.method === 'DELETE') {
        this.calls.push('files.delete');
        this.items.delete(item.id);
        return { status: 204, headers: CORS, body: '' };
      }
    }

    const upload = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(path);
    if (upload) {
      const target = upload[1] ? this.items.get(upload[1]) : null;
      if (upload[1] && (!target || !target.visible)) return googleError(404, `File not found: ${upload[1]}.`, 'notFound', 'NOT_FOUND');
      const type = url.searchParams.get('uploadType');
      if (type === 'multipart') return this.multipartUpload(request, target ?? null, fields);
      if (type === 'resumable') return this.openSession(request, target ?? null);
    }
    return googleError(400, `The fake does not know ${request.method} ${path}`, 'badRequest', 'INVALID_ARGUMENT');
  }

  private oauth(path: string, form: URLSearchParams): FakeResponse {
    const refused = (status: number, error: string, error_description?: string) => json(status, error_description ? { error, error_description } : { error });
    if (path === '/device/code') {
      this.calls.push('device/code');
      if (form.get('client_id') !== this.clientId) return refused(401, 'invalid_client', 'The OAuth client was not found.');
      if (this.clientType !== 'tv') return refused(401, 'invalid_client', 'Invalid client type.');
      const scopes = (form.get('scope') ?? '').split(' ');
      if (!scopes.includes(DRIVE_FILE)) return refused(400, 'invalid_scope', 'Some requested scopes cannot be shown');
      const device = this.next('device-');
      // Eight letters in two fours, as Google writes them: "GQVQ-JKEC".
      const letters = 'BCDFGHJKLMNPQRSTVWXZ';
      const drawn = Array.from({ length: 8 }, (_, index) => letters[(this.counter * 7 + index * 13) % letters.length]).join('');
      const userCode = `${drawn.slice(0, 4)}-${drawn.slice(4)}`;
      this.codes.set(device, { userCode, approved: false, denied: false, expiresAt: Date.now() + 1800_000 });
      return json(200, { device_code: device, user_code: userCode, expires_in: 1800, interval: this.interval, verification_url: 'https://www.google.com/device' });
    }
    if (path === '/revoke') {
      this.calls.push('revoke');
      const token = form.get('token') ?? '';
      if (!this.refreshTokens.has(token) && !this.accessTokens.has(token)) return refused(400, 'invalid_token', 'Token expired or revoked');
      this.disconnectApp();
      return json(200, {});
    }
    if (path !== '/token') return refused(404, 'not_found');

    const grant = form.get('grant_type') ?? '';
    this.calls.push(`token:${grant.replace(/^urn:ietf:params:oauth:grant-type:/, '')}`);
    if (form.get('client_id') !== this.clientId) return refused(401, 'invalid_client', 'The OAuth client was not found.');
    if (form.get('client_secret') !== this.clientSecret) return refused(401, 'invalid_client', 'Unauthorized');
    if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
      const code = this.codes.get(form.get('device_code') ?? '');
      if (!code) return refused(400, 'invalid_grant', 'Malformed auth code.');
      if (code.expiresAt <= Date.now()) return refused(400, 'expired_token');
      if (code.denied) return refused(403, 'access_denied', 'Forbidden');
      if (!code.approved) return refused(428, 'authorization_pending', 'Precondition Required');
      this.codes.delete(form.get('device_code')!);
      const refresh = this.next('1//refresh-');
      this.refreshTokens.add(refresh);
      return json(200, { ...this.access(), refresh_token: refresh });
    }
    if (grant === 'refresh_token') {
      if (!this.refreshTokens.has(form.get('refresh_token') ?? '')) return refused(400, 'invalid_grant', 'Token has been expired or revoked.');
      return json(200, this.access());
    }
    return refused(400, 'unsupported_grant_type', `Invalid grant_type: ${grant}`);
  }

  private access(): Record<string, unknown> {
    const token = this.next('ya29.access-');
    this.accessTokens.add(token);
    return { access_token: token, expires_in: 3599, scope: this.grantDrive ? DRIVE_FILE : '', token_type: 'Bearer' };
  }

  private metadataOf(body: Uint8Array | null): Record<string, unknown> {
    if (!body?.length) return {};
    return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  }

  /** What a description sets on a file: its name, place, times, notes, and the trash. */
  private describe(item: DriveItem, metadata: Record<string, unknown>): void {
    if (typeof metadata.name === 'string') item.name = metadata.name;
    if (Array.isArray(metadata.parents)) item.parents = metadata.parents.map((parent) => (parent === 'root' ? 'my-drive' : String(parent)));
    if (typeof metadata.modifiedTime === 'string') item.modifiedTime = metadata.modifiedTime;
    if (metadata.appProperties && typeof metadata.appProperties === 'object') item.appProperties = { ...item.appProperties, ...(metadata.appProperties as Record<string, string>) };
    if (typeof metadata.trashed === 'boolean') item.trashed = metadata.trashed;
  }

  private create(metadata: Record<string, unknown>, data: Uint8Array | null, fields: { top: Set<string> }): FakeResponse {
    this.calls.push(data ? 'files.create:media' : 'files.create');
    if (data && this.usage + data.length > this.limit) {
      return googleError(403, 'The user does not have sufficient storage quota for this request.', 'storageQuotaExceeded', 'PERMISSION_DENIED');
    }
    const parents = Array.isArray(metadata.parents) && metadata.parents.length ? metadata.parents.map(String) : ['my-drive'];
    for (const parent of parents) {
      const folder = this.items.get(parent);
      if (parent !== 'my-drive' && (!folder || !folder.visible)) return googleError(404, `File not found: ${parent}.`, 'notFound', 'NOT_FOUND');
    }
    const item = this.add({ name: String(metadata.name ?? 'Untitled'), mimeType: String(metadata.mimeType ?? 'application/octet-stream'), parents, data: data ?? new Uint8Array(0) });
    this.describe(item, { ...metadata, parents });
    return json(200, pick(this.resource(item), fields.top));
  }

  private write(item: DriveItem, data: Uint8Array, metadata: Record<string, unknown>): FakeResponse | null {
    if (this.usage - item.data.length + data.length > this.limit) {
      return googleError(403, 'The user does not have sufficient storage quota for this request.', 'storageQuotaExceeded', 'PERMISSION_DENIED');
    }
    item.data = data;
    item.headRevisionId = this.next('rev-');
    item.modifiedTime = this.tick();
    this.describe(item, metadata);
    return null;
  }

  private multipartUpload(request: FakeRequest, target: DriveItem | null, fields: { top: Set<string> }): FakeResponse {
    const boundary = /boundary=([^;]+)/.exec(request.headers['content-type'] ?? '')?.[1] ?? '';
    const [meta, media] = multipart(request.body ?? new Uint8Array(0), boundary);
    if (!meta || !media) return googleError(400, 'Multipart body is not valid', 'badContent', 'INVALID_ARGUMENT');
    const metadata = JSON.parse(new TextDecoder().decode(meta.data)) as Record<string, unknown>;
    if (!target) {
      const made = this.create(metadata, media.data, fields);
      this.calls[this.calls.length - 1] = 'upload:multipart';
      return made;
    }
    this.calls.push('upload:multipart');
    return this.write(target, media.data, metadata) ?? json(200, pick(this.resource(target), fields.top));
  }

  private openSession(request: FakeRequest, target: DriveItem | null): FakeResponse {
    this.calls.push('upload:resumable');
    const metadata = this.metadataOf(request.body);
    const total = Number(request.headers['x-upload-content-length'] ?? NaN);
    const id = this.next('session-');
    this.sessions.set(id, { create: target ? null : metadata, update: target?.id ?? null, metadata, total, received: [], bytes: 0 });
    return { status: 200, headers: { ...CORS, location: `${SESSION_URL}${id}`, 'x-guploader-uploadid': id }, body: '' };
  }

  /** One piece of a resumable upload, or a question about how much has arrived. */
  private piece(id: string, request: FakeRequest): FakeResponse {
    const session = this.sessions.get(id);
    if (!session) return { status: 404, headers: CORS, body: 'Not Found' };
    this.calls.push('upload:piece');
    const held = () =>
      session.bytes
        ? { status: 308, headers: { ...CORS, range: `bytes=0-${session.bytes - 1}` }, body: '' }
        : { status: 308, headers: CORS, body: '' };
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(request.headers['content-range'] ?? '');
    const asking = /^bytes \*\/(\d+|\*)$/.exec(request.headers['content-range'] ?? '');
    if (asking) {
      if (asking[1] !== '*' && session.bytes === Number(asking[1])) return this.finish(id, session);
      return held();
    }
    if (!range) return googleError(400, 'Content-Range is missing or not valid', 'badContent', 'INVALID_ARGUMENT');
    const start = Number(range[1]);
    const data = request.body ?? new Uint8Array(0);
    // A piece that starts past what arrived leaves a gap: refused. One that overlaps is taken from where it is new.
    if (start > session.bytes) return held();
    const fresh = data.subarray(session.bytes - start);
    session.received.push(fresh.slice());
    session.bytes += fresh.length;
    if (range[3] !== '*') session.total = Number(range[3]);
    if (session.bytes >= session.total) return this.finish(id, session);
    return held();
  }

  private finish(id: string, session: Session): FakeResponse {
    this.sessions.delete(id);
    const data = new Uint8Array(session.bytes);
    let at = 0;
    for (const piece of session.received) {
      data.set(piece, at);
      at += piece.length;
    }
    const fields = { top: new Set(['id', 'name', 'mimeType', 'parents', 'size', 'modifiedTime', 'createdTime', 'headRevisionId', 'appProperties']) };
    if (session.update) {
      const item = this.items.get(session.update)!;
      return this.write(item, data, session.metadata) ?? json(200, pick(this.resource(item), fields.top));
    }
    return this.create(session.create ?? {}, data, fields);
  }

  /** A query of the few kinds the console asks: "trashed = false", with "'id' in parents" (or several) before it. */
  private matches(item: DriveItem, q: string): boolean {
    for (const clause of q.split(/\s+and\s+/)) {
      const term = clause.trim().replace(/^\((.*)\)$/, '$1');
      if (term === 'trashed = false') {
        if (item.trashed) return false;
      } else if (/in parents/.test(term)) {
        const parents = [...term.matchAll(/'([^']+)' in parents/g)].map((match) => match[1]!);
        if (!parents.some((parent) => item.parents.includes(parent))) return false;
      } else {
        throw new Error(`the fake does not understand the query ${q}`);
      }
    }
    return true;
  }

  private list(url: URL, fields: { top: Set<string>; inner: Map<string, Set<string>> }): FakeResponse {
    this.calls.push('files.list');
    const q = url.searchParams.get('q') ?? 'trashed = false';
    const found = [...this.items.values()].filter((item) => item.visible && this.matches(item, q));
    const from = Number(url.searchParams.get('pageToken') ?? 0);
    const size = Math.min(Number(url.searchParams.get('pageSize') ?? 100), this.pageSize);
    const page = found.slice(from, from + size);
    return json(200, {
      ...(from + size < found.length ? { nextPageToken: String(from + size) } : {}),
      files: page.map((item) => pick(this.resource(item), fields.inner.get('files'))),
    });
  }

  private download(item: DriveItem, url: URL, range?: string): FakeResponse {
    this.calls.push('files.get:media');
    if (this.flagged.has(item.id) && url.searchParams.get('acknowledgeAbuse') !== 'true') {
      return googleError(403, 'This file has been identified as malware or spam and cannot be downloaded.', 'cannotDownloadAbusiveFile', 'PERMISSION_DENIED');
    }
    const headers = { ...CORS, 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes' };
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    if (!match) return { status: 200, headers, body: item.data };
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), item.data.length - 1);
    if (start > end) return { status: 416, headers: { ...CORS, 'content-type': 'text/plain' }, body: 'Requested range not satisfiable' };
    return { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${item.data.length}` }, body: item.data.slice(start, end + 1) };
  }
}
