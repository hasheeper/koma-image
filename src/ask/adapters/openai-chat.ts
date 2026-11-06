import { canonical, sortKeys } from "../canonical.ts";
import { object } from "../../domain/value.ts";
import { classify, ProviderError, reportedCount } from "../messages.ts";
import type { CacheUsage } from "../messages.ts";
import type {
  AskCall,
  AskImage,
  AskMessage,
  AskRequest,
  AskStop,
  AskText,
  AskUsage,
} from "../messages.ts";
import type { SseEvent } from "./sse.ts";
import { createResponseStream } from "../response-stream.ts";
import type { ResponseEvent } from "../response-stream.ts";

const url = (image: AskImage) => `data:${image.mime};base64,${image.data}`;
const parts = (blocks: readonly (AskText | AskImage)[]) =>
  blocks.map((b) =>
    b.type === "text"
      ? { type: "text", text: b.text }
      : { type: "image_url", image_url: { url: url(b) } },
  );
const plain = (blocks: readonly (AskText | AskImage)[]) =>
  blocks.every((b) => b.type === "text")
    ? blocks.map((b) => (b as AskText).text).join("\n\n")
    : parts(blocks);
function messages(message: AskMessage): Record<string, unknown>[] {
  if (message.role === "assistant") {
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
      calls = message.content.filter((b): b is AskCall => b.type === "call");
    return [
      calls.length
        ? {
            role: "assistant",
            content: text || null,
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: canonical(c.input) },
            })),
          }
        : { role: "assistant", content: text },
    ];
  }
  // Tool results answer the previous assistant turn first; chat tool messages
  // carry text only, so their images follow in a user message.
  const out: Record<string, unknown>[] = [];
  for (const b of message.content) {
    if (b.type !== "result") continue;
    const text = b.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n\n");
    out.push({ role: "tool", tool_call_id: b.id, content: text });
  }
  for (const b of message.content) {
    if (b.type !== "result" || !b.content.some((c) => c.type === "image")) continue;
    out.push({
      role: "user",
      content: [{ type: "text", text: `tool_result ${b.id}` }, ...parts(b.content.filter((c) => c.type === "image"))],
    });
  }
  const rest = message.content.filter((b): b is AskText | AskImage => b.type === "text" || b.type === "image");
  if (rest.length) out.push({ role: "user", content: plain(rest) });
  return out;
}
/**
 * Fixed key order with messages last, so consecutive requests share a byte
 * prefix. No output limit is sent: max_tokens and max_completion_tokens are
 * not accepted uniformly across compatible services.
 */
export function body(request: AskRequest): Record<string, unknown> {
  const system = request.system.filter(Boolean).join("\n\n");
  return {
    model: request.model,
    stream: true,
    stream_options: { include_usage: true },
    ...(request.tools.length
      ? {
          tools: request.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: sortKeys(t.schema) },
          })),
        }
      : {}),
    ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...request.messages.flatMap(messages),
    ],
  };
}
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
function usage(value: unknown): AskUsage | null {
  const u = object(value),
    details = object(u.prompt_tokens_details);
  if (![u.prompt_tokens, u.completion_tokens, details.cached_tokens, u.prompt_cache_hit_tokens].some(v => reportedCount(v) !== null)) return null;
  return {
    input: count(u.prompt_tokens),
    output: count(u.completion_tokens),
    cacheRead: count(details.cached_tokens ?? u.prompt_cache_hit_tokens),
    cacheWrite: 0,
  };
}
const stops: Record<string, AskStop> = {
  stop: "end",
  tool_calls: "tool",
  function_call: "tool",
  length: "length",
  content_filter: "refusal",
};
interface Pending {
  id: string;
  name: string;
  args: string;
  input?: Record<string, unknown>;
  response?: ReturnType<typeof createResponseStream>;
  offset?: number;
}
/** Tolerates relays that omit indexes or ids, repeat names, or send parsed arguments. */
export function reader(unwrapResponse = false) {
  const calls = new Map<string, Pending>();
  let stop: AskStop | null = null,
    rawStop: string | null = null,
    refused = false,
    used: AskUsage | null = null,
    finished = false;
  let cacheUsage: CacheUsage = { read: null, write: null };
  function response(key: string, call: Pending, complete = false): ResponseEvent[] {
    const decoder = call.response ??= createResponseStream();
    let text = decoder.push(call.args.slice(call.offset ?? 0));
    call.offset = call.args.length;
    if (complete) {
      let input = call.input;
      if (!input) { try { input = object(JSON.parse(call.args)); } catch { /* A length-limited envelope can still carry partial prose. */ } }
      text += decoder.finish(input?.content);
    }
    return text ? [{ type: "response-text", id: key, text }] : [];
  }
  function finish(): ResponseEvent[] {
    if (finished) return [];
    finished = true;
    const out: ResponseEvent[] = [];
    for (const [key, c] of calls) {
      if (unwrapResponse && c.name === "submit_response") { out.push(...response(key, c, true)); continue; }
      let input = c.input;
      if (!input)
        try {
          input = object(JSON.parse(c.args || "{}"));
        } catch {
          throw new ProviderError("protocol", "工具参数无法解析");
        }
      if (!c.name) throw new ProviderError("protocol", "工具调用缺少名称");
      out.push({ type: "call", call: { type: "call", id: c.id || `call_${key.replace(/\W/g, "")}`, name: c.name, input } });
    }
    out.push({ type: "done", stop: refused ? "refusal" : calls.size && stop === "end" ? "tool" : (stop ?? "other"), usage: used });
    return out;
  }
  return {
    get cacheUsage() { return cacheUsage; },
    get finishReason() { return rawStop; },
    get stopReason() { return refused ? "refusal" as const : stop; },
    get usage() { return used; },
    read(event: SseEvent): ResponseEvent[] {
      if (finished) return [];
      if (event.data.trim() === "[DONE]") return finish();
      let chunk: Record<string, unknown>;
      try {
        chunk = object(JSON.parse(event.data));
      } catch {
        throw new ProviderError("protocol");
      }
      if (chunk.error) throw classify(0, chunk);
      if (chunk.usage) {
        used = usage(chunk.usage);
        const u = object(chunk.usage), details = object(u.prompt_tokens_details);
        cacheUsage = { read: reportedCount(details.cached_tokens ?? u.prompt_cache_hit_tokens), write: null };
      }
      const choice = object(Array.isArray(chunk.choices) ? chunk.choices[0] : undefined),
        delta = object(choice.delta ?? choice.message),
        out: ResponseEvent[] = [];
      const content = Array.isArray(delta.content)
        ? delta.content.map((p) => object(p).text).filter((t) => typeof t === "string").join("")
        : delta.content;
      refused ||= typeof delta.refusal === "string" && !!delta.refusal.trim();
      if (typeof content === "string" && content) out.push({ type: "text", text: content });
      const deltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const value of deltas) {
        // Index first, then id; a bare fragment continues the latest call.
        const call = object(value),
          fn = object(call.function),
          id = typeof call.id === "string" ? call.id : "",
          key = typeof call.index === "number" ? `#${call.index}`
            : id ? ([...calls].find(([, c]) => c.id === id)?.[0] ?? id)
              : ([...calls.keys()].at(-1) ?? "#0");
        const entry: Pending = calls.get(key) ?? { id: "", name: "", args: "" };
        calls.set(key, entry);
        if (id) entry.id = id;
        if (typeof fn.name === "string" && fn.name && fn.name !== entry.name) entry.name += fn.name;
        if (typeof fn.arguments === "string") entry.args += fn.arguments;
        else if (fn.arguments && typeof fn.arguments === "object") entry.input = object(fn.arguments);
        if (unwrapResponse && entry.name === "submit_response") out.push(...response(key, entry));
      }
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        rawStop = choice.finish_reason;
        stop = stops[rawStop] ?? "other";
      }
      return out;
    },
    /** End of stream: a seen finish reason completes the turn even without [DONE]. */
    end(): ResponseEvent[] {
      return stop || refused ? finish() : [];
    },
  };
}
