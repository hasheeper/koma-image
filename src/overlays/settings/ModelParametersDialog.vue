<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { useServices } from "../../app/services";
import { message } from "../../app/ui";
import { catalogEntries, linkFor, normalizeCatalog } from "../../domain/catalog";
import { configuredModels } from "../../domain/models";
import type { ModelIdentity } from "../../domain/models";
import type { Connection, Routing } from "../../config/connections";
import type { ParameterField, ParameterFields, ParameterOverrides } from "../../domain/model-parameters";
import { validateParameterOverrides } from "../../domain/model-parameters";
import { nativeMappedCatalog } from "../../gateway/native-protocols";
import { profileFor } from "../../gateway/profile";
import AppIcon from "../../shared/AppIcon.vue";
import ModelIcon from "../../shared/ModelIcon.vue";
import ModelParameterInput from "../../shared/ModelParameterInput.vue";

const props = defineProps<{ routing: Routing; raw: Record<string, unknown>; statuses: Record<string, { s: string; text: string }> }>();
const emit = defineEmits<{ reload: [connection: string] }>();
const { connections } = useServices();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
type Row = { uid: number; original: string; key: string; on: boolean; type: "string" | "number" | "boolean"; options: string; optionDraft: string; default: string; min: string; max: string; allowCustom: boolean; dirty: boolean; label?: string };
const selected = ref<{ model: ModelIdentity; connection: Connection; upstreamId: string } | null>(null);
const rows = ref<Row[]>([]), busy = ref(false), error = ref("");
const expanded = ref<number | null>(null);
let nextId = 0, overrides: ParameterOverrides = {};
const removed = new Set<string>();
const base = computed(() => {
  const selection = selected.value;
  if (!selection) return { fields: {} as ParameterFields, parameterSource: "declared" };
  const { connection, model } = selection, routing = structuredClone(props.routing);
  if (routing.links[connection.id]?.[model.id]) {
    delete routing.links[connection.id][model.id].parameters;
    routing.links[connection.id][model.id].on = true;
  }
  const profile = profileFor(connection.profileId), raw = (props.raw[connection.id] ?? { models: {} }) as Record<string, unknown>;
  return normalizeCatalog(nativeMappedCatalog(profile, raw, routing, connection.id), routing, connection.id, profile)
    .models.find(m => m.id === model.id) ?? { fields: {} as ParameterFields, parameterSource: "declared" };
});
const status = computed(() => selected.value ? props.statuses[selected.value.connection.id] : undefined);
const sourceLabel = computed(() => base.value.parameterSource === "reference" ? "参考预设" : Object.keys(base.value.fields).length ? "接口声明" : "未声明参数");
const sourceHint = computed(() => base.value.parameterSource === "reference" ? "接口未声明参数，当前使用参考预设，可自行修改。" : Object.keys(base.value.fields).length ? "参数来自此来源的模型目录声明，可自行补充和调整。" : "接口未声明参数，可手动添加。");
const protocolHint = computed(() => selected.value && profileFor(selected.value.connection.profileId).protocol === "gemini-native"
  ? "扩展字段相对 generationConfig，如 temperature、imageConfig.imageSize。" : "字段按接口原名填写，如 quality、size、output_format。");
function row(key: string, field: ParameterField | null): Row {
  return { uid: ++nextId, original: key, key, on: field !== null, type: field?.type ?? "string", options: field?.options.join(", ") ?? "", optionDraft: "", default: field?.default ?? "",
    min: field?.min === undefined ? "" : String(field.min), max: field?.max === undefined ? "" : String(field.max), allowCustom: field?.allowCustom === true, dirty: false, label: field?.label };
}
function refreshRows() {
  const fields = base.value.fields;
  const keys = new Set([...Object.keys(fields), ...Object.keys(overrides)]);
  const previousRows = rows.value;
  const current = new Map(previousRows.filter(r => r.original).map(r => [r.original, r]));
  rows.value = [...keys].filter(key => !removed.has(key)).map(key => {
    const previous = current.get(key);
    if (previous?.dirty) return previous;
    const value = row(key, overrides[key] ?? fields[key] ?? null);
    if (overrides[key] === null) value.on = false;
    return value;
  });
  for (const previous of previousRows) if (previous.dirty && (!previous.original || !keys.has(previous.original))) rows.value.push(previous);
}
watch(base, () => { if (selected.value) refreshRows(); });
function open(model: ModelIdentity, connection: Connection) {
  const link = linkFor(props.routing, connection.id, model, catalogEntries(props.raw[connection.id]));
  if (!link || model.family === "novelai" || busy.value) return;
  overrides = structuredClone(link.parameters ?? {});
  removed.clear();
  rows.value = []; error.value = ""; expanded.value = null;
  selected.value = { model, connection, upstreamId: link.id };
  refreshRows();
  dialog.value?.showModal();
}
function close() { if (!busy.value) { dialog.value?.close(); selected.value = null; rows.value = []; overrides = {}; expanded.value = null; } }
async function add() {
  const value = row("", { options: [], default: "" }); value.dirty = true; rows.value.push(value); expanded.value = value.uid;
  await nextTick();
  dialog.value?.querySelector<HTMLInputElement>(`#mp-key-${value.uid}`)?.focus();
}
function reset() { overrides = {}; removed.clear(); rows.value = []; expanded.value = null; refreshRows(); }
function remove(r: Row) {
  if (r.original && base.value.fields[r.original]) { r.on = false; r.dirty = true; }
  else { if (r.original) removed.add(r.original); rows.value.splice(rows.value.indexOf(r), 1); }
  if (expanded.value === r.uid) expanded.value = null;
}
const optionValues = (value: string) => [...new Set(value.split(/[,，\n]/).map(v => v.trim()).filter(Boolean))];
function addOptions(r: Row) {
  if (!r.optionDraft.trim()) return;
  r.options = optionValues(`${r.options},${r.optionDraft}`).join(", "); r.optionDraft = ""; r.dirty = true;
}
function removeOption(r: Row, value: string) {
  r.options = optionValues(r.options).filter(option => option !== value).join(", ");
  if (r.default === value) r.default = "";
  r.dirty = true;
}
function field(r: Row): ParameterField {
  return { type: r.type, options: r.type === "boolean" ? ["true", "false"] : optionValues(r.options), default: r.default.trim(),
    ...(r.label ? { label: r.label } : {}), ...(r.allowCustom && r.type === "string" ? { allowCustom: true } : {}),
    ...(r.type === "number" && r.min.trim() ? { min: Number(r.min) } : {}), ...(r.type === "number" && r.max.trim() ? { max: Number(r.max) } : {}) };
}
async function save() {
  if (!selected.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    const selection = selected.value, next = structuredClone(connections.configuration);
    const model = configuredModels(next).find(m => m.id === selection.model.id);
    const link = model && linkFor(next, selection.connection.id, model, catalogEntries(props.raw[selection.connection.id]));
    if (!link || link.id !== selection.upstreamId || next.connections[selection.connection.id]?.revision !== selection.connection.revision) throw new Error("模型或来源已改变，请重新打开参数配置");
    const parameters: ParameterOverrides = {}, keys = new Set<string>();
    for (const r of rows.value) {
      addOptions(r);
      const key = r.key.trim();
      if (!key || keys.has(key)) throw new Error("字段名不能为空或重复");
      keys.add(key);
      if (r.original && key !== r.original && base.value.fields[r.original]) parameters[r.original] = null;
      if (!r.dirty && !Object.hasOwn(overrides, r.original)) continue;
      parameters[key] = r.on ? field(r) : null;
    }
    next.links[selection.connection.id] ??= {};
    next.links[selection.connection.id][selection.model.id] = { ...link, parameters: validateParameterOverrides(parameters) };
    await connections.save(next);
    dialog.value?.close(); selected.value = null; rows.value = []; overrides = {};
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
onBeforeUnmount(() => dialog.value?.close());
defineExpose({ open, close });
</script>
<template>
  <dialog ref="dialog" class="modal set-ui model-parameters-dialog" aria-label="来源参数" @cancel.prevent="close">
    <form class="modal-form" @submit.prevent="save">
      <header class="modal-head">
        <div class="mp-heading" :title="`上游 ID：${selected?.upstreamId ?? ''}`">
          <h2 tabindex="-1" autofocus><ModelIcon :family="selected?.model.family" />{{ selected?.model.name }}</h2>
          <div class="mp-tags">
            <span class="type" :title="`供应商：${selected?.connection.name ?? ''}`">{{ selected?.connection.name }}</span>
            <span class="type" :title="sourceHint">{{ sourceLabel }}<span v-if="base.parameterSource === 'reference'" class="sr-only"> · 接口未声明参数</span></span>
          </div>
          <span class="sr-only">上游 ID：{{ selected?.upstreamId }}</span>
        </div>
        <div class="mp-head-actions">
          <button class="ibtn" type="button" :aria-label="status?.s === 'wait' ? '读取中…' : '重新读取'" :title="status?.s === 'wait' ? '读取中…' : '重新读取参数声明'" :disabled="busy || status?.s === 'wait'" @click="selected && emit('reload', selected.connection.id)"><AppIcon name="i-retry" /></button>
          <button class="ibtn" type="button" aria-label="关闭来源参数" :disabled="busy" @click="close"><AppIcon name="i-close" /></button>
        </div>
      </header>
      <div class="modal-body">
        <p v-if="status?.s === 'err'" class="modal-error" role="status">{{ status.text }}</p>
        <div class="mp-fields">
          <div class="mp-columns">
            <div class="mp-column-title"><span>参数</span><button class="ibtn ibtn-xs mp-add" type="button" aria-label="添加参数" title="添加参数" :disabled="busy" @click="add"><AppIcon name="i-plus" /></button></div>
            <span v-if="rows.length" title="留空时跟随接口">默认值</span>
          </div>
          <div v-for="r in rows" :key="r.uid" class="mp-field" role="group" :aria-label="r.key || '新参数'" :data-off="!r.on">
            <div class="mp-row">
              <div v-if="expanded === r.uid" class="mp-key-editor">
                <button class="ibtn" type="button" :disabled="busy" :aria-label="`${r.key || '新参数'} 字段设置`" aria-expanded="true" :aria-controls="`mp-definition-${r.uid}`" title="收起字段设置" @click="expanded = null"><AppIcon name="i-chevron" /></button>
                <label class="sr-only" :for="`mp-key-${r.uid}`">字段名</label><input :id="`mp-key-${r.uid}`" v-model="r.key" class="mp-key-input" type="text" placeholder="字段名" maxlength="128" required spellcheck="false" :disabled="busy" :title="protocolHint" :aria-describedby="`mp-protocol-${r.uid}`" @input="r.dirty = true" />
              </div>
              <button v-else class="mp-name" type="button" :disabled="busy" :aria-label="`${r.key || '新参数'} 字段设置`" aria-expanded="false" :aria-controls="`mp-definition-${r.uid}`" title="编辑字段定义" @click="expanded = r.uid">
                <AppIcon name="i-chevron" /><code>{{ r.key || '新参数' }}</code>
              </button>
              <div class="mp-value">
                <label class="sr-only" :for="`mp-default-${r.uid}`">默认值</label>
                <ModelParameterInput :id="`mp-default-${r.uid}`" :field="field(r)" :value="r.default" :disabled="busy || !r.on" @change="r.default = $event; r.dirty = true" />
              </div>
              <label class="s-toggle" :title="r.on ? '停用参数' : '启用参数'">
                <input v-model="r.on" type="checkbox" role="switch" :aria-label="`启用 ${r.key || '新参数'}`" :disabled="busy" @change="r.dirty = true" /><span class="switch" aria-hidden="true" />
              </label>
            </div>
            <fieldset v-if="expanded === r.uid" :id="`mp-definition-${r.uid}`" :disabled="busy" class="mp-definition fld-group" @input="r.dirty = true" @change="r.dirty = true">
              <legend class="sr-only">{{ r.key || '新参数' }} 字段定义</legend>
              <p :id="`mp-protocol-${r.uid}`" class="sr-only">{{ protocolHint }}</p>
              <div class="mp-property">
                <span :id="`mp-type-${r.uid}`" class="mp-label">类型</span>
                <div class="seg mp-types" role="radiogroup" :aria-labelledby="`mp-type-${r.uid}`">
                  <label><input v-model="r.type" type="radio" :name="`mp-type-${r.uid}`" value="string" /><span>文本</span></label>
                  <label><input v-model="r.type" type="radio" :name="`mp-type-${r.uid}`" value="number" /><span>数字</span></label>
                  <label><input v-model="r.type" type="radio" :name="`mp-type-${r.uid}`" value="boolean" /><span>开关</span></label>
                </div>
              </div>
              <div v-if="r.type !== 'boolean'" class="mp-property">
                <label class="mp-label" :for="`mp-options-${r.uid}`">可选值</label>
                <div class="mp-options">
                  <div v-if="optionValues(r.options).length" class="mp-option-list">
                    <span v-for="option in optionValues(r.options)" :key="option" class="type mp-option"><code>{{ option }}</code><button type="button" :aria-label="`移除选项 ${option}`" title="移除选项" @click="removeOption(r, option)"><AppIcon name="i-close" /></button></span>
                  </div>
                  <div class="mp-option-add">
                    <input :id="`mp-options-${r.uid}`" v-model="r.optionDraft" type="text" placeholder="添加选项" maxlength="512" autocomplete="off" @keydown.enter.prevent="addOptions(r)" @blur="addOptions(r)" />
                    <button class="ibtn" type="button" aria-label="添加可选值" title="添加可选值" :disabled="!r.optionDraft.trim()" @click="addOptions(r)"><AppIcon name="i-plus" /></button>
                  </div>
                  <label v-if="r.type === 'string' && r.options.trim()" class="check mp-custom"><input v-model="r.allowCustom" type="checkbox" /><span aria-hidden="true" />允许其他值</label>
                </div>
              </div>
              <div v-if="r.type === 'number'" class="mp-property">
                <span class="mp-label">范围</span>
                <div class="pair">
                  <input :id="`mp-min-${r.uid}`" :value="r.min" type="number" step="any" aria-label="最小值" placeholder="最小值" title="留空不限" @input="r.min = ($event.target as HTMLInputElement).value" />
                  <input :id="`mp-max-${r.uid}`" :value="r.max" type="number" step="any" aria-label="最大值" placeholder="最大值" title="留空不限" @input="r.max = ($event.target as HTMLInputElement).value" />
                </div>
              </div>
              <div v-if="!r.original || !base.fields[r.original]" class="mp-definition-actions">
                <button v-if="!r.original || !base.fields[r.original]" class="btn-link mp-remove" type="button" @click="remove(r)"><AppIcon name="i-trash" />移除参数</button>
              </div>
            </fieldset>
          </div>
          <p v-if="!rows.length" class="hint mp-empty">暂无参数，可手动添加。</p>
        </div>
        <p v-if="error" role="alert" class="modal-error">{{ error }}</p>
      </div>
      <footer class="modal-foot"><div class="modal-actions"><button class="btn-link mp-reset" type="button" title="恢复接口声明或参考预设" :disabled="busy" @click="reset">恢复预设</button><button class="btn btn-quiet" type="button" :disabled="busy" @click="close">取消</button><button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存参数' }}</button></div></footer>
    </form>
  </dialog>
</template>
<style scoped>
.model-parameters-dialog { --modal-w: 480px; --mp-control-h: 32px; }
.modal-head { align-items: start; }
.mp-heading { display: grid; gap: var(--sp-2); min-width: 0; }
.mp-heading h2 { display: flex; align-items: start; gap: var(--sp-2); line-height: 1.4; overflow-wrap: anywhere; }
.mp-heading h2 .vl { width: var(--ico-lg); height: var(--ico-lg); flex: none; margin-top: 3px; }
.mp-head-actions { display: flex; flex: none; align-items: center; gap: var(--sp-1); margin-top: -4px; }
.modal-body { display: grid; gap: var(--sp-4); }
.mp-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.mp-tags .type { max-width: 100%; height: auto; min-height: 18px; white-space: normal; overflow-wrap: anywhere; }
.mp-fields { min-width: 0; }
.mp-columns, .mp-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 144px) 36px; align-items: center; gap: var(--sp-2); }
.mp-columns { padding-block: 0 var(--sp-2); color: var(--fg-3); font-size: var(--fz-2xs); }
.mp-column-title { display: flex; align-items: center; gap: var(--sp-1); }
.mp-field { min-width: 0; border-top: 1px solid var(--line-2); }
.mp-row { min-height: 48px; padding-block: var(--sp-2); }
.mp-name { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; padding-block: var(--sp-1); text-align: left; color: var(--fg-2); }
.mp-name code { min-width: 0; font-size: var(--fz-xs); line-height: 1.5; overflow-wrap: anywhere; }
.mp-name .ico { --ico: var(--ico-xs); color: var(--fg-3); transition: transform var(--t1) var(--e); }
.mp-name:hover { color: var(--fg); }
.mp-name:focus-visible { outline: 2px solid var(--a); outline-offset: 2px; border-radius: var(--r1); }
.mp-field[data-off="true"] .mp-name { color: var(--fg-4); }
.mp-key-editor { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }
.mp-key-editor .ibtn { width: 20px; height: var(--mp-control-h); --ico: var(--ico-xs); }
.mp-key-editor .ico { transform: rotate(90deg); }
.mp-key-editor .mp-key-input { min-width: 0; height: var(--mp-control-h); }
.mp-value { min-width: 0; }
.mp-value :deep(.model-parameter-input) { height: var(--mp-control-h); font: var(--fz-xs)/1.4 var(--mono); }
.mp-value :deep(:disabled) { opacity: 0.45; }
.mp-row .s-toggle { justify-self: end; width: 36px; margin: 0; }
.mp-row .s-toggle .switch { --sw-w: 28px; --sw-h: 16px; }
.mp-definition { min-width: 0; margin: 0; padding: var(--sp-2) 0 var(--sp-4) var(--sp-5); border: 0; }
.mp-property { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: start; gap: var(--sp-3); }
.mp-label { display: flex; align-items: center; min-height: var(--mp-control-h); color: var(--fg-3); font-size: var(--fz-xs); }
.mp-types { height: var(--mp-control-h); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mp-types label { min-width: 0; }
.mp-types span { display: grid; place-items: center; height: 100%; padding: 0 var(--sp-2); }
.mp-options { display: grid; gap: var(--sp-2); min-width: 0; }
.mp-option-list { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.mp-options .mp-option { gap: 2px; height: auto; min-height: var(--sp-5); max-width: 100%; padding: 2px 3px 2px var(--sp-2); font-weight: var(--fw-regular); white-space: normal; }
.mp-option code { min-width: 0; font-size: var(--fz-xs); line-height: 20px; overflow-wrap: anywhere; }
.mp-option button { display: grid; place-items: center; flex: none; width: 20px; height: 20px; color: var(--fg-3); border-radius: 50%; --ico: var(--ico-xs); }
.mp-option button:hover { color: var(--fg); background: var(--hover); }
.mp-option-add { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }
.mp-option-add input { min-width: 0; height: var(--mp-control-h); }
.mp-option-add .ibtn { width: var(--mp-control-h); height: var(--mp-control-h); --ico: var(--ico-sm); }
.mp-options .mp-custom { font-size: var(--fz-xs); }
.mp-property .pair { min-width: 0; }
.mp-property input[type="number"] { min-width: 0; height: var(--mp-control-h); font-size: var(--fz-xs); }
.mp-definition-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-3); }
.mp-add { --ico: var(--ico-sm); }
.mp-remove { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; --ico: var(--ico-sm); }
.mp-remove { margin-left: auto; }
.mp-remove:hover { color: var(--err); }
.mp-empty { margin: 0; padding-block: var(--sp-3); }
.modal-actions { width: 100%; }
.mp-reset { margin-right: auto; min-height: 32px; }
@media (max-width: 640px) {
  .mp-columns, .mp-row { grid-template-columns: minmax(0, 1fr) minmax(96px, 0.85fr) 36px; }
  .mp-row .s-toggle { height: 44px; }
  .mp-definition { padding-left: 0; }
  .mp-key-editor .ibtn { width: 28px; height: 44px; }
  .mp-property { grid-template-columns: 44px minmax(0, 1fr); gap: var(--sp-2); }
  .mp-remove, .mp-reset { min-height: 44px; }
}
</style>
