import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { HEADER_SIZE, slotPrefix } from '../../src/lib/savefile';
import { deleteSave, listSaves } from '../../src/lib/saves';
import {
  KEEP_RECENT,
  MAX_VERSIONS,
  commitWithHistory,
  deleteVersions,
  listVersions,
  readVersionSave,
  replaceSlot,
  restoreVersion,
  versionsToKeep,
} from '../../src/lib/storage/history';
import { clearOverlay, listOverlay, type OverlayChanges } from '../../src/lib/storage/overlay';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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

async function blobCount(): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('overseer-console-history');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('blobs').objectStore('blobs').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function slotDescription(slot: number): Promise<string | undefined> {
  return (await listSaves('fo2')).find((item) => item.slot === slot)?.description;
}

describe('versionsToKeep', () => {
  const at = (...minutesAgo: number[]) => minutesAgo.map((minutes) => ({ id: -minutes, replacedAt: -minutes * MINUTE }));
  const kept = (versions: { id: number; replacedAt: number }[]) => [...versionsToKeep(versions, 0)].map((id) => -id).sort((a, b) => a - b);

  it('always keeps the latest few', () => {
    expect(kept(at(1, 2, 3))).toEqual([1, 2, 3]);
    expect(KEEP_RECENT).toBe(3);
  });

  it('keeps one older version per span of time, the oldest of each', () => {
    // 4..9 minutes old share a span: only the oldest stays.
    expect(kept(at(1, 2, 3, 4, 5, 9))).toEqual([1, 2, 3, 9]);
    // One in each span up to 40 hours, and the newest of everything older.
    const hours = (n: number) => n * 60;
    expect(kept(at(1, 2, 3, 8, 20, 25, 70, hours(3), hours(10), hours(30), hours(50), hours(900)))).toEqual([
      1, 2, 3, 8, 25, 70, hours(3), hours(10), hours(30), hours(50),
    ]);
  });

  it('never keeps more than its limit, however often the player saves', () => {
    // A quick save every minute for three days.
    let versions: { id: number; replacedAt: number }[] = [];
    for (let now = 0; now <= 72 * HOUR; now += MINUTE) {
      versions.push({ id: now, replacedAt: now });
      const keep = versionsToKeep(versions, now);
      versions = versions.filter((version) => keep.has(version.id));
      expect(versions.length).toBeLessThanOrEqual(MAX_VERSIONS);
    }
    // The trail reaches from minutes to more than a day back.
    const ages = versions.map((version) => (72 * HOUR - version.replacedAt) / MINUTE).sort((a, b) => a - b);
    expect(ages.slice(0, 3)).toEqual([0, 1, 2]);
    expect(ages.length).toBe(MAX_VERSIONS);
    expect(ages.at(-1)!).toBeGreaterThan(40 * 60);
    expect(ages.some((age) => age >= 10 && age < 30)).toBe(true);
    expect(ages.some((age) => age >= 90 && age < 270)).toBe(true);
  });
});

describe('save history', () => {
  beforeEach(async () => {
    await clearOverlay('fo2');
    await deleteVersions('fo2');
  });

  it('keeps what a slot held when the game saves over it', async () => {
    await commitWithHistory('fo2', save(1, 'first', 1000, { 'ARTEMPLE.SAV': [1, 2, 3] }));
    expect(await listVersions('fo2', 1)).toEqual([]);

    await commitWithHistory('fo2', save(1, 'second', 2000, { 'ARTEMPLE.SAV': [1, 2, 3], 'ARCAVES.SAV': [9] }));
    const versions = await listVersions('fo2', 1);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe(1000);
    expect(versions[0]!.cause).toBe('save');
    expect(versions[0]!.header.description).toBe('first');
    expect(versions[0]!.files.map((file) => file.path).sort()).toEqual(['data/SAVEGAME/SLOT01/ARTEMPLE.SAV', 'data/SAVEGAME/SLOT01/SAVE.DAT']);
    expect(await slotDescription(1)).toBe('second');
    expect((await listSaves('fo2'))[0]!.versions).toBe(1);
  });

  it('leaves other slots and other files alone', async () => {
    await commitWithHistory('fo2', save(1, 'one', 1000));
    await commitWithHistory('fo2', save(2, 'two', 2000));
    await commitWithHistory('fo2', { puts: [{ key: 'fallout2.cfg', path: 'fallout2.cfg', mtime: 3000, data: new Uint8Array([1]) }], deletes: [] });
    expect(await listVersions('fo2', 1)).toEqual([]);
    expect(await listVersions('fo2', 2)).toEqual([]);
    expect((await listOverlay('fo2')).length).toBe(3);
  });

  it('stores a file once, however many versions contain it', async () => {
    const maps = { 'ARTEMPLE.SAV': [1, 2, 3], 'ARCAVES.SAV': [4, 5, 6] };
    for (let n = 1; n <= 4; n++) await commitWithHistory('fo2', save(1, `save ${n}`, n * 1000, maps));
    expect(await listVersions('fo2', 1)).toHaveLength(3);
    // Three different SAVE.DATs, two maps that never changed.
    expect(await blobCount()).toBe(5);
  });

  it('rolls a slot back, and keeps what it replaced', async () => {
    await commitWithHistory('fo2', save(1, 'good', 1000, { 'ARTEMPLE.SAV': [1] }));
    await commitWithHistory('fo2', save(1, 'dead end', 2000, { 'ARTEMPLE.SAV': [2], 'ARCAVES.SAV': [3] }));

    await restoreVersion('fo2', 1, 1000);
    expect(await slotDescription(1)).toBe('good');
    // Exactly the files of that version: the newer save's extra map is gone.
    const files = (await listOverlay('fo2', slotPrefix(1))).map((entry) => entry.path).sort();
    expect(files).toEqual(['data/SAVEGAME/SLOT01/ARTEMPLE.SAV', 'data/SAVEGAME/SLOT01/SAVE.DAT']);
    expect((await listOverlay('fo2', slotPrefix(1))).find((entry) => entry.key.endsWith('artemple.sav'))!.data).toEqual(new Uint8Array([1]));

    // Going back can be undone.
    const versions = await listVersions('fo2', 1);
    expect(versions.map((version) => [version.header.description, version.cause])).toEqual([['dead end', 'restore']]);
    await restoreVersion('fo2', 1, 2000);
    expect(await slotDescription(1)).toBe('dead end');
    expect((await listVersions('fo2', 1)).map((version) => version.header.description)).toEqual(['good']);
  });

  it('treats a save that was rolled back to as the freshest history', async () => {
    const now = Date.now();
    for (let n = 1; n <= 5; n++) await commitWithHistory('fo2', save(1, `save ${n}`, now - (10 - n) * HOUR));
    await restoreVersion('fo2', 1, now - 9 * HOUR); // back to "save 1"
    await commitWithHistory('fo2', save(1, 'played on', now));
    const versions = await listVersions('fo2', 1);
    expect(versions.map((version) => version.header.description)).toContain('save 1');
    expect(versions.map((version) => version.header.description)).toContain('save 5');
  });

  it('keeps the replaced save when an archive is restored over a slot', async () => {
    await commitWithHistory('fo2', save(3, 'mine', 1000));
    await replaceSlot('fo2', 3, save(3, 'from archive', 5000).puts, 'import');
    expect(await slotDescription(3)).toBe('from archive');
    const versions = await listVersions('fo2', 3);
    expect(versions.map((version) => [version.header.description, version.cause])).toEqual([['mine', 'import']]);
    const main = await readVersionSave(versions[0]!);
    expect(main).toHaveLength(HEADER_SIZE + 16);
  });

  it('thins out old versions and drops their files', async () => {
    const start = Date.UTC(2026, 0, 1);
    const realNow = Date.now;
    try {
      for (let n = 0; n < 40; n++) {
        Date.now = () => start + n * MINUTE;
        await commitWithHistory('fo2', save(1, `save ${n}`, start + n * MINUTE, { 'MAP.SAV': [n] }));
      }
    } finally {
      Date.now = realNow;
    }
    const versions = await listVersions('fo2', 1);
    expect(versions.length).toBeLessThanOrEqual(MAX_VERSIONS);
    expect(versions.length).toBeGreaterThanOrEqual(KEEP_RECENT + 2);
    expect(versions.slice(0, 3).map((version) => version.header.description)).toEqual(['save 38', 'save 37', 'save 36']);
    // Two files per remaining version, nothing left over from dropped ones.
    expect(await blobCount()).toBe(versions.length * 2);
  });

  it('forgets the history of a slot that is erased', async () => {
    await commitWithHistory('fo2', save(1, 'a', 1000));
    await commitWithHistory('fo2', save(1, 'b', 2000));
    await commitWithHistory('fo2', save(2, 'c', 3000));
    await commitWithHistory('fo2', save(2, 'd', 4000));
    await deleteSave('fo2', 1);
    expect(await listVersions('fo2', 1)).toEqual([]);
    expect(await listVersions('fo2', 2)).toHaveLength(1);
    expect(await blobCount()).toBe(1);
    expect((await listSaves('fo2')).map((item) => item.slot)).toEqual([2]);
  });

  it('does not keep a slot that holds no readable save', async () => {
    await commitWithHistory('fo2', {
      puts: [{ key: 'data/savegame/slot01/save.dat', path: 'data/SAVEGAME/SLOT01/SAVE.DAT', mtime: 1000, data: new Uint8Array(64) }],
      deletes: [],
    });
    await commitWithHistory('fo2', save(1, 'real', 2000));
    expect(await listVersions('fo2', 1)).toEqual([]);
    expect(await slotDescription(1)).toBe('real');
  });
});

describe('file contents', () => {
  beforeEach(async () => {
    await clearOverlay('fo2');
    await deleteVersions('fo2');
  });

  it('come back as plain bytes even when the engine handed over signed ones', async () => {
    // The engines' file system holds small files as an Int8Array.
    const signed = new Int8Array([-1, -128, 0, 127, 31, -117]) as unknown as Uint8Array;
    const changes = save(4, 'signed', 1000);
    changes.puts.push({ key: 'data/savegame/slot04/automap.sav', path: 'data/SAVEGAME/SLOT04/AUTOMAP.SAV', mtime: 1000, data: signed });
    await commitWithHistory('fo2', changes);

    const stored = (await listOverlay('fo2', slotPrefix(4))).find((entry) => entry.key.endsWith('automap.sav'))!;
    expect(stored.data).toBeInstanceOf(Uint8Array);
    expect([...stored.data!]).toEqual([255, 128, 0, 127, 31, 139]);
  });

  it('survive an export to a zip archive and back', async () => {
    const { unzipSync } = await import('fflate');
    const { exportSaves } = await import('../../src/lib/saves');
    const bytes = Uint8Array.from({ length: 2217 }, (_, i) => (i * 7919 + 13) & 255);
    const changes = save(4, 'export me', 1000);
    changes.puts.push({
      key: 'data/savegame/slot04/automap.sav',
      path: 'data/SAVEGAME/SLOT04/AUTOMAP.SAV',
      mtime: Date.now(),
      data: new Int8Array(bytes.buffer) as unknown as Uint8Array,
    });
    changes.puts[0]!.mtime = Date.now();
    await commitWithHistory('fo2', changes);

    const archive = unzipSync(new Uint8Array(await (await exportSaves('fo2', 4)).arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual(['README.txt', 'SAVEGAME/SLOT04/AUTOMAP.SAV', 'SAVEGAME/SLOT04/SAVE.DAT']);
    expect(archive['SAVEGAME/SLOT04/AUTOMAP.SAV']).toEqual(bytes);
  });
});
