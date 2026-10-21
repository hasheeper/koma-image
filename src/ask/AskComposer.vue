<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";

const ask = useAsk();
const field = shallowRef<HTMLTextAreaElement | null>(null),
  preferenceWrap = shallowRef<HTMLElement | null>(null),
  preferenceOpen = shallowRef(false);
const capsule = computed(() => ask.anchor.value ?? ask.current.value);
const limited = computed(() => !ask.settings.value.images);
const estimateLabel = computed(() => {
  const n = ask.estimate.value;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
});

function resize() {
  const el = field.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
function key(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void ask.send();
}
watch(ask.input, () => nextTick(resize));

// The preference preview is the drawer's one popover: Esc and outside clicks close it.
const stopLayer = ask.layer(() => {
  if (!preferenceOpen.value) return false;
  preferenceOpen.value = false;
  return true;
});
function outside(event: PointerEvent) {
  if (!preferenceWrap.value?.contains(event.target as Node)) preferenceOpen.value = false;
}
watch(preferenceOpen, (on) => {
  if (on) document.addEventListener("pointerdown", outside, true);
  else document.removeEventListener("pointerdown", outside, true);
});
watch(
  () => ask.settings.value.preference,
  (text) => {
    if (!text) preferenceOpen.value = false;
  },
);
onBeforeUnmount(() => {
  stopLayer();
  document.removeEventListener("pointerdown", outside, true);
});
defineExpose({
  focus() {
    field.value?.focus({ preventScroll: true });
  },
});
</script>
<template>
  <div class="ask-dock">
    <p v-if="ask.inline.value" class="ask-inline-target">{{ ask.inline.value.target === 'chat.composer' ? '对话输入框' : ask.inline.value.target === 'image.negative' ? 'Negative' : 'Prompt' }} · {{ ask.inline.value.text.length }} 字</p>
    <div v-if="ask.settings.value.preference" ref="preferenceWrap" class="ask-pref">
      <button
        class="ask-pref-chip"
        type="button"
        :aria-expanded="preferenceOpen"
        aria-controls="askPreferencePreview"
        :data-paused="ask.preferencePaused.value || undefined"
        @click="preferenceOpen = !preferenceOpen"
      >
        {{ ask.preferencePaused.value ? "个人偏好已停用" : "个人偏好已生效" }}
      </button>
      <div v-show="preferenceOpen" id="askPreferencePreview" class="ask-pref-pop">
        <p>{{ ask.settings.value.preference }}</p>
        <button class="btn btn-sm btn-quiet" type="button" @click="ask.togglePreference()">
          {{ ask.preferencePaused.value ? "恢复" : "本次停用" }}
        </button>
      </div>
    </div>
    <form class="ask-composer" :aria-busy="ask.running.value" @submit.prevent="ask.send()">
      <label class="sr-only" for="askPrompt">向 ASK 提问</label>
      <textarea
        id="askPrompt"
        ref="field"
        :value="ask.input.value"
        rows="1"
        maxlength="4000"
        placeholder="问这张图，或用 #h 引用历史…"
        :disabled="ask.ready.value === 'local'"
        @input="ask.setInput(($event.target as HTMLTextAreaElement).value)"
        @keydown="key"
      ></textarea>
      <p class="ask-notice" role="status">{{ ask.notice.value }}</p>
      <div class="ask-cbar">
        <span v-if="capsule" class="ask-capsule">
          <span class="ask-capsule-id">{{ capsule }}</span>
          <button
            v-if="ask.anchor.value"
            class="ask-capsule-clear"
            type="button"
            :aria-label="`取消引用 ${ask.anchor.value}`"
            @click="ask.clearAnchor()"
          >
            <AppIcon name="i-close" />
          </button>
        </span>
        <span v-if="limited" class="ask-limited" title="设置中已关闭发送图片，只提供元数据">仅元数据</span>
        <span class="ask-end">
          <span
            v-if="ask.estimate.value && !ask.running.value"
            class="ask-estimate"
            :title="`本轮输入约 ${ask.estimate.value} tokens`"
          >约 {{ estimateLabel }}</span>
          <button
            class="ask-model"
            type="button"
            :aria-label="`ASK 模型：${ask.settings.value.model || '未选择'}`"
            @click="ask.openSettings()"
          >
            <span class="ask-model-name">{{ ask.settings.value.model || "选择模型" }}</span>
          </button>
          <span class="ask-send-slot">
            <button
              class="btn btn-primary ask-send"
              type="submit"
              aria-label="发送"
              :hidden="ask.running.value"
              :disabled="ask.running.value || !ask.input.value.trim() || ask.ready.value === 'local'"
            >
              <AppIcon name="i-up" />
            </button>
            <button
              class="btn ask-stop"
              type="button"
              aria-label="停止"
              :hidden="!ask.running.value"
              @click="ask.stop()"
            >
              <AppIcon name="i-stop" />
            </button>
          </span>
        </span>
      </div>
    </form>
  </div>
</template>
<style scoped>
.ask-inline-target { padding: 0 10px 6px; color: var(--fg-3); font-size: var(--fz-xs); }
.ask-dock { position: relative; display: flex; flex-direction: column; gap: var(--sp-2); }
.ask-pref { position: relative; align-self: flex-start; }
.ask-pref-chip { height: 26px; padding: 0 10px; color: var(--fg-3); font-size: var(--fz-xs); background: var(--ask-layer, var(--raised)); border: 1px solid var(--line); border-radius: 999px; transition: color var(--t1) var(--e), background var(--t1) var(--e); }
.ask-pref-chip:hover, .ask-pref-chip[aria-expanded="true"] { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-pref-chip[data-paused] { color: var(--fg-4); text-decoration: line-through; }
.ask-pref-pop { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 1; display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2); width: min(360px, calc(100vw - 32px)); padding: var(--sp-3); color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.6; background: var(--ask-glass, var(--raised)); backdrop-filter: blur(20px) saturate(1.4); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--sh-2); }
.ask-pref-pop p { white-space: pre-wrap; overflow-wrap: anywhere; }
.ask-composer { padding: 8px 8px 6px 12px; background: var(--ask-layer, var(--raised)); border: 1px solid var(--line-2); border-radius: 20px; box-shadow: var(--sh-lip), 0 10px 32px -18px rgba(0, 0, 0, .7); }
.ask-composer textarea { display: block; width: 100%; min-height: 24px; max-height: 30dvh; padding: 0 4px 2px; color: var(--fg); font: var(--fw-regular) var(--fz-md)/1.5 var(--sans); background: transparent; border: 0; box-shadow: none; resize: none; }
.ask-composer textarea:focus { outline: none; box-shadow: none; }
.ask-composer textarea::placeholder { color: var(--fg-3); }
.ask-notice { color: var(--err); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.ask-notice:not(:empty) { margin: 0 11px 6px; }
.ask-cbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; margin-top: 2px; padding-left: 6px; color: var(--fg-3); font-size: var(--fz-sm); }
.ask-capsule { display: inline-flex; align-items: center; gap: 2px; height: 28px; padding: 0 4px 0 6px; }
.ask-capsule-id { font-family: var(--mono); color: var(--a); }
.ask-capsule-clear { display: grid; place-items: center; width: 22px; height: 22px; color: var(--fg-4); border-radius: 50%; }
.ask-capsule-clear:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-capsule-clear .ico { width: 11px; height: 11px; }
.ask-limited { padding: 2px 8px; color: var(--warn); font-size: var(--fz-xs); background: rgba(224, 171, 104, .1); border-radius: 999px; }
.ask-end { display: flex; flex: 1 1 160px; align-items: center; justify-content: flex-end; gap: 2px; min-width: 0; }
.ask-estimate { flex: none; padding: 0 6px; color: var(--fg-4); font: var(--fw-regular) var(--fz-xs)/1 var(--mono); }
.ask-model { display: inline-flex; align-items: center; min-width: 0; height: 32px; padding: 0 10px; color: var(--fg-2); font: var(--fw-regular) var(--fz-sm)/1 var(--sans); border-radius: 999px; transition: color var(--t1) var(--e), background var(--t1) var(--e); }
.ask-model:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-model-name { min-width: 0; overflow: hidden; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.ask-send-slot { display: grid; flex: none; margin-left: 6px; }
.ask-send-slot > .btn { grid-area: 1 / 1; width: 32px; height: 32px; padding: 0; border-radius: 50%; transition: opacity var(--t2) var(--e), transform var(--t2) var(--e-out), visibility 0s, color var(--t2) var(--e), background-color var(--t2) var(--e); }
.ask-send-slot > .btn[hidden] { display: inline-flex; visibility: hidden; pointer-events: none; opacity: 0; transform: scale(.72); transition: opacity var(--t1) var(--e), transform var(--t1) var(--e), visibility 0s linear var(--t1); }
.ask-send .ico, .ask-stop .ico { width: 18px; height: 18px; }
.ask-send .ico { stroke-width: 2; }
.ask-send:disabled { color: var(--fg-4); background: rgba(255, 255, 255, .07); }
.ask-send-slot > .ask-stop { color: var(--fg); background: var(--ask-hover, var(--hover)); border-radius: 9px; }
.ask-stop .ico { fill: currentColor; stroke: none; }
@media (hover: hover) {
  .ask-stop:hover { color: var(--err); background: rgba(232, 135, 135, .12); }
}
</style>
