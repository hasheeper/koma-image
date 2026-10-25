import { chatDraftKey, sortConversations } from "../../domain/conversation.ts";
import { sameValue } from "../../domain/characters.ts";
import type { ConversationRecord } from "../../storage/records.ts";
import type { Drawing } from "../../services/drawing.ts";
import type { Chat } from "../../services/chat.ts";
import type { AppRouter } from "../../app/router.ts";
import type { DrawingBoard, DrawingForm } from "../../domain/drawing.ts";
import { imageFileName } from "../../domain/drawing.ts";
import type { DraftPlan, Field } from "./types.ts";

const labels: Partial<Record<Field, string>> = { prompt: "Prompt", negative: "Negative", composer: "对话输入框", model: "模型", width: "尺寸", height: "尺寸", seed: "Seed", steps: "步数", scale: "Scale", cfg: "CFG", sampler: "采样器", batchCount: "张数", characters: "角色组", placement: "角色定位" };

/** The only ASK module with write ports. Called exclusively by user actions. */
export function createDraftWriter(drawing: Drawing, chat: Chat, router: AppRouter) {
  const chatKey = () => chatDraftKey(chat.snapshot().current);
  const readBoards = () => new Map((drawing.snapshot().boards ?? []).map(b => [b.id, structuredClone(b)]));
  const handoffTarget = (receipt: string | null) => receipt ? String(JSON.parse(receipt)[0]) : "";
  function conflictAt(plan: DraftPlan, side: "before" | "after", receipt: string | null, fallback: DrawingForm, current: ConversationRecord, boards: ReadonlyMap<string, DrawingBoard>,
    find: (id: string) => ConversationRecord | undefined) {
    // A handoff opens its own conversation; only undo depends on CHAT's current state.
    if (plan.handoff) {
      if (side === "before") return "";
      const target = find(handoffTarget(receipt));
      return !target ? "新对话已删除" : chatDraftKey(target) !== receipt ? "新对话已继续编辑" : "";
    }
    if (plan.workspace === "chat" && current.id !== plan.conversationId) return "对话已切换";
    if (plan.branch) return chatDraftKey(current) === (receipt ?? (side === "before" ? plan.branch.key : "")) ? "" : "对话分支已变化";
    if (plan.workspace === "image" && plan.boardId && !boards.has(plan.boardId)) return "来源画板已删除";
    if (plan.createdBoard) {
      const b = boards.get(plan.createdBoard.id);
      return side === "before" ? b ? "目标画板已存在" : "" : !b ? "新画板已删除" : !sameValue(b.form, plan.createdBoard.form) ? "新画板已继续编辑" : "";
    }
    const state = plan.workspace === "image" ? plan.boardId ? boards.get(plan.boardId)!.form : fallback : { composer: current.prompt };
    const fields = plan.changes.filter(c => !sameValue((state as Record<string, unknown>)[c.field], c[side]));
    return fields.length ? `${[...new Set(fields.map(c => labels[c.field] ?? c.field))].join("、")} 已变化` : "";
  }
  const conflict = (plan: DraftPlan, side: "before" | "after", receipt: string | null = null) =>
    conflictAt(plan, side, receipt, drawing.snapshot().form, chat.snapshot().current, readBoards(), (id) => chat.snapshot().conversations.find((c) => c.id === id));
  /** IMAGE records are read at write time; `#h` may have been cleared since the proposal. */
  function handoffImages(plan: DraftPlan) {
    const d = drawing.snapshot(), records = [...d.history, ...d.favorites];
    return plan.handoff!.images.map((image) => {
      if (image.source === "chat") return { asset: image.ref };
      const record = records.find((r) => r.id === image.ref);
      if (!record) throw new Error(`${image.label} 已移除`);
      return { blob: record.blob, name: imageFileName(record) };
    });
  }
  async function write(plan: DraftPlan, undo: boolean, receipt: string | null) {
    const reason = conflict(plan, undo ? "after" : "before", receipt);
    if (reason) throw new Error(reason);
    if (!plan.changes.length && !plan.branch && !plan.handoff) throw new Error("草稿没有可写入内容");
    if (router.route.value.overlay) throw new Error("请先关闭当前面板");
    const images = plan.handoff && !undo ? handoffImages(plan) : [];
    router.switchWorkspace(plan.workspace);
    if (router.route.value.workspace !== plan.workspace) throw new Error("未能切换到目标工作区");
    if (plan.handoff) return undo ? chat.undoHandoffDraft(receipt!) : chat.writeHandoffDraft({ ...plan.handoff, images });
    if (plan.branch) return chat.writeBranchDraft(undo ? plan.branch.before : plan.branch.after, receipt ?? plan.branch.key);
    if (plan.createdBoard && plan.boardId) {
      if (undo) await drawing.removeBoardDraft(plan.createdBoard.id, plan.createdBoard, plan.boardId);
      else await drawing.insertBoardDraft(plan.createdBoard, plan.boardId);
      return null;
    }
    const values = Object.fromEntries(plan.changes.map(c => [c.field, c[undo ? "before" : "after"]]));
    const expected = Object.fromEntries(plan.changes.map(c => [c.field, c[undo ? "after" : "before"]]));
    if (plan.workspace === "image") { await drawing.writeDraft(values as Partial<DrawingForm>, expected, plan.boardId); return null; }
    await chat.writeDraft(String(values.composer), plan.conversationId, String(expected.composer));
    return chatKey();
  }
  return {
    chatKey, conflict,
    apply: (plan: DraftPlan, receipt: string | null = null) => write(plan, false, receipt),
    undo: (plan: DraftPlan, receipt: string | null = null) => write(plan, true, receipt),
    canUndo: (plan: DraftPlan, receipt: string | null = null) => !conflict(plan, "after", receipt),
    /** Synchronous W4 preflight across every affected board, without write ports. */
    simulate() {
      const form = structuredClone(drawing.snapshot().form), boards = readBoards(), snapshot = chat.snapshot(),
        conversations = new Map(snapshot.conversations.map((c) => [c.id, structuredClone(c)]));
      let current = conversations.get(snapshot.current.id) ?? structuredClone(snapshot.current);
      return {
        undo(plan: DraftPlan, receipt: string | null) {
          const reason = conflictAt(plan, "after", receipt, form, current, boards, (id) => conversations.get(id));
          if (reason) throw new Error(reason);
          if (plan.handoff) {
            const id = handoffTarget(receipt), target = conversations.get(id)!, origin = chat.handoffOrigin(id);
            if (origin?.before) Object.assign(target, origin.before, { selectionRevision: target.selectionRevision + 1 });
            else conversations.delete(id);
            if (current === target || !conversations.has(current.id))
              current = conversations.get(origin?.source ?? "") ?? sortConversations([...conversations.values()])[0] ?? current;
          }
          else if (plan.branch) { Object.assign(current, plan.branch.before); current.selectionRevision++; }
          else if (plan.createdBoard) boards.delete(plan.createdBoard.id);
          else if (plan.workspace === "image") Object.assign(plan.boardId ? boards.get(plan.boardId)!.form : form, Object.fromEntries(plan.changes.map(c => [c.field, structuredClone(c.before)])));
          else current.prompt = String(plan.changes.find(c => c.field === "composer")!.before);
          return plan.workspace === "chat" ? chatDraftKey(current) : null;
        },
      };
    },
  };
}
