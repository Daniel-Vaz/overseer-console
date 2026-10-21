/** Everything the console's screens share. */
import { lastExport, recordExport, type ExportMark, type ExportedTo } from '../lib/backup';
import { activeCloud, requireCloud } from '../lib/cloud/clouds';
import { CloudError, LinkError } from '../lib/cloud/errors';
import { cloudGameFiles, cloudModFiles } from '../lib/cloud/games';
import { fetchIntoCloud } from '../lib/mods/install';
import { isZip, type ModRelease, type ZipRelease } from '../lib/mods/releases';
import type { CloudFile, CloudId } from '../lib/cloud/provider';
import { runPut, type PutPlan, type PutProgress } from '../lib/cloud/put';
import { gameFacts, type Places } from '../lib/gamefacts';
import { gameDef, gameIds, isBaseGame, isGameId, registerMod, type BaseGameId, type GameId } from '../lib/games';
import { syncMods } from '../lib/mods/sync';
import { briefSaves, latestOf, type LatestSave } from '../lib/saves';
import { deckGame, loadSettings, loadSquashed, pictureOf, saveSettings, saveSquashed, type Picture, type Settings } from '../lib/settings';
import {
  ImportError,
  openArchives,
  planImport,
  runImport,
  surveySources,
  wantsMod,
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
  /** What is being loaded: one of the games, or a mod ('mod' until it is known which). */
  game?: GameId | 'mod';
  /** What reading the selection is busy with, when that takes a while. */
  doing?: string;
  /** The files come from the player's cloud (this one: "Dropbox"), not from this device. */
  remote?: string;
  plan?: ImportPlan;
  doneBytes: number;
  totalBytes: number;
  path: string;
  error?: string;
}

const IDLE: ImportJob = { phase: 'idle', doneBytes: 0, totalBytes: 0, path: '' };

/** A mod found in what the player just picked, beside the game that was loaded from it. */
export interface Offer {
  game: 'mod';
  /** What it is called, as far as can be told without loading it. */
  title: string;
  sources: SourceFile[];
}

const perGame = <T>(value: T): Record<GameId, T> => Object.fromEntries(gameIds().map((game) => [game, value])) as Record<GameId, T>;

/** What planning an import may read from the games already here. */
const CONTEXT: ImportContext = {
  async archiveOf(game) {
    const install = await loadInstall(game);
    return install ? openInstalled(install, 'master.dat') : null;
  },
  installOf: (game) => loadInstall(game),
};

export interface CloudStatus {
  linked: boolean;
  /** Which cloud: null while none is linked. */
  id: CloudId | null;
  /** What it is called: "Dropbox", "Google Drive". */
  name: string;
  /** Whose it is. */
  account: string;
}

function cloudStatus(): CloudStatus {
  const cloud = activeCloud();
  return { linked: cloud !== null, id: cloud?.id ?? null, name: cloud?.name ?? '', account: cloud?.link()?.account.name ?? '' };
}

/** A game or a mod on its way from this device to the player's cloud. */
export interface PutJob {
  /** stopped: the player called it off. */
  phase: 'packing' | 'sending' | 'done' | 'failed' | 'stopped';
  /** The zip's name in the cloud. */
  name: string;
  /** Which cloud: "Dropbox", "Google Drive". */
  cloud: string;
  doneBytes: number;
  totalBytes: number;
  /** The file being read, while packing. */
  path?: string;
  error?: string;
  /** The zip as the cloud holds it, once it is there. */
  stored?: CloudFile;
}

interface WakeLock {
  release(): Promise<void>;
}

class ConsoleState {
  settings = $state<Settings>(loadSettings());
  /** Every game here: the two in their decks, then the mods. */
  games = $state<GameId[]>(gameIds());
  /** undefined: not looked at yet. null: not installed. */
  installs = $state<Record<GameId, InstallInfo | null | undefined>>(perGame(undefined));
  saves = $state<Record<GameId, number>>(perGame(0));
  /** The save "continue" would load, per game. */
  latest = $state<Record<GameId, LatestSave | null>>(perGame(null));
  /** When each game's saves were last exported, to a zip or to the cloud. */
  exported = $state<Record<GameId, ExportMark | null>>(perGame(null));
  /** What each game calls its places, as far as its data was ever read here. */
  places = $state.raw<Record<GameId, Places | undefined>>(perGame(undefined));
  storage = $state<StorageStatus | null>(null);
  /** Whether this browser is linked to the player's Dropbox or Google Drive, and to whose. */
  cloud = $state<CloudStatus>(cloudStatus());
  job = $state<ImportJob>({ ...IDLE });
  /** What Put in your cloud is sending, or last sent. */
  put = $state<PutJob | null>(null);
  /**
   * Takes what is dropped on the console instead of loading it, while its
   * screen is up: Put in your cloud, or installing a known mod. `label` is
   * what the console says while something is held over it; `blocked`, when
   * it cannot take anything now.
   */
  dropTarget = $state.raw<{ take(sources: SourceFile[]): void; label: string; blocked(): boolean } | null>(null);
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
  /** Stops what Put in your cloud is sending. */
  private putStopper: AbortController | null = null;
  private wake: WakeLock | null = null;

  /** False when the browser cannot keep game data (old browser, private window). */
  supported = $state(storageSupported());

  constructor() {
    setSoundEnabled(this.settings.sound);
    // The browser lets go of the screen when the page is hidden; ask again once it is back.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.wake = null;
      else if (this.working) void this.stayAwake();
    });
  }

  /** A copy into storage is under way. */
  get busy(): boolean {
    return this.job.phase === 'reading' || this.job.phase === 'copying';
  }

  /** Put in your cloud is sending something. It goes on beside a copy into storage. */
  get sending(): boolean {
    return this.put?.phase === 'packing' || this.put?.phase === 'sending';
  }

  /** Something is under way that ends with the page: the screen is kept on, and the browser asks before it closes. */
  get working(): boolean {
    return this.busy || this.sending;
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

  /** The picture a game is played at: the player's choice, or the one it was made for. */
  picture(game: GameId): Picture {
    return pictureOf(this.settings, game);
  }

  /** The mods loaded for a game, in the order they were first loaded. */
  modsOf(base: BaseGameId): GameId[] {
    return this.games.filter((game) => gameDef(game).mod?.base === base);
  }

  /** What a deck plays: the mod put in it, or the game itself. */
  deckGame(deck: BaseGameId): GameId {
    void this.games;
    return deckGame(this.settings, deck);
  }

  /** Puts a mod in its game's deck, or with the game itself takes it out again. */
  setDeckGame(deck: BaseGameId, game: GameId): void {
    const decks = { ...this.settings.decks };
    if (game === deck) delete decks[deck];
    else decks[deck] = game;
    this.update({ decks });
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

  /** The link may have been made, dropped or found dead since it was last looked at, and saves sent through it. */
  refreshCloud(): void {
    this.cloud = cloudStatus();
    this.exported = Object.fromEntries(this.games.map((game) => [game, lastExport(game)])) as Record<GameId, ExportMark | null>;
  }

  /** All of a game's saves were just exported. */
  markExported(game: GameId, to: ExportedTo): void {
    recordExport(game, to);
    this.exported[game] = lastExport(game);
  }

  /** The games with saves that have never left this browser. */
  get unexported(): GameId[] {
    return this.games.filter((game) => (this.saves[game] ?? 0) > 0 && !this.exported[game]);
  }

  /** Looks at what is installed and saved in this browser. */
  async refresh(): Promise<void> {
    this.supported = await probeStorage();
    if (!this.supported) {
      this.refreshCloud();
      this.installs = perGame(null);
      return;
    }
    // Mods come and go with their files and saves; one on its way in has neither yet.
    const loading = this.busy && this.job.game !== 'mod' ? this.job.game : undefined;
    await syncMods(loading).catch((err: unknown) => console.error('[mods] could not look at the stored mods', err));
    const games = gameIds();
    for (const game of games) {
      // A game new to this list is not looked at yet.
      if (!(game in this.installs)) this.installs[game] = undefined;
      this.saves[game] ??= 0;
      this.latest[game] ??= null;
    }
    this.games = games;
    this.refreshCloud();
    await Promise.all(
      games.map(async (game) => {
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
   * is played on when it is a mod.
   */
  playable(game: GameId): boolean {
    if (!isGameId(game)) return false;
    const base = gameDef(game).mod?.base;
    return !!this.installs[game] && (!base || !!this.installs[base]);
  }

  /**
   * Imports whatever the user picked or dropped: folders, loose files, or a
   * zip of either. `preferred` says what is wanted: one of the two games, a
   * mod ('mod'), or new files for a mod already here (its id).
   */
  importFrom(sources: SourceFile[], preferred?: GameId | 'mod'): Promise<GameId | null> {
    return this.importWith(() => openArchives(sources), preferred);
  }

  /** Loads the game that was found beside the last one, from the same selection. */
  importOffered(): Promise<GameId | null> {
    const offer = this.offer;
    if (!offer) return Promise.resolve(null);
    return this.importWith(async () => offer.sources, offer.game);
  }

  /**
   * Imports a game from the folder the player keeps in their cloud. Unlike
   * a folder picked by hand, a search of that folder must turn up the game
   * that was asked for: nobody wants the other one downloaded by surprise.
   */
  importFromCloud(game: BaseGameId): Promise<GameId | null> {
    const cloud = activeCloud();
    return this.importWith(() => cloudGameFiles(game, cloud ?? requireCloud()), game, cloud?.name ?? 'your cloud');
  }

  /**
   * Imports a mod from the console's Mods folder in the player's cloud:
   * `entry` is the zip or folder there that holds it. `replacing` is the mod
   * whose files these are, when it is one already here.
   */
  importModFromCloud(entry: string, replacing?: GameId): Promise<GameId | null> {
    const cloud = activeCloud();
    return this.importWith(() => cloudModFiles(entry, cloud ?? requireCloud()), replacing ?? 'mod', cloud?.name ?? 'your cloud');
  }

  /**
   * Installs a known mod's release by itself: the linked cloud downloads it
   * into its Mods folder, where it can (Dropbox), and it is loaded from
   * there. A copy already there is not downloaded again. `replacing`: the
   * mod already here that it updates.
   */
  installRelease(release: ZipRelease, replacing?: GameId): Promise<GameId | null> {
    const cloud = requireCloud();
    const site = new URL(release.url).hostname;
    return this.importWith(
      async (signal) => {
        const file = await fetchIntoCloud(release, cloud, signal, () => {
          this.job.doing = `${cloud.name} is downloading ${release.file} from ${site} into its Mods folder. It takes a minute or five; were this tab closed, ${cloud.name} would carry on, and Install would find it there.`;
        });
        this.job.doing = undefined;
        return cloudModFiles(file.name, cloud);
      },
      replacing ?? 'mod',
      cloud.name,
      release,
    );
  }

  /** Installs a known mod's release from the file the player downloaded and handed over. */
  installReleaseFrom(release: ModRelease, sources: SourceFile[], replacing?: GameId): Promise<GameId | null> {
    return this.importWith(() => openArchives(sources), replacing ?? 'mod', undefined, release);
  }

  /**
   * Sends what Put in your cloud worked out. It goes on while the player
   * looks at other screens, as a copy into storage does, and can be stopped.
   */
  async putInCloud(plan: PutPlan): Promise<void> {
    if (this.sending) return;
    const cloud = requireCloud();
    const stopper = (this.putStopper = new AbortController());
    this.put = { phase: plan.zip ? 'sending' : 'packing', name: plan.name, cloud: cloud.name, doneBytes: 0, totalBytes: plan.bytes };
    void this.stayAwake();
    const shown = (progress: PutProgress) => {
      if (this.put && !stopper.signal.aborted) this.put = { ...this.put, ...progress, path: progress.path };
    };
    try {
      const stored = await runPut(plan, shown, stopper.signal, cloud);
      this.put = { ...this.put, phase: 'done', doneBytes: stored.size, totalBytes: stored.size, path: undefined, stored };
    } catch (err) {
      if (stopper.signal.aborted || wasStopped(err)) {
        this.put = { ...this.put, phase: 'stopped', path: undefined };
      } else {
        console.error(err);
        const message = err instanceof ImportError || err instanceof CloudError || err instanceof LinkError ? err.message : `The upload failed: ${err instanceof Error ? err.message : String(err)}`;
        this.put = { ...this.put, phase: 'failed', path: undefined, error: message };
        // A link the cloud has cancelled is forgotten on the spot.
        this.refreshCloud();
      }
    } finally {
      if (this.putStopper === stopper) this.putStopper = null;
      this.letSleep();
    }
  }

  /** Calls off what Put in your cloud is sending. Nothing is left half there. */
  stopPut(): void {
    this.putStopper?.abort();
  }

  /** Forgets how the last Put in your cloud went. */
  clearPut(): void {
    if (!this.sending) this.put = null;
  }

  /**
   * Calls off the import that is running. What was copied so far is thrown
   * away, and the deck is as it was before.
   */
  stopImport(): void {
    this.stopper?.abort();
  }

  /**
   * `remote` names the cloud the files come from, when they come from one.
   * `release`: the release of a known mod they are, which the mod is then
   * recorded at, also where the name of its zip does not say.
   */
  private async importWith(
    find: (signal: AbortSignal) => Promise<SourceFile[]>,
    preferred?: GameId | 'mod',
    remote?: string,
    release?: ModRelease,
  ): Promise<GameId | null> {
    if (this.busy) return null;
    const stopper = (this.stopper = new AbortController());
    const { signal } = stopper;
    // Looking through a zip or a cloud's folder cannot be interrupted, but it need not be waited for.
    const called = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    called.catch(() => undefined);
    const unless = <T>(work: Promise<T>): Promise<T> => Promise.race([work, called]);

    this.job = { ...IDLE, phase: 'reading', game: preferred, remote };
    this.offer = null;
    void this.stayAwake();
    try {
      const sources = await unless(find(signal));
      const survey = await unless(surveySources(sources));
      const plan = await this.plan(sources, survey, preferred, remote, signal, unless);
      // Only a zip told by its size is known to be that version.
      if (release && isZip(release) && plan.mod?.record.known === release.mod) plan.mod.record.version = release.version;
      if (remote && preferred && isBaseGame(preferred) && plan.game !== preferred) {
        throw new ImportError(`${gameDef(preferred).title} was not found in your ${remote}. What is there is ${plan.mod?.record.title ?? gameDef(plan.game).title}.`);
      }
      await this.copy(plan, remote, signal);
      // Best effort: ask the browser to keep this data when disk space runs low.
      // Not awaited: Firefox answers only after the user responds to a prompt.
      void requestPersistence().then(() => this.refresh());
      this.job = { ...this.job, phase: 'done', doneBytes: plan.totalBytes };
      // A mod in the folder that was just picked can be loaded from it without a second pick.
      if (!remote && plan.also.includes('mod') && !plan.mod) this.offer = { game: 'mod', title: 'Fallout Et Tu', sources };
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
        err instanceof ImportError || err instanceof CloudError || err instanceof LinkError
          ? err.message
          : `The copy failed: ${err instanceof Error ? err.message : String(err)}`;
      this.job = { ...this.job, phase: 'failed', error: message };
      // A link the cloud has cancelled is forgotten on the spot.
      this.refreshCloud();
      return null;
    } finally {
      if (this.stopper === stopper) this.stopper = null;
      this.letSleep();
    }
  }

  /**
   * Plans the import of what was asked for. A mod like Fallout Et Tu is put
   * together from two games: where the selection holds one of them that is
   * not loaded yet (the mod sits in the folder of the game it is played on),
   * that one is loaded first, from the same pick.
   */
  private async plan(
    sources: SourceFile[],
    survey: Awaited<ReturnType<typeof surveySources>>,
    preferred: GameId | 'mod' | undefined,
    remote: string | undefined,
    signal: AbortSignal,
    unless: <T>(work: Promise<T>) => Promise<T>,
  ): Promise<ImportPlan> {
    const context: ImportContext = { ...CONTEXT, remote: !!remote, status: (doing) => (this.job.doing = doing) };
    // (Not from the cloud: nobody wants a second game downloaded by surprise.)
    const mod = wantsMod(preferred) || (preferred === undefined && survey.conversion !== null && !survey.candidates.length);
    if (!mod || survey.conversion === null || remote) return unless(planImport(sources, preferred, context));

    const here = (game: BaseGameId) => !this.installs[game] && survey.stock.includes(game);
    // After loading another game the console is back to reading the mod.
    const resume = () => (this.job = { ...IDLE, phase: 'reading', game: preferred ?? 'mod', remote });
    if (here('fo2')) {
      await this.copy(await unless(planImport(sources, 'fo2', context)), remote, signal);
      resume();
    }
    try {
      return await unless(planImport(sources, preferred ?? 'mod', context));
    } catch (err) {
      // What it needs of the other game is not at hand, and that game is in the selection as well.
      if (!(err instanceof ImportError) || !here('fo1')) throw err;
      await this.copy(await unless(planImport(sources, 'fo1', context)), remote, signal);
      resume();
      return unless(planImport(sources, preferred ?? 'mod', context));
    }
  }

  /** Copies a planned import into storage, showing its progress. */
  private async copy(plan: ImportPlan, remote: string | undefined, signal: AbortSignal): Promise<void> {
    const status = await storageStatus().catch(() => null);
    if (status && status.quota > 0 && status.quota - status.usage < plan.totalBytes * 1.05) {
      throw new ImportError(
        `Not enough browser storage is available for ${plan.mod?.record.title ?? gameDef(plan.game).title}. Free some disk space, or eject a game or mod you are not playing.`,
      );
    }
    // A mod has a page of its own from the moment it is known what it is: the copy is shown there.
    // One that never arrives is forgotten again (see syncMods).
    if (plan.mod && !isGameId(plan.mod.record.id)) {
      registerMod(plan.mod.record);
      this.installs[plan.mod.record.id] = null;
      this.saves[plan.mod.record.id] = 0;
      this.latest[plan.mod.record.id] = null;
      this.games = gameIds();
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
    // What it is now, when it was here before: loaded again, perhaps at another version.
    if (plan.mod) registerMod(plan.mod.record);
    await this.refresh();
  }

  /**
   * Keeps the screen on while a game is copied in, or sent to the cloud. A
   * phone that dims and locks in the middle of a long copy stops it, and one
   * from or to the cloud is long.
   */
  private async stayAwake(): Promise<void> {
    const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } }).wakeLock;
    if (!api || this.wake || document.hidden) return;
    try {
      const lock = await api.request('screen');
      if (this.working && !this.wake) this.wake = lock;
      else void lock.release().catch(() => undefined);
    } catch {
      // Refused on a low battery and the like; the copy is no worse off for the asking.
    }
  }

  /** Lets the screen go dark again, once nothing that needs it on is under way. */
  private letSleep(): void {
    if (this.working) return;
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }

  /** The save to continue from: the latest one of a game that can be played. */
  continueFrom(only?: GameId): { game: GameId; save: LatestSave } | null {
    let best: { game: GameId; save: LatestSave } | null = null;
    for (const game of only ? [only] : this.games) {
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
