# How it works

Overseer Console is a static web page. It runs the open source
[Fallout Community Edition](https://github.com/alexbatalov/fallout1-ce) and
[Fallout 2 Community Edition](https://github.com/fallout2-ce/fallout2-ce) engines, compiled to
WebAssembly. You point it at the folder a store installed the game to; it copies the data files
into the browser's private storage on your device and plays from there.

| Part | Where | What it does |
| --- | --- | --- |
| Engines | [`engines/`](../engines/) | Pins an upstream commit of each engine, applies patches, and compiles to WebAssembly inside the official Emscripten container. The Fallout 2 engine's own data folder is packed into `ce.dat` beside it. |
| Engine glue | [`engines/lib/overseer.js`](../engines/lib/overseer.js) | Linked into both engines. Gives them a clock that can pause and run fast, hands the thread back to the browser during long loops, reads game archives from disk on demand, reports file changes in batches, and passes on the page's requests for an autosave. |
| Game data store | [`src/lib/storage/`](../src/lib/storage/) | Imported game files live in the origin private file system (OPFS). Files the engines write (saves, settings) live in IndexedDB and are committed atomically per save. Before a save slot is overwritten or erased its contents go into a history (`history.ts`), with unchanged files stored once. |
| Zip and archive tools | [`src/lib/zip.ts`](../src/lib/zip.ts), [`datpack.ts`](../src/lib/datpack.ts), [`blobs.ts`](../src/lib/blobs.ts) | Read files out of a zip where it lies, without unpacking it, and describe a game archive (`.dat`) made of loose files without copying them. To the importer both are files like any other. |
| Fallout Et Tu | [`src/lib/storage/ettu.ts`](../src/lib/storage/ettu.ts) | Finds the conversion in a selection and plans how to store it: see [Fallout Et Tu](fallout-et-tu.md). |
| Save reader | [`src/lib/savefile.ts`](../src/lib/savefile.ts), [`dat.ts`](../src/lib/dat.ts), [`gamefacts.ts`](../src/lib/gamefacts.ts) | Reads a save's header, picture and character sheet, and fetches the palette and the names of perks, traits, skills and places out of the player's own `MASTER.DAT` (both archive formats). |
| Save editor | [`src/lib/modify/`](../src/lib/modify/), [`src/launcher/modify/`](../src/launcher/modify/) | Maps a SAVE.DAT to the byte, to its end (`tail.ts`: world map, party, timed events), using the game's own item prototypes to know how each item is stored, and the map the party travels in (`mapfile.ts`, `party.ts`). Applies the engines' rules (`tables.ts` is generated from their sources; Fallout Et Tu's `Perks.ini`, `Skills.ini` and table of experience are read as its engine reads them) and names the world from the game's files (`world.ts`: vault13.gam, quests, holodisks, karma, towns). Writes only the changed fields, the inventory and the queue, and reads the result back before it is stored. |
| Dropbox link | [`src/lib/dropbox/`](../src/lib/dropbox/) | Optional. Talks to the player's own Dropbox straight from the browser: linking, saves as one zip per slot, and game files read piece by piece through the same importer as a folder on disk. See [Dropbox link](dropbox.md). |
| Console | [`index.html`](../index.html), [`src/launcher/`](../src/launcher/) | The terminal: import, save archives, settings, manual, credits. Svelte. |
| Vault | [`src/launcher/vault/`](../src/launcher/vault/) | The room around the console, where the window is larger than the console is. Painted in the browser, one coarse pixel at a time, from nothing but code: no artwork from the games. `life.ts` decides who walks through, when, and what they do about being poked; `effects.ts` has the things that answer to a click; `pest.ts` is the radroach that comes out onto the screen itself. |
| Player | [`play.html`](../play.html), [`src/player/`](../src/player/) | Boots an engine against the stored data. A separate page, so that leaving a game frees its memory. `src/player/touch/` turns fingers into the mouse and keyboard events the engines already listen for. |

A game starts in well under a second because nothing is copied into memory up front: archives are
read in 1 MB blocks as the engine asks for them, with a bounded cache.
