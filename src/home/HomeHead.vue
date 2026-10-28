<script setup lang="ts">
import { shallowRef, onActivated, onDeactivated, onBeforeUnmount, watch } from 'vue';
import WaveMark from '../shared/WaveMark.vue';
import AppIcon from '../shared/AppIcon.vue';
import DirectoryChip from '../bridge/DirectoryChip.vue';
import AskSend from '../ask/AskSend.vue';
import AskActivity from '../ask/AskActivity.vue';
import { useAskPresentation } from '../ask/presentation.ts';
import { homePictureType, homePictureFile } from './transfer.ts';
import { names } from '../storage/names.ts';
import { ATTACHMENT_LIMITS } from '../ask/attachments.ts';
import AskModelPicker from '../ask/AskModelPicker.vue';
import { useAsk, AskMark } from '../app/ask.ts';
import { useShell } from '../app/shell.ts';
import { useDrawing } from '../app/drawing.ts';
import { useChat } from '../app/chat.ts';
import { useEditor } from '../app/editor.ts';
import { useHome } from '../app/home.ts';
import { useUi, message } from '../app/ui.ts';
const { home } = useHome();
const ask = useAsk(), { router } = useShell(), { drawing } = useDrawing(), { chat } = useChat(), { editor } = useEditor(), ui = useUi();
const { shown, mode, note, summary, outcome, latest, compactDraft, dismiss } = useAskPresentation();
const dropping = shallowRef(false);
defineProps<{ empty: boolean }>();
let dragDepth = 0;
const clearDrop = () => { dragDepth = 0; dropping.value = false; };
const pauseDrop = () => { window.removeEventListener('dragend', clearDrop); clearDrop(); };
onActivated(() => window.addEventListener('dragend', clearDrop));
onDeactivated(pauseDrop);
onBeforeUnmount(pauseDrop);
watch(shown, clearDrop);
function drag(event: DragEvent) {
  const data = event.dataTransfer;
  if (!data || !['Files', names.historyDragType, homePictureType].some(t => data.types.includes(t))) return;
  event.stopPropagation();
  if (event.type === 'dragleave') { dropping.value = !!(dragDepth = Math.max(0, dragDepth - 1)); return; }
  event.preventDefault();
  if (event.type === 'drop') {
    clearDrop(); const id = data.getData(names.historyDragType);
    ask.show(); const file = homePictureFile(data, drawing, chat, home);
    if (file) void ask.addFiles([file]); else if (id) ask.referenceHistory(id); else void ask.addFiles([...data.files]);
  } else { if (event.type === 'dragenter') dragDepth++; dropping.value = true; data.dropEffect = 'copy'; }
}
function paste(event: ClipboardEvent) {
  const data = event.clipboardData; if (!data) return;
  const text = data.getData('text/plain');
  if (data.files.length) { event.preventDefault(); ask.show(); void ask.addFiles([...data.files]); }
  else if (text.length > ATTACHMENT_LIMITS.paste) { event.preventDefault(); ask.show(); void ask.addPastedText(text); }
}
const input = shallowRef<HTMLInputElement | null>(null), choosing = shallowRef(false);
async function start(kind: 'image' | 'chat') {
  try {
    if (kind === 'image') await drawing.createBoard();
    else { await chat.readStored(); chat.addConversation(); }
    router.switchWorkspace(kind);
  } catch (e) { ui.toast(message(e), 'err'); }
}
async function file(event: Event) {
  const field = event.target as HTMLInputElement, image = field.files?.[0]; field.value = '';
  if (!image || choosing.value) return;
  choosing.value = true;
  try { await editor.open('edit', image, image.name); }
  catch (e) { ui.toast(message(e), 'err'); }
  finally { choosing.value = false; }
}
function send() { ask.show(); void ask.send(); }
function key(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault(); if (!ask.running.value) send();
}
</script>
<template>
  <header class="home-head" :class="{ 'is-row': shown, 'is-empty': empty && !shown }">
    <div class="home-bar">
      <h1 class="home-brand" aria-label="Koma HOME"><WaveMark surface="home" /><span class="home-word"><span class="brand-title">Koma</span><span class="brand-subtitle">HOME</span></span></h1>
      <div id="homeEntryDock" v-show="shown"></div>
      <div class="home-settings"><DirectoryChip v-if="!shown" home /><i v-if="!shown" aria-hidden="true"></i><button type="button" class="ibtn" aria-label="设置" title="设置" @click="router.openOverlay('settings')"><AppIcon name="i-settings" /></button></div>
    </div>
    <form v-if="!shown" class="home-ask" aria-label="向 ASK 提问" @submit.prevent="send" @paste="paste" @dragenter="drag" @dragover="drag" @dragleave="drag" @drop="drag">
      <button class="home-ask-mark" type="button" aria-label="打开 ASK" @click="ask.show()"><AskMark :thinking="ask.running.value" /></button>
      <textarea aria-label="HOME ASK 输入" rows="1" wrap="off" :value="ask.input.value" maxlength="4000" placeholder="问任一画板或会话，用 #f 引用定稿…" :disabled="ask.ready.value === 'local'" @input="ask.setInput(($event.target as HTMLTextAreaElement).value)" @keydown="key"></textarea>
      <span class="home-ask-end"><span class="home-model"><AskModelPicker /></span><AskSend home /></span>
      <span v-if="dropping" class="home-drop">松开即可添加到这条提问</span>
    </form>
    <div v-if="!shown && note" class="home-note" role="status">
      <button class="home-note-open" type="button" @click="ask.show()">
        <template v-if="mode === 'run'"><AskActivity /><AskActivity progress /></template>
        <template v-else-if="mode === 'done'"><AppIcon name="i-check" /><span>已写入</span></template>
        <template v-else>
          <span class="home-note-state">{{ compactDraft ? '草稿待确认' : outcome }}</span>
          <span class="home-note-sum">{{ compactDraft ? ask.draftPlan.value?.title : summary.map(p => p.v).join('') }}</span>
          <span class="home-note-go">{{ compactDraft ? '核对草稿' : latest?.status === 'failed' || latest?.status === 'stopped' ? '查看详情与重试' : '继续对话' }} ↗</span>
        </template>
      </button>
      <button v-if="mode === 'ready' && !compactDraft" class="home-note-x" type="button" aria-label="收起 ASK 结果" @click="dismiss"><AppIcon name="i-close" /></button>
    </div>
    <Teleport to="#homeEntryDock" :disabled="!shown" defer>
    <nav class="home-entries" aria-label="开始创作">
      <button type="button" @click="start('image')"><AppIcon name="i-plus" />新画板</button>
      <button type="button" @click="start('chat')"><AppIcon name="i-compose" />新对话</button>
      <button type="button" :disabled="choosing" @click="input?.click()"><AppIcon name="i-edit" /><span class="wide-label">精修图片</span><span class="short-label">精修</span></button>
      <button type="button" @click="router.switchWorkspace('tags')"><AppIcon name="i-search" />查词</button>
    </nav>
    </Teleport>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="file" />
  </header>
</template>
<style scoped>
.home-head { margin-bottom: var(--sp-7); }
.home-bar { min-width: 0; display: flex; align-items: center; gap: var(--sp-4); margin-bottom: 8px; }
.home-brand { display: inline-flex; align-items: center; flex: none; gap: 12px; margin: 0 0 8px; }
.home-brand .wave-mark { width: 36px; height: 36px; }
.home-word { display: inline-flex; align-items: baseline; gap: 8px; line-height: 1; }
.home-word .brand-title { font-size: 32px; }
.home-word .brand-subtitle { font-size: 12px; letter-spacing: .16em; }
.home-settings { display: flex; align-items: center; align-self: flex-end; height: 32px; margin: 0 16px 0 auto; padding: 0 2px; background: var(--raised); border: 1px solid var(--line-2); border-radius: 16px; box-shadow: var(--sh-1); }
.home-settings > i { width: 1px; height: 14px; margin: 0 2px; background: var(--line-2); }
.home-settings > .ibtn { width: 26px; height: 26px; border-radius: 50%; }
.home-ask { position: relative; display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 9px 0 20px; background: var(--raised); border: 1px solid var(--line-2); border-radius: 28px; box-shadow: var(--sh-2); }
.home-ask:focus-within { border-color: color-mix(in srgb, var(--a) 45%, var(--line-2)); }
.home-ask-mark { display: grid; flex: none; place-items: center; width: 20px; height: 20px; color: var(--a); }
.home-ask-mark :deep(svg) { width: 20px; height: 20px; }
.home-ask textarea { flex: 1; width: 0; height: 24px; padding: 0; resize: none; overflow: hidden; min-width: 0; min-height: 0; color: var(--fg); font: var(--fw-regular) var(--fz-md)/24px var(--sans); white-space: nowrap; box-shadow: none; background: none; border: 0; outline: 0; }
.home-ask textarea::placeholder { color: var(--fg-3); }
.home-model { max-width: 220px; }
.home-model :deep(.ask-model) { max-width: 220px; }
.home-ask-end { display: flex; flex: none; align-items: center; gap: 2px; }
.home-entries { display: flex; gap: 8px; margin-top: 12px; }
.home-entries button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; font-size: var(--fz-sm); padding: 0 14px; color: var(--fg-2); border: 1px solid var(--line-2); border-radius: 18px; transition: color var(--t1) var(--e), background var(--t1) var(--e); }
.home-entries button:hover { color: var(--fg); background: var(--hover); }
.home-entries .ico { --ico: var(--ico-sm); color: var(--fg-3); }
.home-entry-mark { width: var(--ico-sm); height: var(--ico-sm); fill: currentColor; color: var(--fg-3); }
.short-label { display: none; }
/* Wide screens centre the brand, question and entries; settings keep the right corner. */
@media (min-width: 561px) {
  .home-head:not(.is-row) .home-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); margin-bottom: var(--sp-5); }
  .home-head:not(.is-row) .home-brand { grid-column: 2; margin: 0; }
  .home-head:not(.is-row) .home-settings { grid-column: 3; justify-self: end; align-self: center; margin: 0; }
  .home-head:not(.is-row) :is(.home-ask, .home-note) { width: min(100%, 720px); margin-inline: auto; }
  .home-head:not(.is-row) .home-entries { justify-content: center; }
}
@media (max-width: 860px) {
  .home-head { margin-bottom: var(--sp-6); }
  .home-ask { height: 50px; padding: 0 7px 0 16px; border-radius: 25px; }
  .home-model { display: none; }
  .home-entries button { height: 36px; }
  .home-settings { margin-right: 8px; }
  .home-settings :deep(.directory-chip) { max-width: 128px; }
}
@media (max-width: 560px) {
  .home-brand { gap: 10px; }
  .home-brand .wave-mark { width: 32px; height: 32px; }
  .home-word { gap: 7px; }
  .home-word .brand-title { font-size: 28px; }
  .home-word .brand-subtitle { font-size: 11px; }
  .home-entries { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .home-entries button { gap: 6px; padding: 0 6px; }
  .wide-label { display: none; }
  .short-label { display: inline; }
}
@media (max-width: 360px) { .home-entries .ico, .home-entry-mark { display: none; } }
.is-row .home-bar { margin-bottom: 0; }
.is-row .home-brand { margin-bottom: 0; }
#homeEntryDock { margin-left: auto; }
.is-row .home-entries { margin: 0; flex-wrap: wrap; }
.is-row .home-settings { align-self: center; height: 34px; margin: 0; padding: 0 3px; border-radius: 17px; }
.home-note { --ask-hover: var(--hover); display: flex; align-items: center; gap: 8px; min-width: 0; height: 20px; margin-top: 10px; padding-left: 53px; }
.home-note-open { display: inline-flex; align-items: baseline; gap: 12px; min-width: 0; max-width: 100%; color: var(--fg-3); text-align: left; white-space: nowrap; }
.home-note-state { flex: none; }
.home-note-sum { min-width: 0; overflow: hidden; color: var(--fg-2); text-overflow: ellipsis; }
.home-note-go { display: inline-flex; flex: none; gap: 3px; font-size: 12.5px; transition: color var(--t1) var(--e); }
.home-note-open:hover .home-note-go { color: var(--fg); }
.home-note-open > .ico { --ico: var(--ico-sm); color: var(--ok); }
.home-note-x { display: grid; flex: none; place-items: center; width: 22px; height: 22px; color: var(--fg-3); border-radius: 50%; }
.home-note-x .ico { --ico: var(--ico-sm); }
.home-note-x:hover { color: var(--fg); background: var(--hover); }
.home-drop { position: absolute; inset: 0; display: grid; place-items: center; color: var(--a); background: var(--raised); border: 1px dashed var(--a); border-radius: inherit; pointer-events: none; }
@media (max-width: 860px) { .home-note { padding-left: 49px; } }
@media (max-width: 560px) { .home-note-open { flex: 1; gap: 8px; } .home-note-go { font-size: 11px; } }
.home-head.is-empty { grid-row: 2; margin-bottom: 0; }
.home-head.is-empty .home-bar { display: flex; justify-content: center; margin-bottom: 28px; }
.home-head.is-empty .home-brand { margin: 0; }
.home-head.is-empty .home-brand .wave-mark { width: 44px; height: 44px; }
.home-head.is-empty .home-word .brand-title { font-size: 40px; }
.home-head.is-empty .home-settings { position: absolute; top: 32px; right: 0; margin: 0; }
.home-head.is-empty :is(.home-ask, .home-note) { width: min(100%, 720px); margin-inline: auto; }
.home-head.is-empty .home-entries { justify-content: center; }
@media (max-width: 860px) {
  .home-head.is-empty .home-bar { margin-bottom: 24px; }
  .home-head.is-empty .home-settings { top: 24px; }
}
@media (max-width: 560px) {
  .home-head.is-empty .home-brand .wave-mark { width: 38px; height: 38px; }
  .home-head.is-empty .home-word .brand-title { font-size: 34px; }
}
</style>
