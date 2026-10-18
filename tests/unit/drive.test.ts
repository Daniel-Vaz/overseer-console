import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudError, LinkError } from '../../src/lib/cloud/errors';
import { DriveError, download, failure, sendInPieces, storage, write } from '../../src/lib/drive/api';
import {
  DRIVE_SCOPE,
  driveApiPage,
  endAccess,
  keptCode,
  looksLikeClientId,
  looksLikeClientSecret,
  pollCode,
  projectOf,
  requestCode,
  unlink,
  validToken,
  waitForLink,
} from '../../src/lib/drive/auth';
import { driveCloud } from '../../src/lib/drive/cloud';
import { loadConfig, loadLink, saveConfig, storeLink } from '../../src/lib/drive/link';
import { forgetTree, snapshot } from '../../src/lib/drive/tree';
import { fetchThrough } from '../fake-dropbox';
import { DRIVE_FILE, FakeDrive } from '../fake-drive';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, String(value));
  removeItem = (key: string) => void this.items.delete(key);
}

let drive: FakeDrive;

beforeEach(() => {
  drive = new FakeDrive();
  forgetTree();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('fetch', fetchThrough(drive));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The whole ceremony: ask for a code, have the player enter it at Google and allow the console, ask again. */
async function link() {
  const code = await requestCode(drive.clientId);
  drive.approve(code.userCode);
  const linked = await pollCode(code, drive.clientSecret);
  if (typeof linked === 'string') throw new Error(`not linked: ${linked}`);
  return linked;
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: ArrayBuffer | Uint8Array) => new TextDecoder().decode(data);

describe('linking', () => {
  it('tells a client ID and a secret from other things people paste', () => {
    expect(looksLikeClientId(drive.clientId)).toBe(true);
    expect(looksLikeClientId('123456789012-abc.apps.googleusercontent.com')).toBe(false);
    expect(looksLikeClientId('me@example.com')).toBe(false);
    expect(looksLikeClientSecret(drive.clientSecret)).toBe(true);
    expect(looksLikeClientSecret(drive.clientId)).toBe(false);
    expect(looksLikeClientSecret('')).toBe(false);
    expect(projectOf(drive.clientId)).toBe('123456789012');
    expect(driveApiPage(drive.clientId)).toBe('https://console.cloud.google.com/apis/library/drive.googleapis.com?project=123456789012');
  });

  it('asks for a code for the files the console makes, and nothing else', async () => {
    const code = await requestCode(drive.clientId);
    expect(code).toMatchObject({ clientId: drive.clientId, verificationUrl: 'https://www.google.com/device', interval: 5 });
    expect(code.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(code.expiresAt).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(DRIVE_SCOPE).toBe(DRIVE_FILE);
    // The page loaded again shows the same code, while it is good.
    expect(await requestCode(drive.clientId)).toEqual(code);
    expect(keptCode(drive.clientId)).toEqual(code);
    expect(drive.calls).toEqual(['device/code']);
  });

  it('waits until the player has entered the code, then remembers whose Drive it is', async () => {
    const code = await requestCode(drive.clientId);
    expect(await pollCode(code, drive.clientSecret)).toBe('waiting');
    drive.approve(code.userCode);
    const made = await pollCode(code, drive.clientSecret);
    expect(made).toMatchObject({ clientId: drive.clientId, clientSecret: drive.clientSecret, account: { name: 'Chosen One', email: 'chosen@arroyo.example' } });
    expect(loadLink()).toEqual(made);
    expect(loadConfig()).toMatchObject({ clientId: drive.clientId, clientSecret: drive.clientSecret });
    expect(keptCode(drive.clientId)).toBeNull();
    expect(drive.calls).toEqual(['device/code', 'token:device_code', 'token:device_code', 'about.get']);
  });

  it('asks as often as Google allows, and stops when called off', async () => {
    vi.useFakeTimers();
    const code = await requestCode(drive.clientId);
    const stopper = new AbortController();
    const waiting = waitForLink(code, drive.clientSecret, stopper.signal);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(drive.calls.filter((call) => call === 'token:device_code')).toHaveLength(2);
    drive.approve(code.userCode);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await waiting).account.name).toBe('Chosen One');

    const again = await requestCode(drive.clientId);
    const called = waitForLink(again, drive.clientSecret, stopper.signal);
    stopper.abort();
    await expect(called).rejects.toSatisfy((err) => err instanceof DOMException && err.name === 'AbortError');
  });

  it('explains a client that is not known, or not of the kind the console needs', async () => {
    await expect(requestCode('999999999999-zzzzzzzzzzzzzzzzzzzz.apps.googleusercontent.com')).rejects.toThrow(/does not know that client ID/);
    drive.clientType = 'web';
    await expect(requestCode(drive.clientId)).rejects.toThrow(/TVs and Limited Input devices/);
  });

  it('explains a wrong secret, and keeps the code good for the right one', async () => {
    const code = await requestCode(drive.clientId);
    drive.approve(code.userCode);
    await expect(pollCode(code, 'wrong-wrong-wrong-wrong-wrong-wrong')).rejects.toSatisfy(
      (err) => err instanceof LinkError && err.cause === 'invalid_client' && /did not accept that client secret/.test(err.message),
    );
    expect(keptCode(drive.clientId)).toEqual(code);
    expect(await pollCode(code, drive.clientSecret)).toMatchObject({ account: { name: 'Chosen One' } });
  });

  it('says so when the player said no, or the code ran out', async () => {
    const code = await requestCode(drive.clientId);
    drive.deny(code.userCode);
    await expect(pollCode(code, drive.clientSecret)).rejects.toThrow(/link was not allowed/);
    expect(keptCode(drive.clientId)).toBeNull();

    const late = await requestCode(drive.clientId);
    drive.expireCodes();
    await expect(pollCode(late, drive.clientSecret)).rejects.toThrow(/ran out before it was entered/);
    expect(loadLink()).toBeNull();
  });

  it('keeps no link when the box for Drive was left unticked', async () => {
    drive.grantDrive = false;
    await expect(link()).rejects.toThrow(/box was left unticked/);
    expect(loadLink()).toBeNull();
  });

  it('keeps no link while the Drive API is not switched on, and says where to switch it on', async () => {
    drive.apiEnabled = false;
    await expect(link()).rejects.toThrow(/Google Drive API is not switched on .*Library, Google Drive API/);
    expect(loadLink()).toBeNull();
  });

  it('renews the access token when Google says it ran out', async () => {
    const made = await link();
    drive.expireAccessTokens();
    await expect(driveCloud.listFiles('')).resolves.toEqual([]);
    expect(loadLink()!.accessToken).not.toBe(made.accessToken);
    expect(loadLink()!.refreshToken).toBe(made.refreshToken);
  });

  it('renews ahead of time, once for requests made together', async () => {
    const made = await link();
    storeLink({ ...made, expiresAt: Date.now() + 60_000 });
    const tokens = await Promise.all([validToken(), validToken(), validToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).not.toBe(made.accessToken);
    expect(drive.calls.filter((call) => call === 'token:refresh_token')).toHaveLength(1);
    await validToken();
    expect(drive.calls.filter((call) => call === 'token:refresh_token')).toHaveLength(1);
  });

  it('forgets a link the player ended at Google', async () => {
    await link();
    drive.disconnectApp();
    await expect(driveCloud.listFiles('')).rejects.toThrow(/no longer accepts this link/);
    expect(loadLink()).toBeNull();
    await expect(validToken()).rejects.toThrow(/not linked/);
  });

  it('unlinking forgets the link in this browser alone, and keeps the settings', async () => {
    await link();
    saveConfig({ savesFolder: '/Vault 13' });
    unlink();
    expect(loadLink()).toBeNull();
    // Google is not asked: the links of other browsers, and the console's sight of its files, stay.
    expect(drive.linked).toBe(true);
    expect(drive.calls).not.toContain('revoke');
    expect(loadConfig()).toEqual({ clientId: drive.clientId, clientSecret: drive.clientSecret, gamesFolder: '', savesFolder: '/Vault 13' });
  });

  it('ending access has Google end every link of the console', async () => {
    await link();
    const other = await link();
    expect(await endAccess()).toEqual({ revoked: true });
    expect(drive.linked).toBe(false);
    expect(loadLink()).toBeNull();
    // The other browser's link is gone with it.
    storeLink(other);
    await expect(validToken(true)).rejects.toThrow(/no longer accepts this link/);
  });

  it('ends access in this browser even when Google cannot be reached', async () => {
    await link();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect(await endAccess()).toEqual({ revoked: false });
    expect(loadLink()).toBeNull();
  });
});

describe('requests', () => {
  beforeEach(link);

  it('makes its own folder in My Drive, marked, and finds it again wherever it was moved', async () => {
    await driveCloud.upload('/Saves/Fallout 2/SLOT01.zip', bytes('one'), { replaces: null, modified: 1_000 });
    const root = drive.root!;
    expect(root).toMatchObject({ name: 'Overseer Console', parents: ['my-drive'], appProperties: { overseerConsole: 'root' } });
    expect(drive.paths).toEqual(['/Saves/Fallout 2/SLOT01.zip']);

    // The player renames it and moves it into a folder of their own.
    root.name = 'Fallout stuff';
    root.parents = ['folder-of-the-player'];
    forgetTree();
    expect((await driveCloud.listFiles('/Saves/Fallout 2')).map((file) => file.path)).toEqual(['/Saves/Fallout 2/SLOT01.zip']);
    await driveCloud.upload('/Saves/Fallout 2/SLOT02.zip', bytes('two'), { replaces: null, modified: 2_000 });
    expect([...drive.items.values()].filter((item) => item.appProperties.overseerConsole === 'root')).toHaveLength(1);
  });

  it('never sees what the player put there with Google\'s own app', async () => {
    drive.put('/Games/Fallout 2/master.dat', 'seen');
    drive.putByPlayer('/Games/Fallout 2/critter.dat', 'unseen');
    drive.putByPlayer('/Games/Fallout/master.dat', 'unseen');
    forgetTree();
    expect((await driveCloud.listFiles('/Games', true)).map((file) => file.path)).toEqual(['/Games/Fallout 2/master.dat']);
    await expect(download(drive.file('/Games/Fallout 2/critter.dat')!.id)).rejects.toSatisfy((err) => err instanceof DriveError && err.notFound);
  });

  it('lists everything page by page, folders of the same name as one, and of two files of the same name the later', async () => {
    drive.pageSize = 2;
    drive.put('/Games/a.dat', 'a');
    drive.put('/Games/sub/b.dat', 'b');
    // Two devices made a Saves folder at the same moment, and each put a save in its own.
    const saves = drive.put('/Saves/Fallout 2/SLOT01.zip', 'one');
    const twin = drive.items.get(drive.items.get(saves.parents[0]!)!.parents[0]!)!;
    const second = { ...twin, id: 'drive-twin', createdTime: new Date(Date.parse(twin.createdTime) + 1000).toISOString() };
    drive.items.set(second.id, second);
    const sub = { ...drive.items.get(saves.parents[0]!)!, id: 'drive-twin-sub', parents: [second.id] };
    drive.items.set(sub.id, sub);
    drive.items.set('drive-later', { ...saves, id: 'drive-later', parents: [sub.id], data: bytes('later'), modifiedTime: new Date(Date.parse(saves.modifiedTime) + 60_000).toISOString() });
    drive.items.set('drive-slot2', { ...saves, id: 'drive-slot2', name: 'SLOT02.zip', parents: [sub.id] });
    forgetTree();

    expect((await driveCloud.listFiles('/Games')).map((file) => file.path)).toEqual(['/Games/a.dat']);
    expect((await driveCloud.listFiles('/games', true)).map((file) => file.path)).toEqual(['/Games/a.dat', '/Games/sub/b.dat']);
    const listed = await driveCloud.listFiles('/Saves/Fallout 2');
    expect(listed.map((file) => [file.path, file.id])).toEqual([
      ['/Saves/Fallout 2/SLOT01.zip', 'drive-later'],
      ['/Saves/Fallout 2/SLOT02.zip', 'drive-slot2'],
    ]);
    expect(drive.calls.filter((call) => call === 'files.list').length).toBeGreaterThan(3);
    await expect(driveCloud.listFiles('/Nowhere')).rejects.toSatisfy((err) => err instanceof CloudError && err.notFound);
  });

  it('reads a file whole or in part', async () => {
    const file = drive.put('/Games/master.dat', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(new Uint8Array(await download(file.id))).toHaveLength(10);
    expect([...new Uint8Array(await download(file.id, { start: 3, end: 7 }))]).toEqual([3, 4, 5, 6]);
  });

  it('reads a file Google took for something harmful', async () => {
    const file = drive.put('/Mods/Fixt.zip', 'an installer in a zip');
    drive.flagged.add(file.id);
    expect(text(await download(file.id))).toBe('an installer in a zip');
  });

  it('will not write over a file that changed since it was looked at', async () => {
    const first = await driveCloud.upload('/Saves/x.zip', bytes('one'), { replaces: null, modified: Date.UTC(2026, 9, 1, 0, 0, 0, 250) });
    expect(first).toMatchObject({ name: 'x.zip', path: '/Saves/x.zip', size: 3, modified: Date.UTC(2026, 9, 1, 0, 0, 0, 250) });
    await expect(driveCloud.upload('/Saves/x.zip', bytes('two'), { replaces: null, modified: 2_000 })).rejects.toSatisfy((err) => err instanceof CloudError && err.conflict);
    const second = await driveCloud.upload('/Saves/x.zip', bytes('two'), { replaces: first.rev, modified: 2_000 });
    await expect(driveCloud.upload('/Saves/x.zip', bytes('three'), { replaces: first.rev, modified: 3_000 })).rejects.toSatisfy((err) => err instanceof CloudError && err.conflict);
    expect(text(await download(second.id))).toBe('two');
    expect(second.rev).not.toBe(first.rev);
    // The same file, given new contents: one file of that name.
    expect(drive.paths).toEqual(['/Saves/x.zip']);

    // Erased only while it is the one that was synced; Drive's trash keeps it.
    await expect(driveCloud.remove('/Saves/x.zip', first.rev)).rejects.toSatisfy((err) => err instanceof CloudError && err.status === 409 && !err.notFound);
    await driveCloud.remove('/Saves/x.zip', second.rev);
    expect(drive.items.get(second.id)!.trashed).toBe(true);
    await expect(driveCloud.remove('/Saves/x.zip', second.rev)).rejects.toSatisfy((err) => err instanceof CloudError && err.notFound);
  });

  it('waits and asks again while Drive is busy, and says so when it stays busy', async () => {
    vi.useFakeTimers();
    const real = fetchThrough(drive);
    let busy = 2;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      busy-- > 0 && String(input).includes('/drive/v3/files?')
        ? Promise.resolve(Response.json({ error: { code: 403, message: 'User rate limit exceeded.', errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 403 }))
        : real(input, init),
    );
    const listing = driveCloud.listFiles('');
    await vi.runAllTimersAsync();
    expect(await listing).toEqual([]);

    busy = 10;
    const failing = driveCloud.listFiles('').catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    expect(await failing).toSatisfy((err) => err instanceof DriveError && /Google Drive is busy/.test(err.message));
  });

  it('says plainly when the Drive is full, or the API was switched off', async () => {
    drive.limit = 10;
    await expect(driveCloud.upload('/Saves/big.zip', bytes('more than ten bytes'), { replaces: null, modified: 0 })).rejects.toThrow(/Your Google Drive is full\. Its room is shared with your Gmail and Google Photos/);
    drive.limit = 1 << 30;
    drive.apiEnabled = false;
    await expect(driveCloud.listFiles('')).rejects.toThrow(/Google Drive API is not switched on/);
  });

  it('sends a large file in pieces, and goes on from where Drive says a dropped piece got to', async () => {
    const data = new Uint8Array((8 << 20) * 2 + 7).map((_, index) => index % 253);
    const real = fetchThrough(drive);
    let drop = 1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      // The second piece arrives, but its answer does not.
      if (String(input).includes('upload_id') && (init?.headers as Record<string, string>)['Content-Range']?.startsWith('bytes 8388608-') && drop-- > 0) {
        await real(input, init);
        throw new TypeError('network');
      }
      return real(input, init);
    });
    const sent: number[] = [];
    const parent = (await snapshot(true)).roots[0] ?? null;
    expect(parent).toBeNull();
    const stored = await driveCloud.send('/Mods/Big.zip', new Blob([data]), { modified: Date.UTC(2026, 9, 1), replace: false, onProgress: (count) => sent.push(count) });
    expect(stored).toMatchObject({ path: '/Mods/Big.zip', size: data.length, modified: Date.UTC(2026, 9, 1) });
    expect(Buffer.compare(drive.file('/Mods/Big.zip')!.data, data)).toBe(0);
    expect(sent.at(-1)).toBe(data.length);
    // Three pieces, the second asked about after its answer was lost: nothing was sent twice.
    expect(drive.calls.filter((call) => call.startsWith('upload:'))).toEqual(['upload:resumable', 'upload:piece', 'upload:piece', 'upload:piece', 'upload:piece']);

    // Replacing: the new one is whole before the old one goes.
    await expect(driveCloud.send('/Mods/Big.zip', new Blob(['small']), { modified: 0, replace: false })).rejects.toSatisfy((err) => err instanceof CloudError && err.conflict);
    await driveCloud.send('/Mods/Big.zip', new Blob(['small']), { modified: 0, replace: true });
    expect(text(drive.file('/Mods/Big.zip')!.data)).toBe('small');
    expect(drive.paths).toEqual(['/Mods/Big.zip']);
  });

  it('writes a small file in one request, and a larger one in pieces', async () => {
    const root = await driveCloud.upload('/a.txt', bytes('a'), { replaces: null, modified: 0 });
    expect(drive.calls.at(-1)).toBe('upload:multipart');
    const big = new Uint8Array((5 << 20) + 1);
    await write({ id: root.id }, new Blob([big]), 0);
    expect(drive.calls.slice(-2)).toEqual(['upload:resumable', 'upload:piece']);
    expect(drive.file('/a.txt')!.data.length).toBe(big.length);
    await expect(sendInPieces({ id: 'drive-nothing' }, new Blob(['x']), { modified: 0 })).rejects.toSatisfy((err) => err instanceof DriveError && err.notFound);
  });

  it('says how much room the account has', async () => {
    drive.elsewhere = 1000;
    expect(await storage()).toEqual({ used: 1000, total: 15 * 2 ** 30 });
  });

  it('reads Google\'s own way of refusing', async () => {
    const said = (status: number, body: unknown) => failure(Response.json(body, { status }));
    expect((await said(404, { error: { code: 404, message: 'File not found: x.', errors: [{ reason: 'notFound' }] } })).notFound).toBe(true);
    expect((await said(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } })).message).toMatch(
      /leave the box for Drive ticked/,
    );
    expect((await said(500, { error: { code: 500, message: 'Internal Error' } })).message).toBe('Google Drive refused the request (Internal Error).');
  });
});
