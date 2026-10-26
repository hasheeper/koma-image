import type { Draft, DraftPlan } from "./types.ts";
import type { createDraftWriter } from "./apply.ts";

export const UNDO_LIMIT = 50;
export interface DraftRecord {
  readonly id: number;
  readonly conversationId: string;
  readonly turnId: number;
  readonly draft: Draft;
  off: ReadonlySet<string>;
  status: "pending" | "applied" | "reverted";
  plan: DraftPlan | null;
  /** Exact CHAT keys at the latest write boundaries; null for IMAGE. */
  beforeReceipt: string | null;
  receipt: string | null;
}

/** chatDraftKey's third tuple item is the monotonic selection revision. */
function sameChatState(a: string, b: string) {
  const left: unknown[] = JSON.parse(a), right: unknown[] = JSON.parse(b);
  left[2] = right[2] = 0;
  return JSON.stringify(left) === JSON.stringify(right);
}

function rebase(stack: readonly DraftRecord[], record: DraftRecord, receipt: string | null) {
  if (record.beforeReceipt && receipt && sameChatState(record.beforeReceipt, receipt))
    for (const earlier of stack)
      if (earlier.receipt === record.beforeReceipt) earlier.receipt = receipt;
}

/** Page-level history. Only the stack and one redo retain full draft snapshots. */
export function createDraftStack(writer: ReturnType<typeof createDraftWriter>) {
  let sequence = 0, undoStack: DraftRecord[] = [], redo: DraftRecord | null = null;
  const retain = () => writer.retain?.([...undoStack, ...(redo ? [redo] : [])].flatMap(r => r.plan ? [r.plan] : []));
  function push(record: DraftRecord) {
    undoStack.push(record);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redo = null; retain();
  }
  return {
    get top() { return undoStack.at(-1) ?? null; },
    get redo() { return redo; },
    get records(): readonly DraftRecord[] { return [...undoStack]; },
    create(draft: Draft, conversationId: string, turnId: number): DraftRecord {
      return { id: ++sequence, conversationId, turnId, draft, off: new Set(), status: "pending", plan: null, beforeReceipt: null, receipt: null };
    },
    async apply(record: DraftRecord, plan: DraftPlan) {
      if (record.status !== "pending") throw new Error("草稿已处理");
      const before = plan.workspace === "chat" ? writer.chatKey() : null;
      const receipt = await writer.apply(plan);
      Object.assign(record, { plan, status: "applied", beforeReceipt: before, receipt });
      push(record);
    },
    async undo(id: number) {
      const record = undoStack.at(-1);
      if (!record || record.id !== id || !record.plan) throw new Error("先回退较新的草稿");
      const receipt = await writer.undo(record.plan, record.receipt);
      undoStack.pop();
      // An ASK branch undo advances selectionRevision. Reconnect only the exact
      // old boundary, with every other part unchanged; external edits stay stale.
      rebase(undoStack, record, receipt);
      record.status = "reverted";
      record.receipt = receipt;
      redo = record; retain();
      return record;
    },
    async restore(id: number) {
      const record = redo;
      if (!record || record.id !== id || !record.plan) throw new Error("这份草稿已不能恢复");
      const before = record.plan.workspace === "chat" ? writer.chatKey() : null;
      const receipt = await writer.apply(record.plan, record.receipt);
      Object.assign(record, { status: "applied", beforeReceipt: before, receipt });
      push(record);
      return record;
    },
    /** All selected checkpoints must be the global suffix, in application order. */
    preflight(ids: readonly number[]): readonly number[] {
      const selected = new Set(ids);
      if (!selected.size) return [];
      if (ids.some(id => !undoStack.some(r => r.id === id))) throw new Error("草稿已超出撤销保留范围");
      const suffix = undoStack.slice(-selected.size);
      if (suffix.some(r => !selected.has(r.id))) throw new Error("先回退较新的草稿");
      const simulated = undoStack.map(r => ({ ...r })), state = writer.simulate(), order: number[] = [];
      for (let i = 0; i < suffix.length; i++) {
        const record = simulated.pop()!;
        const receipt = state.undo(record.plan!, record.receipt);
        rebase(simulated, record, receipt);
        order.push(record.id);
      }
      return order;
    },
    removeTurns(conversationId: string, turnIds: ReadonlySet<number>) {
      const removed = (r: DraftRecord) => r.conversationId === conversationId && turnIds.has(r.turnId);
      undoStack = undoStack.filter(r => !removed(r));
      if (redo && removed(redo)) redo = null;
      retain();
    },
    /** Forget history only; deleting a conversation never writes the workspace. */
    removeConversation(id: string) {
      undoStack = undoStack.filter((r) => r.conversationId !== id);
      if (redo?.conversationId === id) redo = null;
      retain();
    },
  };
}
