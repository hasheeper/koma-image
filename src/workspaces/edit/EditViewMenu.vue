<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from "vue";
import AppIcon from "../../shared/AppIcon.vue";
import { menuKeys } from "../../shared/popover";
import { placeEditorPanel } from "./panels";

// The menu stays in the DOM: the canvas driver writes #editorZoomValue and #editorHand from mount.
const emit = defineEmits<{ step: [direction: 1 | -1]; fit: []; actual: []; hand: [] }>();
const trigger = shallowRef<HTMLButtonElement>(), menu = shallowRef<HTMLElement>();
const expanded = shallowRef(false);
let events: AbortController | undefined;
let keyboard = false;

function place() {
  if (!trigger.value || !menu.value) return;
  menu.value.style.width = `${Math.min(196, document.documentElement.clientWidth - 16)}px`;
  placeEditorPanel(menu.value, trigger.value);
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
  events?.abort(); events = undefined;
  if ((e as ToggleEvent).newState !== "open") return;
  place();
  if (keyboard && document.activeElement === trigger.value) focusFirst();
  events = new AbortController();
  const sizing = new ResizeObserver(place);
  sizing.observe(menu.value!);
  events.signal.addEventListener("abort", () => sizing.disconnect(), { once: true });
  window.addEventListener("resize", place, { signal: events.signal });
}
function focusFirst() { menu.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true }); }
function triggerKey(e: KeyboardEvent) {
  keyboard = true;
  if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  menu.value?.showPopover(); place(); focusFirst();
}
function menuKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
  if (e.key === "Tab") { close(true); return; }
  menuKeys(e);
}
// Stepping keeps the menu open for repeated clicks; the other choices finish the visit.
function run(action: () => void, keepOpen = false) { action(); if (!keepOpen) close(true); }
onBeforeUnmount(() => { close(); events?.abort(); });
defineExpose({ close });
</script>

<template>
  <div class="editor-tool-group editor-view-tools" role="group" aria-label="视图控制">
    <button ref="trigger" class="editor-zoom editor-view-trigger mono" type="button" aria-label="视图缩放" data-tip="缩放与平移" aria-haspopup="menu" popovertarget="editorViewMenu" aria-controls="editorViewMenu" :aria-expanded="expanded" @pointerdown="keyboard = false" @keydown="triggerKey">
      <AppIcon class="editor-view-hand" name="i-hand" /><span id="editorZoomValue">100%</span><AppIcon class="editor-caret" name="i-chevron" />
    </button>
    <div ref="menu" id="editorViewMenu" class="menu editor-flyout editor-view-menu" popover role="menu" aria-label="视图控制" @beforetoggle="beforeToggle" @toggle="toggled" @keydown="menuKey">
      <button type="button" tabindex="-1" class="menu-item" role="menuitem" aria-label="放大视图" @click="run(() => emit('step', 1), true)"><AppIcon name="i-zoom-in" /><span class="menu-label">放大</span><span class="menu-meta">⌘ +</span></button>
      <button type="button" tabindex="-1" class="menu-item" role="menuitem" aria-label="缩小视图" @click="run(() => emit('step', -1), true)"><AppIcon name="i-zoom-out" /><span class="menu-label">缩小</span><span class="menu-meta">⌘ −</span></button>
      <button type="button" tabindex="-1" class="menu-item" role="menuitem" aria-label="适应窗口" @click="run(() => emit('fit'))"><AppIcon name="i-fit" /><span class="menu-label">适应窗口</span><span class="menu-meta">⌘ 0</span></button>
      <button type="button" tabindex="-1" class="menu-item" role="menuitem" aria-label="缩放到 100%" @click="run(() => emit('actual'))"><span class="editor-menu-actual mono" aria-hidden="true">1:1</span><span class="menu-label">原始大小</span><span class="menu-meta">⌘ 1</span></button>
      <div class="editor-menu-separator" role="separator"></div>
      <button id="editorHand" type="button" tabindex="-1" class="menu-item" role="menuitemcheckbox" aria-checked="false" aria-label="平移" @click="run(() => emit('hand'))"><AppIcon name="i-hand" /><span class="menu-label">平移</span><span class="menu-meta">H / 空格</span></button>
    </div>
  </div>
</template>

<style scoped>
.editor-view-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 3px; padding: 0 6px 0 10px; }
.editor-view-trigger .editor-caret { --ico: var(--ico-xs); flex: none; color: var(--fg-3); transform: rotate(-90deg); }
.editor-view-trigger[aria-expanded="true"] { color: var(--a); background: var(--a-dim); }
.editor-view-trigger[aria-expanded="true"] .editor-caret { color: var(--a); transform: rotate(90deg); }
.editor-view-hand { --ico: var(--ico-sm); display: none; color: var(--a); }
.editor-view-tools:has(#editorHand[aria-checked="true"]) .editor-view-hand { display: inline-block; }
.editor-view-menu .menu-item[aria-checked="true"] { color: var(--a); background: var(--a-dim); }
.editor-view-menu .menu-item[aria-checked="true"] > .ico { color: currentColor; }
</style>
