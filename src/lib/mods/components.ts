/**
 * A mod's components: the parts its load order (mods/mods_order.txt) switches
 * on, and those beside them it leaves off. They are what a mod's installer
 * offers as options: the Restoration Project's world map or its companions'
 * armour, Fallout Et Tu's language packs.
 *
 * Switching one is a change to that file, kept with the mod's saves and
 * settings (see storage/overlay.ts) over the file it came with: the engine
 * reads the load order each time it starts, and putting it back as the mod
 * came is forgetting the change.
 */
import { gameDef, type GameId } from '../games';
import { Ini } from '../ini';
import { enabledMods } from '../storage/ettu';
import { pathKey } from '../storage/manifest';
import { mountGame } from '../storage/mount';
import { loadInstall, openInstalled } from '../storage/opfs';
import { clearOverlay, commitOverlay, readOverlay } from '../storage/overlay';
import { KNOWN_MODS } from './catalog';

const ORDER = 'mods/mods_order.txt';

export interface Component {
  /** As the load order names it: the mod folder or archive in mods/. */
  name: string;
  /** What it is, in words. */
  title: string;
  on: boolean;
}

export interface Components {
  list: Component[];
  /** The player changed the load order the mod came with. */
  changed: boolean;
}

/** What a part is called: by the mod's makers where the console knows them, else after its file. */
function titleOf(game: GameId, name: string): string {
  const known = gameDef(game).mod?.known;
  const named = known ? KNOWN_MODS[known].components?.[name.toLowerCase()] : undefined;
  if (named) return named;
  const words = name.replace(/\.dat$/i, '').replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The load order as the engine will read it, and the parts of the mod there are to switch. Null for a mod without parts. */
async function read(game: GameId): Promise<{ text: string; changed: boolean; parts: Map<string, string> } | null> {
  const def = gameDef(game);
  const install = await loadInstall(game);
  if (!install || !def.mod) return null;
  const base = await loadInstall(def.mod.base);
  const mounted = mountGame(game, install.manifest, base?.manifest);
  const text = async (key: string): Promise<string | null> => {
    const found = mounted.files.get(key);
    const from = found?.from === 'own' ? install : base;
    const file = found && from ? await openInstalled(from, found.file.path) : null;
    return file ? new TextDecoder('latin1').decode(new Uint8Array(await file.arrayBuffer())) : null;
  };
  // The parts: what lies in its mods folder, one level down, by lower-cased name.
  const parts = new Map<string, string>();
  for (const [key, { path }] of mounted.files) {
    const match = /^mods\/([^/]+)$/.exec(key);
    if (match && !/\.(ini|txt|cfg)$/.test(match[1]!)) parts.set(match[1]!, path.split('/')[1]!);
  }
  // Not the high resolution patch's art, which the Restoration Project keeps there (see engine/config.ts).
  const art = pathKey(Ini.parse((await text('f2_res.ini')) ?? '').get('MAIN', 'f2_res_dat') ?? '');
  if (art.startsWith('mods/')) parts.delete(art.slice('mods/'.length));
  if (!parts.size) return null;
  const own = await readOverlay(game, ORDER).catch(() => undefined);
  if (own?.data) return { text: new TextDecoder('latin1').decode(own.data), changed: true, parts };
  return { text: (await text(ORDER)) ?? '', changed: false, parts };
}

/** A mod's components, in the order its load order gives them, then the parts it leaves out. */
export async function readComponents(game: GameId): Promise<Components | null> {
  const found = await read(game);
  if (!found) return null;
  const on = enabledMods(found.text);
  const list: Component[] = [];
  const listed = new Set<string>();
  for (const line of found.text.split(/\r?\n/)) {
    const name = line.replace(/[;#].*$/, '').trim() || line.replace(/^[\s;#]+/, '').trim();
    const key = pathKey(name);
    const spelled = found.parts.get(key);
    if (!spelled || listed.has(key)) continue;
    listed.add(key);
    list.push({ name: spelled, title: titleOf(game, spelled), on: on.includes(key) });
  }
  // Parts it has that its load order does not name: an installer's options not chosen.
  for (const [key, spelled] of found.parts) {
    if (!listed.has(key)) list.push({ name: spelled, title: titleOf(game, spelled), on: false });
  }
  return { list, changed: found.changed };
}

/** Switches a part on or off. */
export async function setComponent(game: GameId, name: string, on: boolean): Promise<void> {
  const found = await read(game);
  if (!found) return;
  const key = pathKey(name);
  const lines = found.text.split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line.trim());
  let seen = false;
  const next = lines.map((line) => {
    const named = pathKey(line.replace(/[;#].*$/, '').trim() || line.replace(/^[\s;#]+/, '').trim());
    if (named !== key) return line;
    seen = true;
    // The engine passes over a line with a comment mark anywhere in it.
    return on ? name : `;${name}`;
  });
  if (!seen && on) next.push(name);
  await commitOverlay(game, { puts: [{ key: ORDER, path: ORDER, mtime: Date.now(), data: new TextEncoder().encode(`${next.join('\r\n')}\r\n`) }], deletes: [] });
}

/** Puts the load order back as the mod came. */
export async function resetComponents(game: GameId): Promise<void> {
  await clearOverlay(game, ORDER);
}
