import type { BoardForm } from "../domain/drawing.ts";
import { canonical } from "../ask/canonical.ts";

export const statuses = ["todo", "in_progress", "done", "abandoned"] as const;
export type TodoStatus = typeof statuses[number];
export const statusNames: Record<TodoStatus, string> = { todo: "待办", in_progress: "进行中", done: "已完成", abandoned: "已放弃" };
export interface Binding {
  assetId: string;
  target_path: string;
  caption: { mode: "full" | "strip_syntax"; source: "base" | "sent" | "character"; characterId?: string };
}
export interface Todo {
  id: string; title: string; description: string; requirements: string; mutation: string;
  status: TodoStatus; bonus: boolean; image_required: boolean; binding: Binding | null;
}
export interface Slate {
  id: string; title: string; version: number;
  golden_recipe: { form: BoardForm; locked: boolean } | null;
  todos: Todo[];
}
export interface SlateAsset {
  entity_key?: string;
  source_ref?: import("../domain/image-identity.ts").ImageTagBinding;
  id: string; blob: Blob; sha256: string; width: number; height: number; mime: string;
  sourceId: string; params: Record<string, unknown>; boundAt: string;
}
export interface BindRequest { entity_key?: string; source_ref?: import("../domain/image-identity.ts").ImageTagBinding; assetId: string; source: "history" | "favorites" | "edit"; ref: string; label: string; metadata: string }
export interface SlateChange {
  before: Slate | null; after: Slate | null; id: string; bindings: BindRequest[]; directoryRequired: boolean;
}
export const contentKey = (slate: Slate | null) => canonical(slate ? { ...slate, version: 0 } : null);
export const summary = (s: Slate | null) => s ? { id: s.id, title: s.title, version: s.version,
  golden_recipe: s.golden_recipe ? { locked: s.golden_recipe.locked, model: s.golden_recipe.form.model, width: s.golden_recipe.form.width, height: s.golden_recipe.form.height, prompt_excerpt: s.golden_recipe.form.prompt.slice(0, 160) } : null,
  todos: s.todos.map(t => ({ id: t.id, title: t.title, status: t.status, requirements: t.requirements.slice(0, 320), ...(t.requirements.length > 320 ? { requirements_truncated: true } : {}), bonus: t.bonus, image_required: t.image_required, bound: !!t.binding })) } : null;
export const describe = (s: Slate | null) => s ? `${s.title}\n${s.golden_recipe ? `配方：${s.golden_recipe.locked ? "已锁定" : "可修改"} · ${s.golden_recipe.form.model} · ${s.golden_recipe.form.width}×${s.golden_recipe.form.height}\n${canonical(s.golden_recipe.form)}\n` : ""}${s.todos.map(t => `${t.id} · ${t.title} · ${statusNames[t.status]}${t.bonus ? " · Bonus" : ""}${t.image_required ? " · 需交图" : ""}\n${t.description}\n要求：${t.requirements || "—"}\n更改：${t.mutation || "—"}${t.binding ? `\n绑图：${t.binding.assetId} → ${t.binding.target_path}\n标注：${canonical(t.binding.caption)}` : ""}`).join("\n\n")}` : "（无任务板）";
export async function sha256(value: Blob | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : await value.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function assetPath(path: string) {
  if (!/^assets\/[a-zA-Z0-9_\-./]+\.(png|webp|jpg|jpeg)$/.test(path) || path.length > 240 || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("成果路径须在 assets/ 下，使用字母、数字、连字符及图片扩展名");
  return path;
}
