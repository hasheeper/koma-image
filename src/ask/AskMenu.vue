<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, shallowRef, watch } from "vue";
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
  el.dataset.placement = y < anchor.top ? "top" : "bottom";
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
onDeactivated(() => close());
watch(ask.visible, visible => { if (!visible) close(); });
onBeforeUnmount(() => { close(); stopLayer(); sizeObserver.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', resized); window.visualViewport?.removeEventListener('resize', resized); });
</script>
<template>
  <span ref="wrap" class="ask-menu-host" :class="{ 'conversation-menu': side === 'left' }">
    <slot name="trigger" :open="open" :toggle="toggle" />
    <div v-if="open" :id="id" ref="menu" class="menu ask-menu" :class="side" popover="auto" role="menu" :aria-label="label" @toggle="toggled" @keydown="keys"><slot :close="close" /></div>
  </span>
</template>
<style scoped>
.ask-menu-host { position: relative; display: inline-flex; flex: 0 1 auto; align-items: center; min-width: 0; }
.ask-menu { width: max-content; min-width: 156px; max-width: min(224px, calc(100vw - 16px)); }
.ask-menu.left { width: 300px; max-width: calc(100vw - 32px); }
/* ASK B v5 geometry is an approved exception: rows stay 32px on touch like the rest of the window. */
@media (pointer: coarse), (max-width: 860px) { .ask-menu :deep(.menu-item) { min-height: 32px; font-size: var(--fz-sm); } }
</style>
