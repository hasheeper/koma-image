import { boardForm, DEFAULTS } from "../domain/drawing.ts";
import type { BoardForm, DrawingForm } from "../domain/drawing.ts";
import { readCharacters } from "../domain/characters.ts";
import { readReferences } from "../domain/nai-references.ts";
import { canonical } from "../ask/canonical.ts";
import { checkShape } from "../ask/draft/schema-check.ts";
import type { Picture } from "../ask/library.ts";
import { imageParameters } from "../domain/image-parameters.ts";
import { assetPath, statuses } from "./model.ts";
import type { Binding, Slate, SlateChange, Todo } from "./model.ts";

const string = (max = 8000) => ({ type: "string", maxLength: max });
const bool = { type: "boolean" };
export const slateEditSchema = { type: "object", additionalProperties: false, required: ["kind", "op"], properties: {
  kind: { type: "string", enum: ["slate_edit"] }, op: { type: "string", enum: ["create", "update", "delete"] },
  slate_id: string(100), expected_version: { type: "integer", minimum: 1 }, slate_title: string(120), directory_required: bool,
  golden_recipe: { type: "object", additionalProperties: false, properties: { capture_current: bool, form: { type: "object" }, unlock: bool, locked: bool } },
  todos: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["op"], properties: {
    op: { type: "string", enum: ["add", "update", "remove"] },
    id: { ...string(100), description: "仅 update/remove 填已有 Todo 的稳定 ID；add 省略，编号由应用自动生成，误填值不会用作任务身份。" },
    todo_title: string(120), description: string(), requirements: string(), mutation: string(),
    status: { type: "string", enum: statuses }, bonus: bool, image_required: bool, unbind: bool,
    bind: { type: "object", additionalProperties: false, required: ["source", "caption_source", "caption_mode"], properties: {
      source: string(30), target_path: string(240), caption_source: { type: "string", enum: ["base", "sent", "character"] }, caption_mode: { type: "string", enum: ["full", "strip_syntax"] }, character_id: string(100),
    } },
  } } },
} };
interface RecipeEdit { capture_current?: boolean; form?: BoardForm; unlock?: boolean; locked?: boolean }
interface TodoEdit extends Partial<Pick<Todo, "description" | "requirements" | "mutation" | "status" | "bonus" | "image_required">> {
  op: "add" | "update" | "remove"; id?: string; todo_title?: string; unbind?: boolean;
  bind?: { source: string; target_path?: string; caption_source: Binding["caption"]["source"]; caption_mode: Binding["caption"]["mode"]; character_id?: string };
}
export interface SlateEdit { kind: "slate_edit"; op: "create" | "update" | "delete"; slate_id?: string; expected_version?: number; slate_title?: string; directory_required?: boolean; golden_recipe?: RecipeEdit; todos?: TodoEdit[] }
export interface SlateStep { kind: "slate_edit"; change: SlateChange; captureRecipe: boolean; unlockRecipe: boolean }
/** Recipes are data, never write ports. Validate every persisted field; no arbitrary upstream data. */
export function recipeForm(input: unknown): BoardForm {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("配方表单无效");
  const raw = input as Record<string, unknown>, defaults = boardForm(DEFAULTS), out = structuredClone(defaults);
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`配方不支持 ${key}`);
    if (key === "characters") {
      if (!Array.isArray(value) || canonical(readCharacters(value)) !== canonical(value)) throw new Error("配方角色结构无效");
    } else if (key === "naiReferences") {
      if (canonical(readReferences(value)) !== canonical(value)) throw new Error("配方参考结构无效");
    } else {
      const d = defaults[key as keyof BoardForm];
      if (typeof value !== typeof d || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && value.length > 24000) throw new Error(`配方 ${key} 无效`);
    }
    Object.assign(out, { [key]: structuredClone(value) });
  }
  return out;
}
export function parseSlateEdit(raw: unknown, active: Slate | null, form: DrawingForm, library: readonly Picture[]): SlateStep {
  checkShape(raw, slateEditSchema, "任务草稿");
  const edit = raw as SlateEdit;
  if (edit.op !== "create" && (!active || edit.slate_id !== active.id || edit.expected_version !== active.version)) throw new Error("任务板 ID 或版本已变化，请读取当前任务板后重新提议");
  if (edit.op === "create" && (edit.slate_id !== undefined || edit.expected_version !== undefined)) throw new Error("新建清单请省略 slate_id 和 expected_version，应用会自动生成编号");
  const before = edit.op === "create" ? null : structuredClone(active!);
  const after: Slate = before ? structuredClone(before) : { id: crypto.randomUUID(), title: "新任务板", version: 1, todos: [], golden_recipe: null };
  if (edit.slate_title !== undefined) { if (!edit.slate_title.trim()) throw new Error("任务板标题不能为空"); after.title = edit.slate_title.trim(); }
  if (edit.op === "create" && !edit.slate_title?.trim()) throw new Error("新建任务板需要标题");
  const change: SlateChange = { id: after.id, before, after: edit.op === "delete" ? null : after, bindings: [], directoryRequired: edit.directory_required === true };
  if (edit.op === "delete") {
    if (edit.todos || edit.golden_recipe || edit.slate_title) throw new Error("删除任务板不能混合编辑");
    return { kind: "slate_edit", change, captureRecipe: false, unlockRecipe: false };
  }
  const recipe = edit.golden_recipe;
  if (recipe) {
    if (recipe.form && recipe.capture_current) throw new Error("配方只选择表单或当前画板");
    if (after.golden_recipe?.locked && !recipe.unlock && (recipe.form || recipe.capture_current || recipe.locked === false)) throw new Error("配方已锁定，修改前须明确 unlock");
    const next = recipe.form ? recipeForm(recipe.form) : recipe.capture_current ? boardForm(form) : after.golden_recipe?.form;
    if (!next) throw new Error("请先保存当前画板配方");
    after.golden_recipe = { form: next, locked: recipe.locked ?? (recipe.unlock ? false : after.golden_recipe?.locked ?? false) };
  }
  const seen = new Set<string>();
  for (const item of edit.todos ?? []) {
    // A suggested ID on add is never an existing-task reference or a stored identity.
    // Generate it here so model-supplied names cannot collide with saved tasks.
    const id = item.op === "add" ? undefined : item.id;
    if (id && seen.has(id)) throw new Error("同一 Todo 请合并在一个操作中");
    if (id) seen.add(id);
    let todo = item.op === "add" ? null : after.todos.find(t => t.id === id);
    if (item.op !== "add" && !todo) throw new Error("Todo 不存在");
    if (item.op === "remove") { after.todos = after.todos.filter(t => t !== todo); continue; }
    if (!todo) {
      todo = { id: crypto.randomUUID(), title: "", description: "", requirements: "", mutation: "", status: "todo", bonus: false, image_required: true, binding: null };
      after.todos.push(todo);
    }
    if (item.todo_title !== undefined) todo.title = item.todo_title;
    for (const key of ["description", "requirements", "mutation", "status", "bonus", "image_required"] as const) if (item[key] !== undefined) Object.assign(todo, { [key]: item[key] });
    if (!todo.title.trim()) throw new Error("Todo 标题不能为空");
    if (item.unbind && item.bind) throw new Error("不能同时绑定和解绑");
    if (item.unbind) todo.binding = null;
    if (item.bind) {
      const bind = item.bind, image = library.find(p => p.aliases.includes(bind.source)), origin = image?.origins.find(o => o.label === bind.source);
      if (!image || !origin || origin.source !== "history" && origin.source !== "favorites" && origin.source !== "edit") throw new Error("绑图仅接受本轮 #h / #f / #e 图片");
      const assetId = crypto.randomUUID(), params = imageParameters(image.params);
      const caption: Binding["caption"] = { source: bind.caption_source, mode: bind.caption_mode, ...(bind.character_id ? { characterId: bind.character_id } : {}) };
      if (caption.source === "character" && !caption.characterId) throw new Error("角色标注需要 character_id");
      const ext = image.blob.type === "image/webp" ? "webp" : image.blob.type === "image/jpeg" ? "jpg" : "png";
      todo.binding = { assetId, target_path: assetPath(bind.target_path ?? `assets/${after.id}/${todo.id}-${assetId}.${ext}`), caption };
      change.bindings.push({ assetId, entity_key:image.entity_key, source_ref:image.bindings?.[bind.source], label: bind.source, source: origin.source, ref: image.id, metadata: canonical({ params, size: image.size, type: image.blob.type, bytes: image.blob.size }) });
    }
    if (todo.status === "done" && todo.image_required && !todo.binding) throw new Error("此 Todo 需要绑图后才能完成；纯文本任务可明确关闭 image_required");
  }
  if (after.todos.length > 100) throw new Error("每个任务板最多 100 个 Todo");
  if (new TextEncoder().encode(JSON.stringify(after)).byteLength > 900 * 1024) throw new Error("任务板内容超过 900 KiB，请拆分清单");
  after.version = (before?.version ?? 0) + 1;
  return { kind: "slate_edit", change, captureRecipe: recipe?.capture_current === true, unlockRecipe: recipe?.unlock === true };
}
