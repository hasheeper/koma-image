import type { editContext } from "../ask/edit-context.ts";
import { draftSchema } from "../ask/draft/schema.ts";
import { checkShape } from "../ask/draft/schema-check.ts";
import { parseDraft, stateHash, validateDraft } from "../ask/draft/validate.ts";
import type { DraftState } from "../ask/draft/types.ts";
import type { Picture } from "../ask/library.ts";
import { canonical } from "../ask/canonical.ts";

export const LIVE_SCHEMA = "koma.bridge.live.v1", DRAFT_SCHEMA = "koma.bridge.draft.v1";
export const INBOX_LIMIT = 1024 * 1024;
export class InvalidInbox extends Error {}
export interface InboxReceipt { readonly draft_id: string; readonly status: "pending" | "applied" | "dismissed" | "invalid"; readonly error?: string }
export interface ExternalOrigin { readonly context: string; readonly draftId: string; readonly digest: string; readonly label: string }
export interface ExternalNote { readonly origin: ExternalOrigin; readonly status: InboxReceipt["status"]; readonly error?: string }
export interface BridgeSnapshot { readonly favoritesScope?: string; readonly pictureRefVersion?: 2; readonly edit?: ReturnType<typeof editContext>; readonly base: DraftState; readonly library: readonly Picture[]; readonly pictureScope: string }
export function inboxObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidInbox("草稿 JSON 须为对象");
  return input as Record<string, unknown>;
}
export function inboxId(input: unknown): string | null {
  const id = input && typeof input === "object" ? (input as Record<string, unknown>).draft_id : undefined;
  return typeof id === "string" && /^[\w.-]{1,120}$/.test(id) ? id : null;
}
export async function inboxDigest(input: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(input)));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function receiveDraft(input: Record<string, unknown>, snapshot: BridgeSnapshot, currentEditBoardId = snapshot.edit?.active_board_id) {
  if (input.schema !== DRAFT_SCHEMA || !inboxId(input)) throw new Error("草稿版本或 draft_id 无效");
  if (input.source_label !== undefined && (typeof input.source_label !== "string" || !input.source_label.trim() || input.source_label.length > 80)) throw new Error("source_label 无效");
  const { schema: _schema, draft_id: _id, source_label: _source, picture_scope_id: scope, favorites_scope_id: favScope, picture_ref_version: refVersion, edit_board_id: editBoard, ...body } = input;
  const references = Array.isArray(body.steps) && body.steps.some(s => inboxObject(s).kind === "restore_partial" || inboxObject(s).kind === "slate_edit" && Array.isArray(inboxObject(s).todos) && (inboxObject(s).todos as unknown[]).some(t => !!inboxObject(t).bind));
  if (refVersion !== undefined && refVersion !== 2) throw new Error("图片引用版本不受支持");
  if (refVersion === 2) {
    const labels = Array.isArray(body.steps) ? body.steps.flatMap(raw => {
      const step = inboxObject(raw);
      return step.kind === "restore_partial" ? [String(step.source ?? "")] : step.kind === "slate_edit" && Array.isArray(step.todos) ? step.todos.flatMap(t => {
        const bind = inboxObject(t).bind; return bind ? [String(inboxObject(bind).source ?? "")] : [];
      }) : [];
    }) : [];
    if (labels.some(tag=>/^#(?:h|e)/.test(tag)) && scope!==snapshot.pictureScope) throw new Error("图片编号作用域已失效，请重新导出状态");
    if (labels.some(tag=>tag.startsWith("#f")) && favScope!==snapshot.favoritesScope) throw new Error("收藏库作用域已失效，请重新导出状态");
    if (labels.some(tag=>/^#e[1-9]\d*[a-z]?$/.test(tag)) && (editBoard!==snapshot.edit?.active_board_id || editBoard!==currentEditBoardId)) throw new Error("编辑画板已切换，请使用完整编号");
  } else if ((references || scope !== undefined) && scope !== snapshot.pictureScope) throw new Error("图片编号作用域已失效，请重新导出状态");
  if (!Object.hasOwn(body, "base_hash")) body.base_hash = stateHash(snapshot.base);
  checkShape(body, draftSchema);
  const draft = parseDraft(body, snapshot.base, snapshot.library);
  if (draft.steps.some(s => s.kind === "chat_handoff" || s.kind === "chat_distill_branch" || s.kind === "prompt_patch" && s.target.startsWith("chat."))) throw new Error("外部草稿当前只支持 IMAGE");
  const plan = validateDraft(draft, snapshot.base, { off: new Set() });
  const problem = plan.steps.find(s => s.issue);
  if (problem) throw new Error(problem.issue);
  return draft;
}
