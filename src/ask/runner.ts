import { ProviderError } from "./messages.ts";
import type { AskBlock, AskCall, AskEvent, AskRequest, AskResult, AskUsage } from "./messages.ts";
import { LIMITS } from "./session.ts";
import type { Turn } from "./session.ts";
import type { ToolContext, ToolRegistry } from "./tools.ts";
import type { Draft } from "./draft/types.ts";

export type RunEvent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool-start";
      readonly id: string;
      readonly name: string;
      readonly verb: string;
      readonly object: string;
    }
  | {
      readonly type: "tool-end";
      readonly id: string;
      readonly ok: boolean;
      readonly stat: string;
      readonly reason?: string;
      readonly picks?: readonly string[];
      readonly draft?: Draft;
    }
  | { readonly type: "usage"; readonly usage: AskUsage }
  | { readonly type: "done"; readonly reason: "end" | "final" | "length" };

export interface RunOptions {
  /** The provider's stream with the codec already bound. */
  readonly stream: (request: AskRequest, signal: AbortSignal) => AsyncIterable<AskEvent>;
  readonly request: Omit<AskRequest, "messages">;
  readonly turn: Turn;
  readonly tools: ToolRegistry;
  readonly context: ToolContext;
  readonly signal: AbortSignal;
}
const failure = (id: string, text: string): AskResult => ({
  type: "result",
  id,
  content: [{ type: "text", text }],
  error: true,
});

/**
 * The tool loop for one turn. Each step streams one model response; tool
 * calls run in order and their results go back at the tail of the turn, so
 * the request only ever grows at the end. At most six calls; a final tool
 * (the draft, A2) ends tool execution. A silent turn gets one prose-only
 * completion within the same request budget. Errors propagate: caller rolls back.
 */
export async function* run(options: RunOptions): AsyncGenerator<RunEvent, void> {
  const { turn, tools, context, signal } = options;
  let hasText = false, final = false, completing = false;
  const complete = () => {
    completing = true;
    turn.push({ role: "user", content: [{ type: "text", text: final
      ? "草稿已提交，尚未应用。请仅用 1–2 句说明这份草稿改了什么，交给用户核对；不要再调用工具。"
      : "本轮工具已返回结果，但还没有回复正文。请仅用 1–2 句基于已取得的信息回答用户；未能确认的内容如实说明，不要再调用工具。" }] });
  };
  while (true) {
    signal.throwIfAborted();
    if (++turn.budget.requests > LIMITS.requests)
      throw new ProviderError("protocol", "模型超出本轮工具调用上限");
    let text = "",
      stop: "end" | "tool" | "length" | "refusal" | "other" = "other";
    const calls: AskCall[] = [];
    for await (const event of options.stream(
      { ...options.request, ...(completing ? { toolChoice: "none" as const } : {}), messages: turn.messages() },
      signal,
    )) {
      if (event.type === "text") {
        text += event.text;
        hasText ||= !!event.text.trim();
        yield event;
      } else if (event.type === "call") calls.push(event.call);
      else {
        stop = event.stop;
        turn.record(event.usage);
        if (event.usage) yield { type: "usage", usage: event.usage };
      }
    }
    const content: AskBlock[] = [
      ...(text.trim() ? [{ type: "text" as const, text }] : []),
      ...calls,
    ];
    if (content.length) turn.push({ role: "assistant", content });
    if (completing) {
      if (calls.length) throw new ProviderError("protocol", "模型在补充说明时仍调用工具，本轮未完成");
      if (!hasText) throw new ProviderError("empty", "模型未补充回复说明，本轮未完成");
      yield { type: "done", reason: stop === "length" ? "length" : final ? "final" : "end" };
      return;
    }
    if (!calls.length) {
      if (!hasText) {
        if (!turn.budget.toolCalls) throw new ProviderError("empty");
        complete();
        continue;
      }
      yield { type: "done", reason: stop === "length" ? "length" : "end" };
      return;
    }
    const results: AskResult[] = [];
    for (const call of calls) {
      signal.throwIfAborted();
      const entry = tools.get(call.name);
      yield {
        type: "tool-start",
        id: call.id,
        name: call.name,
        verb: entry?.verb ?? "调用",
        object: entry ? entry.object(call.input) : call.name,
      };
      let result: AskResult,
        stat = "",
        toolReason: string | undefined,
        picks: readonly string[] | undefined,
        draft: Draft | undefined;
      if (final) result = failure(call.id, "本轮草稿已提交，后续工具未执行。");
      else if (++turn.budget.toolCalls > LIMITS.toolCalls)
        result = failure(call.id, `本轮工具调用已达上限（${LIMITS.toolCalls} 次），请直接基于已有信息回答。`);
      else if (!entry) result = failure(call.id, `没有名为 ${call.name} 的工具。`);
      else
        try {
          const outcome = await entry.run(call.input, context);
          result = { type: "result", id: call.id, content: outcome.content, ...(outcome.error ? { error: true } : {}) };
          signal.throwIfAborted();
          stat = outcome.stat ?? "";
          toolReason = outcome.reason;
          picks = outcome.picks;
          draft = outcome.draft;
          final ||= !!entry.final && !outcome.error;
        } catch (error) {
          signal.throwIfAborted();
          result = failure(call.id, error instanceof Error ? error.message : "工具执行失败");
        }
      results.push(result);
      const reason = toolReason ?? (result.error ? result.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim() || "工具执行失败" : undefined);
      yield { type: "tool-end", id: call.id, ok: !result.error, stat, ...(reason ? { reason } : {}), ...(picks ? { picks } : {}), ...(draft ? { draft } : {}) };
    }
    turn.push({ role: "user", content: results });
    if (final) {
      if (!hasText) {
        complete();
        continue;
      }
      yield { type: "done", reason: "final" };
      return;
    }
  }
}
