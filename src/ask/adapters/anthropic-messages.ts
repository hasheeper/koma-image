import { sortKeys } from "../canonical.ts";
import { object } from "../../domain/value.ts";
import { classify, ProviderError } from "../messages.ts";
import type {
  AskBlock,
  AskEvent,
  AskImage,
  AskRequest,
  AskStop,
  AskText,
  AskUsage,
} from "../messages.ts";
import type { SseEvent } from "./sse.ts";

type Wire = Record<string, unknown>;
const ephemeral = { type: "ephemeral" };
const media = (b: AskText | AskImage): Wire =>
  b.type === "text"
    ? { type: "text", text: b.text }
    : { type: "image", source: { type: "base64", media_type: b.mime, data: b.data } };
function block(b: AskBlock): Wire {
  if (b.type === "call")
    return { type: "tool_use", id: b.id, name: b.name, input: sortKeys(b.input) };
  if (b.type === "result")
    return {
      type: "tool_result",
      tool_use_id: b.id,
      ...(b.content.length ? { content: b.content.map(media) } : {}),
      ...(b.error ? { is_error: true } : {}),
    };
  return media(b);
}
// Empty text blocks are rejected upstream; results lead a user message.
const usable = (b: AskBlock) => b.type !== "text" || b.text !== "";
const rank = (b: AskBlock) => (b.type === "result" ? 0 : 1);
const marked = (items: Wire[]) =>
  items.map((item, i) => (i === items.length - 1 ? { ...item, cache_control: ephemeral } : item));
/**
 * Breakpoints: #1 the last tool, #2 the last system block, #3 the last block
 * of the newest message, so each tool step extends the cached prefix.
 */
export function body(request: AskRequest): Wire {
  const messages = request.messages.map((m) => ({
    role: m.role,
    content: (m.role === "user" ? [...m.content].sort((a, b) => rank(a) - rank(b)) : m.content)
      .filter(usable)
      .map(block),
  }));
  const system = request.system.filter(Boolean).map((text) => ({ type: "text", text })),
    last = messages.at(-1);
  if (last) last.content = marked(last.content);
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    stream: true,
    ...(request.tools.length
      ? {
          tools: marked(
            request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: sortKeys(t.schema) })),
          ),
        }
      : {}),
    ...(system.length ? { system: marked(system) } : {}),
    messages,
  };
}
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const stops: Record<string, AskStop> = {
  end_turn: "end",
  stop_sequence: "end",
  tool_use: "tool",
  max_tokens: "length",
  refusal: "refusal",
};
export function reader() {
  const blocks = new Map<number, { id: string; name: string; json: string; input?: Record<string, unknown> }>();
  let stop: AskStop | null = null,
    started = false,
    finished = false;
  const tally = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  // message_start carries input counts; message_delta updates the cumulative ones.
  function record(value: unknown) {
    const u = object(value);
    if (u.input_tokens !== undefined) tally.input = count(u.input_tokens);
    if (u.output_tokens !== undefined) tally.output = count(u.output_tokens);
    if (u.cache_read_input_tokens !== undefined) tally.cacheRead = count(u.cache_read_input_tokens);
    if (u.cache_creation_input_tokens !== undefined) tally.cacheWrite = count(u.cache_creation_input_tokens);
  }
  const usage = (): AskUsage | null =>
    started ? { ...tally, input: tally.input + tally.cacheRead + tally.cacheWrite } : null;
  function finish(): AskEvent[] {
    finished = true;
    return [{ type: "done", stop: stop ?? "other", usage: usage() }];
  }
  return {
    read(event: SseEvent): AskEvent[] {
      if (finished) return [];
      let data: Record<string, unknown>;
      try {
        data = object(JSON.parse(event.data));
      } catch {
        throw new ProviderError("protocol");
      }
      const type = typeof data.type === "string" ? data.type : event.event;
      if (type === "error") throw classify(0, data);
      if (type === "message_start") {
        started = true;
        record(object(data.message).usage);
        return [];
      }
      const index = count(data.index);
      if (type === "content_block_start") {
        const b = object(data.content_block);
        if (b.type === "tool_use") {
          const input = object(b.input);
          blocks.set(index, {
            id: typeof b.id === "string" ? b.id : `call_${index}`,
            name: typeof b.name === "string" ? b.name : "",
            json: "",
            ...(Object.keys(input).length ? { input } : {}),
          });
        } else if (b.type === "text" && typeof b.text === "string" && b.text)
          return [{ type: "text", text: b.text }];
        return [];
      }
      if (type === "content_block_delta") {
        const d = object(data.delta);
        if (d.type === "text_delta" && typeof d.text === "string" && d.text)
          return [{ type: "text", text: d.text }];
        if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
          const b = blocks.get(index);
          if (b) b.json += d.partial_json;
        }
        return [];
      }
      if (type === "content_block_stop") {
        const b = blocks.get(index);
        if (!b) return [];
        blocks.delete(index);
        let input = b.input ?? {};
        if (b.json)
          try {
            input = object(JSON.parse(b.json));
          } catch {
            throw new ProviderError("protocol", "工具参数无法解析");
          }
        if (!b.name) throw new ProviderError("protocol", "工具调用缺少名称");
        return [{ type: "call", call: { type: "call", id: b.id, name: b.name, input } }];
      }
      if (type === "message_delta") {
        const reason = object(data.delta).stop_reason;
        if (typeof reason === "string") stop = stops[reason] ?? "other";
        record(data.usage);
        return [];
      }
      if (type === "message_stop") return finish();
      return [];
    },
    /** A stop reason without message_stop still ends the turn. */
    end(): AskEvent[] {
      return !finished && stop ? finish() : [];
    },
  };
}
