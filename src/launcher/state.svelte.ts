/** Everything the console's screens share. */
import { DropboxError } from '../lib/dropbox/api';
import { LinkError } from '../lib/dropbox/auth';
import { dropboxGameFiles } from '../lib/dropbox/games';
import { loadLink } from '../lib/dropbox/link';
import { GAMES, GAME_IDS, type GameId } from '../lib/games';
import { briefSaves, latestOf, type LatestSave } from '../lib/saves';
import { loadSettings, loadSquashed, saveSettings, saveSquashed, type Settings } from '../lib/settings';
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
  /** The files come from the player's Dropbox, not from this device. */
  remote?: boolean;
  plan?: ImportPlan;
  doneBytes: number;
  totalBytes: number;
  path: string;
  error?: string;
}

const IDLE: ImportJob = { phase: 'idle', doneBytes: 0, totalBytes: 0, path: '' };

export interface DropboxStatus {
  linked: boolean;
  /** Whose Dropbox it is. */
  name: string;
}

function dropboxStatus(): DropboxStatus {
  const link = loadLink();
  return { linked: link !== null, name: link?.account.name ?? '' };
}

class ConsoleState {
  settings = $state<Settings>(loadSettings());
  /** undefined: not looked at yet. null: not installed. */
  installs = $state<Record<GameId, InstallInfo | null | undefined>>({ fo1: undefined, fo2: undefined });
  saves = $state<Record<GameId, number>>({ fo1: 0, fo2: 0 });
  /** The save "continue" would load, per game. */
  latest = $state<Record<GameId, LatestSave | null>>({ fo1: null, fo2: null });
  storage = $state<StorageStatus | null>(null);
  /** Whether this browser is linked to the player's Dropbox. */
  dropbox = $state<DropboxStatus>(dropboxStatus());
  job = $state<ImportJob>({ ...IDLE });
  hints = $state<Hint[]>([]);
  /** What the nameplate on the housing says for a moment, in place of the console's name. */
  plate = $state('');
  private plateTimer = 0;
  private squashed = loadSquashed();

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

  /** Has the nameplate on the housing say something, briefly. */
  remark(text: string): void {
    this.plate = text;
    clearTimeout(this.plateTimer);
    this.plateTimer = window.setTimeout(() => (this.plate = ''), 2800);
  }

  /** Counts one more radroach that has met its end here, and says how many that makes. */
  squash(): number {
    this.squashed += 1;
    saveSquashed(this.squashed);
    return this.squashed;
  }

  /** The link may have been made, dropped or found dead since it was last looked at. */
  refreshDropbox(): void {
    this.dropbox = dropboxStatus();
  }

  /** Looks at what is installed and saved in this browser. */
  async refresh(): Promise<void> {
    this.refreshDropbox();
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
          const saves = await briefSaves(game);
          this.saves[game] = saves.length;
          this.latest[game] = latestOf(game, saves);
        } catch (err) {
          console.error(err);
          this.installs[game] = null;
        }
      }),
    );
    this.storage = await storageStatus().catch(() => null);
  }

  /** Imports whatever the user picked or dropped. */
  importFrom(sources: SourceFile[], preferred?: GameId): Promise<GameId | null> {
    return this.importWith(async () => sources, preferred);
  }

  /**
   * Imports a game from the folder the player keeps in their Dropbox. Unlike
   * a folder picked by hand, a search of that folder must turn up the game
   * that was asked for: nobody wants the other one downloaded by surprise.
   */
  importFromDropbox(game: GameId): Promise<GameId | null> {
    return this.importWith(() => dropboxGameFiles(game), game, true);
  }

  private async importWith(find: () => Promise<SourceFile[]>, preferred?: GameId, remote = false): Promise<GameId | null> {
    if (this.busy) return null;
    this.job = { ...IDLE, phase: 'reading', game: preferred, remote };
    try {
      const plan = await planImport(await find(), preferred);
      if (remote && preferred && plan.game !== preferred) {
        throw new ImportError(`${GAMES[preferred].title} was not found in your Dropbox. What is there is ${GAMES[plan.game].title}.`);
      }
      const status = await storageStatus().catch(() => null);
      if (status && status.quota > 0 && status.quota - status.usage < plan.totalBytes * 1.05) {
        throw new ImportError(
          'Not enough browser storage is available for this game. Free some disk space, or remove the other game first.',
        );
      }
      this.job = { phase: 'copying', game: plan.game, remote, plan, doneBytes: 0, totalBytes: plan.totalBytes, path: '' };
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
        err instanceof ImportError || err instanceof DropboxError || err instanceof LinkError
          ? err.message
          : `The copy failed: ${err instanceof Error ? err.message : String(err)}`;
      this.job = { ...this.job, phase: 'failed', error: message };
      // A link Dropbox has cancelled is forgotten on the spot.
      this.refreshDropbox();
      return null;
    }
  }

  /** The save to continue from: the latest one of a game that can be played. */
  continueFrom(only?: GameId): { game: GameId; save: LatestSave } | null {
    let best: { game: GameId; save: LatestSave } | null = null;
    for (const game of only ? [only] : GAME_IDS) {
      const save = this.latest[game];
      if (!save || !this.installs[game]) continue;
      if (!best || save.touchedAt > best.save.touchedAt) best = { game, save };
    }
    return best;
  }

  clearJob(): void {
    if (!this.busy) this.job = { ...IDLE };
  }
}

export const consoleState = new ConsoleState();
