<script setup lang="ts">
/* The workspace mark drawn tile by tile (same geometry as
   assets/icons.svg#mk-image / #mk-chat), so each tile can breathe in turn:
   the delay is the tile's column plus row, a wave from the top-left. */
type Tile = [x: number, y: number, size: number, radius: number, opacity: number, delay: number];
const big = (x: number, y: number, d: number): Tile => [x, y, 6, 1.7, 1, d],
  mid = (x: number, y: number, d: number): Tile => [x, y, 4.4, 1.1, 0.5, d],
  dot = (x: number, y: number, d: number): Tile => [x, y, 3, 1.1, 0.24, d];
const tiles: Record<"image" | "chat", Tile[]> = {
  image: [
    dot(3, 3, 0),
    mid(9.8, 2.3, 1),
    big(16.5, 1.5, 2),
    mid(2.3, 9.8, 1),
    big(9, 9, 2),
    mid(17.3, 9.8, 3),
    big(1.5, 16.5, 2),
    mid(9.8, 17.3, 3),
    dot(18, 18, 4),
  ],
  chat: [
    big(1.5, 1.5, 0),
    big(9, 1.5, 1),
    big(16.5, 1.5, 2),
    big(1.5, 9, 1),
    big(9, 9, 2),
    mid(17.3, 9.8, 3),
  ],
};
defineProps<{ surface: "image" | "chat" }>();
</script>
<template>
  <svg class="wave-mark" viewBox="0 0 24 24" aria-hidden="true">
    <rect
      v-for="([x, y, size, radius, opacity, delay], i) in tiles[surface]"
      :key="i"
      :x="x"
      :y="y"
      :width="size"
      :height="size"
      :rx="radius"
      :opacity="opacity < 1 ? opacity : undefined"
      :style="{ '--d': delay }"
    /><path
      v-if="surface === 'chat'"
      d="M1.5 16.5h4.6L1.5 21.5Z"
      style="--d: 2"
    />
  </svg>
</template>
<style scoped>
.wave-mark { flex: none; overflow: visible; fill: var(--a); }
.wave-mark > * { transform-box: fill-box; transform-origin: center; animation: waveBreath 3.6s var(--e) infinite; animation-delay: calc(var(--d) * 160ms); }
@keyframes waveBreath { 0%, 100% { transform: scale(1); } 40% { transform: scale(0.8); } }
@media (prefers-reduced-motion: reduce) { .wave-mark > * { animation: none; } }
</style>
