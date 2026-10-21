<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import AskMark from "./AskMark.vue";
import AskStream from "./AskStream.vue";
import AskComposer from "./AskComposer.vue";
import DraftCard from "./DraftCard.vue";

const ask = useAsk();
const root = shallowRef<HTMLElement | null>(null),
  composer = shallowRef<InstanceType<typeof AskComposer> | null>(null);
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
      if (returnFocus?.isConnected && returnFocus.getClientRects().length)
        returnFocus.focus({ preventScroll: true });
      else active.blur();
    }
  },
  { flush: "post" },
);
onBeforeUnmount(() => ask.attach(null));
</script>
<template>
  <Transition name="ask">
    <aside
      v-show="ask.visible.value"
      id="askDrawer"
      ref="root"
      class="ask"
      :class="{ 'ask-inline': !!ask.inline.value }"
      aria-label="Koma ASK"
    >
      <header class="ask-head">
        <AskMark :thinking="ask.running.value" />
        <span class="ask-brand">Koma</span><span class="ask-tag">ASK</span>
        <span class="ask-space"></span>
        <button v-if="ask.inline.value" class="btn btn-quiet btn-xs" type="button" @click="ask.expand()">展开</button>
        <span v-if="spent" class="ask-spent" :title="spent.title">{{ spent.label }} tokens</span>
        <button class="ibtn" type="button" aria-label="ASK 设置" @click="ask.openSettings()">
          <AppIcon name="i-settings" />
        </button>
        <button class="ibtn" type="button" aria-label="关闭 ASK" @click="ask.hide()">
          <AppIcon name="i-close" />
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
    </aside>
  </Transition>
</template>
<style scoped>
/* Full-height over the right rail and top bar; modal dialogs stay above it. */
.ask { position: fixed; top: 0; right: 0; bottom: 0; z-index: var(--z-drawer); display: flex; flex-direction: column; width: min(460px, 100vw); background: var(--chrome); border-left: 1px solid var(--line); box-shadow: -30px 0 60px rgba(0, 0, 0, .45); }
.ask-head { display: flex; flex: none; align-items: center; gap: 8px; height: 54px; padding: 0 10px 0 24px; }
.ask-brand { margin-left: 2px; color: var(--fg); font: var(--fw-bold) var(--fz-md)/1 var(--brand); }
.ask-tag { color: var(--fg-4); font: var(--fw-semibold) var(--fz-2xs)/1 var(--sans); letter-spacing: .14em; }
.ask-space { flex: 1; }
.ask-spent { margin-right: 4px; color: var(--fg-4); font: var(--fw-regular) var(--fz-2xs)/1 var(--mono); }
.ask-bottom { display: flex; flex: 0 1 auto; flex-direction: column; min-height: 0; max-height: calc(100% - 108px); padding: 0 14px 14px; }
.ask-bottom :deep(.ask-dock) { flex: none; }
.ask-enter-active, .ask-leave-active { transition: opacity var(--t2) var(--e), transform var(--t3) var(--e-out); }
.ask-enter-from, .ask-leave-to { opacity: 0; transform: translateX(16px); }
@media (max-width: 860px) {
  .ask { top: auto; left: 0; width: auto; height: min(78dvh, 640px); border-top: 1px solid var(--line-2); border-left: 0; border-radius: 20px 20px 0 0; box-shadow: 0 -20px 50px rgba(0, 0, 0, .5); }
  .ask-head { padding-left: 20px; }
  .ask-bottom { padding: 0 8px calc(8px + env(safe-area-inset-bottom)); }
  .ask-enter-from, .ask-leave-to { transform: translateY(24px); }
}
.ask.ask-inline { inset: auto; top: var(--ask-inline-top, 80px); left: var(--ask-inline-left, 8px); width: min(480px, calc(100vw - 16px)); height: min(560px, calc(100dvh - 96px)); border: 1px solid var(--line-2); border-radius: 20px; box-shadow: var(--sh-2); }
@media (max-width: 400px) {
  .ask-inline .ask-brand, .ask-inline .ask-spent { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ask-enter-active, .ask-leave-active { transition: opacity var(--t1) linear; }
  .ask-enter-from, .ask-leave-to { transform: none; }
}
</style>
