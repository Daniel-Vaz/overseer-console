<script lang="ts">
  import { onMount } from 'svelte';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import { tally } from '../vault/remarks';
  import type { Request, Vault } from '../vault/vault';

  // The room the console stands in: an abandoned vault, seen past the edges of the housing.
  // Its great door is shut while the console's storage is sealed, and stands open while it is not.
  let { housing, sealed }: { housing: HTMLElement | undefined; sealed: boolean | null } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let showing = $state(false);
  let vault: Vault | undefined = $state.raw();

  $effect(() => {
    if (sealed !== null) vault?.seal(sealed);
  });

  onMount(() => {
    let gone = false;
    let pending = 0;
    // The painter is fetched once the console itself is up; a small screen never waits for it.
    void import('../vault/vault').then(({ openVault }) => {
      if (gone || !canvas) return;
      vault = openVault(canvas, {
        housing: () => housing?.getBoundingClientRect() ?? null,
        still: matchMedia('(prefers-reduced-motion: reduce)').matches,
        onshow: (now) => (showing = now),
        onsound: (sound) => sfx[sound](),
        onremark: (remark) => sys.remark(remark),
        onsquash: () => sys.remark(tally(sys.squash())),
      });
    });
    const observer = new ResizeObserver(() => {
      clearTimeout(pending);
      pending = window.setTimeout(() => vault?.resize(), 150);
    });
    if (canvas?.parentElement) observer.observe(canvas.parentElement);
    // Whatever in the room watches the pointer has to know where it is, also while it is over the console.
    const onMove = (event: PointerEvent) => vault?.look(event.clientX, event.clientY, event.target === canvas);
    window.addEventListener('pointermove', onMove, { passive: true });
    // The room takes requests: dispatchEvent(new CustomEvent('overseer:vault', { detail: 'ghoul' })).
    const onRequest = (event: Event) => vault?.send((event as CustomEvent<Request>).detail);
    window.addEventListener('overseer:vault', onRequest);
    return () => {
      gone = true;
      clearTimeout(pending);
      observer.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('overseer:vault', onRequest);
      vault?.close();
    };
  });
</script>

<canvas
  class="vault"
  class:showing
  bind:this={canvas}
  aria-hidden="true"
  onpointerdown={(event) => {
    vault?.look(event.clientX, event.clientY, true);
    vault?.press(event.clientX, event.clientY);
  }}
></canvas>
