<script lang="ts">
  import { onMount } from 'svelte';
  import { APP_CONSOLE_URL, FILE_SCOPES, linkWithCode, looksLikeAppKey, prepareAuthorization, unlink, type Authorization } from '../../lib/dropbox/auth';
  import { loadConfig, loadLink, normaliseFolder, saveConfig, showFolder } from '../../lib/dropbox/link';
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
  let appKey = $state(stored.appKey);
  let code = $state('');
  let gamesFolder = $state(showFolder(stored.gamesFolder));
  let savesFolder = $state(showFolder(stored.savesFolder));
  /** The approval being asked for. Prepared ahead, so that opening Dropbox is one step taken on the key press itself. */
  let authorization = $state<Authorization | null>(null);
  let busy = $state(false);
  let view = $state<'main' | 'unlink'>('main');
  let message = $state<{ text: string; bad?: boolean } | null>(null);
  let selected = $state(0);
  let keyInput: HTMLInputElement | undefined = $state();
  let codeInput: HTMLInputElement | undefined = $state();
  let gamesInput: HTMLInputElement | undefined = $state();
  let savesInput: HTMLInputElement | undefined = $state();

  // Phones like to capitalise what is typed; app keys are lower case.
  const key = $derived(appKey.trim().toLowerCase());

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ];
  });

  $effect(() => {
    const wanted = key;
    authorization = null;
    if (link || !looksLikeAppKey(wanted)) return;
    // Kept as typed: on a phone this page may be reloaded while Dropbox is open.
    saveConfig({ appKey: wanted });
    let stale = false;
    void prepareAuthorization(wanted).then((prepared) => {
      if (!stale) authorization = prepared;
    });
    return () => {
      stale = true;
    };
  });

  function openDropbox(): void {
    if (!authorization) return;
    message = null;
    window.open(authorization.url, '_blank', 'noopener');
  }

  async function linkNow(): Promise<void> {
    if (busy) return;
    if (!authorization || !code.trim()) {
      message = { text: authorization ? 'Paste the code Dropbox shows once you have allowed the app.' : 'Enter the app key first.', bad: true };
      sfx.deny();
      return;
    }
    busy = true;
    message = null;
    try {
      link = await linkWithCode(authorization, code);
      code = '';
      selected = 0;
      message = { text: `Linked to the Dropbox of ${link.account.name}.` };
      sfx.done();
    } catch (err) {
      message = { text: err instanceof Error ? err.message : String(err), bad: true };
      sfx.deny();
    }
    busy = false;
    sys.refreshDropbox();
  }

  async function unlinkNow(): Promise<void> {
    if (busy) return;
    busy = true;
    const { revoked } = await unlink();
    link = null;
    view = 'main';
    selected = 0;
    busy = false;
    sys.refreshDropbox();
    message = revoked
      ? { text: 'Unlinked. Dropbox has cancelled the access the console had.' }
      : {
          text: 'Unlinked in this browser, but Dropbox could not be reached to cancel the access. To be sure, remove the app under Connected apps in your Dropbox account settings.',
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
      label: 'App key',
      state: looksLikeAppKey(key) ? 'ENTERED' : key ? 'NOT AN APP KEY' : 'NOT ENTERED',
      tone: looksLikeAppKey(key) ? undefined : 'amber',
      icon: 'key',
      note: 'The key of the Dropbox app you made for this console (see below). It is an address, not a password.',
      action: () => keyInput?.focus(),
    },
    {
      key: '2',
      label: 'Open Dropbox to allow the link',
      state: 'OPENS A NEW TAB',
      icon: 'external',
      disabled: !authorization,
      note: authorization
        ? 'Dropbox asks whether the app may use its folder, then shows a code. Copy the code and come back here.'
        : 'Enter the app key first.',
      action: openDropbox,
    },
    {
      key: '3',
      label: 'Access code',
      state: code.trim() ? 'ENTERED' : 'NOT ENTERED',
      icon: 'keypad',
      note: 'Paste the code Dropbox showed. It works once and for a few minutes.',
      action: () => codeInput?.focus(),
    },
    {
      key: '4',
      label: busy ? 'Linking...' : 'Link',
      icon: 'link',
      disabled: busy || !authorization || !code.trim(),
      note: 'Trades the code for the link. The link is kept in this browser until you unlink.',
      action: () => void linkNow(),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings') },
  ]);

  const linkedItems = $derived<MenuItem[]>([
    {
      key: '1',
      label: 'Games folder',
      state: gamesFolder,
      icon: 'gamedata',
      note: 'Where the console looks for your game folders, inside the app folder. Everything below it is searched; / is the app folder itself.',
      action: () => gamesInput?.focus(),
    },
    {
      key: '2',
      label: 'Saves folder',
      state: savesFolder,
      icon: 'save',
      note: 'Where uploaded saves are kept, inside the app folder: one zip per slot, in a folder per game.',
      action: () => savesInput?.focus(),
    },
    {
      key: 'u',
      label: 'Unlink',
      tone: 'amber',
      icon: 'unlink',
      note: 'Forgets the link in this browser and has Dropbox cancel it. Your files stay where they are.',
      action: () => (view = 'unlink'),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings') },
  ]);

  const unlinkItems = $derived<MenuItem[]>([
    { key: 'y', label: busy ? 'Unlinking...' : 'Yes, unlink', tone: 'amber', disabled: busy, action: () => void unlinkNow() },
    { key: 'n', label: 'No, keep the link', action: () => (view = 'main') },
  ]);

  const pointed = $derived((link ? linkedItems : unlinkedItems)[selected]);
</script>

<h1>Dropbox link</h1>
<p class="sub">Optional. Your saves in your own Dropbox, and your games loaded from it.</p>

{#if message}
  <div class="panel signed" class:bad={message.bad} role="status">
    <Glyph name={message.bad ? 'fault' : 'ok'} tone={message.bad ? 'alert' : undefined} />
    <p class:alert={message.bad}>{message.text}</p>
  </div>
{/if}

<div class="columns">
  <div>
    {#if link && view === 'unlink'}
      <div class="signed ask gap">
        <Glyph name="warning" tone="amber" />
        <div>
          <p class="amber">UNLINK FROM THE DROPBOX OF {link.account.name.toUpperCase()}?</p>
          <p>
            The console forgets the link and asks Dropbox to cancel it. Everything in your Dropbox stays where it is,
            and so does everything in this browser.
          </p>
        </div>
      </div>
      <Menu items={unlinkItems} label="Confirm unlink" />
    {:else if link}
      <dl class="readout gap">
        <dt>Dropbox</dt>
        <dd>{link.account.name}{link.account.email ? ` (${link.account.email})` : ''}</dd>
        <dt>Linked</dt>
        <dd>{stamp(link.linkedAt)}</dd>
        <dt>App key</dt>
        <dd>{link.appKey}</dd>
      </dl>
      <div class="gap">
        <Field label="Games folder" bind:value={gamesFolder} bind:input={gamesInput} onchange={() => storeFolder('gamesFolder')} />
        <Field label="Saves folder" bind:value={savesFolder} bind:input={savesInput} onchange={() => storeFolder('savesFolder')} />
      </div>
      <Menu items={linkedItems} label="Dropbox link" bind:selected />
      <div class="prose">
        <h2>Using it</h2>
        <p>
          Nothing moves by itself. In <span class="hot">Save archives</span>, a game's list has
          <span class="hot">Upload to Dropbox</span> and <span class="hot">Fetch from Dropbox</span>: either way a save
          only replaces an older one.
        </p>
        <p>
          To load a game, put the folder it is installed in into the app folder with Dropbox's own app or website
          (<span class="hot">Apps</span>, then the name of your app). Then open the game's deck here and choose
          <span class="hot">Load holodisk from Dropbox</span>.
        </p>
      </div>
    {:else}
      <div class="gap">
        <Field label="App key" bind:value={appKey} bind:input={keyInput} placeholder="FROM YOUR DROPBOX APP" />
        <Field label="Access code" bind:value={code} bind:input={codeInput} placeholder="SHOWN BY DROPBOX" onenter={() => void linkNow()} />
      </div>
      <Menu items={unlinkedItems} label="Link to Dropbox" bind:selected />
      <div class="prose">
        <h2>Before the first link</h2>
        <p>
          The console has no accounts and no server. To link, you make a small private app in your own Dropbox. It
          gives the console one folder to work in and nothing else.
        </p>
        <dl class="readout gap">
          <dt>Step 1</dt>
          <dd>
            In the <a href={APP_CONSOLE_URL} target="_blank" rel="noopener">Dropbox App Console</a> choose Create app,
            Scoped access, <span class="hot">App folder</span>, and any name you like.
          </dd>
          <dt>Step 2</dt>
          <dd>
            On the app's Permissions tab tick
            {#each FILE_SCOPES as scope, index (scope)}<span class="hot">{scope}</span>{index < FILE_SCOPES.length - 1 ? ', ' : ''}{/each}
            and press Submit.
          </dd>
          <dt>Step 3</dt>
          <dd>Copy the App key from the app's Settings tab into the field above. Then open Dropbox from here, allow the app, and paste the code it shows.</dd>
        </dl>
      </div>
    {/if}
  </div>

  <aside class="board gap" aria-label="Dropbox link">
    <Glyph name={pointed?.icon ?? 'uplink'} tone={pointed?.tone} />
    <dl class="readout">
      <dt>Link</dt>
      <dd class:amber={!link}>{link ? 'LINKED' : 'NOT LINKED'}</dd>
      <dt>Reaches</dt>
      <dd>ONE APP FOLDER</dd>
      <dt>Moves files</dt>
      <dd>WHEN YOU SAY SO</dd>
    </dl>
  </aside>
</div>
