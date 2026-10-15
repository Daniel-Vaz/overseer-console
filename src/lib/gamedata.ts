/**
 * The files of an installed game, found the way its engine finds them.
 *
 * An engine looks a file up in a chain: the loose files of the data folder
 * first, then (Fallout 2's engine) the mods, the patch archives and the high
 * resolution patch's archive, and last of all CRITTER.DAT and MASTER.DAT.
 * Fallout Et Tu adds the archive the console made of its data folder, right
 * below the data folder itself, and plays on Fallout 2's two archives (see
 * engine/config.ts, where the chain is set up).
 *
 * gamefacts.ts reads a handful of files out of one archive; the save editor
 * reads hundreds (every item, every picture), so here each archive's
 * directory is read once and kept.
 */
import { indexDat, readDatEntry, type DatEntry } from './dat';
import { GAMES, type GameId } from './games';
import { BORROWED_ARCHIVE, enabledMods } from './storage/ettu';
import { pathKey } from './storage/manifest';
import { loadInstall, openInstalled, type Install, type SourceBlob } from './storage/opfs';
import { listOverlayKeys, readOverlay } from './storage/overlay';

export interface GameData {
  game: GameId;
  /** The installs read, as one key: when it changes, so may the files. */
  key: string;
  /** A game file by its path inside the data folder ("text/english/game/perk.msg"), or null. */
  read(path: string): Promise<Uint8Array | null>;
  /** A file the engine opens by plain path from the game folder ("config/perks.ini"), or null. */
  plain(path: string): Promise<Uint8Array | null>;
}

interface Archive {
  source: SourceBlob;
  index: Promise<Map<string, DatEntry>> | null;
}

const SAVES = 'data/savegame/';

const bytesOf = async (source: SourceBlob): Promise<Uint8Array> => new Uint8Array(await source.arrayBuffer());

function hasFile(install: Install, path: string): boolean {
  const key = pathKey(path);
  return install.manifest.files.some((file) => pathKey(file.path) === key);
}

/** The archives of the chain, highest first, as the engine would open them. */
async function chain(game: GameId, install: Install, base: Install | null): Promise<SourceBlob[]> {
  const def = GAMES[game];
  const names: [Install, string][] = [];
  if (def.engine.id === 'fo1') {
    names.push([install, 'master.dat'], [install, 'critter.dat']);
  } else {
    const own = (path: string) => names.push([install, path]);
    // A conversion's second patch location is the archive made of its data folder.
    if (def.conversion && hasFile(install, BORROWED_ARCHIVE)) own(BORROWED_ARCHIVE);
    // Mods are opened in the order their list gives, each above the one before.
    const order = await openInstalled(install, 'mods/mods_order.txt');
    if (order) {
      const mods = enabledMods(new TextDecoder('latin1').decode(await bytesOf(order)));
      for (const mod of mods.reverse()) if (hasFile(install, `mods/${mod}`)) own(`mods/${mod}`);
    }
    const patches = install.manifest.files
      .map((file) => pathKey(file.path))
      .filter((key) => /^patch\d{3}\.dat$/.test(key))
      .sort()
      .reverse();
    for (const patch of patches) own(patch);
    if (hasFile(install, 'f2_res.dat')) own('f2_res.dat');
    const archives = def.conversion ? base : install;
    if (archives) names.push([archives, 'critter.dat'], [archives, 'master.dat']);
  }
  const sources: SourceBlob[] = [];
  for (const [from, name] of names) {
    const source = await openInstalled(from, name);
    if (source) sources.push(source);
  }
  return sources;
}

async function open(game: GameId): Promise<GameData | null> {
  const def = GAMES[game];
  const install = await loadInstall(game);
  if (!install) return null;
  const base = def.conversion ? await loadInstall(def.conversion.base) : null;
  if (def.conversion && !base) return null;
  const format = def.datFormat;

  // The data folder: what came with the game, under what the game wrote itself.
  const loose = new Map<string, () => Promise<Uint8Array | null>>();
  for (const file of install.manifest.files) {
    const key = pathKey(file.path);
    if (!key.startsWith('data/') || key.startsWith(SAVES)) continue;
    loose.set(key.slice(5), async () => {
      const source = await openInstalled(install, file.path);
      return source ? bytesOf(source) : null;
    });
  }
  for (const key of await listOverlayKeys(game, 'data/').catch(() => [])) {
    if (key.startsWith(SAVES)) continue;
    loose.set(key.slice(5), async () => {
      const entry = await readOverlay(game, key);
      return entry && !entry.deleted && entry.data ? entry.data : null;
    });
  }

  const archives: Archive[] = (await chain(game, install, base)).map((source) => ({ source, index: null }));

  return {
    game,
    key: `${install.manifest.install}/${base?.manifest.install ?? ''}`,
    async read(path) {
      const key = pathKey(path);
      const own = loose.get(key);
      if (own) {
        const data = await own();
        if (data) return data;
      }
      for (const archive of archives) {
        archive.index ??= indexDat(archive.source, format).catch(() => new Map());
        const entry = (await archive.index).get(key);
        if (!entry) continue;
        try {
          return await readDatEntry(archive.source, format, entry);
        } catch {
          return null;
        }
      }
      return null;
    },
    async plain(path) {
      const source = await openInstalled(install, path);
      return source ? bytesOf(source) : null;
    },
  };
}

const opened = new Map<GameId, Promise<GameData | null>>();

/**
 * The files of a game, or null when it is not installed (for a conversion:
 * when the game it runs on is not either). Kept while the installs stay the
 * same; an import or an eject is noticed the next time this is asked.
 */
export async function openGameData(game: GameId): Promise<GameData | null> {
  const known = await opened.get(game)?.catch(() => null);
  if (known) {
    const install = await loadInstall(game);
    const conversion = GAMES[game].conversion;
    const base = conversion ? await loadInstall(conversion.base) : null;
    if (install && `${install.manifest.install}/${base?.manifest.install ?? ''}` === known.key) return known;
  }
  const promise = open(game);
  opened.set(game, promise);
  return promise;
}
