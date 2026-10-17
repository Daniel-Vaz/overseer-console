# Mods

A mod is played on the game it was made for: its own files over that game's, on that game's engine, with saves of
its own. The game itself stays as it was sold, in its deck. Mods are kept in the **Mod library**, entry 3 of the
main directory.

<p align="center"><img src="images/mods.webp" width="800" alt="The console's Mod library: Fallout Et Tu, the Restoration Project and Fallout: Sonora, each for deck B, and the mods the console knows"></p>

## Loading one

Load the game the mod is played on into its deck first. Then, in the Mod library, choose **Load a mod** and hand the
console one of these, from a folder, a zip, by dropping it on the screen, or from your Dropbox:

- **the mod as it is downloaded**: a zip, or the folder it unpacks to;
- **a game folder the mod was installed in**, on a desktop, by its own installer.

Of what it is handed, the console keeps only what differs from the game in the deck. A game folder a mod was
installed in is compared with the deck's copy file by file: the game's archives and music, untouched by the mod, are
not stored a second time, and the mod is started with the deck's copy of them. Installers, programs and libraries
are left out; for the mods it knows, the console does what their installer would have done.

With your Dropbox linked, a mod can be loaded from the **Mods** folder inside your games folder (`Apps/<app>/Mods`
unless you changed the games folder): put each mod there as the zip it is downloaded as, or as its folder, and choose
it from the list *From Dropbox* shows. A zip is a few large downloads where a folder is thousands of small ones.

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
| [Restoration Project](https://github.com/BGforgeNet/Fallout2_Restoration_Project) | Fallout 2 | `rpu_v*.zip` from its releases page, not the installer; or a Fallout 2 folder it was installed in | Supported |
| [Fallout 2 Megamod](https://www.nma-fallout.com/resources/mib88-megamod.11/) | Fallout 2 | A Fallout 2 folder it was installed in | Experimental |
| [Fallout: Sonora](https://cambragol.github.io/Fallout-Sonora/) | Fallout 2 | `Fallout_Sonora_*.zip` from its English releases page, or its folder | Supported |
| [Fallout: Nevada](https://github.com/BGforgeNet/fallout-nevada-english-translation) | Fallout 2 | The folder it was installed in, its English translation copied over it | Supported |
| [Olympus 2207](https://github.com/HogLord69/olympus-2207-english) | Fallout 2 | `Olympus-2207-English.zip`, or its folder | Experimental |
| [Fallout Fixt](https://www.moddb.com/mods/fallout-fixt) | Fallout | A Fallout folder it was installed in | Experimental |

*Supported* means the makers of the Community Edition engine say it plays; *tested here* that the console's own tests
play it from its real files; *experimental* that it starts, and parts of it are known not to work on this engine.

Sonora, Nevada and Olympus are whole games of their own, with their own archives; they still need Fallout 2 in deck B,
whose engine they play on. Olympus needs a picture at least 600 lines tall, so it is played at high resolution.

> [!NOTE]
> fo2.exe and similar launchers run the original programs of the games, with sfall, the original engine's
> extension, as a switch. The engines the console runs have the scripting additions of sfall built in, which most
> mods need: there is nothing to switch on. What a mod changes in a game's program itself cannot come along, and a
> few mods reach further into the original engine than its Community Edition follows; that is what *experimental*
> is about.

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
- **Nested**, as Fallout Et Tu is: in a folder of its own, with Fallout 2's archives and music in a folder below it.

The engine and the console's storage are built for a few large archives, so folders of many small files are packed
into archives in the games' own format ([`src/lib/datpack.ts`](../src/lib/datpack.ts)): each mod folder in `mods/`,
an archive kept as a folder (Nevada's `MASTER.DAT`), and the bulk of a mod's data folder, which the engine is given as
its second patch location, directly below the data folder itself. Music and settings, read by plain path, stay
files. Fallout's engine reads only Fallout's own archives, so a mod of Fallout is stored as loose files.

What the mods the console knows need besides is in [`src/lib/storage/mods.ts`](../src/lib/storage/mods.ts) (the
Restoration Project's installer, Olympus's sfall 5 load order and scripts) and
[`src/lib/storage/ettu.ts`](../src/lib/storage/ettu.ts); what the console knows of each, in
[`src/lib/mods/catalog.ts`](../src/lib/mods/catalog.ts).
