<script lang="ts">
  import { ICONS, type IconName } from '../icons';

  // An icon drawn in phosphor: the artwork is used as a mask over the tube's colour.
  let { name }: { name: IconName } = $props();
</script>

<div class="glyph" style:--glyph="url({ICONS[name]})" aria-hidden="true"></div>
