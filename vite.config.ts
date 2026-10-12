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

export default defineConfig({
  base,
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
