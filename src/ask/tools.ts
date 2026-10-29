import { draftSchema } from "./draft/schema.ts";
import { isPictureId } from "./ids.ts";
import type { AskImage, AskText, AskTool } from "./messages.ts";
import type { Picture } from "./library.ts";
import { differences, metadata, promptDiff, promptOf } from "./library.ts";
import { canonical } from "./canonical.ts";
import { dataBlock } from "./prompts/index.ts";
import { models } from "./prompts/models.ts";
import { modelManualIds } from "./prompts/manuals.ts";
import type { ModelManualId } from "./prompts/manuals.ts";
import type { Vision, VisionContext, Region } from "./vision.ts";
import { searchHistory as findHistory, changedFields } from "./search-history.ts";
import { searchTags as findTags } from "./search-tags.ts";
import type { TagSearch } from "./search-tags.ts";
import { proposeDraft } from "./draft/tool.ts";
import type { Draft, DraftState } from "./draft/types.ts";

export interface ToolOutcome {
  readonly content: readonly (AskText | AskImage)[];
  readonly error?: boolean;
  readonly reason?: string;
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
  /** Full form text on demand; the initial snapshot is the draft base. */
  readonly state: (scope: "initial" | "latest", boardId?: string, editBoardId?: string) => { readonly text: string; readonly images: number } | Promise<{ readonly text: string; readonly images: number }>;
  readonly library?: readonly Picture[];
  readonly vision?: Vision;
  readonly visual?: VisionContext;
  readonly tags?: TagSearch;
  readonly snapshotTime?: number;
  readonly draftBase?: DraftState;
  readonly question?: string;
  readonly chatContext?: unknown;
  readonly recall?: (input: Readonly<Record<string, unknown>>) => unknown;
  readonly readSlate?: (scope: "initial" | "latest") => unknown;
  readonly checkNaiInput?: (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
  readonly readRef?: (input: Readonly<Record<string, unknown>>) => Promise<ToolOutcome>;
}
export interface ToolEntry {
  readonly tool: AskTool;
  /** Trace row wording: 正在{verb} {object} → 已{verb} {object}. */
  readonly verb: string;
  object(input: Readonly<Record<string, unknown>>): string;
  /** Ends tool execution after it runs; missing prose is completed separately. */
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
      "活动画板完整词文已随初始状态提供。按需读取其他画板（board_id）以对比；scope 默认 initial 为本轮冻结数据，仅确认外部最新改动用 latest。读取其他板不改变草稿基底。历史保持原索引，不扩张本轮可访问图片集合。",
    schema: { type: "object", properties: { scope: { type: "string", enum: ["initial", "latest"] }, board_id: { type: "string" }, edit_board_id: { type: "string", description: "读取 EDIT 画板，与 board_id 互斥" }, include_slate: { type: "boolean", description: "附带当前任务板的完整配方、描述、妥协记录及绑定元信息；默认只有摘要" } }, additionalProperties: false },
  },
  verb: "读取",
  object: () => "工作台",
  async run(input, context) {
    const scope = input.scope ?? "initial";
    if (scope !== "initial" && scope !== "latest") throw new Error("scope 需为 initial 或 latest");
    if (input.board_id !== undefined && (typeof input.board_id !== "string" || !input.board_id.trim())) throw new Error("board_id 无效");
    if(input.edit_board_id!==undefined&&(typeof input.edit_board_id!=='string'||!input.edit_board_id.trim()||input.board_id))throw new Error('edit_board_id 无效或与 board_id 冲突');
    const state = await context.state(scope, input.board_id as string | undefined,input.edit_board_id as string|undefined);
    return {
      content: [{ type: "text", text: state.text }, ...(input.include_slate === true ? [{ type: "text" as const, text: dataBlock(canonical({ active_slate: context.readSlate?.(scope) ?? context.draftBase?.slate ?? null })) }] : [])],
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
  if (!isPictureId(id)) throw new Error("请使用有效图片 ID，如 #h1、#f3、#e2.3a、当前板 #e3 或附件 #a1");
  const found = context.library?.find((p) => p.aliases.includes(id));
  if (!found) throw new Error(`${id} 不在本轮图片快照中，可能已移除；新图请在下一轮查看`);
  return { ...found, label:id };
};
const reply = (value: unknown, stat: string, picks?: readonly string[]): ToolOutcome => ({
  content: [{ type: "text", text: dataBlock(canonical(value)) }], stat, ...(picks ? { picks } : {}),
});
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const idField = { type: "string", description: "图片 ID，如 #h12、#f3、EDIT 完整码 #e2.3a（当前板可简写 #e3a）、当前 CHAT 分支的 #c2.1（多图 #c2.1b，兼容 #c2.1.2）、本对话附件 #a1" };
const readMeta: ToolEntry = {
  tool: { name: "get_meta", description: "读取图片完整参数，不发送图片。", schema: schema({ id: idField }, ["id"]) },
  verb: "读取", object: (input) => String(input.id ?? "图片参数"),
  run(input, context) {
    const item = picture(string(input, "id"), context);
    return reply({ id: item.label, record_id:item.id,entity_key:item.entity_key, lineage:item.lineage, ...(item.attachment ?? metadata(item)) }, "参数");
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
  tool: { name: "search_history", description: "本地检索本轮历史、收藏、EDIT 或当前 CHAT 分支图片。query 用朴素关键词，多词任一命中；不解析布尔或正则。changed_field 对比同来源前序，size 表示宽高变化；similar_to 按提示词相似度排序。默认 all、8条，最多15条；详情用 get_meta。", schema: schema({
    query: { type: "string", maxLength: 300 }, changed_field: { type: "string", enum: changedFields }, similar_to: { type: "string", description: "作为比较基准的工作区图片 ID（#h、#f、#e、#c）；检索不含 #a 附件" },
    limit: { type: "integer", minimum: 1, maximum: 15 },
    scope: { type: "string", enum: ["history", "favorites", "chat", "edit", "all"] },
  }) },
  verb: "检索", object: () => "图片记录",
  run(input, context) {
    const result = findHistory(input, (context.library ?? []).filter(p => !p.attachment), context.snapshotTime ?? 0);
    return reply(result, `${result.total_matched} 张`, result.matches.length > 1 ? result.matches.slice(0, 4).map((p) => p.id) : undefined);
  },
};
function visualContext(context: ToolContext) {
  if (context.metadataOnly) throw new Error("本轮仅发送元数据，未发送图片");
  if (!context.vision || !context.visual) throw new Error("视觉工具未就绪");
  return { vision: context.vision, visual: context.visual };
}
const specLabel = { glance: "概览", look: "细看", crop: "局部" } as const;
const viewImage: ToolEntry = {
  tool: { name: "view_image", description: "按需看图：glance 长边384px、look 768px。crop 前须看过同一原图实体的全图，#h/#f/#e 别名共享资格：本工具的 glance/look 或随提问发送的 #a 附件图片均可，view_sheet 拼图不计。百分比裁切区域自动四边扩25%。与 view_sheet 共享本轮视觉预算：合计最多4次/1.5MP/400KB；随提问发送的图片不占此预算。", schema: schema({
    id: idField, spec: { type: "string", enum: ["glance", "look", "crop"] }, reinspect: { type: "boolean", description: "用户明确要求本轮重新查看时设为 true" },
    region: { type: "array", description: "仅 crop 必填，glance/look 不传。顺序为 [x, y, width, height]，单位为相对原图的百分比（0–100）；原图左上角为 (0,0)，宽高须大于0，x+width、y+height 均不得超过100。", items: { type: "number", minimum: 0, maximum: 100 }, minItems: 4, maxItems: 4 },
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
    const result = await vision.image(item, spec, region, visual, input.reinspect === true);
    return { content: [{ type: "text", text: dataBlock(canonical({ id: item.label, spec, ...(result.duplicate ? {already_viewed_this_turn:true} : {}), bytes: result.bytes, pixels: result.pixels })) }, ...(result.image ? [result.image] : [])], stat: result.duplicate ? "本轮已查看" : `${specLabel[spec]} · ${Math.ceil(result.bytes / 1024)} KB` };
  },
};
const viewSheet: ToolEntry = {
  // Gemini relays reject uniqueItems; vision.sheet checks distinct picture IDs.
  tool: { name: "view_sheet", description: "本地拼合2–6张不同图片并标注ID，支持 #a 附件与工作区图片混合预览。整张拼图长边默认768px，glance为384px；计作1次视觉调用，与 view_image 共享本轮次数、像素和字节预算。拼图不计入单图查看；crop 的前置条件见 view_image。", schema: schema({ ids: { type: "array", items: idField, minItems: 2, maxItems: 6 }, spec: { type: "string", enum: ["glance", "look"] } }, ["ids"]) },
  verb: "对比", object: (input) => Array.isArray(input.ids) ? input.ids.join(" ↔ ") : "拼图",
  async run(input, context) {
    const { vision, visual } = visualContext(context);
    if (!Array.isArray(input.ids) || !input.ids.every((id) => typeof id === "string")) throw new Error("ids 需要图片 ID 数组");
    const items = input.ids.map((id) => picture(id, context)), spec = input.spec ?? "look";
    if (spec !== "glance" && spec !== "look") throw new Error("拼图 spec 需为 glance 或 look");
    const result = await vision.sheet(items, spec, visual);
    return { content: [{ type: "text", text: dataBlock(canonical({ ids: items.map((i) => i.label), spec: "sheet", ...(result.duplicate ? { already_viewed_this_turn: true } : {}), bytes: result.bytes, pixels: result.pixels })) }, ...(result.image ? [result.image] : [])], stat: result.duplicate ? "本轮已查看" : `${items.length} 张 · ${Math.ceil(result.bytes / 1024)} KB` };
  },
};
const readChat: ToolEntry = {
  tool: { name: "get_chat_context", description: "读取本轮锁定的当前 CHAT 分支：文字勾选、各轮版本与图片 ID、底图、图片数量限制、当前模型与尺寸类选项（chat_model）、已有额度与实际发送文字。不包含其他分支；不请求报价或发送。", schema: schema({}) },
  verb: "读取", object: () => "对话上下文",
  run(_input, context) {
    if (!context.chatContext) throw new Error("当前会话尚未就绪");
    return reply(context.chatContext, "当前分支");
  },
};
const searchTags: ToolEntry = {
  tool: { name: "search_tags", description: "按需核验 NAI 词条的标准写法、分类、中文释义与帖子收录量；queries 一次1–5词，每词默认5/最多10条。复用站内中英在线词典与缓存，可能联网。未命中不代表不存在，服务失败表示未核验；保留有效结果，基于已有知识继续，不为服务故障连续换近义词重查。收录量不等于模型激活强度；原数据缺失的 count/category 沿用共享服务的0值，别名未知为null。", schema: schema({
    queries: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", minLength: 1, maxLength: 300 } },
    limit_per_query: { type: "integer", minimum: 1, maximum: 10 },
  }, ["queries"]) },
  verb: "核验", object: () => "词典",
  async run(input, context) {
    if (!context.tags) throw new Error("词典服务未就绪");
    const result = await findTags(input, context.tags, context.signal);
    const failed = result.results.filter((r) => r.status === "error");
    const data = failed.length ? { ...result, note: "失败项尚未核验，不代表词条不存在。保留有效结果，基于已有知识继续；不要因服务故障连续换近义词重查。" } : result;
    return { ...reply(data, `${result.results.length} 个查询${failed.length ? ` · ${failed.length} 失败` : ""}`),
      ...(failed.length ? { reason: failed.map((r) => `${r.query}：${r.error}`).join("\n") } : {}),
      ...(failed.length === result.results.length ? { error: true } : {}),
    };
  },
};
const readModelManual: ToolEntry = {
  tool: { name: "get_model_manual", description: "按需读取内置模型专项手册，不联网。nai5-prompting：NAI 混排/权重/多人排错；nai5-comics：分格漫画/文字；oc-costume-design：服装结构/词条映射。经验建议需结合实际图片验证。", schema: schema({ id: { type: "string", enum: modelManualIds } }, ["id"]) },
  verb: "查阅",
  object: (input) => typeof input.id === "string" && Object.hasOwn(models.manuals, input.id)
    ? models.manuals[input.id as ModelManualId].title : "模型手册",
  run(input) {
    const id = string(input, "id");
    if (!Object.hasOwn(models.manuals, id)) throw new Error(`未知模型手册，请使用：${modelManualIds.join("、")}`);
    const manual = models.manuals[id as ModelManualId];
    return reply({ id, version: models.version, ...manual }, "本地手册");
  },
};
const readTurn: ToolEntry = {
  tool: { name: "get_turn", description: "召回本会话成功轮次 T1、T2…或附件 text-N / #aN。turns 一次1–3个；attachments 一次1–2个。include 默认 draft：用户原话、草稿与回复；full 增加工具记录和当轮实际发送的状态文本。文本附件每次最多8000字符，按 next_offset 续读；显式传 offset 时只允许一个文本附件。图片只返回元信息，看图另用视觉工具。", schema: schema({
    turns: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    attachments: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
    include: { type: "string", enum: ["draft", "full"] },
    offset: { type: "integer", minimum: 0 },
  }) },
  verb: "回顾", object: input => [...(Array.isArray(input.turns) ? input.turns : []), ...(Array.isArray(input.attachments) ? input.attachments : [])].join(" · ") || "对话记录",
  run(input, context) {
    if (!context.recall) throw new Error("本会话的召回记录未就绪");
    return { content: [{ type: "text", text: dataBlock(canonical(context.recall(input))), source: { kind: "recall" } }], stat: "原文" };
  },
};
const readRef: ToolEntry = {
  tool: { name: "read_ref", description: "按用户问题需要读取协同 refs/ 资料。path 使用 workspace_state.refs_index 的完整相对路径；仅文件清单默认可见，未读取不能声称知道正文。同名须消歧。本轮首次读取冻结内容，重复或 offset 续读同一版本；下一轮重新读取。文本每次最多8000字符，按 next_offset 续读；图片以768px视觉通道读取，共享4次/1.5MP/400KB预算。与本轮附件合计最多4个文本和4张图片，不能读取目录外文件。", schema: schema({ path: { type: "string", minLength: 1, maxLength: 1024 }, offset: { type: "integer", minimum: 0 } }, ["path"]) },
  verb: "读取", object: input => typeof input.path === "string" ? input.path : "协同资料",
  run(input, context) {
    if (!context.readRef) throw new Error("尚未挂载可读取的协同目录");
    return context.readRef(input);
  },
};
const checkNaiInput: ToolEntry = {
  tool:{ name:'check_nai_input',description:'用本轮冻结状态检查 NAI 候选修改：基础与启用角色按正负方向合计 token 与 Text 字符，返回能力、生效值和只读费用。不修改表单、不创建草稿、不请求报价或生成。steps 为空检查当前输入。',schema:schema({base_hash:{type:'string'},steps:{type:'array',maxItems:12,items:{anyOf:draftSchema.properties.steps.items.anyOf.filter(s=>s.properties.kind.enum.some(k=>['prompt_patch','params_patch','character_edit','restore_partial'].includes(k)))}}},['base_hash']) },
  verb:'检查',object:()=> 'NAI 输入',
  async run(input,context) { if (!context.checkNaiInput) throw new Error('本轮输入检查不可用'); return reply(await context.checkNaiInput(input),'预算与能力'); },
};
/** Only read ports enter these tools; no generating or form-writing service. */
export function createTools(): ToolRegistry {
  return new Map([getState, checkNaiInput, searchHistory, readMeta, diffMeta, viewImage, viewSheet, searchTags, readChat, readModelManual, proposeDraft, readTurn, readRef].map((entry) => [entry.tool.name, entry]));
}
