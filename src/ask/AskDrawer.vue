<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { useShell } from "../app/shell";
import { installAskWindow } from "../native/ask-window";
import AppIcon from "../shared/AppIcon.vue";
import AskMark from "./AskMark.vue";
import AskStream from "./AskStream.vue";
import AskComposer from "./AskComposer.vue";
import DraftCard from "./DraftCard.vue";

const ask = useAsk();
const { router } = useShell();
const root = shallowRef<HTMLElement | null>(null),
  handle = shallowRef<HTMLElement | null>(null),
  launcher = shallowRef<HTMLButtonElement | null>(null),
  expanded = shallowRef(false),
  composer = shallowRef<InstanceType<typeof AskComposer> | null>(null);
const controller = new AbortController();
let place = () => {};
let normalPosition: { left: string; top: string } | undefined;
function toggleSize() {
  if (!root.value) return;
  if (!expanded.value) {
    normalPosition = { left: root.value.style.getPropertyValue('--ask-left'), top: root.value.style.getPropertyValue('--ask-top') };
  } else if (normalPosition) {
    root.value.style.setProperty('--ask-left', normalPosition.left);
    root.value.style.setProperty('--ask-top', normalPosition.top);
  }
  expanded.value = !expanded.value;
}
onMounted(() => {
  if (root.value && handle.value && launcher.value)
    place = installAskWindow(root.value, handle.value, launcher.value, controller.signal);
});
watch([ask.visible, ask.inline, expanded], () => void nextTick(place), { flush: "post" });
const spent = computed(() => {
  const u = ask.usage.value,
    total = u.input + u.output;
  return total
    ? {
        label: total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total),
        title: `本页 ASK 共用 ${total} tokens：输入 ${u.input}（缓存命中 ${u.cacheRead}）、输出 ${u.output}`,
      }
    : null;
});
let returnFocus: HTMLElement | null = null;
watch(root, (element) => ask.attach(element));
// Non-modal: focus moves in on open and goes back where it came from on close.
watch(
  [ask.visible, ask.inline],
  async ([visible]) => {
    const active = document.activeElement;
    if (visible) {
      if (active instanceof HTMLElement && active !== document.body && !root.value?.contains(active)) returnFocus = active;
      await nextTick();
      composer.value?.focus();
    } else if (active instanceof HTMLElement && root.value?.contains(active)) {
      await nextTick();
      if (ask.visible.value || document.querySelector('dialog:modal')) return;
      if (returnFocus?.isConnected && returnFocus.getClientRects().length)
        returnFocus.focus({ preventScroll: true });
      else if (launcher.value?.getClientRects().length) launcher.value.focus({ preventScroll: true });
      else active.blur();
    }
  },
  { flush: "pre" },
);
onBeforeUnmount(() => { controller.abort(); ask.attach(null); });
</script>
<template>
  <button
    v-show="!ask.visible.value && router.route.value.overlay !== 'editor'"
    id="askLauncher"
    ref="launcher"
    class="ask-launcher"
    :class="{ 'is-thinking': ask.running.value }"
    type="button"
    aria-label="打开 Koma ASK"
    aria-controls="askDrawer"
    aria-describedby="askMoveHint"
    :aria-expanded="ask.visible.value"
    title="Koma ASK · 可拖动 · ⌘J / Ctrl+J"
    @click="ask.show()"
  >
    <AskMark :thinking="ask.running.value" />
    <span class="ask-launcher-label">ASK</span>
  </button>
  <Transition name="ask">
    <aside
      v-show="ask.visible.value"
      id="askDrawer"
      ref="root"
      class="ask"
      :class="{ 'ask-inline': !!ask.inline.value, 'ask-expanded': expanded && !ask.inline.value }"
      role="dialog"
      aria-modal="false"
      aria-label="Koma ASK"
    >
      <header class="ask-head">
        <div ref="handle" class="ask-handle" :tabindex="ask.inline.value ? -1 : 0" role="group" aria-label="移动 ASK 窗口" aria-describedby="askMoveHint" @dblclick="!ask.inline.value && toggleSize()">
          <AskMark :thinking="ask.running.value" />
          <span class="ask-brand">Koma</span><span class="ask-tag">ASK</span>
        </div>
        <button v-if="ask.inline.value" class="btn btn-quiet btn-xs" type="button" @click="ask.expand()">展开</button>
        <span v-if="spent" class="ask-spent" :title="spent.title">{{ spent.label }} tokens</span>
        <button v-if="!ask.inline.value" class="ibtn" type="button" :aria-label="expanded ? '还原 ASK 窗口' : '放大 ASK 窗口'" @click="toggleSize()">
          <AppIcon :name="expanded ? 'i-compare' : 'i-fit'" />
        </button>
        <button class="ibtn" type="button" aria-label="ASK 设置" @click="ask.openSettings()">
          <AppIcon name="i-settings" />
        </button>
        <button class="ibtn" type="button" aria-label="收起 ASK" @click="ask.hide()">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
      </header>
      <AskStream />
      <div class="ask-bottom">
        <DraftCard />
        <AskComposer ref="composer" />
      </div>
      <div class="sr-only" role="status" aria-live="polite">
        <span :key="ask.announce.value.id">{{ ask.announce.value.text }}</span>
      </div>
      <span id="askMoveHint" class="sr-only">拖动标题栏移动窗口；Alt 加方向键移动，Alt 加 Home 归位。</span>
    </aside>
  </Transition>
</template>
<style scoped>
.ask-launcher { position: fixed; top: var(--ask-top, auto); left: var(--ask-left, auto); right: 20px; bottom: calc(96px + env(safe-area-inset-bottom)); z-index: var(--z-drawer); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; width: 52px; height: 56px; color: var(--a); background: var(--chrome); border: 1px solid var(--a-line); border-radius: 19px; box-shadow: var(--sh-2), 0 0 0 4px var(--a-dim); touch-action: none; user-select: none; cursor: grab; transition-property: background-color; }
.ask-launcher :deep(.ask-mark) { width: 25px; height: 25px; }
.ask-launcher-label { font: var(--fw-semibold) 8px/1 var(--sans); letter-spacing: .12em; }
.ask-launcher:hover { background: var(--raised); }
.ask-launcher.is-thinking { animation: ask-breathe 2.4s ease-in-out infinite; }
/* Floating geometry stays outside workspace layout; dialogs remain above ASK. */
.ask { position: fixed; top: var(--ask-top, auto); left: var(--ask-left, auto); right: 20px; bottom: calc(88px + env(safe-area-inset-bottom)); z-index: var(--z-drawer); display: flex; flex-direction: column; width: min(460px, calc(100vw - 16px)); height: min(640px, calc(var(--ask-available-height, 100dvh) - 32px)); overflow: hidden; background: var(--chrome); border: 1px solid var(--line-2); border-radius: 22px; box-shadow: var(--sh-4); transition-property: none; }
.ask.ask-expanded { width: min(760px, calc(100vw - 16px)); height: calc(var(--ask-available-height, 100dvh) - 32px); }
.ask-head { display: flex; flex: none; align-items: center; gap: 4px; height: 54px; padding: 0 8px 0 16px; }
.ask-handle { display: flex; flex: 1; align-items: center; gap: 8px; align-self: stretch; touch-action: none; user-select: none; cursor: grab; }
.ask[data-dragging], .ask[data-dragging] .ask-handle, .ask-launcher[data-dragging] { cursor: grabbing; }
.ask-brand { margin-left: 2px; color: var(--fg); font: var(--fw-bold) var(--fz-md)/1 var(--brand); }
.ask-tag { color: var(--fg-4); font: var(--fw-semibold) var(--fz-2xs)/1 var(--sans); letter-spacing: .14em; }
.ask-spent { margin-right: 4px; color: var(--fg-4); font: var(--fw-regular) var(--fz-2xs)/1 var(--mono); }
.ask-bottom { display: flex; flex: 0 1 auto; flex-direction: column; min-height: 0; max-height: calc(100% - 108px); padding: 0 14px 14px; }
.ask-bottom :deep(.ask-dock) { flex: none; }
.ask-enter-active, .ask-leave-active { transition: opacity var(--t2) var(--e), transform var(--t2) var(--e-out); transform-origin: bottom right; }
.ask-enter-from, .ask-leave-to { opacity: 0; transform: translateY(8px) scale(.96); }
@media (max-width: 480px) {
  .ask { right: 8px; bottom: calc(76px + env(safe-area-inset-bottom)); height: min(560px, calc(var(--ask-available-height, 100dvh) - 32px)); border-radius: 20px; }
  .ask-head { padding-left: 12px; }
  .ask-launcher { right: 12px; width: 48px; height: 52px; }
  .ask-bottom { padding: 0 8px calc(8px + env(safe-area-inset-bottom)); }
}
.ask.ask-inline { inset: auto; top: var(--ask-inline-top, 80px); left: var(--ask-inline-left, 8px); width: min(480px, calc(100vw - 16px)); height: min(560px, calc(100dvh - 96px)); border: 1px solid var(--line-2); border-radius: 20px; box-shadow: var(--sh-2); }
@media (max-width: 400px) {
  .ask-spent { display: none; }
}
@keyframes ask-breathe { 50% { box-shadow: var(--sh-2), 0 0 0 7px var(--a-dim); } }
@media (prefers-reduced-motion: reduce) {
  .ask-launcher.is-thinking { animation: none; }
  .ask-enter-active, .ask-leave-active { transition: opacity var(--t1) linear; }
  .ask-enter-from, .ask-leave-to { transform: none; }
}
</style>
