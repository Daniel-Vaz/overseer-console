import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made: string[] = [];

/** A new folder in the system's temporary one, removed when the test that asked for it is over (see fixtures.ts). */
export function tempFolder(prefix = 'overseer-e2e-'): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  made.push(folder);
  return folder;
}

/** Removes every folder made since the last time. */
export function removeTempFolders(): void {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
}
