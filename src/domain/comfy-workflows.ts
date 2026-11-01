import { comfyModelId, validateComfyWorkflow } from "./comfy-workflow.ts";
import type { ComfyWorkflow } from "./comfy-workflow.ts";
import { object } from "./value.ts";

export type ComfyAllowedModel = { id: string; name: string; file: string };
export type ComfyWorkflowEntry = ComfyWorkflow & { id: string; name: string; models?: ComfyAllowedModel[] };
type WorkflowSource = { id: string; name: string; comfyWorkflow?: ComfyWorkflow; comfyWorkflows?: ComfyWorkflowEntry[] };
const validId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v) && !["constructor", "prototype", "__proto__"].includes(v);
export const newComfyId = () => crypto.randomUUID().slice(0, 18);

/** Compatibility is explicitly configured; filenames never imply interchangeable architectures. */
export function validateComfyWorkflows(value: unknown): ComfyWorkflowEntry[] {
  if (!Array.isArray(value) || !value.length) throw new Error("请至少配置一个工作流");
  const ids = new Set<string>();
  return value.map(raw => {
    const item = object(raw);
    if (!validId(item.id) || ids.has(item.id)) throw new Error("工作流身份重复或无效");
    ids.add(item.id);
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 128) throw new Error("请填写工作流名称（最多 128 字）");
    const config = validateComfyWorkflow(item);
    let models: ComfyAllowedModel[] | undefined;
    if (config.bindings.model) {
      if (!Array.isArray(item.models) || !item.models.length) throw new Error(`「${item.name}」请至少添加一个允许使用的模型`);
      const modelIds = new Set<string>(), files = new Set<string>();
      models = item.models.map(raw => {
        const m = object(raw);
        if (!validId(m.id) || modelIds.has(m.id)) throw new Error("模型身份重复或无效");
        if (typeof m.file !== "string" || !m.file.trim() || m.file.length > 512 || /[\r\n\0]/.test(m.file) || files.has(m.file.trim())) throw new Error("模型文件名为空、重复或无效");
        if (typeof m.name !== "string" || m.name.length > 128) throw new Error("模型显示名无效");
        modelIds.add(m.id); files.add(m.file.trim());
        return { id: m.id, name: m.name.trim(), file: m.file.trim() };
      });
    } else if (item.models !== undefined && (!Array.isArray(item.models) || item.models.length)) throw new Error("请先绑定主模型文件名输入");
    return { ...config, id: item.id, name: item.name.trim(), ...(models ? { models } : {}) };
  });
}

/** Existing single-workflow connections keep their model identity until explicitly replaced. */
export function connectionWorkflows(source: WorkflowSource): ComfyWorkflowEntry[] {
  return source.comfyWorkflows !== undefined ? validateComfyWorkflows(source.comfyWorkflows)
    : [{ ...validateComfyWorkflow(source.comfyWorkflow), id: "default", name: source.name }];
}
export function comfyRoutes(source: WorkflowSource) {
  return connectionWorkflows(source).flatMap(entry => (entry.models ?? [undefined]).map(model => {
    const config = validateComfyWorkflow(entry), b = config.bindings.model;
    if (model && b) config.workflow[b.nodeId].inputs[b.field] = model.file;
    return { id: comfyModelId(source.id, entry.id, model?.id), entry, model, config };
  }));
}
export function resolveComfyRoute(source: WorkflowSource, modelId: string) {
  const route = comfyRoutes(source).find(route => route.id === modelId);
  if (!route) throw new Error("所选模型或工作流已移除，请重新选择模型");
  return route;
}
