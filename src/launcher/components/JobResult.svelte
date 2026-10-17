<script lang="ts">
  // How the last copy into storage ended: refused, called off, or done, with what is worth knowing about it.
  import { formatBytes } from '../../lib/storage/manifest';
  import type { ImportJob } from '../state.svelte';
  import Glyph from './Glyph.svelte';

  /**
   * `beside`: another game or mod the same folder holds, to be loaded from it without a second pick.
   * `place`: what was left as it was by a copy that was called off ("the deck").
   */
  let { job, beside = null, place = null }: { job: ImportJob; beside?: string | null; place?: string | null } = $props();
</script>

{#if job.phase === 'failed'}
  <div class="panel signed bad" role="alert">
    <Glyph name="fault" tone="alert" />
    <div>
      <p class="alert">HOLODISK REJECTED</p>
      <p>{job.error}</p>
    </div>
  </div>
{:else if job.phase === 'stopped'}
  <div class="panel signed" role="status">
    <Glyph name="warning" tone="amber" />
    <div>
      <p class="amber">LOADING STOPPED</p>
      <p>Nothing was changed{place ? `: ${place} is as it was` : ''}.</p>
    </div>
  </div>
{:else if job.phase === 'done' && job.plan}
  <div class="panel signed" role="status">
    <Glyph name="ok" />
    <div>
      <p class="hot">HOLODISK LOADED</p>
      <p>
        {job.plan.sourceFiles.toLocaleString('en-US')} files, {formatBytes(job.plan.totalBytes)}.
        {#if job.plan.saves.length}Saved games found in the folder were added to the save archives.{/if}
      </p>
      {#each job.plan.notes as note (note)}
        <p>{note}</p>
      {/each}
      {#each job.plan.warnings as warning (warning)}
        <p class="amber">{warning}</p>
      {/each}
      {#if beside}
        <p class="hot">{beside.toUpperCase()} IS IN THAT FOLDER AS WELL.</p>
      {/if}
    </div>
  </div>
{/if}
