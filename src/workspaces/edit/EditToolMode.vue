<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from "vue";
import AppIcon from "../../shared/AppIcon.vue";
import { menuKeys, placeMenu } from "../../shared/popover";

const props = defineProps<{
  id: string; label: string; ariaLabel?: string; icon: string; active: boolean; disabled: boolean;
  menuLabel: string; value: string; controls?: string; title?: string;
  options: { value: string; label: string; icon: string; disabled?: boolean }[];
}>();
const emit = defineEmits<{ toggle: []; select: [value: string] }>();
const trigger = shallowRef<HTMLButtonElement>(), menu = shallowRef<HTMLElement>();
const expanded = shallowRef(false);
let events: AbortController | undefined;
let keyboard = false;

function place() {
  if (!trigger.value || !menu.value) return;
  menu.value.style.width = `${Math.min(176, document.documentElement.clientWidth - 16)}px`;
  placeMenu(menu.value, trigger.value.getBoundingClientRect());
}
function close(restoreFocus = false) {
  menu.value?.hidePopover();
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function beforeToggle(e: ToggleEvent) {
  expanded.value = e.newState === "open";
  if (e.newState !== "open" || !menu.value) return;
  menu.value.style.display = "flex";
  place();
  menu.value.style.removeProperty("display");
}
function toggled(e: Event) {
  const open = (e as ToggleEvent).newState === "open";
  events?.abort(); events = undefined;
  if (!open) return;
  place();
  if (keyboard && document.activeElement === trigger.value) focusChoice();
  events = new AbortController();
  window.addEventListener("resize", place, { signal: events.signal });
  document.addEventListener("scroll", place, { capture: true, passive: true, signal: events.signal });
}
function focusChoice() {
  (menu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)') ?? menu.value?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
}
function triggerKey(e: KeyboardEvent) {
  keyboard = true;
  if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  if (props.disabled) return;
  menu.value?.showPopover(); place(); focusChoice();
}
function menuKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault(); e.stopPropagation(); close(true); return;
  }
  if (e.key === "Tab") { close(true); return; }
  menuKeys(e);
}
function choose(value: string) { close(true); emit("select", value); }
watch(() => props.disabled, disabled => { if (disabled) close(); });
onBeforeUnmount(() => { close(); events?.abort(); });
defineExpose({ close });
</script>

<template>
  <div class="editor-tool-mode" :data-active="active">
    <button :id="id" class="editor-tool editor-tool-main" type="button" :aria-label="ariaLabel ?? label" :data-tip="title ?? ariaLabel ?? label" :aria-pressed="active" :aria-controls="controls" :popovertarget="controls" :aria-expanded="controls ? active : undefined" :disabled="disabled" @click="!controls && emit('toggle')">
      <AppIcon :name="icon" />
    </button>
    <button ref="trigger" :id="`${id}Toggle`" class="editor-tool editor-tool-arrow" type="button" :aria-label="`选择${menuLabel}`" aria-haspopup="menu" :popovertarget="`${id}Menu`" :aria-controls="`${id}Menu`" :aria-expanded="expanded" :disabled="disabled" @pointerdown="keyboard = false" @keydown="triggerKey"><AppIcon name="i-chevron" class="editor-caret" /></button>
    <div ref="menu" :id="`${id}Menu`" class="menu editor-tool-menu" popover role="menu" :aria-label="menuLabel" @beforetoggle="beforeToggle" @toggle="toggled" @keydown="menuKey">
      <button v-for="option in options" :key="option.value" type="button" tabindex="-1" class="menu-item" role="menuitemradio" :aria-checked="value === option.value" :disabled="disabled || option.disabled" @click="choose(option.value)">
        <AppIcon :name="option.icon" /><span class="menu-label">{{ option.label }}</span><AppIcon class="menu-check" name="i-check" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor-tool-mode { display: inline-grid; grid-template-columns: 32px 14px; flex: none; align-items: stretch; border-radius: var(--r2); }
.editor-tool-mode > .editor-tool-main { justify-content: center; padding: 0; border-radius: var(--r2) 0 0 var(--r2); }
.editor-tool-mode > .editor-tool-arrow { width: 100%; padding: 0; justify-content: center; border-radius: 0 var(--r2) var(--r2) 0; }
.editor-tool-mode[data-active="true"] > .editor-tool-arrow { color: var(--a); background: var(--a-dim); }
@media (max-width: 860px) { .editor-tool-mode { grid-template-columns: 40px 18px; } }
</style>
