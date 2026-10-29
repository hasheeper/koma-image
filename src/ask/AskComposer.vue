<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { message, useUi } from "../app/ui";
import AppIcon from "../shared/AppIcon.vue";
import AskSend from "./AskSend.vue";
import AskModelPicker from "./AskModelPicker.vue";
import AskAttachments from "./AskAttachments.vue";
import DirectoryChip from "../bridge/DirectoryChip.vue";
import { attachmentAccept } from "./attachments.ts";

defineProps<{ joined?: boolean }>();
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
const referenceQuery = shallowRef<{ start:number; end:number; prefix:string } | null>(null), referenceIndex = shallowRef(0);
const references = computed(() => { void ask.libraryRevision.value; void ask.conversationId.value; return referenceQuery.value ? ask.pictureCandidates(referenceQuery.value.prefix) : []; });
function referenceAtCaret() {
  const el=field.value;
  if (!el || el.selectionStart!==el.selectionEnd) { referenceQuery.value=null; return; }
  const end=el.selectionStart, match=/(?:^|[\s（(，,])(#(?:[hfeca]?[0-9]*(?:\.[0-9]*)?[a-z]?))$/.exec(el.value.slice(0,end));
  referenceQuery.value=match ? {start:end-match[1].length,end,prefix:match[1]} : null;
  referenceIndex.value=0;
}
function insertReference(label: string) {
  const q=referenceQuery.value;
  if (!q) return;
  const text=ask.input.value;
  ask.setInput(text.slice(0,q.start)+label+" "+text.slice(q.end));
  referenceQuery.value=null;
  void nextTick(()=>{const el=field.value;el?.focus();el?.setSelectionRange(q.start+label.length+1,q.start+label.length+1);});
}
function key(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode===229) return;
  if (event.key === "Enter" && event.shiftKey) return;
  if (references.value.length && referenceQuery.value) {
    if (["ArrowDown","ArrowUp","Enter","Tab","Escape"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key==="Escape") referenceQuery.value=null;
      else if (event.key==="ArrowDown" || event.key==="ArrowUp") referenceIndex.value=(referenceIndex.value+(event.key==="ArrowDown" ? 1 : references.value.length-1))%references.value.length;
      else insertReference(references.value[referenceIndex.value]?.label ?? references.value[0].label);
      return;
    }
  }
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void ask.send();
}
function input(event: Event) {
  ask.setInput((event.target as HTMLTextAreaElement).value);
  if (!(event instanceof InputEvent) || !event.isComposing) referenceAtCaret();
}
watch(ask.conversationId,()=>{referenceQuery.value=null;});
watch(ask.visible,()=>{referenceQuery.value=null;});
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
    <form class="ask-composer" :class="{ joined }" :aria-busy="ask.running.value" @submit.prevent="ask.send()">
      <label class="sr-only" for="askPrompt">向 ASK 提问</label>
      <AskAttachments :items="ask.tray.value" :dim="limited" />
      <div v-if="references.length && referenceQuery" id="askPictureSuggestions" class="ask-references" role="listbox" aria-label="图片引用">
        <button v-for="(item,index) in references" :id="`askRefOption${index}`" :key="item.label" type="button" role="option" :aria-selected="index===referenceIndex" @pointerdown.prevent="insertReference(item.label)">
          <img :src="item.url" alt="" /><span>{{ item.label }}</span><small>{{ item.size }}</small>
        </button>
      </div>
      <textarea
        id="askPrompt"
        ref="field"
        :value="ask.input.value"
        rows="1"
        maxlength="4000"
        :placeholder="ask.canReviseDraft.value ? '补充修改意见…' : '问这张图，或用 # 引用图片…'"
        :aria-controls="references.length ? 'askPictureSuggestions' : undefined"
        :aria-expanded="references.length>0"
        :aria-activedescendant="references.length ? `askRefOption${referenceIndex}` : undefined"
        aria-autocomplete="list"
        :disabled="ask.ready.value === 'local'"
        @input="input"
        @click="referenceAtCaret"
        @compositionstart="referenceQuery=null"
        @compositionend="referenceAtCaret"
        @blur="referenceQuery=null"
        @keyup.left="referenceAtCaret"
        @keyup.right="referenceAtCaret"
        @keydown="key"
      ></textarea>
      <p class="ask-notice" role="status">{{ ask.notice.value }}</p>
      <div class="ask-cbar">
        <input ref="fileInput" type="file" :accept="attachmentAccept" multiple hidden @change="files" />
        <button class="ask-add" type="button" aria-label="添加图片或文本文件" :aria-busy="ask.preparing.value > 0" @click="fileInput?.click()"><AppIcon name="i-plus" /></button>
        <DirectoryChip />
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
          <AskModelPicker id="askModelMenu" />
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
          <AskSend />
        </span>
      </div>
    </form>
  </div>
</template>
<style scoped>
.ask-references { position:absolute; right:0; bottom:calc(100% + 6px); left:0; z-index:4; max-height:250px; padding:4px; overflow:auto; background:var(--raised); border:1px solid var(--line-2); border-radius:10px; box-shadow:var(--sh-2); }
.ask-references button { display:flex; align-items:center; gap:8px; width:100%; min-height:34px; padding:4px 8px; text-align:left; border-radius:6px; }
.ask-references button[aria-selected="true"] { background:var(--hover); }
.ask-references img { width:28px; height:28px; object-fit:contain; background:var(--image-checker); border-radius:4px; }
.ask-references span { color:var(--a); font:var(--fw-medium) 12px/1 var(--mono); }
.ask-references small { margin-left:auto; color:var(--fg-3); font:var(--fw-regular) 11px/1 var(--mono); }
.ask-inline-target { padding: 0 10px 6px; color: var(--fg-3); font-size: var(--fz-xs); }
.ask-dock { position: relative; display: flex; flex-direction: column; gap: var(--sp-2); }
.ask-composer { padding: 14px 6px 10px 12px; background: var(--ask-layer, var(--raised)); border: 1px solid var(--line-2); border-radius: 14px; }
.ask-composer.joined { padding-top: 12px; background: transparent; border: 0; border-top: 1px solid var(--line); border-radius: 0 0 14px 14px; }
.ask-composer textarea { display: block; width: 100%; min-height: 26px; max-height: 30dvh; padding: 0 2px 2px; color: var(--fg); font: var(--fw-regular) 13px/1.6 var(--sans); background: transparent; border: 0; box-shadow: none; resize: none; }
.ask-composer textarea:focus { outline: none; box-shadow: none; }
.ask-composer textarea::placeholder { color: var(--fg-3); }
.ask-notice { color: var(--err); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.ask-notice:not(:empty) { margin: 2px 4px 6px; }
.ask-cbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 14px; color: var(--fg-3); font-size: 12px; }
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
@media (max-width: 860px) {
  .ask-add { width: 36px; height: 36px; }
  .ask-context { height: 36px; }
}
</style>
