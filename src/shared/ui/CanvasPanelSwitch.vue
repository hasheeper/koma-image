<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch } from "vue";
import AppIcon from "../AppIcon.vue";

/** One tray switch for every canvas collaboration workspace: the panes differ, the island does not. */
export type CanvasPanelOption = { value: string; label: string; icon: string; controls?: string; id?: string; updated?: boolean; meta?: string };
/* The island keeps one form everywhere: over a full-screen phone pane it stays segmented, at the
   same corner, so opening or closing a pane never moves or reshapes it. */
const props = defineProps<{ options: readonly CanvasPanelOption[]; selected: string | null; label: string }>();
const emit = defineEmits<{ select: [value: string] }>();
const root = shallowRef<HTMLElement | null>(null);
/* The thumb only slides between measured positions. `data-ready` (which turns
   its transition on) is written here, natively and in the same task as the
   position, so a style read in between can never interpolate from a stale spot.
   A first placement, or one after the island was hidden or the tray collapsed,
   lands with the transition off for two frames. */
let ready = false, frames: number[] = [], observer: ResizeObserver | null = null;
function cancel() { frames.forEach(cancelAnimationFrame); frames = []; }
function setReady(group: HTMLElement | null, value: boolean) {
  ready = value;
  if (value) group?.setAttribute("data-ready", ""); else group?.removeAttribute("data-ready");
}
function place(instant = false) {
  const group = root.value, active = group?.querySelector<HTMLElement>('button[aria-pressed="true"]');
  if (!group || !group.offsetWidth) { cancel(); setReady(group, false); return; }
  if (instant || !ready) { cancel(); setReady(group, false); }
  if (active) {
    group.style.setProperty("--thumb-x", `${active.offsetLeft}px`);
    group.style.setProperty("--thumb-w", `${active.offsetWidth}px`);
  }
  if (ready || frames.length) return;
  frames = [requestAnimationFrame(() => { frames = [requestAnimationFrame(() => { frames = []; setReady(root.value, true); })]; })];
}
function observe() {
  observer?.disconnect();
  if (!root.value) return;
  observer = new ResizeObserver(() => place());
  observer.observe(root.value);
  place(true);
}
function release() { observer?.disconnect(); observer = null; cancel(); setReady(root.value, false); }
watch(() => props.selected, (_value, previous) => void nextTick(() => place(!previous)), { flush: "post" });
watch(() => props.options.map(o => o.label).join("|"), () => void nextTick(() => place()), { flush: "post" });
onMounted(observe);
onActivated(observe);
onDeactivated(release);
onBeforeUnmount(release);
defineExpose({ focus(value: string) { root.value?.querySelector<HTMLButtonElement>(`button[data-value="${value}"]`)?.focus({ preventScroll: true }); } });
</script>
<template>
  <div ref="root" class="canvas-panel-switch" role="group" :aria-label="label">
    <span class="canvas-panel-thumb" aria-hidden="true" :data-shown="!!selected || undefined"></span>
    <button
      v-for="o in options"
      :key="o.value"
      :id="o.id"
      type="button"
      :data-value="o.value"
      :aria-controls="o.controls"
      :aria-pressed="selected === o.value"
      :data-updated="o.updated || undefined"
      @click="emit('select', o.value)"
    ><AppIcon :name="o.icon" /><span class="canvas-panel-label">{{ o.label }}</span><small v-if="o.meta" class="canvas-panel-meta">{{ o.meta }}</small></button>
  </div>
</template>
<style scoped>
.canvas-panel-switch { position: relative; display: inline-flex; flex: none; align-items: center; gap: 2px; height: 34px; padding: 3px; color: var(--fg-2); background: var(--glass-bg); border: 1px solid var(--line-2); border-radius: 10px; box-shadow: var(--sh-1); backdrop-filter: blur(var(--glass-blur)); }
.canvas-panel-switch > button { position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 65px; height: 26px; padding: 0 8px; color: var(--fg-3); border-radius: 7px; font-size: var(--fz-xs); font-weight: var(--fw-medium); white-space: nowrap; -webkit-tap-highlight-color: transparent; transition: color var(--t1) var(--e), background-color var(--t1) var(--e); --ico: var(--ico-sm); }
.canvas-panel-switch > button:not([aria-pressed="true"]):hover { color: var(--fg-2); background: var(--hover); }
.canvas-panel-switch > button[aria-pressed="true"] { color: var(--fg); }
/* A count beside the label (settings sections), quieter than it. */
.canvas-panel-meta { font: 11px/1 var(--mono); color: var(--fg-4); }
/* Until measured, the pressed button carries its own surface. */
.canvas-panel-switch:not([data-ready]) > button[aria-pressed="true"] { background: var(--nav-active-bg); box-shadow: var(--nav-active-shadow); }
.canvas-panel-thumb { position: absolute; top: 3px; bottom: 3px; left: 0; width: var(--thumb-w, 0px); border-radius: 7px; background: var(--nav-active-bg); box-shadow: var(--nav-active-shadow); opacity: 0; transform: translateX(var(--thumb-x, 0px)); pointer-events: none; }
[data-ready] > .canvas-panel-thumb[data-shown] { opacity: 1; }
[data-ready] > .canvas-panel-thumb { transition: transform var(--t2) var(--e), width var(--t2) var(--e), opacity var(--t1) var(--e); }
.canvas-panel-switch > button[data-updated]::after { content: ""; position: absolute; top: 3px; right: 4px; width: 6px; height: 6px; border-radius: 50%; background: var(--a); animation: panel-updated var(--t2) var(--e-out); }
@keyframes panel-updated { from { opacity: 0; transform: scale(.4); } }

@media (max-width: 1079px) {
  .canvas-panel-switch { height: 40px; }
  .canvas-panel-switch > button { height: 32px; }
}
/* The narrowest phones keep the icons, a size up since they stand alone; the label stays for assistive technology. */
@media (max-width: 360px) {
  .canvas-panel-switch > button { min-width: 44px; padding-inline: 0; --ico: var(--ico-lg); }
  :is(.canvas-panel-label, .canvas-panel-meta) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
@media (prefers-reduced-motion: reduce) {
  [data-ready] > .canvas-panel-thumb { transition: opacity var(--t1) var(--e); }
  .canvas-panel-switch > button[data-updated]::after { animation: none; }
}
</style>
