<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
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
import { summary as replySummary } from "./format.ts";
import { ATTACHMENT_LIMITS } from "./attachments.ts";
import { names } from "../storage/names.ts";

const ask = useAsk();
const { router, image, chat } = useShell();
const root = shallowRef<HTMLElement | null>(null),
  expanded = shallowRef(false),
  composer = shallowRef<InstanceType<typeof AskComposer> | null>(null),
  dismissedTurn = shallowRef(0),
  dismissedApplied = shallowRef<object | null>(null);
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
  if (!acceptsInput() || !data || !["Files", names.historyDragType].some(type => data.types.includes(type))) return;
  event.stopPropagation();
  if (event.type === "dragleave") {
    dragDepth = Math.max(0, dragDepth - 1); dropping.value = dragDepth > 0;
    return;
  }
  event.preventDefault();
  if (event.type === "drop") {
    clearDrop();
    const id = data.getData(names.historyDragType);
    if (id) ask.referenceHistory(id);
    else void ask.addFiles([...data.files]);
    void composer.value?.focus(true);
  } else {
    if (event.type === "dragenter") dragDepth++;
    dropping.value = true; data.dropEffect = "copy";
  }
}
const controller = new AbortController();
let place = () => {};
const latest = computed(() => [...ask.entries.value].reverse().find(e => e.type === "turn")?.turn);
const mode = computed(() => ask.visible.value ? "exp" : ask.running.value ? "run"
  : ask.draftPlan.value ? "ready"
  : ask.appliedDraft.value && dismissedApplied.value !== ask.appliedDraft.value ? "done"
  : latest.value && latest.value.id > dismissedTurn.value ? "ready" : "idle");
const tools = computed(() => (ask.live.value ?? latest.value)?.items.flatMap(i => i.kind === "tools" ? i.rows : []) ?? []);
const compactDraft = computed(() => !!ask.draftPlan.value);
const completed = computed(() => tools.value.filter(t => t.state === "done").length);
const activity = computed(() => {
  const row = tools.value.find(t => t.state === "run");
  if (row) return { verb: `正在${row.verb}`, object: row.object, stat: row.stat, key: row.id };
  if (ask.live.value?.items.at(-1)?.kind === "text") return { verb: "正在整理", object: "回复", stat: "", key: "reply" };
  const previous = tools.value.at(-1);
  return previous ? { verb: previous.state === "done" ? `已${previous.verb}` : `未能${previous.verb}`, object: previous.object, stat: previous.stat, key: `${previous.id}-done` }
    : { verb: "正在思考", object: "", stat: "", key: "thinking" };
});
const outcome = computed(() => latest.value?.status === "failed" ? "未能完成" : latest.value?.status === "stopped" ? "已停止" : "已完成");
const summary = computed(() => {
  const turn = latest.value;
  if (turn?.status === "failed") return [{ t: "text" as const, v: turn.failure?.message ?? "请展开查看详情" }];
  if (turn?.status === "stopped") return [{ t: "text" as const, v: "本轮已停止，未计入对话。" }];
  const text = [...(turn?.items ?? [])].reverse().find(i => i.kind === "text")?.text ?? "";
  const first = replySummary(text);
  return first.length ? first : [{ t: "text" as const, v: ask.draftPlan.value ? "草稿已就绪，请核对后应用。" : "请展开查看详情。" }];
});
const dimensions = computed(() => ({
  "--ask-width": `${mode.value === "idle" ? 40 : mode.value === "run" ? 304 : mode.value === "ready" ? 372 : mode.value === "done" ? 172 : expanded.value ? 760 : 420}px`,
  "--ask-height": mode.value === "exp" ? expanded.value ? "calc(var(--ask-available-height, 100dvh) - 32px)" : "660px" : mode.value === "ready" ? "var(--ask-ready-height, 160px)" : "40px",
}));
function dismiss() {
  dismissedTurn.value = latest.value?.id ?? 0;
  dismissedApplied.value = ask.appliedDraft.value;
}
onMounted(() => {
  window.addEventListener("dragend", clearDrop, { signal: controller.signal });
  if (root.value) {
    ask.attach(root.value, dismiss);
    place = installAskWindow(root.value, controller.signal);
  }
});
watch([mode, ask.inline, expanded, () => router.route.value.workspace, () => image.historyOpen, () => chat.contextOpen], () => void nextTick(place), { flush: "post" });
// Discarding a draft also dismisses its compact answer, including through Esc.
watch(ask.draftPlan, (plan, previous) => { if (!plan && previous && !ask.appliedDraft.value) dismiss(); });
watch(ask.appliedDraft, (value, previous) => { if (!value && previous) dismiss(); });
let doneTimer: ReturnType<typeof setTimeout> | undefined;
watch([mode, ask.appliedDraft], ([state]) => {
  clearTimeout(doneTimer);
  if (state === "done") doneTimer = setTimeout(dismiss, 3000);
});
// Another conversation's last answer must not pop up as a compact card.
watch(ask.conversationId, () => { dismiss(); clearDrop(); });
watch(() => router.route.value.overlay, clearDrop);
watch(ask.visible, visible => { if (!visible) { clearDrop(); ask.closeAttachment(); } });
function resize() {
  if (!ask.inline.value) expanded.value = !expanded.value;
}
/** A starter only fills the input, on a new line after any draft text. */
function start(text: string) {
  const current = ask.input.value.trimEnd();
  ask.setInput(current ? `${current}\n${text}` : text);
  void composer.value?.focus(true);
}
let returnFocus: HTMLElement | null = null;
watch([ask.visible, ask.inline], async ([visible]) => {
  const active = document.activeElement;
  if (visible) {
    dismiss();
    if (active instanceof HTMLElement && active !== document.body && !root.value?.contains(active)) returnFocus = active;
    await nextTick();
    composer.value?.focus();
  } else if (active instanceof HTMLElement && root.value?.contains(active)) {
    await nextTick();
    if (ask.visible.value || document.querySelector("dialog:modal")) return;
    if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
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
onBeforeUnmount(() => { clearTimeout(doneTimer); controller.abort(); ask.attach(null); });
</script>
<template>
  <aside v-show="router.route.value.overlay !== 'editor'" id="askIsland" ref="root" class="ask-island" :class="{ 'ask-inline': !!ask.inline.value && ask.visible.value }" :data-mode="mode" :data-workspace="router.route.value.workspace" :data-context-open="chat.contextOpen || undefined" :data-quiet="router.route.value.workspace === 'image' && image.state === 'busy' || undefined" :style="dimensions" aria-label="Koma ASK" aria-describedby="askMoveHint">
    <button v-show="mode === 'idle'" id="askLauncher" class="ask-layer ask-launcher ask-open" :inert="mode !== 'idle'" data-ask-grip type="button" aria-label="打开 Koma ASK" aria-controls="askDrawer" aria-expanded="false" title="Koma ASK · 可拖动 · ⌘J / Ctrl+J" @click="ask.show()"><AskMark interactive /></button>
    <div v-show="mode === 'run'" class="ask-layer ask-run" :inert="mode !== 'run'">
      <button class="ask-open ask-run-grip" data-ask-grip type="button" aria-label="展开 ASK 对话" @click="ask.show()"><AskMark thinking /><span :key="activity.key" class="ask-activity" :title="`${activity.verb} ${activity.object} ${activity.stat}`"><span class="ask-verb">{{ activity.verb }}</span><span v-if="activity.object" class="ask-object">{{ activity.object }}</span><span v-if="activity.stat" class="ask-stat">{{ activity.stat }}</span></span></button>
      <span class="ask-progress" :class="{ empty: !completed }" :title="`${completed} 项工具已完成`">{{ completed > 99 ? '99+' : completed }}✓</span>
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
    <div v-show="ask.visible.value" id="askDrawer" class="ask-layer ask-window" :class="{ 'ask-inline': !!ask.inline.value, 'ask-expanded': expanded && !ask.inline.value }" :inert="!ask.visible.value" role="dialog" aria-modal="false" aria-label="Koma ASK" @paste="paste" @dragenter="drag" @dragover="drag" @dragleave="drag" @drop="drag">
      <header class="ask-head">
        <div class="ask-handle" data-ask-grip :tabindex="ask.inline.value ? -1 : 0" role="group" aria-label="移动 ASK 窗口" aria-describedby="askMoveHint" @dblclick="resize"><AskMark :thinking="ask.running.value" /></div>
        <AskConversations @chosen="composer?.focus(true)" />
        <div class="ask-fill" data-ask-grip aria-hidden="true" @dblclick="resize"></div>
        <button v-if="ask.inline.value" class="btn btn-quiet btn-xs" type="button" @click="ask.expand()">展开</button>
        <button v-else class="ibtn" type="button" :aria-label="expanded ? '还原 ASK 窗口' : '放大 ASK 窗口'" :title="expanded ? '还原' : '放大'" @click="resize"><AppIcon :name="expanded ? 'i-shrink' : 'i-expand'" /></button>
        <AskMore @debug="inspect()" />
        <button class="ibtn" type="button" aria-label="收起 ASK" title="收起" @click="ask.hide()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
      </header>
      <AskStream @start="start" @focus="composer?.focus(true)" />
      <div class="ask-bottom"><div id="askFullDraft" class="ask-full-draft"></div><AskComposer ref="composer" /></div>
      <AskAttachmentPreview v-if="ask.attachmentPreview.value" :key="ask.attachmentPreview.value.id" />
      <div v-if="dropping" class="ask-drop" aria-hidden="true"><span>松开即可添加到这条提问</span></div>
    </div>
    <Teleport :to="mode === 'ready' && compactDraft ? '#askCompactDraft' : '#askFullDraft'" defer><DraftCard :compact="mode === 'ready'" @review="ask.show()" /></Teleport>
    <div class="sr-only" role="status" aria-live="polite"><span :key="ask.announce.value.id">{{ ask.announce.value.text }}</span></div>
    <span id="askMoveHint" class="sr-only">拖动图标或标题栏移动；Alt 加方向键移动，Alt 加 Home 归位。⌘J 或 Ctrl+J 展开或收起。</span>
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
.ask-activity { display: flex; flex: 1; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; font-size: 13px; line-height: 1; white-space: nowrap; animation: ask-activity-in .22s var(--e); }
.ask-verb { flex: none; color: var(--fg-3); font-weight: var(--fw-regular); }
.ask-object { min-width: 0; overflow: hidden; font-weight: var(--fw-medium); text-overflow: ellipsis; background: linear-gradient(90deg, var(--fg-3), var(--fg), var(--fg-3)); background-size: 250% 100%; background-clip: text; color: transparent; animation: ask-shimmer 2.4s ease-in-out infinite; }
.ask-stat { flex: none; color: var(--fg-4); font: var(--fw-regular) 11.5px/1 var(--mono); font-variant-numeric: tabular-nums; }
/* Status only: stopping and undoing live in the window, never on the island. */
.ask-progress { display: grid; flex: none; place-items: center; width: 34px; height: 20px; padding: 0 4px; color: var(--fg-3); font: var(--fw-medium) 11px/1 var(--mono); font-variant-numeric: tabular-nums; background: var(--ask-hover); border-radius: 10px; transition: opacity .15s var(--e); }
.ask-progress.empty { opacity: 0; }
.ask-island :deep(.ibtn) { flex: none; width: 26px; height: 26px; border-radius: 13px; }
.ask-island :deep(.ibtn:hover), .ask-island :deep(.btn-quiet:hover) { background: var(--ask-hover); }
.ask-island :deep(.ibtn .ico) { width: 13px; height: 13px; }
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
.ask-done :deep(.ico) { flex: none; width: 16px; height: 16px; color: var(--ok); }
.ask-done b { color: var(--fg); font-weight: var(--fw-semibold); }
.ask-window { position: relative; display: flex; flex-direction: column; height: 100%; }
.ask-head { display: flex; flex: none; align-items: center; gap: 4px; height: 48px; padding: 0 10px 0 14px; }
.ask-head :deep(.ibtn) { width: 30px; height: 30px; color: var(--fg-3); border-radius: 8px; }
.ask-head :deep(.ibtn .ico) { width: 16px; height: 16px; }
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
@keyframes ask-activity-in { from { opacity: 0; transform: translateY(2px); } }
@keyframes ask-shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@keyframes ask-ready-ping { from { box-shadow: 0 0 0 1px var(--a), 0 0 0 0 color-mix(in srgb, var(--a) 35%, transparent), 0 10px 32px rgba(0, 0, 0, .45); } to { box-shadow: 0 0 0 1px var(--line-2), 0 0 0 14px transparent, 0 10px 32px rgba(0, 0, 0, .45); } }
@media (prefers-reduced-motion: reduce) {
  .ask-island[data-mode] { transition-property: none; animation: none; }
  .ask-layer, .ask-activity, .ask-object { animation: none; }
  .ask-island[data-mode="idle"]:has(.ask-launcher:active):not([data-dragging]) { transform: none; }
  .ask-object { color: var(--fg); background: none; }
  .ask-launcher:hover :deep(.ask-mark.interactive rect) { transform: none; }
  .ask-launcher::before, .ask-launcher::after, .ask-launcher :deep(.ask-mark.interactive rect), .ask-launcher:hover :deep(.ask-mark.interactive rect) { animation: none; transition: none; }
  .ask-launcher::before, .ask-launcher:hover::before { opacity: .12; transform: scale(.7); }
}
</style>
