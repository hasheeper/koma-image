import type { PictureRefs } from "../edit-context.ts";
import type { AskMessage } from "../messages.ts";
import type { Draft, DraftPlan } from "../draft/types.ts";
import { draftView } from "../draft/view.ts";

export type TurnId = `T${number}`;
export type DraftStatus = "pending" | "applied" | "reverted" | "dismissed";
/** Recall saves the proposal and actual changed fields, never Draft.base. */
export interface TurnDraft {
  readonly proposal: Pick<Draft, "title" | "steps" | "newBoardName">;
  readonly scope: readonly string[];
  readonly delta: string;
  readonly status: DraftStatus;
  readonly applied?: {
    readonly scope: readonly string[];
    readonly delta: string;
    readonly changes: DraftPlan["changes"];
    readonly boardId?: string;
  };
}
export interface CommittedTurn {
  readonly pictureRefs?: PictureRefs;
  readonly turnId: TurnId;
  readonly messages: readonly AskMessage[];
  readonly viewed: readonly string[];
  readonly question: string;
  readonly attachments: readonly string[];
  readonly targets: readonly string[];
  readonly boards: readonly string[];
  readonly draft?: TurnDraft;
  /** The final completed request's normalized input, not the turn's billed sum. */
  readonly inputTokens?: number | null;
}
export interface LedgerEntry {
  readonly pictureRefs?: PictureRefs;
  readonly turnId: TurnId;
  readonly targets: readonly string[];
  readonly boards: readonly string[];
  readonly ask: string;
  readonly reply: string;
  readonly attachments: readonly string[];
  readonly draft?: {
    readonly title: string;
    readonly scope: readonly string[];
    readonly delta: string;
    readonly status: DraftStatus;
    readonly applied_to?: string;
  };
}
export const replyText = (turn: Pick<CommittedTurn, "messages">) => turn.messages
  .filter(m => m.role === "assistant").flatMap(m => m.content.flatMap(b => b.type === "text" ? [b.text] : [])).join("\n");
const excerpt = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 120);
export const firstSentence = (text: string) => excerpt(text.trim().match(/^.*?(?:[。！？!?]|\.(?=\s|$)|\n|$)/s)?.[0] ?? "");

export function summarizePlan(plan: DraftPlan) {
  const enabled = plan.steps.filter(s => s.enabled && !s.issue);
  const view = draftView({ ...plan, steps: enabled });
  return {
    scope: [...new Set(enabled.map(s => s.characterId ? `${s.characterId} · ${s.label}` : s.label))],
    delta: [...(view.added || view.removed ? [`+${view.added} −${view.removed}`] : []),
      ...(enabled.some(s => s.kind === "rewrite") ? ["rewrite"] : []),
      ...(enabled.some(s => s.kind === "parameter") ? ["params"] : []),
      ...(enabled.some(s => s.kind === "branch") ? ["branch"] : []),
      ...(enabled.some(s => s.kind === "handoff") ? ["handoff"] : [])].join(" · "),
  };
}
export function recordDraft(draft: Draft, plan: DraftPlan): TurnDraft {
  return { proposal: structuredClone({ title: draft.title, steps: draft.steps, ...(draft.newBoardName ? { newBoardName: draft.newBoardName } : {}) }),
    ...summarizePlan(plan), status: "pending" };
}
export function changeDraft(draft: TurnDraft, status: DraftStatus, plan?: DraftPlan): TurnDraft {
  return { ...draft, status, ...(plan ? { applied: { ...summarizePlan(plan), changes: structuredClone(plan.changes),
    ...(plan.workspace === "image" ? { boardId: plan.createdBoard?.id ?? plan.boardId } : {}) } } : {}) };
}
/** Exactly one deterministic entry per committed turn, without a classifier. */
export function ledgerEntry(turn: CommittedTurn): LedgerEntry {
  const draft = turn.draft, effective = draft?.applied ?? draft;
  return { turnId: turn.turnId, ...(turn.pictureRefs ? {pictureRefs:turn.pictureRefs} : {}), targets: [...new Set(turn.targets)], boards: [...new Set([...turn.boards, ...(draft?.applied?.boardId ? [draft.applied.boardId] : [])])],
    ask: excerpt(turn.question), reply: draft ? "" : firstSentence(replyText(turn)), attachments: [...new Set(turn.attachments)],
    ...(draft && effective ? { draft: { title: draft.proposal.title, scope: effective.scope, delta: effective.delta,
      status: draft.status, ...(draft.applied?.boardId ? { applied_to: draft.applied.boardId } : {}) } } : {}) };
}
