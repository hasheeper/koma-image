import type { AskImage, AskText, AskTool } from "./messages.ts";
import type { Picture } from "./library.ts";
import { differences, metadata, normalize, promptDiff, promptOf, similarity } from "./library.ts";
import { canonical } from "./canonical.ts";
import { dataBlock } from "./prompts/index.ts";
import type { Vision, VisionContext, Region } from "./vision.ts";
import type { TagItem } from "../domain/tags.ts";
import { proposeDraft } from "./draft/tool.ts";
import type { Draft, DraftState } from "./draft/types.ts";

export interface ToolOutcome {
  readonly content: readonly (AskText | AskImage)[];
  readonly error?: boolean;
  /** Short mono readout on the trace row, e.g. `3 处变化` or `42 KB`. */
  readonly stat?: string;
  readonly picks?: readonly string[];
  readonly draft?: Draft;
}
/**
 * Everything a tool may touch. Getters only: no store, no service, nothing
 * that writes. Drafts go through draft/apply.ts from a user click, not here.
 */
export interface ToolContext {
  readonly signal: AbortSignal;
  /** Set by「仅发元数据重试」: visual tools answer with an error this turn. */
  readonly metadataOnly: boolean;
  /** A fresh workbench snapshot as a `<workspace_state>` block. */
  readonly state: () => { readonly text: string; readonly images: number };
  readonly library?: readonly Picture[];
  readonly vision?: Vision;
  readonly visual?: VisionContext;
  readonly tags?: (query: string, limit: number) => readonly TagItem[];
  readonly draftBase?: DraftState;
  readonly question?: string;
  readonly chatContext?: unknown;
}
export interface ToolEntry {
  readonly tool: AskTool;
  /** Trace row wording: 正在{verb} {object} → 已{verb} {object}. */
  readonly verb: string;
  object(input: Readonly<Record<string, unknown>>): string;
  /** Ends the turn after it runs (propose_draft, A2). */
  readonly final?: boolean;
  run(
    input: Readonly<Record<string, unknown>>,
    context: ToolContext,
  ): ToolOutcome | Promise<ToolOutcome>;
}
export type ToolRegistry = ReadonlyMap<string, ToolEntry>;

const getState: ToolEntry = {
  tool: {
    name: "get_state",
    description:
      "读取工作台的最新状态（与消息末尾 <workspace_state> 同一格式）。仅当需要确认本轮开始后的变化时调用。",
    schema: { type: "object", properties: {}, additionalProperties: false },
  },
  verb: "读取",
  object: () => "工作台",
  run(_input, context) {
    const state = context.state();
    return {
      content: [{ type: "text", text: state.text }],
      stat: `${state.images} 张历史`,
    };
  },
};
const string = (input: Readonly<Record<string, unknown>>, key: string, optional = false): string => {
  const value = input[key];
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`${key} 需要非空文本（最多 300 字）`);
  return value.trim();
};
const picture = (id: string, context: ToolContext) => {
  if (!/^#(?:(?:h|f)\d+|c\d+\.\d+)$/.test(id)) throw new Error("请使用本页图片 ID，如 #h1 或 #f1");
  const found = context.library?.find((p) => p.aliases.includes(id));
  if (!found) throw new Error(`${id} 不在本轮图片快照中，可能已移除；新图请在下一轮查看`);
  return found;
};
const reply = (value: unknown, stat: string, picks?: readonly string[]): ToolOutcome => ({
  content: [{ type: "text", text: dataBlock(canonical(value)) }], stat, ...(picks ? { picks } : {}),
});
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const idField = { type: "string", description: "图片 ID，如 #h12、#f3、当前 CHAT 分支的 #c2.1" };
const changedFields = ["prompt", "negative", "model", "seed", "steps", "scale", "cfg", "sampler", "width", "height", "strength", "noise"];
const readMeta: ToolEntry = {
  tool: { name: "get_meta", description: "读取图片完整参数，不发送图片。", schema: schema({ id: idField }, ["id"]) },
  verb: "读取", object: (input) => String(input.id ?? "图片参数"),
  run(input, context) {
    const item = picture(string(input, "id"), context);
    return reply({ id: item.label, ...metadata(item) }, "参数");
  },
};
const diffMeta: ToolEntry = {
  tool: { name: "diff_meta", description: "比较两张图的参数和提示词差异；画面差异必须另用视觉工具确认。", schema: schema({ a: idField, b: idField }, ["a", "b"]) },
  verb: "对比", object: (input) => `${input.a ?? ""} ↔ ${input.b ?? ""}`,
  run(input, context) {
    const a = picture(string(input, "a"), context), b = picture(string(input, "b"), context);
    const changes = differences(a, b);
    return reply({ a: a.label, b: b.label, changes, prompt_diff: promptDiff(promptOf(a), promptOf(b)) }, `${Object.keys(changes).length} 处变化`);
  },
};
const searchHistory: ToolEntry = {
  tool: { name: "search_history", description: "按提示词、变化字段或相似图片检索本轮本地图片快照；命中多张时让用户选择。", schema: schema({
    query: { type: "string", maxLength: 300 }, changed_field: { type: "string", enum: changedFields }, similar_to: idField,
    min_sim: { type: "number", minimum: 0, maximum: 1 }, limit: { type: "integer", minimum: 1, maximum: 20 },
    scope: { type: "string", enum: ["history", "favorites", "all"] },
  }) },
  verb: "检索", object: () => "历史与收藏",
  run(input, context) {
    const query = normalize(string(input, "query", true)), field = string(input, "changed_field", true);
    if (field && !changedFields.includes(field)) throw new Error("不支持的变化字段");
    const scope = input.scope ?? "history";
    if (!["history", "favorites", "all"].includes(String(scope))) throw new Error("无效检索范围");
    const limit = input.limit ?? 10, threshold = input.min_sim ?? .9;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit 需为 1–20");
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("min_sim 需为 0–1");
    const base = input.similar_to !== undefined ? picture(string(input, "similar_to"), context) : null;
    const all = (context.library ?? []).filter((p) => scope === "all" || p.aliases.some((id) => id.startsWith(scope === "history" ? "#h" : "#f")));
    const hits = all.map((item, i) => ({ item, score: base ? similarity(promptOf(base), promptOf(item)) : 1,
      changed: !!all[i + 1] && Object.hasOwn(differences(all[i + 1], item), field),
    })).filter(({ item, score, changed }) =>
      (!base || (base.id !== item.id && score >= threshold)) && (!field || changed) &&
      (!query || normalize(canonical(metadata(item))).includes(query)),
    ).sort((a, b) => b.score - a.score);
    const found = hits.slice(0, limit).map(({ item, score }) => ({ id: item.label, similarity: Math.round(score * 1000) / 1000, ...metadata(item) }));
    return reply({ total: hits.length, matches: found }, `${hits.length} 张`, found.length > 1 ? found.slice(0, 3).map((p) => p.id) : undefined);
  },
};
function visualContext(context: ToolContext) {
  if (context.metadataOnly) throw new Error("本轮仅发送元数据，未发送图片");
  if (!context.vision || !context.visual) throw new Error("视觉工具未就绪");
  return { vision: context.vision, visual: context.visual };
}
const viewImage: ToolEntry = {
  tool: { name: "view_image", description: "按需看图：glance 长边384px、look 768px。crop 前必须成功用本工具的 glance 或 look 查看同一 ID 的全图；view_sheet 拼图不满足该前置条件。百分比裁切区域自动四边扩25%。累计预算4次/1.5MP/400KB。", schema: schema({
    id: idField, spec: { type: "string", enum: ["glance", "look", "crop"] },
    region: { type: "array", items: { type: "number", minimum: 0, maximum: 100 }, minItems: 4, maxItems: 4 },
  }, ["id", "spec"]) },
  verb: "查看", object: (input) => String(input.id ?? "图片"),
  async run(input, context) {
    const { vision, visual } = visualContext(context), item = picture(string(input, "id"), context);
    const spec = input.spec;
    if (spec !== "glance" && spec !== "look" && spec !== "crop") throw new Error("spec 需为 glance、look 或 crop");
    let region: Region | undefined;
    if (input.region !== undefined) {
      if (!Array.isArray(input.region) || input.region.length !== 4 || !input.region.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("region 需为四个有限数字");
      region = input.region as unknown as Region;
    }
    const result = await vision.image(item, spec, region, visual);
    return { content: [{ type: "text", text: dataBlock(canonical({ id: item.label, spec, bytes: result.bytes, pixels: result.pixels })) }, result.image], stat: `${spec} · ${Math.ceil(result.bytes / 1024)} KB` };
  },
};
const viewSheet: ToolEntry = {
  tool: { name: "view_sheet", description: "本地拼合2–6张图并标注ID。整张拼图长边默认768px，glance为384px；计作1次视觉调用。拼图不计入单图查看，之后裁切某图仍须先用 view_image 的 glance 或 look 查看该图。", schema: schema({ ids: { type: "array", items: idField, minItems: 2, maxItems: 6, uniqueItems: true }, spec: { type: "string", enum: ["glance", "look"] } }, ["ids"]) },
  verb: "对比", object: (input) => Array.isArray(input.ids) ? input.ids.join(" ↔ ") : "拼图",
  async run(input, context) {
    const { vision, visual } = visualContext(context);
    if (!Array.isArray(input.ids) || !input.ids.every((id) => typeof id === "string")) throw new Error("ids 需要图片 ID 数组");
    const items = input.ids.map((id) => picture(id, context)), spec = input.spec ?? "look";
    if (spec !== "glance" && spec !== "look") throw new Error("拼图 spec 需为 glance 或 look");
    const result = await vision.sheet(items, spec, visual);
    return { content: [{ type: "text", text: dataBlock(canonical({ ids: items.map((i) => i.label), spec: "sheet", bytes: result.bytes, pixels: result.pixels })) }, result.image], stat: `${items.length} 张 · ${Math.ceil(result.bytes / 1024)} KB` };
  },
};
const readChat: ToolEntry = {
  tool: { name: "get_chat_context", description: "读取本轮锁定的当前 CHAT 分支：文字勾选、底图、图片数量限制、已有额度与实际发送文字。不包含其他分支；不请求报价或发送。", schema: schema({}) },
  verb: "读取", object: () => "对话上下文",
  run(_input, context) {
    if (!context.chatContext) throw new Error("当前会话尚未就绪");
    return reply(context.chatContext, "当前分支");
  },
};
const searchTags: ToolEntry = {
  tool: { name: "search_tags", description: "查询本页词典已加载的本地缓存，不联网；未命中表示缓存无词条，不代表标签不存在。", schema: schema({ query: { type: "string", maxLength: 300 }, lang: { type: "string", enum: ["zh", "en"] }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["query"]) },
  verb: "检索", object: () => "本地词典",
  run(input, context) {
    const query = string(input, "query"), limit = input.limit ?? 20;
    if (input.lang !== undefined && input.lang !== "zh" && input.lang !== "en") throw new Error("lang 需为 zh 或 en");
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit 需为 1–20");
    const matches = context.tags?.(query, limit) ?? [];
    return reply({ matches, source: "本页词典缓存", ...(matches.length ? {} : { note: "本地缓存未命中，可先在词典中查询后再问 ASK" }) }, `${matches.length} 个词条`);
  },
};
/** Only read ports enter these tools; no generating or form-writing service. */
export function createTools(): ToolRegistry {
  return new Map([getState, searchHistory, readMeta, diffMeta, viewImage, viewSheet, searchTags, readChat, proposeDraft].map((entry) => [entry.tool.name, entry]));
}
