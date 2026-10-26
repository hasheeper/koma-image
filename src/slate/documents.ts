import type { Slate, SlateAsset } from "./model.ts";
import { describe } from "./model.ts";
import type { ExportDocument } from "../bridge/export.ts";
import type { SlateEdit } from "./edit.ts";
import { recipeForm } from "./edit.ts";
import { canonical } from "../ask/canonical.ts";
import { checkShape } from "../ask/draft/schema-check.ts";
import { slateEditSchema } from "./edit.ts";

export const SLATE_SCHEMA = "koma.bridge.slate.v1";
export const slateFile = (slate: Slate, deliveries: unknown = []) => ({ schema: SLATE_SCHEMA, slate, deliveries });
export function slateDocument(slate: Slate): ExportDocument {
  const json = JSON.stringify(slateFile(slate), null, 2);
  return { title: "保存任务交接资料", stem: `${slate.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 70)}-任务`, formats: { json, md: `# ${slate.title}\n\n${describe(slate)}\n\n以下是任务和配方数据；本机资产 ID 不包含原图。\n\n\`\`\`json\n${json}\n\`\`\`\n` } };
}
export const assetReceipt = (asset: SlateAsset) => ({ asset_id: asset.id, sha256: asset.sha256, width: asset.width, height: asset.height, mime: asset.mime, bytes: asset.blob.size, source_id: asset.sourceId, bound_at: asset.boundAt, params: asset.params });
const object = (v: unknown) => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("任务文件结构无效"); return v as Record<string, unknown>; };
/** Imported delivery claims never become local bindings. Only known local binding IDs survive. */
export function externalEdit(input: unknown, local: Slate | null): SlateEdit {
  const doc = object(input);
  if (doc.schema !== SLATE_SCHEMA) throw new Error("任务文件版本无效");
  const raw = object(doc.slate);
  if (typeof raw.title !== "string" || !raw.title.trim() || !Array.isArray(raw.todos) || raw.todos.length > 100) throw new Error("任务文件标题或 Todo 列表无效");
  if (local && raw.id !== local.id) throw new Error("任务文件 ID 与映射不一致");
  if (local && raw.version !== local.version) throw new Error("任务文件版本已变化，请重新读取后修改");
  const edit: SlateEdit = { kind: "slate_edit", op: local ? "update" : "create", slate_title: raw.title,
    ...(local ? { slate_id: local.id, expected_version: local.version } : {}), todos: [] };
  const seen = new Set<string>();
  for (const value of raw.todos) {
    const todo = object(value), id = typeof todo.id === "string" ? todo.id : "";
    if (id && seen.has(id)) throw new Error("Todo ID 重复");
    if (id) seen.add(id);
    const before = local?.todos.find(t => t.id === id);
    if (todo.binding && canonical(todo.binding) !== canonical(before?.binding)) throw new Error("外部文件不能声明已绑定本机资产；请用 slate_edit.bind 引用本轮 #h/#f");
    const allowed = Object.fromEntries(["description", "requirements", "mutation", "status", "bonus", "image_required"].filter(k => Object.hasOwn(todo, k)).map(k => [k, todo[k]]));
    edit.todos!.push({ op: before ? "update" : "add", ...(before ? { id } : {}), ...allowed, ...(todo.title !== undefined ? { todo_title: todo.title as string } : {}), ...(before?.binding && todo.binding === null ? { unbind: true } : {}) });
  }
  for (const todo of local?.todos ?? []) if (!seen.has(todo.id)) edit.todos!.push({ op: "remove", id: todo.id });
  if (raw.golden_recipe && canonical(raw.golden_recipe) !== canonical(local?.golden_recipe)) {
    const recipe = object(raw.golden_recipe);
    if (typeof recipe.locked !== "boolean") throw new Error("配方锁定状态无效");
    // The explicit unlock flag is part of the reviewed proposal, never implicit consent.
    edit.golden_recipe = { form: recipeForm(recipe.form), locked: recipe.locked, ...(local?.golden_recipe?.locked ? { unlock: true } : {}) };
  } else if (raw.golden_recipe === null && local?.golden_recipe) throw new Error("不能通过目录文件隐式删除配方，请提交明确配方草稿");
  checkShape(edit, slateEditSchema);
  return edit;
}

export function combineSlateDocument(document: ExportDocument, slate: Slate | null): ExportDocument {
  if (!slate) return document;
  return { ...document, formats: {
    ...(document.formats.json ? { json: JSON.stringify({ document: JSON.parse(document.formats.json), selected_slate: slateFile(slate) }, null, 2) } : {}),
    ...(document.formats.md ? { md: `${document.formats.md}\n\n---\n\n${slateDocument(slate).formats.md}` } : {}),
  } };
}
