import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base } from '@playwright/test';

/**
 * Test contexts are throw-away sessions, which WebKit treats like a private
 * window: its private file system refuses to open, exactly as in Safari's
 * Private Browsing. The console needs real storage, so on WebKit each test
 * gets a fresh profile on disk instead.
 */
export const test = base.extend({
  context: async ({ browserName, browser, playwright, baseURL, viewport }, use) => {
    if (browserName !== 'webkit') {
      const context = await browser.newContext({ baseURL, viewport });
      await use(context);
      await context.close();
      return;
    }
    const profile = mkdtempSync(join(tmpdir(), 'overseer-webkit-'));
    const context = await playwright.webkit.launchPersistentContext(profile, { baseURL, viewport });
    await use(context);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

export { expect } from '@playwright/test';
