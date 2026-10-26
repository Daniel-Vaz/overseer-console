import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packDat2 } from '../../src/lib/datpack';
import { checkFiles, describe as say, summary, verdict, type CheckFile } from '../../src/lib/sfall/check';
import type { SourceBlob } from '../../src/lib/storage/opfs';

const blob = (data: Uint8Array<ArrayBuffer> | string): SourceBlob => new Blob([data]) as unknown as SourceBlob;
const fileOf = (path: string, data: SourceBlob): CheckFile => ({ path, size: data.size, open: async () => data });
/** A script that waits for the SUBCOMBATDAMAGE hook and reads mods\ovcheck.ini (tests/sfall/gl_ovcheck.ssl). */
const script = new Uint8Array(readFileSync(new URL('../sfall/gl_ovcheck.int', import.meta.url)));
/** The console's own sfall test script, which calls only what the engine has (tests/sfall/gl_overseer.ssl). */
const overseer = new Uint8Array(readFileSync(new URL('../sfall/gl_overseer.int', import.meta.url)));

describe('checking scripts', () => {
  it('says what a script asks for that the engine lacks, and a settings file it reads that is not there', async () => {
    const check = await checkFiles([fileOf('data/scripts/gl_ovcheck.int', blob(script))]);
    expect(check.scripts).toBe(1);
    expect(check.findings.map(({ kind, what }) => [kind, what])).toEqual([
      ['hook', 'SUBCOMBATDAMAGE (37)'],
      ['ini', 'mods\\ovcheck.ini'],
    ]);
    expect(verdict(check)).toBe('2 THINGS MISSING');
    expect(say(check.findings[0]!)).toBe("gl_ovcheck.int waits for sfall's SUBCOMBATDAMAGE hook, which the engine never runs: what it does then does not happen.");
    expect(summary(check)).toMatch(/^Checked its 1 script: 2 things the engine lacks, such as: gl_ovcheck\.int waits for/);
  });

  it('finds scripts and settings files in the archives of the mods folder', async () => {
    const archive = packDat2([
      { name: 'scripts/gl_ovcheck.int', file: blob(script) },
      { name: 'ovcheck.ini', file: blob('[Main]\r\nEnabled=1\r\n') },
    ]);
    const loose = blob('[Main]\r\nEnabled=1\r\n');
    // In an archive, and the settings file beside it: only the hook is missing.
    let check = await checkFiles([fileOf('mods/ovcheck.dat', archive), fileOf('mods/ovcheck.ini', loose)]);
    expect(check.findings.map(({ kind }) => kind)).toEqual(['hook']);
    // A global script kept where the engine does not look for it.
    check = await checkFiles([fileOf('extras/gl_ovcheck.int', blob(script)), fileOf('mods/ovcheck.ini', loose)]);
    expect(check.findings.map(({ kind, what }) => [kind, what])).toEqual([
      ['hook', 'SUBCOMBATDAMAGE (37)'],
      ['stray', 'extras/gl_ovcheck.int'],
    ]);
  });

  it('finds nothing missing in a script that calls only what the engine has', async () => {
    const check = await checkFiles([fileOf('data/scripts/gl_overseer.int', blob(overseer)), fileOf('mods/OvTest.dat', packDat2([{ name: 'ovtest.ini', file: blob('[Test]\r\nValue=42\r\n') }]))]);
    expect(check).toEqual({ scripts: 1, findings: [] });
    expect(summary(check)).toBe('Checked: its 1 script asks for nothing the engine lacks.');
  });
});
