import { chatDraftKey } from "../../domain/conversation.ts";
import type { ConversationRecord } from "../../storage/records.ts";
import type { Drawing } from "../../services/drawing.ts";
import type { Chat } from "../../services/chat.ts";
import type { AppRouter } from "../../app/router.ts";
import type { DrawingForm } from "../../domain/drawing.ts";
import type { DraftPlan, Field } from "./types.ts";

const labels: Partial<Record<Field, string>> = { prompt: "Prompt", negative: "Negative", composer: "对话输入框", model: "模型", width: "尺寸", height: "尺寸", seed: "Seed", steps: "步数", scale: "Scale", cfg: "CFG", sampler: "采样器", batchCount: "张数" };

/** The only ASK module with write ports. Called exclusively by user actions. */
export function createDraftWriter(drawing: Drawing, chat: Chat, router: AppRouter) {
  const chatKey = () => chatDraftKey(chat.snapshot().current);
  function conflictAt(plan: DraftPlan, side: "before" | "after", receipt: string | null, form: DrawingForm, current: ConversationRecord) {
    if (plan.workspace === "chat" && current.id !== plan.conversationId) return "对话已切换";
    if (plan.branch) return chatDraftKey(current) === (receipt ?? (side === "before" ? plan.branch.key : "")) ? "" : "对话分支已变化";
    const state = plan.workspace === "image" ? form : { composer: current.prompt };
    const fields = plan.changes.filter((c) => (state as Record<string, unknown>)[c.field] !== c[side]);
    return fields.length ? `${[...new Set(fields.map((c) => labels[c.field] ?? c.field))].join("、")} 已变化` : "";
  }
  const conflict = (plan: DraftPlan, side: "before" | "after", receipt: string | null = null) =>
    conflictAt(plan, side, receipt, drawing.snapshot().form, chat.snapshot().current);
  async function write(plan: DraftPlan, undo: boolean, receipt: string | null) {
    const reason = conflict(plan, undo ? "after" : "before", receipt);
    if (reason) throw new Error(reason);
    if (!plan.changes.length && !plan.branch) throw new Error("草稿没有可写入内容");
    if (router.route.value.overlay) throw new Error("请先关闭当前面板");
    router.switchWorkspace(plan.workspace);
    if (router.route.value.workspace !== plan.workspace) throw new Error("未能切换到目标工作区");
    if (plan.branch)
      return chat.writeBranchDraft(undo ? plan.branch.before : plan.branch.after, receipt ?? plan.branch.key);
    const values = Object.fromEntries(plan.changes.map((c) => [c.field, c[undo ? "before" : "after"]]));
    const expected = Object.fromEntries(plan.changes.map((c) => [c.field, c[undo ? "after" : "before"]]));
    if (plan.workspace === "image") { await drawing.writeDraft(values as Partial<DrawingForm>, expected); return null; }
    await chat.writeDraft(String(values.composer), plan.conversationId, String(expected.composer));
    return chatKey();
  }
  return {
    chatKey,
    conflict,
    apply: (plan: DraftPlan, receipt: string | null = null) => write(plan, false, receipt),
    undo: (plan: DraftPlan, receipt: string | null = null) => write(plan, true, receipt),
    canUndo: (plan: DraftPlan, receipt: string | null = null) => !conflict(plan, "after", receipt),
    /** Synchronous preflight; no ports, routing or shared state are mutated. */
    simulate() {
      const form = { ...drawing.snapshot().form }, current = { ...chat.snapshot().current };
      return {
        undo(plan: DraftPlan, receipt: string | null) {
          const reason = conflictAt(plan, "after", receipt, form, current);
          if (reason) throw new Error(reason);
          if (plan.branch) { Object.assign(current, plan.branch.before); current.selectionRevision++; }
          else if (plan.workspace === "image") Object.assign(form, Object.fromEntries(plan.changes.map(c => [c.field, c.before])));
          else current.prompt = String(plan.changes.find(c => c.field === "composer")!.before);
          return plan.workspace === "chat" ? chatDraftKey(current) : null;
        },
      };
    },
  };
}
