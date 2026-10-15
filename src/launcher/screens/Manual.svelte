<script module lang="ts">
  /** The chapter read last: the contents come back with it under the cursor. */
  let lastRead = 0;
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import type { IconName } from '../icons';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go, chapter }: { go: (path: string) => void; chapter?: string } = $props();

  interface Chapter {
    id: string;
    title: string;
    icon: IconName;
    /** What it is about, in a line. */
    summary: string;
    /** Its sections, in order: the headings it has. */
    topics: string[];
  }

  const CHAPTERS: Chapter[] = [
    {
      id: 'files',
      title: 'Loading a game',
      icon: 'folder',
      summary: 'Where the stores install the games, and how the console takes them in: a folder, a zip or a few files.',
      topics: ['Where the game files are', 'Loading the folder', 'From a zip', 'On a phone or tablet', 'Stopping and ejecting'],
    },
    {
      id: 'ettu',
      title: 'Fallout Et Tu',
      icon: 'gamedata',
      summary: 'The first Fallout rebuilt for the engine of Fallout 2: what it is put together from, and how.',
      topics: ['What it needs', 'Loading it', 'Its options'],
    },
    {
      id: 'controls',
      title: 'Controls',
      icon: 'keypad',
      summary: 'The keys of the games and of the console, and ESC in fullscreen.',
      topics: ['Mouse and keys', 'Fullscreen'],
    },
    {
      id: 'picture',
      title: 'Picture and speed',
      icon: 'picture',
      summary: 'The three pictures a game can be played at, fast forward, and what the engine of Fallout 2 adds.',
      topics: ['Picture', 'Fast forward', 'Game improvements'],
    },
    {
      id: 'touch',
      title: 'Touch screens',
      icon: 'pointer-finger',
      summary: 'Playing on a phone or tablet: what fingers do, and the buttons beside the picture.',
      topics: ['Fingers', 'The buttons', 'The pointer'],
    },
    {
      id: 'saving',
      title: 'Saving',
      icon: 'save',
      summary: 'How saves are kept, quick saves in slot 07, autosaves, and when they last left the browser.',
      topics: ['Saved games', 'Quick save', 'Autosave', 'Last exported'],
    },
    {
      id: 'archives',
      title: 'Save archives',
      icon: 'export-save',
      summary: 'Continue, earlier versions of a slot, erased saves, and keeping them safe.',
      topics: ['What they show', 'Continue', 'Earlier versions', 'Erased saves', 'Keeping them safe'],
    },
    {
      id: 'dropbox',
      title: 'Your Dropbox',
      icon: 'uplink',
      summary: 'Optional. Saves carried between devices, and games loaded from a folder of your own Dropbox.',
      topics: ['Linking', 'Saves and games', 'Unlinking'],
    },
    {
      id: 'faults',
      title: 'If something fails',
      icon: 'warning',
      summary: 'No sound, a holodisk rejected, a system fault: what each means and what to do.',
      topics: ['Troubleshooting'],
    },
  ];

  const index = $derived(CHAPTERS.findIndex((entry) => entry.id === chapter));
  const current = $derived(CHAPTERS[index]);
  const previous = $derived(CHAPTERS[index - 1]);
  const next = $derived(CHAPTERS[index + 1]);

  // The page is made afresh for every chapter: where its cursor starts is decided once.
  let selected = $state(untrack(() => (index < 0 ? lastRead : 0)));
  /** The chapter under the cursor of the contents. */
  const shown = $derived<Chapter | undefined>(CHAPTERS[selected]);
  let prose: HTMLElement | undefined = $state();

  onMount(() => {
    if (index >= 0) lastRead = index;
    sys.hints =
      index < 0
        ? [
            ['↑↓', 'SELECT'],
            ['ENTER', 'READ'],
            ['1-9', 'CHAPTER'],
            ['ESC', 'BACK'],
          ]
        : [
            ['PGUP/PGDN', 'SCROLL'],
            ['N/P', 'NEXT/PREVIOUS'],
            ['ESC', 'CONTENTS'],
          ];
  });

  const contents = $derived<MenuItem[]>([
    ...CHAPTERS.map(
      (entry, number): MenuItem => ({
        key: String(number + 1),
        label: entry.title,
        note: entry.summary,
        icon: entry.icon,
        action: () => go(`manual/${entry.id}`),
      }),
    ),
    { key: '0', label: 'Back', icon: 'back', note: 'To the main directory.', action: () => go('') },
  ]);

  const turns = $derived<MenuItem[]>([
    ...(next ? [{ key: 'n', label: `Next: ${next.title}`, action: () => go(`manual/${next.id}`) }] : []),
    ...(previous ? [{ key: 'p', label: `Previous: ${previous.title}`, action: () => go(`manual/${previous.id}`) }] : []),
    { key: '0', label: 'Contents', action: () => go('manual') },
  ]);

  /** Brings a section of the chapter to the top of the screen. */
  function show(topic: number): void {
    prose?.querySelectorAll('h2')[topic]?.scrollIntoView({ block: 'start' });
  }
</script>

{#if !current}
  <h1>Operations manual</h1>
  <p class="sub">Nine chapters. Choose one to read it.</p>

  <div class="columns">
    <div>
      <p class="gap manual-lead">
        Overseer Console runs Fallout, Fallout 2 and the conversion Fallout Et Tu inside your browser, on the open
        source Community Edition engines. It does not include the games: you bring your own copy, the console copies
        its data files into this browser's private storage on this device, and plays from there.
      </p>
      <Menu items={contents} label="Chapters" bind:selected />
    </div>
    <aside class="board gap" aria-label="In this chapter">
      <Glyph name={contents[selected]?.icon ?? 'manual'} />
      {#if shown}
        <p class="dim">In this chapter:</p>
        <ul class="topics">
          {#each shown.topics as topic (topic)}
            <li>{topic}</li>
          {/each}
        </ul>
      {:else}
        <p class="dim">Back to the main directory.</p>
      {/if}
    </aside>
  </div>
{:else}
  <h1>{current.title}</h1>
  <p class="sub">Operations manual, chapter {index + 1} of {CHAPTERS.length}</p>

  <div class="columns">
    <div>
      <div class="prose" bind:this={prose}>
        {#if current.id === 'files'}
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

          <h2>Loading the folder</h2>
          <p>
            On the game's deck choose <span class="hot">Load holodisk</span> and select that folder as a whole. The
            console takes what the engine needs (<span class="hot">MASTER.DAT</span>, <span class="hot">CRITTER.DAT</span>,
            <span class="hot">PATCH000.DAT</span> for Fallout 2, and the <span class="hot">DATA</span> and
            <span class="hot">SOUND</span> folders) and ignores the rest. A game needs roughly 600 MB of free disk space.
          </p>
          <p>
            Your browser will ask whether to "upload" the folder. That is the browser's wording for letting a page read
            files; the files go no further than this device.
          </p>

          <h2>From a zip</h2>
          <p>
            One <span class="hot">zip</span> of that folder does as well, for any of the games: choose it on the game's
            deck, or drop it on the console. It is read where it lies and is not unpacked anywhere.
          </p>

          <h2>On a phone or tablet</h2>
          <p>
            The game files have to be where the device's file picker can reach them: copied onto it, or in a cloud folder.
            Where the browser cannot pick a whole folder, select <span class="hot">MASTER.DAT</span>,
            <span class="hot">CRITTER.DAT</span> and, for Fallout 2, <span class="hot">PATCH000.DAT</span> together; the
            game then plays without its music. To get the whole game onto such a device, music included, select one zip of
            the game folder instead, or load it from your Dropbox (chapter 8).
          </p>

          <h2>Stopping and ejecting</h2>
          <p>
            A copy that is under way can be called off with <span class="hot">Stop loading</span>: what was copied is thrown
            away, and the deck is as it was before. Loading a holodisk again, and ejecting it, are under
            <span class="hot">Holodisk</span> on the deck of a game that is loaded; saved games are kept either way.
          </p>
        {:else if current.id === 'ettu'}
          <h2>What it needs</h2>
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

          <h2>Loading it</h2>
          <p>
            Load decks A and B first, then deck C. Count on about 1 GB of storage for Et Tu, on top of the two games. Its
            saved games are its own, with their own archives.
          </p>
          <p>
            Et Tu on the engine the console runs is young: its makers call it playable, and not yet finished. Take the
            newest package. One made for this engine holds a file called <span class="hot">fallout2-ce.exe</span>; the
            console says so when the package you load does not.
          </p>

          <h2>Its options</h2>
          <p>
            The console loads the mods that <span class="hot">mods\mods_order.txt</span> in the package switches on, and
            takes the settings in its <span class="hot">config</span> folder as they are. To play with a language pack or
            another choice of options, change those files in a copy of the folder and load that. Et Tu starts at
            <span class="hot">HIGH RESOLUTION</span>, the picture it was laid out for; deck C has the others.
          </p>
        {:else if current.id === 'controls'}
          <h2>Mouse and keys</h2>
          <p>The games play as they always did: mouse to move and act, right button to switch between walking and using.</p>
          <dl class="readout gap">
            <dt>F4 / F5</dt>
            <dd>Save game / load game</dd>
            <dt>F6 / F7</dt>
            <dd>Quick save / quick load, always in slot 07 (chapter 6)</dd>
            <dt>ESC</dt>
            <dd>Game options</dd>
            <dt>F8</dt>
            <dd>Fast forward, on and off</dd>
            <dt>F9</dt>
            <dd>Console menu: suspend the game, fullscreen, exit to this console</dd>
            <dt>F11</dt>
            <dd>Fullscreen</dd>
          </dl>

          <h2>Fullscreen</h2>
          <p>
            In fullscreen, Chrome and Edge keep ESC for the game (hold it to leave fullscreen). Firefox and Safari use ESC
            to leave fullscreen, so there the <span class="hot">`</span> key (left of 1) stands in for ESC.
          </p>
        {:else if current.id === 'picture'}
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

          <h2>Fast forward</h2>
          <p>
            <span class="hot">F8</span> runs a game several times as fast until it is pressed again; a sign in the corner
            says so while it does. It is for the long walk across a map and the turns of a dozen rats. Sound keeps its own
            pace, so speech and movies are better watched without it. How fast is chosen in Terminal settings.
          </p>

          <h2>Game improvements</h2>
          <p>
            <span class="hot">Game improvements</span> in Terminal settings switches on what the engine of Fallout 2 adds
            to the game: holding the left <span class="hot">SHIFT</span> key lights up the items, containers and bodies
            lying anywhere in the picture, walls or no walls (on a touch screen, <span class="hot">HILITE</span> switches
            that on and off); the inventory has a second column; companions' own
            inventories can be reached when looting and bartering; doors that are neither locked nor special open as you
            walk into them; the interface shows up to 16 action points; and with the HIGH RESOLUTION picture the barter
            screen has a fourth row. Switched off, Fallout 2 plays as the original did.
          </p>
          <p>
            Fallout Et Tu comes with its makers' own choice of these and keeps it, save for the key:
            <span class="hot">SHIFT</span> lights things up the same way in every game the console runs. The engine of
            Fallout has none of this.
          </p>
        {:else if current.id === 'touch'}
          <h2>Fingers</h2>
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
          </dl>

          <h2>The buttons</h2>
          <dl class="readout gap">
            <dt>CLICK, CURSOR</dt>
            <dd>
              The two mouse buttons. CLICK clicks where the pointer already is, for small targets: drag to aim, then press
              it. CURSOR is the right button
            </dd>
            <dt>KEYS, ESC, MENU</dt>
            <dd>A keyboard (it comes up by itself when a game asks for text), the escape key, and the console menu</dd>
            <dt>The small buttons</dt>
            <dd>
              Keys the games answer to, a tap away. Beside the picture's left edge the game's screens, in the order of its
              own interface bar: INV the inventory, MAP the map of the place, CHA the character screen, PIP the Pip-Boy,
              SKILL the skilldex. On the right, TURN the end of your turn in combat. FAST is fast forward. HILITE, where a game has it,
              highlights what lies on the ground until it is pressed again
            </dd>
            <dt>QSAVE, QLOAD</dt>
            <dd>Quick save and quick load, in slot 07. QLOAD asks for a second tap before it throws away what was played since</dd>
          </dl>

          <h2>The pointer</h2>
          <p>
            Terminal settings has a <span class="hot">Touch pointer</span> choice: the pointer can follow your finger, or the
            picture can work like a laptop trackpad, which is more precise on a small screen. Turn a phone sideways; on an
            iPhone, add the console to the home screen to play without the browser's bars.
          </p>
        {:else if current.id === 'saving'}
          <h2>Saved games</h2>
          <p>
            Saving works as in the original games. Each save is written to this browser's storage the moment the game
            finishes it. Saves live in this browser on this device only: use Save archives on the main directory to export
            them to a zip file as a backup, or to move them to another browser or a desktop install. Linking your Dropbox
            (chapter 8) does the moving for you.
          </p>

          <h2>Quick save</h2>
          <p>
            <span class="hot">F6</span> saves the game in slot 07 at once, without asking for a slot or a description, and
            <span class="hot">F7</span> loads that save again. On a touch screen <span class="hot">QSAVE</span> and
            <span class="hot">QLOAD</span> do the same; QLOAD asks for a second tap, as loading throws away what was played
            since. A quick save is described as QUICKSAVE and the time.
          </p>
          <p>
            Slot 07 belongs to the quick save: a save you make there yourself is replaced by the next one, and kept among
            the slot's earlier versions (chapter 7).
          </p>

          <h2>Autosave</h2>
          <p>
            Every ten minutes of play the console has the game save itself in slot 08, 09 or 10, in turn, described as
            AUTOSAVE and the time. Only time spent playing counts: not the game's menus, nor a suspended game. The save is
            made when you could have made a quick save yourself, so never in combat or in a conversation.
          </p>
          <p>
            Slots 01 to 06 are yours alone, and so is a save you make in 08 to 10 yourself: an autosave never replaces it.
            How often, or not at all, is under Terminal settings.
          </p>

          <h2>Last exported</h2>
          <p>
            The deck of each game, and its archive, say when its saves were <span class="hot">last exported</span> to a zip
            file or uploaded to Dropbox. Until they ever were, the console says so in amber.
          </p>
        {:else if current.id === 'archives'}
          <h2>What they show</h2>
          <p>
            Save archives, on the main directory, shows each save with the picture the game stored with it and a summary of
            the character: level, hit points, statistics, tagged skills, traits and perks. The names come from your own
            game files.
          </p>

          <h2>Continue</h2>
          <p>
            <span class="hot">Continue</span> on the main directory starts the game you saved last and takes you straight
            into that save, skipping the game's menus. Any other save can be started the same way: open its slot in Save
            archives and choose <span class="hot">Load this save</span>.
          </p>

          <h2>Earlier versions</h2>
          <p>
            Saving over a slot does not destroy what was in it. The console keeps earlier versions of every slot (the latest
            three, and a thinning trail of older ones reaching back days) and can put any of them back: open the slot in Save
            archives and choose <span class="hot">Earlier versions</span>. Use it when a save turns out to be a dead end.
          </p>

          <h2>Erased saves</h2>
          <p>
            Erasing a save takes it out of its slot, not out of reach. For a week it is kept, with its earlier versions,
            under <span class="hot">Erased saves</span> in the game's archive, and can be put back in its slot from there.
          </p>

          <h2>Keeping them safe</h2>
          <p>
            Clearing this site's data in your browser deletes the game data and the saves. Safari may also clear data of
            sites you have not opened for a week. Exporting your saves to a zip file, or uploading them to your Dropbox, is
            the safe habit.
          </p>
        {:else if current.id === 'dropbox'}
          <h2>Linking</h2>
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
          </dl>

          <h2>Saves and games</h2>
          <dl class="readout gap">
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
          </dl>
          <p>
            Nothing moves by itself: saves go to Dropbox when you upload them and come back when you fetch them. Erasing a
            save that was uploaded erases its copy in Dropbox too; Dropbox keeps deleted files for a while, should you want
            one back.
          </p>

          <h2>Unlinking</h2>
          <p>
            Dropbox link, Unlink. The link stays in this browser until then, so unlink on a computer that is not yours.
            Removing the app under Connected apps in your Dropbox account ends it as well.
          </p>
        {:else if current.id === 'faults'}
          <h2>Troubleshooting</h2>
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
        {/if}
      </div>

      <Menu items={turns} label="Chapters" bind:selected />
    </div>
    <aside class="board gap wide-only" aria-label="In this chapter">
      <Glyph name={current.icon} />
      <p class="dim">In this chapter:</p>
      <ul class="topics">
        {#each current.topics as topic, number (topic)}
          <li><button type="button" class="link" onclick={() => show(number)}>{topic}</button></li>
        {/each}
      </ul>
    </aside>
  </div>
{/if}
