/**
 * Linking to Google Drive, and keeping the link alive.
 *
 * This is Google's sign-in for devices that have no browser of their own
 * (OAuth 2.0 for TVs and limited-input devices). The console shows a short
 * code; the player enters it at google.com/device, on this device or any
 * other, and allows the console in there. The console asks Google every few
 * seconds meanwhile, and once the player has said yes it has its link.
 *
 * No address of the console is registered with Google, so one client works
 * wherever the console is served from: the reason the Dropbox link has the
 * player paste a code as well. No popup is opened (home-screen apps handle
 * those badly), and no script of Google's is loaded into the page.
 *
 * The link asks for drive.file and nothing else: the files the console makes
 * in the Drive. It is one of the two Drive scopes this kind of sign-in may
 * ask for, and Google need not verify an app that asks for no more.
 */
import { LinkError } from '../cloud/errors';
import { forgetLink, loadLink, saveConfig, storeLink, type DriveLink } from './link';

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(displayName%2CemailAddress)';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const PENDING_KEY = 'overseer-console:drive:pending';

/** Where the player enters the code. Google's answer names it too. */
export const DEVICE_PAGE = 'https://www.google.com/device';
/** Where a player makes the project and its client, and later finds them. */
export const CLOUD_CONSOLE_URL = 'https://console.cloud.google.com/';
/** The one thing the console asks to be allowed: the files it makes in the Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Refresh this long before the access token runs out. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
/** A code with less time than this left is not shown again: it would run out while it is typed. */
const CODE_MARGIN_MS = 2 * 60_000;

/** The ID of an OAuth client: the number of its project, a dash, and a run of letters and digits. */
export function looksLikeClientId(text: string): boolean {
  return /^\d{6,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com$/.test(text);
}

/** Secrets are one run of letters, digits, dashes and underscores ("GOCSPX-..."). */
export function looksLikeClientSecret(text: string): boolean {
  return /^[A-Za-z0-9_-]{16,80}$/.test(text);
}

/** The Google Cloud project a client belongs to: the number its ID starts with. */
export function projectOf(clientId: string): string {
  return /^(\d+)-/.exec(clientId)?.[1] ?? '';
}

/** Where the Google Drive API of the client's project is switched on. */
export function driveApiPage(clientId: string): string {
  const project = projectOf(clientId);
  return `https://console.cloud.google.com/apis/library/drive.googleapis.com${project ? `?project=${project}` : ''}`;
}

/** A code waiting for the player to enter it. */
export interface DeviceCode {
  clientId: string;
  /** What the console asks about. Never shown. */
  deviceCode: string;
  /** What the player enters: "ABCD-EFGH". */
  userCode: string;
  /** Where they enter it. */
  verificationUrl: string;
  expiresAt: number;
  /** How many seconds Google wants between asks. */
  interval: number;
}

interface Answer {
  status: number;
  body: Record<string, unknown> | null;
}

async function post(url: string, fields: Record<string, string>): Promise<Answer> {
  let response: Response;
  try {
    // A form post: needs no permission check from Google before it is sent.
    response = await fetch(url, { method: 'POST', body: new URLSearchParams(fields) });
  } catch {
    throw new LinkError('Could not reach Google. Check the connection and try again.');
  }
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** What Google's refusal means for the player. Google's own word for it is the error's cause. */
function refusal({ status, body }: Answer): LinkError {
  const error = text(body?.error);
  const description = text(body?.error_description);
  let message: string;
  switch (error) {
    case 'invalid_client':
      message = /type/i.test(description)
        ? 'That client is not of the kind the console needs. In Google Cloud, create one of the type "TVs and Limited Input devices", and use its ID and secret.'
        : /not found|deleted/i.test(description)
          ? "Google does not know that client ID. Copy it again from the client's page in Google Cloud."
          : "Google did not accept that client secret. Copy it again from the client's page in Google Cloud, or add a new secret there.";
      break;
    case 'disabled_client':
      message = 'That client is switched off in Google Cloud. Switch it on again, or make a new one.';
      break;
    case 'access_denied':
      message = 'Google says the link was not allowed. Get a new code to try again.';
      break;
    case 'expired_token':
      message = 'The code ran out before it was entered. Get a new one.';
      break;
    case 'invalid_grant':
      message = 'Google no longer knows that code. Get a new one.';
      break;
    case 'invalid_scope':
      message = 'Google would not let that client ask for the files the console makes in your Drive.';
      break;
    default:
      message = description ? `${error || `HTTP ${status}`}: ${description}` : error || `Google refused (HTTP ${status}).`;
  }
  const err = new LinkError(message);
  // Google's own word for it, for the callers that tell the cases apart.
  err.cause = error;
  return err;
}

/** The code this page is waiting on for a client, while it is good. */
export function keptCode(clientId: string): DeviceCode | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as DeviceCode | null;
    return kept?.clientId === clientId && typeof kept.deviceCode === 'string' && kept.expiresAt - Date.now() > CODE_MARGIN_MS ? kept : null;
  } catch {
    return null;
  }
}

function keepPending(code: DeviceCode | null): void {
  try {
    if (code) sessionStorage.setItem(PENDING_KEY, JSON.stringify(code));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Without storage the code lives as long as this page does.
  }
}

/** Forgets the code being waited for, so that the next ask gets a new one. */
export function dropCode(): void {
  keepPending(null);
}

/**
 * A code for the player to enter at Google. Loading the page again (phones
 * do that to tabs in the background) shows the same code while it lasts, so
 * the one already typed in still counts.
 */
export async function requestCode(clientId: string): Promise<DeviceCode> {
  const kept = keptCode(clientId);
  if (kept) return kept;
  const answer = await post(DEVICE_CODE_URL, { client_id: clientId, scope: DRIVE_SCOPE });
  const { body } = answer;
  if (answer.status !== 200 || typeof body?.device_code !== 'string' || typeof body.user_code !== 'string') throw refusal(answer);
  const code: DeviceCode = {
    clientId,
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl: text(body.verification_url) || DEVICE_PAGE,
    expiresAt: Date.now() + (Number(body.expires_in) || 1800) * 1000,
    interval: Math.max(1, Number(body.interval) || 5),
  };
  keepPending(code);
  return code;
}

async function revoke(token: string): Promise<boolean> {
  try {
    const response = await fetch(REVOKE_URL, { method: 'POST', body: new URLSearchParams({ token }) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Takes the tokens Google handed out for an entered code, and keeps the link. */
async function finish(code: DeviceCode, clientSecret: string, tokens: Record<string, unknown>): Promise<DriveLink> {
  keepPending(null);
  const accessToken = text(tokens.access_token);
  const refreshToken = text(tokens.refresh_token);
  if (!refreshToken) throw new LinkError('Google did not hand out a lasting link. Get a new code and try again.');
  // Google lets the player untick what was asked for. Nothing is revoked: that would end the link in other browsers too.
  if (!text(tokens.scope).split(/\s+/).includes(DRIVE_SCOPE)) {
    throw new LinkError(
      'Google was not allowed to let the console use the files it makes in your Drive: that box was left unticked. Get a new code, and tick it this time.',
    );
  }

  let account = { name: 'your Google Drive', email: '' };
  let response: Response | null = null;
  try {
    response = await fetch(ABOUT_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    // The name is only for show.
  }
  if (response?.ok) {
    const about = (await response.json().catch(() => ({}))) as { user?: { displayName?: string; emailAddress?: string } };
    account = { name: about.user?.displayName || about.user?.emailAddress || account.name, email: about.user?.emailAddress ?? '' };
  } else if (response?.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/.test(await response.text().catch(() => ''))) {
    throw new LinkError(
      'The Google Drive API is not switched on in your Google Cloud project. Enable it (APIs & Services, Library, Google Drive API), wait a minute, then get a new code.',
    );
  }

  const link: DriveLink = {
    clientId: code.clientId,
    clientSecret,
    refreshToken,
    accessToken,
    expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    account,
    linkedAt: Date.now(),
  };
  saveConfig({ clientId: code.clientId, clientSecret });
  if (!storeLink(link)) throw new LinkError('This browser window will not keep the link (private windows do that). Open the console in a normal window.');
  return link;
}

/** Whether the player has entered the code yet: 'waiting', 'slower' (asked too often), or the link. */
export async function pollCode(code: DeviceCode, clientSecret: string): Promise<'waiting' | 'slower' | DriveLink> {
  const answer = await post(TOKEN_URL, {
    client_id: code.clientId,
    client_secret: clientSecret,
    device_code: code.deviceCode,
    grant_type: DEVICE_GRANT,
  });
  if (answer.status === 200 && typeof answer.body?.access_token === 'string') return finish(code, clientSecret, answer.body);
  const error = text(answer.body?.error);
  if (error === 'authorization_pending') return 'waiting';
  if (error === 'slow_down') return 'slower';
  // A wrong secret leaves the code good: once the secret is put right, the same code counts.
  if (error !== 'invalid_client') keepPending(null);
  throw refusal(answer);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('stopped', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException('stopped', 'AbortError'));
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

/**
 * Asks Google, as often as it allows, whether the player has entered the
 * code and allowed the console in. Ends with the link; throws a LinkError
 * when the player said no or the code ran out, and an AbortError when
 * `signal` calls it off.
 */
export async function waitForLink(code: DeviceCode, clientSecret: string, signal: AbortSignal): Promise<DriveLink> {
  let interval = code.interval;
  for (;;) {
    await sleep(interval * 1000, signal);
    if (Date.now() >= code.expiresAt) {
      keepPending(null);
      throw refusal({ status: 400, body: { error: 'expired_token' } });
    }
    const answer = await pollCode(code, clientSecret);
    if (signal.aborted) throw new DOMException('stopped', 'AbortError');
    if (answer === 'slower') interval += 5;
    else if (answer !== 'waiting') return answer;
  }
}

let refreshing: Promise<string> | null = null;

async function refresh(link: DriveLink): Promise<string> {
  const answer = await post(TOKEN_URL, {
    client_id: link.clientId,
    client_secret: link.clientSecret,
    refresh_token: link.refreshToken,
    grant_type: 'refresh_token',
  });
  const accessToken = text(answer.body?.access_token);
  if (answer.status !== 200 || !accessToken) {
    const error = text(answer.body?.error);
    if (error === 'invalid_grant') {
      // Ended from Google's side: in the account's settings, or after six months unused.
      forgetLink();
      throw new LinkError('Google no longer accepts this link. Link the console again in Terminal settings.');
    }
    if (error === 'invalid_client' || error === 'unauthorized_client' || error === 'disabled_client') {
      forgetLink();
      throw new LinkError("Google no longer accepts the console's client: it was deleted or switched off, or its secret was changed. Link the console again in Terminal settings.");
    }
    throw refusal(answer);
  }
  // Another tab may have relinked meanwhile; its link is the one to keep.
  const current = loadLink();
  if (current?.refreshToken === link.refreshToken) {
    storeLink({ ...current, accessToken, expiresAt: Date.now() + (Number(answer.body?.expires_in) || 3600) * 1000 });
  }
  return accessToken;
}

/**
 * An access token that works, fetching a new one when the last is about to
 * run out. `renew` forces that: Google just refused the one we had.
 */
export async function validToken(renew = false): Promise<string> {
  const link = loadLink();
  if (!link) throw new LinkError('The console is not linked to a Google Drive.');
  if (!renew && link.accessToken && link.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return link.accessToken;
  // Requests that find the token stale at the same moment share one renewal.
  refreshing ??= refresh(link).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Forgets the link in this browser. Google is not asked to end it: by
 * Google's rules that would end it in every other browser too, and take
 * away the console's sight of the files it made. See endAccess for that.
 */
export function unlink(): void {
  forgetLink();
}

/**
 * Has Google end the console's access to the Drive: in every browser, for
 * every link made with this client. Reports whether Google confirmed; this
 * browser forgets the link either way.
 */
export async function endAccess(): Promise<{ revoked: boolean }> {
  const link = loadLink();
  if (!link) return { revoked: true };
  const revoked = await revoke(link.refreshToken);
  forgetLink();
  return { revoked };
}
