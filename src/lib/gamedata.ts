/**
 * The files of an installed game, found the way its engine finds them.
 *
 * An engine looks a file up in a chain: the loose files of the data folder
 * first, then (Fallout 2's engine) its second patch location, the mods, the
 * patch archives and the high resolution patch's archive, and last of all
 * CRITTER.DAT and MASTER.DAT. A mod is read in the folder it is started in,
 * over the game it is played on (see storage/mount.ts), with the chain its
 * settings file is given (see engine/config.ts).
 *
 * gamefacts.ts reads a handful of files; the save editor reads hundreds
 * (every item, every picture), so here each archive's directory is read once
 * and kept.
 */
import { indexDat, readDatEntry, type DatEntry } from './dat';
import { namedArchives } from './engine/config';
import { GAMES, gameDef, type GameId } from './games';
import { enabledMods } from './storage/ettu';
import { pathKey } from './storage/manifest';
import { baseFolder, mountGame, type Mounted } from './storage/mount';
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

/** A file of the folder a game is started in, wherever it is stored. */
type Opener = (path: string) => Promise<SourceBlob | null>;

/** The archives of the chain, highest first, as the engine would open them. */
async function chain(game: GameId, mounted: Mounted, open: Opener, plain: (path: string) => Promise<Uint8Array | null>, installConfig: string | undefined): Promise<SourceBlob[]> {
  const def = gameDef(game);
  const has = (path: string) => mounted.files.has(pathKey(path));
  const names: string[] = [];
  if (def.engine.id === 'fo1') {
    names.push('master.dat', 'critter.dat');
  } else {
    // What the settings file names in place of the engine's own: a mod's second patch location, an archive
    // made of its data folder or one of its own, and the high resolution patch's art.
    const highRes = await plain('f2_res.ini');
    const named = namedArchives(mounted, installConfig, highRes ? new TextDecoder('latin1').decode(highRes) : undefined);
    if (named.patches && has(named.patches)) names.push(named.patches);
    // Mods are opened in the order their list gives, each above the one before. The list may have been
    // changed by the player under the mod's Components.
    const list = await plain('mods/mods_order.txt');
    if (list) {
      for (const mod of enabledMods(new TextDecoder('latin1').decode(list)).reverse()) if (has(`mods/${mod}`)) names.push(`mods/${mod}`);
    }
    // The patch archives, numbered from 000 for as long as there is a next one, the last above the rest.
    const patches: string[] = [];
    for (let index = 0; index < 1000 && has(`patch${String(index).padStart(3, '0')}.dat`); index++) patches.push(`patch${String(index).padStart(3, '0')}.dat`);
    names.push(...patches.reverse());
    const art = named.art ?? 'f2_res.dat';
    if (has(art)) names.push(art);
    const folder = mounted.mod?.layout === 'nested' ? `${baseFolder(mounted.mod.record.base)}/` : '';
    names.push(`${folder}critter.dat`, `${folder}master.dat`);
  }
  const sources: SourceBlob[] = [];
  for (const name of names) {
    const source = await open(name);
    if (source) sources.push(source);
  }
  return sources;
}

async function open(game: GameId): Promise<GameData | null> {
  const def = gameDef(game);
  if (!def) return null;
  const install = await loadInstall(game);
  if (!install) return null;
  const base = def.mod ? await loadInstall(def.mod.base) : null;
  if (def.mod && !base) return null;
  const format = def.datFormat;
  const mounted = mountGame(game, install.manifest, base?.manifest);
  const installs: Record<'own' | 'base', Install | null> = { own: install, base };
  const openMounted: Opener = async (path) => {
    const found = mounted.files.get(pathKey(path));
    const from = found && installs[found.from];
    return found && from ? openInstalled(from, found.file.path) : null;
  };
  /** A file the game wrote itself, in place of what came with it. */
  const written = async (key: string): Promise<Uint8Array | null> => {
    const entry = await readOverlay(game, key).catch(() => undefined);
    return entry && !entry.deleted && entry.data ? entry.data : null;
  };

  // The data folder: what came with the game, under what the game wrote itself.
  const loose = new Map<string, () => Promise<Uint8Array | null>>();
  for (const [key, { path }] of mounted.files) {
    if (!key.startsWith('data/') || key.startsWith(SAVES)) continue;
    loose.set(key.slice(5), async () => {
      const source = await openMounted(path);
      return source ? bytesOf(source) : null;
    });
  }
  for (const key of await listOverlayKeys(game, 'data/').catch(() => [])) {
    if (key.startsWith(SAVES)) continue;
    loose.set(key.slice(5), () => written(key));
  }

  const plain = async (path: string): Promise<Uint8Array | null> => {
    const own = await written(pathKey(path));
    if (own) return own;
    const source = await openMounted(path);
    return source ? bytesOf(source) : null;
  };
  const archives: Archive[] = (await chain(game, mounted, openMounted, plain, install.manifest.installConfig)).map((source) => ({ source, index: null }));

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
    plain,
  };
}

const opened = new Map<GameId, Promise<GameData | null>>();

/**
 * The files of a game, or null when it is not installed (for a mod: when
 * the game it is played on is not either). Kept while the installs stay the
 * same; an import or an eject is noticed the next time this is asked.
 */
export async function openGameData(game: GameId): Promise<GameData | null> {
  const known = await opened.get(game)?.catch(() => null);
  if (known) {
    const install = await loadInstall(game);
    const mod = GAMES[game]?.mod;
    const base = mod ? await loadInstall(mod.base) : null;
    if (install && `${install.manifest.install}/${base?.manifest.install ?? ''}` === known.key) return known;
  }
  const promise = open(game);
  opened.set(game, promise);
  return promise;
}
