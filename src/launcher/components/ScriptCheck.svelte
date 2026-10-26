<script lang="ts">
  // Whether an add-on or mod will work on the engine, as far as its scripts tell. See lib/sfall/check.ts.
  import { checkFiles, describe, verdict, type Check } from '../../lib/sfall/check';
  import { loadInstall, openInstalled, type Shelf } from '../../lib/storage/opfs';
  import { sfx } from '../sfx';
  import type { MenuItem } from '../types';
  import Menu from './Menu.svelte';

  /** `owner`: the add-on or mod checked, kept on `shelf`. `back`: leaves this view. */
  let { owner, shelf, title, back }: { owner: string; shelf: Shelf; title: string; back: () => void } = $props();

  let check = $state<Check | null>(null);
  let reading = $state('');
  let failed = $state<string | null>(null);

  $effect(() => {
    void owner;
    void run();
  });

  async function run(): Promise<void> {
    check = null;
    failed = null;
    reading = '';
    try {
      const install = await loadInstall(owner, shelf);
      if (!install) throw new Error(`The files of ${title} are not in this browser.`);
      const files = install.manifest.files.map((file) => ({ path: file.path, size: file.size, open: () => openInstalled(install, file.path) }));
      check = await checkFiles(files, (path) => (reading = path));
      if (check.findings.length) sfx.deny();
      else sfx.done();
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    }
  }

  const items = $derived<MenuItem[]>([
    {
      key: 'c',
      label: 'Check again',
      disabled: !check && !failed,
      note: 'Reads its scripts again, for example after loading a newer version of it.',
      action: () => void run(),
    },
    { key: '0', label: 'Back', action: back },
  ]);
</script>

<p class="gap">CHECK OF {title.toUpperCase()}</p>
{#if failed}
  <p class="alert prose" role="alert">{failed}</p>
{:else if !check}
  <p class="gap">READING ITS SCRIPTS{reading ? `: ${reading.toUpperCase()}` : ''}<span class="cursor"></span></p>
{:else}
  <dl class="readout">
    <dt>Scripts</dt>
    <dd>{check.scripts.toLocaleString('en-US')}</dd>
    <dt>Verdict</dt>
    <dd class:amber={check.findings.length > 0}>{verdict(check)}</dd>
  </dl>
  {#if !check.scripts}
    <p class="dim prose">It has no scripts: what it brings (pictures, words, music, data) is read by the game as it is.</p>
  {:else if !check.findings.length}
    <p class="dim prose">
      Everything its scripts ask of sfall the engine has, and the settings files they read are there. That is as far as
      the console can tell without playing it: a mod can still go wrong in ways its scripts do not show.
    </p>
  {:else}
    <p class="dim prose">What its scripts ask for that the engine lacks. The rest of it works; these parts may not.</p>
    <ul class="findings">
      {#each check.findings as finding (`${finding.kind}:${finding.what}`)}
        <li>{describe(finding)}</li>
      {/each}
    </ul>
  {/if}
{/if}
<Menu {items} label={`Check of ${title}`} />

<style>
  .findings {
    margin: 0.6em 0 0;
    padding: 0;
    list-style: none;
  }

  .findings li {
    padding-left: 2ch;
    text-indent: -2ch;
    margin-bottom: 0.35em;
  }

  .findings li::before {
    content: '\25B8\00a0';
    color: var(--phosphor-dim);
  }
</style>
