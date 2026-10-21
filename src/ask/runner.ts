import { ProviderError } from "./messages.ts";
import type { AskBlock, AskCall, AskEvent, AskRequest, AskResult, AskUsage } from "./messages.ts";
import { LIMITS } from "./session.ts";
import type { Turn } from "./session.ts";
import type { ToolContext, ToolRegistry } from "./tools.ts";

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
 * (the draft, A2) ends the turn. Errors propagate: the caller rolls back.
 */
export async function* run(options: RunOptions): AsyncGenerator<RunEvent, void> {
  const { turn, tools, context, signal } = options;
  while (true) {
    signal.throwIfAborted();
    if (++turn.budget.requests > LIMITS.requests)
      throw new ProviderError("protocol", "模型超出本轮工具调用上限");
    let text = "",
      stop: "end" | "tool" | "length" | "refusal" | "other" = "other";
    const calls: AskCall[] = [];
    for await (const event of options.stream(
      { ...options.request, messages: turn.messages() },
      signal,
    )) {
      if (event.type === "text") {
        text += event.text;
        yield event;
      } else if (event.type === "call") calls.push(event.call);
      else {
        stop = event.stop;
        turn.record(event.usage);
        if (event.usage) yield { type: "usage", usage: event.usage };
      }
    }
    const content: AskBlock[] = [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...calls,
    ];
    turn.push({ role: "assistant", content });
    if (!calls.length) {
      yield { type: "done", reason: stop === "length" ? "length" : "end" };
      return;
    }
    const results: AskResult[] = [];
    let final = false;
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
        stat = "";
      if (++turn.budget.toolCalls > LIMITS.toolCalls)
        result = failure(call.id, `本轮工具调用已达上限（${LIMITS.toolCalls} 次），请直接基于已有信息回答。`);
      else if (!entry) result = failure(call.id, `没有名为 ${call.name} 的工具。`);
      else
        try {
          const outcome = await entry.run(call.input, context);
          result = { type: "result", id: call.id, content: outcome.content, ...(outcome.error ? { error: true } : {}) };
          stat = outcome.stat ?? "";
          final ||= !!entry.final && !outcome.error;
        } catch (error) {
          signal.throwIfAborted();
          result = failure(call.id, error instanceof Error ? error.message : "工具执行失败");
        }
      results.push(result);
      yield { type: "tool-end", id: call.id, ok: !result.error, stat };
    }
    turn.push({ role: "user", content: results });
    if (final) {
      yield { type: "done", reason: "final" };
      return;
    }
  }
}
