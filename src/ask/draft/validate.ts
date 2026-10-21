import { prepareDrawingFields, reuseFields, samplerName, sizeProblem } from "../../domain/drawing.ts";
import { analyze } from "../../domain/highlight.ts";
import { resolveModel } from "../../domain/catalog.ts";
import { canonical } from "../canonical.ts";
import { baseHash, hash } from "../digest/index.ts";
import { segments } from "../digest/segments.ts";
import type { CategoryOf } from "../digest/segments.ts";
import type { Picture } from "../library.ts";
import { restoreKeys } from "./types.ts";
import type { CheckedStep, Draft, DraftPlan, DraftState, Field, RestoreKey, TextMode, TextTarget, ValidateOptions } from "./types.ts";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("草稿结构无效");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 24000) => {
  if (typeof value !== "string" || value.length > max) throw new Error("草稿文字长度或类型无效");
  return value;
};
export const stateHash = (s: DraftState) => baseHash(s.form.prompt, s.form.negative, s.composer);
export function parseDraft(input: Readonly<Record<string, unknown>>, base: DraftState, question: string, library: readonly Picture[]): Draft {
  const title = text(input.title, 120).trim();
  if (!title || input.base_hash !== stateHash(base)) throw new Error("草稿 base_hash 与本轮快照不符，请使用本轮原始值");
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 12) throw new Error("草稿需要 1–12 个步骤");
  const steps = input.steps.map((raw) => {
    const step = record(raw);
    if (step.kind === "prompt_patch") {
      const target = text(step.target, 80), mode = text(step.mode, 20);
      if (!/^(?:image\.(?:prompt|negative|char\.\d+\.(?:prompt|negative))|chat\.composer)$/.test(target)) throw new Error("草稿目标无效");
      if (!["replace", "before", "after", "append", "rewrite"].includes(mode)) throw new Error("草稿修改方式无效");
      const anchor = step.anchor === undefined ? "" : text(step.anchor);
      if (!["append", "rewrite"].includes(mode) && !anchor.trim()) throw new Error("局部修改需要非空 anchor");
      return { kind: "prompt_patch" as const, target: target as TextTarget, mode: mode as TextMode, anchor, text: text(step.text) };
    }
    if (step.kind !== "restore_partial") throw new Error("此阶段不支持该草稿类型");
    const source = text(step.source, 30), image = library.find((p) => p.aliases.includes(source));
    if (!image) throw new Error("恢复来源不在本轮图片快照中");
    if (!Array.isArray(step.fields) || !step.fields.length || step.fields.some((k) => !restoreKeys.includes(k as RestoreKey))) throw new Error("恢复字段无效");
    const values: Record<string, unknown> = reuseFields(image);
    // Import defaults are useful for full reuse, but a partial restore must not
    // clear a field merely because its source omitted the metadata.
    const p = image.params;
    if (p.basePrompt === undefined && p.prompt === undefined) delete values.prompt;
    if (p.negative_prompt === undefined) delete values.negative_prompt;
    if (p.seed === undefined && p.seedStart === undefined) delete values.seed;
    if (p.batchTotal === undefined && p.batchCount === undefined) delete values.batchCount;
    return { kind: "restore_partial" as const, source, fields: [...new Set(step.fields as RestoreKey[])], values };
  });
  const workspaces = new Set(steps.map((s) => s.kind === "prompt_patch" && s.target.startsWith("chat.") ? "chat" : "image"));
  if (workspaces.size !== 1) throw new Error("一份草稿只能写入一个工作区");
  return { title, baseHash: stateHash(base), question, steps, base: structuredClone(base) };
}

/** Normalized code units retain original source spans, including repeated spaces. */
function normalized(value: string) {
  let out = "";
  const starts: number[] = [], ends: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const char = /\s/.test(value[i]) ? " " : value[i] === "，" ? "," : value[i];
    if (char === "," && out.endsWith(" ")) { out = out.slice(0, -1); starts.pop(); ends.pop(); }
    if (char === " " && out.endsWith(",")) continue;
    if (char === " " && out.endsWith(" ")) ends[ends.length - 1] = i + 1;
    else { out += char; starts.push(i); ends.push(i + 1); }
  }
  const lead = out.length - out.trimStart().length, end = out.trimEnd().length;
  return { text: out.slice(lead, end), starts: starts.slice(lead, end), ends: ends.slice(lead, end) };
}
const occurrences = (value: string, needle: string) => {
  const found: number[] = [];
  for (let i = value.indexOf(needle); i >= 0 && needle; i = value.indexOf(needle, i + 1)) found.push(i);
  return found;
};
export function matchAnchor(value: string, anchor: string) {
  const exact = occurrences(value, anchor);
  if (exact.length === 1) return { start: exact[0], end: exact[0] + anchor.length, aligned: false };
  if (exact.length > 1) return null;
  const source = normalized(value), needle = normalized(anchor).text;
  if (!needle) return null;
  const matches = occurrences(source.text, needle);
  return matches.length === 1 ? { start: source.starts[matches[0]], end: source.ends[matches[0] + needle.length - 1], aligned: true } : null;
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const name = (value: string) => value.normalize("NFKC").toLowerCase().replace(/^artist\s*:\s*/, "").replaceAll("_", " ").replace(/\s+/g, " ").trim();
function namedForChange(question: string, artist: string) {
  const n = name(artist);
  return question.split(/[。！？!?;；\n]/).some((clause) => {
    const q = name(clause);
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(n)}($|[^a-z0-9])`).test(q) &&
      /修改|改成|改为|调整|替换|删除|移除|增加|加入|提高|降低|change|adjust|replace|remove|delete|add|increase|decrease/i.test(q) &&
      !/不要|别改|不改|不动|勿|保留|don't|do not|keep|without/i.test(q);
  });
}
export function artistProblem(before: string, after: string, question: string, category?: CategoryOf) {
  const signatures = (value: string) => {
    const result = new Map<string, string[]>();
    let offset = 0;
    const tokens = analyze(value).map((t) => { const start = offset; offset += t.text.length; return { ...t, start, end: offset }; });
    for (const s of segments(value, category).filter((s) => s.kind === "artist_mix")) {
      const key = name(s.tag), values = result.get(key) ?? [];
      const weights = tokens.filter((t) => !t.syntax && t.start < s.end && t.end > s.start && value.slice(Math.max(t.start, s.start), Math.min(t.end, s.end)).trim()).map((t) => t.weight);
      values.push(`${canonical(weights)}:${s.text.replace(/\s+/g, " ").toLowerCase()}`);
      result.set(key, values);
    }
    return result;
  };
  const a = signatures(before), b = signatures(after);
  const protectedOrder = (value: string) => segments(value, category).filter((s) => s.kind === "artist_mix" && !namedForChange(question, s.tag)).map((s) => name(s.tag));
  return canonical(protectedOrder(before)) !== canonical(protectedOrder(after)) || [...new Set([...a.keys(), ...b.keys()])].some((artist) =>
    canonical(a.get(artist) ?? []) !== canonical(b.get(artist) ?? []) && !namedForChange(question, artist),
  ) ? "画师串受保护；本轮未明确点名修改该画师" : "";
}
export function keptParts(before: string, after: string) {
  const tags = [...new Set(segments(before).map((s) => s.tag))].sort((a, b) => b.length - a.length);
  if (!tags.length) return [{ text: after, kept: false }];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${tags.map((t) => escapeRegex(t).replace(/[ _]+/g, "[ _]+")).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const parts: { text: string; kept: boolean }[] = [];
  let cursor = 0;
  for (const match of after.matchAll(re)) {
    if (match.index > cursor) parts.push({ text: after.slice(cursor, match.index), kept: false });
    parts.push({ text: match[0], kept: true }); cursor = match.index + match[0].length;
  }
  if (cursor < after.length) parts.push({ text: after.slice(cursor), kept: false });
  return parts;
}
const labels: Partial<Record<Field, string>> = { prompt: "Prompt", negative: "Negative", composer: "对话输入框", width: "宽", height: "高", steps: "步数", scale: "Scale", cfg: "CFG", sampler: "采样器", seed: "Seed", model: "模型", batchCount: "批次" };

export function validateDraft(draft: Draft, now: DraftState, options: ValidateOptions): DraftPlan {
  const workspace: "image" | "chat" = draft.steps[0].kind === "prompt_patch" && draft.steps[0].target.startsWith("chat.") ? "chat" : "image";
  const initial = { ...now.form, composer: now.composer }, working = { ...initial };
  const checked: CheckedStep[] = [];
  let aligned = stateHash(now) !== draft.baseHash;
  const checkText = (id: string, target: TextTarget, mode: TextMode, anchor: string, replacement: string, label?: string) => {
    const field = target === "chat.composer" ? "composer" : target === "image.prompt" ? "prompt" : target === "image.negative" ? "negative" : null;
    const before = field ? working[field] : "", original = field === "composer" ? draft.base.composer : field ? draft.base.form[field] : "";
    let issue = !field ? "目标不存在" : target === "chat.composer" && now.conversationId !== draft.base.conversationId ? "当前对话已切换" : "";
    let start = 0, end = before.length, moved = false;
    if (mode === "append" || mode === "rewrite") {
      if (field && initial[field] !== original) issue ||= "原文已变化，需基于当前内容重新提议";
      if (mode === "append") start = end;
    } else {
      const found = matchAnchor(before, anchor);
      if (!found) issue ||= "锚点不唯一或已不存在";
      else { start = found.start; end = found.end; moved = found.aligned; }
      if (mode === "before") end = start;
      if (mode === "after") start = end;
    }
    const after = before.slice(0, start) + replacement + before.slice(end);
    issue ||= after.length > 24000 ? "结果超过 24000 字" : artistProblem(before, after, draft.question, options.category);
    const enabled = !options.off.has(id);
    checked.push({ id, label: label ?? labels[field ?? "prompt"] ?? target, kind: mode === "rewrite" ? "rewrite" : "patch", enabled, issue, aligned: moved || initial[field ?? "prompt"] !== original, before: mode === "rewrite" ? before : before.slice(start, end), after: mode === "rewrite" ? after : replacement, prefix: mode === "rewrite" ? "" : before.slice(Math.max(0, start - 60), start), suffix: mode === "rewrite" ? "" : before.slice(end, end + 60) });
    aligned ||= moved;
    if (field && enabled && !issue) working[field] = after;
  };
  draft.steps.forEach((step, i) => {
    if (step.kind === "prompt_patch") return checkText(String(i), step.target, step.mode, step.anchor, step.text);
    for (const key of step.fields) {
      const id = `${i}:${key}`, field = key === "negative_prompt" ? "negative" : key;
      const label = `${labels[field]} · ${step.source}`, value = step.values[key];
      if (key === "prompt" || key === "negative_prompt") {
        if (value !== undefined) { checkText(id, key === "prompt" ? "image.prompt" : "image.negative", "rewrite", "", String(value), label); continue; }
      }
      const samplers = [...new Set([...now.samplers, ...Object.values(now.samplersByModel ?? {}).flat()])];
      const { changes } = prepareDrawingFields({ [key]: value }, now.models, samplers);
      const after = changes[field], before = working[field];
      let issue = value === undefined ? "来源没有此参数" : after === undefined ? "当前模型或采样器不可用" : "";
      if (initial[field] !== draft.base.form[field] && initial[field] !== after) issue ||= "此参数已在外部修改";
      if ((field === "width" || field === "height") && (typeof after !== "number" || after < 64 || after > 2048 || after % 64)) issue ||= "尺寸须为 64–2048 且对齐 64px";
      if (field === "batchCount" && (typeof after !== "number" || !Number.isInteger(after) || after < 1)) issue ||= "批次数无效";
      if (field === "seed" && after !== "" && (!/^\d+$/.test(String(after)) || Number(after) > 4294967295)) issue ||= "种子无效";
      const enabled = !options.off.has(id);
      checked.push({ id, label, kind: "parameter", enabled, issue, aligned: initial[field] !== draft.base.form[field], before: String(before), after: String(after ?? value ?? "—"),
        displayBefore: field === "model" ? resolveModel(now.models, String(before))?.name : field === "sampler" ? samplerName(before) : undefined,
        displayAfter: field === "model" ? resolveModel(now.models, String(after))?.name : field === "sampler" ? samplerName(after) : undefined });
      if (enabled && !issue && after !== undefined) Object.assign(working, { [field]: after });
    }
  });
  const allowedSamplers = now.samplersByModel?.[working.model] ?? now.samplers;
  const model = resolveModel(now.models, working.model);
  const samplerConflict = (working.model !== initial.model || working.sampler !== initial.sampler) && !allowedSamplers.includes(working.sampler);
  const sizeConflict = model && (working.width !== initial.width || working.height !== initial.height || working.model !== initial.model) && sizeProblem(working.width, working.height, model.maxPixels).fatal;
  if (samplerConflict || sizeConflict) {
    // These four fields form one constraint group. Reverting only the model
    // could leave a sampler that the original model cannot accept.
    const issue = samplerConflict ? "目标模型不支持此采样器，请同时核对模型与采样器" : "组合尺寸超出目标模型范围";
    for (let i = 0; i < checked.length; i++) if (/:model$|:sampler$|:width$|:height$/.test(checked[i].id) && checked[i].enabled) checked[i] = { ...checked[i], issue: checked[i].issue || issue };
    working.model = initial.model; working.sampler = initial.sampler;
    working.width = initial.width; working.height = initial.height;
  }
  const changes = (Object.keys(working) as Field[]).filter((field) => working[field] !== initial[field]).map((field) => ({ field, before: initial[field], after: working[field] }));
  const plan = { title: draft.title, workspace, conversationId: draft.base.conversationId, steps: checked, changes, aligned };
  return { ...plan, fingerprint: hash(canonical(plan)) };
}
