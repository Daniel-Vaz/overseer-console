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
      id: 'mods',
      title: 'Mods',
      icon: 'mod',
      summary: 'Fallout Et Tu, the Restoration Project, Sonora and others: loading a mod, and playing it on its game.',
      topics: ['What a mod is', 'Loading one', 'Installing one it knows', 'Playing it', 'Add-ons', 'How well they play'],
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
      icon: 'autosave',
      summary: 'How saves are kept, quick saves in slot 07, autosaves, and when they last left the browser.',
      topics: ['Saved games', 'Quick save', 'Autosave', 'Last exported'],
    },
    {
      id: 'archives',
      title: 'Save archives',
      icon: 'backup',
      summary: 'Continue, earlier versions of a slot, changing a saved character, erased saves, and keeping them safe.',
      topics: ['What they show', 'Continue', 'Earlier versions', 'Modifying a save', 'Erased saves', 'Keeping them safe'],
    },
    {
      id: 'cloud',
      title: 'Your cloud',
      icon: 'cloud',
      summary: 'Optional. Saves carried between devices, and games and mods loaded from your own Dropbox or Google Drive.',
      topics: ['Linking Dropbox', 'Linking Google Drive', 'Saves, games and mods', 'Unlinking'],
    },
    {
      id: 'faults',
      title: 'If something fails',
      icon: 'report',
      summary: 'No sound, a holodisk rejected, a system fault: what each means and what to do, and how to report it.',
      topics: ['Troubleshooting', 'Reporting a problem'],
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
    ...(current?.id === 'faults' ? [{ key: 'r', label: 'Write a problem report', action: () => go('report') } satisfies MenuItem] : []),
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
        Overseer Console runs Fallout and Fallout 2, and mods of them such as Fallout Et Tu, inside your browser, on
        the open source Community Edition engines. It does not include the games: you bring your own copy, the console
        copies its data files into this browser's private storage on this device, and plays from there.
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
            the game folder instead, or load it from your Dropbox or Google Drive (chapter 8).
          </p>

          <h2>Stopping and ejecting</h2>
          <p>
            A copy that is under way can be called off with <span class="hot">Stop loading</span>: what was copied is thrown
            away, and the deck is as it was before. Loading a holodisk again, and ejecting it, are under
            <span class="hot">Holodisk</span> on the deck of a game that is loaded; saved games are kept either way.
          </p>
        {:else if current.id === 'mods'}
          <h2>What a mod is</h2>
          <p>
            A mod is played on the game it was made for: its own files over the game's, on that game's engine, with
            saves of its own. The game itself stays as it was sold, in its deck. Mods are kept in the
            <span class="hot">Mod library</span> on the main directory; the ones the console knows by name are listed
            there, with where to get each and what of it to hand over.
          </p>
          <dl class="readout gap">
            <dt>Fallout 2</dt>
            <dd>Fallout Et Tu, the Restoration Project, the Megamod, Sonora, Nevada, Olympus 2207, Resurrection, Fallout Yesterday, and others like them</dd>
            <dt>Fallout</dt>
            <dd>Fallout Fixt, and others like it</dd>
          </dl>

          <h2>Loading one</h2>
          <p>
            Load the game it is played on into its deck first. Then, in the Mod library, choose
            <span class="hot">Load a mod</span> and hand the console the mod as it is downloaded (a zip, or its folder),
            or a game folder it was installed in on a desktop. Of that, the console keeps only what differs from the game
            in the deck: the rest is not stored twice. Installers and the programs they bring are left out; the console
            does what an installer does.
          </p>
          <p>
            Fallout Et Tu is built from Fallout as well: while it is loaded, several thousand of Fallout's files (speech,
            movies, map tiles) are copied out of its <span class="hot">MASTER.DAT</span>, so Fallout must be in deck A
            then. With your Dropbox or Google Drive linked, a mod can be loaded from the <span class="hot">Mods</span>
            folder inside your games folder there (chapter 8).
          </p>

          <h2>Installing one it knows</h2>
          <p>
            <span class="hot">Install a known mod</span>, in the Mod library, installs each mod the console knows from its
            makers' own link, at the version its tests play. Their sites do not let other sites read what they serve, so
            the console cannot download them itself. A zip from a link that needs no sign-in (Et Tu, the Restoration
            Project, Sonora, Olympus 2207, Resurrection) Dropbox downloads into its Mods folder when it is linked, and the
            console loads it from there. Otherwise your browser downloads it (the Megamod from Nexus Mods, signed in), you
            select it, and the console checks that it is that release before loading it. Fallout Yesterday (a 7z), Nevada
            and Fixt (installers for a desktop) it takes step by step: where to get each, what to do with it on a
            computer, then the folder. A mod loaded at an older version is offered the newer one on its page.
          </p>

          <h2>Playing it</h2>
          <p>
            A mod's own page starts it, and holds its save archives and its picture. Put it in its game's deck with
            <span class="hot">In deck B</span> (or A), and the deck plays it from then on: its Begin and Continue start
            the mod. The deck's own <span class="hot">Mod</span> entry switches between the mods loaded for it and none:
            the game as it was sold. Each mod starts at the picture its makers meant; Fallout Et Tu at high resolution.
          </p>

          <h2>Add-ons</h2>
          <p>
            An add-on is a small mod with no game of its own: archives for Fallout 2's mods folder (FO2tweaks, Party
            Orders), loose data, or music. It is loaded once and laid over the game it was made for, or over any of its
            mods, while it is switched on for it, with no saves of its own. <span class="hot">Add-ons</span>, on a deck
            or a mod's page, switches them on and off and loads new ones for that game or mod;
            <span class="hot">Load an add-on</span>, in the Mod library, loads one for either game, and its page lays it
            over the game and its mods. Several can be laid over one game, each over those switched on before it, and a
            change takes hold the next time it starts.
          </p>

          <h2>How well they play</h2>
          <p>
            The engines the console runs have the scripting additions of sfall built in, which most mods need, so there
            is nothing to switch on. What a mod changes in a game's program itself cannot come along, and a few mods
            reach further into the original engine than its Community Edition follows. The Mod library says how each
            mod the console knows plays: tested here, supported by the engine's makers, or experimental. A mod it does
            not know loads all the same, and is marked not tested.
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
            <dt>SPACE / ENTER</dt>
            <dd>In a fight, on your turn: end your turn / end the fight, once nobody is left to fight</dd>
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
            Every game and every mod is played at a picture of its own, chosen on its deck or its page (all of them side
            by side under Terminal settings, <span class="hot">Picture</span>). Fallout and Fallout 2 start at the
            original picture, a mod at the one its makers meant: Fallout Et Tu at high resolution, Fallout Yesterday wide. Olympus 2207 needs a
            picture at least 600 lines tall, and is played at high resolution only. A change takes hold the next time the
            game is started.
          </p>
          <p>
            While a game runs, <span class="hot">Picture</span> on its menu (F9, or MENU on a touch screen) changes it at
            once, or fits the one in use to a window that changed shape, such as a phone turned sideways. The engines draw
            at one size from start to end, so the game is saved in slot 08, 09 or 10 at the first moment it can be, and
            carries on from that save in the new picture a few seconds later.
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
            screen has a fourth row. Switched off, Fallout 2 plays as the original did. Its mods follow the same switch.
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
            <dt>Swipe a list</dt>
            <dd>
              Up or down an inventory, a container's contents or a trader's goods: the list follows the finger. Flicked, it
              keeps going for a moment, and a touch stops it
            </dd>
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
              SKILL the skilldex. On the right, TURN ends your turn in a fight, as SPACE does: it is lit while it is your
              turn, and dim the rest of the time, when it does nothing. MODE switches the weapon in hand to its next mode
              (aimed, burst, reload), as N does and as a right click on the weapon's own button does. FAST is fast forward.
              HILITE, where a game has it, highlights what lies on the ground until it is pressed again
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
            them to a zip file as a backup, or to move them to another browser or a desktop install. Linking your Dropbox or
            Google Drive (chapter 8) does the moving for you.
          </p>
          <p>
            Each save also notes the add-ons that were switched on when it was made (chapter 2). Before a save is played
            with one of them off, the console says so and offers to switch it back on: what an add-on put into a game can
            be missing without it, or break. A save loaded from the game's own menu is checked the same way, and the
            console's menu then offers to start again from it with the add-on on.
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
            On arriving on another map, and every ten minutes of play, the console has the game save itself in slot 08, 09
            or 10, in turn, described as AUTOSAVE and the time. Arriving is going somewhere: through an exit, from the world
            map, into an encounter; starting or loading a game is not. Only time spent playing counts: not the game's menus,
            nor a suspended game. The save is made when you could have made a quick save yourself, so never in combat or in
            a conversation: on a map that greets you with a fight, once it is over.
          </p>
          <p>
            Slots 01 to 06 are yours alone, and so is every slot from 11 on: both games have a hundred pages of ten, turned
            with the arrow keys left and right (ten pages with SHIFT) or BACK and MORE under the list. A save you make in 08
            to 10 yourself is yours as well: an autosave never replaces it. When, or not at all, is under Terminal settings:
            on new maps alone, on new maps and every 5, 10, 15 or 30 minutes, or off.
          </p>

          <h2>Last exported</h2>
          <p>
            The deck of each game, and its archive, say when its saves were <span class="hot">last exported</span> to a zip
            file or uploaded to your Dropbox or Google Drive. Until they ever were, the console says so in amber.
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

          <h2>Modifying a save</h2>
          <p>
            Open a slot and choose <span class="hot">Modify this save</span> to change what is in it: the character (name,
            gender, age, level and experience, S.P.E.C.I.A.L., skills and tags, traits, perks, hit points, what they carry),
            its karma, reputations, standing in each town, addictions and kills, the companions who travel with it (their
            hit points and what they carry), and what the Pip-Boy keeps: the date, the quests, the holodisks, the places on
            the world map, Vault 13's water and the car's fuel where the game counts them. The editor reads the game's own
            rules, words, pictures and items out of your game files, so the game's holodisk must be loaded (for a mod,
            that of the game it is played on as well).
          </p>
          <p>
            Move between its sections with <kbd>TAB</kbd> or <kbd>1</kbd> to <kbd>9</kbd> and <kbd>0</kbd>, change a value
            with <kbd>&larr;</kbd> and <kbd>&rarr;</kbd>, and press <kbd>ENTER</kbd> to type it. What follows from a change
            is worked out as the game would: more Strength carries more, a perk adds what it adds, a level brings its hit
            points, a cured addiction takes back the withdrawal it brought. The skill points and perks new levels bring are
            handed out by the game's own character screen, the next time it opens; the editor says how many. What is in hand
            or worn is left as it is. <kbd>P</kbd> under Skills or Perks plays by the rules: skill points bought with the
            unspent ones at the game's price, perks taken only when one is owed.
          </p>
          <p>
            Under Pip-Boy, <kbd>C</kbd> crosses a quest out and <kbd>R</kbd> puts it back as a new game has it: that is the
            Pip-Boy's record only, and what the quest brings is for the game's scripts to give. <kbd>V</kbd> lists every
            one of the game's global variables, to search by name or number. Record has quick actions: every statistic at
            10, every skill at its most, the highest level, every perk the game offers, the game's best things.
          </p>
          <p>
            Nothing is written until you choose <span class="hot">Write</span>, which lists every change, each to be undone
            on its own. The save as it was is kept under Earlier versions. A save the editor cannot account for to the
            last byte it does not change at all.
          </p>

          <h2>Erased saves</h2>
          <p>
            Erasing a save takes it out of its slot, not out of reach. For a week it is kept, with its earlier versions,
            under <span class="hot">Erased saves</span> in the game's archive, and can be put back in its slot from there.
          </p>

          <h2>Keeping them safe</h2>
          <p>
            Clearing this site's data in your browser deletes the game data and the saves. Safari may also clear data of
            sites you have not opened for a week. Exporting your saves to a zip file, or uploading them to your Dropbox or
            Google Drive, is the safe habit.
          </p>
          <p>
            Saves restored from a zip are looked over first. One the game could not load is turned away: no readable
            SAVE.DAT, a save of the other game, or a map file missing that it names. What may keep the rest from playing
            as they were made is said before they are put in place: saved in another game or mod, on a map this one does
            not have, or with add-ons that are off here.
          </p>
        {:else if current.id === 'cloud'}
          <p>
            Optional. The console can keep saves in your own Dropbox or Google Drive, to carry them between devices, and
            load games and mods from there. It has no accounts and no server of its own: you make a small app (Dropbox) or
            project (Google) in your own account, and the console works in a folder of its own there and nowhere else. One
            cloud at a time, under Terminal settings, <span class="hot">Cloud link</span>.
          </p>
          <dl class="readout gap">
            <dt>Room</dt>
            <dd>
              A game is roughly 550 MB, a mod up to 3 GB. A free Dropbox holds 2 GB: the two games and a mod. A free
              Google account holds up to 15 GB, shared with Gmail and Google Photos: room for the games and every mod the
              console knows.
            </dd>
          </dl>

          <h2>Linking Dropbox</h2>
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
              Cloud link, Dropbox. Enter the App key from the app's Settings tab, open Dropbox from there, allow the app, and
              paste the code it shows. Once in every browser you play in.
            </dd>
          </dl>

          <h2>Linking Google Drive</h2>
          <dl class="readout gap">
            <dt>Make the client</dt>
            <dd>
              At <span class="hot">console.cloud.google.com</span> create a project and enable the Google Drive API in it.
              Under Google Auth Platform choose Get started, with Audience External, then Publish app under Audience. Under
              Clients create one of the type <span class="hot">TVs and Limited Input devices</span>, and copy its Client ID
              and secret: the secret is shown once.
            </dd>
            <dt>Link</dt>
            <dd>
              Cloud link, Google Drive. Enter the two and get a code. Open Google from there, enter the code and allow the
              console: the screen notices by itself. Once in every browser you play in.
            </dd>
          </dl>

          <h2>Saves, games and mods</h2>
          <dl class="readout gap">
            <dt>Saves</dt>
            <dd>
              Save archives, then a game. <span class="hot">Upload</span> sends the saves that are newer here;
              <span class="hot">Fetch</span> brings in the ones that are newer there. A save only ever replaces an older
              one, and what a fetch replaces is kept as an earlier version.
            </dd>
            <dt>Games</dt>
            <dd>
              Cloud link, <span class="hot">Put in</span>, then the game's folder or a zip of it: the console packs it into
              one zip and puts it in your cloud. On any device the game's deck then loads it with
              <span class="hot">Load holodisk from</span> your cloud. In Dropbox, a game folder put in the app folder with
              Dropbox's own app or website does as well.
            </dd>
            <dt>Mods</dt>
            <dd>The same way, into the <span class="hot">Mods</span> folder: Load a mod, in the Mod library, lists them.</dd>
            <dt>In Google Drive</dt>
            <dd>
              Google lets the console see only what it put in your Drive itself. A file put in its folder with Google's own
              app or website stays out of its sight.
            </dd>
          </dl>
          <p>
            Nothing moves by itself. Erasing a save that was uploaded erases its copy in the cloud too, unless another
            device has put a newer one there; both clouds keep deleted files for a while, should you want one back.
          </p>

          <h2>Unlinking</h2>
          <p>
            Cloud link, Unlink. The link stays in this browser until then, so unlink on a computer that is not yours.
            Unlinking Dropbox cancels the link at Dropbox; removing the app under Connected apps in your Dropbox account
            ends it as well. Unlinking Google Drive forgets it in this browser, and other browsers stay linked;
            <span class="hot">End access in every browser</span> ends them all, as does removing the project under
            Third-party apps and services in your Google Account.
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
            <dt>Mod rejected</dt>
            <dd>
              A mod needs its game in its deck, and Fallout Et Tu needs Fallout in deck A while it is loaded as well. A
              Windows installer cannot be loaded: hand over what it installed, or the mod's zip. The message says which.
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
            <dt>Google Drive link refused</dt>
            <dd>
              The message names what is wrong. Usually the client is of another type (it must be TVs and Limited Input
              devices), the Google Drive API is not enabled in the project, or the code ran out after half an hour: get a
              new one.
            </dd>
            <dt>Not in your Google Drive</dt>
            <dd>
              The console sees only what it put there itself. Put the game or mod in with Cloud link, Put in Google Drive.
            </dd>
          </dl>

          <h2>Reporting a problem</h2>
          <p>
            A <span class="hot">problem report</span> holds what the console knows that helps find a fault: its build, the
            game or mod and its engine, add-ons, settings, the browser, and the engine's last words. While a game runs it
            is on the game's menu (F9, or MENU), and on the System fault screen; here, under
            <span class="hot">Write a problem report</span>. Nothing is sent by itself: open it as a new issue on GitHub
            to read it over, say what happened and post it there, or copy it or save it as a file. It names no accounts,
            saves or files of yours.
          </p>
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
