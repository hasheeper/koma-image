import type { Binding, Workflow } from "./comfy-workflow.ts";

export const comfyChoiceKeys = ["sampler", "scheduler"] as const;
export type ComfyChoiceKey = typeof comfyChoiceKeys[number];
export const comfyChoiceLabels = { sampler: "采样器", scheduler: "调度器" };
export type LoraBinding = { nodeId: string; nameField: string; modelField: string; clipField?: string; zeroDisables: true };
export type ControlBindings = { sampler?: Binding; scheduler?: Binding; loras?: LoraBinding[] };
export type LoraValue = { id: string; name: string; enabled: boolean; strengthModel: number; strengthClip?: number };
export type ComfyControls = { sampler?: string; scheduler?: string; loras?: LoraValue[] };
export type ControlField = Binding & { classType: string };
export type ComfyControlSpec = {
  signature: string; defaults: ComfyControls;
  fields: Partial<Record<ComfyChoiceKey, ControlField>>;
  loras: { id: string; title: string; name: ControlField; model: ControlField; clip?: ControlField }[];
};
export type ComfyControlMemory = Record<string, { signature: string; values: ComfyControls }>;
export type ComfyFieldInfo = { choices?: string[]; type?: string; min?: number; max?: number; step?: number };
export type ComfyNodeInfo = Record<string, Record<string, ComfyFieldInfo>>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 4096;
const numeric = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const safe = (key: string) => !!key && !["__proto__", "prototype", "constructor"].includes(key);

export function validateControlBindings(raw: unknown, workflow: Workflow, bind: (value: unknown, kind: "string" | "number") => Binding): ControlBindings | undefined {
  if (raw === undefined) return;
  if (!record(raw) || Object.keys(raw).some(k => ![...comfyChoiceKeys, "loras"].includes(k))) throw new Error("采样与 LoRA 绑定无效");
  const result: ControlBindings = {};
  for (const key of comfyChoiceKeys) if (raw[key] !== undefined) {
    const b = bind(raw[key], "string");
    if (!text(workflow[b.nodeId].inputs[b.field])) throw new Error(`${comfyChoiceLabels[key]}默认值不能为空`);
    result[key] = b;
  }
  if (raw.loras !== undefined) {
    if (!Array.isArray(raw.loras)) throw new Error("LoRA 绑定需为列表");
    const nodes = new Set<string>();
    result.loras = raw.loras.map((v): LoraBinding => {
      if (!record(v) || typeof v.nodeId !== "string" || !safe(v.nodeId) || nodes.has(v.nodeId) || v.zeroDisables !== true) throw new Error("LoRA 位置重复或尚未确认归零停用规则");
      nodes.add(v.nodeId);
      const name = bind({ nodeId: v.nodeId, field: v.nameField }, "string"), model = bind({ nodeId: v.nodeId, field: v.modelField }, "number");
      const clip = v.clipField === undefined ? undefined : bind({ nodeId: v.nodeId, field: v.clipField }, "number");
      if (!text(workflow[name.nodeId].inputs[name.field])) throw new Error("LoRA 文件名不能为空；停用时仍须保留有效文件名");
      const type = workflow[v.nodeId].class_type;
      if (["LoraLoader", "LoraLoaderModelOnly"].includes(type) && (name.field !== "lora_name" || model.field !== "strength_model" || (type === "LoraLoader" ? clip?.field !== "strength_clip" : !!clip))) throw new Error("标准 LoRA 节点需绑定完整的名称与强度字段");
      return { nodeId: v.nodeId, nameField: name.field, modelField: model.field, ...(clip ? { clipField: clip.field } : {}), zeroDisables: true };
    });
    if (!result.loras.length) delete result.loras;
  }
  return Object.keys(result).length ? result : undefined;
}
export function comfyControlSpec(config: { workflow: Workflow; bindings: { controls?: ControlBindings } }): ComfyControlSpec | undefined {
  const controls = config.bindings.controls;
  if (!controls) return;
  const defaults: ComfyControls = {}, fields: ComfyControlSpec["fields"] = {};
  const field = (b: Binding): ControlField => ({ ...b, classType: config.workflow[b.nodeId].class_type });
  for (const key of comfyChoiceKeys) if (controls[key]) {
    fields[key] = field(controls[key]); defaults[key] = config.workflow[controls[key].nodeId].inputs[controls[key].field] as string;
  }
  const loras = (controls.loras ?? []).map(b => {
    const node = config.workflow[b.nodeId];
    return { id: b.nodeId, title: node._meta?.title || node.class_type, name: field({nodeId:b.nodeId,field:b.nameField}), model:field({nodeId:b.nodeId,field:b.modelField}), ...(b.clipField ? {clip:field({nodeId:b.nodeId,field:b.clipField})} : {}) };
  });
  if (loras.length) defaults.loras = loras.map(s => {
    const inputs = config.workflow[s.id].inputs, strengthModel = inputs[s.model.field] as number, strengthClip = s.clip ? inputs[s.clip.field] as number : undefined;
    return { id:s.id, name:inputs[s.name.field] as string, enabled:strengthModel !== 0 || (strengthClip ?? 0) !== 0, strengthModel, ...(strengthClip === undefined ? {} : {strengthClip}) };
  });
  return { defaults, fields, loras, signature: JSON.stringify([fields, loras.map(({title: _title,...s})=>s), defaults]) };
}
export function readComfyControls(value: unknown): ComfyControls | undefined {
  if (!record(value) || Object.keys(value).some(k => ![...comfyChoiceKeys, "loras"].includes(k))) return;
  const out: ComfyControls = {};
  for (const key of comfyChoiceKeys) if (value[key] !== undefined) { if (!text(value[key])) return; out[key] = value[key]; }
  if (value.loras !== undefined) {
    if (!Array.isArray(value.loras)) return;
    const seen = new Set<string>(); out.loras = [];
    for (const v of value.loras) {
      if (!record(v) || !text(v.id) || !safe(v.id) || seen.has(v.id) || !text(v.name) || typeof v.enabled !== "boolean" || !numeric(v.strengthModel) || v.strengthClip !== undefined && !numeric(v.strengthClip)) return;
      seen.add(v.id); out.loras.push({id:v.id,name:v.name,enabled:v.enabled,strengthModel:v.strengthModel,...(v.strengthClip === undefined ? {} : {strengthClip:v.strengthClip as number})});
    }
  }
  return out;
}
export function validateComfyControls(value: unknown, spec?: ComfyControlSpec): ComfyControls {
  const read = readComfyControls(value);
  if (!read) throw new Error("采样或 LoRA 参数无效");
  for (const key of comfyChoiceKeys) if (read[key] !== undefined && !spec?.fields[key]) throw new Error(`${comfyChoiceLabels[key]}由工作流固定`);
  if (read.loras && (read.loras.length !== spec?.loras.length || read.loras.some(v => { const slot = spec.loras.find(s => s.id === v.id); return !slot || !!slot.clip !== (v.strengthClip !== undefined); }))) throw new Error("LoRA 绑定已变化，请重新配置");
  return { ...structuredClone(spec?.defaults ?? {}), ...read };
}
export function readComfyControlMemory(value: unknown): ComfyControlMemory {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id,v]) => {
    const values = record(v) ? readComfyControls(v.values) : undefined;
    return id.startsWith("comfyui:") && record(v) && typeof v.signature === "string" && values ? [[id,{signature:v.signature,values}]] : [];
  }));
}
export function currentComfyControls(memory: ComfyControlMemory, model?: {id:string;comfyControls?:ComfyControlSpec} | null): ComfyControls {
  const spec = model?.comfyControls;
  if (!spec || !model) return {};
  const saved = memory?.[model.id];
  try { if (saved?.signature === spec.signature) return validateComfyControls(saved.values,spec); } catch { /* Invalid persisted choices fall back to the current template. */ }
  return structuredClone(spec.defaults);
}
export function injectComfyControls(workflow: Workflow, spec: ComfyControlSpec | undefined, raw: unknown) {
  const values = validateComfyControls(raw ?? {},spec);
  const set = (b: ControlField, value: string | number) => { workflow[b.nodeId].inputs[b.field] = value; };
  for (const key of comfyChoiceKeys) if (spec?.fields[key]) set(spec.fields[key],values[key]!);
  for (const slot of spec?.loras ?? []) {
    const v = values.loras!.find(v => v.id === slot.id)!;
    set(slot.name,v.name); set(slot.model,v.enabled ? v.strengthModel : 0);
    if (slot.clip) set(slot.clip,v.enabled ? v.strengthClip! : 0);
  }
}
/** Only declared input metadata is retained; no arbitrary server objects enter state. */
export function parseComfyNodeInfo(raw: unknown, classType: string): ComfyNodeInfo {
  if (!safe(classType) || !record(raw) || !Object.hasOwn(raw,classType) || !record(raw[classType])) throw new Error(`服务未提供节点 ${classType} 的信息`);
  const input = raw[classType].input;
  if (!record(input)) throw new Error(`节点 ${classType} 的输入信息无效`);
  const fields: Record<string,ComfyFieldInfo> = {};
  for (const section of [input.required,input.optional]) if (record(section)) for (const [key,entry] of Object.entries(section)) {
    if (!safe(key) || !Array.isArray(entry)) continue;
    const opts = record(entry[1]) ? entry[1] : {};
    const choices = Array.isArray(entry[0]) ? entry[0] : entry[0] === "COMBO" && Array.isArray(opts.options) ? opts.options : undefined;
    fields[key] = { ...(choices && choices.every(v=>typeof v === "string") ? { choices:[...new Set(choices as string[])] } : {}),
      ...(typeof entry[0] === "string" ? {type:entry[0]} : {}),
      ...Object.fromEntries(["min","max","step"].filter(k=>numeric(opts[k])).map(k=>[k,opts[k]])) };
  }
  return { [classType]:fields };
}
export const comfyFieldInfo = (info: ComfyNodeInfo, field?: ControlField) => field ? info[field.classType]?.[field.field] : undefined;
export function checkComfyControlOptions(values: ComfyControls, spec: ComfyControlSpec | undefined, info: ComfyNodeInfo) {
  const check = (field: ControlField | undefined, value: string | number | undefined) => {
    const rule = comfyFieldInfo(info,field);
    if (rule?.choices && !rule.choices.includes(String(value))) throw new Error(`选项已不可用：${String(value)}，请刷新列表并重新选择`);
    if (typeof value === "number" && (value < (rule?.min ?? -Infinity) || value > (rule?.max ?? Infinity))) throw new Error(`LoRA 强度超出节点允许范围：${String(value)}`);
  };
  for (const key of comfyChoiceKeys) if (spec?.fields[key]) check(spec.fields[key],values[key]);
  for (const slot of spec?.loras ?? []) {
    const v = values.loras?.find(v=>v.id===slot.id); if (!v) continue;
    check(slot.name,v.name); check(slot.model,v.enabled ? v.strengthModel : 0);
    if (slot.clip) check(slot.clip,v.enabled ? v.strengthClip : 0);
  }
}
