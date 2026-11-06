import { ProviderError } from "./messages.ts";
import type { AskBlock, AskCall, AskEvent, AskRequest, AskResult, AskUsage, GeminiReplay } from "./messages.ts";
import { LIMITS } from "./session.ts";
import type { Turn } from "./session.ts";
import type { ToolContext, ToolOutcome, ToolRegistry } from "./tools.ts";
import type { Draft } from "./draft/types.ts";
import { withToolResponse } from "./prompts/response.ts";

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
  readonly responseMode?: "text" | "tool";
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
 * the request only ever grows at the end. Frozen successful reads can be reused.
 * Exhausting the ordinary budget leaves one draft/answer round and one prose
 * completion. Errors propagate: caller rolls back.
 */
export async function* run(options: RunOptions): AsyncGenerator<RunEvent, void> {
  const { turn, tools, context, signal } = options;
  const request = options.responseMode === "tool" ? withToolResponse(options.request) : options.request;
  const reused = new Map<string, ToolOutcome>();
  let final = false, completing = false, finishing = false, reservedDraftUsed = false;
  const complete = () => {
    completing = true;
    turn.push({ role: "user", content: [{ type: "text", text: final
      ? "草稿已提交，尚未应用。请仅用 1–2 句说明这份草稿改了什么，交给用户核对；不要再调用工具。"
      : "本轮工具阶段已结束。请基于已取得的信息给出最终答复，交代结论、原因和未完成事项；前面的过程说明不算最终答复。未能确认的内容如实说明，不要再调用工具。" }] });
  };
  while (true) {
    signal.throwIfAborted();
    if (turn.budget.requests >= LIMITS.requests)
      throw new ProviderError("protocol", "模型超出本轮工具调用上限");
    turn.budget.requests++;
    let text = "",
      stop: "end" | "tool" | "length" | "refusal" | "other" = "other";
    const calls: AskCall[] = [];
    let gemini: GeminiReplay | undefined;
    for await (const event of options.stream(
      { ...request, ...(completing ? { toolChoice: "none" as const } : {}), messages: turn.messages() },
      signal,
    )) {
      if (event.type === "text") {
        text += event.text;
        yield event;
      } else if (event.type === "call") calls.push(event.call);
      else {
        stop = event.stop;
        gemini = event.gemini;
        turn.record(event.usage);
        if (event.usage) yield { type: "usage", usage: event.usage };
      }
    }
    const content: AskBlock[] = [
      ...(text.trim() ? [{ type: "text" as const, text }] : []),
      ...calls,
    ];
    if (content.length) turn.push({ role: "assistant", content, ...(gemini ? { gemini } : {}) });
    if (completing) {
      if (calls.length) throw new ProviderError("protocol", "模型在补充说明时仍调用工具，本轮未完成");
      if (!text.trim()) throw new ProviderError("empty", "模型未补充回复说明，本轮未完成");
      yield { type: "done", reason: stop === "length" ? "length" : final ? "final" : "end" };
      return;
    }
    if (!calls.length) {
      if (!text.trim()) {
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
      const key = entry?.reuseKey ? `${call.name}:${entry.reuseKey(call.input)}` : undefined;
      const cached = key === undefined ? undefined : reused.get(key);
      const limited = finishing || turn.budget.toolCalls >= LIMITS.toolCalls;
      const blocked = final || (limited && (!entry?.final || reservedDraftUsed));
      yield {
        type: "tool-start",
        id: call.id,
        name: call.name,
        verb: cached && !blocked ? "复用" : entry?.verb ?? "调用",
        object: entry ? entry.object(call.input) : call.name,
      };
      let result: AskResult,
        stat = "",
        toolReason: string | undefined,
        picks: readonly string[] | undefined,
        draft: Draft | undefined;
      if (final) result = failure(call.id, "本轮草稿已提交，后续工具未执行。");
      else if (blocked)
        result = failure(call.id, reservedDraftUsed
          ? "本轮最终草稿机会已使用，请基于已有结果说明结论和未完成事项，不再调用工具。"
          : "本轮读取阶段已结束，请基于已有结果答复；如需修改，可提交最终草稿，不再调用读取工具。");
      else {
        if (!cached) turn.budget.toolCalls++;
        if (limited && entry?.final) reservedDraftUsed = true;
        if (!entry) result = failure(call.id, `没有名为 ${call.name} 的工具。`);
        else try {
          const outcome = cached ?? await entry.run(call.input, context);
          signal.throwIfAborted();
          if (key !== undefined && !outcome.error) reused.set(key, outcome);
          result = { type: "result", id: call.id, content: cached
            ? [...outcome.content, { type: "text", text: "相同输入已在本轮取得结果，以上为复用内容。请据此继续答复或提交草稿，无需再次检查。" }]
            : outcome.content, ...(outcome.error ? { error: true } : {}) };
          stat = cached ? "沿用本轮结果" : outcome.stat ?? "";
          toolReason = outcome.reason;
          picks = outcome.picks;
          draft = outcome.draft;
          final ||= !!entry.final && !outcome.error;
        } catch (error) {
          signal.throwIfAborted();
          result = failure(call.id, error instanceof Error ? error.message : "工具执行失败");
        }
      }
      results.push(result);
      const reason = toolReason ?? (result.error ? result.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim() || "工具执行失败" : undefined);
      yield { type: "tool-end", id: call.id, ok: !result.error, stat, ...(reason ? { reason } : {}), ...(picks ? { picks } : {}), ...(draft ? { draft } : {}) };
    }
    turn.push({ role: "user", content: results });
    if (final) {
      if (!text.trim()) {
        complete();
        continue;
      }
      yield { type: "done", reason: "final" };
      return;
    }
    if (finishing || reservedDraftUsed) complete();
    else if (turn.budget.toolCalls >= LIMITS.toolCalls || turn.budget.requests >= LIMITS.requests - 2) {
      finishing = true;
      turn.push({ role: "user", content: [{ type: "text", text: "本轮读取阶段已结束。请直接基于已有结果给出最终答复；如果用户需要修改，仍可调用一次 propose_draft 提交最终草稿，然后说明改动。不要再调用读取或检查工具，未完成事项请如实说明。" }] });
    }
  }
}
