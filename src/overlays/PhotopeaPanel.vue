<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useEditor } from "../app/editor.ts";
import { useUi, message } from "../app/ui.ts";
import type { Editor } from "../services/editor.ts";
import { createPhotopeaClient } from "../native/photopea-client.ts";
import type { PhotopeaClient } from "../native/photopea-client.ts";
import { photopeaInput, maskStateBitmap } from "../native/photopea-input.ts";
import { photopeaUrl } from "../native/photopea-scripts.ts";
import type { PhotopeaReturnMode } from "../native/photopea-scripts.ts";
import type { PhotopeaRoles } from "../native/photopea-scripts.ts";
import { placeMenu, menuKeys } from "../shared/popover.ts";
import AppIcon from "../shared/AppIcon.vue";

const props = defineProps<{ start?: ReturnType<Editor["beginExternalEdit"]>; title: string }>();
const emit = defineEmits<{ close: [] }>();
const { editor, view } = useEditor(), ui = useUi();
const frame = shallowRef<HTMLIFrameElement>(), menu = shallowRef<HTMLElement>(), choice = shallowRef<HTMLButtonElement>();
const src = shallowRef<string>(), attempt = shallowRef(0), ready = shallowRef(false), working = shallowRef(false), error = shallowRef("");
const applying = shallowRef(false);
const mode = shallowRef<PhotopeaReturnMode>("auto"), expanded = shallowRef(false);
const labels: Record<PhotopeaReturnMode, string> = { auto: "自动", image: "仅图像", mask: "仅蒙版" };
const frozen = computed(() => !props.start || !ready.value || working.value);
let client: PhotopeaClient | undefined, revision = 0, disposed = false, confirming = false;
let exitDecision: Promise<boolean> | undefined;
// The iframe owns the layered document. This record only binds it to the EDIT
// session/version; a returned PNG must never replace that same document.
type Retained = {
  sessionId: string; sourceId: number; width: number; height: number; documentId: string; roles: PhotopeaRoles;
  maskKey?: string; bakedVersion?: number; baked: number[];
};
let retained: Retained | undefined;
const documents = new Map<string, Retained>();
async function maskKey(state: NonNullable<typeof props.start>["mask"]) {
  if (!state) return "empty";
  const bitmap = await maskStateBitmap(state);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bitmap.bits));
  return `${bitmap.width}x${bitmap.height}:${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("")}`;
}
let reflowTimer = 0;
function cancelReflow() {
  window.clearTimeout(reflowTimer); reflowTimer = 0;
  frame.value?.style.removeProperty("width");
}
function scheduleReflow(current: number) {
  cancelReflow();
  // The completed open has consumed Photopea's done replies. Give extension layout
  // changes a short settling interval, then resize only our own iframe viewport.
  reflowTimer = window.setTimeout(() => {
    reflowTimer = 0;
    if (disposed || current !== revision || !props.start || !ready.value) return;
    const target = frame.value, bounds = target?.getBoundingClientRect();
    if (!target || !bounds || bounds.width <= 1 || bounds.height <= 0) return;
    target.style.width = `${bounds.width - 1}px`;
    // Let the cross-process child receive the smaller viewport before restoring it.
    reflowTimer = window.setTimeout(() => {
      target.style.removeProperty("width"); reflowTimer = 0;
    }, 50);
  }, 150);
}
// Keep the transport alive, and drain old work before a new visit imports its source.
let operation: Promise<void> = Promise.resolve();
function enqueue(work: () => Promise<void>) {
  const task = operation.then(work);
  operation = task.catch(() => {});
  return task;
}

async function load(start: NonNullable<typeof props.start>, reload = false) {
  cancelReflow();
  const current = ++revision;
  ready.value = false; working.value = true; error.value = "";
  try {
    await enqueue(async () => {
      if (disposed || current !== revision) return;
      if (!client || client.failed || reload) {
        client?.dispose(); client = undefined;
        retained = undefined; documents.clear();
        src.value = undefined; attempt.value++;
        await nextTick();
        if (disposed || current !== revision || !frame.value) return;
        const connection = createPhotopeaClient(frame.value, start.id, {
          onSave: () => { if (props.start && ready.value && !working.value) void apply(); },
          onFatal: text => {
            if (client === connection && props.start) { cancelReflow(); error.value = text; ready.value = false; working.value = false; }
          },
        });
        client = connection; src.value = photopeaUrl(start.id);
      }
      const connection = client;
      const images = await photopeaInput(start.image, start.mask);
      const key = await maskKey(start.mask), previous = documents.get(start.sessionId);
      if (disposed || current !== revision) return;
      const reuse = previous && previous.sessionId === start.sessionId && previous.width === start.width && previous.height === start.height
        ? { documentId: previous.documentId, roles: previous.roles, sameImage: previous.sourceId === start.sourceId,
          refreshMask: previous.maskKey !== key,
          baked: previous.bakedVersion && start.ancestors.includes(previous.bakedVersion) ? previous.baked : [] }
        : undefined;
      if (previous && !reuse) { await connection.closeDocument(previous.documentId); documents.delete(start.sessionId); }
      await connection.open(images.image, images.mask, start.id, reuse, start.mode === "inpaint");
      if (disposed || current !== revision) return;
      const state = connection.stack;
      if (!state || state.baseId < 1) throw new Error("未能核验 Photopea 原图层，请重新载入");
      retained = { sessionId: start.sessionId, sourceId: start.sourceId, width: start.width, height: start.height,
        documentId: start.id, roles: {baseId:state.baseId,scratchId:state.scratchId,maskId:state.maskId,carrierId:state.carrierId}, maskKey: key,
        bakedVersion: reuse?.sameImage ? previous?.bakedVersion : undefined, baked: reuse?.sameImage ? previous?.baked ?? [] : [] };
      documents.set(start.sessionId, retained);
      ready.value = true; working.value = false;
      scheduleReflow(current);
      await nextTick();
      if (!disposed && current === revision) frame.value?.focus({ preventScroll: true });
    });
  } catch (e) { if (!disposed && current === revision) error.value = message(e); }
  finally { if (!disposed && current === revision) working.value = false; }
}
watch(() => view.value.boards.map(b => b.id), ids => {
  const removed = [...documents.entries()].filter(([id]) => !ids.includes(id));
  if (!removed.length) return;
  void enqueue(async () => {
    for (const [id, doc] of removed) {
      if (documents.get(id) !== doc) continue;
      if (client && !client.failed) await client.closeDocument(doc.documentId);
      documents.delete(id);
    }
  }).catch(e => { error.value = message(e); });
});
async function apply() {
  const start = props.start;
  if (!start || !ready.value || working.value || !client || client.failed) return;
  const current = revision, connection = client, returnMode = mode.value;
  working.value = true; error.value = "";
  menu.value?.hidePopover();
  // Inert removes both mouse and keyboard access while one script exports the pair.
  await nextTick();
  try {
    await enqueue(async () => {
      if (disposed || current !== revision) return;
      const result = await connection.export(returnMode);
      // A pending discard question must not race a successful return into Koma.
      if (exitDecision && await exitDecision) return;
      if (disposed || current !== revision) return;
      applying.value = true;
      const added = await editor.applyExternalEdit(start.id, result);
      if (retained && retained.documentId === start.id) {
        retained.sourceId = added?.id ?? start.sourceId;
        retained.width = added?.width ?? start.width; retained.height = added?.height ?? start.height;
        if (added) { retained.bakedVersion = added.id; retained.baked = connection.stack?.visible.filter(id => id !== retained!.roles.baseId) ?? []; }
        // Image-only explicitly ignores the current selection; refresh it from
        // the authoritative EDIT mask on the next visit.
        retained.maskKey = returnMode === "image" ? undefined : await maskKey(editor.session.mask);
      }
      if (!disposed && current === revision) emit("close");
    });
  } catch (e) { if (!disposed && current === revision) error.value = message(e); }
  finally { applying.value = false; if (!disposed && current === revision) working.value = false; }
}
async function requestBack() {
  const start = props.start;
  if (!start || confirming || applying.value) return;
  confirming = true;
  try {
    if (ready.value) {
      exitDecision = ui.confirm({ title: "暂不应用并返回？", message: "分层编辑保留在本页的 Photopea 中，尚未写回 Koma。", confirmLabel: "暂不应用" });
      if (!await exitDecision) return;
    }
    if (!disposed && props.start === start) { revision++; editor.cancelExternalEdit(start.id, ready.value); emit("close"); }
  } finally { confirming = false; exitDecision = undefined; }
}
async function reload() {
  const start = props.start;
  if (!start || confirming) return;
  confirming = true;
  try {
    if (ready.value && !await ui.confirm({ title: "重新载入原图？", message: "所有编辑画板的 Photopea 分层文档将被重建，请先另存需要保留的 PSD。", confirmLabel: "重新载入", tone: "danger" })) return;
    if (!disposed && props.start === start) await load(start, true);
  } finally { confirming = false; }
}
function position() { if (menu.value && choice.value) placeMenu(menu.value, choice.value.getBoundingClientRect()); }
function choose(value: PhotopeaReturnMode) { mode.value = value; menu.value?.hidePopover(); choice.value?.focus(); }
function onKeys(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation();
    if (menu.value?.matches(":popover-open")) { menu.value.hidePopover(); choice.value?.focus(); }
    else void requestBack();
  }
}
function beforeToggle(event: ToggleEvent) {
  expanded.value = event.newState === "open";
  if (expanded.value && menu.value) { menu.value.style.display = "grid"; position(); menu.value.style.removeProperty("display"); }
}
function toggled(event: ToggleEvent) {
  position();
  if (event.newState === "open") menu.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
}
function choiceKeys(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault(); menu.value?.showPopover();
}
function beforeLeave(event: BeforeUnloadEvent) {
  if (!props.start || !ready.value) return;
  event.preventDefault(); event.returnValue = "";
}
watch(() => props.start, start => {
  cancelReflow();
  menu.value?.hidePopover();
  window.removeEventListener("resize", position); window.removeEventListener("beforeunload", beforeLeave);
  if (start) {
    mode.value = "auto";
    window.addEventListener("resize", position); window.addEventListener("beforeunload", beforeLeave);
    void load(start);
  } else { revision++; ready.value = false; working.value = false; error.value = ""; }
}, { immediate: true });
onBeforeUnmount(() => {
  cancelReflow();
  disposed = true; revision++; client?.dispose();
  window.removeEventListener("resize", position); window.removeEventListener("beforeunload", beforeLeave);
  if (props.start) editor.cancelExternalEdit(props.start.id);
});
defineExpose({ requestBack });
</script>
<template>
  <section class="photopea-panel" aria-label="Photopea 高级编辑" @keydown="onKeys">
    <header class="photopea-bar">
      <button class="ibtn" type="button" aria-label="返回 EDIT" title="返回 EDIT" :disabled="applying" @click="requestBack"><AppIcon name="i-back" /></button>
      <div class="photopea-title"><strong :title="title">Photopea</strong></div>
      <span v-if="working" class="photopea-status sr-only" role="status">{{ ready ? '正在回传…' : '正在载入…' }}</span>
      <div class="photopea-apply">
        <button class="btn btn-primary btn-sm photopea-submit" type="button" aria-label="应用并返回" title="应用并返回" :disabled="frozen || client?.failed" @click="apply"><AppIcon name="i-check" /></button>
        <button ref="choice" class="btn btn-primary btn-sm photopea-choice" type="button" :disabled="frozen"
          aria-haspopup="menu" aria-controls="photopea-return-menu" :aria-expanded="expanded" :aria-label="`回传方式：${labels[mode]}`" popovertarget="photopea-return-menu" @keydown="choiceKeys">
          <span>{{ labels[mode] }}</span><AppIcon name="i-chevron" />
        </button>
      </div>
      <div id="photopea-return-menu" ref="menu" class="menu photopea-menu" popover="auto" role="menu" aria-label="回传方式" @beforetoggle="beforeToggle" @toggle="toggled" @keydown="menuKeys">
        <button v-for="(label, value) in labels" :key="value" class="menu-item" role="menuitemradio" type="button" :aria-checked="mode === value" @click="choose(value)"><span class="menu-label">{{ label }}</span><AppIcon name="i-check" class="menu-check" /></button>
      </div>
    </header>
    <div v-if="error" class="photopea-error" role="alert"><span>{{ error }}</span><button class="btn btn-quiet btn-sm" type="button" @click="reload">重新载入</button></div>
    <div class="photopea-frame">
      <iframe :key="attempt" ref="frame" :src="src" title="Photopea 图像编辑器" :inert="frozen" referrerpolicy="origin"
        sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-modals" allow="clipboard-read; clipboard-write" />
      <div v-if="!ready" class="photopea-loading" role="status"><span>{{ error ? '未能打开编辑器' : '正在打开 Photopea…' }}</span></div>
    </div>
  </section>
</template>
<style scoped>
.photopea-panel { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; background: var(--chrome); }
.photopea-bar { display: flex; flex: none; align-items: center; gap: var(--sp-2); height: 30px; padding: 2px 8px; border-bottom: 1px solid var(--line); }
.photopea-bar .ibtn { width: 24px; height: 24px; --ico: var(--ico-sm); }
.photopea-title { display: flex; align-items: baseline; gap: var(--sp-2); flex: 1; min-width: 0; font-size: var(--fz-xs); }
.photopea-title strong { font-weight: var(--fw-semibold); }
.photopea-apply { display: flex; flex: none; }
.photopea-apply .btn { height: 24px; padding: 0 6px; font-size: var(--fz-2xs); --ico: var(--ico-xs); }
.photopea-apply .photopea-submit { width: 24px; padding: 0; }
.photopea-apply > :first-child { border-radius: var(--r1) 0 0 var(--r1); }
.photopea-apply > :last-child { border-radius: 0 var(--r1) var(--r1) 0; border-left: 1px solid var(--a-line); }
.photopea-choice { gap: 4px; padding-inline: 8px; }
.photopea-choice .ico { transform: rotate(90deg); --ico: var(--ico-xs); }
.photopea-menu { width: 180px; }
/* Avoid focus scrolling; keep the full third-party editor, including its right panels. */
.photopea-frame { position: relative; overflow: clip; display: block; flex: 1; width: 100%; height: 100%; min-height: 0; }
.photopea-frame iframe { position: absolute; top: 0; left: 0; display: block; width: 100%; max-width: none; height: 100%; margin: 0; border: 0; }
.photopea-loading { position: absolute; inset: 0; display: grid; place-items: center; background: var(--canvas); color: var(--fg-3); font-size: var(--fz-sm); }
.photopea-error { display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: var(--err-dim); color: var(--err); font-size: var(--fz-xs); }
.photopea-error span { flex: 1; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .photopea-bar { gap: 4px; padding-inline: 4px; }
}
@media (pointer: coarse) {
  .photopea-bar { height: 34px; }
  .photopea-bar .ibtn, .photopea-apply .photopea-submit { width: 28px; height: 28px; }
  .photopea-apply .btn { height: 28px; }
}
</style>
