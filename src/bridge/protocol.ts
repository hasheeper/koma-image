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
export interface BridgeSnapshot { readonly base: DraftState; readonly library: readonly Picture[]; readonly pictureScope: string }
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
export function receiveDraft(input: Record<string, unknown>, snapshot: BridgeSnapshot) {
  if (input.schema !== DRAFT_SCHEMA || !inboxId(input)) throw new Error("草稿版本或 draft_id 无效");
  if (input.source_label !== undefined && (typeof input.source_label !== "string" || !input.source_label.trim() || input.source_label.length > 80)) throw new Error("source_label 无效");
  const { schema: _schema, draft_id: _id, source_label: _source, picture_scope_id: scope, ...body } = input;
  const references = Array.isArray(body.steps) && body.steps.some(s => inboxObject(s).kind === "restore_partial" || inboxObject(s).kind === "slate_edit" && Array.isArray(inboxObject(s).todos) && (inboxObject(s).todos as unknown[]).some(t => !!inboxObject(t).bind));
  if ((references || scope !== undefined) && scope !== snapshot.pictureScope) throw new Error("图片编号作用域已失效，请重新导出状态");
  if (!Object.hasOwn(body, "base_hash")) body.base_hash = stateHash(snapshot.base);
  checkShape(body, draftSchema);
  const draft = parseDraft(body, snapshot.base, snapshot.library);
  if (draft.steps.some(s => s.kind === "chat_handoff" || s.kind === "chat_distill_branch" || s.kind === "prompt_patch" && s.target.startsWith("chat."))) throw new Error("外部草稿当前只支持 IMAGE");
  const plan = validateDraft(draft, snapshot.base, { off: new Set() });
  const problem = plan.steps.find(s => s.issue);
  if (problem) throw new Error(problem.issue);
  return draft;
}
