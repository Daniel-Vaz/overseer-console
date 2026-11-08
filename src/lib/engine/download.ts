/**
 * Fetching an engine build: its descriptor, its script and its binary (see
 * engines/build.sh for what public/engines/<id>/ holds).
 */
import type { EngineInfo } from './types';

/** Where an engine build is served: public/engines/<id>/. */
export function engineBase(engine: string): string {
  return `${import.meta.env.BASE_URL}engines/${engine}/`;
}

export async function fetchEngineInfo(engine: string): Promise<EngineInfo> {
  const response = await fetch(`${engineBase(engine)}engine.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`engine description not found (HTTP ${response.status})`);
  return (await response.json()) as EngineInfo;
}

export function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`could not load ${url}`));
    document.head.appendChild(script);
  });
}

/**
 * Downloads the engine binary, reporting progress.
 *
 * The bytes are handed to the runtime as `wasmBinary`. Emscripten's
 * `instantiateWasm` hook would allow compiling while downloading, but in the
 * pinned Emscripten release that hook returns the uninstrumented exports and
 * silently breaks Asyncify.
 */
export async function downloadEngine(
  url: string,
  totalBytes: number,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`engine download failed (HTTP ${response.status})`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(Math.min(loaded, totalBytes), totalBytes);
  }
  const binary = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return binary;
}
