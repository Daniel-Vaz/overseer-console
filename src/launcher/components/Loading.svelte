<script lang="ts">
  // A holodisk on its way into storage: how far along it is, and a way to call it off.
  import { onMount } from 'svelte';
  import { formatBytes } from '../../lib/storage/manifest';
  import { sfx } from '../sfx';
  import { consoleState as sys, type ImportJob } from '../state.svelte';
  import type { MenuItem } from '../types';
  import Glyph from './Glyph.svelte';
  import Menu from './Menu.svelte';

  /** `what`: the name of what is looked for while the selection is read. `place`: what stays as it was if the copy is called off ("the deck"). */
  let { job, what, place = null }: { job: ImportJob; what: string; place?: string | null } = $props();

  let asking = $state(false);
  const percent = $derived(job.totalBytes ? Math.min(100, (job.doneBytes / job.totalBytes) * 100) : 0);

  onMount(() => {
    // ESC takes back the question before it leaves the screen.
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && asking) {
        event.preventDefault();
        event.stopImmediatePropagation();
        asking = false;
        sfx.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const loadingItems = $derived<MenuItem[]>([
    {
      key: 'x',
      label: 'Stop loading',
      note: `Calls the copy off. What was copied so far is thrown away${place ? `, and ${place} stays as it was` : ''}.`,
      action: () => (asking = true),
    },
  ]);

  const stopItems: MenuItem[] = [
    { key: 'n', label: 'No, carry on', action: () => (asking = false) },
    {
      key: 'y',
      label: 'Yes, stop loading',
      danger: true,
      action: () => {
        asking = false;
        sys.stopImport();
      },
    },
  ];
</script>

{#if job.phase === 'reading'}
  <p class="gap">READING HOLODISK<span class="cursor"></span></p>
  <p class="dim">{job.doing ?? `Looking for ${what} in ${job.remote ? `your ${job.remote}` : 'what you selected'}.`}</p>
{:else}
  <p class="gap">{job.remote ? `FETCHING HOLODISK FROM ${job.remote.toUpperCase()}` : 'LOADING HOLODISK'} INTO PRIVATE STORAGE</p>
  <div class="meter gap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)}>
    <div class="track"><div class="fill" style:width="{percent}%"></div></div>
    <span>{Math.round(percent)}%</span>
    <span class="dim">{formatBytes(job.doneBytes)} / {formatBytes(job.totalBytes)}</span>
  </div>
  <p class="dim">{job.path ? `COPYING ${job.path.toUpperCase()}` : 'PREPARING'}</p>
  <p class="gap amber">KEEP THIS TAB OPEN UNTIL THE COPY FINISHES.</p>
{/if}
{#if asking}
  <div class="signed ask gap">
    <Glyph name="warning" tone="amber" />
    <div>
      <p class="amber">STOP LOADING THE {what.toUpperCase()} HOLODISK?</p>
      <p>What was copied so far is thrown away.{place ? ` ${place.charAt(0).toUpperCase()}${place.slice(1)} stays as it was,` : ''} and the holodisk can be loaded again.</p>
    </div>
  </div>
  <Menu items={stopItems} label="Confirm stop" />
{:else}
  <Menu items={loadingItems} label="While loading" />
{/if}
