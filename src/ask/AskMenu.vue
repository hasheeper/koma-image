<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { menuKeys } from "../shared/popover";
const props = defineProps<{ id: string; label: string; side: "left" | "right" | "up"; escape?: () => boolean }>();
const emit = defineEmits<{ closed: [] }>();
defineSlots<{ trigger(props: { open: boolean; toggle: () => void }): unknown; default(props: { close: (refocus?: boolean) => void }): unknown }>();
const ask = useAsk(), open = shallowRef(false), wrap = shallowRef<HTMLElement | null>(null), menu = shallowRef<HTMLElement | null>(null);
let stopLayer = () => {};
let frame = 0;
const sizeObserver = new ResizeObserver(place);
function close(refocus = false) {
  if (!open.value) return;
  menu.value?.hidePopover(); open.value = false; emit("closed");
  if (refocus) wrap.value?.querySelector<HTMLElement>("[aria-haspopup]")?.focus({ preventScroll: true });
}
function place() {
  const el = menu.value, anchor = wrap.value?.getBoundingClientRect(); if (!el || !anchor) return;
  const box = el.getBoundingClientRect(), gap = 4, edge = 8;
  let x = props.side === 'right' ? anchor.right - box.width : anchor.left;
  let y = props.side === 'up' ? anchor.top - gap - box.height : anchor.bottom + gap;
  if (y < edge) y = anchor.bottom + gap;
  else if (y + box.height > innerHeight - edge && anchor.top - gap - box.height >= edge) y = anchor.top - gap - box.height;
  el.style.left = `${Math.max(edge, Math.min(x, innerWidth - box.width - edge))}px`;
  el.style.top = `${Math.max(edge, Math.min(y, innerHeight - box.height - edge))}px`;
}
function resized() {
  place();
  cancelAnimationFrame(frame);
  // The native ASK driver also repositions its surface in this resize frame.
  frame = requestAnimationFrame(() => { frame = 0; place(); });
}
async function toggle() {
  if (open.value) return close();
  open.value = true; await nextTick();
  if (!open.value || !menu.value) return;
  menu.value?.showPopover(); place();
  sizeObserver.observe(menu.value);
  if (wrap.value) sizeObserver.observe(wrap.value);
  menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}
function escape() { if (!open.value) return false; if (!props.escape?.()) close(true); return true; }
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); escape(); }
  else if (event.key === 'Tab') { event.preventDefault(); close(true); }
  else menuKeys(event);
}
function toggled(event: ToggleEvent) { if (event.newState === 'closed') close(); }
function outside(event: PointerEvent) { if (!wrap.value?.contains(event.target as Node)) close(); }
watch(open, on => {
  stopLayer();
  if (on) { stopLayer = ask.layer(escape); document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', resized); window.visualViewport?.addEventListener('resize', resized); }
  else { sizeObserver.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', resized); window.visualViewport?.removeEventListener('resize', resized); }
});
watch(ask.visible, visible => { if (!visible) close(); });
onBeforeUnmount(() => { close(); stopLayer(); sizeObserver.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', resized); window.visualViewport?.removeEventListener('resize', resized); });
</script>
<template>
  <span ref="wrap" class="ask-menu-host" :class="{ 'conversation-menu': side === 'left' }">
    <slot name="trigger" :open="open" :toggle="toggle" />
    <div v-if="open" :id="id" ref="menu" class="ask-menu" :class="side" popover="auto" role="menu" :aria-label="label" @toggle="toggled" @keydown="keys"><slot :close="close" /></div>
  </span>
</template>
<style scoped>
.ask-menu-host { position: relative; display: inline-flex; flex: 0 1 auto; align-items: center; min-width: 0; }
.ask-menu { position: fixed; inset: auto; z-index: 5; display: none; flex-direction: column; gap: 0; width: max-content; min-width: 156px; max-width: min(224px, calc(100vw - 16px)); max-height: min(360px, calc(100dvh - 32px)); margin: 0; overflow-y: auto; padding: 4px; color: var(--fg); background: var(--raised); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--sh-2), var(--sh-lip); transform-origin: top right; animation: ask-menu-in var(--t1) var(--e-out); }
.ask-menu:popover-open { display: flex; }
.ask-menu.left { width: 300px; max-width: calc(100vw - 32px); transform-origin: top left; }
.ask-menu.up { transform-origin: bottom left; animation-name: ask-menu-up; }
.ask-menu :deep(.ask-menu-item) { display: flex; flex: none; align-items: center; gap: 8px; min-width: 0; min-height: 32px; padding: 0 8px; color: var(--fg-2); font-size: 12px; text-align: left; border-radius: var(--r1); }
.ask-menu :deep(.ask-menu-item :is(.ico, .vl)) { flex: none; width: var(--ico-sm); height: var(--ico-sm); color: var(--fg-3); }
.ask-menu :deep(.ask-menu-item:is(:hover, :focus-visible):not(:disabled)) { color: var(--fg); background: var(--hover); outline: none; }
.ask-menu :deep(.ask-menu-item:is(:hover, :focus-visible):not(:disabled) :is(.ico, .vl)) { color: currentColor; }
.ask-menu :deep(.ask-menu-item:disabled) { color: var(--fg-4); cursor: default; }
.ask-menu :deep(.ask-menu-label) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-menu :deep(.ask-menu-item small) { color: var(--fg-3); font-size: var(--fz-xs); font-variant-numeric: tabular-nums; }
.ask-menu :deep(.ask-menu-check) { visibility: hidden; }
.ask-menu :deep(.ask-menu-item[aria-checked="true"]) { color: var(--fg); }
.ask-menu :deep(.ask-menu-item[aria-checked="true"] .ask-menu-check) { visibility: visible; color: var(--a); }
.ask-menu :deep(.ask-menu-group) { flex: none; padding: 8px 10px 4px; overflow: hidden; color: var(--fg-4); font-size: var(--fz-2xs); text-overflow: ellipsis; white-space: nowrap; }
.ask-menu :deep(hr) { flex: none; margin: 4px 6px; border: 0; border-top: 1px solid var(--line); }

@keyframes ask-menu-up { from { opacity: 0; transform: translateY(3px) scale(.985); } }
@keyframes ask-menu-in { from { opacity: 0; transform: translateY(-3px) scale(.99); } }
@media (prefers-reduced-motion: reduce) { .ask-menu { animation: none; } }
</style>
