<script setup lang="ts">
defineProps<{ thinking?: boolean; interactive?: boolean }>();
// One 20px integer grid at every entry: core 8, edges 4, corners 3.
const square = (x: number, y: number, size: number, opacity: number, ring: number, name = "") => ({
  x, y, size, name, rx: size >= 8 ? 2 : size >= 4 ? 1.2 : 1,
  style: `--o:${opacity};--r:${ring}`,
});
const squares = [
  square(2, 2, 3, .24, 2, "c1"), square(15, 2, 3, .24, 2, "c2"),
  square(15, 15, 3, .24, 2, "c3"), square(2, 15, 3, .24, 2, "c4"),
  square(8, 1, 4, .5, 1, "edge"), square(15, 8, 4, .5, 1, "edge"),
  square(8, 15, 4, .5, 1, "edge"), square(1, 8, 4, .5, 1, "edge"),
  square(6, 6, 8, 1, 0, "core"),
];
</script>
<template>
  <svg class="ask-mark" :class="{ think: thinking, interactive }" viewBox="0 0 20 20" aria-hidden="true">
    <rect v-for="(s, i) in squares" :key="i" :class="s.name" :x="s.x" :y="s.y" :width="s.size" :height="s.size" :rx="s.rx" :style="s.style" />
  </svg>
</template>
<style scoped>
.ask-mark { display: block; flex: none; width: 20px; height: 20px; shape-rendering: crispEdges; }
.ask-mark rect { fill: var(--a); opacity: var(--o); transform-box: fill-box; transform-origin: center; transition: transform .3s cubic-bezier(.32, .72, 0, 1), opacity .3s var(--e); }
.think rect { animation: ask-pulse 1.8s cubic-bezier(.4, 0, .2, 1) infinite; animation-delay: calc(var(--r) * 220ms); }
@keyframes ask-pulse { 0%, 100% { opacity: var(--o); } 35% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .think rect { animation: none; }
  .ask-mark rect { transition: none; }
}
</style>
