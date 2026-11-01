<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, ref, useTemplateRef } from "vue";
import type { Connection } from "../../config/connections.ts";
import { connectionWorkflows, newComfyId, validateComfyWorkflows } from "../../domain/comfy-workflows.ts";
import type { ComfyWorkflowEntry } from "../../domain/comfy-workflows.ts";
import ComfyWorkflowFields from "./ComfyWorkflowFields.vue";
import { object } from "../../domain/value.ts";
const props = defineProps<{ initial?: Connection; disabled?: boolean }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
type Draft = { id: string; name: string; initial?: ComfyWorkflowEntry };
const draft = (entry: ComfyWorkflowEntry): Draft => ({ id: entry.id, name: entry.name, initial: markRaw(entry) });
const drafts = ref<Draft[]>(props.initial?.profileId === "comfyui-workflow" ? connectionWorkflows(props.initial).map(draft) : [{ id: "default", name: "工作流 1" }]);
const active = ref(drafts.value[0].id), reading = ref(false), error = ref("");
const busyIds = new Set<string>();
const locked = computed(() => props.disabled || reading.value);
const editors = new Map<string, InstanceType<typeof ComfyWorkflowFields>>();
const bundleFile = useTemplateRef<HTMLInputElement>("bundleFile");
let version = 0;
function editor(id: string, value: unknown) {
  if (value) editors.set(id, value as InstanceType<typeof ComfyWorkflowFields>);
  else editors.delete(id);
}
function busy(id: string, value: boolean) {
  if (value) busyIds.add(id); else busyIds.delete(id);
  emit("busy", reading.value || busyIds.size > 0);
}
function add() {
  const id = newComfyId();
  drafts.value.push({ id, name: `工作流 ${drafts.value.length + 1}` }); active.value = id;
}
function remove() {
  const index = drafts.value.findIndex(d => d.id === active.value);
  drafts.value.splice(index, 1); active.value = drafts.value[Math.max(0, index - 1)].id;
}
async function importBundle(event: Event) {
  const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file || locked.value || busyIds.size) return;
  const current = ++version; reading.value = true; emit("busy", true); error.value = "";
  try {
    const raw = object(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
    if (current !== version) return;
    if (raw.format !== "koma-comfy-workflows" || raw.version !== 1) throw new Error("请选择 Koma 工作流配置包；普通 API JSON 请在下面导入");
    const entries = validateComfyWorkflows(raw.workflows);
    const existing = new Set(drafts.value.map(d => d.id));
    const added = entries.map(entry => {
      const id = existing.has(entry.id) ? newComfyId() : entry.id; existing.add(id);
      return draft({ ...entry, id });
    });
    drafts.value.push(...added); active.value = added[0].id;
  } catch (e) { if (current === version) error.value = e instanceof Error ? e.message : "配置包读取失败"; }
  finally { if (current === version) { reading.value = false; emit("busy", busyIds.size > 0); } }
}
function configuration() {
  if (reading.value || busyIds.size) throw new Error("工作流文件读取中，请稍候");
  return validateComfyWorkflows(drafts.value.map(d => {
    try {
      const fields = editors.get(d.id)?.configuration();
      if (!fields) throw new Error("工作流尚未就绪");
      return validateComfyWorkflows([{ ...fields, id: d.id, name: d.name }])[0];
    } catch (e) { active.value = d.id; throw new Error(`「${d.name}」${e instanceof Error ? e.message : "配置无效"}`); }
  }));
}
onBeforeUnmount(() => { version++; emit("busy", false); });
defineExpose({ configuration });
</script>
<template>
  <div class="comfy-workflows">
    <div class="fld">
      <label for="comfyWorkflowSelect">工作流</label>
      <select id="comfyWorkflowSelect" v-model="active" :disabled="locked">
        <option v-for="(d, i) in drafts" :key="d.id" :value="d.id">{{ d.name || `工作流 ${i + 1}` }}</option>
      </select>
      <p class="hint">不同模型管线分别配置；同一管线可指定多个兼容模型，共用此供应商的地址与 Key。</p>
    </div>
    <div class="comfy-workflow-actions">
      <button class="btn btn-quiet" type="button" :disabled="locked" @click="add">添加工作流</button>
      <button class="btn btn-quiet" type="button" :disabled="locked || drafts.length < 2" @click="remove">删除工作流</button>
      <input ref="bundleFile" type="file" accept=".json,application/json" hidden @change="importBundle" />
      <button class="btn btn-quiet" type="button" :disabled="locked" @click="bundleFile?.click()">{{ reading ? "读取中…" : "导入配置包" }}</button>
    </div>
    <p v-if="error" class="modal-error" role="alert">{{ error }}</p>
    <div v-for="(d, index) in drafts" v-show="active === d.id" :key="d.id" class="comfy-workflow-editor" :aria-label="d.name">
      <div class="fld"><label :for="`workflow-name-${d.id}`">工作流名称</label><input :id="`workflow-name-${d.id}`" v-model="d.name" maxlength="128" :disabled="locked" placeholder="如 SDXL、FLUX、Anima" /></div>
      <ComfyWorkflowFields :ref="value => editor(d.id, value)" :initial="d.initial" :id-prefix="index ? `${d.id}-` : ''" :disabled="locked" @busy="busy(d.id, $event)" />
    </div>
  </div>
</template>
<style scoped>
.comfy-workflows, .comfy-workflow-editor { display: grid; gap: var(--sp-3); }
.comfy-workflow-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
</style>
