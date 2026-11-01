<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useServices } from "../../app/services";
import { useShell } from "../../app/shell";
import { message, useUi } from "../../app/ui";
import { naiCapabilities, naiTagDataset } from "../../domain/nai";
import NaiPromptOptions from "./NaiPromptOptions.vue";
import { names } from "../../storage/names.ts";
import { object } from "../../domain/value.ts";
import HighlightInput from "../../shared/HighlightInput.vue";
import TagPicker from "../../shared/TagPicker.vue";
import AppIcon from "../../shared/AppIcon.vue";
import NaiTokenCount from "../../shared/NaiTokenCount.vue";
import ComfyLoras from "./ComfyLoras.vue";
const { preferences } = useServices(),
  ui = useUi(),
  { router } = useShell();
import { useDrawing } from "../../app/drawing";
import { convertToNaiPrompt } from "../../native/prompt-converter.ts";
const { drawing, view } = useDrawing();
const emit = defineEmits<{ import: [] }>();
const props = defineProps<{ suggest: boolean }>();
const promptBox = useTemplateRef<HTMLElement>("promptBox");
let promptResize: ResizeObserver | undefined;
function resumeResize() {
  const hero = promptBox.value;
  if (!hero) return;
  const wraps = [...hero.querySelectorAll<HTMLElement>(".hl-wrap")];
  const saved = object(preferences.get(names.preferences, {})).promptH;
  if (typeof saved === "number" && Number.isFinite(saved) && saved > 0) {
    for (const wrap of wraps) wrap.style.height = `${saved}px`;
    hero.dataset.resized = "1";
  }
  const seen = new WeakMap<Element, number>();
  promptResize?.disconnect();
  promptResize = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const wrap = target as HTMLElement,
        height = Math.round(wrap.getBoundingClientRect().height),
        previous = seen.get(wrap);
      // The native handle sets an inline height; hidden panes report zero.
      // Release the flexible row so its parent and following fields grow with it.
      if (
        height > 0 &&
        previous !== undefined &&
        Math.abs(height - previous) > 1 &&
        wrap.style.height
      ) {
        hero.dataset.resized = "1";
        for (const other of wraps)
          if (other !== wrap) other.style.height = `${height}px`;
        void preferences
          .set(names.preferences, {
            ...object(preferences.get(names.preferences, {})),
            promptH: height,
          })
          .catch(() => {});
      }
      if (height > 0) seen.set(wrap, height);
    }
  });
  for (const wrap of wraps) promptResize.observe(wrap);
}
// Switching boards remounts this keyed child without reactivating the workspace.
onMounted(resumeResize);
onActivated(resumeResize);
const pauseResize = () => promptResize?.disconnect();
onDeactivated(pauseResize);
onBeforeUnmount(pauseResize);
const positiveInput =
  useTemplateRef<InstanceType<typeof HighlightInput>>("positiveInput");
const prompt = computed({
  get: () => view.value.form.prompt,
  set: (prompt: string) => {
    void drawing.patch({ prompt });
  },
});
const negative = computed({
  get: () => view.value.form.negative,
  set: (negative: string) => {
    void drawing.patch({ negative });
  },
});
const tab = ref("prompt");
const tabs = computed(()=>view.value.comfy ? ["prompt","negative","lora"] : ["prompt","negative"]);
const loraCount = computed(()=>view.value.comfyControls.loras?.filter(v=>v.enabled).length ?? 0);
watch(tabs,values=>{if(!values.includes(tab.value))tab.value="prompt";});
const medium = computed(() => naiCapabilities(view.value.form.model).medium);
const negativeLocked = computed(() => medium.value || view.value.comfy && !view.value.model?.comfyNegative);
const locked = computed(() => tab.value === "lora" || tab.value === "negative" && negativeLocked.value);
const current = computed({
  get: () => (tab.value === "prompt" ? prompt.value : negative.value),
  set: (value) => {
    if (locked.value) return;
    if (tab.value === "prompt") prompt.value = value;
    else negative.value = value;
  },
});
const stopDelivery = watch(
  [ui.tagDelivery, () => router.route.value.workspace],
  async ([delivery, workspace]) => {
    if (!delivery || workspace !== "image") return;
    ui.tagDelivery.value = 0;
    try {
      const pending = object(await preferences.take(names.tagHandoff));
      if (
        typeof pending.prompt !== "string" ||
        !pending.prompt.trim() ||
        typeof pending.at !== "number" ||
        Date.now() - pending.at > 30 * 60 * 1000
      )
        return;
      const text = pending.prompt.trim(),
        count = text.split(",").filter((v) => v.trim()).length;
      if (
        !(await ui.confirm({
          title: `插入 ${count} 个 Tag？`,
          message: "来自 Tag 词典的组合，将追加到描述末尾。",
          confirmLabel: "插入",
        }))
      )
        return;
      const existing = prompt.value.trimEnd().replace(/,+$/, "");
      prompt.value = existing ? `${existing}, ${text}` : text;
      tab.value = "prompt";
      await nextTick();
      positiveInput.value?.end();
    } catch (error) {
      ui.toast(message(error), "err");
    }
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(stopDelivery);
const cleaned = ref(false);
watch(current, () => {
  cleaned.value = false;
});
async function cleanPrompt() {
  if (locked.value) return;
  const before = current.value;
  if (!before.trim()) {
    ui.toast("没有需要清洗的内容");
    return;
  }
  const converted = convertToNaiPrompt(before);
  current.value = converted;
  await nextTick();
  cleaned.value = true;
  ui.toast(converted === before ? "格式已经是 NAI 写法" : "格式已清洗", "ok");
}
function select(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const list=tabs.value,index=list.indexOf(tab.value);
  tab.value=event.key==="Home" ? list[0] : event.key==="End" ? list[list.length-1] : list[(index+(event.key==="ArrowRight"?1:-1)+list.length)%list.length];
  document.getElementById(`tab-${tab.value}`)?.focus();
}
</script>
<template>
  <div ref="promptBox" class="fld fld-hero promptbox" :data-tab="tab">
    <div class="promptbox-head">
      <div class="tabs" role="tablist" aria-label="Prompt" @keydown="select">
        <button
          id="tab-prompt"
          class="tab"
          type="button"
          role="tab"
          aria-controls="panePrompt"
          :aria-selected="tab === 'prompt'"
          :tabindex="tab === 'prompt' ? 0 : -1"
          @click="tab = 'prompt'"
        >
          <span>Prompt</span
          ><NaiTokenCount field="prompt" :text="prompt" />
        </button>
        <button
          id="tab-negative"
          class="tab"
          type="button"
          role="tab"
          aria-controls="paneNegative"
          :aria-selected="tab === 'negative'"
          :tabindex="tab === 'negative' ? 0 : -1"
          @click="tab = 'negative'"
        >
          <span>Negative</span
          ><NaiTokenCount field="negative" :text="negative" />
        </button>
        <button v-if="view.comfy" id="tab-lora" class="tab" type="button" role="tab" aria-controls="paneLora" :aria-selected="tab==='lora'" :tabindex="tab==='lora'?0:-1" @click="tab='lora'"><span>LoRA</span><span v-if="loraCount">{{ loraCount }}</span></button>
      </div>
      <div class="fld-actions">
        <button
          class="ibtn ibtn-xs"
          type="button"
          aria-label="从图片导入参数"
          @click="emit('import')"
        >
          <AppIcon name="i-import" />
        </button>
        <button
          class="ibtn ibtn-xs"
          type="button"
          v-if="!view.comfy"
          aria-label="清洗当前输入的格式"
          :disabled="locked"
          @click="cleanPrompt"
          :data-state="cleaned ? 'done' : undefined"
        >
          <AppIcon name="i-convert" />
        </button>
        <button
          class="ibtn ibtn-xs"
          type="button"
          data-tip="Browse tags"
          v-if="tab!=='lora'"
          aria-label="查词插入"
          :disabled="locked"
          @click="ui.pickerOpen.value = true"
        >
          <AppIcon name="i-search" />
        </button>
      </div>
    </div>
    <div class="promptbox-body" :class="{ 'with-options': naiCapabilities(view.form.model).supported }">
      <!-- Hosts are declared here. The highlighter may paint a mirror, never wrap or move Vue nodes. -->
      <div
        id="panePrompt"
        class="pane"
        role="tabpanel"
        aria-labelledby="tab-prompt"
        :hidden="tab !== 'prompt'"
        tabindex="-1"
      >
        <HighlightInput
          id="prompt"
          ref="positiveInput"
          v-model="prompt"
          label="Prompt"
          :placeholder="naiTagDataset(view.form) === 'furry' ? '输入英文 Furry Tag，可自动补全' : '输入中文或英文 Tag，可自动补全'"
          :dataset="naiTagDataset(view.form)"
          :suggest="props.suggest && tab === 'prompt' && !ui.pickerOpen.value"
        />
      </div>
      <div
        id="paneNegative"
        class="pane"
        role="tabpanel"
        aria-labelledby="tab-negative"
        :hidden="tab !== 'negative'"
        tabindex="-1"
      >
        <p v-if="view.comfy && !view.model?.comfyNegative" class="hint">由工作流固定，当前负向输入不会发送。</p>
        <HighlightInput
          id="negative"
          v-model="negative"
          label="Negative"
          :placeholder="view.comfy && !view.model?.comfyNegative ? '由工作流固定' : 'lowres, blurry, watermark…'"
          :readonly="negativeLocked"
          :dataset="naiTagDataset(view.form)"
          :suggest="props.suggest && !negativeLocked && tab === 'negative' && !ui.pickerOpen.value"
        />
      </div>
      <NaiPromptOptions v-if="!view.comfy" :negative="tab === 'negative'" />
      <div v-if="view.comfy" id="paneLora" class="pane" role="tabpanel" aria-labelledby="tab-lora" :hidden="tab!=='lora'" tabindex="-1"><ComfyLoras /></div>
    </div>
  </div>
  <TagPicker v-if="tab!=='lora'" v-model="current" :dataset="naiTagDataset(view.form)" />
</template>

<style scoped>
.promptbox-body { position: relative; }
.with-options :deep(.hl-wrap) { padding-bottom: 34px; }
</style>
