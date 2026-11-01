<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef } from "vue";
import { parseWorkflow, scanWorkflow, bindingKey, validateComfyWorkflow, comfyParameterKeys, comfyParameterLabels, validComfyParameter, bindingTargets } from "../../domain/comfy-workflow.ts";
import type { ComfyWorkflow, Workflow, Binding } from "../../domain/comfy-workflow.ts";
import { newComfyId } from "../../domain/comfy-workflows.ts";
import type { ComfyAllowedModel } from "../../domain/comfy-workflows.ts";
import AppIcon from "../../shared/AppIcon.vue";
import ComfyLoraBindings from "./ComfyLoraBindings.vue";
import { comfyChoiceKeys, comfyChoiceLabels } from "../../domain/comfy-controls";
import type { LoraBinding } from "../../domain/comfy-controls";
const props = defineProps<{ initial?: ComfyWorkflow & { models?: ComfyAllowedModel[] }; disabled?: boolean; idPrefix?: string }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const fieldId = (name: string) => `${props.idPrefix ?? ""}${name}`;
const modelBinding = ref(props.initial?.bindings.model ? bindingKey(props.initial.bindings.model) : "");
const models = ref<ComfyAllowedModel[]>(structuredClone(props.initial?.models ?? []));
function addModel() {
  const b = scan.value.strings.find(b => bindingKey(b) === modelBinding.value);
  models.value.push({ id: newComfyId(), name: "", file: !models.value.length && b ? String(workflow.value[b.nodeId].inputs[b.field]) : "" });
}
function chooseModelBinding() { if (modelBinding.value && !models.value.length) addModel(); }
const inputMode = ref<"upload" | "paste">("upload"), fileName = ref(""), reading = ref(false);
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");
const locked = computed(() => props.disabled || reading.value);
let readVersion = 0;
const text = ref(props.initial ? JSON.stringify(props.initial.workflow, null, 2) : "");
const workflow = shallowRef<Workflow>(props.initial?.workflow ?? {});
const scan = computed(() => scanWorkflow(workflow.value));
const prompt = ref(props.initial?.bindings.prompt.map(bindingKey) ?? []);
const negative = ref(props.initial?.bindings.negative ? bindingKey(props.initial.bindings.negative) : "");
const seed = ref(props.initial?.bindings.seed.map(bindingKey) ?? []);
const output = ref(props.initial?.bindings.output ?? "");
const choices = ref(Object.fromEntries(comfyChoiceKeys.map(k=>[k,props.initial?.bindings.controls?.[k] ? bindingKey(props.initial.bindings.controls[k]!) : ""])));
const loras = ref<(Omit<LoraBinding,"zeroDisables"> & {zeroDisables:boolean})[]>(structuredClone(props.initial?.bindings.controls?.loras ?? []));
const parameters = ref(Object.fromEntries(comfyParameterKeys.map(k => [k, bindingTargets(props.initial?.bindings.parameters?.[k]).map(bindingKey)])));
const parameterCandidates = (key: typeof comfyParameterKeys[number]) => scan.value.numbers.filter(b => validComfyParameter(key, workflow.value[b.nodeId].inputs[b.field]));
const error = ref("");
async function upload(event: Event) {
  const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file || locked.value) return;
  const version = ++readVersion;
  reading.value = true; emit("busy", true);
  try {
    const value = await file.text();
    if (version !== readVersion) return;
    text.value = value.replace(/^\uFEFF/, "");
    fileName.value = file.name;
    scanText();
  } catch {
    if (version === readVersion) error.value = "无法读取工作流文件，请重新选择或粘贴 JSON";
  } finally {
    if (version === readVersion) { reading.value = false; emit("busy", false); }
  }
}
onBeforeUnmount(() => { readVersion++; emit("busy", false); });
function scanText() {
  error.value = "";
  try {
    const next = parseWorkflow(text.value), candidates = scanWorkflow(next), previous = workflow.value;
    const retain = (key: string, list: Binding[]) => list.some(b => bindingKey(b) === key && previous[b.nodeId]?.class_type === next[b.nodeId].class_type);
    const first = !Object.keys(previous).length;
    prompt.value = prompt.value.filter(key => retain(key, candidates.strings));
    negative.value = retain(negative.value, candidates.strings) ? negative.value : "";
    if (!retain(modelBinding.value, candidates.strings)) modelBinding.value = "";
    for (const key of comfyChoiceKeys) if (!retain(choices.value[key],candidates.strings)) choices.value[key]="";
    loras.value=loras.value.filter(b=>previous[b.nodeId]?.class_type===next[b.nodeId]?.class_type && typeof next[b.nodeId]?.inputs[b.nameField]==="string" && typeof next[b.nodeId]?.inputs[b.modelField]==="number" && (!b.clipField || typeof next[b.nodeId]?.inputs[b.clipField]==="number"));
    seed.value = first ? candidates.integers.filter(b => ["seed", "noise_seed"].includes(b.field)).map(bindingKey) : seed.value.filter(key => retain(key, candidates.integers));
    for (const key of comfyParameterKeys) parameters.value[key] = parameters.value[key].filter(value => retain(value, candidates.numbers.filter(b => validComfyParameter(key, next[b.nodeId].inputs[b.field]))));
    const saved = candidates.outputs.filter(b => next[b.nodeId].class_type === "SaveImage");
    output.value = candidates.outputs.some(b => b.nodeId === output.value && previous[b.nodeId]?.class_type === next[b.nodeId].class_type) ? output.value
      : saved.length === 1 ? saved[0].nodeId : candidates.outputs.length === 1 ? candidates.outputs[0].nodeId : "";
    workflow.value = next;
  } catch (e) { error.value = e instanceof Error ? e.message : "工作流 JSON 无效"; }
}
function configuration(): ComfyWorkflow & { models?: ComfyAllowedModel[] } {
  if (reading.value) throw new Error("工作流文件读取中，请稍候");
  if (error.value) throw new Error(error.value);
  const bindings = (keys: string[], candidates: Binding[]) => keys.map(key => {
    const b = candidates.find(b => bindingKey(b) === key);
    if (!b) throw new Error("工作流绑定已失效，请重新选择");
    return { nodeId: b.nodeId, field: b.field };
  });
  const config = validateComfyWorkflow({ workflow: parseWorkflow(text.value), bindings: {
    prompt: bindings(prompt.value, scan.value.strings), seed: bindings(seed.value, scan.value.integers), output: output.value,
    ...(negative.value ? { negative: bindings([negative.value], scan.value.strings)[0] } : {}),
    parameters: Object.fromEntries(comfyParameterKeys.filter(k => parameters.value[k].length).map(k => [k, bindings(parameters.value[k], parameterCandidates(k))])),
    ...(modelBinding.value ? { model: bindings([modelBinding.value], scan.value.strings)[0] } : {}),
    controls: {...Object.fromEntries(comfyChoiceKeys.filter(k=>choices.value[k]).map(k=>[k,bindings([choices.value[k]],scan.value.strings)[0]])),loras:loras.value},
  } });
  return { ...config, ...(modelBinding.value ? { models: structuredClone(models.value.map(m => ({ ...m }))) } : {}) };
}
defineExpose({ configuration });
</script>
<template>
  <div class="comfy-fields" :aria-busy="reading">
    <div class="seg" role="group" aria-label="工作流导入方式">
      <label><input v-model="inputMode" type="radio" value="upload" :disabled="locked" /><span>上传文件</span></label>
      <label><input v-model="inputMode" type="radio" value="paste" :disabled="locked" /><span>粘贴 JSON</span></label>
    </div>
    <div v-show="inputMode === 'upload'" class="comfy-upload">
      <input :id="fieldId('comfyWorkflowFile')" ref="fileInput" type="file" accept=".json,application/json" hidden :disabled="locked" @change="upload" />
      <button class="btn btn-quiet" type="button" :disabled="locked" @click="fileInput?.click()">
        <AppIcon :name="reading ? 'i-retry' : 'i-upload'" :class="{ 'comfy-reading': reading }" />{{ reading ? "读取中…" : "选择 JSON 文件" }}
      </button>
      <p class="hint">选择 ComfyUI 导出的 API 格式 .json 文件。</p>
    </div>
    <div v-show="inputMode === 'paste'" class="fld">
      <label :for="fieldId('comfyWorkflow')">工作流 API JSON</label>
      <textarea :id="fieldId('comfyWorkflow')" v-model="text" :disabled="locked" rows="6" spellcheck="false" placeholder="粘贴 ComfyUI Export (API Format) 导出的 JSON" @input="fileName = ''; scanText()" />
    </div>
    <p class="comfy-summary" role="status">{{ reading ? "正在读取工作流…" : error ? "工作流未就绪" : Object.keys(workflow).length ? `${fileName || '已配置工作流'} · ${Object.keys(workflow).length} 个节点` : "尚未导入工作流" }}</p>
    <p v-if="error" class="modal-error" role="alert">{{ error }}</p>
    <template v-if="Object.keys(workflow).length">
    <div class="fld">
      <label :for="fieldId('comfyPrompt')">正向 Prompt · 可多选</label>
      <select :id="fieldId('comfyPrompt')" v-model="prompt" multiple :disabled="locked">
        <option v-for="b in scan.strings" :key="bindingKey(b)" :value="bindingKey(b)">{{ b.label }}</option>
      </select>
    </div>
    <div class="fld">
      <label :for="fieldId('comfyNegative')">Negative · 可选</label>
      <select :id="fieldId('comfyNegative')" v-model="negative" :disabled="locked">
        <option value="">不绑定 · 由工作流固定</option>
        <option v-for="b in scan.strings" :key="bindingKey(b)" :value="bindingKey(b)">{{ b.label }}</option>
      </select>
    </div>
    <div class="fld">
      <label :for="fieldId('comfySeed')">Seed · 可多选</label>
      <select :id="fieldId('comfySeed')" v-model="seed" multiple :disabled="locked">
        <option v-for="b in scan.integers" :key="bindingKey(b)" :value="bindingKey(b)">{{ b.label }}</option>
      </select>
      <p class="hint">多选可按住 ⌘／Ctrl；已预选 seed／noise_seed，请确认。</p>
    </div>
    <div class="fld">
      <label :for="fieldId('comfyOutput')">图片输出节点</label>
      <select :id="fieldId('comfyOutput')" v-model="output" :disabled="locked">
        <option value="">请选择输出节点</option>
        <option v-for="b in scan.outputs" :key="b.nodeId" :value="b.nodeId">{{ b.label }}</option>
      </select>
    </div>
    <details class="comfy-main-models" :open="!!modelBinding">
      <summary>允许使用的主模型</summary>
      <div class="fld">
        <label :for="fieldId('comfyModelBinding')">主模型文件名输入</label>
        <select :id="fieldId('comfyModelBinding')" v-model="modelBinding" :disabled="locked" @change="chooseModelBinding">
          <option value="">不绑定 · 使用工作流原模型</option>
          <option v-for="b in scan.strings" :key="bindingKey(b)" :value="bindingKey(b)">{{ b.label }}</option>
        </select>
      </div>
      <p class="hint">选择 checkpoint／UNET 的文件名输入；只添加已确认能共用此管线的模型。文本编码器、VAE 与连线保持原样。</p>
      <template v-if="modelBinding">
        <div v-for="(m, index) in models" :key="m.id" class="comfy-model-entry">
          <div class="fld"><label :for="fieldId(`model-file-${m.id}`)">模型 {{ index + 1 }} · 文件名</label><input :id="fieldId(`model-file-${m.id}`)" v-model="m.file" :disabled="locked" placeholder="含子目录的完整模型文件名" /></div>
          <div class="fld"><label :for="fieldId(`model-name-${m.id}`)">显示名 · 可选</label><input :id="fieldId(`model-name-${m.id}`)" v-model="m.name" :disabled="locked" maxlength="128" placeholder="默认使用模型文件名" /></div>
          <button class="btn btn-quiet" type="button" :disabled="locked" :aria-label="`移除模型 ${index + 1}`" @click="models.splice(index, 1)">移除</button>
        </div>
        <button class="btn btn-quiet" type="button" :disabled="locked" @click="addModel">添加允许的模型</button>
      </template>
      <p class="hint">名单表示允许切换，不代表服务已安装模型或兼容性已验收。缺失文件沿用 ComfyUI 校验报错。</p>
    </details>
    <details class="comfy-basic">
      <summary>基础参数 · 可选绑定</summary>
      <p class="hint">可多选需要同步的输入（⌘／Ctrl），默认值须一致。例如 FLUX 的潜空间与调度器宽高。未选中时保持工作流原值。</p>
      <div v-for="key in comfyParameterKeys" :key="key" class="fld">
        <label :for="fieldId(`comfyBinding-${key}`)">{{ comfyParameterLabels[key] }}</label>
        <select :id="fieldId(`comfyBinding-${key}`)" v-model="parameters[key]" multiple :disabled="locked">
          <option v-for="b in parameterCandidates(key)" :key="bindingKey(b)" :value="bindingKey(b)">{{ b.label }}</option>
        </select>
      </div>
      <p class="hint">CFG 可填小数，与 Flux 等模型的 Guidance 不互换。具体范围与尺寸倍数由节点决定。</p>
      <div v-for="key in comfyChoiceKeys" :key="key" class="fld">
        <label :for="fieldId(`comfyBinding-${key}`)">{{ comfyChoiceLabels[key] }}</label>
        <select :id="fieldId(`comfyBinding-${key}`)" v-model="choices[key]" :disabled="locked">
          <option value="">不绑定 · 由工作流固定</option>
          <option v-for="b in scan.strings" :key="bindingKey(b)" :value="bindingKey(b)">{{ b.label }}</option>
        </select>
      </div>
      <p class="hint">绑定名称输入，选项在 IMAGE 中从该节点读取。专用采样／调度节点若没有名称输入，继续由工作流固定。</p>
    </details>
    <ComfyLoraBindings :id-prefix="idPrefix" v-model="loras" :workflow="workflow" :disabled="locked" />
    <p class="hint">未绑定的参数和所有连线保持工作流原样。更新后请核对绑定。</p>
    </template>
  </div>
</template>
<style scoped>
.comfy-fields { display: grid; gap: var(--sp-3); }
.comfy-basic > :not(summary), .comfy-main-models > :not(summary) { margin-top: var(--sp-3); }
.comfy-model-entry { display: grid; gap: var(--sp-2); padding: var(--sp-3); border: 1px solid var(--line); border-radius: var(--r3); }
.comfy-model-entry > button { justify-self: end; }
.comfy-basic summary, .comfy-main-models summary { cursor: pointer; }
.comfy-fields .seg { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: column; }
.comfy-upload { display: grid; justify-items: start; gap: var(--sp-2); }
.comfy-summary { color: var(--fg-2); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.comfy-reading { animation: comfy-file-spin 1s linear infinite; }
@keyframes comfy-file-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .comfy-reading { animation: none; }
}
.comfy-fields textarea { resize: vertical; font-family: var(--mono); }
.comfy-fields select[multiple] { min-height: 90px; padding: 6px; background-image: none; }
.comfy-fields select[multiple] option:checked { background: var(--a); color: var(--a-ink); }
</style>
