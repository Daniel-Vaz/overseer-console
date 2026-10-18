import 'fake-indexeddb/auto';
import { strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropboxError, download, headerJson, listFiles, sendLarge, spaceUsage, toDropboxTime, upload } from '../../src/lib/dropbox/api';
import { LinkError, challengeFor, linkWithCode, looksLikeAppKey, prepareAuthorization, unlink, validToken } from '../../src/lib/dropbox/auth';
import { loadConfig, loadLink, normaliseFolder, saveConfig, showFolder, storeLink } from '../../src/lib/dropbox/link';
import { FakeDropbox, fetchThrough } from '../fake-dropbox';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, String(value));
  removeItem = (key: string) => void this.items.delete(key);
}

let dropbox: FakeDropbox;

beforeEach(() => {
  dropbox = new FakeDropbox();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('fetch', fetchThrough(dropbox));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The whole ceremony: ask, have the player allow it, bring the code back. */
async function link() {
  const authorization = await prepareAuthorization(dropbox.appKey);
  dropbox.approve(authorization.url);
  return linkWithCode(authorization, dropbox.code);
}

describe('linking', () => {
  it('asks for approval with a challenge only its verifier answers', async () => {
    // The worked example of RFC 7636.
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');

    const authorization = await prepareAuthorization(dropbox.appKey);
    const url = new URL(authorization.url);
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: dropbox.appKey,
      response_type: 'code',
      code_challenge: await challengeFor(authorization.verifier),
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      scope: 'account_info.read files.metadata.read files.content.read files.content.write',
    });
    expect(authorization.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('keeps the same request when the page is loaded again', async () => {
    const first = await prepareAuthorization(dropbox.appKey);
    expect((await prepareAuthorization(dropbox.appKey)).verifier).toBe(first.verifier);
    expect((await prepareAuthorization('zzzzzzzzzzzzzzz')).verifier).not.toBe(first.verifier);
  });

  it('tells an app key from other things people paste', () => {
    expect(looksLikeAppKey('q7x2m9d4k1w8z5c')).toBe(true);
    expect(looksLikeAppKey('')).toBe(false);
    expect(looksLikeAppKey('sl.u.AbCdEf-very-long-access-token')).toBe(false);
    expect(looksLikeAppKey('me@example.com')).toBe(false);
  });

  it('links with the code and remembers whose Dropbox it is', async () => {
    const made = await link();
    expect(made.account).toEqual({ id: 'dbid:AAC-test', name: 'Chosen One', email: 'chosen@arroyo.example' });
    expect(made.expiresAt).toBeGreaterThan(Date.now() + 3 * 3600_000);
    expect(loadLink()).toEqual(made);
    expect(loadConfig().appKey).toBe(dropbox.appKey);
    expect(dropbox.calls).toEqual(['oauth2/token:authorization_code', 'users/get_current_account']);
  });

  it('names the permissions the app lacks, and keeps no half-made link', async () => {
    dropbox.allowed = ['account_info.read', 'files.metadata.read'];
    await expect(link()).rejects.toThrow(/does not allow files\.content\.read, files\.content\.write\. .*Permissions tab/);
    expect(loadLink()).toBeNull();
    await vi.waitFor(() => expect(dropbox.linked).toBe(false));
  });

  it('explains a code that is wrong or was used before', async () => {
    const authorization = await prepareAuthorization(dropbox.appKey);
    dropbox.approve(authorization.url);
    await expect(linkWithCode(authorization, 'not-the-code')).rejects.toThrow(/did not accept that code/);
    await linkWithCode(authorization, ` ${dropbox.code}\n`);
    await expect(linkWithCode(authorization, dropbox.code)).rejects.toBeInstanceOf(LinkError);
  });

  it('refuses a code that was asked for by someone else', async () => {
    const authorization = await prepareAuthorization(dropbox.appKey);
    dropbox.approve(authorization.url);
    await expect(linkWithCode({ ...authorization, verifier: 'x'.repeat(43) }, dropbox.code)).rejects.toThrow(/did not accept that code/);
  });

  it('explains an app key Dropbox does not know', async () => {
    const authorization = await prepareAuthorization('zzzzzzzzzzzzzzz');
    await expect(linkWithCode(authorization, dropbox.code)).rejects.toThrow(/does not know that app key/);
  });

  it('renews the access token when Dropbox says it ran out', async () => {
    const made = await link();
    dropbox.expireAccessTokens();
    await expect(listFiles('')).resolves.toEqual([]);
    expect(loadLink()!.accessToken).not.toBe(made.accessToken);
    expect(loadLink()!.refreshToken).toBe(made.refreshToken);
  });

  it('renews ahead of time, once for requests made together', async () => {
    const made = await link();
    storeLink({ ...made, expiresAt: Date.now() + 60_000 });
    const tokens = await Promise.all([validToken(), validToken(), validToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).not.toBe(made.accessToken);
    expect(dropbox.calls.filter((call) => call === 'oauth2/token:refresh_token')).toHaveLength(1);
    // And not again while the new one is good.
    await validToken();
    expect(dropbox.calls.filter((call) => call === 'oauth2/token:refresh_token')).toHaveLength(1);
  });

  it('forgets a link the player cancelled at Dropbox', async () => {
    await link();
    dropbox.disconnectApp();
    await expect(listFiles('')).rejects.toThrow(/no longer accepts this link/);
    expect(loadLink()).toBeNull();
    await expect(validToken()).rejects.toThrow(/not linked/);
  });

  it('unlinking cancels the link at Dropbox and keeps the settings', async () => {
    await link();
    saveConfig({ savesFolder: '/Vault 13' });
    expect(await unlink()).toEqual({ revoked: true });
    expect(dropbox.linked).toBe(false);
    expect(loadLink()).toBeNull();
    expect(loadConfig()).toEqual({ appKey: dropbox.appKey, gamesFolder: '', savesFolder: '/Vault 13' });
  });

  it('unlinks in the browser even when Dropbox cannot be reached', async () => {
    await link();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect(await unlink()).toEqual({ revoked: false });
    expect(loadLink()).toBeNull();
  });
});

describe('folders', () => {
  it('tidies what the player typed', () => {
    expect(normaliseFolder('')).toBe('');
    expect(normaliseFolder('/')).toBe('');
    expect(normaliseFolder('Saves')).toBe('/Saves');
    expect(normaliseFolder(' /Games//Fallout 2/ ')).toBe('/Games/Fallout 2');
    expect(normaliseFolder('Games\\Fallout')).toBe('/Games/Fallout');
    expect(normaliseFolder('./Games/.')).toBe('/Games');
    expect(() => normaliseFolder('/Saves/../..')).toThrow(/cannot contain/);
    expect(showFolder('')).toBe('/');
    expect(showFolder('/Saves')).toBe('/Saves');
  });

  it('falls back to the defaults for settings that were tampered with', () => {
    localStorage.setItem('overseer-console:dropbox', JSON.stringify({ appKey: 'abc', gamesFolder: '/a/../..', savesFolder: 7 }));
    expect(loadConfig()).toEqual({ appKey: 'abc', gamesFolder: '', savesFolder: '/Saves' });
  });
});

describe('requests', () => {
  beforeEach(link);

  it('escapes what a header cannot carry', () => {
    expect(headerJson({ path: '/Saves/Fallout 2/SLOT03.zip' })).toBe('{"path":"/Saves/Fallout 2/SLOT03.zip"}');
    expect(headerJson({ path: '/Spiele/Ödland ☢' })).toBe('{"path":"/Spiele/\\u00d6dland \\u2622"}');
    expect(JSON.parse(headerJson({ path: '/Spiele/Ödland ☢' }))).toEqual({ path: '/Spiele/Ödland ☢' });
  });

  it('writes times the way Dropbox keeps them', () => {
    expect(toDropboxTime(Date.UTC(2026, 9, 12, 8, 49, 10, 987))).toBe('2026-10-12T08:49:10Z');
  });

  it('lists a folder page by page, files only', async () => {
    dropbox.pageSize = 2;
    for (const name of ['a.dat', 'b.dat', 'sub/c.dat', 'sub/deeper/d.dat']) dropbox.put(`/Games/${name}`, name);
    dropbox.put('/Elsewhere/e.dat', 'e');

    expect((await listFiles('/Games')).map((file) => file.path_display)).toEqual(['/Games/a.dat', '/Games/b.dat']);
    expect((await listFiles('/Games', true)).map((file) => file.path_display)).toEqual([
      '/Games/a.dat',
      '/Games/b.dat',
      '/Games/sub/c.dat',
      '/Games/sub/deeper/d.dat',
    ]);
    expect(await listFiles('', true)).toHaveLength(5);
    await expect(listFiles('/Nowhere')).rejects.toSatisfy((err) => err instanceof DropboxError && err.notFound);
  });

  it('reads a file whole or in part', async () => {
    const file = dropbox.put('/Games/master.dat', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(new Uint8Array(await download('/games/MASTER.DAT'))).toHaveLength(10);
    expect([...new Uint8Array(await download(file.id, { start: 3, end: 7 }))]).toEqual([3, 4, 5, 6]);
    await expect(download('/Games/critter.dat')).rejects.toSatisfy((err) => err instanceof DropboxError && err.notFound);
  });

  it('rides out a connection that drops while a game is being copied, and gives up sooner on the rest', async () => {
    vi.useFakeTimers();
    try {
      const file = dropbox.put('/Games/master.dat', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
      const real = fetchThrough(dropbox);
      let failures = 4;
      const flaky = (input: RequestInfo | URL, init?: RequestInit) => (failures-- > 0 ? Promise.reject(new TypeError('network')) : real(input, init));

      vi.stubGlobal('fetch', flaky);
      const piece = download(file.id, { start: 2, end: 5 });
      await vi.runAllTimersAsync();
      expect([...new Uint8Array(await piece)]).toEqual([2, 3, 4]);

      failures = 4;
      const listing = listFiles('/Games').catch((err: unknown) => err);
      await vi.runAllTimersAsync();
      expect(await listing).toSatisfy((err) => err instanceof DropboxError && /Could not reach Dropbox/.test(err.message));
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits when Dropbox asks for a pause', async () => {
    vi.useFakeTimers();
    try {
      const real = fetchThrough(dropbox);
      let busy = 1;
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        // As a browser sees it: the Retry-After header is not shown to pages of other sites.
        busy-- > 0
          ? Promise.resolve(Response.json({ error_summary: 'too_many_write_operations/', error: { reason: { '.tag': 'too_many_write_operations' }, retry_after: 2 } }, { status: 429 }))
          : real(input, init),
      );
      const started = Date.now();
      const sent = upload('/Saves/z.zip', strToU8('z'), { replaces: null, modified: 1_000 });
      await vi.runAllTimersAsync();
      expect((await sent).size).toBe(1);
      expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('will not write over a file that changed since it was looked at', async () => {
    const first = await upload('/Saves/x.zip', strToU8('one'), { replaces: null, modified: 1_000 });
    expect(first.client_modified).toBe('1970-01-01T00:00:01Z');
    await expect(upload('/Saves/x.zip', strToU8('two'), { replaces: null, modified: 2_000 })).rejects.toSatisfy((err) => err instanceof DropboxError && err.conflict);
    const second = await upload('/Saves/x.zip', strToU8('two'), { replaces: first.rev, modified: 2_000 });
    await expect(upload('/Saves/x.zip', strToU8('three'), { replaces: first.rev, modified: 3_000 })).rejects.toSatisfy((err) => err instanceof DropboxError && err.conflict);
    expect(new TextDecoder().decode(await download('/Saves/x.zip'))).toBe('two');
    expect(second.rev).not.toBe(first.rev);
  });

  it('names a permission the app turns out to lack, and keeps the link', async () => {
    const real = fetchThrough(dropbox);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/files/upload')
        ? Promise.resolve(Response.json({ error_summary: 'missing_scope/', error: { '.tag': 'missing_scope', required_scope: 'files.content.write' } }, { status: 401 }))
        : real(input, init),
    );
    await expect(upload('/Saves/y.zip', strToU8('y'), { replaces: null, modified: 1_000 })).rejects.toThrow(/does not allow files\.content\.write/);
    expect(loadLink()).not.toBeNull();
  });

  it('sends a large file in pieces, and goes on from where Dropbox says a lost piece got to', async () => {
    const data = new Uint8Array((8 << 20) * 2 + 5).map((_, index) => index % 251);
    const sent: number[] = [];
    // The answer to the second piece is lost on the way, though the piece itself arrived.
    const real = fetchThrough(dropbox);
    let lose = 1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const answer = await real(input, init);
      if (String(input).endsWith('/append_v2') && lose-- > 0) throw new TypeError('network');
      return answer;
    });
    const stored = await sendLarge('/Mods/Big.zip', new Blob([data]), { modified: Date.UTC(2026, 9, 1), replace: false, onProgress: (bytes) => sent.push(bytes) });
    expect(stored).toMatchObject({ path_display: '/Mods/Big.zip', size: data.length, client_modified: '2026-10-01T00:00:00Z' });
    // Compared as bytes: toEqual would walk sixteen million keys.
    expect(Buffer.compare(dropbox.files.get('/mods/big.zip')!.data, data)).toBe(0);
    expect(sent.at(-1)).toBe(data.length);
    expect(dropbox.calls.filter((call) => call.startsWith('files/upload_session'))).toEqual([
      'files/upload_session/start',
      'files/upload_session/append_v2',
      'files/upload_session/append_v2',
      'files/upload_session/append_v2',
      'files/upload_session/finish',
    ]);

    // Not over a file of that name, unless asked to.
    await expect(sendLarge('/Mods/Big.zip', new Blob(['other']), { modified: 0, replace: false })).rejects.toSatisfy((err) => err instanceof DropboxError && err.conflict);
    await sendLarge('/Mods/Big.zip', new Blob(['other']), { modified: 0, replace: true });
    expect(new TextDecoder().decode(dropbox.files.get('/mods/big.zip')!.data)).toBe('other');
  });

  it('says how much room the Dropbox has', async () => {
    dropbox.put('/Games/master.dat', new Uint8Array(1000));
    expect(await spaceUsage()).toEqual({ used: 1000, total: 2 * 2 ** 30 });
  });
});
