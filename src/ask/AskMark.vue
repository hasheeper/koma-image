<script setup lang="ts">
defineProps<{ thinking?: boolean }>();
// B+ on a 19×19 grid: core, four edges, four corners; ring 0 → 2 for the pulse.
const C = 9.5,
  E = 2.6,
  K = 3;
const square = (x: number, y: number, size: number, opacity: number, ring: number) => ({
  x: x - size / 2,
  y: y - size / 2,
  size,
  rx: Math.min(2.1, size * 0.28),
  style: `--o:${opacity};--r:${ring}`,
});
const squares = [
  ...[[K, K], [19 - K, K], [19 - K, 19 - K], [K, 19 - K]].map(([x, y]) => square(x, y, 2.8, 0.24, 2)),
  ...[[C, E], [19 - E, C], [C, 19 - E], [E, C]].map(([x, y]) => square(x, y, 3.6, 0.5, 1)),
  square(C, C, 7.4, 1, 0),
];
</script>
<template>
  <svg class="ask-mark" :class="{ think: thinking }" viewBox="0 0 19 19" aria-hidden="true">
    <rect
      v-for="(s, i) in squares"
      :key="i"
      :x="s.x"
      :y="s.y"
      :width="s.size"
      :height="s.size"
      :rx="s.rx"
      :style="s.style"
    />
  </svg>
</template>
<style scoped>
.ask-mark { flex: none; width: 22px; height: 22px; }
.ask-mark rect { fill: var(--a); opacity: var(--o); }
.think rect { animation: ask-pulse 1.8s cubic-bezier(.4, 0, .2, 1) infinite; animation-delay: calc(var(--r) * 220ms); }
@keyframes ask-pulse {
  0%, 100% { opacity: var(--o); }
  35% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .think rect { animation: none; }
}
</style>
