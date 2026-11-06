import { profileFor, profilePath, OPENAI_SHARED_PROFILE_ID } from "../gateway/profile.ts";
import type { GatewayProfile } from "../gateway/profile.ts";
import { createTransport } from "../gateway/transport.ts";
import type { ConnectionContext } from "../services/connections.ts";
import { identityCodec } from "./codec.ts";
import type { Codec } from "./codec.ts";
import { classify, ProviderError } from "./messages.ts";
import type { AskBlock, AskEvent, AskRequest, AskStop, AskUsage, CacheUsage, ResponseDiagnostics } from "./messages.ts";
import { createSseParser } from "./adapters/sse.ts";
import type { SseEvent } from "./adapters/sse.ts";
import * as openaiChat from "./adapters/openai-chat.ts";
import * as geminiNative from "./adapters/gemini-native.ts";
import * as anthropicMessages from "./adapters/anthropic-messages.ts";
import type { ResponseEvent } from "./response-stream.ts";

export * from "./messages.ts";
const adapterFor = (profile: GatewayProfile) => {
  if (profile.protocol === "openai-chat" || profile.id === OPENAI_SHARED_PROFILE_ID) return openaiChat;
  if (profile.protocol === "anthropic-messages") return anthropicMessages;
  if (profile.protocol === "gemini-native" && profile.reasoning) return geminiNative;
  throw new ProviderError("config", "该连接不支持 ASK");
};
/**
 * The codec runs only here, at the network edge: text and argument values are
 * encoded, with static notation guidance at the end of system block 2. Local
 * dictionaries never leave this boundary. Equal requests still give equal bytes.
 */
export function encodeRequest(request: AskRequest, codec: Codec): AskRequest {
  if (!codec.active) return request;
  const encode = (b: AskBlock): AskBlock =>
    b.type === "text" ? { ...b, text: codec.encode(b.text) }
      : b.type === "call" ? { ...b, input: codec.encodeDeep(b.input) }
        : b.type === "result" ? { ...b, content: b.content.map((c) => (c.type === "text" ? { ...c, text: codec.encode(c.text) } : c)) }
          : b;
  const preferences = codec.encode(request.system[1]);
  return {
    ...request,
    system: [codec.encode(request.system[0]), [preferences, codec.instructions()].filter(Boolean).join("\n\n")],
    messages: request.messages.map((m) => ({ ...m, content: m.content.map(encode) })),
  };
}
/** The exact, checked JSON body shared by previews and actual dispatch. */
export function wireBody(profile: GatewayProfile, request: AskRequest, codec: Codec = identityCodec) {
  const body = adapterFor(profile).body(encodeRequest(request, codec));
  if (codec.active) {
    const containsOriginal = (value: unknown): boolean => {
      if (typeof value === "string") return codec.containsOriginal(value);
      if (Array.isArray(value)) return value.some(containsOriginal);
      return !!value && typeof value === "object" && Object.entries(value).some(([key, item]) =>
        codec.containsOriginal(key) || containsOriginal(item));
    };
    // Never rewrite protocol identifiers or signed Gemini parts. Fail before fetch
    // if those fields, a replacement target, or any other payload still has originals.
    // Gemini places the model in its URL, so check it even when absent from the body.
    if (codec.containsOriginal(request.model) || containsOriginal(body))
      throw new ProviderError("config", "请求仍含启用词表或替换规则的原词，已停止发送。请检查替换目标、协议字段或历史记录。");
  }
  return body;
}

export type ProviderTrace =
  | { readonly type: "request"; readonly body: string }
  | { readonly type: "response"; readonly stop: AskStop; readonly usage: AskUsage | null; readonly cache: CacheUsage; readonly response: ResponseDiagnostics };

async function errorBody(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text.slice(0, 64 * 1024)) as unknown;
  } catch {
    return null;
  }
}
/** One dispatch per stream; failed responses are never retried automatically. */
export function createProvider(
  context: ConnectionContext,
  fetcher: typeof fetch = fetch,
  options: { idleMs?: number } = {},
) {
  const profile = profileFor(context.connection.profileId),
    adapter = adapterFor(profile),
    idleMs = options.idleMs ?? 90_000;
  async function* stream(
    request: AskRequest,
    { codec = identityCodec, signal, observe, allowEmpty = false }: { codec?: Codec; signal?: AbortSignal; observe?: (event: ProviderTrace) => void; allowEmpty?: boolean } = {},
  ): AsyncGenerator<AskEvent, void, undefined> {
    const idle = new AbortController(),
      linked = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
    let timer: ReturnType<typeof setTimeout> | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const unwrapResponse = request.tools.some(tool => tool.name === "submit_response"), text = codec.stream();
    const events = profile.protocol === "gemini-native" ? geminiNative.reader(unwrapResponse, request.model) : adapter.reader(unwrapResponse);
    let dispatched = false, reported = false, status: number | null = null, contentType: string | null = null;
    let bytes = 0, frames = 0, textChars = 0, callCount = 0;
    // Only retain a bounded machine code, never an arbitrary upstream payload.
    const finishReason = () => events.finishReason === null ? null
      : /^[\w.-]{1,100}$/.test(events.finishReason) ? events.finishReason : "unrecognized";
    function report(stop = events.stopReason ?? "other", usage = events.usage) {
      if (!dispatched || reported) return;
      reported = true;
      observe?.({ type: "response", stop, usage, cache: events.cacheUsage,
        response: { httpStatus: status, contentType, bytes, events: frames, textChars, calls: callCount, finishReason: finishReason() } });
    }
    let ordinary = "", responseId: string | undefined;
    const leading = new Map<string, string>();
    const fallback = (): AskEvent[] => {
      const decoded = responseId === undefined ? text.push(ordinary) : "";
      ordinary = "";
      const rest = decoded + text.flush();
      return rest ? [{ type: "text", text: rest }] : [];
    };
    // Silence for idleMs ends the turn; every received chunk re-arms it.
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(new ProviderError("timeout")), idleMs);
    };
    const cancel = () => void reader?.cancel().catch(() => {});
    linked.addEventListener("abort", cancel);
    const failed = (error: unknown) =>
      linked.aborted ? linked.reason : error instanceof ProviderError ? error
        : new ProviderError("network", error instanceof Error ? error.message : "");
    arm();
    try {
      // Observe the serialized body at dispatch, after codec/protocol conversion.
      // Headers, credentials and upstream addresses never enter the trace.
      const transport = createTransport(context, profile, (url, init) => {
        dispatched = true;
        if (typeof init?.body === "string") observe?.({ type: "request", body: init.body });
        return fetcher(url, init);
      });
      let response: Response;
      try {
        response = await transport.request(profilePath(profile, "reasoning"), {
          body: wireBody(profile, request, codec),
          signal: linked,
          stream: true,
          model: request.model,
        });
      } catch (error) {
        throw failed(error);
      }
      status = response.status;
      contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || null;
      if (!response.ok) throw classify(response.status, await errorBody(response));
      if (contentType === "application/json") {
        const data = await errorBody(response);
        throw data && typeof data === "object" && "error" in data
          ? classify(response.status, data)
          : new ProviderError("protocol", "服务没有返回流式结果");
      }
      if (!response.body) throw new ProviderError("protocol", "服务没有返回流式结果");
      reader = response.body.getReader();
      if (linked.aborted) cancel();
      const decoder = new TextDecoder(),
        parser = createSseParser();
      let output = false,
        done = false;
      // Only normalized prose leaves this boundary; the envelope never reaches history.
      function handle(event: ResponseEvent): AskEvent[] {
        if (event.type === "response-text") {
          textChars += event.text.length;
          let chunk = event.text;
          if (responseId === undefined) {
            chunk = (leading.get(event.id) ?? "") + chunk;
            leading.set(event.id, chunk);
            if (!chunk.trim()) return [];
            responseId = event.id;
            leading.clear();
          }
          if (event.id !== responseId) return [];
          const decoded = text.push(chunk);
          if (decoded) output = true;
          return decoded ? [{ type: "text", text: decoded }] : [];
        }
        if (event.type === "text") {
          textChars += event.text.length;
          if (unwrapResponse) { ordinary += event.text; output ||= !!event.text; return []; }
          const t = text.push(event.text);
          if (t) output = true;
          return t ? [{ type: "text", text: t }] : [];
        }
        const out: AskEvent[] = event.type === "done" ? fallback() : [];
        if (event.type === "call" && !unwrapResponse) {
          const rest = text.flush();
          if (rest) out.push({ type: "text", text: rest });
        }
        if (out.length) output = true;
        if (event.type === "call") {
          callCount++;
          output = true;
          return [...out, { type: "call", call: { ...event.call, input: codec.decodeDeep(event.call.input) } }];
        }
        report(event.stop, event.usage);
        if (event.stop === "refusal") throw new ProviderError("rejected", "模型拒绝了这次请求");
        if (!output && event.stop === "length") throw new ProviderError("empty", "上游达到输出上限，但未返回正文；请检查渠道的输出或思考预算");
        if (!output && event.stop === "tool") throw new ProviderError("protocol", "上游标记了工具调用结束，但未返回可执行的工具调用");
        if (!output && event.stop === "other") {
          throw new ProviderError("protocol", `上游已结束响应，但未收到可识别的正文或工具调用${finishReason() ? `（结束原因：${finishReason()}）` : "（未提供结束原因）"}`);
        }
        // Post-tool continuation and compaction validate empty replies themselves.
        // Still emit usage; incomplete streams remain errors.
        if (!output && !allowEmpty) throw new ProviderError("empty", "模型没有返回内容（上游正常结束，但正文与工具调用均为空）");
        done = true;
        return [...out, event];
      }
      // Deliver each SSE frame before parsing the next. A later error in the
      // same network chunk must not swallow already received answer text.
      function* drain(incoming: SseEvent[]): Generator<AskEvent> {
        for (const frame of incoming) {
          frames++;
          for (const event of events.read(frame)) yield* handle(event);
          if (done) return;
        }
      }
      while (!done) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw failed(error);
        }
        if (linked.aborted) throw linked.reason;
        if (chunk.done) break;
        arm();
        bytes += chunk.value.byteLength;
        yield* drain(parser.push(decoder.decode(chunk.value, { stream: true })));
      }
      if (!done) {
        yield* drain(parser.push(decoder.decode()));
        if (!done) yield* drain(parser.end());
        if (!done) for (const event of events.end()) yield* handle(event);
      }
      if (!done) throw !bytes ? new ProviderError("network", "上游未返回响应数据，连接已结束")
        : !frames ? new ProviderError("protocol", "上游响应中没有可识别的 SSE 数据，请检查渠道返回格式")
          : new ProviderError("network", "连接中断：响应流未收到完整结束标记");
    } catch (error) {
      report();
      // If a plain reply disconnects before an envelope arrives, retain its partial text.
      yield* fallback();
      throw error;
    } finally {
      clearTimeout(timer);
      linked.removeEventListener("abort", cancel);
      cancel();
    }
  }
  const protocol = profile.protocol === "gemini-native" ? "gemini-native" : profile.protocol === "anthropic-messages" ? "anthropic-messages" : "openai-chat";
  return { profile, protocol, stream } as const;
}
