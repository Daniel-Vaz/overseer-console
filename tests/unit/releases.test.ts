/**
 * The releases of known mods the console installs by itself (releases.ts),
 * and getting one through a cloud that downloads it (install.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUDS } from '../../src/lib/cloud/clouds';
import { saveUrlTiming } from '../../src/lib/dropbox/api';
import { linkWithCode, prepareAuthorization } from '../../src/lib/dropbox/auth';
import { KNOWN_MODS, KNOWN_MOD_IDS, isKnownMod } from '../../src/lib/mods/catalog';
import { cloudFetches, fetchIntoCloud, looksLikeMod, releaseInCloud } from '../../src/lib/mods/install';
import { MOD_RELEASES, cloudCanFetch, isOlder, isZip, matchRelease, type ModRelease, type ZipRelease } from '../../src/lib/mods/releases';
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

  it('are one for each mod it knows, of the right kind', () => {
    expect(releases.map(([id]) => id).sort()).toEqual([...KNOWN_MOD_IDS].sort());
    const kinds = Object.fromEntries(releases.map(([id, release]) => [id, release.kind]));
    expect(kinds).toEqual({
      ettu: 'zip',
      rpu: 'zip',
      sonora: 'zip',
      olympus: 'zip',
      resurrection: 'zip',
      megamod: 'signed-in',
      yesterday: 'unpack',
      nevada: 'installer',
      fixt: 'installer',
    });
    for (const [id, release] of releases) {
      expect(isKnownMod(id) && release.mod).toBe(id);
      expect(release.url.startsWith('https://')).toBe(true);
    }
  });

  it('name each zip as it is downloaded, and know it by its size', () => {
    for (const [, release] of releases.filter(([, release]) => release.kind === 'zip' || release.kind === 'signed-in')) {
      expect(isZip(release), release.mod).toBe(true);
      const zip = release as ZipRelease;
      const known = KNOWN_MODS[zip.mod];
      expect(known.names.test(zip.file), zip.file).toBe(true);
      expect(zip.bytes).toBeGreaterThan(100 << 20);
      // From a link that needs no sign-in, the file itself; from a site that asks for one, its page.
      if (zip.kind === 'zip') expect(zip.url.endsWith(`/${zip.file}`), zip.url).toBe(true);
      // Where the zip's name says the version, it says this one.
      const said = known.version?.exec(zip.file)?.[1]?.replace(/_/g, '.');
      if (said) expect(said).toBe(zip.version);
      if (zip.github) {
        expect(zip.url).toContain(`github.com/${zip.github.repo}/releases/download/`);
        expect(zip.github.asset.test(zip.file)).toBe(true);
      }
    }
    expect(cloudCanFetch(MOD_RELEASES.rpu!)).toBe(true);
    expect(cloudCanFetch(MOD_RELEASES.megamod!)).toBe(false);
    expect(cloudCanFetch(MOD_RELEASES.fixt!)).toBe(false);
    expect(isZip(MOD_RELEASES.yesterday!)).toBe(false);
  });

  it('tell the file handed over by its size', () => {
    const release = MOD_RELEASES.resurrection as ZipRelease;
    expect(matchRelease(release, { name: 'FoRes_EN_1_5.zip', size: release.bytes })).toBe('same');
    expect(matchRelease(release, { name: 'renamed.zip', size: release.bytes })).toBe('same');
    expect(matchRelease(release, { name: 'FoRes_EN_1_5 (1).zip', size: 1000 })).toBe('other-size');
    expect(matchRelease(release, { name: 'fores_en_1_5.ZIP', size: 1000 })).toBe('other-size');
    expect(matchRelease(release, { name: 'rpu_v2.4.34.zip', size: 1000 })).toBe('other-name');
  });

  it('tell a folder handed over by what it holds', () => {
    // Fallout Yesterday as its 7z unpacks, under any name.
    expect(looksLikeMod('yesterday', [{ path: 'My games/fallouty.cfg' }, { path: 'My games/master.dat' }])).toBe(true);
    // Fixt as its installer leaves a Fallout folder.
    expect(looksLikeMod('fixt', [{ path: 'Fallout/Fallout Fixt/data/fixt/install.log' }])).toBe(true);
    // Nevada, which has no file of its own the console looks for: by the name of its folder, or of the zip it is in.
    expect(looksLikeMod('nevada', [{ path: 'FalloutNevadaEng/master.dat' }])).toBe(true);
    expect(looksLikeMod('nevada', [{ path: 'master.dat', zip: 'Fallout Nevada.zip' }])).toBe(true);
    // Another mod, or the game itself.
    expect(looksLikeMod('nevada', [{ path: 'Fallout 2/master.dat' }])).toBe(false);
    expect(looksLikeMod('yesterday', [{ path: 'Fallout Fixt/data/fixt/install.log' }])).toBe(false);
  });

  it('say whether what is loaded is older', () => {
    const release = { ...(MOD_RELEASES.rpu as ZipRelease), version: '2.4.34' };
    expect(isOlder('2.4.33', release)).toBe(true);
    expect(isOlder('2.3.34', release)).toBe(true);
    expect(isOlder('2.4.34', release)).toBe(false);
    expect(isOlder('2.5', release)).toBe(false);
    expect(isOlder(undefined, release)).toBe(false);
    expect(isOlder('1.16.3E', { ...release, version: '1.16.4E' })).toBe(true);
    expect(isOlder('1.16', { ...release, version: '1.16.4E' })).toBe(true);
    // Not of a release the console cannot tell by its size.
    expect(isOlder('0.70', MOD_RELEASES.fixt!)).toBe(false);
  });
});

describe('a release downloaded by Dropbox', () => {
  let dropbox: FakeDropbox;
  const release: ZipRelease = {
    mod: 'resurrection',
    kind: 'zip',
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
