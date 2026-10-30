import { object } from "../domain/value.ts";
import type { AskStop, AskUsage, CacheUsage } from "./messages.ts";

export interface CallInfo {
  /** The page conversation that made the call. */
  readonly conversation: string;
  readonly turn: number;
  readonly step: number;
  readonly question: string;
  readonly connection: string;
  readonly protocol: "openai-chat" | "anthropic-messages";
  readonly model: string;
  readonly promptVersion: string;
  readonly purpose?: "compaction";
  readonly afterCompaction?: boolean;
}
export interface CallSummary extends CallInfo {
  readonly id: number;
  readonly started: number;
  readonly ended: number | null;
  readonly bytes: number;
  readonly status: "running" | "done" | "failed" | "stopped";
  readonly usage: AskUsage | null;
  readonly cache: CacheUsage;
  readonly stop: AskStop | null;
}
export interface CallRecord extends CallSummary { readonly body: string }
export interface CallLogView { readonly calls: readonly CallSummary[]; readonly dropped: number }

/** Page-memory only; complete payloads are bounded independently of the session. */
export function createCallLog(changed: (view: CallLogView) => void, limits = { calls: 20, bytes: 16 * 1024 * 1024 }) {
  let records: CallRecord[] = [], sequence = 0, dropped = 0;
  const publish = () => changed({ calls: records.map(({ body: _body, ...summary }) => summary), dropped });
  return {
    start(info: CallInfo, body: string) {
      const id = ++sequence;
      records.push({ ...info, id, body, bytes: new TextEncoder().encode(body).length, started: Date.now(), ended: null, status: "running", usage: null, cache: { read: null, write: null }, stop: null });
      // Retain one complete oversized request rather than silently truncating it.
      let retained = records.reduce((sum, r) => sum + r.body.length * 2, 0);
      while (records.length > 1 && (records.length > limits.calls || retained > limits.bytes)) {
        retained -= records.shift()!.body.length * 2;
        dropped++;
      }
      publish();
      return id;
    },
    finish(id: number, outcome: Pick<CallSummary, "usage" | "cache" | "stop">) {
      records = records.map(r => r.id === id ? { ...r, ...outcome, ended: Date.now(), status: "done" } : r);
      publish();
    },
    fail(id: number, stopped: boolean) {
      records = records.map(r => r.id === id ? { ...r, ended: Date.now(), status: stopped ? "stopped" : "failed" } : r);
      publish();
    },
    get: (id: number) => records.find(r => r.id === id),
    previous(id: number) {
      const current = records.find(r => r.id === id);
      return current && [...records].reverse().find(r => r.id < id && r.connection === current.connection && r.protocol === current.protocol && r.model === current.model);
    },
    export(id?: number) {
      return JSON.stringify({ app: "koma-ask", kind: "call-debug", version: 1, dropped, calls: records.filter(r => id === undefined || r.id === id) }, null, 2);
    },
    clear() { records = []; dropped = 0; publish(); },
  };
}

export type PartSection = "tools" | "system" | "history" | "current";
export type PartRole = "definition" | "system" | "user" | "model" | "tool";
export interface ContextPart {
  readonly path: string;
  /** Row title; tool calls and results name their tool instead. */
  readonly name: string;
  readonly tool: string | null;
  /** One-line excerpt for the collapsed row. */
  readonly gist: string;
  readonly text: string;
  readonly section: PartSection;
  readonly role: PartRole;
  /** Wire role of a message, absent for tools and Anthropic system blocks. */
  readonly wireRole: string | null;
  /** Outbound JSON bytes, including image Base64. */
  readonly bytes: number;
  readonly images: number;
  readonly breakpoints: readonly string[];
  readonly comparison: "same" | "changed" | "new" | "none";
  readonly prefix: boolean;
}
export interface DebugImage { readonly path: string; readonly url: string; readonly bytes: number; readonly part: string; readonly source: "user" | "tool" }
const asArray = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const withoutCache = (_key: string, value: unknown) => _key === "cache_control" ? undefined : value;
const encoder = new TextEncoder();
const owner = (path: string) => /^(?:tools|system\[\d+\]|messages\[\d+\])/.exec(path)?.[0] ?? path;
const excerpt = (text: string) => text.replace(/<\/?[a-z_]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
/** The question follows the state snapshot and any `<data>` attachments. */
const asked = (text: string) => excerpt(text.slice(Math.max(0, ...["</workspace_state>", "</data>"].map(tag => { const at = text.lastIndexOf(tag); return at < 0 ? 0 : at + tag.length; }))) || text);
const texts = (content: unknown): string => typeof content === "string" ? content
  : asArray(content).map(b => { const o = object(b); return o.type === "text" && typeof o.text === "string" ? o.text : o.type === "tool_result" ? texts(o.content) : ""; }).filter(Boolean).join("\n\n");
const args = (input: unknown) => Object.entries(object(input)).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ");
// Tool results are usually a JSON object inside <data>; read them like call arguments.
function result(text: string) {
  try { const value: unknown = JSON.parse(text.trim().replace(/^<([a-z_]+)>([\s\S]*)<\/\1>$/, "$2")); if (value && typeof value === "object" && !Array.isArray(value)) return excerpt(args(value)); } catch { /* plain text result */ }
  return excerpt(text);
}
function units(body: Record<string, unknown>) {
  const out: { path: string; value: unknown }[] = [];
  if (body.tools) out.push({ path: "tools", value: body.tools });
  for (const [i, value] of asArray(body.system).entries()) out.push({ path: `system[${i}]`, value });
  for (const [i, value] of asArray(body.messages).entries()) out.push({ path: `messages[${i}]`, value });
  return out;
}
type Shape = Pick<ContextPart, "name" | "tool" | "gist" | "role" | "wireRole"> & { kind: "context" | "question" | "call" | "result" };
/** Names a unit by what it carries in either wire protocol. */
function shape(path: string, value: unknown, tools: ReadonlyMap<string, string>, compaction: boolean, last: boolean): Shape {
  if (path === "tools") return { kind: "context", name: "工具定义", tool: null, gist: `${asArray(value).length} 项`, role: "definition", wireRole: null };
  const o = object(value), wireRole = typeof o.role === "string" ? o.role : null;
  if (path.startsWith("system") || wireRole === "system") return { kind: "context", name: "系统提示词", tool: null, gist: excerpt(texts(o.content ?? [o])), role: "system", wireRole };
  const blocks = asArray(o.content).map(object);
  if (wireRole === "assistant") {
    const calls = [...asArray(o.tool_calls).map(c => { const f = object(object(c).function); let input: unknown = f.arguments; try { input = JSON.parse(String(f.arguments)); } catch { /* shown raw */ } return { name: String(f.name), input }; }),
      ...blocks.filter(b => b.type === "tool_use").map(b => ({ name: String(b.name), input: b.input }))];
    return calls.length ? { kind: "call", name: "调用", tool: calls.map(c => c.name).join(" · "), gist: args(calls[0]!.input), role: "model", wireRole }
      : { kind: "context", name: "回复", tool: null, gist: excerpt(texts(o.content)), role: "model", wireRole };
  }
  if (wireRole === "tool") return { kind: "result", name: "结果", tool: tools.get(String(o.tool_call_id)) ?? null, gist: result(texts(o.content)), role: "tool", wireRole };
  const results = blocks.filter(b => b.type === "tool_result");
  if (results.length) return { kind: "result", name: "结果", tool: results.map(b => tools.get(String(b.tool_use_id)) ?? "").filter(Boolean).join(" · ") || null, gist: result(texts(blocks)), role: "tool", wireRole };
  const text = texts(o.content), image = /^tool_result (\S+)$/.exec(String(blocks[0]?.text ?? ""));
  if (image) return { kind: "result", name: "结果图片", tool: null, gist: `${tools.get(image[1]!) ?? "tool_result"} · ${image[1]}`, role: "tool", wireRole };
  if (text.startsWith("<session_memory>")) return { kind: "context", name: "会话记忆", tool: null, gist: "压缩后冻结的记忆", role: "user", wireRole };
  if (compaction && last) return { kind: "question", name: "压缩指令", tool: null, gist: excerpt(text), role: "user", wireRole };
  return { kind: "question", name: "提问", tool: null, gist: asked(text), role: "user", wireRole };
}
/** Readable rendering only. Copy/export always use the untouched dispatch body. */
export function inspectCall(record: CallRecord, previous?: CallRecord) {
  const body = object(JSON.parse(record.body)), prior = previous ? units(object(JSON.parse(previous.body))) : [];
  const found: Omit<DebugImage, "source">[] = [], breakpoints: string[] = [];
  function walk(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`));
    if (!value || typeof value !== "object") return value;
    const o = object(value);
    if (o.cache_control) breakpoints.push(`${path}.cache_control`);
    return Object.fromEntries(Object.entries(o).map(([key, val]) => {
      const location = path ? `${path}.${key}` : key;
      const data = typeof val === "string" && key === "url" && val.startsWith("data:image/") ? val
        : key === "data" && typeof val === "string" && o.type === "base64" && typeof o.media_type === "string" ? `data:${o.media_type};base64,${val}` : null;
      if (!data) return [key, walk(val, location)];
      const base64 = data.slice(data.indexOf(",") + 1), padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
      found.push({ path: location, url: data, bytes: Math.max(0, Math.floor(base64.length * .75) - padding), part: owner(location) });
      return [key, `[图片 ${found.length} · Base64 已在预览中折叠，复制／导出保留完整数据]`];
    }));
  }
  const readable = object(walk(body, "")), current = units(body), display = units(readable);
  const tools = new Map<string, string>();
  for (const m of asArray(body.messages).map(object)) {
    for (const c of asArray(m.tool_calls).map(object)) tools.set(String(c.id), String(object(c.function).name));
    for (const b of asArray(m.content).map(object)) if (b.type === "tool_use") tools.set(String(b.id), String(b.name));
  }
  const shapes = current.map((part, i) => shape(part.path, part.value, tools, record.purpose === "compaction", i === current.length - 1));
  // The current turn opens at the newest question; everything before it is history.
  const opening = shapes.map(s => s.kind).lastIndexOf("question");
  let prefix = !!previous;
  const parts: ContextPart[] = current.map((part, i) => {
    const before = prior.find(p => p.path === part.path), s = shapes[i]!;
    const same = !!before && JSON.stringify(before.value, withoutCache) === JSON.stringify(part.value, withoutCache);
    prefix &&= prior[i]?.path === part.path && same;
    const value = display[i]!.value, o = object(value);
    const plainMessage = Object.keys(o).every(key => ["role", "content", "cache_control"].includes(key));
    const { kind: _kind, ...row } = s;
    return { path: part.path, ...row, gist: s.kind === "question" && i === opening && record.turn > 0 && !record.purpose ? record.question : s.gist,
      text: typeof o.text === "string" ? o.text : plainMessage && typeof o.content === "string" ? o.content : JSON.stringify(value, null, 2),
      section: s.role === "definition" ? "tools" : s.role === "system" ? "system" : i < opening ? "history" : "current",
      bytes: encoder.encode(JSON.stringify(part.value)).length, images: found.filter(f => f.part === part.path).length,
      breakpoints: breakpoints.filter(b => owner(b) === part.path),
      comparison: !previous ? "none" : same ? "same" : before ? "changed" : "new", prefix };
  });
  const images: DebugImage[] = found.map(f => ({ ...f, source: parts.find(p => p.path === f.part)?.role === "tool" ? "tool" : "user" }));
  const { tools: _tools, system: _system, messages: _messages, ...parameters } = readable;
  return { parts, images, breakpoints, parameters: JSON.stringify(parameters, null, 2), parameterBytes: encoder.encode(JSON.stringify(parameters)).length,
    turns: parts.filter((p, i) => p.section === "history" && shapes[i]!.kind === "question").length,
    previous: previous?.id ?? null, prefix: parts.filter(p => p.prefix).length };
}
