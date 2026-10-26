<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, useId, watch } from "vue";
import AppIcon from "../../shared/AppIcon.vue";
import { menuKeys, placeMenu } from "../../shared/popover";
const props = defineProps<{
  id: string; label: string; caption?: string; title?: string; value: string; display?: string; disabled?: boolean;
  variant?: "model";
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
}>();
const emit = defineEmits<{ change: [value: string] }>();
const button = ref<HTMLButtonElement>(), menu = ref<HTMLElement>(), expanded = ref(false);
const menuId = `nai-choice-${useId()}`;
const selected = computed(() => props.options.find(o => o.value === props.value)?.label ?? props.value);
let keyboard = false;
function close() { menu.value?.hidePopover(); }
function outsideScroll(event: Event) { if (!menu.value?.contains(event.target as Node)) close(); }
function cleanup() { window.removeEventListener("resize", close); window.removeEventListener("scroll", outsideScroll, true); }
function beforeToggle(event: ToggleEvent) {
  expanded.value = event.newState === "open";
  if (!expanded.value || !menu.value || !button.value) return;
  menu.value.style.display = "grid";
  position();
  menu.value.style.removeProperty("display");
}
function position() {
  if (!menu.value || !button.value) return;
  const el = menu.value, anchor = button.value.getBoundingClientRect();
  if (props.variant === "model") el.style.width = `${button.value.closest('.model-row')!.getBoundingClientRect().width}px`;
  placeMenu(el, anchor);
  el.style.left = `${Math.max(8, Math.min(anchor.left, document.documentElement.clientWidth - el.offsetWidth - 8))}px`;
}
function focusChoice() {
  (menu.value?.querySelector<HTMLButtonElement>('button[aria-checked="true"]:not(:disabled)') ?? menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
}
function toggle() {
  expanded.value = !!menu.value?.matches(":popover-open"); cleanup();
  if (!expanded.value) return;
  position();
  if (keyboard) focusChoice();
  window.addEventListener("resize", close); window.addEventListener("scroll", outsideScroll, true);
}
function choose(value: string) { emit("change", value); close(); button.value?.focus({ preventScroll: true }); }
function keys(event: KeyboardEvent) {
  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
    close(); button.value?.focus({ preventScroll: true });
  } else menuKeys(event);
}
function openKeys(event: KeyboardEvent) {
  keyboard = true;
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    if (!expanded.value) menu.value?.showPopover();
    focusChoice();
  }
}
watch(() => props.value, close);
onDeactivated(() => { close(); cleanup(); }); onBeforeUnmount(cleanup);
</script>
<template>
  <button :id="id" ref="button" type="button" class="nai-trigger" :class="[variant && `choice-${variant}`, { chosen: value !== 'none' }]" :data-value="value" :disabled="disabled" :popovertarget="menuId" aria-haspopup="menu" :aria-controls="menuId" :aria-expanded="expanded" :aria-label="`${label}：${selected}`" :title="title" @pointerdown="keyboard = false" @keydown="openKeys">
    <slot /><span v-if="caption" class="choice-caption">{{ caption }}</span><span v-if="!caption || value !== 'none'" class="choice-value">{{ display ?? selected }}</span><AppIcon name="i-chevron" class="choice-caret" />
  </button>
  <div :id="menuId" ref="menu" popover="auto" class="menu nai-menu" role="menu" :aria-label="label" @beforetoggle="beforeToggle" @toggle="toggle" @keydown="keys">
    <template v-for="(option, index) in options" :key="option.value">
      <button type="button" role="menuitemradio" tabindex="-1" class="menu-item" :data-value="option.value" :aria-checked="option.value === value" :disabled="option.disabled" :title="option.title" @click="choose(option.value)"><span class="menu-label">{{ option.label }}</span><AppIcon name="i-check" class="menu-check" /></button>
      <hr v-if="option.value === 'none' && index < options.length - 1" />
    </template>
  </div>
</template>
<style scoped>
.nai-trigger { display: inline-flex; align-items: center; justify-content: center; flex: none; gap: 4px; height: 28px; padding: 0 4px; color: var(--fg-3); border-radius: var(--r1); font-size: var(--fz-xs); white-space: nowrap; transition: background var(--t1) var(--e), color var(--t1) var(--e); }
.nai-trigger:is(:hover, [aria-expanded="true"]):not(:disabled) { background: var(--hover); color: var(--fg); }
.nai-trigger:disabled { opacity: .5; cursor: default; }
.choice-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--fg); font-weight: var(--fw-semibold); }
.choice-caption { font-weight: var(--fw-medium); }
.choice-caret { flex: none; --ico: var(--ico-xs); color: var(--fg-4); transform: rotate(90deg); transition: transform var(--t1) var(--e); }
.nai-trigger[aria-expanded="true"] .choice-caret { transform: rotate(-90deg); }
.nai-trigger:focus-visible { outline: none; background: var(--hover); box-shadow: inset 0 0 0 1px var(--fg-3); }
.nai-trigger:hover .choice-caret { color: var(--fg-2); }
.choice-model { flex: 1; justify-content: flex-start; min-width: 0; height: 30px; padding: 0 8px; border-radius: 7px; font-size: var(--fz-sm); }
.nai-menu { width: 168px; max-width: calc(100vw - 16px); }
@media (pointer: coarse), (max-width: 860px) { .choice-model { height: 36px; } }
</style>
