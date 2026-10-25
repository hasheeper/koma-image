<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { menuKeys } from "../shared/popover";

/** A menu under the window's head, or above the composer (`up`), in the site's conv-menu language. */
const props = defineProps<{ id: string; label: string; side: "left" | "right" | "up"; escape?: () => boolean }>();
const emit = defineEmits<{ closed: [] }>();
defineSlots<{
  trigger(props: { open: boolean; toggle: () => void }): unknown;
  default(props: { close: (refocus?: boolean) => void }): unknown;
}>();
const ask = useAsk();
const open = shallowRef(false), wrap = shallowRef<HTMLElement | null>(null), menu = shallowRef<HTMLElement | null>(null);
function close(refocus = false) {
  if (!open.value) return;
  open.value = false;
  emit("closed");
  if (refocus) wrap.value?.querySelector<HTMLElement>("[aria-haspopup]")?.focus({ preventScroll: true });
}
async function toggle() {
  if (open.value) return close();
  open.value = true;
  await nextTick();
  menu.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
}
// The drawer's Esc order: an open menu closes before drafts and the window.
let stopLayer = () => {};
function escape() {
  if (!open.value) return false;
  if (!props.escape?.()) close(true);
  return true;
}
function outside(event: PointerEvent) {
  if (!wrap.value?.contains(event.target as Node)) close();
}
watch(open, (on) => {
  stopLayer();
  if (on) stopLayer = ask.layer(escape);
  if (on) document.addEventListener("pointerdown", outside, true);
  else document.removeEventListener("pointerdown", outside, true);
});
watch(ask.visible, (visible) => { if (!visible) close(); });
onBeforeUnmount(() => {
  stopLayer();
  document.removeEventListener("pointerdown", outside, true);
});
</script>
<template>
  <span ref="wrap" class="ask-menu-host">
    <slot name="trigger" :open="open" :toggle="toggle" />
    <div v-if="open" :id="props.id" ref="menu" class="ask-menu" :class="props.side" role="menu" :aria-label="props.label" @keydown="menuKeys" @keydown.tab.prevent="close(true)">
      <slot :close="close" />
    </div>
  </span>
</template>
<style scoped>
.ask-menu-host { display: contents; }
.ask-menu { position: absolute; top: 40px; z-index: 5; display: flex; flex-direction: column; gap: 1px; min-width: 216px; max-height: calc(100% - 48px); padding: 4px; color: var(--fg); background: color-mix(in srgb, var(--raised) 97%, transparent); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--sh-3), var(--sh-lip); backdrop-filter: blur(16px); animation: ask-menu-in var(--t1) var(--e-out); }
.ask-menu.right { right: 8px; }
.ask-menu.left { left: 8px; width: min(300px, calc(100% - 16px)); }
/* Anchored to the dock: it rises over the stream, right-aligned with the composer. */
.ask-menu.up { top: auto; right: 0; bottom: calc(100% + 6px); max-width: 100%; max-height: min(360px, 60dvh); overflow-y: auto; }
.ask-menu :deep(.ask-menu-item) { display: flex; flex: none; align-items: center; gap: 10px; min-width: 0; min-height: 32px; padding: 0 10px; color: var(--fg-2); font-size: var(--fz-sm); text-align: left; border-radius: var(--r1); }
.ask-menu :deep(.ask-menu-item :is(.ico, .vl)) { flex: none; width: var(--ico-md); height: var(--ico-md); color: var(--fg-3); }
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
@media (max-width: 860px) { .ask-menu :deep(.ask-menu-item) { min-height: 40px; } }
@keyframes ask-menu-in { from { opacity: 0; transform: translateY(-3px) scale(.99); } }
@media (prefers-reduced-motion: reduce) { .ask-menu { animation: none; } }
</style>
