import { object } from "../domain/value.ts";
import type { AskStop, AskUsage, CacheUsage } from "./messages.ts";

export interface CallInfo {
  readonly turn: number;
  readonly step: number;
  readonly question: string;
  readonly connection: string;
  readonly protocol: "openai-chat" | "anthropic-messages";
  readonly model: string;
  readonly promptVersion: string;
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

export interface ContextPart {
  readonly path: string;
  readonly label: string;
  readonly text: string;
  readonly comparison: "same" | "changed" | "new" | "none";
  readonly prefix: boolean;
}
export interface DebugImage { readonly path: string; readonly url: string; readonly bytes: number }
const asArray = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const withoutCache = (_key: string, value: unknown) => _key === "cache_control" ? undefined : value;
function units(body: Record<string, unknown>) {
  const out: { path: string; label: string; value: unknown }[] = [];
  if (body.tools) out.push({ path: "tools", label: "工具定义", value: body.tools });
  for (const [i, value] of asArray(body.system).entries()) out.push({ path: `system[${i}]`, label: `系统提示词 ${i + 1}`, value });
  for (const [i, value] of asArray(body.messages).entries()) {
    const m = object(value), role = String(m.role ?? "message");
    out.push({ path: `messages[${i}]`, label: `${i + 1} · ${role === "system" ? "系统提示词" : role === "user" ? "用户／工具结果" : role === "tool" ? "工具结果" : "模型回复／工具调用"}`, value });
  }
  return out;
}
/** Readable rendering only. Copy/export always use the untouched dispatch body. */
export function inspectCall(record: CallRecord, previous?: CallRecord) {
  const body = object(JSON.parse(record.body)), prior = previous ? units(object(JSON.parse(previous.body))) : [];
  const images: DebugImage[] = [], breakpoints: string[] = [];
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
      images.push({ path: location, url: data, bytes: Math.max(0, Math.floor(base64.length * .75) - padding) });
      return [key, `[图片 ${images.length} · Base64 已在预览中折叠，复制／导出保留完整数据]`];
    }));
  }
  const readable = object(walk(body, "")), current = units(body), display = units(readable);
  let prefix = !!previous;
  const parts: ContextPart[] = current.map((part, i) => {
    const before = prior.find(p => p.path === part.path);
    const same = !!before && JSON.stringify(before.value, withoutCache) === JSON.stringify(part.value, withoutCache);
    prefix &&= prior[i]?.path === part.path && same;
    const value = display[i]!.value, o = object(value);
    const plainMessage = Object.keys(o).every(key => ["role", "content", "cache_control"].includes(key));
    return { path: part.path, label: part.label,
      text: typeof o.text === "string" ? o.text : plainMessage && typeof o.content === "string" ? o.content : JSON.stringify(value, null, 2),
      comparison: !previous ? "none" : same ? "same" : before ? "changed" : "new", prefix };
  });
  const { tools: _tools, system: _system, messages: _messages, ...parameters } = readable;
  return { parts, images, breakpoints, parameters: JSON.stringify(parameters, null, 2), json: JSON.stringify(readable, null, 2), previous: previous?.id ?? null, prefix: parts.filter(p => p.prefix).length };
}
