# Overseer Console

Play **Fallout** and **Fallout 2** in your browser, from your own copy of the games.

Live site: <https://daniel-vaz.github.io/overseer-console/>

Overseer Console is a static web page styled as a vault terminal. It runs the open source
[Fallout Community Edition](https://github.com/alexbatalov/fallout1-ce) and
[Fallout 2 Community Edition](https://github.com/fallout2-ce/fallout2-ce) engines, compiled to
WebAssembly. You point it at the folder a store installed the game to; it copies the data files
into the browser's private storage on your device and plays from there.

- No game data is hosted or distributed here. You need to own the games
  ([GOG](https://www.gog.com/game/fallout), [Steam](https://store.steampowered.com/app/38400), Epic).
- Nothing is uploaded, unless you link your own Dropbox: then the saves you choose to upload go to a folder
  in your Dropbox and nowhere else. There is no server, no account and no tracking.
- Saved games work as in the originals and can be exported to and imported from zip files.
- Saving over a slot keeps what was in it: every slot has a history of earlier versions to roll back to.
- Continue takes you from the console straight into your latest save.
- Optional Dropbox link: carry saves between devices, and load a game from a folder in your own Dropbox
  (the way to get a game with its music onto a phone).
- The save archives show each save's screenshot and character sheet, read from the save file itself.
- Touch screens: tap, drag, press-and-hold and two-finger gestures stand in for the mouse, with on-screen mouse
  buttons and a keyboard that appears when a game asks for text.

This is an unofficial fan project. It is not affiliated with or endorsed by Bethesda Softworks,
ZeniMax Media, Microsoft or Interplay. Fallout is a trademark of Bethesda Softworks LLC.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| Engines | `engines/` | Pins an upstream commit of each engine, applies patches (Fallout 1 only), and compiles to WebAssembly inside the official Emscripten container. |
| Engine glue | `engines/lib/overseer.js` | Linked into both engines. Gives them a clock that can pause, hands the thread back to the browser during long loops, reads game archives from disk on demand, and reports file changes in batches. |
| Game data store | `src/lib/storage/` | Imported game files live in the origin private file system (OPFS). Files the engines write (saves, settings) live in IndexedDB and are committed atomically per save. Before a save slot is overwritten its contents go into a history (`history.ts`), with unchanged files stored once. |
| Save reader | `src/lib/savefile.ts`, `dat.ts`, `gamefacts.ts` | Reads a save's header, picture and character sheet, and fetches the palette and the names of perks, traits and skills out of the player's own `MASTER.DAT` (both archive formats). |
| Dropbox link | `src/lib/dropbox/` | Optional. Talks to the player's own Dropbox straight from the browser: linking, saves as one zip per slot, and game files read piece by piece through the same importer as a folder on disk. |
| Console | `index.html`, `src/launcher/` | The terminal: import, save archives, settings, manual, credits. Svelte. |
| Player | `play.html`, `src/player/` | Boots an engine against the stored data. A separate page, so that leaving a game frees its memory. `src/player/touch/` turns fingers into the mouse and keyboard events the engines already listen for. |

A game starts in well under a second because nothing is copied into memory up front: archives are
read in 1 MB blocks as the engine asks for them, with a bounded cache.

## Dropbox link

Optional. The console has no Dropbox app of its own: every player creates one in their own account, with
access to a single folder, and links the console to it.

1. In the [Dropbox App Console](https://www.dropbox.com/developers/apps) choose **Create app**, **Scoped
   access**, **App folder**, and any name.
2. On the app's **Permissions** tab tick `files.metadata.read`, `files.content.read` and
   `files.content.write`, and press **Submit**.
3. In the console open **Terminal settings**, **Dropbox link**. Enter the **App key** from the app's Settings
   tab, open Dropbox from there, allow the app, and paste the code it shows.

Linking is the OAuth code flow with PKCE. There is no app secret and no redirect address; the app key is
not a secret. After that:

- **Saves.** *Save archives* offers *Upload to Dropbox* and *Fetch from Dropbox*. Nothing moves by itself. A
  save only ever replaces an older one, and what a fetch replaces goes into the slot's history. In Dropbox a
  slot is one zip, `Apps/<app>/Saves/<game>/SLOTnn.zip`: the archive the console exports, so it unpacks
  into a desktop install.
- **Games.** Put the folder a game is installed in anywhere inside `Apps/<app>/`, using Dropbox's own app
  or website, and choose *Load holodisk from Dropbox* on the game's deck. The console only reads there.

Both folders can be changed on the Dropbox link screen.

The link is a token kept in this site's browser storage until *Unlink*, which also has Dropbox cancel it.
The token reaches the app's folder and nothing else. That limit matters: a site served from
`<user>.github.io/<project>/` shares its storage with every other page on that address. Create the app
with **App folder** access, never Full Dropbox.

## Developing

You need Node.js 22 or newer, git, and podman or docker (for the Emscripten container).

```sh
npm install
npm run engines     # build both engines into public/engines (a few minutes the first time)
npm run dev         # http://localhost:5173/overseer-console/
```

Checks:

```sh
npm run check       # types
npm test            # unit tests
npm run build && npm run test:e2e
```

The browser tests in `tests/e2e/console.spec.ts` need nothing else. The ones in
`tests/e2e/game.spec.ts` import and play the real games and are skipped unless you say where your
copies are:

```sh
FO1_DIR="/path/to/Fallout" FO2_DIR="/path/to/Fallout 2" npm run test:e2e
```

`tests/e2e/touch.spec.ts` plays them again with fingers only, on a phone-sized screen.

`tests/e2e/dropbox.spec.ts` and `tests/unit/dropbox.test.ts` run against a stand-in for Dropbox
(`tests/fake-dropbox.ts`). No test talks to the real one unless you ask: with a token generated on your
Dropbox app's Settings tab, this checks the stand-in against the real thing, in a folder of its own that it
removes again:

```sh
DROPBOX_TEST_TOKEN="<token>" npx vitest run tests/unit/dropbox.live.test.ts
```

`PW_BROWSERS=chromium,firefox,webkit` picks the browsers (default: Chromium). WebKit needs system
libraries that many machines lack; the official Playwright container has them:

```sh
podman run --rm --userns=keep-id --ipc=host -e HOME=/tmp -e PW_BROWSERS=webkit -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.64.0-noble npx playwright test
```

### Changing an engine

`engines/<name>/source.env` names the upstream repository and commit. `engines/<name>/patches/`
holds the changes applied on top, one file per change with its explanation at the top.

```sh
engines/patches.sh fo1 import    # patches -> .cache/engines/fo1-dev, one commit each
# edit, commit or amend in that tree (rebase it to move to a newer upstream commit)
engines/patches.sh fo1 export    # commits -> engines/fallout1/patches/
engines/build.sh fo1
```

`EXTRA_LINK_FLAGS=--profiling-funcs FORCE=1 engines/build.sh fo1` keeps function names in the
binary, for profiling in the browser's developer tools.

## Deploying

The workflow in `.github/workflows/deploy.yml` builds the engines and the site, runs the tests and
publishes `dist/` to GitHub Pages on every push to `main`. In the repository settings, set
**Pages → Build and deployment → Source** to **GitHub Actions** once.

The site is served from `/<repository name>/`; the workflow passes that to the build as
`BASE_PATH`.

## Credits

The engines are the work of [alexbatalov](https://github.com/alexbatalov) and the contributors to
[fallout1-ce](https://github.com/alexbatalov/fallout1-ce) and
[fallout2-ce](https://github.com/fallout2-ce/fallout2-ce). The WebAssembly target of Fallout 2 CE
was contributed by [ololoken](https://github.com/ololoken); the first browser port of the engine
was made by [roginvs](https://github.com/roginvs/fallout2-ce). The movie decoder fix carried in
the Fallout 1 patches was first published by [K1ngst0m](https://github.com/K1ngst0m/fallout1-ce-web).

Both engines are published under the
[Sustainable Use License](https://github.com/alexbatalov/fallout1-ce/blob/main/LICENSE.md), which
allows free, non-commercial use and distribution. The builds served by this project are modified
copies; every build ships its licence and third-party notices next to the binary
(`public/engines/<id>/LICENSE.txt`, `THIRD-PARTY.txt`). Because of that licence this site must
stay free of charge and non-commercial.

Also built on SDL, Emscripten, zlib, fflate, Svelte and the VT323 typeface by Peter Hull.
