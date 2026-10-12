<script lang="ts">
  import { ICONS, type IconName } from '../icons';

  // An icon drawn in phosphor: the artwork is used as a mask over the tube's colour.
  // A tone draws it in the colour of a caution or of a fault instead.
  let { name, tone }: { name: IconName; tone?: 'amber' | 'alert' } = $props();
</script>

<div class="glyph" class:amber={tone === 'amber'} class:alert={tone === 'alert'} style:--glyph="url({ICONS[name]})" aria-hidden="true"></div>
