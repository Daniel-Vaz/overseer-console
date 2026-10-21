/**
 * The releases of known mods the console installs by itself (releases.ts),
 * and getting one through a cloud that downloads it (install.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUDS } from '../../src/lib/cloud/clouds';
import { saveUrlTiming } from '../../src/lib/dropbox/api';
import { linkWithCode, prepareAuthorization } from '../../src/lib/dropbox/auth';
import { KNOWN_MODS, isKnownMod } from '../../src/lib/mods/catalog';
import { cloudFetches, fetchIntoCloud, releaseInCloud } from '../../src/lib/mods/install';
import { MOD_RELEASES, isOlder, matchRelease, type ModRelease } from '../../src/lib/mods/releases';
import { ImportError } from '../../src/lib/storage/plan';
import { FakeDropbox, fetchThrough } from '../fake-dropbox';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, String(value));
  removeItem = (key: string) => void this.items.delete(key);
}

describe('the releases the console installs', () => {
  const releases = Object.entries(MOD_RELEASES) as [string, ModRelease][];

  it('are of mods it knows, as their own zips name them', () => {
    expect(releases.map(([id]) => id).sort()).toEqual(['ettu', 'olympus', 'resurrection', 'rpu', 'sonora']);
    for (const [id, release] of releases) {
      expect(isKnownMod(id) && release.mod).toBe(id);
      const known = KNOWN_MODS[release.mod];
      expect(known.names.test(release.file), release.file).toBe(true);
      expect(release.url.endsWith(`/${release.file}`), release.url).toBe(true);
      expect(release.url.startsWith('https://')).toBe(true);
      expect(release.bytes).toBeGreaterThan(100 << 20);
      // Where the zip's name says the version, it says this one.
      const said = known.version?.exec(release.file)?.[1]?.replace(/_/g, '.');
      if (said) expect(said).toBe(release.version);
      if (release.github) {
        expect(release.url).toContain(`github.com/${release.github.repo}/releases/download/`);
        expect(release.github.asset.test(release.file)).toBe(true);
      }
    }
  });

  it('tell the file handed over by its size', () => {
    const release = MOD_RELEASES.resurrection!;
    expect(matchRelease(release, { name: 'FoRes_EN_1_5.zip', size: release.bytes })).toBe('same');
    expect(matchRelease(release, { name: 'renamed.zip', size: release.bytes })).toBe('same');
    expect(matchRelease(release, { name: 'FoRes_EN_1_5 (1).zip', size: 1000 })).toBe('other-size');
    expect(matchRelease(release, { name: 'fores_en_1_5.ZIP', size: 1000 })).toBe('other-size');
    expect(matchRelease(release, { name: 'rpu_v2.4.34.zip', size: 1000 })).toBe('other-name');
  });

  it('say whether what is loaded is older', () => {
    const release = { ...MOD_RELEASES.rpu!, version: '2.4.34' };
    expect(isOlder('2.4.33', release)).toBe(true);
    expect(isOlder('2.3.34', release)).toBe(true);
    expect(isOlder('2.4.34', release)).toBe(false);
    expect(isOlder('2.5', release)).toBe(false);
    expect(isOlder(undefined, release)).toBe(false);
    expect(isOlder('1.16.3E', { ...release, version: '1.16.4E' })).toBe(true);
    expect(isOlder('1.16', { ...release, version: '1.16.4E' })).toBe(true);
  });
});

describe('a release downloaded by Dropbox', () => {
  let dropbox: FakeDropbox;
  const release: ModRelease = {
    mod: 'resurrection',
    version: '1.5',
    file: 'FoRes_EN_1_5.zip',
    url: 'https://bitbucket.org/resurrection/fallout-resurrection/downloads/FoRes_EN_1_5.zip',
    bytes: 12,
  };
  const zip = new TextEncoder().encode('PK zip bytes');
  const cloud = CLOUDS.dropbox;

  beforeEach(async () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    dropbox = new FakeDropbox();
    vi.stubGlobal('fetch', fetchThrough(dropbox));
    const authorization = await prepareAuthorization(dropbox.appKey);
    dropbox.approve(authorization.url);
    await linkWithCode(authorization, dropbox.code);
    saveUrlTiming.poll = 1;
    // The address its makers give, sent on to where the file is.
    dropbox.web.set(release.url, { redirect: 'https://bbuseruploads.s3.amazonaws.com/signed/FoRes_EN_1_5.zip' });
    dropbox.web.set('https://bbuseruploads.s3.amazonaws.com/signed/FoRes_EN_1_5.zip', zip);
  });

  afterEach(() => {
    saveUrlTiming.poll = 3000;
    vi.unstubAllGlobals();
  });

  it('only by a cloud that downloads', () => {
    expect(cloudFetches(CLOUDS.dropbox)).toBe(true);
    expect(cloudFetches(CLOUDS.drive)).toBe(false);
    expect(cloudFetches(null)).toBe(false);
  });

  it('lands in the Mods folder, and is not downloaded twice', async () => {
    dropbox.saveUrlPolls = 3;
    const started = vi.fn();
    const file = await fetchIntoCloud(release, cloud, undefined, started);
    expect(started).toHaveBeenCalledOnce();
    expect(file).toMatchObject({ name: 'FoRes_EN_1_5.zip', path: '/Mods/FoRes_EN_1_5.zip', size: 12 });
    expect(dropbox.saved).toEqual([{ path: '/Mods/FoRes_EN_1_5.zip', url: release.url }]);
    expect(dropbox.calls.filter((call) => call === 'files/save_url/check_job_status')).toHaveLength(4);

    const again = await fetchIntoCloud(release, cloud, undefined, started);
    expect(again.id).toBe(file.id);
    expect(started).toHaveBeenCalledOnce();
    expect(dropbox.saved).toHaveLength(1);
  });

  it('is found under another name at its size', async () => {
    dropbox.put('/Mods/fores.zip', zip);
    dropbox.put('/Mods/other.zip', 'not it');
    expect((await releaseInCloud(release, cloud))?.name).toBe('fores.zip');
    expect((await fetchIntoCloud(release, cloud)).name).toBe('fores.zip');
    expect(dropbox.saved).toHaveLength(0);
  });

  it('goes beside a different file of its name', async () => {
    dropbox.put('/Mods/FoRes_EN_1_5.zip', 'an older version');
    const file = await fetchIntoCloud(release, cloud);
    expect(file.path).toBe('/Mods/FoRes_EN_1_5 (1).zip');
  });

  it('says so when the download fails or is not the file', async () => {
    dropbox.web.clear();
    await expect(fetchIntoCloud(release, cloud)).rejects.toThrow(/could not download it from bitbucket\.org/);

    dropbox.web.set(release.url, new TextEncoder().encode('<html>sign in</html>'));
    await expect(fetchIntoCloud(release, cloud)).rejects.toSatisfy((err) => err instanceof ImportError && /not the 12 B/.test(err.message));
  });

  it('can be stopped while Dropbox works', async () => {
    dropbox.saveUrlPolls = 1000;
    const stopper = new AbortController();
    const going = fetchIntoCloud(release, cloud, stopper.signal);
    setTimeout(() => stopper.abort(), 20);
    await expect(going).rejects.toMatchObject({ name: 'AbortError' });
  });
});
