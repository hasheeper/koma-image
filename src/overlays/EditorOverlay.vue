<script setup lang="ts">
import {
  computed,
  ref,
  shallowRef,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { useDialog } from "./use-dialog";
import { useEditor } from "../app/editor";
import { useShell } from "../app/shell";
import { useServices } from "../app/services";
import { useUi } from "../app/ui";
import type { EditorSession } from "../services/editor";
import { modeNames } from "../services/editor";
import { editorModels } from "../domain/media.js";
import { normalizeOptions } from "../domain/catalog";
import { quoteLabel } from "../domain/quote";
import { names } from "../storage/names";
import { createMaskEditor } from "../native/mask-editor.js";
import type { MaskEditor } from "../native/mask-editor.js";
import { createEditorCanvas } from "../native/editor-canvas";
import BrandMark from "../shared/BrandMark.vue";
import AppIcon from "../shared/AppIcon.vue";
import WalletDisplay from "../shared/WalletDisplay.vue";
import HighlightInput from "../shared/HighlightInput.vue";
const { editor, view } = useEditor(),
  { router } = useShell(),
  services = useServices(),
  ui = useUi();
const dialog = shallowRef<HTMLDialogElement | null>(null),
  file = shallowRef<HTMLInputElement | null>(null),
  pop = shallowRef<HTMLElement | null>(null),
  maskCanvas = shallowRef<HTMLCanvasElement | null>(null),
  elapsed = shallowRef<HTMLElement | null>(null);
const tab = ref<"prompt" | "negative_prompt">("prompt"),
  brush = ref(64),
  eraser = ref(false),
  undo = ref(false),
  redo = ref(false),
  comparing = ref(false),
  rail = ref(true),
  drop = ref("");
const s = computed(() => view.value.session),
  locked = computed(
    () => view.value.busy || view.value.reading || view.value.preparing,
  ),
  shown = computed(() =>
    comparing.value
      ? s.value.versions.find((v) => v.id === view.value.viewed?.parentId) ||
        view.value.viewed
      : view.value.viewed,
  ),
  parent = computed(() =>
    s.value.versions.find((v) => v.id === view.value.viewed?.parentId),
  );
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
const upOptions = computed(() =>
  view.value.upscaleModel
    ? s.value.options[view.value.upscaleModel.id] ||
      normalizeOptions(view.value.upscaleModel)
    : {},
);
const ordered = computed(() =>
  [
    view.value.base,
    ...s.value.versions
      .filter((v) => v !== view.value.base)
      .slice()
      .reverse(),
  ].filter((v) => !!v),
);
const optionLabels: Record<string, string> = {
  output_format: "格式",
  size: "尺寸",
  image_size: "分辨率",
  aspect_ratio: "比例",
  quality: "质量",
};
const label = (v: typeof shown.value) =>
  v?.kind === "source" ? "原图" : v?.mode ? modeNames[v.mode] : "";
const facts = computed(() => {
  const v = shown.value;
  if (!v) return "";
  const list = [`${v.width}×${v.height}`];
  if (v.kind === "result" && v.mode !== "upscale")
    list.push(`强度 ${v.params?.strength}`);
  if (v.kind === "result" && v.mode === "upscale" && parent.value)
    list.push(`×${Number((v.width / parent.value.width).toFixed(2))}`);
  return list.join(" · ");
});
const { requestClose, cancel, closed } = useDialog("editor", dialog, () => {
  if (view.value.busy || view.value.preparing) {
    ui.toast("正在运行，请先停止");
    return false;
  }
  return true;
});
let mask: MaskEditor | undefined,
  canvas: ReturnType<typeof createEditorCanvas> | undefined,
  activeSession: EditorSession | undefined,
  syncing = false,
  tick: ReturnType<typeof setInterval> | undefined,
  promptObserver: ResizeObserver | undefined,
  activeEvents: AbortController | undefined;
const prefs = () =>
  services.preferences.get<Record<string, unknown>>(names.preferences, {});
function preference(key: string, value: unknown) {
  void services.preferences
    .set(names.preferences, { ...prefs(), [key]: value })
    .catch(() => {});
}
function saveMask() {
  if (activeSession && mask && activeSession.maskFor)
    activeSession.mask = mask.snapshot();
}
function changedMask() {
  if (!mask || syncing) return;
  undo.value = mask.canUndo();
  redo.value = mask.canRedo();
  saveMask();
  editor.changed();
}
function compare(value: boolean) {
  comparing.value = value && !!parent.value;
  syncMaskLock();
}
function syncMaskLock() {
  mask?.setLocked(locked.value || !maskActive.value || comparing.value);
}
function ensureMask() {
  if (!mask) return;
  syncing = true;
  try {
    if (activeSession !== editor.session) {
      activeSession = editor.session;
      if (editor.session.mask) mask.restore(editor.session.mask);
      else mask.resize(1, 1);
      canvas?.fit();
    }
    if (
      s.value.mode === "inpaint" &&
      view.value.base &&
      s.value.maskFor !== s.value.baseId &&
      !view.value.warning
    ) {
      editor.session.maskFor = s.value.baseId;
      mask.resize(view.value.base.width, view.value.base.height);
      editor.session.mask = mask.snapshot();
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
  eraser.value = erase;
  paintBrush();
}
function placeUpscale() {
  if (!pop.value || !dialog.value) return;
  const a = dialog.value
      .querySelector("#editorUpscale")!
      .getBoundingClientRect(),
    vw = document.documentElement.clientWidth,
    vh = innerHeight,
    width = Math.min(248, vw - 16),
    above = a.top > vh - a.bottom;
  Object.assign(pop.value.style, {
    width: `${width}px`,
    left: `${Math.round(Math.max(8, Math.min(vw - width - 8, a.left + a.width / 2 - width / 2)))}px`,
    top: `${Math.round(above ? a.top - 8 : a.bottom + 8)}px`,
    maxHeight: `${Math.floor(above ? a.top - 16 : vh - a.bottom - 16)}px`,
  });
  pop.value.dataset.placement = above ? "top" : "bottom";
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
function pause() {
  saveMask();
  canvas?.pause();
  stopClock();
  promptObserver?.disconnect();
  activeEvents?.abort();
  activeEvents = undefined;
  comparing.value = false;
  drop.value = "";
}
async function activate() {
  await nextTick();
  if (!view.value.open || !dialog.value) return;
  ensureMask();
  canvas?.resume();
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
  const wraps = [
    ...dialog.value.querySelectorAll<HTMLElement>(".promptbox .hl-wrap"),
  ];
  if (settings.editorPromptH)
    for (const w of wraps) {
      w.style.height = `${settings.editorPromptH}px`;
      w.closest<HTMLElement>(".promptbox")!.dataset.resized = "1";
    }
  const seen = new WeakMap<Element, number>();
  promptObserver?.disconnect();
  promptObserver = new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = e.target as HTMLElement,
        h = Math.round(w.getBoundingClientRect().height),
        old = seen.get(w);
      if (
        h > 0 &&
        old !== undefined &&
        Math.abs(h - old) > 1 &&
        w.style.height
      ) {
        w.closest<HTMLElement>(".promptbox")!.dataset.resized = "1";
        preference("editorPromptH", h);
        for (const other of wraps)
          if (other !== w) other.style.height = `${h}px`;
      }
      if (h > 0) seen.set(w, h);
    }
  });
  for (const w of wraps) promptObserver.observe(w);
  canvas?.layout();
}
watch(
  () => router.route.value.overlay,
  async (next) => {
    if (next === "editor") {
      if (!view.value.open)
        await editor.open(
          router.route.value.workspace === "chat" ? "chat" : "image",
        );
      await activate();
    } else if (view.value.open) {
      editor.close();
      pause();
    }
  },
  { flush: "post" },
);
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
    () => view.value.warning,
  ],
  () => {
    ensureMask();
    void nextTick(() => {
      canvas?.fit();
      editor.retry("edit");
    });
  },
  { flush: "post" },
);
watch(
  () => view.value.viewed?.id,
  () => {
    comparing.value = false;
    void nextTick(() => canvas?.layout());
  },
);
watch(locked, syncMaskLock);
watch(maskActive, syncMaskLock);
watch(
  () => view.value.upscaleOpen,
  async (on) => {
    await nextTick();
    if (!pop.value) return;
    if (on && dialog.value?.open) {
      if (!pop.value.matches(":popover-open")) pop.value.showPopover();
      placeUpscale();
    } else if (pop.value.matches(":popover-open")) pop.value.hidePopover();
  },
);
watch(
  () => view.value.busy,
  (busy) => {
    stopClock();
    syncMaskLock();
    if (busy && view.value.open) {
      tick = setInterval(() => {
        if (elapsed.value)
          elapsed.value.textContent = `${Math.round((Date.now() - view.value.startedAt) / 1000)}s`;
      }, 1000);
      void nextTick(() =>
        dialog.value?.querySelector<HTMLButtonElement>("#editorStop")?.focus(),
      );
    }
  },
);
function randomSeed() {
  editor.patch({ seed: String(crypto.getRandomValues(new Uint32Array(1))[0]) });
}
function pick() {
  file.value?.click();
}
function openFile(e: Event) {
  const input = e.target as HTMLInputElement,
    f = input.files?.[0];
  input.value = "";
  if (f) void editor.addSource(f, f.name);
}
function key(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  const key = e.key.toLowerCase(),
    mod = e.metaKey || e.ctrlKey;
  if (key === "escape") {
    e.preventDefault();
    e.stopPropagation();
    if (view.value.upscaleOpen) closePop();
    else requestClose();
    return;
  }
  if (mod && key === "enter") {
    e.preventDefault();
    void editor.run(view.value.upscaleOpen ? "upscale" : "edit");
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
  if (
    !locked.value &&
    (e.dataTransfer?.types.includes("Files") ||
      e.dataTransfer?.types.includes(names.dragType))
  )
    drop.value = e.dataTransfer?.types.includes(names.dragType)
      ? "设为底图"
      : view.value.base
        ? "替换底图"
        : "打开图片";
}
function dragVersion(id: number, e: DragEvent) {
  e.dataTransfer?.setData(names.dragType, String(id));
}
function dropImage(e: DragEvent) {
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
  mask = createMaskEditor(maskCanvas.value!, changedMask);
  canvas = createEditorCanvas(dialog.value!, mask, {
    size: () => view.value.viewed,
    maskActive: () => maskActive.value,
    brush: () => brush.value,
    compare,
    panel: (width) => preference("editorPanel", width),
  });
  editor.setMaskPort({
    getMask: () => mask!.getMask(),
    isDrawing: () => mask!.isDrawing(),
    save: saveMask,
  });
  if (router.route.value.overlay === "editor")
    void editor.open(
      router.route.value.workspace === "chat" ? "chat" : "image",
    );
});
onBeforeUnmount(() => {
  pause();
  canvas?.dispose();
  mask?.dispose();
  editor.setMaskPort(undefined);
});
const number = (e: Event) => Number((e.target as HTMLInputElement).value);
</script>
<template>
  <dialog
    ref="dialog"
    id="imageEditor"
    class="editor"
    :data-mode="s.mode"
    :data-rail="rail ? 'on' : 'off'"
    aria-labelledby="editorTitle"
    @cancel="cancel"
    @close="closed"
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
    <header class="topbar editor-bar">
      <button
        class="ibtn editor-back"
        type="button"
        aria-label="返回"
        data-tip="返回 · Esc"
        autofocus
        @click="requestClose"
      >
        <AppIcon name="i-back" />
      </button>
      <h2 class="brand editor-title" id="editorTitle" aria-label="图像编辑">
        <BrandMark surface="edit" subtitle="EDIT" />
      </h2>
      <div class="topbar-end editor-bar-end" role="group" aria-label="工具">
        <button
          class="ibtn"
          type="button"
          aria-label="打开图片"
          data-tip="打开图片"
          :disabled="locked"
          @click="pick"
        >
          <AppIcon name="i-upload" /></button
        ><button
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
          :model="view.upscaleOpen ? view.upscaleModel : view.model"
        />
      </div>
      <input
        ref="file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        @change="openFile"
      />
    </header>
    <div class="editor-shell">
      <form
        class="composer generation-form"
        id="editorForm"
        novalidate
        :aria-busy="view.busy"
        @submit.prevent="editor.run()"
      >
        <div class="composer-scroll">
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
                  ><span
                    class="tab-count"
                    :data-filled="s.fields[k].length ? '1' : undefined"
                    >{{ s.fields[k].length }}</span
                  >
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
                  :max-length="24000"
                  @update:model-value="(v) => editor.patch({ [k]: v })"
                />
              </div>
            </div>
          </div>
          <div class="fld">
            <div class="fld-top">
              <label class="composer-heading" for="editorModel"
                ><AppIcon class="section-ico" name="i-model" />模型</label
              >
            </div>
            <select
              id="editorModel"
              :value="s.chosen[s.mode]"
              :disabled="locked"
              @change="
                editor.setModel(($event.target as HTMLSelectElement).value)
              "
            >
              <option v-if="!editModels.length" value="">暂无可用模型</option>
              <option v-for="m in editModels" :key="m.id" :value="m.id">
                {{ m.name }}
              </option>
            </select>
          </div>
          <label
            class="scrub"
            :style="{ '--p': `${s.strength[s.mode] * 100}%` }"
            ><span>重绘强度</span
            ><output>{{ s.strength[s.mode].toFixed(2) }}</output
            ><input
              id="editorStrength"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="s.strength[s.mode]"
              :disabled="locked"
              @input="editor.setNumber('strength', number($event))"
          /></label>
          <details class="drawer">
            <summary>
              <AppIcon class="section-ico" name="i-parameters" /><span
                >参数</span
              ><i class="caret"></i>
            </summary>
            <div class="drawer-body">
              <label
                class="scrub scrub-sm"
                :style="{ '--p': `${s.noise[s.mode] * 100}%` }"
                ><span>噪声</span
                ><output>{{ s.noise[s.mode].toFixed(2) }}</output
                ><input
                  id="editorNoise"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="s.noise[s.mode]"
                  :disabled="locked"
                  @input="editor.setNumber('noise', number($event))"
              /></label>
              <div class="fld">
                <div class="fld-top">
                  <label for="editorSampler">采样器</label>
                </div>
                <select
                  id="editorSampler"
                  :value="s.fields.sampler"
                  :disabled="locked"
                  @change="
                    editor.patch({
                      sampler: ($event.target as HTMLSelectElement).value,
                    })
                  "
                >
                  <option
                    v-for="sampler in view.samplers"
                    :key="sampler"
                    :value="sampler"
                  >
                    {{ sampler.replace(/^k_/, "").replaceAll("_", " ") }}
                  </option>
                </select>
              </div>
              <label
                v-for="param in [
                  {
                    key: 'steps' as const,
                    name: '步数',
                    min: 1,
                    max: 50,
                    step: 1,
                  },
                  {
                    key: 'scale' as const,
                    name: 'Scale',
                    min: 0,
                    max: 20,
                    step: 0.5,
                  },
                ]"
                :key="param.key"
                class="scrub scrub-sm"
                :style="{
                  '--p': `${((s.fields[param.key] - param.min) / (param.max - param.min)) * 100}%`,
                }"
                ><span>{{ param.name }}</span
                ><output>{{ s.fields[param.key] }}</output
                ><input
                  :id="param.key === 'steps' ? 'editorSteps' : 'editorScale'"
                  type="range"
                  :min="param.min"
                  :max="param.max"
                  :step="param.step"
                  :value="s.fields[param.key]"
                  :disabled="locked"
                  @input="editor.patch({ [param.key]: number($event) })"
              /></label>
              <div class="fld">
                <div class="fld-top"><label for="editorSeed">Seed</label></div>
                <div class="seed">
                  <input
                    id="editorSeed"
                    type="number"
                    min="0"
                    max="4294967295"
                    placeholder="随机"
                    :value="s.fields.seed"
                    :disabled="locked"
                    @input="
                      editor.patch({
                        seed: ($event.target as HTMLInputElement).value,
                      })
                    "
                  /><button
                    class="ibtn"
                    type="button"
                    aria-label="随机 Seed"
                    :disabled="locked"
                    @click="randomSeed"
                  >
                    <AppIcon name="i-dice" />
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>
        <div class="composer-foot">
          <div v-if="view.warning" class="quota-warning" role="status">
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
              @click="editor.retry('edit')"
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
                locked || !view.edit.quote || !view.base || !!view.warning
              "
            >
              <AppIcon class="solid" name="i-generate" /><span
                class="go-spin"
              ></span
              ><span>{{
                view.busy ? `${modeNames[view.running]}中…` : modeNames[s.mode]
              }}</span
              ><span
                v-if="!view.busy && (view.edit.quote || view.edit.price)"
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
          <div class="editor-viewport" id="editorViewport">
            <div class="editor-print" id="editorStage" :hidden="!shown">
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
              <div class="bar" :hidden="!view.busy"><i></i></div>
              <div class="sheen" :hidden="!view.busy"></div>
            </div>
          </div>
          <div class="blank editor-empty" :hidden="!!view.base">
            <AppIcon class="ico-xl" name="i-image" />
            <p class="blank-s">拖入或粘贴图片</p>
            <button
              class="btn btn-quiet btn-sm"
              type="button"
              :disabled="locked"
              @click="pick"
            >
              <AppIcon name="i-upload" />打开图片
            </button>
          </div>
          <div class="editor-cursor" id="editorCursor" hidden></div>
          <div
            class="editor-info"
            :hidden="!view.viewed"
            :data-compare="comparing ? 'on' : 'off'"
          >
            <p class="editor-info-meta">
              <b>{{ label(shown) }}</b
              ><span class="mono">{{ facts }}</span>
            </p>
            <div class="editor-info-actions" role="group" aria-label="图片操作">
              <button
                class="ibtn"
                type="button"
                aria-label="设为底图"
                data-tip="设为底图"
                :hidden="!view.viewed || view.viewed === view.base"
                :disabled="locked"
                @click="editor.setBase(s.viewId)"
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
              ><button
                class="ibtn"
                type="button"
                aria-label="添加为参考图"
                data-tip="添加为参考图"
                :hidden="s.origin !== 'chat' || !shown"
                :disabled="locked"
                @click="editor.useResult"
              >
                <AppIcon name="i-image-plus" /></button
              ><a
                class="ibtn"
                aria-label="下载"
                data-tip="下载"
                :href="view.viewed?.url"
                :download="view.viewed?.name"
                ><AppIcon name="i-download"
              /></a>
            </div>
          </div>
          <div
            class="editor-toolbar"
            role="toolbar"
            aria-label="画布工具"
            :hidden="!shown"
          >
            <button
              class="editor-tool"
              type="button"
              :aria-pressed="s.mode === 'inpaint'"
              :disabled="
                locked ||
                !editorModels({ models: view.models }, 'inpaint').length
              "
              @click="
                editor.setMode(s.mode === 'inpaint' ? 'img2img' : 'inpaint')
              "
            >
              <AppIcon name="i-mask" /><span>重绘</span></button
            ><button
              class="editor-tool"
              id="editorUpscale"
              type="button"
              :aria-expanded="view.upscaleOpen"
              :disabled="locked || !upModels.length"
              @click="editor.upscaleToggle(!view.upscaleOpen)"
            >
              <AppIcon name="i-upscale" /><span>放大</span
              ><i class="caret"></i></button
            ><span class="editor-sep"></span>
            <div class="editor-mask-tools" :hidden="!maskActive">
              <button
                class="ibtn"
                type="button"
                aria-label="画笔"
                data-tip="画笔 · B"
                :aria-pressed="!eraser"
                @click="setBrush(false)"
              >
                <AppIcon name="i-brush" /></button
              ><button
                class="ibtn"
                type="button"
                aria-label="橡皮擦"
                data-tip="橡皮擦 · E"
                :aria-pressed="eraser"
                @click="setBrush(true)"
              >
                <AppIcon name="i-eraser" /></button
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
              ><span class="editor-sep"></span>
            </div>
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
        </div>
      </section>
      <aside class="gallery editor-rail" aria-label="版本">
        <div class="gallery-head">
          <span class="mono">{{ s.versions.length }}</span>
        </div>
        <div class="tray">
          <button
            v-for="v in ordered"
            :key="v.id"
            class="tile"
            type="button"
            :data-version-id="v.id"
            :data-base="v.id === s.baseId || undefined"
            :aria-current="v.id === s.viewId"
            :aria-label="`${label(v)} · ${v.width}×${v.height}${v.id === s.baseId ? ' · 底图' : ''}`"
            draggable="true"
            @dragstart="dragVersion(v.id, $event)"
            @click="editor.view(v.id)"
            @dblclick="editor.setBase(v.id)"
          >
            <img :src="v.url" alt="" decoding="async" draggable="false" /><span
              v-if="v.id === s.baseId"
              class="tile-pin"
              ><AppIcon name="i-pin" /></span
            ><span
              v-else-if="!view.busy"
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
      class="editor-pop"
      popover
      aria-label="放大"
      @toggle="upscaleToggle"
    >
      <div class="editor-pop-list" role="radiogroup" aria-label="放大模型">
        <div
          v-for="provider in ['novelai', 'fal']"
          :key="provider"
          class="editor-pop-group"
          :hidden="!upModels.some((m) => m.provider === provider)"
          role="group"
          :aria-label="provider === 'novelai' ? 'NAI 原生' : '专用模型'"
        >
          <p>{{ provider === "novelai" ? "NAI 原生" : "专用模型" }}</p>
          <label
            v-for="m in upModels.filter((m) => m.provider === provider)"
            :key="m.id"
            class="editor-pop-item"
            ><input
              type="radio"
              name="editorUpscaleModel"
              :value="m.id"
              :checked="s.chosen.upscale === m.id"
              :disabled="locked"
              @change="editor.setModel(m.id, 'upscale')"
            /><span>{{ m.name }}</span></label
          >
        </div>
        <span v-if="!upModels.length">暂无可用模型</span>
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
            optionLabels[key] || key
          }}</label
          ><select
            :id="`editorOption-${key}`"
            :value="upOptions[key]"
            :disabled="locked"
            @change="
              editor.setOption(key, ($event.target as HTMLSelectElement).value)
            "
          >
            <option v-for="value in field.options" :key="value" :value="value">
              {{ value.toUpperCase() }}
            </option>
          </select>
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
          @click="editor.retry('upscale')"
        >
          <AppIcon name="i-retry" />
        </button>
      </div>
      <button
        class="btn btn-primary btn-go"
        id="editorUpscaleRun"
        type="button"
        :disabled="
          locked || !view.upscale.quote || !shown || !!view.upscaleWarning
        "
        @click="editor.run('upscale')"
      >
        <AppIcon name="i-upscale" /><span>放大</span
        ><span v-if="view.upscale.quote" class="cost-tag"
          ><AppIcon name="i-points" /><b>{{
            quoteLabel(view.upscale.quote)
          }}</b></span
        >
      </button>
    </div>
  </dialog>
</template>
