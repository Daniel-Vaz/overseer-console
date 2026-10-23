/**
 * Keeps what this browser remembers of its mods (see games.ts) in step with
 * what its storage holds.
 *
 * A mod is remembered while its files are here, or its saves are: an
 * ejected mod's saves keep their name and their archive. One with neither is
 * forgotten. A mod whose files are here but that is not remembered (the
 * browser lost its settings, or Fallout Et Tu was loaded before mods were
 * more than one) is remembered again from its files.
 */
import { addonRecords, forgetAddon, registerAddon } from '../addons';
import { forgetMod, isBaseGame, modRecords, registerMod, type GameId, type ModRecord } from '../games';
import { SAVE_PREFIX } from '../savefile';
import { listErased } from '../storage/history';
import { loadInstall, storedGames } from '../storage/opfs';
import { countOverlay } from '../storage/overlay';
import { KNOWN_MODS } from './catalog';

/** Fallout Et Tu as the console knew it when it had a deck of its own. */
const ETTU: ModRecord = { id: 'ettu', known: 'ettu', title: KNOWN_MODS.ettu.title, base: 'fo2', donor: 'fo1' };

/** Whether a game has saves here, or saves erased within the week they are kept. */
async function hasSaves(game: GameId): Promise<boolean> {
  if ((await countOverlay(game, SAVE_PREFIX).catch(() => 0)) > 0) return true;
  return (await listErased(game).catch(() => [])).length > 0;
}

/**
 * Brings the remembered mods in line with storage. Returns whether anything
 * changed. `loading`: a mod on its way into storage, which has no files there
 * yet and is not to be forgotten for it.
 */
export async function syncMods(loading?: GameId): Promise<boolean> {
  let changed = false;
  const remembered = new Set(modRecords().map((record) => record.id));
  for (const id of await storedGames()) {
    if (isBaseGame(id) || remembered.has(id)) continue;
    const install = await loadInstall(id).catch(() => null);
    const record = install?.manifest.mod?.record ?? (id === ETTU.id && install ? ETTU : null);
    if (record && record.id === id) {
      registerMod(record);
      remembered.add(id);
      changed = true;
    }
  }
  // Et Tu's saves from the days of its own deck, its files since ejected.
  if (!remembered.has(ETTU.id) && (await hasSaves(ETTU.id))) {
    registerMod(ETTU);
    changed = true;
  }
  for (const record of [...modRecords()]) {
    if (record.id === loading || (await loadInstall(record.id).catch(() => null))) continue;
    if (await hasSaves(record.id)) continue;
    forgetMod(record.id);
    changed = true;
  }
  return changed;
}

/**
 * Brings the remembered add-ons in line with storage: one whose files are
 * here is remembered (again), one whose files are not is forgotten. They
 * have no saves to be kept for. `loading`: one on its way into storage.
 */
export async function syncAddons(loading?: string): Promise<boolean> {
  let changed = false;
  const stored = await storedGames('addons');
  const remembered = new Set(addonRecords().map((record) => record.id));
  for (const id of stored) {
    if (remembered.has(id)) continue;
    const record = (await loadInstall(id, 'addons').catch(() => null))?.manifest.addon?.record;
    if (record?.id !== id) continue;
    registerAddon(record);
    changed = true;
  }
  for (const record of [...addonRecords()]) {
    if (record.id === loading || (await loadInstall(record.id, 'addons').catch(() => null))) continue;
    forgetAddon(record.id);
    changed = true;
  }
  return changed;
}
