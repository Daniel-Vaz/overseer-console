/**
 * The console's calls against the real Dropbox, to check that the stand-in
 * the other tests use (tests/fake-dropbox.ts) tells the truth about it.
 *
 * Skipped unless a token is given. Generate one on your Dropbox app's
 * Settings tab (after its file permissions are ticked and submitted) and run:
 *
 *   DROPBOX_TEST_TOKEN="<the token>" npx vitest run tests/unit/dropbox.live.test.ts
 *
 * It works in a folder of its own inside the app folder and removes it again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DropboxError, download, listFiles, remove, saveUrl, upload } from '../../src/lib/dropbox/api';
import { storeLink } from '../../src/lib/dropbox/link';

const token = process.env.DROPBOX_TEST_TOKEN;
const folder = `/overseer-live-test-${Date.now().toString(36)}`;
const zip = `${folder}/Saves/SLOT01.zip`;

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: ArrayBuffer) => new TextDecoder().decode(data);
const notFound = (err: unknown) => err instanceof DropboxError && err.notFound;
const conflict = (err: unknown) => err instanceof DropboxError && err.conflict;

describe.skipIf(!token)('the real Dropbox', () => {
  beforeAll(() => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    });
    // A link as the console would hold it, with the token standing in for one it fetched itself.
    storeLink({
      appKey: 'live-test',
      refreshToken: 'none',
      accessToken: token!,
      expiresAt: Date.now() + 3600_000,
      account: { id: '', name: 'live test', email: '' },
      linkedAt: Date.now(),
    });
  });

  afterAll(async () => {
    await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folder }),
    }).catch(() => undefined);
    vi.unstubAllGlobals();
  });

  it('answers the way the console counts on', async () => {
    await expect(listFiles(folder)).rejects.toSatisfy(notFound);

    // A new file, with the time the console says it was written at (whole seconds).
    const first = await upload(zip, bytes('one'), { replaces: null, modified: Date.UTC(2026, 9, 10, 20, 0, 0, 250) });
    expect(first).toMatchObject({ name: 'SLOT01.zip', size: 3, client_modified: '2026-10-10T20:00:00Z' });

    // Never over something that is not what was last seen there.
    await expect(upload(zip, bytes('two!'), { replaces: null, modified: Date.now() })).rejects.toSatisfy(conflict);
    const second = await upload(zip, bytes('two!'), { replaces: first.rev, modified: Date.UTC(2026, 9, 11, 21, 30) });
    expect(second.rev).not.toBe(first.rev);
    await expect(upload(zip, bytes('three'), { replaces: first.rev, modified: Date.now() })).rejects.toSatisfy(conflict);

    const listed = await listFiles(`${folder}/Saves`);
    expect(listed.map((file) => [file.name, file.rev, file.size, file.client_modified])).toEqual([['SLOT01.zip', second.rev, 4, '2026-10-11T21:30:00Z']]);
    expect(await listFiles(folder)).toEqual([]);
    expect((await listFiles(folder, true)).map((file) => file.path_display)).toEqual([zip]);

    // Whole, by the id that survives renaming; and in part, as games are copied.
    expect(text(await download(listed[0]!.id!))).toBe('two!');
    expect(text(await download(zip, { start: 1, end: 3 }))).toBe('wo');

    // Erasing only what is still the save that was synced.
    await expect(remove(zip, first.rev)).rejects.toSatisfy((err) => err instanceof DropboxError && err.status === 409 && !err.notFound);
    await remove(zip, second.rev);
    await expect(remove(zip, second.rev)).rejects.toSatisfy(notFound);
  }, 120_000);

  it('downloads a release from GitHub itself, through its redirect', async () => {
    // A small asset of a release the console installs (src/lib/mods/releases.ts), served the same way as the large ones.
    const url = 'https://github.com/HogLord69/olympus-2207-english/releases/download/v1.1/Olympus2207-FE-English-Patch.zip';
    const file = await saveUrl(`${folder}/Mods/patch.zip`, url);
    expect(file).toMatchObject({ name: 'patch.zip', size: 3_167_225 });
  }, 480_000);
});
