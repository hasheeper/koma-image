<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useHome } from "../app/home.ts";
import { useAsk } from "../app/ask";
import AskTodos from "../slate/AskTodos.vue";
import { useShell } from "../app/shell";
import { installAskWindow } from "../native/ask-window";
import AppIcon from "../shared/AppIcon.vue";
import AskMark from "./AskMark.vue";
import AskStream from "./AskStream.vue";
import AskDebug from "./AskDebug.vue";
import AskComposer from "./AskComposer.vue";
import AskMore from "./AskMore.vue";
import AskConversations from "./AskConversations.vue";
import AskAttachmentPreview from "./AskAttachmentPreview.vue";
import DraftCard from "./DraftCard.vue";
import { useAskPresentation } from "./presentation.ts";
import AskActivity from "./AskActivity.vue";
import { ATTACHMENT_LIMITS } from "./attachments.ts";
import { useDrawing } from "../app/drawing.ts";
import { useChat } from "../app/chat.ts";
import { homePictureType, homePictureFile } from "../home/transfer.ts";
import { names } from "../storage/names.ts";

const ask = useAsk();
const homeService = useHome().home;
const drawingService = useDrawing().drawing, chatService = useChat().chat;
const { router, image, chat } = useShell();
const presentation = useAskPresentation();
const { shown, mode, home, mobile, fullscreen, dock, canDock, latest, tools, compactDraft, completed, summary, outcome, dismiss } = presentation;
const inlineWindow = computed(() => !home.value && !mobile.value && !!ask.inline.value);
const movable = computed(() => !home.value && !mobile.value && !ask.inline.value);
const root = shallowRef<HTMLElement | null>(null),
  expanded = shallowRef(false),
  composer = shallowRef<InstanceType<typeof AskComposer> | null>(null);
const debugOpen = shallowRef(false), debugTurn = shallowRef<number>();
function inspect(turn?: number) { debugTurn.value = turn; debugOpen.value = true; }
const dropping = shallowRef(false);
let dragDepth = 0;
const clearDrop = () => { dragDepth = 0; dropping.value = false; };
const acceptsInput = () => ask.visible.value && !document.querySelector("dialog:modal");
function paste(event: ClipboardEvent) {
  if (!acceptsInput()) return;
  // Short text keeps its native insertion; CHAT's document handler must not see it.
  event.stopPropagation();
  const data = event.clipboardData;
  if (!data) return;
  const files = [...data.files], text = data.getData("text/plain");
  if (files.length) { event.preventDefault(); void ask.addFiles(files); }
  else if (text.length > ATTACHMENT_LIMITS.paste) { event.preventDefault(); void ask.addPastedText(text); }
}
function drag(event: DragEvent) {
  const data = event.dataTransfer;
  if (!acceptsInput() || !data || !["Files", names.historyDragType, homePictureType].some(type => data.types.includes(type))) return;
  event.stopPropagation();
  if (event.type === "dragleave") {
    dragDepth = Math.max(0, dragDepth - 1); dropping.value = dragDepth > 0;
    return;
  }
  event.preventDefault();
  if (event.type === "drop") {
    clearDrop();
    const id = data.getData(names.historyDragType);
    const file = homePictureFile(data, drawingService, chatService, homeService);
    if (file) void ask.addFiles([file]);
    else if (id) ask.referenceHistory(id);
    else void ask.addFiles([...data.files]);
    void composer.value?.focus(true);
  } else {
    if (event.type === "dragenter") dragDepth++;
    dropping.value = true; data.dropEffect = "copy";
  }
}
const controller = new AbortController();
let place = () => {};
const dimensions = computed(() => ({
  "--ask-width": `${mode.value === "idle" ? 40 : mode.value === "run" ? 304 : mode.value === "ready" ? 372 : mode.value === "done" ? 172 : expanded.value ? 760 : 420}px`,
  "--ask-height": mode.value === "exp" ? expanded.value ? "calc(var(--ask-available-height, 100dvh) - 32px)" : "660px" : mode.value === "ready" ? "var(--ask-ready-height, 160px)" : "40px",
}));
onMounted(() => {
  window.addEventListener("dragend", clearDrop, { signal: controller.signal });
  if (root.value) {
    ask.attach(root.value, dismiss);
    place = installAskWindow(root.value, controller.signal);
  }
});
watch([mode, dock, fullscreen, ask.inline, expanded, () => router.route.value.workspace, () => image.historyOpen, () => chat.contextOpen], () => void nextTick(place), { flush: "post" });
watch(ask.conversationId, clearDrop);
watch(() => router.route.value.overlay, clearDrop);
watch(ask.visible, visible => { if (!visible) { clearDrop(); ask.closeAttachment(); } });
function resize() {
  if (mobile.value) return;
  if (home.value) presentation.resizeHome();
  else if (!ask.inline.value) expanded.value = !expanded.value;
}
/** A starter only fills the input, on a new line after any draft text. */
function start(text: string) {
  const current = ask.input.value.trimEnd();
  ask.setInput(current ? `${current}\n${text}` : text);
  void composer.value?.focus(true);
}
let returnFocus: HTMLElement | null = null;
watch([shown, ask.inline], async ([visible]) => {
  const active = document.activeElement;
  if (visible) {
    if (active instanceof HTMLElement && active !== document.body && !root.value?.contains(active)) returnFocus = active;
    await nextTick();
    composer.value?.focus();
  } else if (active instanceof HTMLElement && root.value?.contains(active)) {
    await nextTick();
    if (ask.visible.value || document.querySelector("dialog:modal")) return;
    if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    else if (home.value) document.querySelector<HTMLTextAreaElement>(".home-ask textarea")?.focus({ preventScroll: true });
    else root.value?.querySelector<HTMLButtonElement>(".ask-layer:not([inert]) .ask-open, .ask-layer:not([inert]).ask-open")?.focus({ preventScroll: true });
  }
}, { flush: "pre" });
// A compact layer can disappear under focus: dismissal, ⌘Z or the applied timeout.
watch(mode, async () => {
  const active = document.activeElement;
  await nextTick();
  if (active instanceof HTMLElement && root.value?.contains(active) && active.closest("[inert]") && !document.querySelector("dialog:modal"))
    root.value.querySelector<HTMLButtonElement>(".ask-layer:not([inert]) .ask-open, .ask-layer:not([inert]).ask-open")?.focus({ preventScroll: true });
});
onBeforeUnmount(() => { controller.abort(); ask.attach(null); });
</script>
<template>
  <aside v-show="(!home || shown)" id="askIsland" ref="root" class="ask-island" :class="{ 'ask-inline': inlineWindow && shown }" :data-mode="mode" :data-home="home && shown ? dock : undefined" :data-fullscreen="fullscreen || undefined" :data-workspace="router.route.value.workspace" :data-context-open="chat.contextOpen || undefined" :data-quiet="router.route.value.workspace === 'image' && image.state === 'busy' || undefined" :style="{ ...dimensions, '--ask-dock-w': `${presentation.dockWidth.value}px` }" aria-label="Koma ASK" :aria-describedby="home || mobile ? undefined : 'askMoveHint'">
    <button v-show="mode === 'idle'" id="askLauncher" class="ask-layer ask-launcher ask-open" :inert="mode !== 'idle'" data-ask-grip type="button" aria-label="打开 Koma ASK" aria-controls="askDrawer" aria-expanded="false" title="Koma ASK · 可拖动 · ⌘J / Ctrl+J" @click="ask.show()"><AskMark interactive /></button>
    <div v-show="mode === 'run'" class="ask-layer ask-run" :inert="mode !== 'run'">
      <button class="ask-open ask-run-grip" data-ask-grip type="button" aria-label="展开 ASK 对话" @click="ask.show()"><AskMark thinking /><AskActivity /></button>
      <AskActivity progress />
    </div>
    <section v-show="mode === 'ready'" class="ask-layer ask-ready" :inert="mode !== 'ready'" aria-label="ASK 结果">
      <header class="ask-result-head">
        <div class="ask-result-grip" data-ask-grip tabindex="0" role="group" aria-label="移动 ASK 结果"><AskMark /><b>ASK</b><span>{{ outcome }}<template v-if="tools.length"> · {{ completed }} 项工具</template></span></div>
        <button class="ibtn ask-open" type="button" aria-label="展开 ASK 对话" @click="ask.show()"><AppIcon name="i-expand" /></button>
        <button v-if="!compactDraft" class="ibtn" type="button" aria-label="收起 ASK 结果" @click="dismiss()"><AppIcon name="i-close" /></button>
      </header>
      <p class="ask-summary"><template v-for="(part, i) in summary" :key="i"><code v-if="part.t === 'code'">{{ part.v }}</code><span v-else :class="{ 'ask-summary-id': part.t === 'id' }">{{ part.v }}</span></template></p>
      <div id="askCompactDraft" class="ask-compact-draft"></div>
      <p v-if="ask.notice.value" class="ask-compact-notice" role="status">{{ ask.notice.value }}</p>
      <button v-if="!compactDraft" class="ask-details ask-open" type="button" @click="ask.show()">{{ latest?.status === 'failed' || latest?.status === 'stopped' ? '查看详情与重试' : '继续对话' }}<span aria-hidden="true">↗</span></button>
    </section>
    <div v-show="mode === 'done'" class="ask-layer ask-done" :inert="mode !== 'done'">
      <button class="ask-open ask-done-grip" data-ask-grip type="button" aria-label="展开 ASK 对话" @click="ask.show()"><AppIcon name="i-check" /><span><b>已写入</b> · {{ ask.appliedDraft.value?.workspace === 'chat' ? '未发送' : '未生成' }}</span></button>
    </div>
    <div v-show="shown" id="askDrawer" class="ask-layer ask-window" :class="{ 'ask-inline': inlineWindow, 'ask-expanded': movable && expanded }" :inert="!shown" role="dialog" :aria-modal="fullscreen" aria-label="Koma ASK" @paste="paste" @dragenter="drag" @dragover="drag" @dragleave="drag" @drop="drag">
      <header class="ask-head">
        <div class="ask-handle" :data-ask-grip="movable ? '' : undefined" :tabindex="movable ? 0 : undefined" role="group" :aria-label="movable ? '移动 ASK 窗口' : 'ASK'" :aria-describedby="movable ? 'askMoveHint' : undefined" @dblclick="resize"><AskMark :thinking="ask.running.value" /></div>
        <AskConversations @chosen="composer?.focus(true)" />
        <div class="ask-fill" :data-ask-grip="movable ? '' : undefined" aria-hidden="true" @dblclick="resize"></div>
        <button v-if="inlineWindow" class="btn btn-quiet btn-xs" type="button" @click="ask.expand()">展开</button>
        <button v-else-if="!mobile && (!home || canDock)" class="ibtn" type="button" :aria-label="(home ? dock === 'full' : expanded) ? '还原 ASK 窗口' : '放大 ASK 窗口'" :title="(home ? dock === 'full' : expanded) ? '还原' : '放大'" @click="resize"><AppIcon :name="(home ? dock === 'full' : expanded) ? 'i-shrink' : 'i-expand'" /></button>
        <AskMore @debug="inspect()" />
        <button class="ibtn" type="button" aria-label="收起 ASK" title="收起" @click="ask.hide()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
      </header>
      <AskStream @start="start" @focus="composer?.focus(true)" />
      <div class="ask-bottom">
        <AskTodos /><div id="askFullDraft" class="ask-full-draft"></div><AskComposer ref="composer" /></div>
      <AskAttachmentPreview v-if="ask.attachmentPreview.value && !ask.attachmentPreview.value.inline" :key="ask.attachmentPreview.value.id" />

      <div v-if="dropping" class="ask-drop" aria-hidden="true"><span>松开即可添加到这条提问</span></div>
    </div>
    <Teleport :to="!home && mode === 'ready' && compactDraft ? '#askCompactDraft' : '#askFullDraft'" defer><DraftCard :compact="!home && mode === 'ready'" @review="ask.show()" /></Teleport>
    <div class="sr-only" role="status" aria-live="polite"><span :key="ask.announce.value.id">{{ ask.announce.value.text }}</span></div>
    <span v-if="!home && !mobile" id="askMoveHint" class="sr-only">拖动图标或标题栏移动；Alt 加方向键移动，Alt 加 Home 归位。⌘J 或 Ctrl+J 展开或收起。</span>
  </aside>
  <AskDebug v-if="debugOpen" :turn="debugTurn" @close="debugOpen = false" />
</template>
<style scoped>
.ask-drop { position: absolute; inset: 6px; z-index: 6; display: grid; place-items: center; color: var(--a); font-size: 13px; background: color-mix(in srgb, var(--a) 8%, color-mix(in srgb, var(--raised) 90%, transparent)); border: 1.5px dashed color-mix(in srgb, var(--a) 60%, transparent); border-radius: 18px; pointer-events: none; }
/* One glass material for every state; the child surfaces add only a light tint. */
.ask-island { --ask-glass: rgba(22, 22, 25, .88); --ask-layer: rgba(255, 255, 255, .035); --ask-field: rgba(0, 0, 0, .16); --ask-hover: rgba(255, 255, 255, .055); position: fixed; top: var(--ask-top, calc(var(--bar-h) + 12px)); right: var(--ask-right, 20px); z-index: var(--z-drawer); width: min(var(--ask-width), calc(100vw - 16px)); height: min(var(--ask-height), calc(var(--ask-available-height, 100dvh) - 16px)); overflow: hidden; color: var(--fg); background: var(--ask-glass); border-radius: 20px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 0 0 1px var(--line-2), 0 10px 32px rgba(0, 0, 0, .45); backdrop-filter: blur(20px) saturate(1.4); transition-property: width, height, border-radius, box-shadow, transform; transition-duration: .52s, .52s, .52s, .3s, .25s; transition-timing-function: cubic-bezier(.32, .72, 0, 1); }
@media (min-width: 861px) { .ask-island[data-workspace="image"] { right: var(--ask-right, calc(var(--hist) + 8px)); } }
@media (min-width: 861px) { .ask-island[data-workspace="chat"][data-context-open] { right: var(--ask-right, calc(var(--context-w) + 8px)); } }
.ask-island { --ask-idle-k: 1; --ask-idle-amp: 1; --ask-idle-ease: cubic-bezier(.45, .05, .55, .95); --ask-idle-beat-ease: cubic-bezier(.4, 0, .2, 1); }
.ask-island[data-quiet] { --ask-idle-k: 1.8; --ask-idle-amp: .35; }
.ask-island[data-mode="idle"]:hover { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), 0 0 0 1px color-mix(in srgb, var(--a) 40%, transparent), 0 0 20px color-mix(in srgb, var(--a) 14%, transparent), 0 10px 32px rgba(0, 0, 0, .45); }
.ask-island[data-mode="idle"]:has(.ask-launcher:active):not([data-dragging]) { transform: scale(.94); }
.ask-island[data-mode="run"] { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 0 0 1px color-mix(in srgb, var(--a) 24%, transparent), 0 10px 32px rgba(0, 0, 0, .45); }
.ask-island[data-mode="ready"] { animation: ask-ready-ping .9s var(--e) both; }
.ask-island[data-mode="exp"] { border-radius: 18px; }
.ask-island:not([data-mode="idle"]) { transition-property: width, height, border-radius, box-shadow; }
.ask-layer { width: 100%; transform-origin: top right; animation: ask-layer-in .4s cubic-bezier(.32, .72, 0, 1) .1s both; }
.ask-launcher { position: relative; display: grid; place-items: center; height: 100%; color: var(--a); border-radius: inherit; animation: none; }
.ask-launcher::before, .ask-launcher::after { position: absolute; content: ""; pointer-events: none; }
.ask-launcher::before { inset: 6px; background: radial-gradient(circle, color-mix(in srgb, var(--a) 55%, transparent) 0%, transparent 70%); border-radius: 50%; opacity: 0; transform: scale(.7); transition: opacity .6s var(--ask-idle-beat-ease), transform .6s cubic-bezier(.32, .72, 0, 1); animation: ask-idle-halo calc(5s * var(--ask-idle-k)) var(--ask-idle-ease) infinite; }
/* Keep the breathing outline inside the morphing surface's clipped boundary. */
.ask-launcher::after { inset: 1px; border-radius: inherit; box-shadow: 0 0 0 1px color-mix(in srgb, var(--a) 30%, transparent); opacity: 0; animation: ask-idle-ring calc(5s * var(--ask-idle-k)) var(--ask-idle-ease) infinite; }
.ask-launcher :deep(.ask-mark) { position: relative; }
.ask-launcher :deep(.interactive rect) { transition: transform .4s cubic-bezier(.32, .72, 0, 1), opacity .4s var(--ask-idle-beat-ease); }
.ask-launcher :deep(.interactive .core) { animation: ask-idle-core calc(5s * var(--ask-idle-k)) var(--ask-idle-ease) infinite; }
.ask-launcher :deep(.interactive .edge) { animation: ask-idle-beat calc(9s * var(--ask-idle-k)) var(--ask-idle-beat-ease) calc(1.2s * var(--ask-idle-k)) infinite; }
.ask-launcher :deep(.interactive .corner) { animation: ask-idle-corner calc(9s * var(--ask-idle-k)) var(--ask-idle-beat-ease) calc(1.42s * var(--ask-idle-k)) infinite; }
.ask-launcher:hover::before { animation: none; opacity: .42; transform: scale(1.05); }
.ask-launcher:hover::after { animation: none; opacity: 0; }
.ask-launcher:hover :deep(.interactive .c1) { transform: translate(-.5px, -.5px); }
.ask-launcher:hover :deep(.interactive .c2) { transform: translate(.5px, -.5px); }
.ask-launcher:hover :deep(.interactive .c3) { transform: translate(.5px, .5px); }
.ask-launcher:hover :deep(.interactive .c4) { transform: translate(-.5px, .5px); }
.ask-launcher:hover :deep(.interactive .edge) { animation: none; opacity: .78; }
.ask-launcher:hover :deep(.interactive .corner) { animation: none; opacity: .5; }
.ask-launcher:hover :deep(.interactive .core) { animation: ask-idle-awake 1.6s var(--ask-idle-ease) infinite; }
.ask-island[data-paused] .ask-launcher::before, .ask-island[data-paused] .ask-launcher::after, .ask-island[data-paused] :deep(.ask-mark rect), .ask-island[data-paused] .ask-launcher :deep(.interactive rect) { animation-play-state: paused; }
[data-ask-grip] { touch-action: none; user-select: none; cursor: grab; }
.ask-island[data-dragging] [data-ask-grip] { cursor: grabbing; }
.ask-run, .ask-done { display: flex; align-items: center; gap: 10px; height: 100%; padding: 0 8px 0 10px; }
.ask-run-grip, .ask-done-grip { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; height: 100%; text-align: left; }
.ask-island :deep(.ibtn) { flex: none; width: 26px; height: 26px; border-radius: 13px; }
.ask-island :deep(.ibtn:hover), .ask-island :deep(.btn-quiet:hover) { background: var(--ask-hover); }
.ask-island :deep(.ibtn .ico) { --ico: var(--ico-sm); }
.ask-ready { max-height: calc(var(--ask-available-height, 100dvh) - 16px); padding: 10px 12px 12px 10px; overflow-y: auto; overscroll-behavior: contain; }
.ask-result-head { display: flex; align-items: center; gap: 10px; height: 20px; margin-bottom: 10px; }
.ask-result-grip { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; color: var(--fg-4); font-size: 12px; line-height: 1; }
.ask-result-grip b { color: var(--fg-2); font-weight: var(--fw-semibold); }
.ask-result-grip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-summary { display: -webkit-box; overflow: hidden; padding-left: 30px; font-size: 14px; font-weight: var(--fw-semibold); line-height: 1.55; overflow-wrap: anywhere; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.ask-summary code { padding: 1px 5px; font: var(--fw-regular) 12.5px/1.55 var(--mono); background: rgba(255, 255, 255, .07); border-radius: 5px; }
.ask-summary-id { color: var(--a); font-family: var(--mono); }
.ask-compact-draft:not(:empty) { display: flex; flex-direction: column; margin-top: 12px; }
.ask-details { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 12px; padding: 8px 10px; color: var(--fg-3); background: var(--ask-layer); border-radius: 10px; font-size: 12.5px; }
.ask-details:hover { color: var(--fg); background: var(--ask-hover); }
.ask-compact-notice { margin-top: 8px; color: var(--warn); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.ask-done { gap: 8px; padding: 0 14px 0 12px; color: var(--fg-3); font-size: 13px; line-height: 1; }
.ask-done-grip { gap: 8px; white-space: nowrap; }
.ask-done :deep(.ico) { flex: none; --ico: var(--ico-md); color: var(--ok); }
.ask-done b { color: var(--fg); font-weight: var(--fw-semibold); }
.ask-window { position: relative; display: flex; flex-direction: column; height: 100%; }
.ask-head { display: flex; flex: none; align-items: center; gap: 4px; height: 48px; padding: 0 10px 0 14px; }
.ask-head :deep(.ibtn) { width: 30px; height: 30px; color: var(--fg-3); border-radius: 8px; }
.ask-head :deep(.ibtn .ico) { --ico: var(--ico-md); }
.ask-head :deep(.ibtn:hover) { color: var(--fg); }
.ask-handle { display: flex; flex: none; align-items: center; align-self: stretch; padding: 0 2px; }
/* The title is a button, so the empty head after it is a second grip. */
.ask-fill { flex: 1; align-self: stretch; min-width: 8px; }
.ask-bottom { display: flex; flex: 0 1 auto; flex-direction: column; min-height: 0; max-height: calc(100% - 104px); padding: 0 16px 14px; }
.ask-full-draft { display: flex; flex: 0 1 auto; flex-direction: column; min-height: 0; }
.ask-bottom :deep(.ask-dock) { flex: none; }
.ask-island.ask-inline { top: var(--ask-inline-top, 80px); right: auto; left: var(--ask-inline-left, 8px); width: min(480px, calc(100vw - 16px)); height: min(560px, calc(100dvh - 96px)); }
@media (max-width: 480px) {
  .ask-island { right: var(--ask-right, 12px); }
  .ask-bottom { padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
}
@keyframes ask-layer-in { from { opacity: 0; filter: blur(6px); transform: scale(.97); } to { opacity: 1; filter: none; transform: none; } }
@keyframes ask-idle-halo { 0%, 100% { opacity: calc(.05 * var(--ask-idle-amp)); transform: scale(.7); } 50% { opacity: calc(.32 * var(--ask-idle-amp)); transform: scale(1); } }
@keyframes ask-idle-ring { 0%, 100% { opacity: 0; } 50% { opacity: calc(.6 * var(--ask-idle-amp)); } }
@keyframes ask-idle-core { 0%, 100% { opacity: .82; } 50% { opacity: 1; } }
@keyframes ask-idle-beat { 0%, 100% { opacity: .5; } 3% { opacity: calc(.5 + .45 * var(--ask-idle-amp)); } 9% { opacity: .5; } }
@keyframes ask-idle-corner { 0%, 100% { opacity: .24; } 3% { opacity: calc(.24 + .5 * var(--ask-idle-amp)); } 10% { opacity: .24; } }
@keyframes ask-idle-awake { 0%, 100% { opacity: .9; } 50% { opacity: 1; } }

@keyframes ask-ready-ping { from { box-shadow: 0 0 0 1px var(--a), 0 0 0 0 color-mix(in srgb, var(--a) 35%, transparent), 0 10px 32px rgba(0, 0, 0, .45); } to { box-shadow: 0 0 0 1px var(--line-2), 0 0 0 14px transparent, 0 10px 32px rgba(0, 0, 0, .45); } }
@media (prefers-reduced-motion: reduce) {
  .ask-island[data-mode] { transition-property: none; animation: none; }
  .ask-layer { animation: none; }
  .ask-island[data-mode="idle"]:has(.ask-launcher:active):not([data-dragging]) { transform: none; }
  .ask-launcher:hover :deep(.ask-mark.interactive rect) { transform: none; }
  .ask-launcher::before, .ask-launcher::after, .ask-launcher :deep(.ask-mark.interactive rect), .ask-launcher:hover :deep(.ask-mark.interactive rect) { animation: none; transition: none; }
  .ask-launcher::before, .ask-launcher:hover::before { opacity: .12; transform: scale(.7); }
}

/* HOME docking and mobile full-screen share the same solid surface. */
.ask-island:is([data-home], [data-fullscreen]) {
  --ask-glass: var(--chrome); --ask-ring: var(--line-2);
  background: none; backdrop-filter: none; border-radius: 18px; box-shadow: none;
  transition-property: top, right, bottom, width, border-radius;
  transition-duration: .52s; transition-timing-function: cubic-bezier(.32, .72, 0, 1);
}
.ask-island[data-workspace="home"][data-home="half"] {
  top: 12px; right: 12px; bottom: 12px; left: auto; width: var(--ask-dock-w); height: auto;
}
.ask-island:is([data-home], [data-fullscreen])::before {
  position: absolute; inset: 0; z-index: -1; content: ""; background: var(--ask-glass); border-radius: inherit;
  box-shadow: inset 0 0 0 1px var(--ask-ring);
  transition: background-color .52s cubic-bezier(.32, .72, 0, 1), box-shadow .52s cubic-bezier(.32, .72, 0, 1);
}
/* Scoped CSS keeps the html ancestor as written; :global() would swallow the whole selector and hide the page. */
html[data-home-vt] .ask-island[data-home]::before { opacity: 0; }
.ask-island[data-workspace][data-fullscreen] {
  --ask-glass: var(--canvas); --ask-ring: transparent;
  top: var(--ask-viewport-top, 0px); right: auto; bottom: auto; left: var(--ask-viewport-left, 0px);
  width: var(--ask-available-width, 100vw); height: var(--ask-available-height, 100dvh); border-radius: 0;
  transition-property: border-radius;
}
.ask-island:is([data-home], [data-fullscreen]) :deep(.ask-stream), .ask-island:is([data-home], [data-fullscreen]) .ask-bottom { padding-inline: max(16px, calc((100% - 760px) / 2)); }
.ask-island[data-fullscreen] .ask-head { height: calc(48px + env(safe-area-inset-top)); padding: env(safe-area-inset-top) max(14px, env(safe-area-inset-right)) 0 max(18px, env(safe-area-inset-left)); }
.ask-island[data-fullscreen] .ask-bottom { padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
.ask-island:is([data-home], [data-fullscreen]) :is(.ask-handle, .ask-fill) { cursor: default; touch-action: auto; }
:global(body:has(.ask-island[data-fullscreen])) { overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .ask-island:is([data-home], [data-fullscreen]), .ask-island:is([data-home], [data-fullscreen])::before { transition: none; } }
</style>
