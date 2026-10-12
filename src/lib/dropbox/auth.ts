/**
 * Linking to Dropbox, and keeping the link alive.
 *
 * This is OAuth's authorization code flow with PKCE, the form meant for apps
 * that cannot keep a secret: the page proves it started the request with a
 * one-time verifier instead of an app secret. No redirect address is used.
 * Dropbox shows the player a code, and the player pastes it here. That keeps
 * the player's Dropbox app free of any address to register, so the same app
 * works wherever the console is served from.
 */
import { forgetLink, loadLink, saveConfig, storeLink, type DropboxLink } from './link';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API_URL = 'https://api.dropboxapi.com/2/';
const PENDING_KEY = 'overseer-console:dropbox:pending';

/** Where a player creates the app, and later finds its key. */
export const APP_CONSOLE_URL = 'https://www.dropbox.com/developers/apps';

/** What the console needs to be allowed, as named on the app's Permissions tab. */
export const FILE_SCOPES = ['files.metadata.read', 'files.content.read', 'files.content.write'];

/**
 * Asked for by name, so the token is good for nothing else even when the
 * player's app allows more. Dropbox grants those of the list the app has.
 */
const REQUESTED_SCOPES = ['account_info.read', ...FILE_SCOPES];

/** Refresh this long before the access token runs out. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/** Something about the link that the player has to act on. */
export class LinkError extends Error {
  override name = 'LinkError';
}

/** A request for approval that is waiting for its code. */
export interface Authorization {
  appKey: string;
  verifier: string;
  /** The page at Dropbox that asks the player and then shows the code. */
  url: string;
}

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The value Dropbox is shown up front; only the verifier it was made from redeems the code. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** App keys are short runs of lower-case letters and digits. */
export function looksLikeAppKey(text: string): boolean {
  return /^[a-z0-9]{10,32}$/.test(text);
}

function pendingVerifier(appKey: string): string | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as { appKey?: string; verifier?: string } | null;
    return pending?.appKey === appKey && typeof pending.verifier === 'string' ? pending.verifier : null;
  } catch {
    return null;
  }
}

/**
 * Prepares a request for approval. Reloading the page in between (phones do
 * that to tabs in the background) keeps the same request, so the code the
 * player comes back with still fits.
 */
export async function prepareAuthorization(appKey: string): Promise<Authorization> {
  let verifier = pendingVerifier(appKey);
  if (!verifier) {
    verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ appKey, verifier }));
    } catch {
      // Without storage the request lives as long as this page does.
    }
  }
  const query = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: REQUESTED_SCOPES.join(' '),
  });
  return { appKey, verifier, url: `${AUTHORIZE_URL}?${query}` };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  account_id?: string;
}

async function requestToken(fields: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    // A form post: needs no permission check from Dropbox before it is sent.
    response = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(fields) });
  } catch {
    throw new LinkError('Could not reach Dropbox. Check the connection and try again.');
  }
  const body = (await response.json().catch(() => null)) as (Partial<TokenResponse> & { error?: string; error_description?: string }) | null;
  if (!response.ok || !body?.access_token || !Number.isFinite(body.expires_in)) {
    const reason = body?.error ?? `HTTP ${response.status}`;
    const error = new LinkError(body?.error_description ? `${reason}: ${body.error_description}` : reason);
    // Dropbox's own word for it, for the callers that tell the cases apart.
    error.cause = reason;
    throw error;
  }
  return body as TokenResponse;
}

function reasonOf(err: unknown): string {
  return err instanceof LinkError && typeof err.cause === 'string' ? err.cause : '';
}

async function call<T>(route: string, accessToken: string): Promise<T> {
  const response = await fetch(`${API_URL}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Dropbox answered ${response.status} to ${route}`);
  return (await response.json()) as T;
}

/**
 * Redeems the code the player brought back from Dropbox, and remembers the
 * link. Throws a LinkError that says what to do when the code or the app is
 * not right.
 */
export async function linkWithCode(authorization: Authorization, code: string): Promise<DropboxLink> {
  let tokens: TokenResponse;
  try {
    tokens = await requestToken({
      grant_type: 'authorization_code',
      code: code.trim(),
      code_verifier: authorization.verifier,
      client_id: authorization.appKey,
    });
  } catch (err) {
    const reason = reasonOf(err);
    if (reason.startsWith('invalid_grant')) {
      throw new LinkError('Dropbox did not accept that code. A code works once and only for a few minutes: open Dropbox again for a new one.');
    }
    if (reason.startsWith('invalid_client')) throw new LinkError('Dropbox does not know that app key. Copy it again from the app\'s Settings tab.');
    throw err;
  }
  if (!tokens.refresh_token) throw new LinkError('Dropbox did not hand out a lasting link. Try again.');

  // The token holds what the app allows of what was asked for.
  const granted = new Set((tokens.scope ?? FILE_SCOPES.join(' ')).split(/\s+/));
  const missing = FILE_SCOPES.filter((scope) => !granted.has(scope));
  if (missing.length) {
    void revoke(tokens.access_token);
    throw new LinkError(
      `The Dropbox app does not allow ${missing.join(', ')}. Open the app's Permissions tab, tick ` +
        `${missing.length === 1 ? 'it' : 'them'}, press Submit, then open Dropbox again for a new code.`,
    );
  }

  let account = { id: tokens.account_id ?? '', name: 'your Dropbox', email: '' };
  try {
    const who = await call<{ account_id: string; name?: { display_name?: string }; email?: string }>('users/get_current_account', tokens.access_token);
    account = { id: who.account_id, name: who.name?.display_name || who.email || account.name, email: who.email ?? '' };
  } catch {
    // The name is only for show.
  }

  const link: DropboxLink = {
    appKey: authorization.appKey,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    account,
    linkedAt: Date.now(),
  };
  saveConfig({ appKey: authorization.appKey });
  if (!storeLink(link)) {
    void revoke(link.accessToken);
    throw new LinkError('This browser window will not keep the link (private windows do that). Open the console in a normal window.');
  }
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
  return link;
}

let refreshing: Promise<string> | null = null;

async function refresh(link: DropboxLink): Promise<string> {
  let tokens: TokenResponse;
  try {
    tokens = await requestToken({ grant_type: 'refresh_token', refresh_token: link.refreshToken, client_id: link.appKey });
  } catch (err) {
    if (reasonOf(err).startsWith('invalid_grant') || reasonOf(err).startsWith('invalid_client')) {
      // Unlinked from the Dropbox side, or the app is gone.
      forgetLink();
      throw new LinkError('Dropbox no longer accepts this link. Link the console again in Terminal settings.');
    }
    throw err;
  }
  // Another tab may have relinked meanwhile; its link is the one to keep.
  const current = loadLink();
  if (current?.refreshToken === link.refreshToken) {
    storeLink({ ...current, accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
  }
  return tokens.access_token;
}

/**
 * An access token that works, fetching a new one when the last is about to
 * run out. `renew` forces that: Dropbox just refused the one we had.
 */
export async function validToken(renew = false): Promise<string> {
  const link = loadLink();
  if (!link) throw new LinkError('The console is not linked to a Dropbox.');
  if (!renew && link.accessToken && link.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return link.accessToken;
  // Requests that find the token stale at the same moment share one renewal.
  refreshing ??= refresh(link).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function revoke(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Forgets the link in this browser and asks Dropbox to cancel it, which
 * makes every token the console held worthless. Reports whether Dropbox
 * confirmed; the browser forgets either way.
 */
export async function unlink(): Promise<{ revoked: boolean }> {
  const link = loadLink();
  if (!link) return { revoked: true };
  let revoked = false;
  try {
    revoked = await revoke(await validToken());
  } catch {
    // Offline, or Dropbox had cancelled the link already (which forgets it).
    revoked = loadLink() === null;
  }
  forgetLink();
  return { revoked };
}
