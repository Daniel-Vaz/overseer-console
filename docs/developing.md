# Developing

You need Node.js 22 or newer, git, and podman or docker (for the Emscripten container).

```sh
npm install
npm run engines     # build both engines into public/engines (a few minutes the first time)
npm run dev         # http://localhost:5173/overseer-console/
```

## Checks

```sh
npm run check       # types
npm test            # unit tests
npm run build && npm run test:e2e
```

The browser tests in `tests/e2e/console.spec.ts` need nothing else.

### Tests with the real games

The ones in `tests/e2e/game.spec.ts` import and play the real games and are skipped unless you say where your
copies are:

```sh
FO1_DIR="/path/to/Fallout" FO2_DIR="/path/to/Fallout 2" npm run test:e2e
```

With both of those and `ETTU="/path/to/Fallout1in2.zip"` (or its folder) the same file puts Fallout Et Tu
together from the real things and starts it. `tests/e2e/ettu.spec.ts` does as much as made-up data allows,
up to the engine opening the archives the console made.

The other mods the console knows are played from their real files when told where they are, with `FO2_DIR` (or
`FO1_DIR` for Fixt) beside them:

| Variable | What to give it | Where it is had |
| --- | --- | --- |
| `RPU` | `rpu_v2.4.34.zip` | its GitHub releases |
| `SONORA` | `Fallout_Sonora_1.16.4E.zip` | its English GitHub releases |
| `OLYMPUS` | `Olympus-2207-English.zip` | its English GitHub releases |
| `RESURRECTION` | `FoRes_EN_1_5.zip` | its download page, from the Bitbucket mirror |
| `YESTERDAY` | the folder its 7z unpacks to | its 7z from Nexus Mods (signed in); or the GitLab repository's `main` without the two films too large for it, LFS files fetched |
| `MEGAMOD` | `Fallout 2 Megamod 2.47.8.zip` | Nexus Mods (signed in) |
| `NEVADA` | the folder it was installed in, English translation over it | the English 2.0.3.3 folder fallout-nevada.ru serves |
| `FIXT` | the Fallout folder its installer ran in (`Fallout Fixt` inside it) | `Fallout_Fixt_0.81alpha_FULL_CUSTOM.exe` from its GitHub releases, run with Wine (`/VERYSILENT "/DIR=<Fallout folder>"`) |

```sh
FO1_DIR=... FO2_DIR=... RPU=... SONORA=... OLYMPUS=... MEGAMOD=... NEVADA=... RESURRECTION=... YESTERDAY=... FIXT=... npm run test:e2e -- game -g "loaded over the game"
```

Each is loaded, started, and taken into a new game. That it is the mod being played, not the game under it, is
checked on what the engine reads (the mod's own archives, and the game's only when the mod is laid over it), on a
file of the mod's as the engine finds it, and on the map in the quick save its first scene allows; the main menu
and the first scene are attached to the test as pictures. With `YESTERDAY` one more test frees a trait slot of its
ready-made character, takes one of its own traits in the perk box, and finds it in the save (`sfallgv.sav`) after a
load and a save again: the engine's sfall fake traits and perks, played for real. Yesterday's GitLab repository lacks
two films too large for it (`INTRO.MVE`, `MESAVERD.MVE`); the tests do not reach them. `tests/e2e/mods.spec.ts` and `tests/unit/mods.test.ts`
cover them on made-up files laid out as the real ones are (`tests/mods.ts`).

Add-ons are played from their real files as well:

| Variable | What to give it | Where it is had |
| --- | --- | --- |
| `FO2TWEAKS` | `fo2tweaks_v14.7.zip` | its GitHub releases (BGforgeNet/FO2tweaks) |
| `CASSIDY` | `cassidy_head.dat` | its GitHub releases (BGforgeNet/Fallout2_Cassidy_Head) |
| `PARTY_ORDERS` | `party_orders_v1.17.zip` | its GitHub releases (BGforgeNet/Fallout2_Party_Orders) |
| `MUSIC` | `fallout_1_2_lq_ebur128_music_v2.zip` | its GitHub releases (egornovivan/Fallout-1-2-HQ-music) |

```sh
FO1_DIR=... FO2_DIR=... RPU=... FO2TWEAKS=... CASSIDY=... PARTY_ORDERS=... MUSIC=... npm run test:e2e -- game -g "add-on"
```

FO2tweaks and Cassidy's head are laid over Fallout 2, whose settings are given `[debug] mode=screen` and
`show_script_messages=1`: the engine's own log says it opened both, in their order, and FO2tweaks' scripts say they
started; its keymap moving quick save to F5 is played too. Party Orders goes over the Restoration Project in place of
the older copy it comes with, last in its load order, and the music over Fallout, whose engine then reads its tracks
and none of the game's. `tests/e2e/addons.spec.ts` and `tests/unit/addons.test.ts` cover add-ons on made-up files.

`tests/e2e/touch.spec.ts` plays them again with fingers only, on a phone-sized screen.

`tests/e2e/modify-games.spec.ts` changes a quick save with the save editor, loads it in the game, saves again from
inside it, and expects back what the editor wrote; then does the same with a companion (a creature of the first map
taken into the party, see `tests/party.ts`). `tests/unit/modify.real.test.ts` checks the editor against the
games' own rules, items, pictures and world, and reads every map of each game to its last byte; it takes the same
`FO1_DIR` and `FO2_DIR`, and `ETTU` as the unpacked `Fallout1in2` folder.

### Dropbox and Google Drive

The tests run against stand-ins for the two clouds, `tests/fake-dropbox.ts` and `tests/fake-drive.ts`; the one for
Drive keeps Google's rule that the console sees only the files it made. `tests/unit/cloud.test.ts` runs every case of
saves, games, mods and Put in your cloud against both: what one cloud does, the other must. `dropbox.test.ts` and
`drive.test.ts` cover each one's linking and requests, `tests/e2e/dropbox.spec.ts` and `drive.spec.ts` the screens.

No test talks to a real cloud unless you ask. Each live test checks a stand-in against the real thing, in a folder of
its own that it removes again. For Dropbox, generate a token on your Dropbox app's Settings tab; for Google Drive, get
one with your own client (of the type *TVs and Limited Input devices*, see [Google Drive link](google-drive.md)):

```sh
DROPBOX_TEST_TOKEN="<token>" npx vitest run tests/unit/dropbox.live.test.ts

node tests/drive-token.mjs "<client id>" "<client secret>"   # a code to enter at google.com/device, then the token
GOOGLE_DRIVE_TEST_TOKEN="<token>" npx vitest run tests/unit/drive.live.test.ts
```

Neither can see what a browser is shown of the clouds' answers: the headers it lets a page of another site read
(CORS). After changing a call, link the console for real once in each browser and use it.

### Browsers

`PW_BROWSERS=chromium,firefox,webkit` picks the browsers (default: Chromium). WebKit needs system
libraries that many machines lack; the official Playwright container has them:

```sh
podman run --rm --userns=keep-id --ipc=host -e HOME=/tmp -e PW_BROWSERS=webkit -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.64.0-noble npx playwright test
```

## Changing an engine

`engines/<name>/source.env` names the upstream repository and commit. `engines/<name>/patches/`
holds the changes applied on top, one file per change with its explanation at the top.

```sh
engines/patches.sh fo1 import    # patches -> .cache/engines/fo1-dev, one commit each
# edit, commit or amend in that tree (rebase it to move to a newer upstream commit)
engines/patches.sh fo1 export    # commits -> engines/fallout1/patches/
engines/build.sh fo1
```

`EXTRA_LINK_FLAGS=--profiling-funcs FORCE=1 engines/build.sh fo1` keeps function names in the
binary, for profiling in the browser's developer tools. For a crash, add `-sASSERTIONS=1 -sSAFE_HEAP=2`: a stray
read or write then stops the engine with a stack trace (on the page's console) where the browser would crash the tab.
(`SAFE_HEAP=1` also stops on unaligned reads, which the film player makes and WebAssembly allows.)

### What a mod needs of sfall

```sh
npm run sfall-scan -- ~/games/mods/rpu ~/games/mods/nevada/FalloutNevadaEng   # folders or zips, as many as wanted
```

reads every compiled script of a mod (loose, in its archives, in zips) and its ddraw.ini, and lists what the engine it
is played on lacks: opcodes and metarules, those it takes and does nothing with, the addresses of the original
program's memory its scripts read, write and call that the engine does not answer for (those registered in its source
with `SFALL_MEMORY`, see `sfall_memory.h`), hooks it never calls, hook scripts (`hs_*.int`), global scripts it will
not find, and ddraw.ini settings it does not read. An address a script works out as it runs (from an object, say)
cannot be told. What each engine
has is read from its patched source (the tree `patches.sh import` makes, else the one `build.sh` made), so the list
follows the patches. Run it on the real mods after an engine change that adds any of these.

`tests/sfall` holds the scripts game.spec.ts plays over the real Fallout 2 to check what the engine was given of
sfall, compiled. After changing one, compile it again with [sslc](https://github.com/sfall-team/sslc), sfall's script
compiler, which builds for Node in the Emscripten container (`emcmake cmake` and `cmake --build` in its folder):

```sh
cd tests/sfall && node /path/to/sslc/build/bin/compiler.mjs -q -l -O2 gl_overseer.ssl -o gl_overseer.int
```

## Moving a mod to a newer release

The mods the console installs itself, and the release of each, are listed in
[`src/lib/mods/releases.ts`](../src/lib/mods/releases.ts). `npm run mod-releases` says whether each file listed is
still served at its size, and which mods have a newer release on GitHub (those downloaded from a page, Resurrection's,
Nexus Mods' and Nevada's, have to be looked at by hand). To move one on, change its version, file, url and bytes there, play it from its real files (the table
above), and update the table in [Mods](mods.md). A mod loaded at the old version is then offered the new one.

`DROPBOX_TEST_TOKEN` also checks that the real Dropbox downloads a release from GitHub through its redirect, the way
Install does.

## Deploying

The workflow in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) builds the engines and the
site, runs the tests and publishes `dist/` to GitHub Pages on every push to `main`. In the repository settings,
set **Pages → Build and deployment → Source** to **GitHub Actions** once.

The site is served from `/<repository name>/`; the workflow passes that to the build as
`BASE_PATH`.

## Architecture

See [How it works](how-it-works.md) for what each part of the code does.
