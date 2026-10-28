<script setup lang="ts">
import { computed } from "vue";
import { useNaiComposer } from "../../app/nai-composer";
import { naiCapabilities, NAI_FULL, NAI_MEDIUM, naiDataset, effectiveNaiMode } from "../../domain/nai";
import { findModel } from "../../domain/models";
import NaiSelect from "./NaiSelect.vue";
import AppIcon from "../../shared/AppIcon.vue";
const { drawing, view, id } = useNaiComposer();
const f = computed(() => view.value.form);
const cap = computed(() => naiCapabilities(f.value.model));
const modelOptions = computed(() => {
  const list = view.value.models.filter(m => m.id !== NAI_MEDIUM);
  const medium = view.value.models.find(m => m.id === NAI_MEDIUM);
  if (medium && !list.some(m => m.id === NAI_FULL)) list.unshift({ ...medium, id: NAI_FULL });
  return list;
});
const baseModel = computed(() => cap.value.medium ? NAI_FULL : f.value.model);
const available = (id: string) => view.value.models.some(m => m.id === id);
function selectModel(id: string) {
  void drawing.patch({ model: id === NAI_FULL && !available(NAI_FULL) ? NAI_MEDIUM : id });
}
function selectEffort(value: string) {
  const id = value === "medium" ? NAI_MEDIUM : NAI_FULL;
  if (available(id)) void drawing.patch({ model: id });
}
const mode = computed(() => effectiveNaiMode(f.value.naiMode, f.value.prompt));
const dataset = computed(() => naiDataset(f.value.prompt));
const modeTitle = computed(() => dataset.value ? `提示词以 ${dataset.value} dataset 开头；切换模式请先移除该标签` : "Anime／Furry：切换数据集与标签补全");
const modeOptions = computed(() => [
  { value: "anime" as const, label: "Anime", icon: "i-sakura", disabled: dataset.value === "fur", title: dataset.value === "fur" ? modeTitle.value : undefined },
  { value: "furry" as const, label: "Furry", icon: "i-paw", disabled: dataset.value === "background", title: dataset.value === "background" ? modeTitle.value : undefined },
]);
const effort = computed(() => cap.value.medium ? "medium" : "high");
const effortOptions = computed(() => [
  { value: "high", label: "High", disabled: !available(NAI_FULL) },
  { value: "medium", label: "Medium", disabled: !available(NAI_MEDIUM) },
]);
// NAI models show the official name whichever source supplies them.
const officialName = (id: string, name: string) => { const known = findModel(id); return known?.family === "novelai" ? known.name : name; };
const modelChoices = computed(() => modelOptions.value.map(m => ({ value: m.id, label: officialName(m.id, m.name) })));
const modelDisplay = computed(() => {
  if (!view.value.models.length) return view.value.catalogLoading ? "加载中…" : view.value.catalogError ? "连接未就绪" : "未配置连接";
  return modelChoices.value.find(c => c.value === baseModel.value)?.label ?? view.value.model?.name ?? baseModel.value;
});
</script>
<template>
  <div class="fld">
    <div class="model-row">
      <NaiSelect :id="id('model')" label="模型" variant="model" :value="baseModel" :display="modelDisplay" :title="modelDisplay" :disabled="view.locked || !view.models.length" :options="modelChoices" @change="selectModel"><AppIcon class="model-ico" name="i-model" /></NaiSelect>
    </div>
    <div v-if="cap.supported" class="model-switches">
      <div :id="id('naiMode')" class="seg" role="radiogroup" aria-label="模式" :data-value="mode" :title="modeTitle">
        <label v-for="o in modeOptions" :key="o.value" :title="o.title"><input type="radio" :name="id('naiMode')" :value="o.value" :checked="mode === o.value" :disabled="view.locked || o.disabled" @change="drawing.patch({ naiMode: o.value })" /><span><AppIcon v-if="!cap.effort" class="solid" :name="o.icon" />{{ o.label }}</span></label>
      </div>
      <div v-if="cap.effort" :id="id('effort')" class="seg" role="radiogroup" aria-label="Effort" title="Effort：Medium 固定 14 步、Euler A；High 可完整调节参数" :data-value="effort">
        <label v-for="o in effortOptions" :key="o.value"><input type="radio" :name="id('effort')" :value="o.value" :checked="effort === o.value" :disabled="view.locked || o.disabled" @change="selectEffort(o.value)" /><span>{{ o.label }}</span></label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-row { display: flex; align-items: center; min-width: 0; height: 34px; padding: 3px; background: var(--well); border: 1px solid var(--line); border-radius: var(--r3); }
.model-row :deep(.choice-model) { gap: 7px; height: 26px; }
.model-ico { flex: none; --ico: var(--ico-sm); color: var(--a); fill: currentColor; stroke: none; }
/* Mode and Effort are always-visible switches under the model; they stay side by side even where .seg stacks on phones. */
.model-switches { display: flex; gap: 8px; }
.model-switches .seg { flex: 1; min-width: 0; grid-auto-flow: column; grid-auto-columns: 1fr; }
.model-switches .seg span { display: flex; align-items: center; justify-content: center; gap: 6px; padding-block: 4px; }
/* Only the lone mode switch carries the sakura and paw; beside Effort the four labels stay text-only. */
.model-switches .seg .ico { --ico: var(--ico-sm); }
.model-switches input:checked + span .ico { color: var(--a); }
.model-switches input:disabled + span { opacity: .4; color: var(--fg-3); cursor: default; }
@media (pointer: coarse), (max-width: 860px) { .model-row { height: 40px; } .model-row :deep(.choice-model) { height: 32px; } .model-switches .seg span { padding-block: 5px; } }
</style>
