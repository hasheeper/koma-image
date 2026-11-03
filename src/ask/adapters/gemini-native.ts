import { object } from "../../domain/value.ts";
import { canonical, sortKeys } from "../canonical.ts";
import { classify, ProviderError, reportedCount } from "../messages.ts";
import type { AskCall, AskImage, AskRequest, AskResult, AskStop, AskText, AskUsage, CacheUsage } from "../messages.ts";
import type { ResponseEvent } from "../response-stream.ts";
import type { SseEvent } from "./sse.ts";

type Part = Readonly<Record<string, unknown>>;
const part = (block: AskText | AskImage): Part => block.type === "text"
  ? { text: block.text } : { inlineData: { mimeType: block.mime, data: block.data } };
const resultText = (result: AskResult) => result.content.flatMap(b => b.type === "text" ? [b.text] : []).join("\n\n");

/** Native parts retain their order and signatures, including the optional prose envelope.
 * Cross-model/protocol history becomes a transcript: foreign tool calls have no valid
 * Gemini signatures. Only new calls made by the selected model use functionResponse. */
export function body(request: AskRequest): Record<string, unknown> {
  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  let pending: { id?: string; call: Record<string, unknown> }[] = [];
  const append = (role: "user" | "model", parts: readonly Part[]) => {
    if (!parts.length) return;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  };
  function answers(results: readonly AskResult[]) {
    const out: Part[] = [], used = new Set<string>();
    for (const entry of pending) {
      const result = results.find(r => r.id === entry.id);
      if (!result && (entry.id || entry.call.name !== "submit_response")) throw new ProviderError("protocol", "工具调用缺少对应结果");
      if (result) used.add(result.id);
      out.push({ functionResponse: {
        ...(typeof entry.call.id === "string" ? { id: entry.call.id } : {}), name: entry.call.name,
        response: result ? { [result.error ? "error" : "output"]: resultText(result) } : { output: "已显示正文" },
      } });
    }
    // Images are ordinary user parts for compatibility with older Gemini models.
    for (const result of results) {
      if (!used.has(result.id)) out.push({ text: `tool_result ${result.id}\n${resultText(result)}` });
      const images = result.content.filter(b => b.type === "image");
      if (images.length) out.push({ text: `tool_result ${result.id}` }, ...images.map(part));
    }
    pending = [];
    return out;
  }
  for (const message of request.messages) {
    if (message.role === "assistant") {
      if (pending.length) append("user", answers([]));
      if (message.gemini?.model === request.model) {
        append("model", message.gemini.parts);
        const calls = message.content.filter(b => b.type === "call");
        let index = 0;
        pending = message.gemini.parts.filter(p => p.functionCall).map(p => {
          const call = object(p.functionCall);
          return { call, ...(calls[index]?.name === call.name ? { id: calls[index++]?.id } : {}) };
        });
      } else append("model", message.content.flatMap(b => b.type === "call"
        ? [{ text: `tool_call ${b.id} ${b.name}\n${canonical(b.input)}` }]
        : b.type === "text" ? [part(b)] : []));
    } else {
      const results = message.content.filter(b => b.type === "result");
      append("user", [...answers(results), ...message.content.flatMap(b => b.type === "text" || b.type === "image" ? [part(b)] : [])]);
    }
  }
  if (pending.length) append("user", answers([]));
  return {
    ...(request.tools.length ? { tools: [{ functionDeclarations: request.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: sortKeys(t.schema) })) }] } : {}),
    ...(request.toolChoice ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
    systemInstruction: { parts: request.system.filter(Boolean).map(text => ({ text })) },
    generationConfig: { maxOutputTokens: request.maxTokens, responseModalities: ["TEXT"] },
    contents,
  };
}

const count = (value: unknown) => reportedCount(value) ?? 0;
const stops: Readonly<Record<string, AskStop>> = {
  STOP: "end", MAX_TOKENS: "length", SAFETY: "refusal", RECITATION: "refusal", BLOCKLIST: "refusal",
  PROHIBITED_CONTENT: "refusal", SPII: "refusal", IMAGE_SAFETY: "refusal",
};
/** streamGenerateContent sends complete functionCall objects, not Chat argument deltas. */
export function reader(unwrapResponse = false, model = "") {
  const parts: Part[] = [], calls: AskCall[] = [];
  let stop: AskStop | null = null, used: AskUsage | null = null, finished = false;
  let cacheUsage: CacheUsage = { read: null, write: null };
  return {
    get cacheUsage() { return cacheUsage; },
    read(event: SseEvent): ResponseEvent[] {
      if (finished) return [];
      let chunk: Record<string, unknown>;
      try { chunk = object(JSON.parse(event.data)); } catch { throw new ProviderError("protocol"); }
      if (chunk.error) throw classify(Number(object(chunk.error).code) || 0, chunk);
      if (chunk.usageMetadata) {
        const u = object(chunk.usageMetadata);
        if ([u.promptTokenCount, u.candidatesTokenCount, u.thoughtsTokenCount].some(v => reportedCount(v) !== null))
          used = { input: count(u.promptTokenCount), output: count(u.candidatesTokenCount) + count(u.thoughtsTokenCount), cacheRead: count(u.cachedContentTokenCount), cacheWrite: 0 };
        cacheUsage = { read: reportedCount(u.cachedContentTokenCount), write: null };
      }
      if (object(chunk.promptFeedback).blockReason) stop = "refusal";
      const candidates = Array.isArray(chunk.candidates) ? chunk.candidates : [];
      const candidate = object(candidates.find(c => object(c).index === 0) ?? candidates[0]);
      const content = object(candidate.content), incoming = Array.isArray(content.parts) ? content.parts : [];
      const out: ResponseEvent[] = [];
      for (const raw of incoming) {
        const p = object(raw);
        // Keep signed text boundaries intact. Thought summaries are never emitted as prose.
        const saved: Record<string, unknown> = {};
        for (const key of ["text", "thought", "thoughtSignature", "functionCall"])
          if (Object.hasOwn(p, key)) saved[key] = p[key];
        if (Object.keys(saved).length) parts.push(saved);
        if (p.thought === true) continue;
        if (typeof p.text === "string" && p.text) out.push({ type: "text", text: p.text });
        if (p.functionCall) {
          const fn = object(p.functionCall);
          if (typeof fn.name !== "string" || !fn.name || (fn.args !== undefined && (!fn.args || typeof fn.args !== "object" || Array.isArray(fn.args))))
            throw new ProviderError("protocol", "工具参数无法解析");
          const id = typeof fn.id === "string" && fn.id ? fn.id : `gemini_${crypto.randomUUID()}`;
          if (unwrapResponse && fn.name === "submit_response") {
            const text = object(fn.args).content;
            if (typeof text === "string") out.push({ type: "response-text", id, text });
          } else calls.push({ type: "call", id, name: fn.name, input: object(fn.args) });
        }
        if (p.inlineData || p.fileData) throw new ProviderError("protocol", "ASK 需要文字回复，模型返回了媒体内容");
      }
      if (typeof candidate.finishReason === "string" && candidate.finishReason) {
        if (["MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "TOO_MANY_TOOL_CALLS", "MISSING_THOUGHT_SIGNATURE"].includes(candidate.finishReason))
          throw new ProviderError("protocol", "模型返回的工具调用无效");
        stop = stops[candidate.finishReason] ?? "other";
      }
      return out;
    },
    end(): ResponseEvent[] {
      if (finished || !stop) return [];
      finished = true;
      // A refusal or truncation must not execute even an otherwise complete tool call.
      const complete = stop === "end";
      return [
        ...(complete ? calls.map(call => ({ type: "call" as const, call })) : []),
        { type: "done", stop: complete && calls.length ? "tool" : stop, usage: used,
          ...(complete ? { gemini: { model, parts } } : {}) },
      ];
    },
  };
}
