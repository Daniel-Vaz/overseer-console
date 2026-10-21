// Says which mods the console installs (src/lib/mods/releases.ts) have a newer release than the one it names, and
// whether each named file is still where it says, at its size:
//
//   npm run mod-releases
//
// GITHUB_TOKEN, when set, is sent to GitHub's API, which otherwise allows 60 requests an hour.
import { MOD_RELEASES, type ModRelease } from '../src/lib/mods/releases.ts';

interface GithubRelease {
  tag_name: string;
  published_at: string;
  assets: { name: string; size: number; browser_download_url: string }[];
}

const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'overseer-console' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

/** The size of what the address serves, after redirects: from the first byte of it (signed S3 links refuse HEAD). */
async function servedSize(url: string): Promise<number | string> {
  let status = 0;
  // Bitbucket answers 503 now and then.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 3000));
    const response = await fetch(url, { headers: { Range: 'bytes=0-0', 'User-Agent': 'overseer-console' }, redirect: 'follow' });
    await response.body?.cancel();
    status = response.status;
    const total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1]);
    if (response.ok && total > 0) return total;
    if (status < 500) break;
  }
  return `HTTP ${status}`;
}

let faults = 0;
for (const release of Object.values(MOD_RELEASES) as ModRelease[]) {
  const served = await servedSize(release.url).catch((err: unknown) => String(err));
  const here = served === release.bytes ? 'there, at its size' : typeof served === 'string' ? `NOT SERVED (${served})` : `SERVED AT ${served} BYTES, NOT ${release.bytes}`;
  if (served !== release.bytes) faults++;
  console.log(`${release.mod}: ${release.version}, ${release.file}: ${here}`);
  if (!release.github) {
    console.log('  no GitHub releases to look for newer ones in: check its download page by hand');
    continue;
  }
  const response = await fetch(`https://api.github.com/repos/${release.github.repo}/releases/latest`, { headers });
  if (!response.ok) {
    console.log(`  GitHub answered ${response.status}`);
    faults++;
    continue;
  }
  const latest = (await response.json()) as GithubRelease;
  const asset = latest.assets.find((entry) => release.github!.asset.test(entry.name));
  if (!asset) {
    console.log(`  latest release ${latest.tag_name} has no file like ${release.github.asset}`);
  } else if (asset.browser_download_url === release.url && asset.size === release.bytes) {
    console.log(`  the latest release (${latest.tag_name})`);
  } else {
    console.log(`  NEWER: ${latest.tag_name} of ${latest.published_at.slice(0, 10)}, ${asset.name}, ${asset.size} bytes`);
    console.log(`    url: '${asset.browser_download_url}',`);
    console.log('  Play it from its real files before moving the console to it (docs/developing.md).');
  }
}
process.exitCode = faults ? 1 : 0;
