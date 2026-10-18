/**
 * The console's calls against the real Google Drive, to check that the
 * stand-in the other tests use (tests/fake-drive.ts) tells the truth about it.
 *
 * Skipped unless a token is given. Get one with your own client (of the type
 * "TVs and Limited Input devices") and run:
 *
 *   node tests/drive-token.mjs "<client id>" "<client secret>"
 *   GOOGLE_DRIVE_TEST_TOKEN="<the token>" npx vitest run tests/unit/drive.live.test.ts
 *
 * It works in a folder of its own inside the console's folder (making that
 * folder if the Drive has none yet) and removes what it made again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CloudError } from '../../src/lib/cloud/errors';
import { deleteForever, download, storage } from '../../src/lib/drive/api';
import { driveCloud } from '../../src/lib/drive/cloud';
import { storeLink } from '../../src/lib/drive/link';
import { forgetTree, snapshot } from '../../src/lib/drive/tree';

const token = process.env.GOOGLE_DRIVE_TEST_TOKEN;
const folder = `/overseer-live-test-${Date.now().toString(36)}`;
const zip = `${folder}/Saves/SLOT01.zip`;

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: ArrayBuffer) => new TextDecoder().decode(data);
const notFound = (err: unknown) => err instanceof CloudError && err.notFound;
const conflict = (err: unknown) => err instanceof CloudError && err.conflict;

describe.skipIf(!token)('the real Google Drive', () => {
  /** Whether the console's own folder was there before: if not, the test made it, and takes it away again. */
  let hadRoot = true;

  beforeAll(async () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    });
    // A link as the console would hold it, with the token standing in for one it fetched itself.
    storeLink({
      clientId: 'live-test',
      clientSecret: 'none',
      refreshToken: 'none',
      accessToken: token!,
      expiresAt: Date.now() + 3600_000,
      account: { name: 'live test', email: '' },
      linkedAt: Date.now(),
    });
    forgetTree();
    hadRoot = (await snapshot(true)).roots.length > 0;
  });

  afterAll(async () => {
    forgetTree();
    const tree = await snapshot(true).catch(() => null);
    for (const made of tree?.folders(folder) ?? []) await deleteForever(made.id).catch(() => undefined);
    if (!hadRoot) for (const root of tree?.roots ?? []) await deleteForever(root.id).catch(() => undefined);
    vi.unstubAllGlobals();
  });

  it('answers the way the console counts on', async () => {
    await expect(driveCloud.listFiles(folder)).rejects.toSatisfy(notFound);

    // A new file, with the time the console says it was written at, to the millisecond.
    const first = await driveCloud.upload(zip, bytes('one'), { replaces: null, modified: Date.UTC(2026, 9, 10, 20, 0, 0, 250) });
    expect(first).toMatchObject({ name: 'SLOT01.zip', size: 3, modified: Date.UTC(2026, 9, 10, 20, 0, 0, 250) });
    expect(first.rev).toBeTruthy();

    // Never over something that is not what was last seen there.
    await expect(driveCloud.upload(zip, bytes('two!'), { replaces: null, modified: Date.now() })).rejects.toSatisfy(conflict);
    const second = await driveCloud.upload(zip, bytes('two!'), { replaces: first.rev, modified: Date.UTC(2026, 9, 11, 21, 30) });
    expect(second.rev).not.toBe(first.rev);
    expect(second.id).toBe(first.id);
    await expect(driveCloud.upload(zip, bytes('three'), { replaces: first.rev, modified: Date.now() })).rejects.toSatisfy(conflict);

    forgetTree();
    const listed = await driveCloud.listFiles(`${folder}/Saves`);
    expect(listed.map((file) => [file.name, file.rev, file.size, file.modified])).toEqual([['SLOT01.zip', second.rev, 4, Date.UTC(2026, 9, 11, 21, 30)]]);
    expect(await driveCloud.listFiles(folder)).toEqual([]);
    expect((await driveCloud.listFiles(folder, true)).map((file) => file.path)).toEqual([zip]);

    // Whole, by its id; and in part, as games are copied.
    expect(text(await download(listed[0]!.id))).toBe('two!');
    expect(text(await download(listed[0]!.id, { start: 1, end: 3 }))).toBe('wo');

    // A large file in pieces: Drive says between them how much it holds.
    const big = new Uint8Array((8 << 20) + 1000).map((_, index) => index % 251);
    const sent = await driveCloud.send(`${folder}/Mods/Big.zip`, new Blob([big]), { modified: Date.UTC(2026, 9, 1), replace: false });
    expect(sent).toMatchObject({ name: 'Big.zip', size: big.length, modified: Date.UTC(2026, 9, 1) });
    const seam = new Uint8Array(await download(sent.id, { start: (8 << 20) - 2, end: (8 << 20) + 2 }));
    expect([...seam]).toEqual([...big.slice((8 << 20) - 2, (8 << 20) + 2)]);
    await expect(driveCloud.send(`${folder}/Mods/Big.zip`, new Blob(['small']), { modified: 0, replace: false })).rejects.toSatisfy(conflict);
    const replaced = await driveCloud.send(`${folder}/Mods/Big.zip`, new Blob(['small']), { modified: 0, replace: true });
    forgetTree();
    expect((await driveCloud.listFiles(`${folder}/Mods`)).map((file) => [file.id, file.size])).toEqual([[replaced.id, 5]]);

    // Erasing only what is still the save that was synced.
    await expect(driveCloud.remove(zip, first.rev)).rejects.toSatisfy((err) => err instanceof CloudError && err.status === 409 && !err.notFound);
    await driveCloud.remove(zip, second.rev);
    await expect(driveCloud.remove(zip, second.rev)).rejects.toSatisfy(notFound);

    // Room, where the account has a limit.
    const room = await storage();
    if (room) expect(room.total).toBeGreaterThan(room.used);
  }, 180_000);
});
