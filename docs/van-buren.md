# Van Buren

In 2003 Black Isle Studios was making Fallout 3, under the name Van Buren, when Interplay cancelled it. The tech
demo they made to show the game to the rest of Interplay is all of it that was ever playable. It became public in
2007 and the [Internet Archive keeps it](https://archive.org/details/f3demo).

The console plays it as **Simulation 03**, entry `V` of the main directory, on
[Open Van Buren](https://github.com/sulkytroll/open-vanburen): an engine written anew for the demo by sulkytroll,
which reads the demo's own archives and runs its own scripts. Its browser build is made the way the Fallout engines'
are (see [Developing](developing.md#changing-an-engine)).

It is not a Fallout game to the console: it has no deck, saves, mods or add-ons, its files are kept apart from
the games', and it starts on a page of its own. Nothing about the two games changes with it.

## Loading it

- **Fetch from the Internet Archive.** One key: the browser downloads `F3_Demo.rar` (242 MB) from archive.org and
  unpacks it in this browser. Of its 729 MB, the 560 MB the engine reads are kept; the original program, its
  libraries, two logo movies and a second copy of `Sounds.grp` are not. The archive is not kept either, once
  unpacked. A download broken off is fetched again from the start: archive.org does not resume this one.
- **Your own copy.** The same `F3_Demo.rar`, downloaded before, or the folder it was unpacked to (the one holding
  `resource.rht` and `data`), picked or dropped on the screen. A copy whose files differ from the archive.org
  release, such as the one that starts in the Vault, is played all the same, and the screen says it is another copy.

Nothing is uploaded, and none of the demo is hosted here.

## Playing it

A keyboard and a mouse, and a browser with WebGL 2 (every current Chrome, Edge, Firefox and Safari). Click to walk,
use, talk and pick up; `W A S D` move the camera, `Q` `E` and the wheel turn and zoom it; `I` `K` `J` open the
inventory, character sheet and journal; `ENTER` ends a turn in a fight; `F1` lists the rest. The console's own keys
are `F9` (its menu, which pauses the demo) and `F11` (fullscreen).

The demo's main menu starts a new game in Junktown, and has a browser of all of its 38 maps and of its 3,916 models.
Junktown and the Vault are the maps that play. It keeps no saves: each visit starts afresh. Where the demo's files
do not say how something worked, Open Van Buren makes its best guess; see its
[roadmap](https://github.com/sulkytroll/open-vanburen/blob/main/docs/PLAN.md) for what it does not do yet.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| Engine | [`engines/vanburen/`](../engines/vanburen/) | Open Van Buren at a pinned commit, with patches for a browser build: OpenGL ES 3 (WebGL 2) in place of desktop OpenGL 3.3, the archives read as their files are asked for instead of mapped into memory, and the browser given its turn once a frame, after the frame is drawn. |
| The demo's files | [`src/lib/vanburen/demo.ts`](../src/lib/vanburen/demo.ts) | What the engine reads, with each file's size and CRC-32 as the archive.org release has them. |
| Fetching and unpacking | [`unpack.worker.ts`](../src/lib/vanburen/unpack.worker.ts) | Downloads the archive into storage, then unpacks it with RARLAB's own UnRAR, compiled to WebAssembly ([node-unrar-js](https://github.com/YuJianrong/node-unrar.js)), in a worker: the archive is read 4 MB at a time where it lies, and each file goes into storage as it comes out, so neither is ever whole in memory. UnRAR checks every file against the archive's CRC. |
| Storage | [`store.ts`](../src/lib/vanburen/store.ts) | `overseer-console/demos/vb/` in the browser's private file system, laid out as a game's install is. |
| Player | [`vanburen.html`](../vanburen.html), [`src/player/vanburen.ts`](../src/player/vanburen.ts), [`boot.ts`](../src/lib/vanburen/boot.ts) | Boots the engine against those files, at the size of the window. |

The archive comes from `https://archive.org/cors/f3demo/F3_Demo.rar`: archive.org's `/download/` address does not
let a page of another site read the file, its `/cors/` one does.
