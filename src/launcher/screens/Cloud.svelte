<script lang="ts">
  // Cloud link: the cloud the console is linked to, or a choice of the two while it is linked to none.
  import { onMount } from 'svelte';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';
  import CloudPut from './CloudPut.svelte';
  import Drive from './Drive.svelte';
  import Dropbox from './Dropbox.svelte';

  /** `sub`: what the route names after cloud: dropbox, drive, or put. */
  let { go, sub = undefined }: { go: (path: string, replace?: boolean) => void; sub?: string } = $props();

  /** The cloud whose screen was last shown here: it stays on the screen after an unlink, with what it has to say. */
  let shown = $state<'dropbox' | 'drive' | null>(null);
  let selected = $state(0);

  const view = $derived.by((): 'dropbox' | 'drive' | 'put' | 'choose' => {
    if (sub === 'put') return sys.cloud.linked ? 'put' : 'choose';
    if (sub === 'dropbox' || sub === 'drive') return sub;
    return sys.cloud.id ?? shown ?? 'choose';
  });

  $effect(() => {
    if (view === 'dropbox' || view === 'drive') shown = view;
  });

  $effect(() => {
    // Linked from its own page: that page is now Cloud link itself, and ESC leaves it for the settings.
    if ((sub === 'dropbox' || sub === 'drive') && sys.cloud.id === sub) go('settings/cloud', true);
  });

  onMount(() => {
    if (view === 'choose') {
      sys.hints = [
        ['↑↓', 'SELECT'],
        ['ENTER', 'OPEN'],
        ['ESC', 'BACK'],
      ];
    }
  });

  const items: MenuItem[] = [
    {
      key: '1',
      label: 'Dropbox',
      state: 'FREE: 2 GB',
      icon: 'uplink',
      note: 'Three steps to set up: a small app in your own Dropbox, with one folder for the console. A free Dropbox holds 2 GB: the two games and a mod.',
      action: () => go('settings/cloud/dropbox'),
    },
    {
      key: '2',
      label: 'Google Drive',
      state: 'FREE: UP TO 15 GB',
      icon: 'uplink',
      note: 'Six steps to set up: a project in your own Google Cloud, with a client for the console. A free Google account holds up to 15 GB, shared with Gmail and Google Photos: room for the games and every mod the console knows.',
      action: () => go('settings/cloud/drive'),
    },
    { key: '0', label: 'Back', icon: 'back', action: () => go('settings') },
  ];

  const pointed = $derived(items[selected]);
</script>

{#if view === 'put'}
  <CloudPut {go} />
{:else if view === 'dropbox'}
  <Dropbox {go} />
{:else if view === 'drive'}
  <Drive {go} />
{:else}
  <h1>Cloud link</h1>
  <p class="sub">Optional. Your saves in your own Dropbox or Google Drive, and your games loaded from it.</p>

  <div class="columns">
    <div>
      <div class="prose">
        <p>
          The console has no accounts and no server. It links to a cloud of yours through a small app or project you make
          in your own account, and works in a folder of its own there, which nothing else reaches. One cloud at a time.
        </p>
      </div>
      <Menu {items} label="Cloud link" bind:selected />
      <p class="gap dim">EITHER ONE CARRIES SAVES BETWEEN DEVICES AND BRINGS GAMES AND MODS TO ANY OF THEM.</p>
    </div>

    <aside class="board gap" aria-label="Cloud link">
      <Glyph name={pointed?.icon ?? 'uplink'} />
      <dl class="readout">
        <dt>Link</dt>
        <dd class="amber">NOT LINKED</dd>
        <dt>Reaches</dt>
        <dd>ITS OWN FOLDER</dd>
        <dt>Moves files</dt>
        <dd>WHEN ASKED</dd>
      </dl>
    </aside>
  </div>
{/if}
