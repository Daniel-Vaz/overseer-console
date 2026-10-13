/** Everything the console's screens share. */
import { DropboxError } from '../lib/dropbox/api';
import { LinkError } from '../lib/dropbox/auth';
import { dropboxGameFiles } from '../lib/dropbox/games';
import { loadLink } from '../lib/dropbox/link';
import { gameFacts, type Places } from '../lib/gamefacts';
import { GAMES, GAME_IDS, type GameId } from '../lib/games';
import { briefSaves, latestOf, type LatestSave } from '../lib/saves';
import { loadSettings, loadSquashed, saveSettings, saveSquashed, type Picture, type Settings } from '../lib/settings';
import {
  ImportError,
  openArchives,
  planImport,
  runImport,
  surveySources,
  type ImportContext,
  type ImportPlan,
  type SourceFile,
} from '../lib/storage/importer';
import {
  loadInstall,
  openInstalled,
  probeStorage,
  requestPersistence,
  storageStatus,
  storageSupported,
  wasStopped,
  type StorageStatus,
} from '../lib/storage/opfs';
import { setSoundEnabled } from './sfx';
import type { Hint } from './types';

export interface InstallInfo {
  totalBytes: number;
  importedAt: number;
  files: number;
}

export interface ImportJob {
  /** stopped: the player called it off, and the deck is as it was. */
  phase: 'idle' | 'reading' | 'copying' | 'done' | 'failed' | 'stopped';
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

/** A game found in what the player just picked, beside the one that was loaded from it. */
export interface Offer {
  game: GameId;
  sources: SourceFile[];
}

const perGame = <T>(value: T): Record<GameId, T> => Object.fromEntries(GAME_IDS.map((game) => [game, value])) as Record<GameId, T>;

/** What planning an import may read from the games already here. */
const CONTEXT: ImportContext = {
  async archiveOf(game) {
    const install = await loadInstall(game);
    return install ? openInstalled(install, 'master.dat') : null;
  },
};

export interface DropboxStatus {
  linked: boolean;
  /** Whose Dropbox it is. */
  name: string;
}

function dropboxStatus(): DropboxStatus {
  const link = loadLink();
  return { linked: link !== null, name: link?.account.name ?? '' };
}

interface WakeLock {
  release(): Promise<void>;
}

class ConsoleState {
  settings = $state<Settings>(loadSettings());
  /** undefined: not looked at yet. null: not installed. */
  installs = $state<Record<GameId, InstallInfo | null | undefined>>(perGame(undefined));
  saves = $state<Record<GameId, number>>(perGame(0));
  /** The save "continue" would load, per game. */
  latest = $state<Record<GameId, LatestSave | null>>(perGame(null));
  /** What each game calls its places, as far as its data was ever read here. */
  places = $state.raw<Record<GameId, Places | undefined>>(perGame(undefined));
  storage = $state<StorageStatus | null>(null);
  /** Whether this browser is linked to the player's Dropbox. */
  dropbox = $state<DropboxStatus>(dropboxStatus());
  job = $state<ImportJob>({ ...IDLE });
  /** Another game the last selection held: it can be loaded without picking the folder again. */
  offer = $state.raw<Offer | null>(null);
  hints = $state<Hint[]>([]);
  /**
   * What the entry under the cursor does: shown on the line under the screen,
   * where it is in view however far the screen above it has been scrolled.
   */
  note = $state('');
  /** Whether the menu on the screen explains its entries at all. The line is kept for one that does, also while it has nothing to say. */
  noted = $state(false);
  private noteOwner: object | null = null;
  /** What the nameplate on the housing says for a moment, in place of the console's name. */
  plate = $state('');
  private plateTimer = 0;
  private squashed = loadSquashed();
  /** Stops the import that is running. */
  private stopper: AbortController | null = null;
  private wake: WakeLock | null = null;

  /** False when the browser cannot keep game data (old browser, private window). */
  supported = $state(storageSupported());

  constructor() {
    setSoundEnabled(this.settings.sound);
    // The browser lets go of the screen when the page is hidden; ask again once it is back.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.wake = null;
      else if (this.busy) void this.stayAwake();
    });
  }

  get busy(): boolean {
    return this.job.phase === 'reading' || this.job.phase === 'copying';
  }

  update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    setSoundEnabled(this.settings.sound);
  }

  /** Every game has its own picture. */
  setPicture(game: GameId, picture: Picture): void {
    this.update({ picture: { ...this.settings.picture, [game]: picture } });
  }

  /**
   * Says what the entry under the cursor of a menu does (`any`: whether any
   * of its entries has something to say), or with null that the menu is gone.
   */
  explain(owner: object, note: string | null, any = false): void {
    if (note === null) {
      // Another menu may have spoken since; its word stands.
      if (this.noteOwner !== owner) return;
      this.noteOwner = null;
      this.note = '';
      this.noted = false;
      return;
    }
    this.noteOwner = owner;
    this.note = note;
    this.noted = any;
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
      this.installs = perGame(null);
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
          // Only where there is a save to describe: the names are read out of the game's archives.
          if (saves.length) this.places = { ...this.places, [game]: (await gameFacts(game))?.places };
        } catch (err) {
          console.error(err);
          this.installs[game] = null;
        }
      }),
    );
    this.storage = await storageStatus().catch(() => null);
  }

  /**
   * Whether a game can be started: its data is here, and so is the game it
   * runs on when it is a conversion.
   */
  playable(game: GameId): boolean {
    const base = GAMES[game].conversion?.base;
    return !!this.installs[game] && (!base || !!this.installs[base]);
  }

  /** Imports whatever the user picked or dropped: folders, loose files, or a zip of either. */
  importFrom(sources: SourceFile[], preferred?: GameId): Promise<GameId | null> {
    return this.importWith(() => openArchives(sources), preferred);
  }

  /** Loads the game that was found beside the last one, from the same selection. */
  importOffered(): Promise<GameId | null> {
    const offer = this.offer;
    if (!offer) return Promise.resolve(null);
    return this.importWith(async () => offer.sources, offer.game);
  }

  /**
   * Imports a game from the folder the player keeps in their Dropbox. Unlike
   * a folder picked by hand, a search of that folder must turn up the game
   * that was asked for: nobody wants the other one downloaded by surprise.
   */
  importFromDropbox(game: GameId): Promise<GameId | null> {
    return this.importWith(() => dropboxGameFiles(game), game, true);
  }

  /**
   * Calls off the import that is running. What was copied so far is thrown
   * away, and the deck is as it was before.
   */
  stopImport(): void {
    this.stopper?.abort();
  }

  private async importWith(find: () => Promise<SourceFile[]>, preferred?: GameId, remote = false): Promise<GameId | null> {
    if (this.busy) return null;
    const stopper = (this.stopper = new AbortController());
    const { signal } = stopper;
    // Looking through a zip or a Dropbox folder cannot be interrupted, but it need not be waited for.
    const called = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    called.catch(() => undefined);
    const unless = <T>(work: Promise<T>): Promise<T> => Promise.race([work, called]);

    this.job = { ...IDLE, phase: 'reading', game: preferred, remote };
    this.offer = null;
    void this.stayAwake();
    try {
      const sources = await unless(find());
      const survey = await unless(surveySources(sources));
      const plan = await this.plan(sources, survey, preferred, remote, signal, unless);
      if (remote && preferred && plan.game !== preferred) {
        throw new ImportError(`${GAMES[preferred].title} was not found in your Dropbox. What is there is ${GAMES[plan.game].title}.`);
      }
      await this.copy(plan, remote, signal);
      // Best effort: ask the browser to keep this data when disk space runs low.
      // Not awaited: Firefox answers only after the user responds to a prompt.
      void requestPersistence().then(() => this.refresh());
      this.job = { ...this.job, phase: 'done', doneBytes: plan.totalBytes };
      // A conversion in the folder that was just picked can be loaded from it without a second pick.
      const beside = remote ? undefined : plan.also.find((game) => GAMES[game].conversion);
      if (beside) this.offer = { game: beside, sources };
      await this.refresh();
      return plan.game;
    } catch (err) {
      if (signal.aborted || wasStopped(err)) {
        // Nothing went wrong, and nothing was changed.
        this.job = { ...IDLE, phase: 'stopped', game: this.job.game ?? preferred, remote };
        await this.refresh();
        return null;
      }
      console.error(err);
      const message =
        err instanceof ImportError || err instanceof DropboxError || err instanceof LinkError
          ? err.message
          : `The copy failed: ${err instanceof Error ? err.message : String(err)}`;
      this.job = { ...this.job, phase: 'failed', error: message };
      // A link Dropbox has cancelled is forgotten on the spot.
      this.refreshDropbox();
      return null;
    } finally {
      if (this.stopper === stopper) this.stopper = null;
      this.letSleep();
    }
  }

  /**
   * Plans the import of what was asked for. A conversion is put together
   * from two games: where the selection holds one of them that is not loaded
   * yet (the conversion sits in the folder of the game it runs on), that one
   * is loaded first, from the same pick.
   */
  private async plan(
    sources: SourceFile[],
    survey: Awaited<ReturnType<typeof surveySources>>,
    preferred: GameId | undefined,
    remote: boolean,
    signal: AbortSignal,
    unless: <T>(work: Promise<T>) => Promise<T>,
  ): Promise<ImportPlan> {
    const conversion = preferred ? GAMES[preferred].conversion : undefined;
    // (Not from Dropbox: nobody wants a second game downloaded by surprise.)
    if (!conversion || survey.conversion === null || remote) return unless(planImport(sources, preferred, CONTEXT));

    const here = (game: GameId) => !this.installs[game] && survey.stock.includes(game);
    // After loading another game the console is back to reading this one.
    const resume = () => (this.job = { ...IDLE, phase: 'reading', game: preferred, remote });
    if (here(conversion.base)) {
      await this.copy(await unless(planImport(sources, conversion.base, CONTEXT)), remote, signal);
      resume();
    }
    try {
      return await unless(planImport(sources, preferred, CONTEXT));
    } catch (err) {
      // What it needs of the other game is not at hand, and that game is in the selection as well.
      if (!(err instanceof ImportError) || !here(conversion.donor)) throw err;
      await this.copy(await unless(planImport(sources, conversion.donor, CONTEXT)), remote, signal);
      resume();
      return unless(planImport(sources, preferred, CONTEXT));
    }
  }

  /** Copies a planned import into storage, showing its progress. */
  private async copy(plan: ImportPlan, remote: boolean, signal: AbortSignal): Promise<void> {
    const status = await storageStatus().catch(() => null);
    if (status && status.quota > 0 && status.quota - status.usage < plan.totalBytes * 1.05) {
      throw new ImportError(
        `Not enough browser storage is available for ${GAMES[plan.game].title}. Free some disk space, or eject a game you are not playing.`,
      );
    }
    this.job = { phase: 'copying', game: plan.game, remote, plan, doneBytes: 0, totalBytes: plan.totalBytes, path: '' };
    await runImport(
      plan,
      (progress) => {
        this.job.doneBytes = progress.doneBytes;
        this.job.totalBytes = progress.totalBytes;
        if (progress.path) this.job.path = progress.path;
      },
      signal,
    );
    await this.refresh();
  }

  /**
   * Keeps the screen on while a game is copied in. A phone that dims and
   * locks in the middle of a long copy stops it, and one from Dropbox is long.
   */
  private async stayAwake(): Promise<void> {
    const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } }).wakeLock;
    if (!api || this.wake || document.hidden) return;
    try {
      const lock = await api.request('screen');
      if (this.busy && !this.wake) this.wake = lock;
      else void lock.release().catch(() => undefined);
    } catch {
      // Refused on a low battery and the like; the copy is no worse off for the asking.
    }
  }

  private letSleep(): void {
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }

  /** The save to continue from: the latest one of a game that can be played. */
  continueFrom(only?: GameId): { game: GameId; save: LatestSave } | null {
    let best: { game: GameId; save: LatestSave } | null = null;
    for (const game of only ? [only] : GAME_IDS) {
      const save = this.latest[game];
      if (!save || !this.playable(game)) continue;
      if (!best || save.touchedAt > best.save.touchedAt) best = { game, save };
    }
    return best;
  }

  clearJob(): void {
    if (!this.busy) {
      this.job = { ...IDLE };
      this.offer = null;
    }
  }
}

export const consoleState = new ConsoleState();
