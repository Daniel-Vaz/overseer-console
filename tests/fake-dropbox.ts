/**
 * A stand-in for Dropbox, for tests: the handful of endpoints the console
 * calls, answering as the real ones do as far as the console can tell.
 *
 * The unit tests put it behind `fetch`; the browser tests put it behind the
 * three Dropbox hosts. Its files live in memory, in one app folder.
 */
import { createHash } from 'node:crypto';

export interface FakeRequest {
  method: string;
  url: string;
  /** Header names in lower case. */
  headers: Record<string, string>;
  body: Uint8Array | null;
}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | string;
}

interface StoredFile {
  /** The path as it was first spelled. */
  path: string;
  data: Uint8Array;
  rev: string;
  id: string;
  modified: string;
}

/** What each call needs the app to have ticked on its Permissions tab. */
const NEEDS: Record<string, string> = {
  'files/list_folder': 'files.metadata.read',
  'files/list_folder/continue': 'files.metadata.read',
  'files/download': 'files.content.read',
  'files/upload': 'files.content.write',
  'files/upload_session/start': 'files.content.write',
  'files/upload_session/append_v2': 'files.content.write',
  'files/upload_session/finish': 'files.content.write',
  'files/delete_v2': 'files.content.write',
  'files/save_url': 'files.content.write',
  'files/save_url/check_job_status': 'files.content.write',
  'users/get_current_account': 'account_info.read',
  'users/get_space_usage': 'account_info.read',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Accept-Ranges,Content-Range,ETag,Dropbox-API-Result',
};

function json(status: number, value: unknown, headers: Record<string, string> = {}): FakeResponse {
  return { status, headers: { ...CORS, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) };
}

function fault(summary: string, tag: Record<string, unknown>, status = 409): FakeResponse {
  return json(status, { error_summary: summary, error: tag });
}

export class FakeDropbox {
  /** The app the player made: its key, and what its Permissions tab allows. */
  appKey = 'abcdefghij12345';
  allowed = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'];
  account = { account_id: 'dbid:AAC-test', name: { display_name: 'Chosen One' }, email: 'chosen@arroyo.example' };
  /** The code the approval page shows. */
  code = 'code-from-dropbox';
  /** Entries per page of a folder listing. */
  pageSize = 2000;
  /** The room a Dropbox Basic account has. */
  allocated = 2 * 2 ** 30;

  /** By lower-cased path. */
  readonly files = new Map<string, StoredFile>();
  /** Every call made, by route, in order. */
  readonly calls: string[] = [];
  /** What save_url finds on the web, by address: the file, or an address it is sent on to. */
  readonly web = new Map<string, Uint8Array | { redirect: string }>();
  /** How many times save_url/check_job_status says a job is in progress before it is done. */
  saveUrlPolls = 1;
  /** Downloads save_url was asked for, in order. */
  readonly saved: { path: string; url: string }[] = [];

  private approval: { challenge: string; scopes: string[] } | null = null;
  private readonly accessTokens = new Map<string, string[]>();
  private readonly spentTokens = new Set<string>();
  private readonly refreshTokens = new Map<string, string[]>();
  private readonly cursors = new Map<string, unknown[]>();
  /** Upload sessions: what has arrived of each. */
  private readonly sessions = new Map<string, Uint8Array[]>();
  /** save_url jobs: polls left, then what they come to. */
  private readonly jobs = new Map<string, { polls: number; result: FakeResponse }>();
  private counter = 0;

  /** Puts a file in the app folder, as the player would with Dropbox itself. */
  put(path: string, data: Uint8Array | string, modified = '2026-10-01T12:00:00Z'): StoredFile {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const existing = this.files.get(path.toLowerCase());
    const file = { path: existing?.path ?? path, data: bytes, rev: `rev${String(++this.counter).padStart(9, '0')}`, id: existing?.id ?? `id:file${this.counter}`, modified };
    this.files.set(path.toLowerCase(), file);
    return file;
  }

  /** Every access token handed out so far stops working, as they do after a few hours. */
  expireAccessTokens(): void {
    for (const token of this.accessTokens.keys()) this.spentTokens.add(token);
    this.accessTokens.clear();
  }

  /** What Dropbox does when the player removes the app from their account. */
  disconnectApp(): void {
    this.expireAccessTokens();
    this.refreshTokens.clear();
  }

  /** Whether any link made through this app is still alive. */
  get linked(): boolean {
    return this.refreshTokens.size > 0;
  }

  /** The player opening the approval page and allowing the app. Returns the page. */
  approve(url: string): FakeResponse {
    const query = new URL(url).searchParams;
    const html = (text: string) => ({ status: 200, headers: { 'content-type': 'text/html' }, body: `<!doctype html><title>Dropbox</title><p id="code">${text}</p>` });
    if (query.get('client_id') !== this.appKey) return html('Invalid client_id');
    if (query.get('response_type') !== 'code' || query.get('code_challenge_method') !== 'S256' || query.get('token_access_type') !== 'offline') {
      return html('Unsupported request');
    }
    if (query.has('redirect_uri')) return html('This app has no redirect address');
    const asked = (query.get('scope') ?? this.allowed.join(' ')).split(' ');
    const scopes = asked.filter((scope) => this.allowed.includes(scope));
    if (!scopes.length) return html('No scope requested can be granted for this app.');
    this.approval = { challenge: query.get('code_challenge') ?? '', scopes };
    return html(this.code);
  }

  handle(request: FakeRequest): FakeResponse {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': 'Authorization,Content-Type,Range,Dropbox-API-Arg' }, body: '' };
    }
    if (url.hostname === 'www.dropbox.com' && url.pathname === '/oauth2/authorize') return this.approve(request.url);
    if (url.pathname === '/oauth2/token') return this.token(request);

    const route = url.pathname.replace(/^\/2\//, '');
    this.calls.push(route);
    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    const scopes = this.accessTokens.get(bearer);
    if (!scopes) {
      const tag = this.spentTokens.has(bearer) ? 'expired_access_token' : 'invalid_access_token';
      return fault(`${tag}/`, { '.tag': tag }, 401);
    }
    const needed = NEEDS[route];
    if (needed && !scopes.includes(needed)) return fault('missing_scope/', { '.tag': 'missing_scope', required_scope: needed }, 401);

    const text = request.body ? new TextDecoder().decode(request.body) : '';
    switch (route) {
      case 'users/get_current_account':
        return json(200, this.account);
      case 'auth/token/revoke':
        this.disconnectApp();
        return json(200, null);
      case 'files/list_folder':
        return this.list(JSON.parse(text) as { path: string; recursive?: boolean });
      case 'files/list_folder/continue':
        return this.page(this.cursors.get((JSON.parse(text) as { cursor: string }).cursor) ?? []);
      case 'files/delete_v2':
        return this.remove(JSON.parse(text) as { path: string; parent_rev?: string });
      case 'files/download':
        return this.download(JSON.parse(request.headers['dropbox-api-arg'] ?? '{}') as { path: string }, request.headers.range);
      case 'files/upload':
        return this.upload(JSON.parse(request.headers['dropbox-api-arg'] ?? '{}') as UploadArg, request.body ?? new Uint8Array(0));
      case 'files/upload_session/start':
      case 'files/upload_session/append_v2':
      case 'files/upload_session/finish':
        return this.session(route, JSON.parse(request.headers['dropbox-api-arg'] ?? '{}') as SessionArg, request.body ?? new Uint8Array(0));
      case 'files/save_url':
        return this.saveUrl(JSON.parse(text) as { path: string; url: string });
      case 'files/save_url/check_job_status':
        return this.jobStatus(JSON.parse(text) as { async_job_id: string });
      case 'users/get_space_usage':
        return json(200, { used: [...this.files.values()].reduce((sum, file) => sum + file.data.length, 0), allocation: { '.tag': 'individual', allocated: this.allocated } });
      default:
        return { status: 400, headers: { ...CORS, 'content-type': 'text/plain' }, body: `Unknown API function: "${route}"` };
    }
  }

  private token(request: FakeRequest): FakeResponse {
    const form = new URLSearchParams(request.body ? new TextDecoder().decode(request.body) : '');
    this.calls.push(`oauth2/token:${form.get('grant_type')}`);
    const refused = (error: string, error_description?: string) => json(400, error_description ? { error, error_description } : { error });
    if (form.get('client_id') !== this.appKey) return refused('invalid_client: Invalid client_id');
    // The console is a public client: it has no secret to send, and must not.
    if (form.has('client_secret')) return refused('invalid_client: unexpected client_secret');

    let scopes: string[];
    let refreshToken: string | undefined;
    if (form.get('grant_type') === 'authorization_code') {
      const approval = this.approval;
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (!approval || form.get('code') !== this.code) return refused('invalid_grant', "code doesn't exist or has expired");
      if (challenge !== approval.challenge) return refused('invalid_grant', 'invalid code verifier');
      // A code works once.
      this.approval = null;
      scopes = approval.scopes;
      refreshToken = `refresh-${++this.counter}`;
      this.refreshTokens.set(refreshToken, scopes);
    } else if (form.get('grant_type') === 'refresh_token') {
      const known = this.refreshTokens.get(form.get('refresh_token') ?? '');
      if (!known) return refused('invalid_grant', 'refresh token is invalid or revoked');
      scopes = known;
    } else {
      return refused('unsupported_grant_type');
    }
    const accessToken = `sl.access-${++this.counter}`;
    this.accessTokens.set(accessToken, scopes);
    return json(200, {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 14400,
      scope: [...scopes].sort().join(' '),
      account_id: this.account.account_id,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    });
  }

  private metadata(file: StoredFile): Record<string, unknown> {
    return {
      '.tag': 'file',
      name: file.path.slice(file.path.lastIndexOf('/') + 1),
      id: file.id,
      path_lower: file.path.toLowerCase(),
      path_display: file.path,
      size: file.data.length,
      rev: file.rev,
      client_modified: file.modified,
      server_modified: file.modified,
    };
  }

  private page(entries: unknown[]): FakeResponse {
    const now = entries.slice(0, this.pageSize);
    const later = entries.slice(this.pageSize);
    const cursor = `cursor-${++this.counter}`;
    if (later.length) this.cursors.set(cursor, later);
    return json(200, { entries: now, cursor, has_more: later.length > 0 });
  }

  private list({ path, recursive }: { path: string; recursive?: boolean }): FakeResponse {
    if (path === '/') return { status: 400, headers: { ...CORS, 'content-type': 'text/plain' }, body: 'Error in call to API function "files/list_folder": request body: path: Specify the root folder as an empty string rather than as "/".' };
    const prefix = `${path.toLowerCase()}/`;
    const below = [...this.files.values()].filter((file) => file.path.toLowerCase().startsWith(prefix));
    if (path && !below.length) return fault('path/not_found/', { '.tag': 'path', path: { '.tag': 'not_found' } });

    const entries: unknown[] = [];
    const folders = new Set<string>();
    for (const file of below.sort((a, b) => a.path.localeCompare(b.path))) {
      const inside = file.path.slice(prefix.length).split('/');
      // Folders on the way down are entries of their own, as in the real listing.
      for (let depth = 1; depth < inside.length && (recursive || depth === 1); depth++) {
        const folder = `${file.path.slice(0, prefix.length)}${inside.slice(0, depth).join('/')}`;
        if (folders.has(folder.toLowerCase())) continue;
        folders.add(folder.toLowerCase());
        entries.push({ '.tag': 'folder', name: inside[depth - 1], path_lower: folder.toLowerCase(), path_display: folder, id: `id:folder${folders.size}` });
      }
      if (recursive || inside.length === 1) entries.push(this.metadata(file));
    }
    return this.page(entries);
  }

  private find(path: string): StoredFile | undefined {
    if (path.startsWith('id:')) return [...this.files.values()].find((file) => file.id === path);
    return this.files.get(path.toLowerCase());
  }

  private download({ path }: { path: string }, range?: string): FakeResponse {
    const file = this.find(path);
    if (!file) return fault('path/not_found/', { '.tag': 'path', path: { '.tag': 'not_found' } });
    const headers = { ...CORS, 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'dropbox-api-result': JSON.stringify(this.metadata(file)) };
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    if (!match) return { status: 200, headers, body: file.data };
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), file.data.length - 1);
    if (start > end) return { status: 416, headers: { ...CORS, 'content-type': 'text/plain' }, body: 'Requested Range Not Satisfiable' };
    return { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${file.data.length}` }, body: file.data.slice(start, end + 1) };
  }

  private upload(arg: UploadArg, data: Uint8Array): FakeResponse {
    const existing = this.files.get(arg.path.toLowerCase());
    const same = existing && existing.data.length === data.length && existing.data.every((byte, index) => byte === data[index]);
    const expected = typeof arg.mode === 'object' ? arg.mode.update : null;
    // Identical contents are never a conflict; a file that is gone is none either.
    const conflict = existing && !same && (arg.mode === 'add' || (expected !== null && expected !== existing.rev));
    if (conflict) return fault('path/conflict/file/', { '.tag': 'path', reason: { '.tag': 'conflict', conflict: { '.tag': 'file' } } });
    if (existing && same) return json(200, this.metadata(existing));
    return json(200, this.metadata(this.put(arg.path, data, arg.client_modified)));
  }

  /** An upload session: pieces that become a file once the last is in. */
  private session(route: string, arg: SessionArg, data: Uint8Array): FakeResponse {
    if (route.endsWith('/start')) {
      const id = `session-${++this.counter}`;
      this.sessions.set(id, [data.slice()]);
      return json(200, { session_id: id });
    }
    const pieces = this.sessions.get(arg.cursor?.session_id ?? '');
    if (!pieces) return fault('not_found/', { '.tag': 'not_found' });
    const held = pieces.reduce((sum, piece) => sum + piece.length, 0);
    if (arg.cursor!.offset !== held) return fault('incorrect_offset/', { '.tag': 'incorrect_offset', correct_offset: held });
    pieces.push(data.slice());
    if (route.endsWith('/append_v2')) return json(200, null);

    this.sessions.delete(arg.cursor!.session_id);
    const whole = new Uint8Array(held + data.length);
    let at = 0;
    for (const piece of pieces) {
      whole.set(piece, at);
      at += piece.length;
    }
    const commit = arg.commit!;
    if (commit.mode === 'add' && this.files.has(commit.path.toLowerCase())) {
      return fault('path/conflict/file/', { '.tag': 'path', reason: { '.tag': 'conflict', conflict: { '.tag': 'file' } } });
    }
    return json(200, this.metadata(this.put(commit.path, whole, commit.client_modified)));
  }

  /** Dropbox downloading a file from the web itself, following redirects; a taken name gets " (1)". */
  private saveUrl({ path, url }: { path: string; url: string }): FakeResponse {
    this.saved.push({ path, url });
    if (!/^https?:\/\//.test(url)) return fault('invalid_url/', { '.tag': 'invalid_url' });
    let found = this.web.get(url);
    for (let hops = 0; found && !(found instanceof Uint8Array) && hops < 5; hops++) found = this.web.get(found.redirect);
    let result: FakeResponse;
    if (!(found instanceof Uint8Array)) {
      result = json(200, { '.tag': 'failed', failed: { '.tag': 'download_failed' } });
    } else {
      let target = path;
      const dot = path.lastIndexOf('.');
      for (let n = 1; this.files.has(target.toLowerCase()); n++) target = `${path.slice(0, dot)} (${n})${path.slice(dot)}`;
      const stored = this.put(target, found);
      result = json(200, { '.tag': 'complete', ...this.metadata(stored) });
    }
    const id = `job-${++this.counter}`;
    this.jobs.set(id, { polls: this.saveUrlPolls, result });
    return json(200, { '.tag': 'async_job_id', async_job_id: id });
  }

  private jobStatus({ async_job_id }: { async_job_id: string }): FakeResponse {
    const job = this.jobs.get(async_job_id);
    if (!job) return fault('invalid_async_job_id/', { '.tag': 'invalid_async_job_id' });
    if (job.polls-- > 0) return json(200, { '.tag': 'in_progress' });
    return job.result;
  }

  private remove({ path, parent_rev }: { path: string; parent_rev?: string }): FakeResponse {
    const file = this.files.get(path.toLowerCase());
    if (!file) return fault('path_lookup/not_found/', { '.tag': 'path_lookup', path_lookup: { '.tag': 'not_found' } });
    if (parent_rev && parent_rev !== file.rev) return fault('path_write/conflict/file/', { '.tag': 'path_write', path_write: { '.tag': 'conflict' } });
    this.files.delete(path.toLowerCase());
    return json(200, { metadata: this.metadata(file) });
  }
}

interface UploadArg {
  path: string;
  mode: 'add' | 'overwrite' | { '.tag': 'update'; update: string };
  client_modified?: string;
}

interface SessionArg {
  cursor?: { session_id: string; offset: number };
  commit?: { path: string; mode: 'add' | 'overwrite'; client_modified?: string };
}

/** Puts a fake Dropbox (or Google Drive) behind `fetch`. */
export function fetchThrough(dropbox: { handle(request: FakeRequest): FakeResponse }): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => (headers[name.toLowerCase()] = value));
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : null;
    const answer = dropbox.handle({ method: request.method, url: request.url, headers, body });
    // A body is not allowed on some statuses.
    const empty = answer.status === 204 || answer.status === 304;
    return new Response(empty ? null : (answer.body as BodyInit), { status: answer.status, headers: answer.headers });
  };
}
