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
    Overseer Console runs Fallout and Fallout 2 inside your browser, using the open source Community Edition
    engines. It does not include the games. You bring your own copy; the console copies its data files into this
    browser's private storage on this device and plays from there. Nothing is uploaded anywhere, unless you link
    your own Dropbox and upload saves to it yourself.
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

  <h2>Controls</h2>
  <p>The games play as they always did: mouse to move and act, right button to switch between walking and using.</p>
  <dl class="readout gap">
    <dt>F4 / F5</dt>
    <dd>Save game / load game</dd>
    <dt>F6 / F7</dt>
    <dd>Quick save / quick load</dd>
    <dt>ESC</dt>
    <dd>Game options</dd>
    <dt>F9</dt>
    <dd>Console menu: suspend the game, fullscreen, exit to this console</dd>
    <dt>F11</dt>
    <dd>Fullscreen</dd>
  </dl>
  <p>
    In fullscreen, Chrome and Edge keep ESC for the game (hold it to leave fullscreen). Firefox and Safari use ESC
    to leave fullscreen, so there the <span class="hot">`</span> key (left of 1) stands in for ESC.
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
    then plays without its music. To get the whole game onto such a device, music included, load it from your
    Dropbox (see below).
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
    <dd>Close heavy tabs. In Terminal settings, CLASSIC picture is the lightest.</dd>
    <dt>System fault</dt>
    <dd>Restart the simulation. Games you saved earlier are not affected.</dd>
    <dt>Dropbox link refused</dt>
    <dd>
      The message names what is missing. Usually it is a permission that was ticked but not submitted, or a code
      used twice: tick, press Submit, and open Dropbox again for a new code.
    </dd>
  </dl>
</div>

<Menu {items} label="Manual" />
