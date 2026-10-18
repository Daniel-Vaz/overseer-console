<script lang="ts">
  import { onMount } from 'svelte';
  import { LinkError } from '../../lib/cloud/errors';
  import { normaliseFolder, showFolder } from '../../lib/cloud/folders';
  import {
    CLOUD_CONSOLE_URL,
    DEVICE_PAGE,
    dropCode,
    driveApiPage,
    endAccess,
    keptCode,
    looksLikeClientId,
    looksLikeClientSecret,
    projectOf,
    requestCode,
    unlink,
    waitForLink,
    type DeviceCode,
  } from '../../lib/drive/auth';
  import { driveCloud } from '../../lib/drive/cloud';
  import { loadConfig, loadLink, saveConfig } from '../../lib/drive/link';
  import { formatBytes } from '../../lib/storage/manifest';
  import Field from '../components/Field.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { stamp } from '../format';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  const stored = loadConfig();
  let link = $state(loadLink());
  let clientId = $state(stored.clientId);
  let clientSecret = $state(stored.clientSecret);
  let gamesFolder = $state(showFolder(stored.gamesFolder));
  let savesFolder = $state(showFolder(stored.savesFolder));
  /** The code the player is to enter at Google, while there is one. */
  let code = $state<DeviceCode | null>(null);
  /** A code is being asked for. */
  let asking = $state(false);
  let busy = $state(false);
  let view = $state<'main' | 'unlink'>('main');
  let message = $state<{ text: string; bad?: boolean } | null>(null);
  let selected = $state(0);
  /** How much room the Drive has, once Google has said. */
  let room = $state<{ used: number; total: number } | null>(null);
  /** The clock the code's time left is read against. */
  let now = $state(Date.now());
  let idInput: HTMLInputElement | undefined = $state();
  let secretInput: HTMLInputElement | undefined = $state();
  let gamesInput: HTMLInputElement | undefined = $state();
  let savesInput: HTMLInputElement | undefined = $state();

  const id = $derived(clientId.trim());
  const secret = $derived(clientSecret.trim());
  const ready = $derived(looksLikeClientId(id) && looksLikeClientSecret(secret));
  /** Another cloud the console is linked to: one at a time. */
  const other = $derived(sys.cloud.linked && sys.cloud.id !== 'drive' ? sys.cloud : null);
  const minutesLeft = $derived(code ? Math.max(0, Math.round((code.expiresAt - now) / 60_000)) : 0);

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    // Kept as typed: on a phone this page may be reloaded while Google is open in another tab.
    if (looksLikeClientId(id)) saveConfig({ clientId: id });
    if (looksLikeClientSecret(secret)) saveConfig({ clientSecret: secret });
  });

  $effect(() => {
    // A code asked for before the page was loaded again is still the one to enter.
    if (!link && !other && looksLikeClientId(id) && !code) code = keptCode(id);
  });

  $effect(() => {
    // While a code is out, Google is asked every few seconds whether it has been entered.
    const waiting = code;
    if (!waiting || link || !ready || waiting.clientId !== id) return;
    const stopper = new AbortController();
    waitForLink(waiting, secret, stopper.signal).then(
      (made) => {
        link = made;
        code = null;
        selected = 0;
        message = { text: `Linked to the Google Drive of ${made.account.name}.` };
        sfx.done();
        sys.refreshCloud();
      },
      (err: unknown) => {
        if (stopper.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        message = { text: err instanceof Error ? err.message : String(err), bad: true };
        // A wrong secret leaves the code good: it counts once the secret is put right.
        if (!(err instanceof LinkError && err.cause === 'invalid_client')) code = null;
        sfx.deny();
      },
    );
    return () => stopper.abort();
  });

  $effect(() => {
    if (!link) return;
    void driveCloud.space().then(
      (space) => (room = space),
      () => undefined,
    );
  });

  async function getCode(): Promise<void> {
    if (asking) return;
    if (!ready) {
      message = { text: 'Enter the Client ID and the Client secret of your client first.', bad: true };
      sfx.deny();
      return;
    }
    asking = true;
    message = null;
    // A new code stands in for the last one.
    dropCode();
    code = null;
    try {
      code = await requestCode(id);
      now = Date.now();
    } catch (err) {
      message = { text: err instanceof Error ? err.message : String(err), bad: true };
      sfx.deny();
    }
    asking = false;
  }

  function openGoogle(): void {
    if (!code) return;
    message = null;
    // On the key press itself: the browser lets a page open a tab, and fill the clipboard, only then.
    void navigator.clipboard?.writeText(code.userCode).catch(() => undefined);
    window.open(code.verificationUrl || DEVICE_PAGE, '_blank', 'noopener');
  }

  function unlinkNow(): void {
    unlink();
    link = null;
    room = null;
    view = 'main';
    selected = 0;
    sys.refreshCloud();
    message = { text: 'Unlinked in this browser. Other browsers you linked stay linked, and everything in your Google Drive stays where it is.' };
    sfx.done();
  }

  async function endAccessNow(): Promise<void> {
    if (busy) return;
    busy = true;
    const { revoked } = await endAccess();
    link = null;
    room = null;
    view = 'main';
    selected = 0;
    busy = false;
    sys.refreshCloud();
    message = revoked
      ? { text: "Google has ended the console's access to your Drive, in every browser. Your files stay where they are." }
      : {
          text: "Unlinked in this browser, but Google could not be reached to end the access. To be sure, remove the console's project under Third-party apps and services in your Google Account (myaccount.google.com/connections).",
          bad: true,
        };
    if (revoked) sfx.done();
    else sfx.deny();
  }

  function storeFolder(which: 'gamesFolder' | 'savesFolder'): void {
    try {
      const folder = normaliseFolder(which === 'gamesFolder' ? gamesFolder : savesFolder);
      saveConfig({ [which]: folder });
      // Show it as it was understood.
      if (which === 'gamesFolder') gamesFolder = showFolder(folder);
      else savesFolder = showFolder(folder);
      message = null;
    } catch (err) {
      message = { text: err instanceof Error ? err.message : String(err), bad: true };
      sfx.deny();
    }
  }

  const unlinkedItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: 'Client ID',
      state: looksLikeClientId(id) ? 'ENTERED' : id ? 'NOT A CLIENT ID' : 'NOT ENTERED',
      tone: looksLikeClientId(id) ? undefined : 'amber',
      icon: 'key',
      note: 'The Client ID of the client you made for the console (see the steps above). It ends in .apps.googleusercontent.com, and it names the client: it is not a password.',
      action: () => idInput?.focus(),
    },
    {
      key: '2',
      label: 'Client secret',
      state: looksLikeClientSecret(secret) ? 'ENTERED' : secret ? 'NOT A SECRET' : 'NOT ENTERED',
      tone: looksLikeClientSecret(secret) ? undefined : 'amber',
      icon: 'key',
      note: "Shown beside the Client ID when the client is made, and only then: if it is gone, add a new secret on the client's page. Google wants it with every link, but for a client of this kind cannot count on it staying secret.",
      action: () => secretInput?.focus(),
    },
    {
      key: '3',
      label: asking ? 'Asking Google...' : code ? 'Get a new code' : 'Get a code',
      state: code ? code.userCode : undefined,
      icon: 'keypad',
      disabled: asking || !ready,
      note: ready
        ? 'Google hands out a short code to enter at google.com/device. It works for half an hour.'
        : 'Enter the Client ID and the Client secret first.',
      action: () => void getCode(),
    },
    {
      key: '4',
      label: 'Open Google to allow the link',
      state: 'OPENS A NEW TAB',
      icon: 'external',
      disabled: !code,
      note: code
        ? `Copies the code ${code.userCode} and opens google.com/device. Enter the code there, choose your account and allow the console: this screen notices by itself.`
        : 'Get a code first.',
      action: openGoogle,
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings/cloud') },
  ]);

  const linkedItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: 'Games folder',
      state: gamesFolder,
      icon: 'gamedata',
      note: 'Where the console looks for games, inside its Overseer Console folder in your Drive. Everything below it is searched; / is that folder itself.',
      action: () => gamesInput?.focus(),
    },
    {
      key: '2',
      label: 'Saves folder',
      state: savesFolder,
      icon: 'save',
      note: 'Where uploaded saves are kept, inside the Overseer Console folder: one zip per slot, in a folder per game.',
      action: () => savesInput?.focus(),
    },
    {
      key: 'p',
      label: 'Put in Google Drive',
      icon: 'export-save',
      note: 'A game or a mod from this device into your Drive, packed into one zip on the way. Google lets the console see only what it put there itself: this is the way in.',
      action: () => go('settings/cloud/put'),
    },
    {
      key: 'u',
      label: 'Unlink',
      tone: 'amber',
      icon: 'unlink',
      note: 'Forgets the link in this browser, or has Google end it everywhere. Your files stay where they are.',
      action: () => (view = 'unlink'),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings') },
  ]);

  // ENTER lands on leaving things as they are, as wherever the console asks before it acts.
  const unlinkItems = $derived<MenuItem[]>([
    { key: 'n', label: 'No, keep the link', action: () => (view = 'main') },
    {
      key: 'y',
      label: 'Yes, unlink this browser',
      tone: 'amber',
      note: 'This browser forgets the link. Other browsers you linked stay linked.',
      action: unlinkNow,
    },
    {
      key: 'e',
      label: busy ? 'Ending access...' : 'End access in every browser',
      danger: true,
      disabled: busy,
      note: "Google ends the console's access to your Drive, in every browser. By Google's rules that also takes the files the console put there out of its sight, maybe for good, even once you link again. The files themselves stay in your Drive.",
      action: () => void endAccessNow(),
    },
  ]);

  const otherItems = $derived<MenuItem[]>([
    { key: '1', label: `Open the ${other?.name ?? ''} link`, icon: 'uplink', action: () => go('settings/cloud') },
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings') },
  ]);

  const pointed = $derived((other ? otherItems : link ? (view === 'unlink' ? unlinkItems : linkedItems) : unlinkedItems)[selected]);
</script>

<h1>Google Drive link</h1>
<p class="sub">Optional. Your saves in your own Google Drive, and your games loaded from it.</p>

{#if message}
  <div class="panel signed" class:bad={message.bad} role="status">
    <Glyph name={message.bad ? 'fault' : 'ok'} tone={message.bad ? 'alert' : undefined} />
    <p class:alert={message.bad}>{message.text}</p>
  </div>
{/if}

<div class="columns">
  <div>
    {#if other}
      <div class="signed ask gap">
        <Glyph name="warning" tone="amber" />
        <div>
          <p class="amber">THE CONSOLE IS LINKED TO THE {other.name.toUpperCase()} OF {other.account.toUpperCase()}.</p>
          <p>
            It works with one cloud at a time. To switch to Google Drive, fetch the saves you want from {other.name} first,
            then unlink it under Cloud link.
          </p>
        </div>
      </div>
      <Menu items={otherItems} label="Linked to another cloud" bind:selected />
    {:else if link && view === 'unlink'}
      <div class="signed ask gap">
        <Glyph name="warning" tone="amber" />
        <div>
          <p class="amber">UNLINK FROM THE GOOGLE DRIVE OF {link.account.name.toUpperCase()}?</p>
          <p>
            This browser forgets the link. Everything in your Google Drive stays where it is, and so does everything in this
            browser. Or Google ends the console's access in every browser at once.
          </p>
        </div>
      </div>
      <Menu items={unlinkItems} label="Confirm unlink" />
    {:else if link}
      <dl class="readout gap">
        <dt>Google Drive</dt>
        <dd>{link.account.name}{link.account.email && link.account.email !== link.account.name ? ` (${link.account.email})` : ''}</dd>
        <dt>Linked</dt>
        <dd>{stamp(link.linkedAt)}</dd>
        <dt>Project</dt>
        <dd>{projectOf(link.clientId) || link.clientId}</dd>
        {#if room}
          <dt>Room</dt>
          <dd>{formatBytes(Math.max(0, room.total - room.used))} FREE OF {formatBytes(room.total)}</dd>
        {/if}
      </dl>
      <div class="gap">
        <Field label="Games folder" bind:value={gamesFolder} bind:input={gamesInput} onchange={() => storeFolder('gamesFolder')} />
        <Field label="Saves folder" bind:value={savesFolder} bind:input={savesInput} onchange={() => storeFolder('savesFolder')} />
      </div>
      <Menu items={linkedItems} label="Google Drive link" bind:selected />
      <div class="prose">
        <h2>Using it</h2>
        <p>
          Nothing moves by itself. In <span class="hot">Save archives</span>, a game's list has
          <span class="hot">Upload to Google Drive</span> and <span class="hot">Fetch from Google Drive</span>: either way a
          save only replaces an older one.
        </p>
        <p>
          The console works in the folder <span class="hot">Overseer Console</span> of your Drive, and Google lets it see
          only what it put there itself: a file put there with Google's own app or website stays out of its sight. Put
          games and mods in with <span class="hot">Put in Google Drive</span>. Then open the game's deck on any device and
          choose <span class="hot">Load holodisk from Google Drive</span>.
        </p>
      </div>
    {:else}
      <!-- What to do comes before what to fill in: the fields mean nothing to someone who has not made the client yet. -->
      <div class="prose">
        <p>
          The console has no accounts and no server. To link, you make a small project in your own Google Cloud, with a
          client for the console. Google then lets the console use the files it makes in your Drive, and nothing else there.
        </p>
        <dl class="readout gap">
          <dt>Step 1</dt>
          <dd>
            At <a href={CLOUD_CONSOLE_URL} target="_blank" rel="noopener">console.cloud.google.com</a>, signed in to the Google
            account whose Drive is to be used, create a project. Any name; no billing is needed.
          </dd>
          <dt>Step 2</dt>
          <dd>
            In that project, <a href={driveApiPage(id)} target="_blank" rel="noopener">enable the Google Drive API</a> (APIs and
            Services, Library).
          </dd>
          <dt>Step 3</dt>
          <dd>Under <span class="hot">Google Auth Platform</span>, choose Get started: any app name, your email, Audience <span class="hot">External</span>.</dd>
          <dt>Step 4</dt>
          <dd>Under Audience, choose <span class="hot">Publish app</span>. An app left in Testing has its links ended by Google after a week.</dd>
          <dt>Step 5</dt>
          <dd>
            Under Clients, create a client of the type <span class="hot">TVs and Limited Input devices</span>. Copy its Client
            ID and Client secret into the fields below: Google shows the secret only once.
          </dd>
          <dt>Step 6</dt>
          <dd>Get a code here, open Google from here, enter the code there and allow the console. Once in every browser you play in.</dd>
        </dl>
      </div>
      <div class="gap">
        <Field label="Client ID" bind:value={clientId} bind:input={idInput} placeholder="FROM YOUR GOOGLE CLOUD CLIENT" />
        <Field label="Client secret" bind:value={clientSecret} bind:input={secretInput} placeholder="SHOWN WITH THE CLIENT ID" onenter={() => void getCode()} />
      </div>
      {#if code}
        <div class="panel signed gap" role="status">
          <Glyph name="keypad" />
          <div>
            <p class="amber">YOUR CODE: <span class="usercode">{code.userCode}</span></p>
            <p>
              Enter it at <span class="hot">google.com/device</span>, on this device or any other, within {minutesLeft}
              {minutesLeft === 1 ? 'minute' : 'minutes'}, and allow the console.
            </p>
            <p class="dim">WAITING FOR GOOGLE<span class="cursor"></span></p>
          </div>
        </div>
      {/if}
      <Menu items={unlinkedItems} label="Link to Google Drive" bind:selected />
    {/if}
  </div>

  <aside class="board gap" aria-label="Google Drive link">
    <Glyph name={pointed?.icon ?? 'uplink'} tone={pointed?.tone} />
    <dl class="readout">
      <dt>Link</dt>
      <dd class:amber={!link}>{link ? 'LINKED' : code ? 'WAITING' : 'NOT LINKED'}</dd>
      <dt>Reaches</dt>
      <dd>FILES IT MADE</dd>
      <dt>Moves files</dt>
      <dd>WHEN ASKED</dd>
    </dl>
  </aside>
</div>
