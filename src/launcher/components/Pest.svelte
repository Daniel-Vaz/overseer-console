<script lang="ts">
  import { onMount } from 'svelte';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { Actor } from '../vault/life';
  import type { Pest } from '../vault/pest';
  import { tally } from '../vault/remarks';

  // A radroach that comes out onto the glass of the tube when nobody has touched the console for a
  // while. It makes off as soon as somebody does, unless they are quicker than it is.

  /** Screen pixels to one of the roach's own, as in the room behind the console. */
  const COARSE = 3;
  /** Pictures a second. */
  const RATE = 12;
  /** The sheet the roach is drawn on, in its own pixels. */
  const SHEET = 21;

  let canvas: HTMLCanvasElement | undefined = $state();
  let out = $state(false);
  let squash: (event: PointerEvent) => void = $state(() => undefined);

  onMount(() => {
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const glass = canvas.parentElement!;
    const context = canvas.getContext('2d')!;
    let pest: Pest | null = null;
    let pictures: Record<string, HTMLCanvasElement[]> | null = null;
    let stride = 1;
    let fetching = false;
    let frame = 0;
    let last = 0;
    /* Seconds since anybody touched anything, and how many of them it waits for. */
    let idle = 0;
    let wait = 75 + Math.random() * 60;

    function draw(roach: Actor): void {
      const caught = roach.kind === 'stain';
      const sheets = pictures?.[caught ? 'splat' : `${roach.pose}${roach.heading}`];
      if (!sheets?.length) return;
      const sheet = sheets[roach.pose === 'walk' ? Math.floor((roach.walked / stride) * sheets.length) % sheets.length : Math.floor(roach.held * 5) % sheets.length]!;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, SHEET, SHEET);
      context.drawImage(sheet, (SHEET - sheet.width) / 2, (SHEET - sheet.height) / 2);
      if (!caught) {
        // On the glass it has the tube's light behind it: a dark thing, edged in green.
        context.globalCompositeOperation = 'source-atop';
        context.fillStyle = 'rgba(8, 44, 18, 0.3)';
        context.fillRect(0, 0, SHEET, SHEET);
      }
      canvas!.style.transform = `translate(${Math.round((roach.x - SHEET / 2) * COARSE)}px, ${Math.round((roach.y - SHEET / 2) * COARSE)}px)`;
      canvas!.style.opacity = String(roach.shown);
    }

    function tick(now: number): void {
      if (!pest) return;
      frame = requestAnimationFrame(tick);
      if (now - last < 1000 / RATE - 2) return;
      pest.step(Math.min(0.25, (now - last) / 1000));
      last = now;
      if (pest.roach) {
        draw(pest.roach);
        return;
      }
      out = false;
      cancelAnimationFrame(frame);
    }

    async function come(): Promise<void> {
      if (fetching || pest?.roach) return;
      fetching = true;
      // The roach and its pictures are fetched when it first comes out, not before.
      const [{ Pest }, { breed }] = await Promise.all([import('../vault/pest'), import('../vault/critters')]);
      fetching = false;
      if (!pictures) {
        const roach = breed('radroach');
        stride = roach.stride;
        pictures = { splat: breed('stain').poses.splat!.map((sheet) => sheet.toCanvas()) };
        for (const [pose, sheets] of Object.entries(roach.poses)) pictures[pose] = sheets.map((sheet) => sheet.toCanvas());
      }
      pest = new Pest(glass.clientWidth / COARSE, glass.clientHeight / COARSE);
      pest.come();
      draw(pest.roach!);
      out = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }

    squash = (event) => {
      const bounds = glass.getBoundingClientRect();
      if (!pest?.squash((event.clientX - bounds.left) / COARSE, (event.clientY - bounds.top) / COARSE)) return;
      sfx.squash();
      sys.remark(tally(sys.squash()));
    };

    const stirred = () => {
      idle = 0;
      pest?.flee();
    };
    const signs = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
    for (const sign of signs) window.addEventListener(sign, stirred, { passive: true });
    const counting = window.setInterval(() => {
      if (document.hidden || pest?.roach) return;
      idle += 1;
      if (idle < wait) return;
      idle = 0;
      wait = 90 + Math.random() * 120;
      void come();
    }, 1000);
    // It can be called for, like the visitors to the room: dispatchEvent(new CustomEvent('overseer:vault', { detail: 'pest' })).
    const onRequest = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'pest') void come();
    };
    window.addEventListener('overseer:vault', onRequest);
    return () => {
      for (const sign of signs) window.removeEventListener(sign, stirred);
      window.removeEventListener('overseer:vault', onRequest);
      clearInterval(counting);
      cancelAnimationFrame(frame);
      pest = null;
    };
  });
</script>

<canvas class="pest" class:out bind:this={canvas} width={SHEET} height={SHEET} aria-hidden="true" onpointerdown={(event) => squash(event)}></canvas>
