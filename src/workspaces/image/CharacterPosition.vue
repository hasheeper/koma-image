<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref } from "vue";
import { gridCenter, gridLabel } from "../../domain/characters.ts";
import type { Character, Center } from "../../domain/characters.ts";
const props = defineProps<{ characters: Character[]; ratio: number; grid: boolean; selected: string; large?: boolean }>();
const emit = defineEmits<{ change: [id: string, point: Center]; select: [id: string] }>();
const pad = ref<HTMLElement>();
let drag: { id: string; el: HTMLElement; pointer: number; point: Center } | null = null;
const point = (c: Character) => props.grid ? gridCenter(c.centers[0] ?? { x: .5, y: .5 }) : c.centers[0] ?? { x: .5, y: .5 };
function move(event: PointerEvent) {
  if (!drag || !pad.value) return;
  const r = pad.value.getBoundingClientRect();
  const value = { x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) };
  drag.point = props.grid ? gridCenter(value) : value;
  drag.el.style.left = `${drag.point.x * 100}%`; drag.el.style.top = `${drag.point.y * 100}%`;
}
function start(event: PointerEvent) {
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-char-id]");
  if (!el || event.button !== 0) return;
  event.preventDefault(); el.focus();
  drag = { id: el.dataset.charId!, el, pointer: event.pointerId, point: { x: .5, y: .5 } };
  el.setPointerCapture(event.pointerId); emit("select", drag.id); move(event);
}
function finish() { if (!drag) return; const { id, point } = drag; stop(); emit("change", id, point); }
function stop() {
  const prior = drag; drag = null;
  if (!prior) return;
  const c = props.characters.find(c => c.id === prior.id);
  if (c) { const p = point(c); prior.el.style.left = `${p.x * 100}%`; prior.el.style.top = `${p.y * 100}%`; }
  if (prior.el.hasPointerCapture(prior.pointer)) prior.el.releasePointerCapture(prior.pointer);
}
function keys(event: KeyboardEvent, c: Character) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault(); const p = point(c), step = props.grid ? .2 : .01;
  emit("select", c.id);
  emit("change", c.id, { x: Math.max(0, Math.min(1, p.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0))), y: Math.max(0, Math.min(1, p.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0))) });
}
onDeactivated(stop); onBeforeUnmount(stop);
</script>
<template>
  <div ref="pad" class="mc-pad" :class="{ 'mc-pad-stage': large }" :style="{ '--ratio': ratio }" :data-grid="grid" role="group" aria-label="角色位置" @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="stop" @lostpointercapture="stop">
    <button v-for="(c, i) in characters" v-show="c.on" :key="c.id" class="mc-dot" :class="{ 'mc-dot-lg': large }" type="button" :data-char-id="c.id" :data-on="c.id === selected || undefined" :style="{ left: `${point(c).x * 100}%`, top: `${point(c).y * 100}%` }" :aria-label="`角色 ${i + 1} 位置 ${grid ? gridLabel(point(c)) : `${point(c).x.toFixed(2)}, ${point(c).y.toFixed(2)}`}`" @keydown="keys($event, c)">{{ i + 1 }}</button>
    <span class="mc-pad-mode mono">{{ grid ? '5×5' : '自由' }}</span><slot />
  </div>
</template>
<style scoped>
.mc-pad { position: relative; width: min(100%, calc(168px * var(--ratio))); aspect-ratio: var(--ratio); background: var(--well); border: 1px solid var(--line); border-radius: var(--r2); touch-action: none; --guide: var(--line-2); background-image: linear-gradient(to right, transparent calc(50% - .5px), var(--guide) 0 calc(50% + .5px), transparent 0), linear-gradient(to bottom, transparent calc(50% - .5px), var(--guide) 0 calc(50% + .5px), transparent 0); }
.mc-pad[data-grid="true"] { background-image: linear-gradient(to right, var(--guide) 1px, transparent 1px), linear-gradient(to bottom, var(--guide) 1px, transparent 1px); background-size: 20% 100%, 100% 20%; background-position: -1px 0, 0 -1px; }
.mc-pad-mode { position: absolute; left: 7px; bottom: 4px; color: var(--fg-4); font-size: 10px; pointer-events: none; }
.mc-dot { position: absolute; z-index: 1; display: grid; place-items: center; width: 22px; height: 22px; translate: -50% -50%; font: var(--fw-semibold) 11px/1 var(--mono); color: var(--fg); background: rgb(22 22 26 / 92%); border: 1.5px solid var(--fg-3); border-radius: 50%; cursor: grab; touch-action: none; transition: background var(--t1) var(--e), border-color var(--t1) var(--e); }
.mc-dot:active { cursor: grabbing; }
.mc-dot[data-on] { color: var(--a-ink); background: var(--a); border-color: var(--a); }
.mc-pad-stage { width: 100%; height: 100%; aspect-ratio: auto; background-color: transparent; border: 0; --guide: rgb(255 255 255 / 16%); }
.mc-dot-lg { width: 32px; height: 32px; font-size: 13px; border-width: 2px; box-shadow: 0 2px 8px rgb(0 0 0 / 50%); }
@media (pointer: coarse) { .mc-dot::before { content: ""; position: absolute; inset: -11px; } }
</style>
