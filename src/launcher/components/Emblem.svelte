<script lang="ts">
  // A cogwheel, drawn from scratch: what the status board shows when an entry has no picture of its own.
  const TEETH = 12;
  const OUTER = 96;
  const ROOT = 80;

  const points = Array.from({ length: TEETH }, (_, tooth) => {
    const step = (Math.PI * 2) / TEETH;
    return [
      [ROOT, 0],
      [OUTER, 0.16],
      [OUTER, 0.46],
      [ROOT, 0.62],
    ].map(([radius, at]) => {
      const angle = (tooth + at!) * step;
      return `${(100 + radius! * Math.cos(angle)).toFixed(1)},${(100 + radius! * Math.sin(angle)).toFixed(1)}`;
    });
  })
    .flat()
    .join(' ');

  const bolts = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return { x: 100 + 60 * Math.cos(angle), y: 100 + 60 * Math.sin(angle) };
  });
</script>

<svg class="art" viewBox="-4 -4 208 208" aria-hidden="true">
  <g class="turning">
    <polygon {points} />
    <circle class="faint" cx="100" cy="100" r="70" />
    {#each bolts as bolt, index (index)}
      <circle class="faint" cx={bolt.x} cy={bolt.y} r="3.5" />
    {/each}
  </g>
  <circle cx="100" cy="100" r="46" />
  <text x="100" y="109" text-anchor="middle" font-size="44">OC</text>
  <text x="100" y="128" text-anchor="middle" font-size="13" letter-spacing="2">CONSOLE</text>
</svg>
