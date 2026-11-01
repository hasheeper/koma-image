import { comfyFormKey, comfyParameterKeys, isComfyModel, readComfyValues, validComfyParameter } from "./comfy-workflow.ts";
import type { ComfyValues } from "./comfy-workflow.ts";
import type { CatalogModel } from "./catalog.ts";
import type { DrawingForm } from "./drawing.ts";

type NumericForm = Pick<DrawingForm, "width" | "height" | "steps" | "scale">;
type SavedParameters = { signature: string; values: ComfyValues };
export type ComfyParameterMemory = {
  normal?: NumericForm;
  active?: { model: string; signature: string; keys: (keyof ComfyValues)[] };
  saved: Record<string, SavedParameters>;
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const numericForm = (f: NumericForm): NumericForm => ({ width: f.width, height: f.height, steps: f.steps, scale: f.scale });
export function readComfyMemory(value: unknown): ComfyParameterMemory {
  const root = object(value), saved: ComfyParameterMemory["saved"] = {};
  for (const [id, v] of Object.entries(object(root.saved))) {
    const entry = object(v);
    if (id.startsWith("comfyui:") && typeof entry.signature === "string") saved[id] = { signature: entry.signature, values: readComfyValues(entry.values) };
  }
  const normal = object(root.normal), active = object(root.active);
  return { saved,
    ...(["width", "height", "steps", "scale"].every(k => typeof normal[k] === "number" && Number.isFinite(normal[k])) ? { normal: numericForm(normal as NumericForm) } : {}),
    ...(typeof active.model === "string" && active.model.startsWith("comfyui:") && typeof active.signature === "string" && Array.isArray(active.keys)
      ? { active: { model: active.model, signature: active.signature, keys: comfyParameterKeys.filter(k => (active.keys as unknown[]).includes(k)) } } : {}),
  };
}
/** Swap only the four basic fields; each board owns its workflow values and ordinary model values. */
export function syncComfyParameters(form: DrawingForm, model?: CatalogModel | null): DrawingForm {
  if (!model) return form; // Catalog refresh/unavailable source must not discard the current draft.
  const memory = readComfyMemory(form.comfyParameterMemory);
  const spec = isComfyModel(model) ? model.comfyParameters : undefined;
  if (memory.active?.model === model.id && memory.active.signature === spec?.signature) return form;
  if (memory.active) {
    const values = Object.fromEntries(memory.active.keys.map(k => [k, form[comfyFormKey(k)]]));
    memory.saved[memory.active.model] = { signature: memory.active.signature, values: readComfyValues(values) };
  }
  if (!spec || !Object.keys(spec.defaults).length) {
    if (!memory.active) return form;
    delete memory.active;
    return { ...form, ...memory.normal, comfyParameterMemory: memory };
  }
  if (!memory.active) memory.normal = numericForm(form);
  const cached = memory.saved[model.id];
  const values = cached?.signature === spec.signature ? { ...spec.defaults, ...cached.values } : spec.defaults;
  memory.active = { model: model.id, signature: spec.signature, keys: comfyParameterKeys.filter(k => spec.defaults[k] !== undefined) };
  return { ...form, ...memory.normal, ...Object.fromEntries(memory.active.keys.map(k => [comfyFormKey(k), values[k]])), comfyParameterMemory: memory };
}
export function collectComfyParameters(form: DrawingForm, model: CatalogModel): ComfyValues {
  const current = syncComfyParameters(form, model), values: ComfyValues = {};
  for (const key of comfyParameterKeys) {
    if (model.comfyParameters?.defaults[key] === undefined) continue;
    const value = current[comfyFormKey(key)];
    if (!validComfyParameter(key, value)) throw new Error(`${key} 须为${key === "cfg" ? "有限数值" : "正整数"}`);
    values[key] = value;
  }
  return values;
}
