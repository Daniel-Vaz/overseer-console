/**
 * What the console does with the player's cloud, whichever it is: every case
 * here runs against the stand-in for Dropbox and against the one for Google
 * Drive. That the two clouds do the same is what this file is for.
 */
import 'fake-indexeddb/auto';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUDS, activeCloud } from '../../src/lib/cloud/clouds';
import { CloudError } from '../../src/lib/cloud/errors';
import { cloudGameFiles, cloudModFiles, listCloudMods } from '../../src/lib/cloud/games';
import type { Cloud } from '../../src/lib/cloud/provider';
import { planPut, runPut, type PutProgress } from '../../src/lib/cloud/put';
import { compareSaves, eraseCloudSave, fetchSave, isSynced, listCloudSaves, sendSave, surveySaves, type SlotStanding } from '../../src/lib/cloud/saves';
import { fromDropboxTime, toDropboxTime } from '../../src/lib/dropbox/api';
import { linkWithCode, prepareAuthorization } from '../../src/lib/dropbox/auth';
import { saveConfig as saveDropboxConfig } from '../../src/lib/dropbox/link';
import { pollCode, requestCode } from '../../src/lib/drive/auth';
import { saveConfig as saveDriveConfig } from '../../src/lib/drive/link';
import { forgetTree } from '../../src/lib/drive/tree';
import { HEADER_SIZE } from '../../src/lib/savefile';
import { deleteSave, exportSaves, listSaves, packSlot, readSaveArchive } from '../../src/lib/saves';
import { commitWithHistory, deleteVersions, listVersions } from '../../src/lib/storage/history';
import { ImportError, openArchives, planImport, type SourceFile } from '../../src/lib/storage/importer';
import { clearOverlay, type OverlayChanges } from '../../src/lib/storage/overlay';
import { FakeDropbox, fetchThrough } from '../fake-dropbox';
import { FakeDrive } from '../fake-drive';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, String(value));
  removeItem = (key: string) => void this.items.delete(key);
}

/** One cloud, as these tests use it. */
interface Harness {
  name: string;
  cloud: Cloud;
  /** A new stand-in behind fetch, with nothing linked to it. */
  reset(): void;
  link(): Promise<void>;
  /**
   * A file put in the console's folder earlier: in Dropbox by the player
   * with its own app, in Google Drive by the console on another device (the
   * only way a file there is in its sight).
   */
  put(path: string, data: Uint8Array | string, modified?: number): void;
  stored(path: string): { path: string; data: Uint8Array; modified: number; id: string; rev: string } | undefined;
  paths(): string[];
  calls(): string[];
  /** What planning a game costs: one listing, the last bytes of MASTER.DAT, and the settings file. */
  planning: string[];
  /** A time as the cloud keeps it. */
  kept(time: number): number;
  config(patch: { gamesFolder?: string; savesFolder?: string }): void;
  syncedKey: string;
}

let dropbox: FakeDropbox;
let drive: FakeDrive;

const DROPBOX: Harness = {
  name: 'Dropbox',
  cloud: CLOUDS.dropbox,
  reset() {
    dropbox = new FakeDropbox();
    vi.stubGlobal('fetch', fetchThrough(dropbox));
  },
  async link() {
    const authorization = await prepareAuthorization(dropbox.appKey);
    dropbox.approve(authorization.url);
    await linkWithCode(authorization, dropbox.code);
  },
  put: (path, data, modified) => void dropbox.put(path, data, modified === undefined ? undefined : toDropboxTime(modified)),
  stored(path) {
    const file = dropbox.files.get(path.toLowerCase());
    return file && { path: file.path, data: file.data, modified: fromDropboxTime(file.modified), id: file.id, rev: file.rev };
  },
  paths: () => [...dropbox.files.values()].map((file) => file.path).sort(),
  calls: () => dropbox.calls,
  planning: ['files/list_folder', 'files/download', 'files/download'],
  kept: (time) => Math.floor(time / 1000) * 1000,
  config: (patch) => void saveDropboxConfig(patch),
  syncedKey: 'overseer-console:dropbox:synced',
};

const DRIVE: Harness = {
  name: 'Google Drive',
  cloud: CLOUDS.drive,
  reset() {
    drive = new FakeDrive();
    forgetTree();
    vi.stubGlobal('fetch', fetchThrough(drive));
  },
  async link() {
    const code = await requestCode(drive.clientId);
    drive.approve(code.userCode);
    const linked = await pollCode(code, drive.clientSecret);
    if (typeof linked === 'string') throw new Error(`not linked: ${linked}`);
  },
  put(path, data, modified) {
    drive.put(path, data, modified === undefined ? undefined : new Date(modified).toISOString());
    // As another device would: after this one last looked.
    forgetTree();
  },
  stored(path) {
    const file = drive.file(path);
    return file && { path: drive.pathOf(file)!, data: file.data, modified: Number(file.appProperties.writtenAt) || Date.parse(file.modifiedTime), id: file.id, rev: file.headRevisionId };
  },
  paths: () => drive.paths,
  calls: () => drive.calls,
  planning: ['files.list', 'files.get:media', 'files.get:media'],
  kept: (time) => time,
  config: (patch) => void saveDriveConfig(patch),
  syncedKey: 'overseer-console:drive:synced',
};

const CLOUDS_TESTED = [DROPBOX, DRIVE];

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
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

const T1 = Date.UTC(2026, 9, 10, 20, 0, 0, 250);
const T2 = Date.UTC(2026, 9, 11, 21, 30, 0, 500);

function standingOf(standings: SlotStanding[], slot: number): SlotStanding {
  return standings.find((item) => item.slot === slot)!;
}

describe('which cloud', () => {
  it('is none until one is linked, and the one linked last should two tabs have linked one each', async () => {
    DROPBOX.reset();
    expect(activeCloud()).toBeNull();
    await DROPBOX.link();
    expect(activeCloud()?.id).toBe('dropbox');
    await new Promise((resolve) => setTimeout(resolve, 5));
    DRIVE.reset();
    await DRIVE.link();
    expect(activeCloud()?.id).toBe('drive');
  });
});

describe.each(CLOUDS_TESTED)('saves in $name', (cloud) => {
  /** A second device: nothing stored, nothing remembered, linked to the same cloud. */
  async function anotherBrowser(): Promise<void> {
    await clearOverlay('fo2');
    await deleteVersions('fo2');
    localStorage.removeItem(cloud.syncedKey);
    forgetTree();
  }

  beforeEach(async () => {
    cloud.reset();
    await cloud.link();
    await anotherBrowser();
  });

  it('compares slot by slot, trusting what both sides last shared over the clocks', () => {
    const there = (slot: number, rev: string, savedAt: number) => ({ slot, file: `id:${slot}`, rev, savedAt, bytes: 1 });
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
        there(1, 'a', T1),
        there(2, 'b', T1),
        there(3, 'c', T2),
        there(4, 'd2', T1),
        there(5, 'e', T2),
        // Never synced: only the clocks can tell. Dropbox keeps whole seconds.
        there(6, 'f', Math.floor(T1 / 1000) * 1000),
        there(7, 'g', T1),
        there(8, 'h', T1),
      ],
      {
        1: { rev: 'a', savedAt: T1 },
        // Saved again here since.
        2: { rev: 'b', savedAt: T1 },
        // Replaced in the cloud since.
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

    const stored = cloud.stored('/Saves/Fallout 2/SLOT03.zip')!;
    expect(stored.path).toBe('/Saves/Fallout 2/SLOT03.zip');
    expect(stored.modified).toBe(cloud.kept(T1));
    expect(Object.keys(unzipSync(stored.data))).toEqual(expect.arrayContaining(['SAVEGAME/SLOT03/SAVE.DAT', 'SAVEGAME/SLOT03/ARTEMPLE.SAV']));
    expect(await listCloudSaves('fo2')).toEqual([{ slot: 3, file: stored.id, rev: stored.rev, savedAt: cloud.kept(T1), bytes: stored.data.length }]);
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
    expect((await listVersions('fo2', 3))[0]).toMatchObject({ cause: cloud.cloud.cause, header: { description: 'before the temple' } });
  });

  it('will not upload over a save another device put there meanwhile', async () => {
    await commitWithHistory('fo2', save(3, 'mine', T1));
    const seen = (await surveySaves('fo2'))[0]!;
    cloud.put('/Saves/Fallout 2/SLOT03.zip', 'theirs');
    await expect(sendSave('fo2', seen)).rejects.toSatisfy((err) => err instanceof CloudError && err.conflict);
    expect(isSynced('fo2', 3)).toBe(false);
    expect(new TextDecoder().decode(cloud.stored('/Saves/Fallout 2/SLOT03.zip')!.data)).toBe('theirs');
  });

  it('leaves the slot alone when the zip in the cloud is not a save for it', async () => {
    await commitWithHistory('fo2', save(4, 'mine', T1));
    const other = zipSync({ 'SAVEGAME/SLOT03/SAVE.DAT': saveDat('another slot') });
    cloud.put('/Saves/Fallout 2/SLOT04.zip', other, T2);
    cloud.put('/Saves/Fallout 2/SLOT05.zip', 'not a zip at all', T2);
    cloud.put('/Saves/Fallout 2/notes.txt', 'ignored');

    const standings = await surveySaves('fo2');
    expect(standings.map((item) => [item.slot, item.standing])).toEqual([
      [4, 'newer-there'],
      [5, 'only-there'],
    ]);
    await expect(fetchSave('fo2', standingOf(standings, 4))).rejects.toThrow(new RegExp(`SLOT04\\.zip in ${cloud.name} could not be used.*does not hold SLOT04`));
    await expect(fetchSave('fo2', standingOf(standings, 5))).rejects.toThrow(new RegExp(`SLOT05\\.zip in ${cloud.name} could not be used.*not a zip archive`));
    expect(await listSaves('fo2')).toMatchObject([{ slot: 4, description: 'mine', versions: 0 }]);
  });

  it('takes the time from the cloud for a zip that does not say when it was saved', async () => {
    cloud.put('/Saves/Fallout 2/SLOT07.zip', zipSync({ 'SLOT07/SAVE.DAT': saveDat('from a desktop install') }), T2);
    await fetchSave('fo2', (await surveySaves('fo2'))[0]!);
    expect((await listSaves('fo2'))[0]).toMatchObject({ slot: 7, savedAt: cloud.kept(T2) });
    expect((await surveySaves('fo2'))[0]!.standing).toBe('same');
  });

  it('erasing a synced save erases it in the cloud too, unless that holds another save by now', async () => {
    await commitWithHistory('fo2', save(3, 'one', T1));
    await commitWithHistory('fo2', save(5, 'two', T1));
    for (const item of await surveySaves('fo2')) await sendSave('fo2', item);

    await deleteSave('fo2', 3);
    expect(await eraseCloudSave('fo2', 3)).toBe('erased');
    expect(cloud.stored('/Saves/Fallout 2/SLOT03.zip')).toBeUndefined();

    cloud.put('/Saves/Fallout 2/SLOT05.zip', 'put there by another device');
    await deleteSave('fo2', 5);
    expect(await eraseCloudSave('fo2', 5)).toBe('kept');
    expect(cloud.stored('/Saves/Fallout 2/SLOT05.zip')).toBeDefined();
    expect(isSynced('fo2', 5)).toBe(false);

    // Never synced: nothing to do, and nothing asked of the cloud.
    const calls = cloud.calls().length;
    expect(await eraseCloudSave('fo2', 9)).toBe('kept');
    expect(cloud.calls()).toHaveLength(calls);
  });

  it('keeps saves where the player said to', async () => {
    cloud.config({ savesFolder: '/Vault 13/Backups' });
    await commitWithHistory('fo1', { puts: save(1, 'water chip', T1).puts, deletes: [] });
    await sendSave('fo1', (await surveySaves('fo1'))[0]!);
    expect(cloud.paths()).toEqual(['/Vault 13/Backups/Fallout/SLOT01.zip']);
    await clearOverlay('fo1');
  });
});

describe('save archives', () => {
  beforeEach(async () => {
    await clearOverlay('fo2');
    await deleteVersions('fo2');
  });

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

    // An archive made for the cloud says when; one exported by hand leaves it to whoever asks.
    await (await readSaveArchive('fo2', new Blob([packed!.data as Uint8Array<ArrayBuffer>]), { keepTimes: true })).commit();
    expect((await listSaves('fo2'))[0]).toMatchObject({ savedAt: T1, files: 2 });
    await (await readSaveArchive('fo2', exported, { keepTimes: true, writtenAt: T2 })).commit();
    expect((await listSaves('fo2'))[0]).toMatchObject({ savedAt: T2, files: 2 });
  });

  it("refuses a save the game's engine cannot load", async () => {
    /** As the engines write it: version 1.1 (Fallout) or 1.2 (Fallout 2), release R. */
    const by = (minor: number) => {
      const data = saveDat('vault 13');
      const view = new DataView(data.buffer);
      view.setInt16(0x18, 1, false);
      view.setInt16(0x1a, minor, false);
      data[0x1c] = 'R'.charCodeAt(0);
      return data;
    };
    const fallout = new Blob([zipSync({ 'SAVEGAME/SLOT01/SAVE.DAT': by(1) })]);
    const fallout2 = new Blob([zipSync({ 'SAVEGAME/SLOT01/SAVE.DAT': by(2) })]);
    await expect(readSaveArchive('fo2', fallout)).rejects.toThrow('SLOT01 in that archive is a save of Fallout. Fallout 2 cannot load it.');
    await expect(readSaveArchive('fo1', fallout2)).rejects.toThrow('SLOT01 in that archive is a save of Fallout 2. Fallout cannot load it.');
    expect((await readSaveArchive('fo1', fallout)).slots).toEqual([1]);
    expect((await readSaveArchive('fo2', fallout2)).slots).toEqual([1]);
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
// Games and mods
// ---------------------------------------------------------------------

/** A Fallout 2 archive: the last four bytes hold the size of the whole file. */
function dat2(size = 64): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  view.setUint32(size - 8, 16, true);
  view.setUint32(size - 4, size, true);
  return data;
}

/** The files of a Fallout 2 folder, by their names in it. */
function fallout2(): Record<string, Uint8Array | string> {
  return {
    'master.dat': dat2(4096),
    'critter.dat': dat2(),
    'patch000.dat': dat2(),
    'fallout2.cfg': '[system]\r\nlanguage=german\r\n',
    'fallout2.exe': 'not wanted',
    'sound/music/01hub.acm': 'music',
  };
}

describe.each(CLOUDS_TESTED)('games in $name', (cloud) => {
  beforeEach(async () => {
    cloud.reset();
    await cloud.link();
  });

  function putFallout2(folder: string): void {
    for (const [name, data] of Object.entries(fallout2())) cloud.put(`${folder}/${name}`, data);
    cloud.put(`${folder}/data/SAVEGAME/SLOT01/SAVE.DAT`, saveDat('came with the folder'), Date.UTC(2026, 8, 30, 10));
  }

  it('finds the game wherever its folder was put, reading only what planning needs', async () => {
    putFallout2('/My Games/Fallout 2');
    cloud.put('/Saves/Fallout 2/SLOT03.zip', 'a save, not a game');
    forgetTree();
    const before = cloud.calls().length;

    const plan = await planImport(await cloudGameFiles('fo2'), 'fo2');
    expect(plan.game).toBe('fo2');
    expect(plan.root).toBe('My Games/Fallout 2');
    expect(plan.entries.map((entry) => entry.path).sort()).toEqual(['critter.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm']);
    expect(plan.totalBytes).toBe(4096 + 64 + 64 + 5);
    expect(plan.language).toBe('german');
    expect(plan.saves.map((entry) => [entry.path, entry.file.lastModified])).toEqual([['data/SAVEGAME/SLOT01/SAVE.DAT', Date.UTC(2026, 8, 30, 10)]]);
    expect(cloud.calls().slice(before)).toEqual(cloud.planning);

    // The files themselves are read piece by piece, when the copy asks.
    const master = plan.entries.find((entry) => entry.path === 'master.dat')!.file;
    expect(new Uint8Array(await master.slice(4088, 9999).arrayBuffer())).toHaveLength(8);
    expect(new Uint8Array(await master.slice(10, 10).arrayBuffer())).toHaveLength(0);
    expect(new Uint8Array(await master.arrayBuffer())).toEqual(dat2(4096));
  });

  it('finds a game kept as a zip at the top of the games folder', async () => {
    const zip = zipSync(Object.fromEntries(Object.entries(fallout2()).map(([name, data]) => [`Fallout 2/${name}`, typeof data === 'string' ? strToU8(data) : data])));
    cloud.put('/Fallout 2.zip', zip);
    // A zip deeper in, or among the saves, is no game's.
    cloud.put('/Extras/manual.zip', 'not opened');
    const plan = await planImport(await cloudGameFiles('fo2'), 'fo2');
    expect(plan.root).toBe('Fallout 2');
    expect(plan.entries.map((entry) => entry.path).sort()).toEqual(['critter.dat', 'master.dat', 'patch000.dat', 'sound/music/01hub.acm']);
    expect(new Uint8Array(await plan.entries.find((entry) => entry.path === 'master.dat')!.file.arrayBuffer())).toEqual(dat2(4096));
  });

  it('looks only below the folder the player set', async () => {
    putFallout2('/Elsewhere/Fallout 2');
    putFallout2('/Games/Fallout 2');
    cloud.config({ gamesFolder: '/Games' });
    expect((await planImport(await cloudGameFiles('fo2'), 'fo2')).root).toBe('Fallout 2');
  });

  it('says where it looked when there is nothing to find', async () => {
    cloud.put('/Saves/Fallout 2/SLOT03.zip', 'a save, not a game');
    await expect(cloudGameFiles('fo2')).rejects.toSatisfy((err) => err instanceof ImportError && err.message.startsWith(`No MASTER.DAT in ${cloud.cloud.home} in your ${cloud.name}`));
    cloud.config({ gamesFolder: '/Games' });
    await expect(cloudGameFiles('fo2')).rejects.toSatisfy((err) => err instanceof ImportError && /There is no folder \/Games/.test(err.message));
  });

  it('lists the mods in the Mods folder, a zip or a folder each, and hands one over', async () => {
    cloud.put('/Mods/Fallout1in2.zip', zipSync({ 'Fallout1in2/mods/fo1_base.dat': strToU8('base') }));
    cloud.put('/Mods/Some Mod/mods/some.dat', 'some');
    cloud.put('/Mods/Some Mod/readme.txt', 'about it');
    // A loose file among the mods is none of them.
    cloud.put('/Mods/readme.txt', 'what is in here');
    const mods = await listCloudMods();
    expect(mods.map(({ name, zip, files }) => ({ name, zip, files }))).toEqual([
      { name: 'Fallout1in2.zip', zip: true, files: 1 },
      { name: 'Some Mod', zip: false, files: 2 },
    ]);
    expect((await cloudModFiles('Fallout1in2.zip')).map((file) => file.path)).toEqual(['Fallout1in2/mods/fo1_base.dat']);
    expect((await cloudModFiles('Some Mod')).map((file) => file.path).sort()).toEqual(['Some Mod/mods/some.dat', 'Some Mod/readme.txt']);
    await expect(cloudModFiles('Gone.zip')).rejects.toBeInstanceOf(ImportError);
  });

  it('has no mods while there is no Mods folder', async () => {
    expect(await listCloudMods()).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Put in your cloud
// ---------------------------------------------------------------------

/** Files as a folder picked on this device hands them over. */
function picked(files: Record<string, Uint8Array | string>, folder: string): SourceFile[] {
  return Object.entries(files).map(([name, data]) => ({
    path: `${folder}/${name}`,
    file: new File([typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>)], name.split('/').pop()!, { lastModified: T1 }),
  }));
}

describe.each(CLOUDS_TESTED)('putting a game or a mod in $name', (cloud) => {
  beforeEach(async () => {
    cloud.reset();
    await cloud.link();
  });

  it('packs a game folder into one zip that a game deck then finds there', async () => {
    const progress: PutProgress[] = [];
    const plan = await planPut(picked({ ...fallout2(), 'Thumbs.db': 'junk' }, 'Fallout 2'), 'game');
    expect(plan).toMatchObject({ kind: 'game', name: 'Fallout 2.zip', path: '/Fallout 2.zip', existing: null });
    const stored = await runPut(plan, (step) => progress.push(step));
    expect(stored).toMatchObject({ name: 'Fallout 2.zip', path: '/Fallout 2.zip' });
    expect(progress.some((step) => step.phase === 'packing')).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: 'sending', doneBytes: stored.size, totalBytes: stored.size });

    // What arrived is a zip of the folder as it was picked, junk left out.
    const zip = unzipSync(cloud.stored('/Fallout 2.zip')!.data);
    expect(Object.keys(zip).sort()).toEqual(['Fallout 2/critter.dat', 'Fallout 2/fallout2.cfg', 'Fallout 2/fallout2.exe', 'Fallout 2/master.dat', 'Fallout 2/patch000.dat', 'Fallout 2/sound/music/01hub.acm']);
    expect(zip['Fallout 2/master.dat']).toEqual(dat2(4096));

    // Another device's deck loads it from there.
    forgetTree();
    const plan2 = await planImport(await cloudGameFiles('fo2'), 'fo2');
    expect(plan2).toMatchObject({ game: 'fo2', root: 'Fallout 2', language: 'german' });
  });

  it('puts a mod zip in the Mods folder as it is, and asks before it replaces one', async () => {
    const zip = zipSync({ 'Fallout1in2/mods/fo1_base.dat': strToU8('base') });
    const sources = [{ path: 'Fallout1in2.zip', file: new File([zip], 'Fallout1in2.zip', { lastModified: T1 }) }];
    const plan = await planPut(sources, 'mod');
    expect(plan).toMatchObject({ name: 'Fallout1in2.zip', path: '/Mods/Fallout1in2.zip', files: null, existing: null });
    await runPut(plan, () => undefined);
    expect(cloud.stored('/Mods/Fallout1in2.zip')!.data).toEqual(zip);
    expect((await listCloudMods()).map((mod) => mod.name)).toEqual(['Fallout1in2.zip']);

    // Once there, the next one of that name is said to replace it.
    forgetTree();
    const again = await planPut([{ path: 'Fallout1in2.zip', file: new File(['newer'], 'Fallout1in2.zip') }], 'mod');
    expect(again.existing).toMatchObject({ name: 'Fallout1in2.zip', size: zip.length });
    await runPut(again, () => undefined);
    expect(new TextDecoder().decode(cloud.stored('/Mods/Fallout1in2.zip')!.data)).toBe('newer');
    expect(cloud.paths()).toEqual(['/Mods/Fallout1in2.zip']);
  });

  it('will not put a game that holds no game, or one there is no room for', async () => {
    await expect(planPut(picked({ 'readme.txt': 'hello' }, 'Not a game'), 'game')).rejects.toThrow(/There is no MASTER\.DAT in what you picked/);
    await expect(planPut([{ path: 'empty.zip', file: new File([zipSync({ 'a.txt': strToU8('a') })], 'empty.zip') }], 'game')).rejects.toThrow(/There is no MASTER\.DAT in empty\.zip/);
    if (cloud === DROPBOX) dropbox.allocated = 1000;
    else drive.limit = 1000;
    await expect(planPut(picked(fallout2(), 'Fallout 2'), 'game')).rejects.toThrow(new RegExp(`Your ${cloud.name} has .* free, and this game needs`));
  });

  it('can be stopped, and leaves nothing half there', async () => {
    const stopper = new AbortController();
    const plan = await planPut(picked(fallout2(), 'Fallout 2'), 'game');
    const run = runPut(
      plan,
      (step) => {
        if (step.phase === 'packing') stopper.abort();
      },
      stopper.signal,
    );
    await expect(run).rejects.toSatisfy((err) => err instanceof DOMException && err.name === 'AbortError');
    expect(cloud.paths()).toEqual([]);
  });
});

describe('the zips the console packs', () => {
  it('open again, also in the 64-bit form for what is larger than 4 GB', async () => {
    const { packZip } = await import('../../src/lib/zipwriter');
    const files = [
      { path: 'Fallout 2/master.dat', file: new Blob([dat2(5000)]), modified: T1 },
      { path: 'Fallout 2/sound/music/ödland.acm', file: new Blob(['music']), modified: T2 },
      { path: 'Fallout 2/empty.txt', file: new Blob([]), modified: T2 },
    ];
    for (const zip64 of [false, true]) {
      const zip = await packZip(files, { zip64 });
      const bytes = new Uint8Array(await zip.arrayBuffer());
      // fflate checks every checksum.
      const unzipped = unzipSync(bytes);
      expect(Object.keys(unzipped)).toEqual(['Fallout 2/master.dat', 'Fallout 2/sound/music/ödland.acm', 'Fallout 2/empty.txt']);
      expect(unzipped['Fallout 2/master.dat']).toEqual(dat2(5000));
      // And the console's own reader, which picks files out where they lie.
      const opened = await openArchives([{ path: 'Fallout 2.zip', file: Object.assign(zip, { lastModified: 0 }) }]);
      expect(opened.map((file) => [file.path, file.file.size])).toEqual([
        ['Fallout 2/master.dat', 5000],
        ['Fallout 2/sound/music/ödland.acm', 5],
        ['Fallout 2/empty.txt', 0],
      ]);
      expect(await opened[1]!.file.text()).toBe('music');
    }
  });
});
