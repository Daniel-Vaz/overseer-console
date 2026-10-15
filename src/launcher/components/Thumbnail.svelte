<script lang="ts">
  import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from '../../lib/savefile';
  import { glowLevel, shine } from '../phosphor';

  // The picture a game stored with a save, shown the way this tube would
  // show it: brightness only, in phosphor.
  let { pixels, palette, label }: { pixels: Uint8Array; palette: Uint8Array; label: string } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const context = canvas?.getContext('2d');
    if (!context || pixels.length < THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT) return;
    const image = context.createImageData(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    for (let i = 0; i < THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT; i++) shine(image.data, i * 4, glowLevel(palette, pixels[i]!));
    context.putImageData(image, 0, 0);
  });
</script>

<canvas class="thumb" bind:this={canvas} width={THUMBNAIL_WIDTH} height={THUMBNAIL_HEIGHT} aria-label={label}></canvas>
