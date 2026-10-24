import { profileFor, profilePath } from "../gateway/profile.ts";
import type { GatewayProfile } from "../gateway/profile.ts";
import { createTransport } from "../gateway/transport.ts";
import type { ConnectionContext } from "../services/connections.ts";
import { identityCodec } from "./codec.ts";
import type { Codec } from "./codec.ts";
import { classify, ProviderError } from "./messages.ts";
import type { AskBlock, AskEvent, AskRequest, AskStop, AskUsage, CacheUsage } from "./messages.ts";
import { createSseParser } from "./adapters/sse.ts";
import * as openaiChat from "./adapters/openai-chat.ts";
import * as anthropicMessages from "./adapters/anthropic-messages.ts";

export * from "./messages.ts";
const adapterFor = (profile: GatewayProfile) => {
  if (profile.protocol === "openai-chat") return openaiChat;
  if (profile.protocol === "anthropic-messages") return anthropicMessages;
  throw new ProviderError("config", "该连接不支持 ASK");
};
/**
 * The codec runs only here, at the network edge: every outbound string is
 * encoded and the codebook closes system block 2. Pure, so equal requests
 * still give equal bytes.
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
    system: [codec.encode(request.system[0]), [preferences, codec.table()].filter(Boolean).join("\n\n")],
    messages: request.messages.map((m) => ({ ...m, content: m.content.map(encode) })),
  };
}
/** The exact JSON body for a reasoning profile; tests compare these bytes. */
export const wireBody = (profile: GatewayProfile, request: AskRequest, codec: Codec = identityCodec) =>
  adapterFor(profile).body(encodeRequest(request, codec));

export type ProviderTrace =
  | { readonly type: "request"; readonly body: string }
  | { readonly type: "response"; readonly stop: AskStop; readonly usage: AskUsage | null; readonly cache: CacheUsage };

async function errorBody(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text.slice(0, 64 * 1024)) as unknown;
  } catch {
    return null;
  }
}
/** One connection, streamed turns. Nothing here retries; the user decides. */
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
        if (typeof init?.body === "string") observe?.({ type: "request", body: init.body });
        return fetcher(url, init);
      });
      let response: Response;
      try {
        response = await transport.request(profilePath(profile, "reasoning"), {
          body: adapter.body(encodeRequest(request, codec)),
          signal: linked,
          stream: true,
        });
      } catch (error) {
        throw failed(error);
      }
      if (!response.ok) throw classify(response.status, await errorBody(response));
      if ((response.headers.get("content-type") || "").includes("application/json")) {
        const data = await errorBody(response);
        throw data && typeof data === "object" && "error" in data
          ? classify(response.status, data)
          : new ProviderError("protocol", "服务没有返回流式结果");
      }
      if (!response.body) throw new ProviderError("protocol", "服务没有返回流式结果");
      reader = response.body.getReader();
      if (linked.aborted) cancel();
      const decoder = new TextDecoder(),
        parser = createSseParser(),
        events = adapter.reader(),
        text = codec.stream();
      let output = false,
        done = false;
      // Text is decoded through the codec before it leaves; calls flush it first.
      function handle(event: AskEvent): AskEvent[] {
        if (event.type === "text") {
          const t = text.push(event.text);
          if (t) output = true;
          return t ? [{ type: "text", text: t }] : [];
        }
        const rest = text.flush(),
          out: AskEvent[] = rest ? [{ type: "text", text: rest }] : [];
        if (rest) output = true;
        if (event.type === "call") {
          output = true;
          return [...out, { type: "call", call: { ...event.call, input: codec.decodeDeep(event.call.input) } }];
        }
        observe?.({ type: "response", stop: event.stop, usage: event.usage, cache: events.cacheUsage });
        if (event.stop === "refusal") throw new ProviderError("rejected", "模型拒绝了这次请求");
        // Post-tool continuation and compaction validate empty replies themselves.
        // Still emit usage; incomplete streams remain errors.
        if (!output && !allowEmpty) throw new ProviderError("empty");
        done = true;
        return [...out, event];
      }
      const drain = (chunk: string) =>
        parser.push(chunk).flatMap((e) => events.read(e)).flatMap(handle);
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
        yield* drain(decoder.decode(chunk.value, { stream: true }));
      }
      if (!done) {
        yield* drain(decoder.decode());
        if (!done) yield* [...parser.end().flatMap((e) => events.read(e)), ...events.end()].flatMap(handle);
      }
      if (!done) throw new ProviderError(output ? "network" : "empty");
    } finally {
      clearTimeout(timer);
      linked.removeEventListener("abort", cancel);
      cancel();
    }
  }
  return { profile, stream };
}
