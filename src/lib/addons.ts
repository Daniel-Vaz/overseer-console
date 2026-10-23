/**
 * The add-ons loaded in this browser, and which games and mods each is laid
 * over.
 *
 * An add-on is a small mod with no game of its own: a few archives for the
 * load order, global scripts, music, loose data. It is loaded once and can
 * be switched on for the game it was made for and for any mod of that game:
 * its files are then laid over theirs when they start (see storage/mount.ts),
 * the later switched on over the earlier. It has no saves; a game played with
 * it saves as that game.
 */
import { gameDef, isBaseGame, isGameId, type BaseGameId, type GameId } from './games';
import { loadInstall, type Install } from './storage/opfs';

/** What this browser remembers of an add-on, also kept in the manifest of its install. */
export interface AddonRecord {
  id: string;
  title: string;
  version?: string;
  /** The game it was made for: it is laid over that game, and over that game's mods. */
  base: BaseGameId;
}

interface Register {
  addons: AddonRecord[];
  /** The add-ons laid over each game, the one under the others first. */
  on: Record<GameId, string[]>;
}

const REGISTER_KEY = 'overseer-console:addons';
const ADDON_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

function readRegister(): Register {
  try {
    const stored = JSON.parse(localStorage.getItem(REGISTER_KEY) ?? '{}') as Partial<Register>;
    const addons = (Array.isArray(stored.addons) ? stored.addons : []).filter(
      (record): record is AddonRecord => !!record && typeof record.id === 'string' && ADDON_ID.test(record.id) && typeof record.title === 'string' && isBaseGame(record.base),
    );
    const on: Record<GameId, string[]> = {};
    for (const [game, ids] of Object.entries(stored.on && typeof stored.on === 'object' ? stored.on : {})) {
      if (Array.isArray(ids)) on[game] = ids.filter((id): id is string => typeof id === 'string');
    }
    return { addons, on };
  } catch {
    return { addons: [], on: {} };
  }
}

function writeRegister(): void {
  try {
    localStorage.setItem(REGISTER_KEY, JSON.stringify(register));
  } catch {
    // A private window: the add-ons are remembered for this page only.
  }
}

let register: Register = readRegister();

/** The add-ons loaded in this browser, in the order they were first loaded. */
export function addonRecords(): readonly AddonRecord[] {
  return register.addons;
}

export function addonRecord(id: string): AddonRecord | undefined {
  return register.addons.find((record) => record.id === id);
}

/** The game a game or mod is played on: what an add-on for it must have been made for. */
export function engineGame(game: GameId): BaseGameId {
  return gameDef(game).mod?.base ?? (game as BaseGameId);
}

/** Remembers an add-on, or what it now is when it was loaded again. */
export function registerAddon(record: AddonRecord): void {
  const index = register.addons.findIndex((known) => known.id === record.id);
  const addons = index < 0 ? [...register.addons, record] : register.addons.map((known, at) => (at === index ? record : known));
  // Loaded again for another game, it is laid over none of the first one's.
  const on = Object.fromEntries(
    Object.entries(register.on).map(([game, ids]) => [game, isGameId(game) && engineGame(game) === record.base ? ids : ids.filter((id) => id !== record.id)]),
  );
  register = { addons, on };
  writeRegister();
}

/** Forgets an add-on: it no longer has files here, and is laid over nothing. */
export function forgetAddon(id: string): void {
  register = {
    addons: register.addons.filter((record) => record.id !== id),
    on: Object.fromEntries(Object.entries(register.on).map(([game, ids]) => [game, ids.filter((other) => other !== id)])),
  };
  writeRegister();
}

/** The add-ons laid over a game or mod, the one under the others first: those loaded here and made for its game. */
export function addonsOn(game: GameId): string[] {
  if (!isGameId(game)) return [];
  const base = engineGame(game);
  return (register.on[game] ?? []).filter((id) => addonRecord(id)?.base === base);
}

/** Lays an add-on over a game or mod, over the others already laid there; or takes it off. */
export function setAddonOn(game: GameId, id: string, on: boolean): void {
  const others = (register.on[game] ?? []).filter((other) => other !== id);
  register = { ...register, on: { ...register.on, [game]: on ? [...others, id] : others } };
  writeRegister();
}

/** The installs of the add-ons laid over a game or mod, the one under the others first: those whose files are here. */
export async function loadAddons(game: GameId): Promise<Install[]> {
  const installs = await Promise.all(addonsOn(game).map((id) => loadInstall(id, 'addons').catch(() => null)));
  return installs.filter((install): install is Install => !!install?.manifest.addon);
}

/** The games and mods an add-on is laid over. */
export function gamesWith(id: string): GameId[] {
  return Object.keys(register.on).filter((game) => addonsOn(game).includes(id));
}

/** The id for an add-on loaded anew, made from its title; not one a game or mod could have. */
export function newAddonId(title: string): string {
  const stem =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'addon';
  const taken = (id: string) => isBaseGame(id) || !!addonRecord(id);
  let id = taken(stem) ? `${stem}-2` : stem;
  for (let n = 3; taken(id); n++) id = `${stem}-${n}`;
  return id;
}
