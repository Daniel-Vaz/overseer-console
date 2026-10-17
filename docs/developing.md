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
| `MEGAMOD` | `Fallout 2 Megamod 2.47.8.zip` | Nexus Mods (signed in) |
| `NEVADA` | the folder it was installed in, English translation over it | the English 2.0.3.3 folder fallout-nevada.ru serves |
| `FIXT` | the Fallout folder its installer ran in (`Fallout Fixt` inside it) | `Fallout_Fixt_0.81alpha_FULL_CUSTOM.exe` from its GitHub releases, run with Wine (`/VERYSILENT "/DIR=<Fallout folder>"`) |

```sh
FO1_DIR=... FO2_DIR=... RPU=... SONORA=... OLYMPUS=... MEGAMOD=... NEVADA=... FIXT=... npm run test:e2e -- game -g "loaded over the game"
```

Each is loaded, started, and taken into a new game. That it is the mod being played, not the game under it, is
checked on what the engine reads (the mod's own archives, and the game's only when the mod is laid over it), on a
file of the mod's as the engine finds it, and on the map in the quick save its first scene allows; the main menu
and the first scene are attached to the test as pictures. `tests/e2e/mods.spec.ts` and `tests/unit/mods.test.ts`
cover them on made-up files laid out as the real ones are (`tests/mods.ts`).

`tests/e2e/touch.spec.ts` plays them again with fingers only, on a phone-sized screen.

`tests/e2e/modify-games.spec.ts` changes a quick save with the save editor, loads it in the game, saves again from
inside it, and expects back what the editor wrote; then does the same with a companion (a creature of the first map
taken into the party, see `tests/party.ts`). `tests/unit/modify.real.test.ts` checks the editor against the
games' own rules, items, pictures and world, and reads every map of each game to its last byte; it takes the same
`FO1_DIR` and `FO2_DIR`, and `ETTU` as the unpacked `Fallout1in2` folder.

### Dropbox

`tests/e2e/dropbox.spec.ts` and `tests/unit/dropbox.test.ts` run against a stand-in for Dropbox
(`tests/fake-dropbox.ts`). No test talks to the real one unless you ask: with a token generated on your
Dropbox app's Settings tab, this checks the stand-in against the real thing, in a folder of its own that it
removes again:

```sh
DROPBOX_TEST_TOKEN="<token>" npx vitest run tests/unit/dropbox.live.test.ts
```

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
binary, for profiling in the browser's developer tools.

## Deploying

The workflow in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) builds the engines and the
site, runs the tests and publishes `dist/` to GitHub Pages on every push to `main`. In the repository settings,
set **Pages → Build and deployment → Source** to **GitHub Actions** once.

The site is served from `/<repository name>/`; the workflow passes that to the build as
`BASE_PATH`.

## Architecture

See [How it works](how-it-works.md) for what each part of the code does.
