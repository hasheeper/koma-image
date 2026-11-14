<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { useServices } from "../../app/services.ts";
import { message } from "../../app/ui.ts";
import type { Routing } from "../../config/connections.ts";
import { profileFor } from "../../gateway/profile.ts";
import { names } from "../../storage/names.ts";
import { modelParameters, readAskSettings, withParameters } from "../../ask/settings.ts";
import type { AskParameters } from "../../ask/parameters.ts";
import { ASK_CUSTOM_PARAMETER_LIMIT, parameterPathConflict, validAskParameterKey } from "../../ask/parameters.ts";
import AppIcon from "../../shared/AppIcon.vue";
import ModelParameterDialogContent from "../../shared/ModelParameterDialogContent.vue";
import ModelParameterKey from "../../shared/ModelParameterKey.vue";
import ModelParameterType from "../../shared/ModelParameterType.vue";
import ModelParameterInput from "../../shared/ModelParameterInput.vue";
import { familyOf } from "../../ask/model-family.ts";
import { acceptsParameter, validateParameterOverrides } from "../../domain/model-parameters.ts";
import type { ParameterField, ParameterOverrides } from "../../domain/model-parameters.ts";

const props = defineProps<{
  target: { connectionId: string; model: string } | null;
  routing: Routing;
}>();
const emit = defineEmits<{ close: [] }>();
const { preferences } = useServices();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const connection = computed(() => props.routing.connections[props.target?.connectionId ?? ""]);
const protocol = computed(() => connection.value ? profileFor(connection.value.profileId).protocol : undefined);
type ParameterKey = "maxOutputTokens" | "temperature" | "topP";
const emptyValues = () => ({ maxOutputTokens: "", temperature: "", topP: "" });
const emptyEnabled = () => ({ maxOutputTokens: false, temperature: false, topP: false });
const values = ref(emptyValues()), enabled = ref(emptyEnabled());
const outputField = ref<NonNullable<AskParameters["outputTokenField"]>>("max_completion_tokens");
const busy = ref(false), error = ref("");
const anthropic = computed(() => protocol.value === "anthropic-messages");
const gemini = computed(() => protocol.value === "gemini-native");
type CustomRow = { uid: number; key: string; on: boolean; field: ParameterField };
const custom = ref<CustomRow[]>([]), expanded = ref<number | null>(null);
let nextId = 0;
const invalidKey = (row: CustomRow) => !validAskParameterKey(row.key.trim()) ||
  parameterPathConflict(row.key.trim(), custom.value.filter(r => r !== row).map(r => r.key.trim()));
const invalid = computed(() => custom.value.some(invalidKey));

const fields = computed((): { key: ParameterKey; name: string; field: ParameterField }[] => [
  { key: "maxOutputTokens", name: gemini.value ? "maxOutputTokens" : anthropic.value ? "max_tokens" : outputField.value,
    field: { type: "number", options: [], default: "", min: 1 } },
  { key: "temperature", name: "temperature", field: { type: "number", options: [], default: "", min: 0, max: anthropic.value ? 1 : 2 } },
  { key: "topP", name: gemini.value ? "topP" : "top_p", field: { type: "number", options: [], default: "", min: 0, max: 1 } },
]);
function clear() {
  values.value = emptyValues(); enabled.value = emptyEnabled(); error.value = "";
  outputField.value = "max_completion_tokens";
  custom.value = []; expanded.value = null;
}
async function add() {
  if (busy.value || custom.value.length >= ASK_CUSTOM_PARAMETER_LIMIT) return;
  const uid = ++nextId;
  custom.value.push({ uid, key: "", on: false, field: { type: "string", options: [], default: "" } });
  expanded.value = uid;
  await nextTick();
  dialog.value?.querySelector<HTMLInputElement>(`#ask-custom-key-${uid}`)?.focus();
}
function changeType(row: CustomRow, type: NonNullable<ParameterField["type"]>) {
  row.field = { ...row.field, type };
  if (row.field.default && !acceptsParameter(row.field, row.field.default)) row.field.default = "";
}
function close() { if (!busy.value) emit("close"); }
watch(() => props.target, async target => {
  if (!target) { dialog.value?.close(); return; }
  const settings = readAskSettings(preferences.get(names.ask, null));
  const value = modelParameters(settings, target.connectionId, target.model);
  clear();
  for (const { key } of fields.value) {
    values.value[key] = value[key]?.toString() ?? "";
    enabled.value[key] = value[key] !== undefined;
  }
  outputField.value = value.outputTokenField ?? "max_completion_tokens";
  custom.value = Object.entries(value.custom ?? {}).map(([key, field]) => ({ uid: ++nextId, key, on: field !== null,
    field: field ?? { type: "string", options: [], default: "" } }));
  await nextTick();
  if (props.target === target && !dialog.value?.open) dialog.value?.showModal();
});
watch(connection, value => { if (props.target && !value) emit("close"); });
async function save() {
  const target = props.target;
  if (!target || !connection.value || busy.value || invalid.value) return;
  const value: AskParameters = {};
  for (const { key } of fields.value) {
    const text = values.value[key];
    if (!enabled.value[key] || !text.trim()) continue;
    const n = Number(text);
    if (!Number.isFinite(n) || (key === "maxOutputTokens" ? !Number.isSafeInteger(n) || n <= 0 : n < 0 || n > (key === "temperature" ? anthropic.value ? 1 : 2 : 1))) {
      error.value = "请输入有效的参数值"; return;
    }
    value[key] = n;
  }
  if (!anthropic.value && !gemini.value && value.maxOutputTokens !== undefined && outputField.value === "max_tokens")
    value.outputTokenField = "max_tokens";
  const overrides: ParameterOverrides = Object.fromEntries(custom.value.map(row => [row.key.trim(), row.on ? row.field : null]));
  try {
    if (Object.keys(overrides).length) value.custom = validateParameterOverrides(overrides);
  } catch (e) { error.value = message(e); return; }
  busy.value = true; error.value = "";
  try {
    // Merge into the latest preferences so another model's edits are preserved.
    const latest = readAskSettings(preferences.get(names.ask, null));
    await preferences.set(names.ask, withParameters(latest, target.connectionId, target.model, value));
    emit("close");
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog ref="dialog" id="askParametersDialog" class="modal set-ui model-parameters-dialog ask-parameters-dialog" aria-label="模型参数" @cancel.prevent="close">
    <form class="modal-form" @submit.prevent="save">
      <ModelParameterDialogContent :title="target?.model ?? ''" :supplier="connection?.name ?? ''" :family="familyOf(target?.model ?? '')" :busy="busy" :invalid="invalid" :add-disabled="custom.length >= ASK_CUSTOM_PARAMETER_LIMIT" :error="error" @close="close" @reset="clear" @add="add">
        <template #source><span class="type">参考预设</span></template>
          <div v-for="r in fields" :key="r.key" class="mp-field" role="group" :aria-label="r.name" :data-off="!enabled[r.key]">
            <div class="mp-row">
              <div class="mp-name">
                <select v-if="r.key === 'maxOutputTokens' && !anthropic && !gemini" v-model="outputField" class="ask-output-field" aria-label="输出字段" :disabled="busy"><option value="max_completion_tokens">max_completion_tokens</option><option value="max_tokens">max_tokens</option></select>
                <label v-else :for="`ask-parameter-${r.key}`"><code>{{ r.name }}</code></label>
              </div>
              <div class="mp-value">
                <label v-if="r.key === 'maxOutputTokens' && !anthropic && !gemini" class="sr-only" :for="`ask-parameter-${r.key}`">{{ r.name }}</label>
                <ModelParameterInput :id="`ask-parameter-${r.key}`" :field="r.field" :value="values[r.key]" :disabled="busy || !enabled[r.key]" @change="values[r.key] = $event" />
              </div>
              <label class="s-toggle" :title="enabled[r.key] ? '停用参数' : '启用参数'"><input v-model="enabled[r.key]" type="checkbox" role="switch" :aria-label="`启用 ${r.name}`" :disabled="busy" /><span class="switch" aria-hidden="true" /></label>
            </div>
          </div>
          <div v-for="r in custom" :key="r.uid" class="mp-field" role="group" :aria-label="r.key || '新参数'" :data-off="!r.on">
            <div class="mp-row">
              <ModelParameterKey :id="`ask-custom-key-${r.uid}`" v-model="r.key" :expanded="expanded === r.uid" :disabled="busy" :invalid="invalidKey(r)" :controls="`ask-custom-definition-${r.uid}`" @toggle="expanded = expanded === r.uid ? null : r.uid" />
              <div class="mp-value"><label class="sr-only" :for="`ask-custom-value-${r.uid}`">默认值</label><ModelParameterInput :id="`ask-custom-value-${r.uid}`" :key="r.field.type" :field="r.field" :value="r.field.default" :disabled="busy || !r.on" @change="r.field.default = $event" /></div>
              <label class="s-toggle" :title="r.on ? '停用参数' : '启用参数'"><input v-model="r.on" type="checkbox" role="switch" :aria-label="`启用 ${r.key || '新参数'}`" :disabled="busy" /><span class="switch" aria-hidden="true" /></label>
            </div>
            <fieldset v-if="expanded === r.uid" :id="`ask-custom-definition-${r.uid}`" class="mp-definition fld-group" :disabled="busy">
              <legend class="sr-only">{{ r.key || '新参数' }} 字段定义</legend>
              <ModelParameterType :id="`ask-custom-type-${r.uid}`" :model-value="r.field.type ?? 'string'" :disabled="busy" @update:model-value="changeType(r, $event)" />
              <div class="mp-definition-actions"><button class="btn-link mp-remove" type="button" @click="custom = custom.filter(row => row.uid !== r.uid)"><AppIcon name="i-trash" />移除参数</button></div>
            </fieldset>
          </div>
      </ModelParameterDialogContent>
    </form>
  </dialog>
</template>
<style scoped>
.ask-parameters-dialog { --modal-w: 480px; --mp-control-h: 32px; }
:deep(.mp-fields) { min-width: 0; }
:deep(.mp-columns), :deep(.mp-row) { display: grid; grid-template-columns: var(--mp-columns); align-items: center; gap: var(--sp-2); }
:deep(.mp-columns) { padding-block: 0 var(--sp-2); border-bottom: 1px solid var(--line-2); color: var(--fg-3); font-size: var(--fz-2xs); }
:deep(.mp-field) { min-width: 0; }
:deep(.mp-row) { min-height: 48px; padding-block: var(--sp-2); }
:deep(.mp-name) { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; padding-block: var(--sp-1); text-align: left; color: var(--fg-2); }
:deep(.mp-name code) { min-width: 0; font-size: var(--fz-xs); line-height: 1.5; overflow-wrap: anywhere; }
:deep(.mp-field[data-off="true"] .mp-name) { color: var(--fg-4); }
:deep(.mp-value) { min-width: 0; }
:deep(.mp-row .s-toggle) { justify-self: end; width: 36px; margin: 0; }
:deep(.mp-row .s-toggle .switch) { --sw-w: 28px; --sw-h: 16px; }
:deep(.modal-actions) { width: 100%; }
:deep(.mp-reset) { margin-right: auto; min-height: 32px; }
:deep(.mp-value .model-parameter-input) { height: var(--mp-control-h); }
:deep(.mp-value :disabled) { opacity: 0.45; }
:deep(.mp-definition) { min-width: 0; margin: 0; padding: var(--sp-2) 0 var(--sp-4) var(--sp-5); border: 0; }
:deep(.mp-property) { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: start; gap: var(--sp-3); }
:deep(.mp-label) { display: flex; align-items: center; min-height: var(--mp-control-h); color: var(--fg-3); font-size: var(--fz-xs); }
:deep(.mp-types) { height: var(--mp-control-h); grid-template-columns: repeat(3, minmax(0, 1fr)); }
:deep(.mp-types label) { min-width: 0; }
:deep(.mp-types span) { display: grid; place-items: center; height: 100%; padding: 0 var(--sp-2); }
:deep(.mp-definition-actions) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-3); }
:deep(.mp-remove) { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; --ico: var(--ico-sm); }
:deep(.mp-remove) { margin-left: auto; }
:deep(.mp-remove:hover) { color: var(--err); }
@media (max-width: 640px) {
  :deep(.mp-row .s-toggle), :deep(.mp-reset) { min-height: 44px; }
  :deep(.mp-remove) { min-height: 44px; }
  :deep(.mp-definition) { padding-left: 0; }
  :deep(.mp-property) { grid-template-columns: 44px minmax(0, 1fr); gap: var(--sp-2); }
}
.mp-name label { min-width: 0; }
.ask-output-field { width: 100%; min-width: 0; height: var(--mp-control-h); padding-left: 0; border-color: transparent; background-color: transparent; font: var(--fz-xs)/1.5 var(--mono); }
</style>
