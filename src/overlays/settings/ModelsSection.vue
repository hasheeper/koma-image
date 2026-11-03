<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { configuredModels, initialModelEntries } from "../../domain/models";
import type { ModelIdentity } from "../../domain/models";
import { catalogEntries, linkFor, sourceState, supportsModel } from "../../domain/catalog";
import type { Routing, ModelLink } from "../../config/connections";
import type { CatalogModel } from "../../domain/catalog";
import { imageConnections } from "../../config/connections";
import { useUi, message } from "../../app/ui";
import { useServices } from "../../app/services";
import ModelIcon from "../../shared/ModelIcon.vue";
import AppIcon from "../../shared/AppIcon.vue";
import ModelEntryDialog from "./ModelEntryDialog.vue";
import ModelSourceRow from "./ModelSourceRow.vue";
import ModelSourceAdd from "./ModelSourceAdd.vue";
import ModelParametersDialog from "./ModelParametersDialog.vue";
const props = defineProps<{
  active: boolean;
  routing: Routing;
  raw: Record<string, unknown>;
  statuses: Record<string, { s: string; text: string }>;
  currentModel?: CatalogModel;
}>();
const emit = defineEmits<{ reload: [connection?: string] }>();
const ui = useUi(), { connections } = useServices();
const editor = useTemplateRef<InstanceType<typeof ModelEntryDialog>>("editor");
const parameters = useTemplateRef<InstanceType<typeof ModelParametersDialog>>("parameters");
const sourceTriggers = useTemplateRef<HTMLButtonElement[]>("sourceTriggers"), rowTriggers = useTemplateRef<HTMLButtonElement[]>("rowTriggers");
const opened = ref(new Set<string>()), saving = ref(false);
const addingSource = ref<string | null>(null);
const groups = { gpt: "GPT", gemini: "Gemini", novelai: "NovelAI" };
const models = computed(() => configuredModels(props.routing));
const sources = computed(() => imageConnections(props.routing));
const failures = computed(() => sources.value.filter(c => props.statuses[c.id]?.s === "err"));
const modelSources = (m: ModelIdentity) => sources.value.filter(c => supportsModel(props.routing, c.id, m));
const entries = (c: string) => catalogEntries(props.raw[c]);
const link = (c: string, m: ModelIdentity) => linkFor(props.routing, c, m, entries(c));
const state = (c: string, m: ModelIdentity) => sourceState(props.routing, c, m, entries(c));
const configuredSources = (m: ModelIdentity) => modelSources(m).flatMap(c => {
  const value = link(c.id, m);
  return value ? [{ connection: c, link: value }] : [];
});
const unlinkedSources = (m: ModelIdentity) => modelSources(m).filter(c => !link(c.id, m))
  .map(c => ({ connection: c, entries: spare(c.id, m) }))
  .filter(source => m.family !== "novelai" || source.entries.length > 0);
const showSourceAdd = (m: ModelIdentity) => opened.value.has(m.id) && (unlinkedSources(m).length > 0 || !configuredSources(m).length);
async function closeSource(id: string) {
  if (addingSource.value !== id) return;
  addingSource.value = null;
  await nextTick();
  const trigger = sourceTriggers.value?.find(button => button.dataset.sourceModel === id && !button.disabled)
    ?? rowTriggers.value?.find(button => button.dataset.sourceModel === id);
  trigger?.focus();
}
watch(() => props.active, active => { if (!active) { addingSource.value = null; parameters.value?.close(); } });
function summary(m: ModelIdentity) {
  const available = modelSources(m), enabled = available.filter(c => state(c.id, m) === "on");
  const mapped = available.some(c => link(c.id, m));
  const label = enabled[0]?.name ?? (mapped ? available.some(c => link(c.id, m)?.on) ? "暂不可用" : "已停用" : "未配置");
  return { label, extra: Math.max(0, enabled.length - 1), active: enabled.length > 0,
    title: enabled.length ? `${enabled.length} 个已启用来源：${enabled.map(c => c.name).join("、")}` : label };
}
function spare(c: string, m: ModelIdentity) {
  const claimed = new Set(models.value.map(model => link(c, model)?.id).filter(Boolean));
  return entries(c).filter(e => !claimed.has(e.id) && (!e.family || e.family === m.family));
}
// Inline edits can blur just before another control is used. Serialize local writes
// and clone the latest saved configuration so unrelated source edits stay intact.
let pending = Promise.resolve();
function change(c: string, m: ModelIdentity, value: ModelLink | null | boolean, adding = false) {
  const task = pending.then(async () => {
    saving.value = true;
    try {
      const next: Routing = structuredClone(connections.configuration);
      const model = configuredModels(next).find(item => item.id === m.id);
      if (!model || !supportsModel(next, c, model)) throw new Error("模型或来源已改变，请重新打开");
      const previous = linkFor(next, c, model, entries(c));
      if (adding && previous) throw new Error("此供应商已配置来源，请直接编辑已有 ID");
      if (typeof value === "boolean" && !previous) throw new Error("请先填写上游 ID");
      const updated = typeof value === "boolean" && previous ? { ...previous, on: value } : typeof value === "boolean" ? null : value;
      if (updated) {
        const other = configuredModels(next).find(item => item.id !== m.id && linkFor(next, c, item, entries(c))?.id === updated.id);
        if (other) throw new Error(`此 ID 已用于「${other.name}」`);
      }
      next.links[c] ??= {};
      if (updated) next.links[c][m.id] = updated;
      else delete next.links[c][m.id];
      await connections.save(next);
    } finally { saving.value = false; }
  });
  pending = task.catch(() => {});
  return task;
}
function expand(id: string) {
  const next = new Set(opened.value);
  if (next.has(id)) { next.delete(id); if (addingSource.value === id) addingSource.value = null; }
  else next.add(id);
  opened.value = next;
}
async function remove(model: ModelIdentity) {
  if (model.family === "novelai" || !await ui.confirm({
    title: `删除「${model.name}」？`, message: "删除此模型配置，已有图片和历史记录保留。", confirmLabel: "删除", tone: "danger",
  })) return;
  try {
    const next: Routing = structuredClone(connections.configuration);
    next.models = (next.models ?? initialModelEntries()).filter(m => m.id !== model.id);
    for (const links of Object.values(next.links)) delete links[model.id];
    await connections.save(next);
    editor.value?.close();
    if (props.currentModel?.id === model.id) ui.toast("模型已删除，请在工作区重新选择");
  } catch (e) { ui.toast(message(e), "err"); }
}
defineExpose({ close: () => { editor.value?.close(); parameters.value?.close(); }, reveal(id: string) { opened.value = new Set([...opened.value, id]); } });
</script>
<template>
  <section class="sp-sec" aria-label="模型">
    <div class="sp-sec-head"><h3>模型</h3></div>
    <div class="sm">
      <div v-if="failures.length" class="sm-notices">
        <div v-for="c in failures" :key="c.id" class="sm-notice" role="status">
          <AppIcon name="i-alert" /><span><b>{{ c.name }}</b> · {{ statuses[c.id].text }}</span>
          <button class="ibtn" type="button" :aria-label="`重试 ${c.name} 目录`" title="重新读取目录" @click="emit('reload', c.id)"><AppIcon name="i-retry" /></button>
        </div>
      </div>
      <div v-for="(title, family) in groups" :key="family" class="sm-group">
        <div class="sm-ghead">
          <div class="sm-gtitle"><ModelIcon :family="family" /><div class="sm-glabel"><h4>{{ title }}</h4><span>{{ models.filter(m => m.family === family).length }}</span></div></div>
          <button v-if="family !== 'novelai'" class="md-act sm-add" type="button" :disabled="saving" :aria-label="`新增 ${title} 模型`" :title="`新增 ${title} 模型`" @click="editor?.open(family)"><AppIcon name="i-plus" /></button>
        </div>
        <div v-if="models.some(m => m.family === family)" class="sm-list">
          <div v-for="model in models.filter(m => m.family === family)" :key="model.id" class="sm-model" :data-model="model.id" :data-open="opened.has(model.id)">
            <div class="sm-row">
              <button ref="rowTriggers" class="sm-trigger" type="button" :data-source-model="model.id" :aria-expanded="opened.has(model.id)" :aria-controls="`model-sources-${model.id}`" :aria-label="`${opened.has(model.id) ? '收起' : '展开'} ${model.name} 的来源`" @click="expand(model.id)">
                <span v-if="!opened.has(model.id)" class="sm-overview"><span class="sm-pill" :data-active="summary(model).active" :title="summary(model).title"><span>{{ summary(model).label }}</span><small v-if="summary(model).extra">+{{ summary(model).extra }}</small></span></span>
                <AppIcon name="i-chevron" class="sm-chevron" />
              </button>
              <div class="sm-title"><span>{{ model.name }}</span><button v-if="family !== 'novelai'" class="md-act sm-edit" type="button" :disabled="saving" :aria-label="`编辑 ${model.name}`" title="编辑模型" @click="editor?.open(model)"><AppIcon name="i-rename" /></button></div>
              <button v-if="showSourceAdd(model)" ref="sourceTriggers" class="md-act sm-source-plus" type="button" :data-source-model="model.id" :aria-label="`为 ${model.name} 添加来源`" :aria-expanded="addingSource === model.id" :title="unlinkedSources(model).length ? '添加来源' : '暂无可添加的供应商'" :disabled="saving || !unlinkedSources(model).length || addingSource === model.id" @click="addingSource = model.id"><AppIcon name="i-plus" /></button>
            </div>
            <div v-if="opened.has(model.id)" :id="`model-sources-${model.id}`" class="sm-lines" :data-empty="!configuredSources(model).length && addingSource !== model.id">
              <ModelSourceRow v-for="source in configuredSources(model)" :key="source.connection.id" :model="model" :connection="source.connection" :link="source.link" :state="state(source.connection.id, model)"
                :entries="entries(source.connection.id)" :saving="saving" :current="currentModel?.id === model.id && currentModel.connection === source.connection.id"
                :save="value => change(source.connection.id, model, value)" @parameters="parameters?.open(model, source.connection)" />
              <ModelSourceAdd v-if="addingSource === model.id" :model="model" :sources="unlinkedSources(model)" :save="(connection, id) => change(connection, model, { id, manual: true, on: true }, true)" @close="closeSource(model.id)" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <ModelEntryDialog ref="editor" :routing="routing" @remove="remove" />
    <ModelParametersDialog ref="parameters" :routing="routing" :raw="raw" :statuses="statuses" @reload="emit('reload', $event)" />
  </section>
</template>
