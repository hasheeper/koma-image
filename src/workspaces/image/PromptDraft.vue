<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useServices } from "../../app/services";
import { useShell } from "../../app/shell";
import { message, useUi } from "../../app/ui";
import { names } from "../../storage/names.ts";
import { object } from "../../domain/value.ts";
import HighlightInput from "../../shared/HighlightInput.vue";
import TagPicker from "../../shared/TagPicker.vue";
import AppIcon from "../../shared/AppIcon.vue";
const { preferences } = useServices(),
  ui = useUi(),
  { router } = useShell();
const props = defineProps<{ suggest: boolean }>();
const positiveInput =
  useTemplateRef<InstanceType<typeof HighlightInput>>("positiveInput");
const current = computed({
  get: () => (tab.value === "prompt" ? prompt.value : negative.value),
  set: (value) => {
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
const prompt = ref("");
const negative = ref("");
const tab = ref("prompt");
function select(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  tab.value =
    event.key === "Home"
      ? "prompt"
      : event.key === "End"
        ? "negative"
        : tab.value === "prompt"
          ? "negative"
          : "prompt";
  document.getElementById(`tab-${tab.value}`)?.focus();
}
</script>
<template>
  <div class="fld fld-hero promptbox" :data-tab="tab">
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
          <span>Prompt</span><span class="tab-count">{{ prompt.length }}</span>
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
          ><span class="tab-count">{{ negative.length }}</span>
        </button>
      </div>
      <div class="fld-actions">
        <button
          class="ibtn ibtn-xs"
          type="button"
          aria-label="从图片导入参数"
          disabled
        >
          <AppIcon name="i-import" />
        </button>
        <button
          class="ibtn ibtn-xs"
          type="button"
          aria-label="清洗当前输入的格式"
          disabled
        >
          <AppIcon name="i-convert" />
        </button>
        <button
          class="ibtn ibtn-xs"
          type="button"
          data-tip="Browse tags"
          aria-label="查词插入"
          @click="ui.pickerOpen.value = true"
        >
          <AppIcon name="i-search" />
        </button>
      </div>
    </div>
    <div class="promptbox-body">
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
          placeholder="输入中文或英文 Tag，可自动补全"
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
        <HighlightInput
          id="negative"
          v-model="negative"
          label="Negative"
          placeholder="lowres, blurry, watermark…"
          :suggest="props.suggest && tab === 'negative' && !ui.pickerOpen.value"
        />
      </div>
    </div>
  </div>
  <TagPicker v-model="current" />
</template>
