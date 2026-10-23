import type { AskImage, AskMessage, AskRequest, AskUsage } from "./messages.ts";

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
  commit(meta?: { viewed?: Iterable<string> }): void;
  rollback(): void;
}
interface Committed { readonly messages: readonly AskMessage[]; readonly viewed: readonly string[] }
export interface SessionSnapshot { readonly turns: readonly Committed[]; readonly usage: AskUsage }

/**
 * One live conversation, optionally restored from a local favorite. A turn is a
 * transaction: its messages join the history only on commit, so a turn the
 * channel refused leaves nothing behind that would trip the next one.
 * `total` also receives every billed usage, for the page-wide count.
 */
export function createSession(total?: (usage: AskUsage) => void, from: readonly Committed[] = [], initialUsage?: AskUsage) {
  let committed = from,
    open: object | null = null;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...initialUsage };
  return {
    snapshot(): SessionSnapshot { return structuredClone({ turns: committed, usage }); },
    get messages() {
      return committed.flatMap((t) => t.messages);
    },
    get turns() {
      return committed.length;
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
      return new Set(committed.flatMap((t) => t.viewed));
    },
    /** Keep the first `count` turns as they are; their bytes stay a cacheable prefix. */
    truncate(count: number) {
      if (open) throw new Error("运行中不能截断对话");
      committed = committed.slice(0, Math.max(0, count));
    },
    /** A new conversation sharing the first `count` turns; its usage starts at zero. */
    fork(count: number) {
      if (open) throw new Error("运行中不能分支对话");
      return createSession(total, committed.slice(0, Math.max(0, count)));
    },
    begin(user: AskMessage, options: { metadataOnly?: boolean } = {}): Turn {
      if (open) throw new Error("上一轮尚未结束");
      const token = {},
        base = dehydrateTurns(committed.map((t) => t.messages), options.metadataOnly ? 0 : 2).flat(),
        pending: AskMessage[] = [user],
        budget: Budget = {
          toolCalls: 0,
          requests: 0,
          vision: { calls: 0, pixels: 0, bytes: 0 },
        };
      open = token;
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
          if (!value) return;
          usage.input += value.input;
          usage.output += value.output;
          usage.cacheRead += value.cacheRead;
          usage.cacheWrite += value.cacheWrite;
          total?.(value);
        },
        commit(meta = {}) {
          close();
          const turns = dehydrateTurns([...committed.map((t) => t.messages), pending]);
          committed = [...committed, { messages: pending, viewed: [...(meta.viewed ?? [])] }].map((t, i) => ({ ...t, messages: turns[i] }));
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
