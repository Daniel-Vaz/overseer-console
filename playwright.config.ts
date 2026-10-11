import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE = `http://localhost:${PORT}${process.env.BASE_PATH ?? '/overseer-console/'}`;

/**
 * End-to-end tests run against the production build (`npm run build` first).
 *
 * tests/e2e/console.spec.ts needs nothing but the build and runs in CI.
 * tests/e2e/game.spec.ts plays the real games and needs your own copies:
 *   FO1_DIR="/path/to/Fallout" FO2_DIR="/path/to/Fallout 2" npm run test:e2e
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
  },
  // PW_BROWSERS=chromium,firefox,webkit runs more than the default browser.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          // Software WebGL, and sound without a user gesture, for headless runs.
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
        launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ].filter((project) => (process.env.PW_BROWSERS ?? 'chromium').split(',').includes(project.name)),
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
