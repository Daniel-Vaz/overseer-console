/**
 * The Van Buren tech demo in this browser's storage: fetched from the
 * Internet Archive, unpacked from its archive, or copied from a folder (see
 * demo.ts for what is kept, and unpack.worker.ts for the archive).
 */
import { ImportError, openArchives, type SourceFile } from '../storage/importer';
import { MANIFEST_VERSION, basename, dirname, pathKey, type Manifest } from '../storage/manifest';
import { loadInstall, removeInstall, writeInstall, type ImportProgress, type Install } from '../storage/opfs';
import { DEMO_ID, DEMO_SHELF, demoPath, isReleaseFile, missingDemoFiles } from './demo';
import type { UnpackRequest, UnpackResponse } from './unpack.worker';

/** The demo's files in this browser, or null. */
export function loadDemo(): Promise<Install | null> {
  return loadInstall(DEMO_ID, DEMO_SHELF);
}

/** Removes the demo's files from this browser, and any archive fetched for it. */
export function ejectDemo(): Promise<void> {
  return removeInstall(DEMO_ID, DEMO_SHELF);
}

/** What a step of loading the demo is busy with. */
export interface DemoProgress extends ImportProgress {
  step: 'fetch' | 'unpack' | 'copy';
}

/** How loading the demo went. `release`: every file is the archive.org release's own. */
export interface DemoLoaded {
  manifest: Manifest;
  release: boolean;
}

/** What the archive turned out not to be, or held, in words for the player. */
export class DemoError extends Error {
  override name = 'DemoError';
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: UnpackResponse & { type: 'done' }) => void; reject: (err: Error) => void; progress?: (p: ImportProgress) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./unpack.worker.ts', import.meta.url), { type: 'module', name: 'overseer-unrar' });
  worker.onmessage = (event: MessageEvent<UnpackResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') {
      entry.progress?.(message);
      return;
    }
    pending.delete(message.id);
    if (message.type === 'done') {
      entry.resolve(message);
    } else if (message.name === 'AbortError') {
      entry.reject(new DOMException('the job was stopped', 'AbortError'));
    } else {
      entry.reject(message.name === 'DemoError' ? new DemoError(message.message) : new Error(message.message));
    }
  };
  worker.onerror = (event) => {
    const err = new Error(`the unpacking worker failed: ${event.message}`);
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    worker = null;
  };
  return worker;
}

type Op = UnpackRequest extends infer R ? (R extends { id: number; op: 'fetch' | 'unpack' } ? Omit<R, 'id'> : never) : never;

function call(op: Op, progress?: (p: ImportProgress) => void, signal?: AbortSignal): Promise<UnpackResponse & { type: 'done' }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('the job was stopped', 'AbortError'));
      return;
    }
    const id = nextId++;
    const stop = () => getWorker().postMessage({ id, op: 'stop' } satisfies UnpackRequest);
    signal?.addEventListener('abort', stop, { once: true });
    const done = () => signal?.removeEventListener('abort', stop);
    pending.set(id, {
      resolve: (value) => (done(), resolve(value)),
      reject: (err) => (done(), reject(err)),
      progress,
    });
    getWorker().postMessage({ ...op, id } satisfies UnpackRequest);
  });
}

/**
 * Fetches the demo's archive from the Internet Archive and unpacks it into
 * storage. An archive fetched earlier and not unpacked is not fetched again.
 */
export async function fetchDemo(onProgress: (p: DemoProgress) => void, signal?: AbortSignal): Promise<DemoLoaded> {
  await call({ op: 'fetch' }, (p) => onProgress({ ...p, step: 'fetch' }), signal);
  return unpackDemo(undefined, onProgress, signal);
}

/** Unpacks the demo's archive: this one from the device, or the one fetched before. */
export async function unpackDemo(archive: File | undefined, onProgress: (p: DemoProgress) => void, signal?: AbortSignal): Promise<DemoLoaded> {
  const done = await call(archive ? { op: 'unpack', archive } : { op: 'unpack' }, (p) => onProgress({ ...p, step: 'unpack' }), signal);
  return { manifest: done.manifest!, release: !!done.release };
}

/** What the player handed the console: the demo's folder (or a zip of it), or its archive. */
export type DemoSource = { kind: 'folder'; files: SourceFile[] } | { kind: 'archive'; file: File };

/** Whether a name is that of a RAR archive. */
export function looksLikeRar(name: string): boolean {
  return /\.rar$/i.test(name);
}

/**
 * Finds the demo in what was picked or dropped: its archive, or the folder it
 * was unpacked to, anywhere in the selection or a zip of it. Throws
 * ImportError, in words for the player, when it is not there.
 */
export async function findDemo(picked: SourceFile[]): Promise<DemoSource> {
  const rar = picked.find((source) => looksLikeRar(source.path) && source.file instanceof File);
  if (rar) return { kind: 'archive', file: rar.file as File };
  const sources = await openArchives(picked);
  // The folder is the one with resource.rht in it, the shallowest where there are several.
  const roots = sources
    .filter((source) => basename(pathKey(source.path)) === 'resource.rht')
    .map((source) => dirname(source.path))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (!roots.length) {
    throw new ImportError(
      'The Van Buren tech demo is not in what you selected. Select the folder F3_Demo.rar was unpacked to (it holds resource.rht and data), a zip of it, or F3_Demo.rar itself.',
    );
  }
  const root = roots[0]!;
  const inside = sources
    .filter((source) => (root ? pathKey(source.path).startsWith(`${pathKey(root)}/`) : true))
    .map((source) => ({ ...source, path: root ? source.path.slice(root.length + 1) : source.path }));
  const missing = missingDemoFiles(inside.map((source) => source.path));
  if (missing.length) {
    throw new ImportError(`That folder is missing files of the tech demo: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' and more' : ''}. Unpack F3_Demo.rar again, or select the archive itself.`);
  }
  return { kind: 'folder', files: inside };
}

/** Copies the demo from its folder into storage, keeping what the engine reads. */
export async function copyDemo(files: SourceFile[], onProgress: (p: DemoProgress) => void, signal?: AbortSignal): Promise<DemoLoaded> {
  const entries: { path: string; file: SourceFile['file'] }[] = [];
  const seen = new Set<string>();
  for (const source of files) {
    const path = demoPath(source.path);
    if (path === null || seen.has(pathKey(path))) continue;
    seen.add(pathKey(path));
    entries.push({ path, file: source.file });
  }
  const release = entries.filter((entry) => !pathKey(entry.path).startsWith('override/')).every((entry) => isReleaseFile(entry.path, entry.file.size));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  const manifest = await writeInstall(
    DEMO_ID,
    entries,
    (install, written): Manifest => ({
      version: MANIFEST_VERSION,
      game: DEMO_ID,
      install,
      importedAt: Date.now(),
      totalBytes,
      files: written,
      dirs: [...new Set([...written.map((file) => dirname(file.path)).filter(Boolean), 'Override'])].sort(),
    }),
    (p) => onProgress({ ...p, step: 'copy' }),
    signal,
    DEMO_SHELF,
  );
  return { manifest, release };
}
