<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue';

import type { Point } from './view.ts';
const props = withDefaults(defineProps<{ src?: string; label: string; active?: boolean; historyVisible?: boolean }>(), { active: true });
const emit = defineEmits<{ zoom: [percent: number]; historyHost: [host: HTMLElement | null] }>();
let lastPercent = -1;
const box = useTemplateRef<HTMLElement>('box'), image = useTemplateRef<HTMLImageElement>('image');
const frame = useTemplateRef<HTMLElement>('frame'), historyHost = useTemplateRef<HTMLElement>('historyHost');
watch([historyHost, () => props.historyVisible], ([host, visible]) => { if (visible) emit('historyHost', host); }, { flush: 'post' });
const zoomed = shallowRef(false);
let scale = 1, fitted = 1, x = 0, y = 0; let observer: ResizeObserver | undefined;
let lastWidth = 0, lastHeight = 0, needsFit = true;
const pointers = new Map<number, Point>();
let previous: Point | null = null;
function paint() {
  if (!image.value || !box.value) return;
  const limitX = Math.max(0, (image.value.naturalWidth * scale - box.value.clientWidth) / 2);
  const limitY = Math.max(0, (image.value.naturalHeight * scale - box.value.clientHeight) / 2);
  x = Math.max(-limitX, Math.min(limitX, x)); y = Math.max(-limitY, Math.min(limitY, y));
  image.value.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
  zoomed.value = scale > fitted * 1.01;
  const percent = Math.round(scale * 100);
  if (percent !== lastPercent) { lastPercent = percent; emit('zoom', percent); }
}
function fit() {
  if (!props.active || !image.value?.naturalWidth || !frame.value?.clientWidth || !frame.value.clientHeight) return;
  lastWidth = frame.value.clientWidth; lastHeight = frame.value.clientHeight; needsFit = false;
  fitted = Math.min((lastWidth - (props.historyVisible ? 76 : 0)) / image.value.naturalWidth, lastHeight / image.value.naturalHeight);
  frame.value.style.setProperty('--image-fit-w', `${image.value.naturalWidth * fitted}px`);
  scale = fitted; x = y = 0; paint();
}
function zoom(next: number, clientX?: number, clientY?: number) {
  const rect = box.value!.getBoundingClientRect();
  const atX = clientX == null ? 0 : clientX - rect.left - rect.width / 2;
  const atY = clientY == null ? 0 : clientY - rect.top - rect.height / 2;
  const ratio = Math.max(Math.min(fitted, 1), Math.min(Math.max(4, fitted * 4), next)) / scale;
  x = atX - (atX - x) * ratio; y = atY - (atY - y) * ratio; scale *= ratio; paint();
}
function toggle(event?: MouseEvent) { if (zoomed.value) fit(); else zoom(Math.max(1, fitted * 2), event?.clientX, event?.clientY); }
function gesture() {
  const p = [...pointers.values()];
  return p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) } : p[0];
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  box.value!.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); previous = gesture();
}
function move(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const next = gesture();
  if (previous?.distance && next.distance) zoom(scale * next.distance / previous.distance, next.x, next.y);
  if (previous) { x += next.x - previous.x; y += next.y - previous.y; paint(); }
  previous = next;
}
function up(event: PointerEvent) { pointers.delete(event.pointerId); previous = pointers.size ? gesture() : null; }
function resize() {
  if (!props.active || !frame.value?.clientWidth || !frame.value.clientHeight) return;
  if (needsFit || frame.value.clientWidth !== lastWidth || frame.value.clientHeight !== lastHeight) fit(); else paint();
}
function releasePointers() {
  for (const id of pointers.keys()) if (box.value?.hasPointerCapture(id)) box.value.releasePointerCapture(id);
  pointers.clear(); previous = null;
}
async function visibility() {
  observer?.disconnect(); releasePointers();
  if (!props.active) return;
  await nextTick(); if (!props.active || !frame.value) return;
  observer?.observe(frame.value); resize();
}
watch(() => props.src, () => { releasePointers(); needsFit = true; });
watch(() => props.active, visibility);
watch(() => props.historyVisible, fit, { flush: 'post' });
onMounted(() => { observer = new ResizeObserver(resize); visibility(); });
onBeforeUnmount(() => { observer?.disconnect(); releasePointers(); });
defineExpose({ fit, step: (delta: number) => zoom(scale * Math.pow(1.25, delta)), actualSize: () => zoom(1) });
</script>
<template>
  <div ref="frame" class="stage-image-frame">
    <div class="image-presentation" :class="{ 'with-history': historyVisible }">
      <div ref="historyHost" v-show="historyVisible" class="history-slot"></div>
  <div ref="box" class="stage-image" :class="{ zoomed }" tabindex="0" :aria-label="`${label}，滚轮缩放、拖动查看，双击还原或放大`" @dblclick="toggle" @wheel.prevent="zoom(scale * Math.exp(-$event.deltaY * .002), $event.clientX, $event.clientY)" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up" @keydown.enter.prevent="toggle()" @keydown.home.prevent="fit">
    <span v-if="!src" class="missing-image">原图已失效</span>
    <img v-else ref="image" :src="src" :alt="label" draggable="false" @load="fit" />
  </div>
    </div>
  </div>
</template>
<style scoped>
.stage-image-frame { position: relative; display: grid; place-items: center; flex: 1; min-width: 0; min-height: 0; }
.image-presentation { display: contents; }
.image-presentation.with-history { display: grid; grid-template-columns: 72px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 4px; width: calc(var(--image-fit-w, 0px) + 76px); height: 100%; }
.history-slot { min-width: 0; min-height: 0; }
.stage-image { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; touch-action: none; cursor: zoom-in; }
.stage-image.zoomed { cursor: grab; }
.stage-image.zoomed:active { cursor: grabbing; }
.missing-image { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fg-3); }
.stage-image img { position: absolute; left: 50%; top: 50%; max-width: none; max-height: none; width: auto; height: auto; border-radius: var(--r2); transform-origin: center; box-shadow: var(--print-shadow); user-select: none; pointer-events: none; }
</style>
