import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

// GitHub Pages serves project sites from /<repository>/.
const base = process.env.BASE_PATH ?? '/overseer-console/';

/**
 * Emits sw.js with the list of built files to cache up front. The version is
 * a hash of that list, so the worker changes exactly when the site does.
 */
function serviceWorker(): Plugin {
  return {
    name: 'overseer-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map'))
        .sort();
      // The pages themselves are emitted after this hook runs, so name them here.
      const precache = ['', 'index.html', 'play.html', ...files.filter((file) => !file.endsWith('.html')), 'favicon.ico', 'favicon-96.png', 'manifest.webmanifest'];
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(`${root}src/sw.js`, 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** The commit the site is built from, for problem reports: CI names it, a checkout knows it. */
function buildCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    const commit = execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${commit}+changes` : commit;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  base,
  define: {
    __BUILD__: JSON.stringify({ commit: buildCommit(), date: new Date().toISOString().slice(0, 10) }),
  },
  plugins: [svelte(), serviceWorker()],
  build: {
    target: 'es2022',
    rollupOptions: {
      // Two pages: the console (launcher) and the player. Leaving the player
      // is a real navigation, which is the one reliable way to give back the
      // memory of a WebAssembly instance.
      input: {
        index: `${root}index.html`,
        play: `${root}play.html`,
      },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
