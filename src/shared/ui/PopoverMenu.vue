<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, shallowRef } from "vue";
import { menuKeys } from "../popover";
import { usePopover } from "./use-popover";
const props = defineProps<{ id: string; label: string; side: "left" | "right" | "up"; escape?: () => boolean; compact?: boolean; menuClass?: string }>();
const emit = defineEmits<{ closed: []; opened: [] }>();
defineSlots<{ trigger(props: { open: boolean; toggle: () => void }): unknown; default(props: { close: (refocus?: boolean) => void }): unknown }>();
const visible = shallowRef(false), wrap = shallowRef<HTMLElement>(), menu = shallowRef<HTMLElement>();
let revision = 0;
function place() {
  const el = menu.value, anchor = wrap.value?.getBoundingClientRect(); if (!el || !anchor) return;
  const box = el.getBoundingClientRect(), gap = 4, edge = 8;
  const x = props.side === 'right' ? anchor.right - box.width : anchor.left;
  let y = props.side === 'up' ? anchor.top - gap - box.height : anchor.bottom + gap;
  if (y < edge) y = anchor.bottom + gap;
  else if (y + box.height > innerHeight - edge && anchor.top - gap - box.height >= edge) y = anchor.top - gap - box.height;
  el.style.left = `${Math.max(edge, Math.min(x, innerWidth - box.width - edge))}px`;
  el.style.top = `${Math.max(edge, Math.min(y, innerHeight - box.height - edge))}px`;
  el.dataset.placement = y < anchor.top ? "top" : "bottom";
}
function closed() {
  revision++;
  document.removeEventListener('pointerdown', outside, true);
  if (!visible.value) return;
  visible.value = false; emit('closed');
}
const popover = usePopover(menu, {
  position: place, resize: "place", observe: () => [menu.value, wrap.value],
  visualViewport: true, afterResizeFrame: true,
  onOpen() { menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }); },
  onClose: closed,
});
function close(refocus = false) {
  const wasVisible = visible.value;
  popover.close(); closed();
  if (wasVisible && refocus) wrap.value?.querySelector<HTMLElement>("[aria-haspopup]")?.focus({ preventScroll: true });
}
async function toggle() {
  if (visible.value) return close();
  const current = ++revision;
  visible.value = true;
  await nextTick();
  if (current !== revision || !visible.value || !menu.value) return;
  menu.value.showPopover();
  document.addEventListener('pointerdown', outside, true);
  emit('opened');
}
function escape() { if (!visible.value) return false; if (!props.escape?.()) close(true); return true; }
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); escape(); }
  else if (event.key === 'Tab') { event.preventDefault(); close(true); }
  else menuKeys(event);
}
function outside(event: PointerEvent) { if (!wrap.value?.contains(event.target as Node)) close(); }
onDeactivated(() => close());
onBeforeUnmount(() => close());
defineExpose({ close, escape });
</script>
<template>
  <span ref="wrap" class="popover-menu-host">
    <slot name="trigger" :open="visible" :toggle="toggle" />
    <div v-if="visible" :id="id" ref="menu" class="menu popover-menu" :class="[side, menuClass, { compact }]" popover="auto" role="menu" :aria-label="label" @beforetoggle="popover.beforeToggle" @toggle="popover.toggled" @keydown="keys"><slot :close="close" /></div>
  </span>
</template>
<style scoped>
.popover-menu-host { position: relative; display: inline-flex; flex: 0 1 auto; align-items: center; min-width: 0; }
.popover-menu { width: max-content; min-width: 156px; max-width: min(224px, calc(100vw - 16px)); }
.popover-menu.left { width: 300px; max-width: calc(100vw - 32px); }
/* The existing ASK and task menus retain their approved compact touch rows. */
@media (pointer: coarse), (max-width: 860px) { .popover-menu.compact :deep(.menu-item) { min-height: 32px; font-size: var(--fz-sm); } }
</style>
