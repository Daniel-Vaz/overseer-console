<script lang="ts">
  import { onMount } from 'svelte';
  import Menu from '../components/Menu.svelte';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  onMount(() => {
    sys.hints = [
      ['PGUP/PGDN', 'SCROLL'],
      ['ESC', 'BACK'],
    ];
  });

  const items: MenuItem[] = [{ key: '0', label: 'Back', action: () => go('') }];
</script>

<h1>Operations manual</h1>

<div class="prose">
  <h2>What this is</h2>
  <p>
    Overseer Console runs Fallout, Fallout 2 and the conversion Fallout Et Tu inside your browser, using the open
    source Community Edition engines. It does not include the games. You bring your own copy; the console copies its
    data files into this browser's private storage on this device and plays from there. Nothing is uploaded
    anywhere, unless you link your own Dropbox and upload saves to it yourself.
  </p>

  <h2>Where the game files are</h2>
  <p>Install the game with its store's launcher, then find the folder it was installed to:</p>
  <dl class="readout gap">
    <dt>Steam</dt>
    <dd>
      Library, right-click the game, Manage, Browse local files. Usually
      <span class="hot">C:\Program Files (x86)\Steam\steamapps\common\Fallout 2</span>
    </dd>
    <dt>GOG</dt>
    <dd>GOG Galaxy: the game's settings button, Manage installation, Show folder. Usually <span class="hot">C:\GOG Games\Fallout 2</span></dd>
    <dt>Epic</dt>
    <dd>Library, the game's menu, Manage, then the folder icon next to Installation.</dd>
  </dl>
  <p>
    Select that folder as a whole. The console takes what the engine needs (<span class="hot">MASTER.DAT</span>,
    <span class="hot">CRITTER.DAT</span>, <span class="hot">PATCH000.DAT</span> for Fallout 2, and the
    <span class="hot">DATA</span> and <span class="hot">SOUND</span> folders) and ignores the rest. A game needs
    roughly 600 MB of free disk space.
  </p>
  <p>
    Your browser will ask whether to "upload" the folder. That is the browser's wording for letting a page read
    files; the files go no further than this device.
  </p>
  <p>
    One <span class="hot">zip</span> of that folder does as well, for any of the games: choose it on the game's
    deck, or drop it on the console. It is read where it lies and is not unpacked anywhere.
  </p>
  <p>
    A copy that is under way can be called off with <span class="hot">Stop loading</span>: what was copied is thrown
    away, and the deck is as it was before. Loading a holodisk again, and ejecting it, are under
    <span class="hot">Holodisk</span> on the deck of a game that is loaded; saved games are kept either way.
  </p>

  <h2>Fallout Et Tu</h2>
  <p>
    Deck C plays <span class="hot">Fallout Et Tu</span>: the first Fallout rebuilt, by fans, as a game for the engine
    of Fallout 2. It is free, and it is not a game by itself. The console puts it together from three things.
  </p>
  <dl class="readout gap">
    <dt>Its package</dt>
    <dd>
      One zip, downloaded from the project; deck C has the link. Hand the console the zip as it is. The
      <span class="hot">Fallout1in2</span> folder of a desktop install does as well, and so does the Fallout 2 folder
      that folder sits in.
    </dd>
    <dt>Fallout 2</dt>
    <dd>Deck B. Et Tu plays on its engine and from its archives, so deck B has to stay loaded.</dd>
    <dt>Fallout</dt>
    <dd>
      Deck A. Several thousand of its files (speech, movies, map tiles) are copied out of
      <span class="hot">MASTER.DAT</span> while Et Tu is loaded: the work of the UNDAT tool on a desktop. After that
      deck A may be ejected. A folder UNDAT was already run in needs no deck A at all.
    </dd>
  </dl>
  <p>
    Load decks A and B first, then deck C. Count on about 1 GB of storage for Et Tu, on top of the two games. Its
    saved games are its own, with their own archives.
  </p>
  <p>
    Et Tu on the engine the console runs is young: its makers call it playable, and not yet finished. Take the
    newest package. One made for this engine holds a file called <span class="hot">fallout2-ce.exe</span>; the
    console says so when the package you load does not.
  </p>
  <p>
    The console loads the mods that <span class="hot">mods\mods_order.txt</span> in the package switches on, and
    takes the settings in its <span class="hot">config</span> folder as they are. To play with a language pack or
    another choice of options, change those files in a copy of the folder and load that. Et Tu starts at
    <span class="hot">HIGH RESOLUTION</span>, the picture it was laid out for; deck C has the others.
  </p>

  <h2>Controls</h2>
  <p>The games play as they always did: mouse to move and act, right button to switch between walking and using.</p>
  <dl class="readout gap">
    <dt>F4 / F5</dt>
    <dd>Save game / load game</dd>
    <dt>F6 / F7</dt>
    <dd>Quick save / quick load</dd>
    <dt>ESC</dt>
    <dd>Game options</dd>
    <dt>F8</dt>
    <dd>Fast forward, on and off</dd>
    <dt>F9</dt>
    <dd>Console menu: suspend the game, fullscreen, exit to this console</dd>
    <dt>F11</dt>
    <dd>Fullscreen</dd>
  </dl>
  <p>
    In fullscreen, Chrome and Edge keep ESC for the game (hold it to leave fullscreen). Firefox and Safari use ESC
    to leave fullscreen, so there the <span class="hot">`</span> key (left of 1) stands in for ESC.
  </p>

  <h2>Picture</h2>
  <p>
    Every game is played at a picture of its own, chosen on its deck (all three are side by side under Terminal
    settings, <span class="hot">Picture</span>). Fallout and Fallout 2 start at the original picture, Fallout Et Tu
    at high resolution. A change takes hold the next time the game is started.
  </p>
  <dl class="readout gap">
    <dt>Classic 4:3</dt>
    <dd>The original 640 x 480 picture. The most faithful choice, and the lightest</dd>
    <dt>Wide</dt>
    <dd>Same zoom as the original, widened to the shape of your window: more of the map is visible</dd>
    <dt>High resolution</dt>
    <dd>Half as tall again and as wide as your window: far more of the map, everything on it smaller</dd>
  </dl>

  <h2>Fast forward and improvements</h2>
  <p>
    <span class="hot">F8</span> runs a game several times as fast until it is pressed again; a sign in the corner
    says so while it does. It is for the long walk across a map and the turns of a dozen rats. Sound keeps its own
    pace, so speech and movies are better watched without it. How fast is chosen in Terminal settings.
  </p>
  <p>
    <span class="hot">Game improvements</span> in Terminal settings switches on what the engine of Fallout 2 adds
    to the game: holding the left <span class="hot">SHIFT</span> key lights up the items, containers and bodies
    lying anywhere in the picture, walls or no walls; the inventory has a second column; companions' own
    inventories can be reached when looting and bartering; doors that are neither locked nor special open as you
    walk into them; the interface shows up to 16 action points; and with the HIGH RESOLUTION picture the barter
    screen has a fourth row. Switched off, Fallout 2 plays as the original did. Fallout Et Tu comes with its
    makers' own choice of these and keeps it, save for the key: <span class="hot">SHIFT</span> lights things up
    the same way in every game the console runs. The engine of Fallout has none of this.
  </p>

  <h2>Touch screens</h2>
  <p>
    On a phone or tablet the games are played with fingers on the picture, and a few buttons appear beside it. The
    first time, the game explains them; MENU brings the explanation back.
  </p>
  <dl class="readout gap">
    <dt>Tap</dt>
    <dd>Click. In the games, tap the small round buttons, not the words beside them</dd>
    <dt>Drag</dt>
    <dd>Move the pointer without clicking, to look before you act</dd>
    <dt>Press and hold</dt>
    <dd>Hold the button down: opens the action menu on a person or thing, picks up an item to drag</dd>
    <dt>Two fingers</dt>
    <dd>Drag to scroll the map and lists. Tap to switch the cursor between walking and using</dd>
    <dt>CLICK, CURSOR</dt>
    <dd>
      The two mouse buttons. CLICK clicks where the pointer already is, for small targets: drag to aim, then press
      it. CURSOR is the right button
    </dd>
    <dt>KEYS, ESC, MENU</dt>
    <dd>A keyboard (it comes up by itself when a game asks for text), the escape key, and the console menu</dd>
    <dt>The small buttons</dt>
    <dd>
      Keys the games answer to, a tap away: INV the inventory, MAP the map of the place, PIP the Pip-Boy, SKILL the
      skilldex, TURN the end of your turn in combat. FAST is fast forward. LIGHT, where a game has it, lights up
      what lies on the ground for as long as it is held
    </dd>
  </dl>
  <p>
    Terminal settings has a <span class="hot">Touch pointer</span> choice: the pointer can follow your finger, or the
    picture can work like a laptop trackpad, which is more precise on a small screen. Turn a phone sideways; on an
    iPhone, add the console to the home screen to play without the browser's bars.
  </p>
  <p>
    The game files have to be where the device's file picker can reach them: copied onto it, or in a cloud folder.
    Where the browser cannot pick a whole folder, select <span class="hot">MASTER.DAT</span>,
    <span class="hot">CRITTER.DAT</span> and, for Fallout 2, <span class="hot">PATCH000.DAT</span> together; the game
    then plays without its music. To get the whole game onto such a device, music included, select one zip of the
    game folder instead, or load it from your Dropbox (see below).
  </p>

  <h2>Saved games</h2>
  <p>
    Saving works as in the original games. Each save is written to this browser's storage the moment the game
    finishes it. Saves live in this browser on this device only: use Save archives on the main directory to export
    them to a zip file as a backup, or to move them to another browser or a desktop install. Linking your Dropbox
    (see below) does the moving for you.
  </p>
  <p>
    Save archives shows each save with the picture the game stored with it and a summary of the character: level, hit
    points, statistics, tagged skills, traits and perks. The names come from your own game files.
  </p>
  <p>
    <span class="hot">Continue</span> on the main directory starts the game you saved last and takes you straight
    into that save, skipping the game's menus. Any other save can be started the same way: open its slot in Save
    archives and choose <span class="hot">Load this save</span>.
  </p>
  <p>
    Saving over a slot does not destroy what was in it. The console keeps earlier versions of every slot (the latest
    three, and a thinning trail of older ones reaching back days) and can put any of them back: open the slot in Save
    archives and choose <span class="hot">Earlier versions</span>. Use it when a save turns out to be a dead end.
  </p>
  <p>
    Erasing a save takes it out of its slot, not out of reach. For a week it is kept, with its earlier versions,
    under <span class="hot">Erased saves</span> in the game's archive, and can be put back in its slot from there.
  </p>
  <p>
    Clearing this site's data in your browser deletes the game data and the saves. Safari may also clear data of
    sites you have not opened for a week; exporting your saves is the safe habit there.
  </p>

  <h2>Your Dropbox</h2>
  <p>
    Optional. The console can keep saves in your own Dropbox, to carry them between devices, and load a game from
    a folder there. It has no accounts and no server of its own: you make a small private app in your Dropbox
    account, and the console is let into that app's folder and nowhere else.
  </p>
  <dl class="readout gap">
    <dt>Make the app</dt>
    <dd>
      At <span class="hot">dropbox.com/developers/apps</span> choose Create app, Scoped access,
      <span class="hot">App folder</span>, and any name. On its Permissions tab tick
      <span class="hot">files.metadata.read</span>, <span class="hot">files.content.read</span> and
      <span class="hot">files.content.write</span>, and press Submit.
    </dd>
    <dt>Link</dt>
    <dd>
      Terminal settings, Dropbox link. Enter the App key from the app's Settings tab, open Dropbox from there,
      allow the app, and paste the code it shows. Once in every browser you play in.
    </dd>
    <dt>Saves</dt>
    <dd>
      Save archives, then a game. <span class="hot">Upload to Dropbox</span> sends the saves that are newer here;
      <span class="hot">Fetch from Dropbox</span> brings in the ones that are newer there. A save only ever
      replaces an older one, and what a fetch replaces is kept as an earlier version.
    </dd>
    <dt>Games</dt>
    <dd>
      With Dropbox's own app or website, put the folder the game is installed in into Apps, then the folder named
      after your app. On the game's deck here choose <span class="hot">Load holodisk from Dropbox</span>. A game
      is roughly 600 MB; a free Dropbox holds 2 GB.
    </dd>
    <dt>Unlink</dt>
    <dd>
      Dropbox link, Unlink. The link stays in this browser until then, so unlink on a computer that is not yours.
      Removing the app under Connected apps in your Dropbox account ends it as well.
    </dd>
  </dl>
  <p>
    Nothing moves by itself: saves go to Dropbox when you upload them and come back when you fetch them. Erasing a
    save that was uploaded erases its copy in Dropbox too; Dropbox keeps deleted files for a while, should you want
    one back.
  </p>

  <h2>If something fails</h2>
  <dl class="readout gap">
    <dt>No sound</dt>
    <dd>Browsers only allow sound after a click or key press. Press a key when the game asks you to.</dd>
    <dt>No music</dt>
    <dd>The music is in the SOUND\MUSIC (or DATA\SOUND\MUSIC) folder. Load the holodisk again from the full game folder.</dd>
    <dt>Holodisk rejected</dt>
    <dd>The selection must contain MASTER.DAT. Pick the folder that holds it, not a folder above or below.</dd>
    <dt>Stutter</dt>
    <dd>Close heavy tabs. Of the pictures on a game's deck, CLASSIC is the lightest.</dd>
    <dt>Et Tu rejected</dt>
    <dd>
      It needs Fallout in deck A while it is loaded, and Fallout 2 in deck B to play. The message names which one
      is missing.
    </dd>
    <dt>System fault</dt>
    <dd>
      The screen says what the engine reported. A game that stops while it is starting has found fault with its
      data: load the holodisk again from the complete game folder. Otherwise restart the simulation. Games you saved
      earlier are not affected.
    </dd>
    <dt>Dropbox link refused</dt>
    <dd>
      The message names what is missing. Usually it is a permission that was ticked but not submitted, or a code
      used twice: tick, press Submit, and open Dropbox again for a new code.
    </dd>
  </dl>
</div>

<Menu {items} label="Manual" />
