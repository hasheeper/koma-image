import type { Json } from "./value.ts";
import { validateControlBindings, comfyControlSpec, injectComfyControls } from "./comfy-controls.ts";
import type { ControlBindings } from "./comfy-controls.ts";

export const COMFY_PROFILE_ID = "comfyui-workflow";
export type Workflow = Record<string, { class_type: string; inputs: Record<string, Json>; _meta?: { title?: string } }>;
export type Binding = { nodeId: string; field: string };
export const comfyParameterKeys = ["width", "height", "steps", "cfg"] as const;
export type ComfyParameter = typeof comfyParameterKeys[number];
export type ComfyValues = Partial<Record<ComfyParameter, number>>;
export type ComfyParameterSpec = { defaults: ComfyValues; signature: string };
export const comfyParameterLabels = { width: "宽度", height: "高度", steps: "步数", cfg: "CFG" };
export const comfyFormKey = (key: ComfyParameter) => key === "cfg" ? "scale" : key;
export const comfyParameterKey = (key: string): ComfyParameter | undefined => key === "scale" ? "cfg" : comfyParameterKeys.find(k => k !== "cfg" && k === key);
export function validComfyParameter(key: ComfyParameter, value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && (key === "cfg" || Number.isSafeInteger(value) && value > 0);
}
export type BindingTargets = Binding | Binding[];
export const bindingTargets = (value?: BindingTargets): Binding[] => value ? Array.isArray(value) ? value : [value] : [];
export type WorkflowBindings = { prompt: Binding[]; negative?: Binding; seed: Binding[]; output: string; model?: Binding; parameters?: Partial<Record<ComfyParameter, BindingTargets>>; controls?: ControlBindings };
export type ComfyWorkflow = { workflow: Workflow; bindings: WorkflowBindings };
export type ComfyRecipe = ComfyWorkflow & { connectionId: string; name: string; revision: string; workflowId?: string; modelId?: string; modelName?: string; modelFile?: string };
export const comfyModelId = (connectionId: string, workflowId?: string, modelId?: string) => `comfyui:${connectionId}${workflowId && workflowId !== "default" || modelId ? `:${workflowId ?? "default"}${modelId ? `:${modelId}` : ""}` : ""}`;
export const comfyRecipeModelId = (recipe: ComfyRecipe) => comfyModelId(recipe.connectionId, recipe.workflowId, recipe.modelId);
export const isComfyModel = (model?: { id: string; profileId?: string } | null) => model?.profileId ? model.profileId === COMFY_PROFILE_ID : model?.id.startsWith("comfyui:") === true;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safeKey = (key: string) => !!key && !["__proto__", "prototype", "constructor"].includes(key);
function json(value: unknown): value is Json {
  return value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
    || Array.isArray(value) && value.every(json) || record(value) && Object.entries(value).every(([key, v]) => safeKey(key) && json(v));
}
export function parseWorkflow(value: unknown): Workflow {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("工作流 JSON 格式无效"); }
  }
  if (record(value) && Array.isArray(value.nodes)) throw new Error("请导出 API 格式 JSON");
  if (!record(value) || !Object.keys(value).length) throw new Error("工作流必须是非空 API 节点对象");
  const out: Workflow = {};
  for (const [id, node] of Object.entries(value)) {
    if (!safeKey(id) || !record(node) || typeof node.class_type !== "string" || !node.class_type.trim() || !record(node.inputs) || !json(node))
      throw new Error(`工作流节点 ${id} 结构无效`);
    out[id] = structuredClone(node) as Workflow[string];
  }
  return out;
}
export const bindingKey = (b: Binding) => JSON.stringify([b.nodeId, b.field]);
export function scanWorkflow(workflow: Workflow) {
  const strings: (Binding & { label: string })[] = [], integers: typeof strings = [], numbers: typeof strings = [], outputs: { nodeId: string; label: string }[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    const label = `#${nodeId} ${node.class_type}${typeof node._meta?.title === "string" && node._meta.title ? ` · ${node._meta.title}` : ""}`;
    if (["SaveImage", "PreviewImage"].includes(node.class_type)) outputs.push({ nodeId, label });
    for (const [field, value] of Object.entries(node.inputs)) {
      const target = typeof value === "string" ? strings : Number.isSafeInteger(value) ? integers : null;
      target?.push({ nodeId, field, label: `${label} · inputs.${field}` });
      if (typeof value === "number" && Number.isFinite(value)) numbers.push({ nodeId, field, label: `${label} · inputs.${field} = ${value}` });
    }
  }
  return { strings, integers, numbers, outputs };
}
export function validateComfyWorkflow(value: unknown): ComfyWorkflow {
  if (!record(value) || !record(value.bindings)) throw new Error("请配置工作流和字段绑定");
  const workflow = parseWorkflow(value.workflow), raw = value.bindings;
  const seen = new Set<string>();
  function binding(value: unknown, kind: "string" | "integer" | "number"): Binding {
    if (!record(value) || typeof value.nodeId !== "string" || typeof value.field !== "string" || !safeKey(value.nodeId) || !safeKey(value.field)) throw new Error("字段绑定无效");
    const node = workflow[value.nodeId], field = node?.inputs[value.field];
    if (!node || !Object.hasOwn(node.inputs, value.field) || (kind === "string" ? typeof field !== "string" : kind === "integer" ? !Number.isSafeInteger(field) : typeof field !== "number" || !Number.isFinite(field))) throw new Error(`绑定 ${value.nodeId}.inputs.${value.field} 已失效，请重新选择`);
    const result = { nodeId: value.nodeId, field: value.field }, key = bindingKey(result);
    if (seen.has(key)) throw new Error("字段绑定重复或正负向绑定冲突");
    seen.add(key);
    return result;
  }
  if (!Array.isArray(raw.prompt) || !raw.prompt.length || !Array.isArray(raw.seed) || !raw.seed.length) throw new Error("Prompt 和 Seed 至少各绑定一个字段");
  const prompt = raw.prompt.map(b => binding(b, "string")), negative = raw.negative === undefined ? undefined : binding(raw.negative, "string"), seed = raw.seed.map(b => binding(b, "integer"));
  const parameters: WorkflowBindings["parameters"] = {};
  if (raw.parameters !== undefined) {
    if (!record(raw.parameters) || Object.keys(raw.parameters).some(k => !comfyParameterKeys.includes(k as ComfyParameter))) throw new Error("基础参数绑定无效");
    for (const key of comfyParameterKeys) if (raw.parameters[key] !== undefined) {
      const targets = Array.isArray(raw.parameters[key]) ? raw.parameters[key] as unknown[] : [raw.parameters[key]];
      if (!targets.length) throw new Error(`${comfyParameterLabels[key]}绑定不能为空`);
      const bs = targets.map(v => binding(v, key === "cfg" ? "number" : "integer"));
      const defaults = bs.map(b => workflow[b.nodeId].inputs[b.field]);
      if (!defaults.every(v => validComfyParameter(key, v))) throw new Error(`${comfyParameterLabels[key]}默认值无效`);
      if (defaults.some(v => v !== defaults[0])) throw new Error(`${comfyParameterLabels[key]}的同步绑定默认值须一致`);
      parameters[key] = bs.length === 1 ? bs[0] : bs;
    }
  }
  if (typeof raw.output !== "string" || !safeKey(raw.output) || !["SaveImage", "PreviewImage"].includes(workflow[raw.output]?.class_type ?? "")) throw new Error("请选择 SaveImage 或 PreviewImage 输出节点");
  const controls = validateControlBindings(raw.controls,workflow,binding);
  const model = raw.model === undefined ? undefined : binding(raw.model, "string");
  return { workflow, bindings: { prompt, ...(negative ? { negative } : {}), seed, output: raw.output, ...(Object.keys(parameters).length ? { parameters } : {}), ...(controls ? {controls} : {}), ...(model ? { model } : {}) } };
}
export function comfyParameterSpec(config: ComfyWorkflow): ComfyParameterSpec {
  const defaults: ComfyValues = {}, signature: unknown[] = [];
  for (const key of comfyParameterKeys) {
    const targets = bindingTargets(config.bindings.parameters?.[key]), b = targets[0];
    if (!b) continue;
    defaults[key] = config.workflow[b.nodeId].inputs[b.field] as number;
    for (const target of targets) signature.push([key, target.nodeId, config.workflow[target.nodeId].class_type, target.field, defaults[key]]);
  }
  return { defaults, signature: JSON.stringify(signature) };
}
export function readComfyValues(value: unknown): ComfyValues {
  if (!record(value)) return {};
  return Object.fromEntries(comfyParameterKeys.filter(k => validComfyParameter(k, value[k])).map(k => [k, value[k]]));
}
export function injectWorkflow(config: ComfyWorkflow, prompt: string, negative: string, seed: number, values: unknown = {}, controls: unknown = {}): Workflow {
  const { workflow, bindings } = validateComfyWorkflow(config);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) throw new Error("Seed 必须为 uint32 整数");
  for (const b of bindings.prompt) workflow[b.nodeId].inputs[b.field] = prompt;
  if (bindings.negative) workflow[bindings.negative.nodeId].inputs[bindings.negative.field] = negative;
  for (const b of bindings.seed) workflow[b.nodeId].inputs[b.field] = seed;
  if (!record(values)) throw new Error("工作流基础参数无效");
  for (const [key, value] of Object.entries(values)) {
    const parameter = comfyParameterKeys.find(k => k === key), b = parameter && bindings.parameters?.[parameter];
    if (!parameter || !b) throw new Error(`${key} 由工作流固定`);
    if (!validComfyParameter(parameter, value)) throw new Error(`${comfyParameterLabels[parameter]}须为${parameter === "cfg" ? "有限数值" : "正整数"}`);
    for (const target of bindingTargets(b)) workflow[target.nodeId].inputs[target.field] = value;
  }
  injectComfyControls(workflow,comfyControlSpec({workflow,bindings}),controls);
  return workflow;
}
export function readComfyRecipe(value: unknown): ComfyRecipe | undefined {
  if (!record(value) || ![value.connectionId, value.name, value.revision].every(v => typeof v === "string" && v.length)) return;
  try { return { ...validateComfyWorkflow(value), connectionId: value.connectionId as string, name: value.name as string, revision: value.revision as string,
    ...Object.fromEntries(["workflowId", "modelId", "modelName", "modelFile"].filter(k => typeof value[k] === "string" && value[k]).map(k => [k, value[k]])),
  }; } catch { return; }
}
/** Config snapshots are local metadata; ASK receives only these writable capabilities. */
export function comfyWritable(model?: { id: string; profileId?: string; comfyNegative?: boolean; comfyParameters?: ComfyParameterSpec } | null) {
  return isComfyModel(model) ? ["model", "prompt", "seed", "batchCount", ...(model?.comfyNegative ? ["negative"] : []), ...comfyParameterKeys.filter(k => model?.comfyParameters?.defaults[k] !== undefined).map(comfyFormKey)] : null;
}
