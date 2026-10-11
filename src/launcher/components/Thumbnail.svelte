<script lang="ts">
  import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from '../../lib/savefile';

  // The picture a game stored with a save, shown the way this tube would
  // show it: brightness only, in phosphor.
  let { pixels, palette, label }: { pixels: Uint8Array; palette: Uint8Array; label: string } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const context = canvas?.getContext('2d');
    if (!context || pixels.length < THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT) return;
    const image = context.createImageData(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    const out = image.data;
    for (let i = 0; i < THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT; i++) {
      const colour = pixels[i]! * 3;
      const luma = (0.299 * palette[colour]! + 0.587 * palette[colour + 1]! + 0.114 * palette[colour + 2]!) / 255;
      // The games are dark; lift the shadows so the scene reads at this size.
      const level = Math.pow(luma, 0.72);
      // Up to three quarters brightness the phosphor's own green, above that towards its white-hot core.
      const body = Math.min(1, level / 0.75);
      const core = Math.max(0, (level - 0.75) / 0.25);
      out[i * 4] = 77 * body + (200 - 77) * core;
      out[i * 4 + 1] = 255 * body;
      out[i * 4 + 2] = 124 * body + (214 - 124) * core;
      out[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  });
</script>

<canvas class="thumb" bind:this={canvas} width={THUMBNAIL_WIDTH} height={THUMBNAIL_HEIGHT} aria-label={label}></canvas>
