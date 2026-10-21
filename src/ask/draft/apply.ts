import type { Drawing } from "../../services/drawing.ts";
import type { Chat } from "../../services/chat.ts";
import type { AppRouter } from "../../app/router.ts";
import type { DrawingForm } from "../../domain/drawing.ts";
import type { DraftPlan } from "./types.ts";

/** The only ASK module with write ports. Called exclusively by user actions. */
export function createDraftWriter(drawing: Drawing, chat: Chat, router: AppRouter) {
  function matches(plan: DraftPlan, side: "before" | "after") {
    const state = plan.workspace === "image" ? drawing.snapshot().form : { composer: chat.snapshot().current.prompt };
    if (plan.workspace === "chat" && chat.snapshot().current.id !== plan.conversationId) return false;
    return plan.changes.every((c) => (state as Record<string, unknown>)[c.field] === c[side]);
  }
  async function write(plan: DraftPlan, undo = false) {
    if (!plan.changes.length || !matches(plan, undo ? "after" : "before")) throw new Error("内容已变化，请先核对当前草稿");
    if (router.route.value.overlay) throw new Error("请先关闭当前面板");
    router.switchWorkspace(plan.workspace);
    if (router.route.value.workspace !== plan.workspace) throw new Error("未能切换到目标工作区");
    const values = Object.fromEntries(plan.changes.map((c) => [c.field, c[undo ? "before" : "after"]]));
    const expected = Object.fromEntries(plan.changes.map((c) => [c.field, c[undo ? "after" : "before"]]));
    if (plan.workspace === "image") await drawing.writeDraft(values as Partial<DrawingForm>, expected);
    else await chat.writeDraft(String(values.composer), plan.conversationId, String(expected.composer));
  }
  return { apply: (plan: DraftPlan) => write(plan), undo: (plan: DraftPlan) => write(plan, true), canUndo: (plan: DraftPlan) => matches(plan, "after") };
}
