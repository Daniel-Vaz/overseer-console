/** Everything the console's screens share. */
import { GAME_IDS, type GameId } from '../lib/games';
import { countSaves } from '../lib/saves';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';
import { ImportError, planImport, runImport, type ImportPlan, type SourceFile } from '../lib/storage/importer';
import { loadInstall, probeStorage, requestPersistence, storageStatus, storageSupported, type StorageStatus } from '../lib/storage/opfs';
import { setSoundEnabled } from './sfx';
import type { Hint } from './types';

export interface InstallInfo {
  totalBytes: number;
  importedAt: number;
  files: number;
}

export interface ImportJob {
  phase: 'idle' | 'reading' | 'copying' | 'done' | 'failed';
  game?: GameId;
  plan?: ImportPlan;
  doneBytes: number;
  totalBytes: number;
  path: string;
  error?: string;
}

const IDLE: ImportJob = { phase: 'idle', doneBytes: 0, totalBytes: 0, path: '' };

class ConsoleState {
  settings = $state<Settings>(loadSettings());
  /** undefined: not looked at yet. null: not installed. */
  installs = $state<Record<GameId, InstallInfo | null | undefined>>({ fo1: undefined, fo2: undefined });
  saves = $state<Record<GameId, number>>({ fo1: 0, fo2: 0 });
  storage = $state<StorageStatus | null>(null);
  job = $state<ImportJob>({ ...IDLE });
  hints = $state<Hint[]>([]);

  /** False when the browser cannot keep game data (old browser, private window). */
  supported = $state(storageSupported());

  constructor() {
    setSoundEnabled(this.settings.sound);
  }

  get busy(): boolean {
    return this.job.phase === 'reading' || this.job.phase === 'copying';
  }

  update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    setSoundEnabled(this.settings.sound);
  }

  /** Looks at what is installed and saved in this browser. */
  async refresh(): Promise<void> {
    this.supported = await probeStorage();
    if (!this.supported) {
      this.installs = { fo1: null, fo2: null };
      return;
    }
    await Promise.all(
      GAME_IDS.map(async (game) => {
        try {
          const install = await loadInstall(game);
          this.installs[game] = install
            ? {
                totalBytes: install.manifest.totalBytes,
                importedAt: install.manifest.importedAt,
                files: install.manifest.files.length,
              }
            : null;
          this.saves[game] = await countSaves(game);
        } catch (err) {
          console.error(err);
          this.installs[game] = null;
        }
      }),
    );
    this.storage = await storageStatus().catch(() => null);
  }

  /** Imports whatever the user picked or dropped. */
  async importFrom(sources: SourceFile[], preferred?: GameId): Promise<GameId | null> {
    if (this.busy) return null;
    this.job = { ...IDLE, phase: 'reading', game: preferred };
    try {
      const plan = await planImport(sources, preferred);
      const status = await storageStatus().catch(() => null);
      if (status && status.quota > 0 && status.quota - status.usage < plan.totalBytes * 1.05) {
        throw new ImportError(
          'Not enough browser storage is available for this game. Free some disk space, or remove the other game first.',
        );
      }
      this.job = { phase: 'copying', game: plan.game, plan, doneBytes: 0, totalBytes: plan.totalBytes, path: '' };
      await runImport(plan, (progress) => {
        this.job.doneBytes = progress.doneBytes;
        this.job.totalBytes = progress.totalBytes;
        if (progress.path) this.job.path = progress.path;
      });
      // Best effort: ask the browser to keep this data when disk space runs low.
      // Not awaited: Firefox answers only after the user responds to a prompt.
      void requestPersistence().then(() => this.refresh());
      this.job = { ...this.job, phase: 'done', doneBytes: plan.totalBytes };
      await this.refresh();
      return plan.game;
    } catch (err) {
      console.error(err);
      const message =
        err instanceof ImportError
          ? err.message
          : `The copy failed: ${err instanceof Error ? err.message : String(err)}`;
      this.job = { ...this.job, phase: 'failed', error: message };
      return null;
    }
  }

  clearJob(): void {
    if (!this.busy) this.job = { ...IDLE };
  }
}

export const consoleState = new ConsoleState();
