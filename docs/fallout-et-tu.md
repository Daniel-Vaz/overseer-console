# Fallout Et Tu

[Fallout Et Tu](https://github.com/rotators/Fo1in2) is the first Fallout rebuilt, by fans, as a game for the
engine of Fallout 2. It is free, and none of it is hosted here. Deck C of the console puts it together from:

- **its package**: the zip it is downloaded as, a `Fallout1in2` folder, or the Fallout 2 folder that folder sits in;
- **Fallout 2** in deck B, whose engine and archives it plays on;
- **Fallout** in deck A, from whose `MASTER.DAT` the files named in the package's `undat_files.txt` are copied
  (speech, movies, map tiles). This is what the package's UNDAT tool does on a desktop. A folder that tool was
  already run in needs no deck A.

## How it is stored

The package is some sixteen thousand loose files once complete, and the engine and the console's storage are
both built for a few large archives. So the console stores each mod folder that `mods/mods_order.txt` switches on
as one archive (`mods/<name>`, which the engine opens wherever it would open a folder), and the bulk of the data
folder, with what was borrowed from Fallout, as another (`fallout1.dat`, given to the engine as the second of its
two patch locations). Music and settings files, which are read by plain path, stay files. At start-up Fallout 2's
`master.dat` and `critter.dat` appear in a folder of their own beside them.

The code is in [`src/lib/storage/ettu.ts`](../src/lib/storage/ettu.ts).

> [!NOTE]
> Since version 2.0 Et Tu is made for the Community Edition engine, the one the console runs, and its package
> holds `fallout2-ce.exe`; the console warns when the one you load does not (an older package). The console's own
> tests cover everything up to the engine opening what was put together. Playing the real thing is covered by the
> tests that need your copies (see [Developing](developing.md#tests-with-the-real-games)).
