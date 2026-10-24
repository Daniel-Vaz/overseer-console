import { describe, expect, it } from 'vitest';
import { ISSUE_URL_LIMIT, browserName, issueUrl, reportBody, reportFileName, reportTitle, systemName, type Report } from '../../src/lib/report';

const report = (overrides: Partial<Report> = {}): Report => ({
  kind: 'problem',
  where: 'Fallout 2',
  sections: [{ title: 'Game', rows: [['Game', 'Fallout 2 (fo2)'], ['Pipe', 'a | b']] }],
  blocks: [{ title: 'Engine log', lines: ['one', 'two'] }],
  ...overrides,
});

describe('a problem report', () => {
  it('has a title that starts the same way every time', () => {
    expect(reportTitle(report())).toBe('[Fallout 2] Problem: <say what went wrong>');
    expect(reportTitle(report({ kind: 'fault', summary: 'Fallout 2 stopped. The engine reports:\n  out of memory' }))).toBe(
      '[Fallout 2] Fault: Fallout 2 stopped. The engine reports: out of memory',
    );
    const long = reportTitle(report({ kind: 'fault', summary: 'x'.repeat(200) }));
    expect(long.length).toBeLessThan(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('is a body of GitHub Markdown: what happened first, then the readings and the logs', () => {
    const body = reportBody(report());
    expect(body.indexOf('### What happened')).toBe(0);
    expect(body).toContain('### Game\n\n| | |\n|---|---|\n| Game | Fallout 2 (fo2) |\n| Pipe | a \\| b |');
    expect(body).toContain('### Engine log\n\n```text\none\ntwo\n```');
    expect(reportBody(report({ blocks: [{ title: 'Engine log', lines: ['a', 'b', 'c'] }] }), 1)).toContain('(2 earlier lines left out)\nc');
  });

  it('opens a new issue with all of it while it fits, and shortens the logs when it does not', () => {
    const short = issueUrl(report());
    expect(short.cut).toBe(false);
    expect(short.url.startsWith('https://github.com/Daniel-Vaz/overseer-console/issues/new?title=')).toBe(true);
    expect(new URL(short.url).searchParams.get('body')).toContain('two');

    const long = issueUrl(report({ blocks: [{ title: 'Engine log', lines: Array.from({ length: 400 }, (_, at) => `line ${at} ${'x'.repeat(40)}`) }] }));
    expect(long.cut).toBe(true);
    expect(long.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
    expect(new URL(long.url).searchParams.get('body')).toContain('line 399');
  });

  it('is saved under a name that says where and when', () => {
    expect(reportFileName(report({ where: 'Restoration Project 2.4.34 on FALLOUT 2' }), new Date(Date.UTC(2026, 9, 24, 8, 5)))).toBe(
      'overseer-report-restoration-project-2-4-34-on-fallout-2-20261024-0805.md',
    );
  });

  it('names the browser and the system from what the browser says', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const edge = `${chrome} Edg/141.0.0.0`;
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0';
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
    expect([chrome, edge, firefox, safari].map((agent) => browserName(agent))).toEqual(['Chrome 141', 'Edge 141', 'Firefox 144', 'Safari 18']);
    expect([chrome, firefox, safari].map((agent) => systemName(agent))).toEqual(['Windows', 'Linux', 'iOS']);
  });
});
