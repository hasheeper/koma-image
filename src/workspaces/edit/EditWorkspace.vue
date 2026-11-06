<script setup lang="ts">
import ModelParameterInput from "../../shared/ModelParameterInput.vue";
import {
  computed,
  defineAsyncComponent,
  ref,
  shallowRef,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";

import { useEditor } from "../../app/editor";
import { useShell } from "../../app/shell";
import { useAskPresentation } from "../../ask/presentation";
const { fullscreen: askFullscreen } = useAskPresentation();
const annotations = useAnnotations(), ask = useAsk();
const selection = shallowRef<InstanceType<typeof RegionAnnotator>>();
const selectionHost = shallowRef<AnnotationViewport>();
const annotationToolbar = shallowRef<HTMLElement>();
const sendingSelection = shallowRef(false);
const selecting = computed(() => !!annotations.active.value?.target.inline && annotations.active.value.target.edit?.boardId === editor.session.id && annotations.active.value.target.edit?.versionId === view.value.viewed?.id);
function closeSelection() { if (annotations.active.value?.target.inline) { selection.value?.saveComment(false); annotations.close(); } }
/** CHAT goes to the board's own conversation unless `fresh`; a clean picture there joins as a reference. */
async function sendSelection(action: 'ask' | 'chat', fresh = false) {
  const v=shown.value; if (!v || unsavedPreview.value || sendingSelection.value) return;
  sendingSelection.value=true;
  try {
    selection.value?.saveComment(false);
    if (selecting.value && annotations.active.value!.snapshot.regions.length) { await annotations.act(action, fresh); return; }
    if (action === 'ask') { await ask.addFiles([new File([v.blob], v.name || '编辑图片.png', {type:v.blob.type})]); ask.show(); }
    else if (!fresh && chatSource.value) await editor.useResult(v.id);
    else {
      const ticket=await createHandoff(services).queue(v.blob,v.name);
      const url=new URL(location.href);url.searchParams.set('image',ticket);history.replaceState(history.state,'',url);
      router.switchWorkspace('chat');ui.imageDelivery.value++;
    }
    closeSelection();
  } catch(e) { ui.toast(message(e),'err'); }
  finally { sendingSelection.value=false; }
}
async function annotate(initialTool: AnnotationShape = 'point') {
  if (selecting.value) { selection.value?.choose(initialTool); return; }
  const v=view.value.viewed;if(!v)return;
  saveMask();focusRegion?.cancel();focusTool.value=false;canvas?.setHand(false);syncMaskLock();
  try { await annotations.open({blob:v.blob,name:v.name,recordId:v.recordId,tag:editor.reference(v),workspace:'edit',initialTool,inline:true,edit:{boardId:editor.session.id,versionId:v.id}}); }
  catch(e){ui.toast(message(e),'err');}
}
function reviewAnnotations(){const v=view.value.viewed;if(!v)return;try{annotations.editorReview(editor.session.id,v.id);}catch(e){ui.toast(message(e),'err');}}

import { useAsk } from "../../app/ask";
import { useChat } from "../../app/chat";
import { createHandoff } from "../../services/handoff";
import type { AnnotationShape } from "../../domain/region-annotation";
import { annotationAlignment, canMaskAnnotations } from "../../domain/region-annotation";
import type { AnnotationViewport } from "../../native/region-annotator";
import RegionAnnotator from "../../shared/annotations/RegionAnnotator.vue";
import { useAnnotations } from "../../app/annotations.ts";
import { useServices } from "../../app/services";
import { useUi, message } from "../../app/ui";
import type { EditorSession, EditorVersion } from "../../services/editor";
import { modeNames } from "../../services/editor";
import { editorModels } from "../../domain/media.ts";
import { naiEnhancePrompt } from "../../domain/nai-enhance";
import NaiTokenCount from "../../shared/nai/NaiTokenCount.vue";
import { compileNaiPrompt, naiCapabilities, NAI_OFFICIAL_UPSCALE } from "../../domain/nai.ts";
import { editStrengthRange } from "../../domain/nai-parameters.ts";
import { normalizeOptions } from "../../domain/catalog";
import { quoteLabel } from "../../domain/quote";
import { names } from "../../storage/names";
import { createMaskEditor } from "../../native/mask-editor.ts";
import type { MaskEditor } from "../../native/mask-editor.ts";
import { createEditorCanvas } from "../../native/editor-canvas";
import { createEditorToolbar } from "../../native/editor-toolbar";
import { watchTheme } from "../../native/theme-watch";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import ThemeToggle from "../../shared/ThemeToggle.vue";
import EditBoards from "./EditBoards.vue";
import { createFocusRegion } from "../../native/focus-region";
import EditToolMode from "./EditToolMode.vue";
import EnhanceControl from "./EnhanceControl.vue";
import DirectorTools from "./DirectorTools.vue";
import { placeEditorPanel } from "./panels";
import { directorName, directorTools, directorVariantNames } from "../../domain/director-tools";
import AppIcon from "../../shared/AppIcon.vue";
import PopoverMenu from "../../shared/ui/PopoverMenu.vue";
import WalletDisplay from "../../shared/WalletDisplay.vue";
import HighlightInput from "../../shared/HighlightInput.vue";
import { provideNaiComposer } from "../../app/nai-composer";
import ModelField from "../../shared/nai/ModelField.vue";
import NaiPromptOptions from "../../shared/nai/NaiPromptOptions.vue";
import CharactersEditor from "../../shared/nai/CharactersEditor.vue";
import DrawingBottomPanel from "../../shared/nai/DrawingBottomPanel.vue";
import EditorParameters from "../../overlays/EditorParameters.vue";
import EditImageParameters from "./EditImageParameters.vue";
const PhotopeaPanel = defineAsyncComponent(() => import("../../overlays/PhotopeaPanel.vue"));
const { editor, view } = useEditor(),
  { router, narrow } = useShell(),
  services = useServices(),
  ui = useUi();
const dialog = shallowRef<HTMLElement | null>(null),
  file = shallowRef<HTMLInputElement | null>(null),
  maskFile = shallowRef<HTMLInputElement | null>(null),
  pop = shallowRef<HTMLElement | null>(null),
  focusHost = shallowRef<HTMLElement | null>(null),
  maskCanvas = shallowRef<HTMLCanvasElement | null>(null),
  elapsed = shallowRef<HTMLElement | null>(null);
const boards = shallowRef<InstanceType<typeof EditBoards>>();
const inpaintMode = shallowRef<InstanceType<typeof EditToolMode>>();
const upscaleMode = shallowRef<InstanceType<typeof EditToolMode>>();
const directorPanel = shallowRef<InstanceType<typeof DirectorTools>>();
const bottomPanel = shallowRef<InstanceType<typeof DrawingBottomPanel>>();
const photopea = shallowRef<ReturnType<typeof editor.beginExternalEdit>>();
const photopeaCreated = shallowRef(false);
const tab = ref<"prompt" | "negative_prompt">("prompt"),
  brush = ref(64),
  eraser = ref(false),
  focusTool = ref(false),
  undo = ref(false),
  redo = ref(false),
  comparing = ref(false),
  rail = ref(true),
  canvasFullscreen = ref(false),
  drop = ref("");
const comparisonMode = shallowRef<'source' | 'raw' | 'composite'>('raw'), previewImage = shallowRef<EditorVersion>();
const previewBusy = shallowRef(false), previewError = shallowRef('');
let previewController: AbortController | undefined;
const comparison = computed(() => {
  const info = view.value.viewed?.comparison;
  if (!info) return;
  const versions = view.value.session.versions;
  const source = versions.find(v => v.id === info.sourceId), raw = versions.find(v => v.id === info.rawId), composite = versions.find(v => v.id === info.compositeId);
  if (source && raw) return { source, raw, composite, info, compatible: !!annotationAlignment(source, raw) };
});
const unsavedPreview = computed(() => !!comparison.value && comparisonMode.value === 'composite' && !comparison.value.composite);
const { chat, view: chatView } = useChat();
const chatSource = computed(() => { const id = s.value.origin === 'chat' ? s.value.conversationId : undefined; return id ? chatView.value.conversations.find(c => c.id === id) : undefined; });
const sendCount = computed(() => selecting.value ? annotations.active.value?.snapshot.regions.length ?? 0 : 0);
const sendDisabled = computed(() => locked.value || unsavedPreview.value || sendingSelection.value || annotations.busy.value);
async function showComparison(mode: typeof comparisonMode.value) {
  const group = comparison.value;
  if (!group) return;
  closeSelection(); comparing.value = false; previewError.value = '';
  if (mode !== 'composite' || group.composite || previewImage.value) { previewController?.abort(); previewController = undefined; previewBusy.value = false; comparisonMode.value = mode; return; }
  if (!group.info.mask || !group.compatible || previewBusy.value) return;
  const boardId = s.value.id, versionId = group.raw.id;
  previewController?.abort(); const controller = previewController = new AbortController(); previewBusy.value = true;
  try {
    const blob = await editor.previewComparison(boardId, versionId, controller.signal);
    if (controller.signal.aborted || comparison.value?.raw !== group.raw) return;
    previewImage.value = { ...group.raw, blob, url: URL.createObjectURL(blob), width: group.source.width, height: group.source.height };
    comparisonMode.value = 'composite';
  } catch (e) { if (!controller.signal.aborted) previewError.value = message(e); }
  finally { if (previewController === controller) previewBusy.value = false; }
}
async function applyComparison() {
  const group = comparison.value; if (!group) return;
  try { await editor.applyComparison(s.value.id, group.raw.id); }
  catch (e) { ui.toast(message(e), 'err'); }
}
function clearPreview() {
  previewController?.abort(); previewController = undefined; previewBusy.value = false; previewError.value = '';
  if (previewImage.value) URL.revokeObjectURL(previewImage.value.url);
  previewImage.value = undefined;
}
function submitEdit() { selection.value?.saveComment(false); closeSelection(); void editor.run(); }
const s = computed(() => view.value.session),
  locked = computed(
    () => view.value.busy || view.value.reading || view.value.preparing,
  ),
  shown = computed(() =>
    comparing.value
      ? s.value.versions.find((v) => v.id === view.value.viewed?.parentId) ||
        view.value.viewed
      : comparison.value ? comparisonMode.value === 'source' ? comparison.value.source : comparisonMode.value === 'composite' ? comparison.value.composite ?? previewImage.value ?? comparison.value.raw : comparison.value.raw : view.value.viewed,
  ),
  parent = computed(() =>
    s.value.versions.find((v) => v.id === view.value.viewed?.parentId),
  );
const medium = computed(() => naiCapabilities(view.value.model?.id ?? "").medium);
const strength = computed(() => view.value.enhancing ? s.value.enhance.strength : s.value.strength[s.value.mode]);
const runLabel = computed(() => view.value.busy ? `${view.value.running === 'director' ? directorName(view.value.runningDirector) : view.value.runningEnhance ? "Enhance" : modeNames[view.value.running]}中…`
  : view.value.generative ? "生成修改图" : view.value.enhancing ? "Enhance" : view.value.focusing ? "聚焦重绘" : modeNames[s.value.mode]);
const strengthRange = computed(() => editStrengthRange(view.value.model?.profileId === "nai-official-v1", s.value.mode === "inpaint"));

const maskActive = computed(
  () =>
    s.value.mode === "inpaint" &&
    s.value.viewId === s.value.baseId &&
    editor.session.maskFor === s.value.baseId &&
    !!view.value.base,
);
const editModels = computed(() =>
    editorModels({ models: view.value.models }, s.value.mode),
  ),
  upModels = computed(() =>
    editorModels({ models: view.value.models }, "upscale"),
  );
provideNaiComposer({
  input: computed(() => {
    const model = view.value.model;
    const compiled = compileNaiPrompt({ ...s.value.fields, negative: s.value.fields.negative_prompt }, model ?? { id: s.value.chosen[s.value.mode], transparentBackground: false });
    return { model: model?.id ?? s.value.chosen[s.value.mode], prompt: view.value.enhancing ? naiEnhancePrompt(compiled.prompt, s.value.enhance.scale) : compiled.prompt, negative_prompt: compiled.negative_prompt, characters: s.value.characters };
  }),
  view: computed(() => ({
    form: { ...s.value.fields, model: s.value.chosen[s.value.mode], negative: s.value.fields.negative_prompt,
      characters: s.value.characters, placement: s.value.placement, naiReferences: s.value.naiReferences,
      width: view.value.base?.width ?? 1, height: view.value.base?.height ?? 1, tagSuggest: false },
    activeBoardId: view.value.contextId, models: editModels.value, model: view.value.model,
    characterCapability: view.value.characterCapability, characterProblem: view.value.characterProblem,
    referenceSupported: view.value.referenceSupported, referenceKinds: view.value.referenceKinds, referenceProblem: view.value.referenceProblem, locked: locked.value,
  })),
  drawing: {
    patch(values) {
      const { model, negative, ...fields } = values;
      if (model !== undefined) editor.setModel(model);
      editor.patch({ ...fields, ...(negative !== undefined ? { negative_prompt: negative } : {}) });
    },
    editCharacters: editor.editCharacters, addCharacter: editor.addCharacter,
    editReferences: editor.editReferences, board: editor.referenceOwner,
  },
  id: name => name === "model" ? "editorModel" : `editor-${name}`,
  stageTarget: "#editorPositionLayer", stageViewport: "#editorViewport",
});
const upOptions = computed(() =>
  view.value.upscaleModel
    ? s.value.options[view.value.upscaleModel.id] ||
      normalizeOptions(view.value.upscaleModel)
    : {},
);
const upChoices = computed(() => {
  const official = upModels.value.filter(m => m.profileId === "nai-official-v1");
  const chosen = official.find(m => m.id === s.value.chosen.upscale) ?? official[0];
  return upModels.value.filter(m => m.profileId !== "nai-official-v1" || m === chosen)
    .filter((m, i, list) => list.findIndex(item => item.id === m.id) === i);
});
const upscaleType = (provider?: string) => provider === "fal" ? "external" : "native";
const upscaleKind = computed(() => upscaleType(view.value.upscaleModel?.provider));
const upscaleTitle = computed(() => upscaleKind.value === "native" ? "原生放大" : "外部放大");
const upscaleChoices = computed(() => upChoices.value.filter(m => upscaleType(m.provider) === upscaleKind.value));
const annotationOptions = [
  { value: "point", label: "点击批注", icon: "i-annotate" },
  { value: "rect", label: "矩形选区", icon: "i-select-rect" },
  { value: "ellipse", label: "椭圆选区", icon: "i-select-ellipse" },
  { value: "polygon", label: "多边形选区", icon: "i-select-polygon" },
];
const annotationTool = computed(() => annotationOptions.find(o => o.value === (selecting.value ? selection.value?.tool : 'point')) ?? annotationOptions[0]);
const inpaintOptions = computed(() => view.value.generative ? [{ value: 'ordinary', label: '绘制蒙版', icon: 'i-mask' }] : [
  { value: "ordinary", label: "普通重绘", icon: "i-mask" },
  { value: "focused", label: "聚焦重绘", icon: "i-frame", disabled: !view.value.focusAvailable },
]);
const upscaleOptions = computed(() => [
  { value: "native", label: "原生放大", icon: "i-upscale", disabled: !upModels.value.some(m => m.provider === "novelai") },
  { value: "external", label: "外部放大", icon: "i-external", disabled: !upModels.value.some(m => m.provider === "fal") },
]);
const ordered = computed(() => {
  const grouped = new Set<string>();
  return (
  [
    view.value.base,
    ...s.value.versions
      .filter((v) => v !== view.value.base)
      .slice()
      .reverse(),
  ].filter((v): v is EditorVersion => {
    if (!v) return false;
    if (!v.director) return true;
    if (grouped.has(v.director.group)) return false;
    grouped.add(v.director.group); return true;
  }).map(v => v.director ? s.value.versions.find(p => p.id === s.value.directorChoices[v.director!.group]) ?? v : v));
});
const variants = computed(() => shown.value?.director?.tool === 'bg-removal' && !comparing.value
  ? s.value.versions.filter(v => v.director?.group === shown.value?.director?.group) : []);
const groupIsBase = (id: number) => id === s.value.baseId || !!s.value.versions.find(v => v.id === id)?.director && s.value.versions.find(v => v.id === id)?.director?.group === view.value.base?.director?.group;
const optionLabels: Record<string, string> = {
  output_format: "格式",
  size: "尺寸",
  image_size: "分辨率",
  aspect_ratio: "比例",
  quality: "质量",
};
const label = (v: typeof shown.value) =>
  v?.comparison ? (v.params?.localComposite ? "蒙版替换" : "AI 生成") : v?.kind === "source" ? "原图" : v?.kind === "manual" ? "手动编辑" : v?.director ? directorName(v.director.tool) : v?.params?.enhance ? v.params.enhanceScale === "max" ? "Enhance Max" : "Enhance" : v?.params?.inpaintFocus ? "聚焦重绘" : v?.mode ? modeNames[v.mode] : "";
const facts = computed(() => {
  const v = shown.value;
  if (!v) return "";
  const list = [`${v.width}×${v.height}`];
  if (v.kind === "result" && v.mode && v.mode !== "upscale" && typeof v.params?.strength === 'number')
    list.push(`强度 ${v.params?.strength}`);
  if (v.kind === "result" && v.mode === "upscale" && parent.value)
    list.push(`×${Number((v.width / parent.value.width).toFixed(2))}`);
  return list.join(" · ");
});
const removeCapture = router.beforeChange((previous, next) => {
  if (previous.workspace === "edit" && next.workspace !== "edit") { saveView(); saveMask(); }
});
const removeGuard = router.guard((previous, next) => {
  if (previous.workspace === "edit" && next.workspace !== "edit" && photopea.value) {
    ui.toast("请先返回 EDIT，保留高级编辑现场"); return false;
  }
  return true;
});
let mask: MaskEditor | undefined,
  focusRegion: ReturnType<typeof createFocusRegion> | undefined,
  canvas: ReturnType<typeof createEditorCanvas> | undefined,
  toolbar: ReturnType<typeof createEditorToolbar> | undefined,
  activeSession: EditorSession | undefined,
  maskRevision = -1,
  syncing = false,
  tick: ReturnType<typeof setInterval> | undefined,
  promptObserver: ResizeObserver | undefined,
  activeEvents: AbortController | undefined,
  unwatchTheme: (() => void) | undefined;
const prefs = () =>
  services.preferences.get<Record<string, unknown>>(names.preferences, {});
function preference(key: string, value: unknown) {
  void services.preferences
    .set(names.preferences, { ...prefs(), [key]: value })
    .catch(() => {});
}
function saveMask() {
  if (activeSession && mask && activeSession.maskFor && activeSession.maskRevision === maskRevision)
    editor.writeMask(activeSession, mask.snapshot(), false);
}
function changedMask() {
  if (!mask || syncing) return;
  undo.value = mask.canUndo();
  redo.value = mask.canRedo();
  if (activeSession) {
    editor.writeMask(activeSession, mask.snapshot());
    maskRevision = activeSession.maskRevision;
  }
}
function compare(value: boolean) {
  comparing.value = value && !!parent.value;
  syncMaskLock();
}
watch(() => comparison.value?.raw, () => {
  clearPreview(); comparisonMode.value = view.value.viewed?.id === comparison.value?.info.compositeId ? 'composite' : 'raw';
});
watch(() => view.value.viewed?.id, () => { if (comparison.value) comparisonMode.value = view.value.viewed?.id === comparison.value.info.compositeId ? 'composite' : 'raw'; });
watch([shown, comparisonMode], () => { void nextTick(() => canvas?.layout()); });
onBeforeUnmount(clearPreview);
function syncMaskLock() {
  mask?.setLocked(locked.value || !maskActive.value || comparing.value || focusTool.value || selecting.value);
  focusRegion?.sync();
}
function ensureMask() {
  if (!mask) return;
  syncing = true;
  try {
    if (activeSession !== editor.session || maskRevision !== editor.session.maskRevision) {
      activeSession = editor.session;
      maskRevision = editor.session.maskRevision;
      if (editor.session.mask) mask.restore(editor.session.mask);
      else mask.resize(1, 1);

    }
    undo.value = mask.canUndo();
    redo.value = mask.canRedo();
    syncMaskLock();
  } finally {
    syncing = false;
  }
}
function paintBrush() {
  mask?.setBrush(brush.value, eraser.value);
}
function setBrush(erase: boolean) {
  closeSelection();
  focusRegion?.cancel(); focusTool.value = false; syncMaskLock();
  eraser.value = erase;
  paintBrush();
}
function selectFocus() {
  closeSelection();
  if (locked.value || !view.value.focusAvailable || !view.value.focusing) return;
  if (s.value.viewId !== s.value.baseId) editor.setBase(s.value.viewId);
  focusRegion?.cancel(); mask?.cancel(); canvas?.setHand(false);
  focusTool.value = true; syncMaskLock();
  if (innerWidth < 768) dialog.value?.querySelector("#editorViewport")?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}
async function changeInpaint(focused?: boolean) {
  closeSelection();
  if (locked.value) return;
  focusRegion?.cancel(); mask?.cancel(); focusTool.value = false;
  closePop();
  const entering = focused !== undefined || s.value.mode !== "inpaint";
  editor.setMode(entering ? "inpaint" : "img2img");
  if (focused !== undefined) editor.setFocus(focused);
  await nextTick();
  if (entering && view.value.focusing && !editor.session.focus.rect) selectFocus();
  syncMaskLock();
}
function changeUpscale(kind: string) {
  if (locked.value) return;
  const candidates = upChoices.value.filter(m => upscaleType(m.provider) === kind);
  const model = candidates.find(m => m.id === s.value.chosen.upscale) ?? candidates[0];
  if (!model) return;
  if (model.id !== s.value.chosen.upscale) editor.setModel(model.id, "upscale");
  editor.upscaleToggle(true);
}
function placeUpscale() {
  if (!pop.value || !dialog.value) return;
  const opener = dialog.value.querySelector<HTMLElement>("#editorUpscale");
  if (opener) placeEditorPanel(pop.value, opener);
}
function upscaleToggle(e: Event) {
  const open = (e as ToggleEvent).newState === "open";
  if (view.value.upscaleOpen !== open) editor.upscaleToggle(open);
  if (open) placeUpscale();
}
function closePop() {
  pop.value?.hidePopover();
  editor.upscaleToggle(false);
}
function stopClock() {
  clearInterval(tick);
  tick = undefined;
}
function saveView() {
  if (activeSession && canvas && dialog.value?.getClientRects().length) {
    activeSession.viewport = canvas.snapshot();
    activeSession.controls = { brush: brush.value, eraser: eraser.value, tab: tab.value };
  }
}
function pause() {
  closeSelection();
  saveView();
  saveMask();
  canvasFullscreen.value = false;
  closePop(); directorPanel.value?.close(); inpaintMode.value?.close(); upscaleMode.value?.close(); bottomPanel.value?.close(); boards.value?.close();
  for (const menu of dialog.value?.querySelectorAll<HTMLElement>(":popover-open") ?? []) menu.hidePopover();
  focusRegion?.pause();
  canvas?.pause();
  toolbar?.pause();
  stopClock();
  promptObserver?.disconnect();
  activeEvents?.abort();
  activeEvents = undefined;
  comparing.value = false;
  drop.value = "";
}
async function activate() {
  await nextTick();
  if (!view.value.open || !dialog.value || photopea.value) return;
  ensureMask();
  canvas?.resume();
  toolbar?.resume();
  focusRegion?.resume();
  canvas?.restore(editor.session.viewport);
  paintBrush();
  const settings = prefs();
  rail.value = settings.editorRail !== false;
  if (typeof settings.editorPanel === "number")
    dialog.value.style.setProperty(
      "--editor-panel",
      `${settings.editorPanel}px`,
    );
  activeEvents?.abort();
  activeEvents = new AbortController();
  const signal = activeEvents.signal;
  window.addEventListener(
    "resize",
    () => {
      if (view.value.upscaleOpen) placeUpscale();
    },
    { signal },
  );
  dialog.value.addEventListener(
    "scroll",
    () => {
      if (view.value.upscaleOpen) placeUpscale();
    },
    { passive: true, signal },
  );
  observePromptResize();
  canvas?.layout();
  startClock();
}
function observePromptResize() {
  promptObserver?.disconnect();
  if (!view.value.open || !dialog.value || photopea.value) return;
  const wraps = [...dialog.value.querySelectorAll<HTMLElement>(".promptbox .hl-wrap")];
  const saved = prefs().editorPromptH;
  if (typeof saved === 'number' && Number.isFinite(saved) && saved > 0)
    for (const w of wraps) {
      w.style.height = `${saved}px`;
      w.closest<HTMLElement>(".promptbox")!.dataset.resized = "1";
    }
  const seen = new WeakMap<Element, string>();
  for (const w of wraps) seen.set(w, w.style.height);
  promptObserver = new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = e.target as HTMLElement,
        h = Math.round(w.getBoundingClientRect().height),
        old = seen.get(w);
      // Only the native resize handle changes inline height. Responsive layout
      // and hidden panes must not overwrite the user's saved input size.
      if (
        h > 0 &&
        old !== w.style.height &&
        w.style.height
      ) {
        w.closest<HTMLElement>(".promptbox")!.dataset.resized = "1";
        preference("editorPromptH", h);
        for (const other of wraps)
          if (other !== w) { other.style.height = `${h}px`; seen.set(other, other.style.height); }
      }
      seen.set(w, w.style.height);
    }
  });
  for (const w of wraps) promptObserver.observe(w);
}
watch(() => view.value.generative, observePromptResize, { flush: 'post' });
watch(
  () => router.route.value.workspace,
  async (next) => {
    if (next === "edit") { editor.activate(); await activate(); }
    else { pause(); editor.close(); }
  },
  { flush: "post" },
);
watch(() => s.value.id, () => {
  inpaintMode.value?.close(); upscaleMode.value?.close(); closePop();
  focusRegion?.cancel(); focusTool.value = false;
  saveView();
  const controls = editor.session.controls;
  brush.value = controls?.brush ?? 64; eraser.value = controls?.eraser ?? false; tab.value = controls?.tab ?? "prompt";
  comparing.value = false;
  ensureMask(); paintBrush(); bottomPanel.value?.close();
  void nextTick(() => canvas?.restore(editor.session.viewport));
}, { flush: "post" });
watch(
  () => view.value.open,
  (open) => {
    if (open) void activate();
    else pause();
  },
  { flush: "post" },
);
watch(
  [
    () => s.value.id,
    () => s.value.baseId,
    () => s.value.mode,
    () => s.value.maskRevision,
    () => view.value.focusing,
    () => { const r = s.value.focus.rect; return r ? `${r.x},${r.y},${r.width},${r.height}` : ""; },
    () => view.value.warning,
  ],
  () => {
    if (!view.value.focusing) { focusRegion?.cancel(); focusTool.value = false; }
    ensureMask();
    focusRegion?.sync();
    void nextTick(() => {
      canvas?.layout();
      if (view.value.open) editor.retry("edit");
    });
  },
  { flush: "post" },
);
watch(
  () => view.value.viewed?.id,
  () => {
    comparing.value = false; focusRegion?.cancel(); focusTool.value = false;
    syncMaskLock();
    void nextTick(() => canvas?.layout());
  },
);
watch(locked, syncMaskLock);
watch(maskActive, syncMaskLock);
watch(selecting, on => {
  if (on) { saveMask(); focusRegion?.cancel(); focusTool.value = false; canvas?.setHand(false); }
  syncMaskLock();
});
watch([() => s.value.id, () => s.value.viewId, () => router.route.value.workspace], closeSelection, {flush:'sync'});
watch(
  () => view.value.upscaleOpen,
  async (on) => {
    await nextTick();
    if (!pop.value) return;
    if (on && view.value.open) {
      if (!pop.value.matches(":popover-open")) pop.value.showPopover();
      placeUpscale();
    } else if (pop.value.matches(":popover-open")) pop.value.hidePopover();
  },
);
function startClock() {
  stopClock(); syncMaskLock();
  if (view.value.busy && view.value.open && !photopea.value) {
    tick = setInterval(() => {
      if (elapsed.value) elapsed.value.textContent = Math.round((Date.now() - view.value.startedAt) / 1000) + "s";
    }, 1000);
  }
}
watch(() => view.value.busy, startClock);
function pick() {
  file.value?.click();
}
function toggleCanvasFullscreen() {
  closePop(); directorPanel.value?.close(); inpaintMode.value?.close(); upscaleMode.value?.close(); bottomPanel.value?.close();
  focusRegion?.cancel();
  canvasFullscreen.value = !canvasFullscreen.value;
  void nextTick(() => canvas?.layout());
}
watch(narrow, value => { if (!value) canvasFullscreen.value = false; });
function openPhotopea() {
  if (locked.value || !view.value.viewed) return;
  try {
    closePop(); bottomPanel.value?.close();
    const start = editor.beginExternalEdit();
    pause(); photopeaCreated.value = true; photopea.value = start;
  } catch (e) { ui.toast(e instanceof Error ? e.message : String(e), "err"); }
}
async function closePhotopea() {
  if (photopea.value) editor.cancelExternalEdit(photopea.value.id);
  photopea.value = undefined;
  await nextTick();
  if (view.value.open) {
    await activate(); canvas?.fit();
    dialog.value?.querySelector<HTMLButtonElement>(".editor-bar-end button:not([hidden])")?.focus({ preventScroll: true });
  }
}
watch([() => view.value.contextId, () => view.value.open], () => {
  if (photopea.value && (!view.value.open || photopea.value.id !== view.value.externalId)) void closePhotopea();
});
function openFile(e: Event) {
  const input = e.target as HTMLInputElement,
    f = input.files?.[0];
  input.value = "";
  if (f) void editor.addSource(f, f.name);
}
function openMaskFile(e: Event) {
  const input = e.target as HTMLInputElement, blob = input.files?.[0];
  input.value = "";
  if (blob) void editor.importMask(blob);
}
function key(e: KeyboardEvent) {
  if (photopea.value || annotations.active.value && !selecting.value || annotations.review.value) return;
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  const key = e.key.toLowerCase(),
    mod = e.metaKey || e.ctrlKey;
  if (key === "escape") {
    e.preventDefault();
    e.stopPropagation();
    const menu = dialog.value?.querySelector<HTMLElement>(":popover-open");
    if (menu) {
      menu.hidePopover();
      dialog.value?.querySelector<HTMLElement>(`[aria-controls="${menu.id}"], [popovertarget="${menu.id}"]`)?.focus({ preventScroll: true });
    }
    else if (focusTool.value) { focusRegion?.cancel(); focusTool.value = false; syncMaskLock(); }
    else if (view.value.upscaleOpen) closePop();
    else if (canvasFullscreen.value) toggleCanvasFullscreen();
    else bottomPanel.value?.close();
    return;
  }
  if (mod && key === "enter") {
    e.preventDefault();
    if (view.value.directorOpen) void editor.runDirector();
    else if (view.value.upscaleOpen) void editor.run('upscale');
    else submitEdit();
    return;
  }
  if (
    (e.target as Element).closest(
      "textarea,select,[contenteditable],input:not([type=range]):not([type=radio]):not([type=checkbox])",
    )
  )
    return;
  if (mod) {
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) mask?.redo();
      else mask?.undo();
    } else if (key === "y") {
      e.preventDefault();
      mask?.redo();
    } else if (["=", "+", "-", "0", "1"].includes(key)) {
      e.preventDefault();
      if (key === "0") canvas?.fit();
      else if (key === "1") canvas?.zoomTo(1);
      else canvas?.step(key === "-" ? -1 : 1);
    }
    return;
  }
  if (e.altKey) return;
  if (key === " " && !(e.target as Element).closest("button,a,input,summary")) {
    e.preventDefault();
    canvas?.setSpace(true);
  } else if (key === "\\") {
    e.preventDefault();
    compare(true);
  } else if (key === "h") canvas?.toggleHand();
  else if (maskActive.value) {
    if (key === "b") setBrush(false);
    else if (key === "e") setBrush(true);
    else if (key === "f" && view.value.focusing) selectFocus();
    else if (key === "[" || key === "]") {
      brush.value = Math.max(
        8,
        Math.min(256, brush.value + (key === "[" ? -8 : 8)),
      );
      paintBrush();
    }
  }
}
function keyup(e: KeyboardEvent) {
  if (e.key === " ") canvas?.setSpace(false);
  if (e.key === "\\") compare(false);
}
function dragenter(e: DragEvent) {
  if (photopea.value) return;
  if (
    !locked.value &&
    (e.dataTransfer?.types.includes("Files") ||
      e.dataTransfer?.types.includes(names.dragType))
  )
    drop.value = e.dataTransfer?.types.includes(names.dragType)
      ? "设为底图"
      : view.value.base
        ? "新建编辑画板"
        : "打开图片";
}
function dragVersion(id: number, e: DragEvent) {
  e.dataTransfer?.setData(names.dragType, String(id));
}
function dropImage(e: DragEvent) {
  if (photopea.value) return;
  e.preventDefault();
  e.stopPropagation();
  drop.value = "";
  const id = e.dataTransfer?.getData(names.dragType);
  if (id) {
    if ((e.target as Element).closest("#editorCanvas"))
      editor.setBase(Number(id));
    return;
  }
  const f = [...(e.dataTransfer?.files || [])].find((f) =>
    ["image/png", "image/jpeg", "image/webp"].includes(f.type),
  );
  if (f) void editor.addSource(f, f.name);
}
function paste(e: ClipboardEvent) {
  if (photopea.value) return;
  if ((e.target as Element).closest("textarea,input,select,[contenteditable]"))
    return;
  const f = [...(e.clipboardData?.files || [])].find((f) =>
    ["image/png", "image/jpeg", "image/webp"].includes(f.type),
  );
  if (f) {
    e.preventDefault();
    e.stopPropagation();
    void editor.addSource(f, f.name || "粘贴的图片");
  }
}
onMounted(() => {
  editor.setComparisonReader((boardId,versionId)=>view.value.session.id===boardId&&view.value.viewed?.id===versionId&&comparison.value
    ? {mode:comparisonMode.value,preview:previewBusy.value?'loading':previewError.value?'error':previewImage.value?'ready':'idle'} : undefined);
  toolbar = createEditorToolbar(dialog.value!);
  mask = createMaskEditor(maskCanvas.value!, changedMask);
  unwatchTheme = watchTheme(() => mask?.retint());
  focusRegion = createFocusRegion(dialog.value!, focusHost.value!, {
    size: () => view.value.base, rect: () => editor.session.focus.rect,
    visible: () => maskActive.value && view.value.focusing && !comparing.value && !selecting.value,
    selecting: () => focusTool.value, locked: () => locked.value || !maskActive.value || comparing.value || selecting.value,
    commit: rect => { editor.setFocusRect(rect); },
    settled: () => editor.retry("edit"),
  });
  canvas = createEditorCanvas(dialog.value!, mask, {
    size: () => comparison.value?.compatible ? comparison.value.source : shown.value,
    maskActive: () => maskActive.value,
    focus: { selecting: () => focusTool.value || selecting.value, cancel: () => { focusRegion?.cancel(); selection.value?.cancel(); } },
    brush: () => brush.value,
    compare,
    panel: (width) => preference("editorPanel", width),
  });
  selectionHost.value = {
    stage: dialog.value!.querySelector<HTMLElement>('#editorViewport')!, content: dialog.value!.querySelector<HTMLElement>('#editorStage')!,
    fit: () => canvas?.fit(), zoom: () => canvas?.zoom() ?? 1, pan: () => canvas?.handActive() ?? false,
    setHand: value => canvas?.setHand(value), setSpace: value => canvas?.setSpace(value),
  };
  editor.setMaskPort({
    getMask: () => mask!.getMask(),
    isDrawing: () => mask!.isDrawing() || !!focusRegion?.isDrawing() || !!selection.value?.isDrawing(),
    save: () => { saveMask(); saveView(); },
  });
  editor.activate();
  void activate();
});
onBeforeUnmount(() => {
  removeGuard(); removeCapture();
  pause();
  focusRegion?.dispose();
  canvas?.dispose();
  toolbar?.dispose();
  unwatchTheme?.();
  mask?.dispose();
  editor.setMaskPort(undefined);
  editor.setComparisonReader(undefined);
});
const number = (e: Event) => Number((e.target as HTMLInputElement).value);
async function copyReference(v: EditorVersion) {
  try { await navigator.clipboard.writeText(editor.reference(v)); ui.toast("已复制图片引用", "ok"); } catch { ui.toast("复制失败", "err"); }
}
</script>
<template>
  <section
    ref="dialog"
    id="imageEditor"
    class="editor"
    :data-mode="s.mode"
    :data-active="view.open ? 'true' : undefined"
    :data-rail="rail ? 'on' : 'off'"
    :data-canvas-fullscreen="narrow && canvasFullscreen || undefined"
    :data-photopea="photopea ? 'on' : undefined"
    data-workspace-root="edit"
    :inert="askFullscreen"
    aria-label="图像编辑"
    @keydown="key"
    @keyup="keyup"
    @paste="paste"
    @dragover.prevent
    @dragenter="dragenter"
    @dragleave="
      (e) => {
        if (!dialog?.contains(e.relatedTarget as Node)) drop = '';
      }
    "
    @dragend="drop = ''"
    @drop="dropImage"
  >
    <PhotopeaPanel v-if="photopeaCreated" v-show="!!photopea" :start="photopea" :title="view.viewed?.name ?? '图像'" @close="closePhotopea" />
    <header class="topbar editor-bar" :hidden="!!photopea" :inert="!!photopea">
      <WorkspaceSwitch workspace="edit" />
      <div class="topbar-end editor-bar-end" role="group" aria-label="工具">
        <button id="editorPhotopea" class="ibtn" type="button" aria-label="高级编辑" data-tip="高级编辑 · Photopea" :hidden="narrow" :disabled="locked || !view.viewed" @click="openPhotopea"><span class="editor-photopea-logo" aria-hidden="true" /></button>
        <button
          class="ibtn"
          type="button"
          aria-label="版本栏"
          data-tip="版本"
          :aria-pressed="rail"
          @click="
            rail = !rail;
            preference('editorRail', rail);
          "
        >
          <AppIcon name="i-layers" />
        </button>
      </div>
      <div class="topbar-account">
        <WalletDisplay
          :quota="view.quota"
          :model="view.accountModel"
          :operation="view.directorOpen || view.busy && view.running === 'director' ? 'director' : undefined"
        />
        <ThemeToggle />
      </div>
      <input
        ref="file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        @change="openFile"
      />
      <input ref="maskFile" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="openMaskFile" />
    </header>
    <div id="editorPositionLayer"></div>
    <div class="editor-shell" :hidden="!!photopea" :inert="!!photopea">
      <form
        class="composer generation-form"
        id="editorForm"
        novalidate
        :aria-busy="view.busy"
        @submit.prevent="submitEdit"
      >
        <div class="composer-scroll">
          <EditBoards ref="boards" @open-image="pick" />
          <fieldset class="editor-fields editor-controls" :disabled="locked">
          <ModelField v-if="view.open" />
          <template v-if="!view.generative">
          <div class="fld fld-hero promptbox" id="editorPromptBox">
            <div class="promptbox-head">
              <div class="tabs" role="tablist" aria-label="描述">
                <button
                  v-for="(text, k) in {
                    prompt: 'Prompt',
                    negative_prompt: 'Negative',
                  }"
                  :key="k"
                  class="tab"
                  type="button"
                  role="tab"
                  :aria-selected="tab === k"
                  :tabindex="tab === k ? 0 : -1"
                  @click="tab = k"
                  @keydown.left.prevent="
                    tab = tab === 'prompt' ? 'negative_prompt' : 'prompt'
                  "
                  @keydown.right.prevent="
                    tab = tab === 'prompt' ? 'negative_prompt' : 'prompt'
                  "
                >
                  <span>{{ text }}</span
                  ><NaiTokenCount :field="k === 'prompt' ? 'prompt' : 'negative'" :text="s.fields[k]" />
                </button>
              </div>
            </div>
            <div class="promptbox-body">
              <div
                v-for="(placeholder, k) in {
                  prompt: '描述想要的画面',
                  negative_prompt: 'lowres, blurry, watermark…',
                }"
                :key="k"
                class="pane"
                role="tabpanel"
                :hidden="tab !== k"
              >
                <HighlightInput
                  v-if="view.open"
                  :id="k === 'prompt' ? 'editorPrompt' : 'editorNegative'"
                  :model-value="s.fields[k]"
                  :label="k === 'prompt' ? 'Prompt' : 'Negative'"
                  :placeholder="placeholder"
                  :disabled="locked"
                  :readonly="k === 'negative_prompt' && medium"
                  :max-length="24000"
                  @update:model-value="(v) => editor.patch({ [k]: v })"
                />
                <NaiPromptOptions v-if="view.open" :negative="k === 'negative_prompt'" />
              </div>
            </div>
          </div>
          <CharactersEditor v-if="view.open" :key="view.contextId" />
          <EnhanceControl />
          <label
            class="scrub"
            :style="{ '--p': `${strength * 100}%` }"
            ><span>重绘强度</span
            ><output>{{ strength.toFixed(2) }}</output
            ><input
              id="editorStrength"
              type="range"
              :min="strengthRange.min"
              :max="strengthRange.max"
              step="0.01"
              :value="strength"
              :disabled="locked"
              @input="editor.setNumber('strength', number($event))"
          /></label>

          </template>
          <template v-else>
            <div class="fld fld-hero promptbox" id="editorImagePromptBox">
              <div class="promptbox-head"><label for="editorImagePrompt">修改说明</label></div>
              <div class="promptbox-body"><div class="pane">
                <HighlightInput v-if="view.open" id="editorImagePrompt" label="修改说明" :model-value="s.fields.prompt" :highlight="false" :disabled="locked" placeholder="描述需要修改的内容…" :max-length="24000" @update:model-value="editor.patch({prompt: $event})" />
              </div></div>
            </div>
            <EditImageParameters />
          </template>
          </fieldset>
        </div>
        <div class="composer-foot">
          <fieldset class="editor-controls" :disabled="locked">
            <DrawingBottomPanel v-if="view.open && !view.generative" ref="bottomPanel" :key="view.contextId"><template #parameters><EditorParameters /></template></DrawingBottomPanel>
          </fieldset>
          <div v-if="view.warning && view.warning !== view.referenceProblem && view.warning !== view.characterProblem" class="quota-warning" role="status">
            <AppIcon name="i-alert" /><span>{{ view.warning }}</span>
          </div>
          <div
            v-if="view.edit.error"
            class="quota-warning editor-err"
            role="alert"
          >
            <AppIcon name="i-alert" /><span>{{ view.edit.error }}</span
            ><button
              class="ibtn ibtn-xs"
              type="button"
              aria-label="重新报价"
              :disabled="locked"
              @click="editor.retry('edit', true)"
            >
              <AppIcon name="i-retry" />
            </button>
          </div>
          <div
            v-if="view.runError"
            class="quota-warning editor-err"
            role="alert"
          >
            <AppIcon name="i-alert" /><span>{{ view.runError }}</span>
          </div>
          <div class="go-row">
            <button
              class="btn btn-primary btn-go"
              id="editorRun"
              type="submit"
              :disabled="
                locked || !view.edit.canRun || !view.base || !!view.warning
              "
            >
              <AppIcon class="solid" name="i-generate" /><span
                class="go-spin"
              ></span
              ><span>{{
                runLabel
              }}</span
              ><span
                v-if="!view.busy && (view.edit.quote ? quoteLabel(view.edit.quote) : view.edit.price && view.edit.price !== '费用未知')"
                class="cost-tag"
                ><AppIcon name="i-points" /><b>{{
                  view.edit.quote
                    ? quoteLabel(view.edit.quote)
                    : view.edit.price
                }}</b></span
              ><span class="go-keys"
                ><kbd class="key-mod"><AppIcon name="i-cmd" /></kbd
                ><kbd><AppIcon name="i-enter" /></kbd></span
              ><span ref="elapsed" class="go-time">0s</span></button
            ><button
              class="btn btn-stop"
              id="editorStop"
              type="button"
              :hidden="!view.busy"
              @click="editor.cancel"
            >
              <AppIcon name="i-stop" />停止
            </button>
          </div>
        </div>
      </form>
      <div
        class="splitter"
        id="editorSplitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整栏宽"
        tabindex="0"
      ></div>
      <section
        class="stage"
        id="editorCanvas"
        aria-label="画布"
        :data-drop="drop || undefined"
      >
        <div class="viewport editor-mat">
          <div class="editor-viewport" id="editorViewport" tabindex="-1">
            <div class="editor-print" id="editorStage" :hidden="!shown" :data-transparent="shown?.director?.tool === 'bg-removal' || undefined">
              <img
                v-if="shown"
                id="editorImage"
                :src="shown.url"
                alt="当前版本"
                draggable="false"
                @load="canvas?.layout()"
              /><canvas
                ref="maskCanvas"
                id="editorMask"
                :hidden="!maskActive"
                aria-label="蒙版：涂抹要重绘的区域"
              ></canvas>
              <div ref="focusHost" id="editorFocusRegion" class="focus-region" hidden>
                <div class="focus-box" role="group" hidden>
                  <span class="focus-label mono" aria-hidden="true"></span>
                  <span v-for="corner in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']" :key="corner" class="focus-handle" :data-corner="corner" aria-hidden="true"></span>
                </div>
              </div>
              <div class="bar" :hidden="!view.busy"><i></i></div>
              <div class="sheen" :hidden="!view.busy"></div>
            </div>
          </div>
          <div class="blank editor-empty" :hidden="!!view.base">
            <div class="editor-empty-sheet" aria-hidden="true">
              <span class="editor-empty-crop editor-empty-crop-tl"></span>
              <span class="editor-empty-crop editor-empty-crop-tr"></span>
              <span class="editor-empty-crop editor-empty-crop-bl"></span>
              <span class="editor-empty-crop editor-empty-crop-br"></span>
              <div class="editor-empty-frame editor-empty-frame-main">
                <span class="editor-empty-sun"></span>
                <span class="editor-empty-hill editor-empty-hill-back"></span>
                <span class="editor-empty-hill editor-empty-hill-front"></span>
              </div>
              <div class="editor-empty-frame"></div>
              <div class="editor-empty-frame editor-empty-frame-accent"></div>
            </div>
            <p class="blank-s">拖入或粘贴图片</p>
            <button
              class="btn btn-quiet editor-empty-open"
              type="button"
              :disabled="locked"
              @click="pick"
            >
              <AppIcon name="i-upload" />{{ narrow ? '选择图片' : '打开图片' }}
            </button>
          </div>
          <RegionAnnotator v-if="selecting && selectionHost" ref="selection" :embedded="selectionHost" :toolbar="annotationToolbar" />
          <div class="editor-cursor" id="editorCursor" hidden></div>
          <div
            class="editor-info"
            :hidden="!view.viewed"
            :data-compare="comparing ? 'on' : 'off'"
          >
            <button
              v-if="narrow && shown"
              id="editorFullscreen"
              class="ibtn editor-fullscreen-toggle"
              type="button"
              :aria-label="canvasFullscreen ? '退出全屏画布' : '全屏画布'"
              :title="canvasFullscreen ? '退出全屏画布 · Esc' : '全屏画布'"
              :aria-pressed="canvasFullscreen"
              @click="toggleCanvasFullscreen"
            >
              <AppIcon :name="canvasFullscreen ? 'i-shrink' : 'i-expand'" />
            </button>
            <p class="editor-info-meta">
              <b :title="shown ? editor.reference(shown) : undefined">{{ unsavedPreview ? "预览" : shown ? editor.label(shown) : "" }}<span class="editor-info-kind"> · {{ unsavedPreview ? "蒙版替换" : label(shown) }}</span></b
              ><span class="mono">{{ facts }}</span>
            </p>
            <div v-if="variants.length" class="seg director-variants" role="radiogroup" aria-label="去背景结果">
              <label v-for="v in variants" :key="v.id"><input type="radio" name="editorDirectorVariant" :value="v.id" :checked="s.viewId === v.id" :disabled="locked" @change="editor.view(v.id)" /><span>{{ directorVariantNames[v.director!.variant!] }}</span></label>
            </div>
            <PopoverMenu id="editorSendMenu" label="发送图片" side="right" class="editor-send" pointer-focus="menu" orientation="horizontal" retain-on-close :menu-class="chatSource ? 'has-source' : undefined" @opened="void chat.start()">
              <template #trigger="{ open, toggle }">
                <button id="editorSend" class="editor-send-trigger" type="button" aria-haspopup="menu" aria-controls="editorSendMenu" :aria-expanded="open" :aria-label="sendCount ? `发送图片 · 含 ${sendCount} 处批注` : '发送图片'" :disabled="sendDisabled" @click="toggle">
                  <span class="editor-send-label">发送</span><span v-if="sendCount" class="editor-send-count mono">{{ sendCount }}</span><AppIcon name="i-chevron" class="editor-send-caret" />
                </button>
              </template>
              <template #default="{ close }">
                <div class="editor-send-actions" role="none">
                  <button class="menu-item" type="button" role="menuitem" aria-label="问 ASK" title="交给 ASK 看图" :disabled="sendDisabled" @click="close(); sendSelection('ask')">
                    <AppIcon name="i-ask" /><span>ASK</span>
                  </button>
                  <button v-if="chatSource" class="menu-item" type="button" role="menuitem" :aria-label="`CHAT 改图 · 来源对话 ${chatSource.title}`" :title="`在原会话继续改图：${chatSource.title}`" :disabled="sendDisabled" @click="close(); sendSelection('chat')">
                    <AppIcon name="i-chat" /><span>续改</span>
                  </button>
                  <span class="editor-send-divider" aria-hidden="true"></span>
                  <button class="menu-item editor-send-new" type="button" role="menuitem" aria-label="CHAT 改图 · 新对话" title="新对话改图" :disabled="sendDisabled" @click="close(); sendSelection('chat', true)">
                    <AppIcon :name="chatSource ? 'i-plus' : 'i-chat'" /><span v-if="!chatSource">新对话</span>
                  </button>
                </div>
                <p v-if="chatSource" class="editor-send-context" :title="chatSource.title">{{ chatSource.title }}</p>
              </template>
            </PopoverMenu>
          </div>
          <div v-if="comparison" class="editor-comparison" aria-label="改图对比">
            <div class="seg" role="group" aria-label="对比图片">
              <button type="button" :aria-pressed="comparisonMode === 'source'" @click="showComparison('source')">原图</button>
              <button type="button" :aria-pressed="comparisonMode === 'raw'" @click="showComparison('raw')">AI 生成</button>
              <button type="button" :aria-pressed="comparisonMode === 'composite'" :disabled="!comparison.info.mask || !comparison.compatible || previewBusy" :title="!comparison.info.mask ? '本轮没有明确范围的蒙版' : !comparison.compatible ? '方向或宽高比不符，无法应用蒙版' : '查看冻结蒙版的本地替换预览'" @click="showComparison('composite')">蒙版替换</button>
            </div>
            <button v-if="unsavedPreview" class="btn btn-quiet btn-sm" type="button" :disabled="locked || previewBusy" title="请先检查主体位置、比例与构图" @click="applyComparison">应用蒙版</button>
            <span v-if="previewError || previewBusy || !comparison.compatible" class="editor-comparison-note" role="status">{{ previewError || (previewBusy ? '准备预览…' : '画幅不一致，仅保留 AI 生成图') }}</span>
          </div>
          <div
            class="editor-toolbar"
            role="toolbar"
            aria-label="画布工具"
            :hidden="!shown"
          >
            <div v-show="selecting" ref="annotationToolbar"></div>
            <div v-if="!selecting && shown?.annotation && canMaskAnnotations(shown.annotation.snapshot.regions)" class="editor-annotation-actions editor-tool-capsule" role="group" aria-label="批注操作">
                <button v-if="shown?.annotation && canMaskAnnotations(shown.annotation.snapshot.regions)" class="btn btn-sm btn-quiet" :disabled="locked" @click="reviewAnnotations"><AppIcon name="i-mask" />{{ shown.annotation.rawId ? '查看直出／回贴' : '审核并应用蒙版' }}</button>
            </div>
            <div class="editor-mask-tools editor-tool-capsule" role="group" aria-label="蒙版画笔" :hidden="!maskActive || selecting">
                <button class="ibtn" type="button" aria-label="导入黑白蒙版" data-tip="导入黑白蒙版"
                  :disabled="locked" @click="maskFile?.click()"><AppIcon name="i-upload" /></button>
                <button
                  class="ibtn"
                  type="button"
                  aria-label="画笔"
                  data-tip="画笔 · B"
                  :aria-pressed="!eraser && !focusTool"
                  @click="setBrush(false)"
                >
                  <AppIcon name="i-brush" /></button
                ><button
                  class="ibtn"
                  type="button"
                  aria-label="橡皮擦"
                  data-tip="橡皮擦 · E"
                  :aria-pressed="eraser && !focusTool"
                  @click="setBrush(true)"
                >
                  <AppIcon name="i-eraser" /></button
                ><button v-if="view.focusing" id="editorSelectFocus" class="ibtn" type="button" aria-label="框选聚焦范围" data-tip="聚焦范围 · F" :aria-pressed="focusTool" :disabled="locked || !view.focusAvailable" @click="focusTool ? setBrush(eraser) : selectFocus()"><AppIcon name="i-frame" /></button
                ><label class="editor-size"
                  ><input
                    v-model.number="brush"
                    type="range"
                    min="8"
                    max="256"
                    step="1"
                    aria-label="笔刷大小"
                    @input="paintBrush"
                  /><output class="mono">{{ brush }}</output></label
                ><button
                  class="ibtn"
                  type="button"
                  aria-label="撤销"
                  :disabled="locked || !undo"
                  @click="mask?.undo()"
                >
                  <AppIcon name="i-undo" /></button
                ><button
                  class="ibtn"
                  type="button"
                  aria-label="重做"
                  :disabled="locked || !redo"
                  @click="mask?.redo()"
                >
                  <AppIcon name="i-redo" /></button
                ><button
                  class="ibtn"
                  type="button"
                  aria-label="清空蒙版"
                  :disabled="locked"
                  @click="mask?.clear()"
                >
                  <AppIcon name="i-trash" /></button
                >
            </div>
            <div v-show="!selecting" class="editor-tool-controls">
              <div class="editor-picture-ops editor-tool-capsule" role="group" aria-label="编辑工具">
                <EditToolMode id="editorAnnotate" label="批注" aria-label="批注工具" :icon="annotationTool.icon" :title="annotationTool.label" :active="selecting" :value="selecting ? selection?.tool ?? 'point' : 'point'" menu-label="批注方式" :options="annotationOptions" :disabled="locked || !shown || !!comparison" @toggle="selecting ? closeSelection() : annotate()" @select="value => annotate(value as AnnotationShape)" />
                <EditToolMode ref="inpaintMode" class="inpaint-mode" id="editorInpaint" :label="view.generative ? '蒙版' : view.focusing ? '聚焦' : '重绘'" :aria-label="view.generative ? '蒙版' : view.focusing ? '聚焦重绘' : '重绘'" :icon="view.focusing ? 'i-frame' : 'i-mask'" :active="s.mode === 'inpaint'" :value="view.focusing ? 'focused' : 'ordinary'" menu-label="重绘方式" :options="inpaintOptions" :disabled="locked || !editorModels({ models: view.models }, 'inpaint').length" @toggle="changeInpaint()" @select="value => changeInpaint(value === 'focused')" />
                <EditToolMode ref="upscaleMode" class="upscale-mode" id="editorUpscale" label="放大" icon="i-upscale" :title="upscaleTitle" :active="view.upscaleOpen" :value="upscaleKind" controls="editorUpscalePop" menu-label="放大方式" :options="upscaleOptions" :disabled="locked || !upModels.length" @toggle="editor.upscaleToggle(!view.upscaleOpen)" @select="changeUpscale" />
                <DirectorTools ref="directorPanel" />
              </div>
              <div class="editor-secondary-tools">
                <div class="editor-view-tools editor-tool-capsule" role="group" aria-label="视图控制">
                  <button
                    class="ibtn"
                    id="editorHand"
                    type="button"
                    aria-label="平移"
                    data-tip="平移 · H / 空格"
                    aria-pressed="false"
                    @click="canvas?.toggleHand()"
                  >
                    <AppIcon name="i-hand" /></button
                  ><button
                    class="ibtn editor-zoom-step"
                    type="button"
                    aria-label="缩小"
                    @click="canvas?.step(-1)"
                  >
                    <AppIcon name="i-zoom-out" /></button
                  ><button
                    class="editor-zoom mono"
                    id="editorZoomValue"
                    type="button"
                    aria-label="缩放到 100%"
                    @click="canvas?.zoomTo(1)"
                  >
                    100%</button
                  ><button
                    class="ibtn editor-zoom-step"
                    type="button"
                    aria-label="放大"
                    @click="canvas?.step(1)"
                  >
                    <AppIcon name="i-zoom-in" /></button
                  ><button
                    class="ibtn"
                    type="button"
                    aria-label="适应窗口"
                    @click="canvas?.fit()"
                  >
                    <AppIcon name="i-fit" />
                  </button>
                </div>
                <div class="editor-info-actions editor-tool-capsule" :hidden="!view.viewed" role="group" aria-label="图片操作">
                  <button v-if="view.viewed" class="ibtn" type="button"
                    :aria-label="editor.isFavorite(shown) ? '已收藏' : '收藏图片'" :data-tip="editor.isFavorite(shown) ? '已收藏' : '收藏'"
                    :aria-pressed="editor.isFavorite(shown)" :disabled="locked || unsavedPreview || view.saving || editor.isFavorite(shown)" @click="editor.saveFavorite(shown)">
                    <AppIcon name="i-star" />
                  </button>
                  <button
                    class="ibtn"
                    type="button"
                    aria-label="设为底图"
                    data-tip="设为底图"
                    :hidden="!shown || shown === view.base || unsavedPreview"
                    :disabled="locked"
                    @click="shown && editor.setBase(shown.id)"
                  >
                    <AppIcon name="i-pin" /></button
                  ><button
                    class="ibtn"
                    type="button"
                    aria-label="按住对比来源图"
                    data-tip="按住对比 · \"
                    :hidden="!parent"
                    @pointerdown.prevent="compare(true)"
                    @pointerup="compare(false)"
                    @pointerleave="compare(false)"
                    @pointercancel="compare(false)"
                    @blur="compare(false)"
                    @keydown.space.prevent="compare(true)"
                    @keydown.enter.prevent="compare(true)"
                    @keyup="compare(false)"
                  >
                    <AppIcon name="i-compare" /></button
                  ><a
                    class="ibtn"
                    aria-label="下载"
                    data-tip="下载"
                    :href="unsavedPreview ? undefined : shown?.url"
                    :download="shown?.name" :aria-disabled="unsavedPreview"
                    ><AppIcon name="i-download"
                  /></a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <aside class="gallery editor-rail" aria-label="版本">
        <div class="gallery-head">
          <span class="mono">{{ ordered.length }}</span>
        </div>
        <div class="tray">
          <button
            v-for="v in ordered"
            :key="v.id"
            class="tile"
            type="button"
            :data-version-id="v.id"
            :style="{ '--image-ratio': v.width / v.height }"
            :data-base="groupIsBase(v.id) || undefined"
            :aria-current="v.id === s.viewId"
            :title="`${editor.reference(v)} · 点击角标复制引用`"
            :aria-label="`${editor.label(v)} · ${label(v)} · ${v.width}×${v.height}${v.id === s.baseId ? ' · 底图' : ''}`"
            draggable="true"
            @dragstart="dragVersion(v.id, $event)"
            @click="editor.view(v.id)"
            @dblclick="editor.setBase(v.id)"
          >
            <img :src="v.url" alt="" decoding="async" draggable="false" /><span class="tile-id" role="button" tabindex="0" :aria-label="`复制 ${editor.reference(v)}`" @click.stop="copyReference(v)" @keydown.enter.stop.prevent="copyReference(v)" @keydown.space.stop.prevent="copyReference(v)">{{ editor.label(v) }}</span><span
              v-if="groupIsBase(v.id)"
              class="tile-pin"
              ><AppIcon name="i-pin" /></span
            ><span v-if="v.director" class="director-badge"><AppIcon :name="directorTools.find(t => t.id === v.director?.tool)?.icon ?? 'i-dt-wand'" /></span><span
              v-if="v.sequence !== 1 && !groupIsBase(v.id) && !view.busy"
              class="tile-x"
              role="button"
              aria-label="移除"
              @click.stop="editor.remove(v.id)"
              >×</span
            >
          </button>
        </div>
      </aside>
    </div>
    <div
      ref="pop"
      id="editorUpscalePop"
      class="menu editor-flyout editor-mini editor-upscale-panel"
      popover
      role="dialog"
      :aria-label="upscaleTitle"
      @toggle="upscaleToggle"
    >
      <div class="editor-mini-params"><div class="editor-mini-row"><span class="editor-mini-label">模型</span><span v-if="upscaleChoices.length === 1" class="editor-mini-value">{{ upscaleChoices[0].profileId === 'nai-official-v1' ? 'NovelAI Upscale' : upscaleChoices[0].name }}</span></div></div>
      <div v-if="upscaleChoices.length > 1" class="editor-pop-list" role="radiogroup" aria-label="放大模型">
          <label
            v-for="m in upscaleChoices"
            :key="m.id"
            class="menu-item editor-pop-item"
            ><input
              type="radio"
              name="editorUpscaleModel"
              :value="m.id"
              :checked="s.chosen.upscale === m.id"
              :disabled="locked"
              @change="editor.setModel(m.id, 'upscale')"
            /><span class="menu-label">{{ m.profileId === 'nai-official-v1' ? 'NovelAI Upscale' : m.name }}</span
            ><AppIcon class="menu-check" name="i-check" /></label
          >
        <span v-if="!upscaleChoices.length">暂无可用模型</span>
      </div>
      <div
        class="editor-pop-options"
        :hidden="
          view.upscaleModel?.provider === 'novelai' ||
          !Object.keys(view.upscaleModel?.fields || {}).length
        "
      >
        <div
          v-for="(field, key) in view.upscaleModel?.fields"
          :key="key"
          class="editor-pop-option"
        >
          <label :for="`editorOption-${key}`">{{
            field.label || optionLabels[key] || key
          }}</label
          ><ModelParameterInput
            :id="`editorOption-${key}`"
            :value="upOptions[key]"
            :field="field"
            :disabled="locked"
            @change="editor.setOption(key, $event)"
          />
        </div>
      </div>
      <textarea
        class="editor-pop-detail"
        rows="3"
        maxlength="24000"
        placeholder="细节描述（可选）"
        aria-label="细节描述"
        :hidden="!view.upscaleModel || view.upscaleModel.provider === 'novelai'"
        :value="s.fields.detail"
        :disabled="locked"
        @input="
          editor.patch({ detail: ($event.target as HTMLTextAreaElement).value })
        "
      ></textarea>
      <div v-if="view.upscaleWarning" class="quota-warning" role="status">
        <AppIcon name="i-alert" /><span>{{ view.upscaleWarning }}</span>
      </div>
      <div
        v-if="view.upscale.error"
        class="quota-warning editor-err"
        role="alert"
      >
        <AppIcon name="i-alert" /><span>{{ view.upscale.error }}</span
        ><button
          class="ibtn ibtn-xs"
          type="button"
          aria-label="重新报价"
          @click="editor.retry('upscale', true)"
        >
          <AppIcon name="i-retry" />
        </button>
      </div>
      <div class="editor-mini-run"><span class="editor-mini-facts"><template v-if="view.upscaleModel?.profileId === 'nai-official-v1' && view.viewed"><span class="editor-mini-cap mono">{{ NAI_OFFICIAL_UPSCALE.factor }}×</span><span class="editor-mini-cap mono">{{ view.viewed.width * NAI_OFFICIAL_UPSCALE.factor }}×{{ view.viewed.height * NAI_OFFICIAL_UPSCALE.factor }}</span></template></span><button
        class="btn btn-primary btn-go"
        id="editorUpscaleRun"
        type="button"
        :disabled="
          locked || !view.upscale.canRun || !shown || !!view.upscaleWarning
        "
        @click="editor.run('upscale')"
      >
        <AppIcon name="i-upscale" /><span>放大</span
        ><span v-if="view.upscale.quote && quoteLabel(view.upscale.quote)" class="cost-tag"
          ><AppIcon name="i-points" /><b>{{
            quoteLabel(view.upscale.quote)
          }}</b></span
        >
      </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.focus-region { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.focus-region[data-selecting="true"] { pointer-events: auto; cursor: crosshair; touch-action: none; }
.focus-region[hidden], .focus-box[hidden] { display: none; }
.focus-box { position: absolute; box-sizing: border-box; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 50%), 0 0 0 100vmax rgb(8 8 14 / 46%); }
.focus-box:focus-visible { outline: 2px solid var(--a); outline-offset: -4px; }
.focus-region[data-selecting="true"] .focus-box { cursor: move; }
.focus-label { position: absolute; top: 4px; left: 4px; padding: 2px 5px; max-width: calc(100% - 8px); overflow: hidden; color: #fff; background: rgb(14 12 22 / 78%); border-radius: 6px; font-size: var(--fz-2xs); line-height: 1.4; pointer-events: none; }
.focus-handle { position: absolute; width: 8px; height: 8px; background: #fff; border: 1px solid rgb(0 0 0 / 55%); border-radius: 2px; display: none; }
.focus-region[data-selecting="true"] .focus-handle { display: block; }
.focus-handle[data-corner="nw"] { top: -1px; left: -1px; cursor: nwse-resize; }
.focus-handle[data-corner="ne"] { top: -1px; right: -1px; cursor: nesw-resize; }
.focus-handle[data-corner="sw"] { bottom: -1px; left: -1px; cursor: nesw-resize; }
.focus-handle[data-corner="se"] { bottom: -1px; right: -1px; cursor: nwse-resize; }
.focus-handle[data-corner="n"] { top: -1px; left: 50%; translate: -50% 0; cursor: ns-resize; }
.focus-handle[data-corner="s"] { bottom: -1px; left: 50%; translate: -50% 0; cursor: ns-resize; }
.focus-handle[data-corner="e"] { right: -1px; top: 50%; translate: 0 -50%; cursor: ew-resize; }
.focus-handle[data-corner="w"] { left: -1px; top: 50%; translate: 0 -50%; cursor: ew-resize; }
.editor[data-hand="on"] .focus-region { pointer-events: none; }
</style>
