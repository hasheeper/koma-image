import type { AskImage, AskMessage, AskRequest, AskUsage } from "./messages.ts";
import { changeDraft, ledgerEntry } from "./compact/ledger.ts";
import type { CommittedTurn, DraftStatus, LedgerEntry, TurnDraft, TurnId } from "./compact/ledger.ts";
import type { DraftPlan } from "./draft/types.ts";
import { archiveTurns, getTurn, restoreTurn } from "./compact/archive.ts";
import type { AttachmentReader } from "./compact/archive.ts";
import { buildMemory, memoryMessages } from "./compact/layout.ts";
import type { SessionMemory } from "./compact/layout.ts";
import { validInputTokens } from "./compact/trigger.ts";

const placeholder = (image: AskImage) => ({
  type: "text" as const,
  text: `[Image ${image.viewed?.ids.join(", ") ?? "unknown"} (${image.viewed?.spec ?? "view"}, ${Math.ceil((image.viewed?.bytes ?? 0) / 1024)}KB) was viewed in an earlier turn; call view_image again if re-inspection is needed]`,
});
export function dehydrate(messages: readonly AskMessage[]): AskMessage[] {
  return messages.map((message) => ({ ...message, content: message.content.map((block) =>
    block.type === "image" ? placeholder(block)
      : block.type === "result" ? { ...block, content: block.content.map((part) => part.type === "image" ? placeholder(part) : part) }
        : block,
  ) }));
}
/** Replace pixels in old turns without changing tool ids or UI traces. */
export function dehydrateTurns(turns: readonly (readonly AskMessage[])[], hot = 3) {
  return turns.map((turn, i) => i < turns.length - hot ? dehydrate(turn) : turn);
}

/** Per-turn ceilings (doc 1 §9), shared by the runner and visual tools. */
export const LIMITS = Object.freeze({
  toolCalls: 6,
  /** Six tool rounds, the answer, and one spare for a model that ignores the cap. */
  requests: 8,
  vision: Object.freeze({ calls: 4, pixels: 1_500_000, bytes: 400_000 }),
});
export interface Budget {
  toolCalls: number;
  requests: number;
  vision: { calls: number; pixels: number; bytes: number };
}
export interface Turn {
  /** Committed history plus this turn's messages so far. */
  messages(): readonly AskMessage[];
  push(message: AskMessage): void;
  readonly budget: Budget;
  record(usage: AskUsage | null): void;
  /** `viewed`: images this turn saw whole, for later crops. */
  commit(meta?: { viewed?: Iterable<string>; question?: string; attachments?: readonly string[];
    targets?: readonly string[]; boards?: readonly string[]; draft?: TurnDraft }): TurnId;
  rollback(): void;
}
/** Older Koma favorites predate the stable IDs; infer missing bookkeeping on read. */
type RestoredTurn = Pick<CommittedTurn, "messages" | "viewed"> & Partial<CommittedTurn>;
export interface SessionData {
  readonly turns: readonly CommittedTurn[];
  readonly archive: readonly CommittedTurn[];
  readonly memory: SessionMemory | null;
  readonly ledger: readonly LedgerEntry[];
  readonly usage: AskUsage;
  readonly nextTurnId: number;
  readonly lastInputTokens: number | null;
  readonly turnsSinceCompaction: number;
  readonly afterCompaction: boolean;
  readonly archiveRebuild: boolean;
}
export interface SessionSnapshot extends Partial<Omit<SessionData, "turns" | "usage">> {
  readonly turns: readonly RestoredTurn[];
  readonly usage: AskUsage;
  readonly nextTurnId?: number;
}
const questionOf = (messages: readonly AskMessage[]) => {
  const last = messages[0]?.content.at(-1);
  return last?.type === "text" ? last.text : "";
};
function restoredTurn(turn: RestoredTurn, turnId: TurnId): CommittedTurn {
  return { ...turn, turnId, question: turn.question ?? questionOf(turn.messages), attachments: turn.attachments ?? [],
    targets: turn.targets ?? turn.viewed, boards: turn.boards ?? [] };
}

/**
 * One live conversation, optionally restored from a local favorite. A turn is a
 * transaction: its messages join the history only on commit, so a turn the
 * channel refused leaves nothing behind that would trip the next one.
 * `total` also receives every billed usage, for the page-wide count.
 */
export function createSession(total?: (usage: AskUsage) => void, from: readonly RestoredTurn[] = [], initialUsage?: AskUsage, nextId = 1, saved?: SessionSnapshot) {
  let archived: readonly CommittedTurn[] = saved?.archive ?? [],
    committed = from.map((t, i) => restoredTurn(t, t.turnId ?? `T${archived.length + i + 1}`)),
    memory = saved?.memory ?? null,
    open: object | null = null;
  const all = () => [...archived, ...committed];
  let nextTurnId = all().reduce((next, t) => Math.max(next, Number(t.turnId.slice(1)) + 1), nextId);
  let lastInputTokens = saved?.lastInputTokens !== undefined ? saved.lastInputTokens : committed.at(-1)?.inputTokens ?? null,
    turnsSinceCompaction = saved?.turnsSinceCompaction ?? committed.length,
    afterCompaction = saved?.afterCompaction ?? false,
    archiveRebuild = saved?.archiveRebuild ?? false;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...initialUsage };
  const snapshot = (): SessionData => structuredClone({ turns: committed, archive: archived, memory, ledger: all().map(ledgerEntry),
    usage, nextTurnId, lastInputTokens, turnsSinceCompaction, afterCompaction, archiveRebuild });
  const requestHistory = (metadataOnly = false) => [...memoryMessages(memory),
    ...dehydrateTurns(committed.map(t => t.messages), metadataOnly ? 0 : 2).flat()];
  function recordUsage(value: AskUsage | null) {
    if (!value) return;
    usage.input += value.input; usage.output += value.output;
    usage.cacheRead += value.cacheRead; usage.cacheWrite += value.cacheWrite;
    total?.(value);
  }
  function rebuild(prefix: readonly CommittedTurn[], read?: AttachmentReader) {
    if (!read) throw new Error("恢复归档需要本会话附件表");
    return prefix.map(t => restoreTurn(t, read));
  }
  return {
    snapshot,
    get nextTurnId(): TurnId { return `T${nextTurnId}`; },
    get ledger() { return all().map(ledgerEntry); },
    get records(): readonly CommittedTurn[] { return all(); },
    get retained(): readonly CommittedTurn[] { return committed; },
    get archive(): readonly CommittedTurn[] { return archived; },
    get memory() { return memory; },
    get lastInputTokens() { return lastInputTokens; },
    get turnsSinceCompaction() { return turnsSinceCompaction; },
    get archiveRebuild() { return archiveRebuild; },
    /** Consume only when the checked history is about to be sent, never on stop. */
    checkedArchive() { archiveRebuild = false; },
    /** Consumed at actual dispatch, even if that first request later fails. */
    takeAfterCompaction() { const value = afterCompaction; afterCompaction = false; return value; },
    recordUsage,
    requestHistory,
    recall(input: Readonly<Record<string, unknown>>, read: AttachmentReader) { return getTurn(input, all(), read); },
    updateDraft(turnId: TurnId, status: DraftStatus, plan?: DraftPlan) {
      if (open) throw new Error("运行中不能修改草稿状态");
      const change = (t: CommittedTurn) => t.turnId === turnId && t.draft ? { ...t, draft: changeDraft(t.draft, status, plan) } : t;
      committed = committed.map(change); archived = archived.map(change);
    },
    get messages() {
      return [...memoryMessages(memory), ...committed.flatMap(t => t.messages)];
    },
    get turns() {
      return archived.length + committed.length;
    },
    /** Tokens billed in this conversation, failed turns included. */
    get usage(): AskUsage {
      return { ...usage };
    },
    get busy() {
      return open !== null;
    },
    /** Images seen whole in the remaining committed turns. */
    viewed(): Set<string> {
      return new Set(all().flatMap(t => t.viewed));
    },
    /** Keep the first `count` turns as they are; their bytes stay a cacheable prefix. */
    truncate(count: number, read?: AttachmentReader) {
      if (open) throw new Error("运行中不能截断对话");
      const prefix = all().slice(0, Math.max(0, count)), removed = all().length - prefix.length;
      if (prefix.length < archived.length) {
        committed = rebuild(prefix, read); archived = []; memory = null;
        lastInputTokens = null; archiveRebuild = true; afterCompaction = false;
        turnsSinceCompaction = committed.length;
      } else {
        committed = prefix.slice(archived.length);
        lastInputTokens = archiveRebuild ? null : prefix.at(-1)?.inputTokens ?? null;
        turnsSinceCompaction = Math.max(0, turnsSinceCompaction - removed);
      }
    },
    /** A new conversation sharing the first `count` turns; its usage starts at zero. */
    fork(count: number, read?: AttachmentReader) {
      if (open) throw new Error("运行中不能分支对话");
      // A fork inherits proposal history, but no executable pending draft card.
      const prefix = all().slice(0, Math.max(0, count)).map(t => t.draft?.status === "pending"
        ? { ...t, draft: changeDraft(t.draft, "dismissed") } : t);
      const restored = archived.length > 0 && prefix.length <= archived.length;
      const forkArchive = restored ? [] : archived.map(t => prefix.find(p => p.turnId === t.turnId)!);
      const forkTurns = restored ? rebuild(prefix, read) : prefix.slice(forkArchive.length);
      return createSession(total, forkTurns, undefined, nextTurnId, { turns: forkTurns, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        archive: forkArchive, memory: restored ? null : memory, lastInputTokens: restored || archiveRebuild ? null : prefix.at(-1)?.inputTokens ?? null,
        turnsSinceCompaction: restored ? forkTurns.length : Math.max(0, turnsSinceCompaction - (all().length - prefix.length)),
        afterCompaction: !restored && afterCompaction, archiveRebuild: restored || archiveRebuild });
    },
    /** Holds the same conversation lock as a normal turn; only billing changes until commit. */
    beginCompaction(metadataOnly = false) {
      if (open) throw new Error("上一轮尚未结束");
      const token = {}; open = token;
      const check = () => { if (open !== token) throw new Error("压缩已结束"); };
      return {
        messages: requestHistory(metadataOnly),
        archive: archived, retained: committed, ledger: all().map(ledgerEntry),
        candidate(count: number, memo: string, read: AttachmentReader) {
          check();
          if (!Number.isSafeInteger(count) || count < 1 || count >= committed.length) throw new Error("无效归档边界");
          const archive = archiveTurns([...archived, ...committed.slice(0, count)], read);
          return { ...snapshot(), turns: committed.slice(count), archive: archive.turns,
            memory: buildMemory(archive.turns, all().map(ledgerEntry), archive.index, memo),
            turnsSinceCompaction: 0, afterCompaction: true, archiveRebuild: false };
        },
        commit(candidate: SessionData) {
          check();
          committed = [...candidate.turns]; archived = candidate.archive; memory = candidate.memory;
          turnsSinceCompaction = candidate.turnsSinceCompaction; afterCompaction = candidate.afterCompaction;
          archiveRebuild = candidate.archiveRebuild;
          open = null;
        },
        rollback() { check(); open = null; },
      };
    },
    begin(user: AskMessage, options: { metadataOnly?: boolean } = {}): Turn {
      if (open) throw new Error("上一轮尚未结束");
      const token = {},
        base = requestHistory(options.metadataOnly),
        pending: AskMessage[] = [user],
        budget: Budget = {
          toolCalls: 0,
          requests: 0,
          vision: { calls: 0, pixels: 0, bytes: 0 },
        };
      open = token;
      let inputTokens: number | null = null;
      const close = () => {
        if (open !== token) throw new Error("该轮已结束");
        open = null;
      };
      return {
        messages: () => [...base, ...pending],
        push(message) {
          if (open !== token) throw new Error("该轮已结束");
          pending.push(message);
        },
        budget,
        record(value) {
          inputTokens = validInputTokens(value);
          recordUsage(value);
        },
        commit(meta = {}) {
          close();
          const turnId: TurnId = `T${nextTurnId++}`;
          const turns = dehydrateTurns([...committed.map((t) => t.messages), pending]);
          const viewed = [...(meta.viewed ?? [])];
          committed = [...committed, { turnId, messages: pending, viewed, inputTokens, question: meta.question ?? questionOf(pending),
            attachments: [...(meta.attachments ?? [])], targets: [...(meta.targets ?? viewed)], boards: [...(meta.boards ?? [])],
            ...(meta.draft ? { draft: meta.draft } : {}) }].map((t, i) => ({ ...t, messages: turns[i] }));
          lastInputTokens = inputTokens; turnsSinceCompaction++; archiveRebuild = false;
          return turnId;
        },
        rollback: close,
      };
    },
  };
}
export type Session = ReturnType<typeof createSession>;

const cjk = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿＀-￯]/g;
/** A local guess, shown with「约」; the upstream usage is the real count. */
export function approxTokens(text: string) {
  const wide = text.match(cjk)?.length ?? 0;
  return Math.ceil(wide + (text.length - wide) / 4);
}
const IMAGE_TOKENS = 1000;
const imageTokens = (image: AskImage) => image.size ? Math.ceil(image.size.width * image.size.height / 750) : IMAGE_TOKENS;
export function estimateRequest(request: Omit<AskRequest, "maxTokens" | "model">) {
  let total = approxTokens(JSON.stringify(request.tools)) + approxTokens(request.system.join("\n"));
  for (const message of request.messages)
    for (const block of message.content) {
      if (block.type === "text") total += approxTokens(block.text);
      else if (block.type === "image") total += imageTokens(block);
      else if (block.type === "call") total += approxTokens(JSON.stringify(block.input)) + 8;
      else
        for (const part of block.content)
          total += part.type === "text" ? approxTokens(part.text) : imageTokens(part);
    }
  return total;
}
