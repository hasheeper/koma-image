<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { message, useUi } from "../app/ui";
import AppIcon from "../shared/AppIcon.vue";
import ModelIcon from "../shared/ModelIcon.vue";
import { familyOf } from "./model-family.ts";
import AskAttachments from "./AskAttachments.vue";
import AskMenu from "./AskMenu.vue";
import { attachmentAccept } from "./attachments.ts";

const ask = useAsk(), ui = useUi();
const field = shallowRef<HTMLTextAreaElement | null>(null);
const fileInput = shallowRef<HTMLInputElement | null>(null);
function files(event: Event) {
  const input = event.target as HTMLInputElement;
  void ask.addFiles([...(input.files ?? [])]); input.value = "";
}
const capsule = computed(() => ask.anchor.value);
const limited = computed(() => !ask.settings.value.images);
const paused = computed(() => !!ask.settings.value.preference && ask.preferencePaused.value);
const modelTitle = computed(() => `${ask.estimate.value && !ask.running.value ? `本轮输入约 ${ask.estimate.value} tokens · ` : ""}点击切换模型`);
const contextMeter = computed(() => {
  const tokens = ask.estimate.value, limit = ask.settings.value.compaction.highWaterTokens;
  const known = ask.ready.value === "ok" && tokens > 0;
  const tokensLabel = tokens.toLocaleString('zh-CN'), limitLabel = limit.toLocaleString('zh-CN');
  const percent = Math.round(tokens / limit * 100);
  const label = known
    ? `上下文约 ${tokensLabel} tokens\n压缩阈值 ${limitLabel} tokens · ${percent}%`
    : "上下文尚未估算";
  return { known, label, limit, tokensLabel, limitLabel, percent, value: Math.min(tokens, limit), fill: known ? Math.min(100, tokens / limit * 100) : 0 };
});
const contextDetails = shallowRef(false);
let removeContextLayer = () => {};
watch(contextDetails, (shown) => {
  removeContextLayer();
  if (shown) removeContextLayer = ask.layer(() => { contextDetails.value = false; return true; });
});
watch(ask.visible, () => { contextDetails.value = false; });
onBeforeUnmount(() => removeContextLayer());

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
// With nothing picked yet, the chip goes straight to settings instead of an empty menu.
const switchable = computed(() => ask.picks.value.length > 0);
async function useModel(connectionId: string, id: string, close: (refocus?: boolean) => void) {
  close(true);
  try { await ask.useModel(connectionId, id); } catch (error) { ui.toast(message(error), "err"); }
}
async function sendImages() {
  try { await ask.setImages(true); } catch (error) { ui.toast(message(error), "err"); }
}
watch(ask.input, () => nextTick(resize));
defineExpose({
  /** `end` puts the caret after the text, e.g. after a starter fills it. */
  async focus(end = false) {
    await nextTick();
    const el = field.value;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (end) el.setSelectionRange(el.value.length, el.value.length);
  },
});
</script>
<template>
  <div class="ask-dock">
    <p v-if="ask.inline.value" class="ask-inline-target">{{ ask.inline.value.target === 'chat.composer' ? '对话输入框' : ask.inline.value.target === 'image.negative' ? 'Negative' : 'Prompt' }} · {{ ask.inline.value.text.length }} 字</p>
    <form class="ask-composer" :aria-busy="ask.running.value" @submit.prevent="ask.send()">
      <label class="sr-only" for="askPrompt">向 ASK 提问</label>
      <AskAttachments :items="ask.tray.value" :dim="limited" />
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
        <input ref="fileInput" type="file" :accept="attachmentAccept" multiple hidden @change="files" />
        <button class="ask-add" type="button" aria-label="添加图片或文本文件" :aria-busy="ask.preparing.value > 0" @click="fileInput?.click()"><AppIcon name="i-plus" /></button>
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
        <button v-if="limited" class="ask-flag ask-limited" type="button" title="已关闭发送图片，只提供元数据 · 点击恢复" @click="sendImages">仅元数据</button>
        <button v-if="paused" class="ask-flag ask-paused" type="button" title="本次已停用个人偏好 · 点击恢复" @click="ask.togglePreference()">偏好已停用</button>
        <span class="ask-end">
          <AskMenu id="askModelMenu" label="切换模型" side="up">
            <template #trigger="{ open, toggle }">
              <button
                class="ask-model"
                type="button"
                :title="modelTitle"
                :aria-label="`ASK 模型：${ask.settings.value.model || '未选择'}`"
                :aria-haspopup="switchable ? 'menu' : undefined"
                :aria-expanded="switchable ? open : undefined"
                :aria-controls="switchable ? 'askModelMenu' : undefined"
                @click="switchable ? toggle() : ask.openSettings()"
              >
                <span class="ask-model-name">{{ ask.settings.value.model || "选择模型" }}</span>
                <AppIcon name="i-chevron" class="ask-model-chev" />
              </button>
            </template>
            <template #default="{ close }">
              <template v-for="c in ask.picks.value" :key="c.id">
                <div v-if="ask.picks.value.length > 1" class="ask-menu-group" role="presentation">{{ c.name }}</div>
                <button
                  v-for="id in c.ids"
                  :key="id"
                  class="ask-menu-item"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="ask.settings.value.connectionId === c.id && ask.settings.value.model === id"
                  :disabled="ask.running.value"
                  :title="id"
                  @click="useModel(c.id, id, close)"
                ><ModelIcon :family="familyOf(id)" /><span class="ask-menu-label">{{ id }}</span><AppIcon name="i-check" class="ask-menu-check" /></button>
              </template>
              <hr role="separator" />
              <button class="ask-menu-item" type="button" role="menuitem" @click="close(); ask.openSettings()"><AppIcon name="i-settings" /><span class="ask-menu-label">管理模型</span></button>
            </template>
          </AskMenu>
          <span class="ask-context" :role="contextMeter.known ? 'meter' : 'img'" :aria-label="contextMeter.known ? '上下文占用（按压缩阈值估算）' : contextMeter.label" :aria-valuemin="contextMeter.known ? 0 : undefined" :aria-valuemax="contextMeter.known ? contextMeter.limit : undefined" :aria-valuenow="contextMeter.known ? contextMeter.value : undefined" :aria-valuetext="contextMeter.known ? contextMeter.label : undefined" :aria-describedby="contextDetails ? 'askContextTip' : undefined" tabindex="0" @mouseenter="contextDetails = true" @mouseleave="contextDetails = false" @focus="contextDetails = true" @blur="contextDetails = false">
            <svg class="ask-context-ring" viewBox="0 0 16 16" aria-hidden="true">
              <circle class="ask-context-track" cx="8" cy="8" r="6" />
              <circle v-if="contextMeter.fill > 0" cx="8" cy="8" r="6" pathLength="100" :stroke-dasharray="`${contextMeter.fill} 100`" stroke-linecap="round" transform="rotate(-90 8 8)" />
            </svg>
            <span v-if="contextDetails" id="askContextTip" class="ask-context-tip" role="tooltip" :aria-label="contextMeter.label">
              <template v-if="contextMeter.known">
                <span class="ask-context-head"><span class="ask-context-label">上下文 · 估算</span><span class="ask-context-percent">{{ contextMeter.percent }}%</span></span>
                <span class="ask-context-bar" aria-hidden="true"><span :style="{ width: `${contextMeter.fill}%` }"></span></span>
                <span class="ask-context-foot"><span class="ask-context-numbers">{{ contextMeter.tokensLabel }} / {{ contextMeter.limitLabel }}</span><span class="ask-context-caption">压缩阈值</span></span>
              </template>
              <span v-else class="ask-context-label">上下文尚未估算</span>
            </span>
          </span>
          <span class="ask-send-slot">
            <button
              class="btn btn-primary ask-send"
              type="submit"
              aria-label="发送"
              :hidden="ask.running.value"
              :disabled="!ask.canManage.value || !!ask.preparing.value || (!ask.input.value.trim() && !ask.tray.value.length) || ask.ready.value === 'local'"
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
.ask-composer { padding: 8px 6px 6px 12px; background: var(--ask-layer, var(--raised)); border: 1px solid var(--line-2); border-radius: 14px; }
.ask-composer textarea { display: block; width: 100%; min-height: 24px; max-height: 30dvh; padding: 0 2px 2px; color: var(--fg); font: var(--fw-regular) 13.5px/1.55 var(--sans); background: transparent; border: 0; box-shadow: none; resize: none; }
.ask-composer textarea:focus { outline: none; box-shadow: none; }
.ask-composer textarea::placeholder { color: var(--fg-3); }
.ask-notice { color: var(--err); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.ask-notice:not(:empty) { margin: 2px 4px 6px; }
.ask-cbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 2px; color: var(--fg-3); font-size: 12px; }
.ask-add { display: grid; flex: none; place-items: center; width: 28px; height: 28px; margin-left: -6px; color: var(--fg-3); border-radius: 8px; }
.ask-add:hover { color: var(--fg); background: var(--ask-hover); }
.ask-add .ico { --ico: var(--ico-md); }
.ask-capsule { display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 8px; background: color-mix(in srgb, var(--a) 10%, transparent); border-radius: 7px; }
.ask-capsule:has(.ask-capsule-clear) { padding-right: 2px; }
.ask-capsule-id { color: var(--a); font: var(--fw-regular) 12px/1 var(--mono); }
.ask-capsule-clear { display: grid; place-items: center; width: 20px; height: 20px; color: var(--fg-4); border-radius: 5px; }
.ask-capsule-clear:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-capsule-clear .ico { --ico: var(--ico-xs); }
/* Only exceptions show beside the capsule; a click restores the default. */
.ask-flag { flex: none; height: 24px; padding: 0 8px; color: var(--warn); font-size: 12px; line-height: 24px; background: color-mix(in srgb, var(--warn) 10%, transparent); border-radius: 7px; }
.ask-flag:hover { background: color-mix(in srgb, var(--warn) 16%, transparent); }
.ask-end { display: flex; flex: 1 1 140px; align-items: center; justify-content: flex-end; gap: 2px; min-width: 0; }
.ask-model { display: inline-flex; align-items: center; gap: 2px; min-width: 0; height: 28px; padding: 0 0 0 8px; color: var(--fg-3); font: var(--fw-regular) 12px/1 var(--sans); border-radius: 8px; transition: color var(--t1) var(--e), background var(--t1) var(--e); }
.ask-model:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-model-name { min-width: 0; overflow: hidden; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.ask-model-chev { flex: none; --ico: var(--ico-xs); color: var(--fg-4); transform: rotate(90deg); }
.ask-context { position: relative; display: grid; flex: none; place-items: center; width: 24px; height: 28px; color: var(--fg-2); border-radius: 6px; }
.ask-context-ring { display: block; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.5; } /* stylelint-disable-line declaration-property-value-allowed-list -- A progress ring in its own viewBox, not a sprite glyph. */
.ask-context-track { opacity: .28; }
.ask-context:hover { color: var(--fg); }
.ask-context:focus-visible { color: var(--fg-2); outline: 1px solid var(--a); outline-offset: 1px; }
.ask-context-tip { position: absolute; right: -4px; bottom: calc(100% + 8px); z-index: 5; box-sizing: border-box; width: 176px; max-width: calc(100vw - 64px); padding: 8px 10px 7px; color: var(--fg-2); font: var(--fw-regular) 12px/16px var(--sans); font-variant-numeric: tabular-nums; text-align: left; background: var(--raised); border: 1px solid var(--line-2); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .35), 0 1px 2px rgba(0, 0, 0, .3); animation: ask-context-in .12s ease-out; }
.ask-context-tip::after { position: absolute; right: 0; bottom: -9px; left: 0; height: 9px; content: ""; }
.ask-context-head, .ask-context-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ask-context-label { color: var(--fg-3); }
.ask-context-percent { color: var(--fg); font: var(--fw-medium) 13px/1 var(--mono); }
.ask-context-bar { display: block; height: 2px; margin: 5px 0 4px; overflow: hidden; background: color-mix(in srgb, var(--fg-4) 35%, transparent); border-radius: 1px; }
.ask-context-bar > span { display: block; height: 100%; background: var(--fg-2); border-radius: inherit; }
.ask-context-foot { flex-wrap: wrap; gap: 4px 8px; font-size: 11px; line-height: 14px; }
.ask-context-numbers { min-width: 0; font-family: var(--mono); overflow-wrap: anywhere; }
.ask-context-caption { color: var(--fg-4); white-space: nowrap; }
@keyframes ask-context-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ask-context-tip { animation: none; } }
.ask-send-slot { display: grid; flex: none; margin-left: 4px; }
.ask-send-slot > .btn { grid-area: 1 / 1; width: 28px; height: 28px; min-height: 0; padding: 0; border-radius: 50%; transition: opacity var(--t2) var(--e), transform var(--t2) var(--e-out), visibility 0s, color var(--t2) var(--e), background-color var(--t2) var(--e); }
.ask-send-slot > .btn[hidden] { display: inline-flex; visibility: hidden; pointer-events: none; opacity: 0; transform: scale(.72); transition: opacity var(--t1) var(--e), transform var(--t1) var(--e), visibility 0s linear var(--t1); }
.ask-send .ico, .ask-stop .ico { --ico: var(--ico-sm); }
.ask-send .ico { stroke-width: var(--ico-stroke-strong); }
.ask-send:disabled { color: var(--fg-4); background: rgba(255, 255, 255, .07); }
.ask-send-slot > .ask-stop { color: var(--fg); background: var(--ask-hover, var(--hover)); border-radius: 8px; }
.ask-stop .ico { fill: currentColor; stroke: none; }
@media (hover: hover) {
  .ask-stop:hover { color: var(--err); background: rgba(232, 135, 135, .12); }
}
@media (max-width: 860px) {
  .ask-add { width: 36px; height: 36px; }
  .ask-send-slot > .btn { width: 36px; height: 36px; }
  .ask-model { height: 36px; }
  .ask-context { height: 36px; }
}
</style>
