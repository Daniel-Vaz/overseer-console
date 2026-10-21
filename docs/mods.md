# Mods

A mod is played on the game it was made for: its own files over that game's, on that game's engine, with saves of
its own. The game itself stays as it was sold, in its deck. Mods are kept in the **Mod library**, entry 3 of the
main directory.

<p align="center"><img src="images/mods.webp" width="800" alt="The console's Mod library: Fallout Et Tu, the Restoration Project and Fallout: Sonora, each for deck B, and the mods the console knows"></p>

## Loading one

Load the game the mod is played on into its deck first. Then, in the Mod library, choose **Load a mod** and hand the
console one of these, from a folder, a zip, by dropping it on the screen, or from your Dropbox or Google Drive:

- **the mod as it is downloaded**: a zip, or the folder it unpacks to;
- **a game folder the mod was installed in**, on a desktop, by its own installer.

Of what it is handed, the console keeps only what differs from the game in the deck. A game folder a mod was
installed in is compared with the deck's copy file by file: the game's archives and music, untouched by the mod, are
not stored a second time, and the mod is started with the deck's copy of them. Installers, programs and libraries
are left out; for the mods it knows, the console does what their installer would have done.

With your Dropbox or Google Drive linked, a mod can be loaded from the **Mods** folder inside your games folder
(`Apps/<app>/Mods` in Dropbox, `Overseer Console/Mods` in Google Drive, unless you changed the games folder): put each
mod there as the zip it is downloaded as, or as its folder, and choose it from the list *From Dropbox* (or *From
Google Drive*) shows. **Put in your cloud**, under Cloud link, puts it there from this device, packing a folder into
one zip on the way: a zip is a few large downloads where a folder is thousands of small ones. In Google Drive that is
the only way in, as Google lets the console see only what it put there itself.

## Installing one the console knows

Five of the mods the console knows come as one zip, from a link that needs no sign-in: Fallout Et Tu, the Restoration
Project, Fallout: Sonora, Olympus 2207 and Fallout 1.5: Resurrection. The console installs these itself: **Install a
known mod**, in the Mod library (or the mod's own page among *Mods the console knows*), at the version its tests
play.

| Mod | Version | File |
| --- | --- | --- |
| Fallout Et Tu | 2.0.3911 | `Fallout1in2.zip`, 394 MB |
| Restoration Project | 2.4.34 | `rpu_v2.4.34.zip`, 827 MB |
| Fallout: Sonora | 1.16.4E | `Fallout_Sonora_1.16.4E.zip`, 1.6 GB |
| Olympus 2207 | 1.1 | `Olympus-2207-English.zip`, 1.7 GB |
| Fallout 1.5: Resurrection | 1.5 | `FoRes_EN_1_5.zip`, 342 MB |

The sites they come from (GitHub's releases, Bitbucket) do not let a page of another site read what they serve, and
the console has no server of its own to fetch through. So:

- **With your Dropbox linked**, Dropbox downloads the zip itself, from its makers' link into the **Mods** folder, and
  the console loads it from there. It stays there for your other devices, and is not downloaded again. Dropbox gives
  itself five minutes for a download; were this tab closed meanwhile, Dropbox would carry on.
- **Otherwise** your browser downloads it (*Download*, in a tab of its own), and you select it or drop it on the
  screen. The console checks by its size that it is that release, and asks before loading anything else. With your
  Google Drive linked it then offers to put the zip in the Mods folder there.

A mod loaded at an older version than the one listed (as the name of its zip says) is offered the newer one on its
page; its saves are kept. The list is in
[`src/lib/mods/releases.ts`](../src/lib/mods/releases.ts); see [Developing](developing.md) for moving it on.

## Playing one

A mod's page starts it, and holds its save archives and its picture. **In deck B** (or A) puts it in its game's
deck: the deck plays it from then on, and its Begin and Continue start the mod. The deck's own **Mod** entry
switches between the mods loaded for it and none, the game as it was sold. Saves are each mod's own: neither the
game nor another mod sees them.

**Components** switch the parts of a mod its load order (`mods/mods_order.txt`) names on and off: what its installer
would offer as options, such as the Restoration Project's world map or companions' armour, or Fallout Et Tu's
language packs. The change is kept with the mod's saves, over the file it came with, and *As the mod comes* puts
it back.

## The mods the console knows

Any mod loads. These are known by name, started at the picture their makers meant, and told apart from each other
by a file of their own or the name of their folder.

| Mod | For | Hand the console | On this engine |
| --- | --- | --- | --- |
| [Fallout Et Tu](https://github.com/rotators/Fo1in2) | Fallout 2, built from Fallout as well | `Fallout1in2.zip`, its folder, or the Fallout 2 folder it sits in | Tested here |
| [Restoration Project](https://github.com/BGforgeNet/Fallout2_Restoration_Project) | Fallout 2 | `rpu_v*.zip` from its releases page, not the installer; or a Fallout 2 folder it was installed in | Tested here |
| [Fallout 2 Megamod](https://www.nma-fallout.com/resources/mib88-megamod.11/) | Fallout 2 | Its zip as it is downloaded, or a Fallout 2 folder it was installed in | Tested here |
| [Fallout: Sonora](https://cambragol.github.io/Fallout-Sonora/) | Fallout 2 | `Fallout_Sonora_*.zip` from its English releases page, or its folder | Tested here |
| [Fallout: Nevada](https://github.com/BGforgeNet/fallout-nevada-english-translation) | Fallout 2 | The folder it was installed in, its English translation copied over it | Tested here |
| [Olympus 2207](https://github.com/HogLord69/olympus-2207-english) | Fallout 2 | `Olympus-2207-English.zip`, or its folder | Tested here |
| [Fallout 1.5: Resurrection](https://resurrection.cz/en/) | Fallout 2 | `FoRes_EN_1_5.zip` from its download page, not the installer; or a Fallout 2 folder it was installed in | Tested here |
| [Fallout Yesterday](https://gitlab.com/falloutfans/fallouty) | Fallout 2, three of its archives | The folder its 7z ([Nexus Mods](https://www.nexusmods.com/fallout2/mods/91)) unpacks to, or the folder it was installed in | Tested here |
| [Fallout Fixt](https://www.moddb.com/mods/fallout-fixt) | Fallout | The Fallout folder its installer ran in, or the `Fallout Fixt` folder it made there | Tested here |

*Tested here* means the console's own tests play it from its real files: loaded, started, and into a new game, with
the engine reading the mod's own archives. What is known not to work on this engine is said on the mod's page and
when it is loaded: Olympus 2207 was made for sfall 5, the Megamod for the original engine with sfall, Fallout
Yesterday for sfall 4 (its Hero Appearance, the look picked for your character, and its few MP3 sounds are not there),
and what Fixt, Resurrection and Yesterday change in the game's program itself does not come along.

Sonora, Nevada and Olympus are whole games of their own, with their own archives; they still need Fallout 2 in deck B,
whose engine they play on. Olympus needs a picture at least 600 lines tall, so it is played at high resolution.

Fallout Yesterday is a game of its own as well, made to have Fallout 2's `master.dat`, `critter.dat` and
`patch000.dat` copied into its folder: the console takes those three from the Fallout 2 in deck B, and nothing else of
it. Its download is a 7z, which the console does not open: unpack it and hand over the folder. It starts at the wide
picture, the nearest to the one its makers set. Its hundred and more traits and perks are made with sfall's fake
traits and perks, which the console's Fallout 2 engine was given for it: on the character screen, in the perk box,
and in saved games.

Resurrection is played as its manual installation leaves it, in a `Resurrection` folder inside Fallout 2's that
reaches up for the game's archives and music. Its zip puts its own music in Fallout 2's `sound/music` folder, so hand
the console the zip, or the Fallout 2 folder it was unpacked into, rather than the `Resurrection` folder alone.

> [!NOTE]
> fo2.exe and similar launchers run the original programs of the games, with sfall, the original engine's
> extension, as a switch. The engines the console runs have the scripting additions of sfall built in, which most
> mods need: there is nothing to switch on. What a mod changes in a game's program itself cannot come along, and a
> few mods reach further into the original engine than its Community Edition follows; those parts of them are not
> there.

## Fallout Et Tu

[Fallout Et Tu](https://github.com/rotators/Fo1in2) is the first Fallout rebuilt, by fans, as a game for the engine of
Fallout 2. The console puts it together from:

- **its package**: the zip it is downloaded as, a `Fallout1in2` folder, or the Fallout 2 folder that folder sits in;
- **Fallout 2** in deck B, whose engine and archives it plays on;
- **Fallout** in deck A, from whose `MASTER.DAT` the files named in the package's `undat_files.txt` are copied
  (speech, movies, map tiles). This is what the package's UNDAT tool does on a desktop. A folder that tool was
  already run in needs no deck A.

Since version 2.0 Et Tu is made for the Community Edition engine, and its package holds `fallout2-ce.exe`; the console
warns when the one you load does not (an older package).

## How it is stored

A mod's files go into the console's storage beside the games', and are laid over its game's when it starts
([`src/lib/storage/mount.ts`](../src/lib/storage/mount.ts)), in one of two ways:

- **Over the game**, as a mod installed into a game folder is on a desktop. Files to unpack into a game folder (what
  the Restoration Project's zip holds) are used with the game's own files beside them, less what the mod's installer
  moves aside: the Restoration Project's installer puts the game's patch archive and loose data out of the way, and
  so does the console. A complete game folder (one holding `MASTER.DAT`) is started with nothing of the deck's game
  but the files its own copies were identical to.
- **Nested**, as Fallout Et Tu and Resurrection are: in a folder of its own, with Fallout 2's archives and music in a
  folder below it.

The engine and the console's storage are built for a few large archives, so folders of many small files are packed
into archives in the games' own format ([`src/lib/datpack.ts`](../src/lib/datpack.ts)): each mod folder in `mods/`,
an archive kept as a folder (Nevada's `MASTER.DAT`), and the bulk of a mod's data folder, which the engine is given as
its second patch location, directly below the data folder itself. An archive kept as a folder that is more than one
archive holds (2 GB) is stored as several, when the engine opens it by number: Fallout Yesterday's 4.6 GB
`patch001.dat` becomes `patch001.dat` to `patch003.dat`, and its `patch002.dat` the fourth. Music and settings, read
by plain path, stay files. Fallout's engine reads only Fallout's own archives, so a mod of Fallout is stored as loose
files.

What the mods the console knows need besides is in [`src/lib/storage/mods.ts`](../src/lib/storage/mods.ts) (the
Restoration Project's installer, the Megamod's proto tool, Fixt's and Resurrection's folders of their own, Olympus's
sfall 5 load order and scripts, the three archives Fallout Yesterday takes from Fallout 2) and
[`src/lib/storage/ettu.ts`](../src/lib/storage/ettu.ts); what the console knows of each, in
[`src/lib/mods/catalog.ts`](../src/lib/mods/catalog.ts).
