import 'fake-indexeddb/auto';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropboxError, download, headerJson, listFiles, toDropboxTime, upload } from '../../src/lib/dropbox/api';
import { LinkError, challengeFor, linkWithCode, looksLikeAppKey, prepareAuthorization, unlink, validToken } from '../../src/lib/dropbox/auth';
import { dropboxGameFiles } from '../../src/lib/dropbox/games';
import { loadConfig, loadLink, normaliseFolder, saveConfig, showFolder, storeLink } from '../../src/lib/dropbox/link';
import { compareSaves, eraseCloudSave, fetchSave, isSynced, listCloudSaves, sendSave, surveySaves, type SlotStanding } from '../../src/lib/dropbox/saves';
import { HEADER_SIZE } from '../../src/lib/savefile';
import { deleteSave, exportSaves, listSaves, packSlot, readSaveArchive } from '../../src/lib/saves';
import { commitWithHistory, deleteVersions, listVersions } from '../../src/lib/storage/history';
import { ImportError, planImport } from '../../src/lib/storage/importer';
import { clearOverlay, type OverlayChanges } from '../../src/lib/storage/overlay';
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
});

// ---------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------

function saveDat(description: string): Uint8Array {
  const data = new Uint8Array(HEADER_SIZE + 16);
  const put = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) data[offset + i] = text.charCodeAt(i);
  };
  put(0, 'FALLOUT SAVE FILE');
  put(0x1d, 'Narg');
  put(0x3d, description);
  new DataView(data.buffer).setInt16(0x65, 7, false);
  put(0x73, 'ARTEMPLE.SAV');
  return data;
}

/** The files a game writes when it saves: SAVE.DAT plus one file per map. */
function save(slot: number, description: string, mtime: number, maps: Record<string, number[]> = {}): OverlayChanges {
  const dir = `data/SAVEGAME/SLOT${String(slot).padStart(2, '0')}`;
  const puts = [{ key: `${dir}/save.dat`.toLowerCase(), path: `${dir}/SAVE.DAT`, mtime, data: saveDat(description) }];
  for (const [name, bytes] of Object.entries(maps)) {
    puts.push({ key: `${dir}/${name}`.toLowerCase(), path: `${dir}/${name}`, mtime, data: new Uint8Array(bytes) });
  }
  return { puts, deletes: [] };
}

/** A second device: nothing stored, nothing remembered, linked to the same Dropbox. */
async function anotherBrowser(): Promise<void> {
  await clearOverlay('fo2');
  await deleteVersions('fo2');
  localStorage.removeItem('overseer-console:dropbox:synced');
}

const T1 = Date.UTC(2026, 9, 10, 20, 0, 0, 250);
const T2 = Date.UTC(2026, 9, 11, 21, 30, 0, 500);

function standingOf(standings: SlotStanding[], slot: number): SlotStanding {
  return standings.find((item) => item.slot === slot)!;
}

describe('saves in Dropbox', () => {
  beforeEach(async () => {
    await link();
    await anotherBrowser();
  });

  it('compares slot by slot, trusting what both sides last shared over the clocks', () => {
    const cloud = (slot: number, rev: string, savedAt: number) => ({ slot, file: `id:${slot}`, rev, savedAt, bytes: 1 });
    const standings = compareSaves(
      [
        { slot: 1, savedAt: T1 },
        { slot: 2, savedAt: T2 },
        { slot: 3, savedAt: T1 },
        { slot: 4, savedAt: T2 },
        { slot: 5, savedAt: T1 },
        { slot: 6, savedAt: T1 },
        { slot: 7, savedAt: T2 },
        { slot: 9, savedAt: T1 },
      ],
      [
        cloud(1, 'a', T1),
        cloud(2, 'b', T1),
        cloud(3, 'c', T2),
        cloud(4, 'd2', T1),
        cloud(5, 'e', T2),
        // Never synced: only the clocks can tell. Dropbox keeps whole seconds.
        cloud(6, 'f', Math.floor(T1 / 1000) * 1000),
        cloud(7, 'g', T1),
        cloud(8, 'h', T1),
      ],
      {
        1: { rev: 'a', savedAt: T1 },
        // Saved again here since.
        2: { rev: 'b', savedAt: T1 },
        // Replaced in Dropbox since.
        3: { rev: 'c0', savedAt: T1 },
        // Replaced there by a save with an earlier clock: still the one that changed.
        4: { rev: 'd1', savedAt: T2 },
        // Both changed: the later save.
        5: { rev: 'e0', savedAt: 5 },
      },
    );
    expect(standings.map((item) => [item.slot, item.standing])).toEqual([
      [1, 'same'],
      [2, 'newer-here'],
      [3, 'newer-there'],
      [4, 'newer-there'],
      [5, 'newer-there'],
      [6, 'same'],
      [7, 'newer-here'],
      [8, 'only-there'],
      [9, 'only-here'],
    ]);
  });

  it('uploads a save as the zip the console exports, and then finds nothing to do', async () => {
    await commitWithHistory('fo2', save(3, 'before the temple', T1, { 'ARTEMPLE.SAV': [1, 2, 3] }));
    const [only] = await surveySaves('fo2');
    expect(only).toMatchObject({ slot: 3, standing: 'only-here' });
    await sendSave('fo2', only!);

    const stored = dropbox.files.get('/saves/fallout 2/slot03.zip')!;
    expect(stored.path).toBe('/Saves/Fallout 2/SLOT03.zip');
    expect(stored.modified).toBe('2026-10-10T20:00:00Z');
    expect(await listCloudSaves('fo2')).toEqual([{ slot: 3, file: stored.id, rev: stored.rev, savedAt: Date.UTC(2026, 9, 10, 20), bytes: stored.data.length }]);
    expect(isSynced('fo2', 3)).toBe(true);
    expect((await surveySaves('fo2')).map((item) => item.standing)).toEqual(['same']);
    // Nothing of the other game.
    expect(await surveySaves('fo1')).toEqual([]);
  });

  it('another browser fetches it whole, with the time it was saved', async () => {
    await commitWithHistory('fo2', save(3, 'before the temple', T1, { 'ARTEMPLE.SAV': [1, 2, 3] }));
    await sendSave('fo2', (await surveySaves('fo2'))[0]!);

    await anotherBrowser();
    const [there] = await surveySaves('fo2');
    expect(there!.standing).toBe('only-there');
    await fetchSave('fo2', there!);

    const [fetched] = await listSaves('fo2');
    expect(fetched).toMatchObject({ slot: 3, description: 'before the temple', savedAt: T1, files: 2, versions: 0 });
    expect((await surveySaves('fo2')).map((item) => item.standing)).toEqual(['same']);
  });

  it('a save made elsewhere replaces the one here, which is kept as a version', async () => {
    await commitWithHistory('fo2', save(3, 'before the temple', T1));
    await sendSave('fo2', (await surveySaves('fo2'))[0]!);

    // The other device plays on and uploads.
    await anotherBrowser();
    await fetchSave('fo2', (await surveySaves('fo2'))[0]!);
    await commitWithHistory('fo2', save(3, 'through the temple', T2));
    const newer = standingOf(await surveySaves('fo2'), 3);
    expect(newer.standing).toBe('newer-here');
    await sendSave('fo2', newer);

    // Back on the first one, which still holds the older save.
    await anotherBrowser();
    await commitWithHistory('fo2', save(3, 'before the temple', T1));
    const behind = standingOf(await surveySaves('fo2'), 3);
    expect(behind.standing).toBe('newer-there');
    await fetchSave('fo2', behind);

    expect((await listSaves('fo2'))[0]).toMatchObject({ description: 'through the temple', savedAt: T2, versions: 1 });
    expect((await listVersions('fo2', 3))[0]).toMatchObject({ cause: 'cloud', header: { description: 'before the temple' } });
  });

  it('will not upload over a save another device put there meanwhile', async () => {
    await commitWithHistory('fo2', save(3, 'mine', T1));
    const seen = (await surveySaves('fo2'))[0]!;
    dropbox.put('/Saves/Fallout 2/SLOT03.zip', 'theirs');
    await expect(sendSave('fo2', seen)).rejects.toSatisfy((err) => err instanceof DropboxError && err.conflict);
    expect(isSynced('fo2', 3)).toBe(false);
  });

  it('leaves the slot alone when the zip in Dropbox is not a save for it', async () => {
    await commitWithHistory('fo2', save(4, 'mine', T1));
    const other = zipSync({ 'SAVEGAME/SLOT03/SAVE.DAT': saveDat('another slot') });
    dropbox.put('/Saves/Fallout 2/SLOT04.zip', other, toDropboxTime(T2));
    dropbox.put('/Saves/Fallout 2/SLOT05.zip', 'not a zip at all', toDropboxTime(T2));
    dropbox.put('/Saves/Fallout 2/notes.txt', 'ignored');

    const standings = await surveySaves('fo2');
    expect(standings.map((item) => [item.slot, item.standing])).toEqual([
      [4, 'newer-there'],
      [5, 'only-there'],
    ]);
    await expect(fetchSave('fo2', standingOf(standings, 4))).rejects.toThrow(/SLOT04\.zip in Dropbox could not be used.*does not hold SLOT04/);
    await expect(fetchSave('fo2', standingOf(standings, 5))).rejects.toThrow(/SLOT05\.zip in Dropbox could not be used.*not a zip archive/);
    expect(await listSaves('fo2')).toMatchObject([{ slot: 4, description: 'mine', versions: 0 }]);
  });

  it('takes the time from Dropbox for a zip that does not say when it was saved', async () => {
    dropbox.put('/Saves/Fallout 2/SLOT07.zip', zipSync({ 'SLOT07/SAVE.DAT': saveDat('from a desktop install') }), toDropboxTime(T2));
    await fetchSave('fo2', (await surveySaves('fo2'))[0]!);
    expect((await listSaves('fo2'))[0]).toMatchObject({ slot: 7, savedAt: Math.floor(T2 / 1000) * 1000 });
    expect((await surveySaves('fo2'))[0]!.standing).toBe('same');
  });

  it('erasing a synced save erases it in Dropbox too, unless that holds another save by now', async () => {
    await commitWithHistory('fo2', save(3, 'one', T1));
    await commitWithHistory('fo2', save(5, 'two', T1));
    for (const item of await surveySaves('fo2')) await sendSave('fo2', item);

    await deleteSave('fo2', 3);
    expect(await eraseCloudSave('fo2', 3)).toBe('erased');
    expect(dropbox.files.has('/saves/fallout 2/slot03.zip')).toBe(false);

    dropbox.put('/Saves/Fallout 2/SLOT05.zip', 'put there by another device');
    await deleteSave('fo2', 5);
    expect(await eraseCloudSave('fo2', 5)).toBe('kept');
    expect(dropbox.files.has('/saves/fallout 2/slot05.zip')).toBe(true);
    expect(isSynced('fo2', 5)).toBe(false);

    // Never synced: nothing to do, and nothing asked of Dropbox.
    const calls = dropbox.calls.length;
    expect(await eraseCloudSave('fo2', 9)).toBe('kept');
    expect(dropbox.calls).toHaveLength(calls);
  });

  it('keeps saves where the player said to', async () => {
    saveConfig({ savesFolder: '/Vault 13/Backups' });
    await commitWithHistory('fo1', { puts: save(1, 'water chip', T1).puts, deletes: [] });
    await sendSave('fo1', (await surveySaves('fo1'))[0]!);
    expect([...dropbox.files.values()].map((file) => file.path)).toEqual(['/Vault 13/Backups/Fallout/SLOT01.zip']);
    await clearOverlay('fo1');
  });
});

describe('save archives', () => {
  beforeEach(anotherBrowser);

  it('refuses file names that climb out of their slot', async () => {
    const archive = zipSync({ 'SAVEGAME/SLOT01/SAVE.DAT': saveDat('fine'), 'SAVEGAME/SLOT01/../../../fallout2.cfg': strToU8('[system]') });
    await expect(readSaveArchive('fo2', new Blob([archive]))).rejects.toThrow(/file name the console does not accept/);
    expect(await listSaves('fo2')).toEqual([]);
  });

  it('counts an imported save as saved now, unless asked to keep its time', async () => {
    await commitWithHistory('fo2', save(2, 'old', T1, { 'ARCAVES.SAV': [9] }));
    const exported = await exportSaves('fo2');
    const packed = await packSlot('fo2', 2);
    expect(packed!.savedAt).toBe(T1);
    await clearOverlay('fo2');

    const before = Date.now();
    await (await readSaveArchive('fo2', exported)).commit();
    expect((await listSaves('fo2'))[0]!.savedAt).toBeGreaterThanOrEqual(before);

    // An archive made for Dropbox says when; one exported by hand leaves it to whoever asks.
    await (await readSaveArchive('fo2', new Blob([packed!.data as Uint8Array<ArrayBuffer>]), { keepTimes: true })).commit();
    expect((await listSaves('fo2'))[0]).toMatchObject({ savedAt: T1, files: 2 });
    await (await readSaveArchive('fo2', exported, { keepTimes: true, writtenAt: T2 })).commit();
    expect((await listSaves('fo2'))[0]).toMatchObject({ savedAt: T2, files: 2 });
  });

  it('packs nothing for a slot without a readable save', async () => {
    expect(await packSlot('fo2', 6)).toBeNull();
  });

  it('takes one slot out of an archive of several', async () => {
    const archive = new Blob([zipSync({ 'SLOT01/SAVE.DAT': saveDat('one'), 'SLOT02/SAVE.DAT': saveDat('two') })]);
    expect((await readSaveArchive('fo2', archive)).slots).toEqual([1, 2]);
    expect((await readSaveArchive('fo2', archive, { only: 2 })).slots).toEqual([2]);
    await expect(readSaveArchive('fo2', archive, { only: 3 })).rejects.toThrow(/does not hold SLOT03/);
  });
});

// ---------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------

/** A Fallout 2 archive: the last four bytes hold the size of the whole file. */
function dat2(size = 64): Uint8Array {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  view.setUint32(size - 8, 16, true);
  view.setUint32(size - 4, size, true);
  return data;
}

describe('games in Dropbox', () => {
  beforeEach(link);

  function putFallout2(folder: string): void {
    dropbox.put(`${folder}/master.dat`, dat2(4096));
    dropbox.put(`${folder}/critter.dat`, dat2());
    dropbox.put(`${folder}/patch000.dat`, dat2());
    dropbox.put(`${folder}/fallout2.cfg`, '[system]\r\nlanguage=german\r\n');
    dropbox.put(`${folder}/fallout2.exe`, 'not wanted');
    dropbox.put(`${folder}/sound/music/01hub.acm`, 'music');
    dropbox.put(`${folder}/data/SAVEGAME/SLOT01/SAVE.DAT`, saveDat('came with the folder'), '2026-09-30T10:00:00Z');
  }

  it('finds the game wherever its folder was put, reading only what planning needs', async () => {
    putFallout2('/My Games/Fallout 2');
    dropbox.put('/Saves/Fallout 2/SLOT03.zip', 'a save, not a game');
    const before = dropbox.calls.length;

    const plan = await planImport(await dropboxGameFiles('fo2'), 'fo2');
    expect(plan.game).toBe('fo2');
    expect(plan.root).toBe('My Games/Fallout 2');
    expect(plan.entries.map((entry) => entry.path).sort()).toEqual(['critter.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm']);
    expect(plan.totalBytes).toBe(4096 + 64 + 64 + 5);
    expect(plan.language).toBe('german');
    expect(plan.saves.map((entry) => [entry.path, entry.file.lastModified])).toEqual([['data/SAVEGAME/SLOT01/SAVE.DAT', Date.UTC(2026, 8, 30, 10)]]);
    // One listing, the last bytes of MASTER.DAT (which tell the game), and the settings file.
    expect(dropbox.calls.slice(before)).toEqual(['files/list_folder', 'files/download', 'files/download']);

    // The files themselves are read piece by piece, when the copy asks.
    const master = plan.entries.find((entry) => entry.path === 'master.dat')!.file;
    expect(new Uint8Array(await master.slice(4088, 9999).arrayBuffer())).toHaveLength(8);
    expect(new Uint8Array(await master.slice(10, 10).arrayBuffer())).toHaveLength(0);
    expect(new Uint8Array(await master.arrayBuffer())).toEqual(dat2(4096));
  });

  it('looks only below the folder the player set', async () => {
    putFallout2('/Elsewhere/Fallout 2');
    putFallout2('/Games/Fallout 2');
    saveConfig({ gamesFolder: '/Games' });
    expect((await planImport(await dropboxGameFiles('fo2'), 'fo2')).root).toBe('Fallout 2');
  });

  it('says where it looked when there is nothing to find', async () => {
    dropbox.put('/Saves/Fallout 2/SLOT03.zip', 'a save, not a game');
    await expect(dropboxGameFiles('fo2')).rejects.toSatisfy((err) => err instanceof ImportError && /No MASTER\.DAT in the console's app folder/.test(err.message));
    saveConfig({ gamesFolder: '/Games' });
    await expect(dropboxGameFiles('fo2')).rejects.toSatisfy((err) => err instanceof ImportError && /There is no folder \/Games/.test(err.message));
  });
});
