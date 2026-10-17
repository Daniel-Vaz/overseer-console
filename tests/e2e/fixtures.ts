import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base } from '@playwright/test';
import { removeTempFolders } from './tempdirs';

/**
 * Test contexts are throw-away sessions, which WebKit treats like a private
 * window: its private file system refuses to open, exactly as in Safari's
 * Private Browsing. The console needs real storage, so on WebKit each test
 * gets a fresh profile on disk instead.
 *
 * Chromium keeps such a session's storage in memory, where a large file
 * written once a whole game is already in comes out short (a second game in
 * deck B, say). A test that loads more than one real game asks for a profile
 * on disk as well, with `test.use({ onDisk: true })`.
 */
export const test = base.extend<{ onDisk: boolean; _tempFolders: undefined }>({
  onDisk: [false, { option: true }],
  context: async ({ browserName, browser, playwright, baseURL, viewport, hasTouch, isMobile, deviceScaleFactor, serviceWorkers, launchOptions, onDisk }, use) => {
    // Firefox has no notion of a mobile page; a touch screen it does have.
    const options = { baseURL, viewport, hasTouch, deviceScaleFactor, serviceWorkers, ...(browserName === 'firefox' ? {} : { isMobile }) };
    if (browserName !== 'webkit' && !onDisk) {
      const context = await browser.newContext(options);
      await use(context);
      await context.close();
      return;
    }
    const profile = mkdtempSync(join(tmpdir(), `overseer-${browserName}-`));
    const context = await playwright[browserName].launchPersistentContext(profile, { ...launchOptions, ...options });
    await use(context);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },
  // The folders a test made for the console to load are removed with it.
  _tempFolders: [
    async ({}, use) => {
      await use(undefined);
      removeTempFolders();
    },
    { auto: true },
  ],
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

export { expect } from '@playwright/test';
