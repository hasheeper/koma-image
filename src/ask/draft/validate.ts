import { naiCapabilities } from "../../domain/nai.ts";
import { parseEditHandoff,validateEditHandoff } from "./edit-handoff.ts";
import { parseEditDraft, validateEditDraft, draftTarget } from "./edit.ts";
import { editStateHash } from "../../domain/edit-draft.ts";
import { parseFile, fileIssue } from "./files.ts";
import { canReuseDrawingParams } from "../../domain/image-origin.ts";
import { parseSlateEdit } from "../../slate/edit.ts";
import { contentKey, describe } from "../../slate/model.ts";
import { boardForm } from "../../domain/drawing.ts";
import { parseParameters, parameterIssue } from "./parameters.ts";
import type { ParameterKey } from "./parameters.ts";
import { characterCapability, cellCenter, nextCharacterId, sameValue } from "../../domain/characters.ts";
import type { CharacterStep } from "./types.ts";
import { prepareDrawingFields, reuseFields, samplerName, sizeProblem } from "../../domain/drawing.ts";
import { resolveModel } from "../../domain/catalog.ts";
import { canonical } from "../canonical.ts";
import { workspaceHash, hash } from "../digest/index.ts";
import type { Picture } from "../library.ts";
import { chatImage, chatTurn } from "../chat-context.ts";
import { chatOptionLabel, chatOptionNames, chatSizeKeys } from "../../domain/chat-options.ts";
import { restoreKeys } from "./types.ts";
import type { CheckedStep, Draft, DraftPlan, DraftState, Field, HandoffImage, RestoreKey, TextMode, TextTarget, ValidateOptions } from "./types.ts";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("草稿结构无效");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 24000) => {
  if (typeof value !== "string" || value.length > max) throw new Error("草稿文字长度或类型无效");
  return value;
};
export const stateHash = (s: DraftState) => s.workspace === "edit" && s.edit ? editStateHash(s.edit) : workspaceHash(s.form, s.composer, s.boardId);
/** Asked outside CHAT, a CHAT write always opens a new conversation. */
const outsideChat = (base: DraftState) => {
  if (base.workspace && base.workspace !== "chat") throw new Error("在 HOME／IMAGE／TAGS 提问时，写入 CHAT 一律新开会话：请改用 chat_handoff");
};
function handoffImage(label: string, base: DraftState, library: readonly Picture[]): HandoffImage {
  if (label.startsWith("#a")) throw new Error("附件不能作为交接图片");
  if (label.startsWith("#c")) {
    const image = base.chat ? chatImage(base.chat, label) : null;
    if (!image) throw new Error(`${label} 不在当前分支或没有已完成图片`);
    const binding = library.find(p=>p.aliases.includes(label))?.bindings?.[label];
    return { label, source: "chat", ref: image.assetId, ...(binding ? {binding} : {}) };
  }
  const picture = library.find((p) => p.aliases.includes(label)), origin = picture?.origins.find((o) => o.label === label);
  if (!picture || (origin?.source !== "history" && origin?.source !== "favorites" && origin?.source !== "edit")) throw new Error(`${label} 不在本轮图片快照中`);
  return { label, source: origin.source, ref: picture.id, ...(picture.bindings?.[label] ? {binding:picture.bindings[label]} : {}) };
}
export function parseDraft(input: Readonly<Record<string, unknown>>, base: DraftState, library: readonly Picture[], question = ""): Draft {
  if(Array.isArray(input.steps)&&input.steps.some(s=>s?.kind==="edit_handoff"))return parseEditHandoff(input,base,library,question);
  if (draftTarget(input,base) === "edit") return parseEditDraft(input,base,library,question);
  // Keep in-flight responses and earlier tool turns using `title` readable.
  const title = text(input.draft_title ?? input.title, 120).trim();
  if (!title || input.base_hash !== stateHash(base)) throw new Error("草稿 base_hash 与本轮快照不符，请使用本轮原始值");
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 12) throw new Error("草稿需要 1–12 个步骤");
  const rawSteps = input.steps;
  const steps = rawSteps.map((raw) => {
    const step = record(raw);
    if (step.kind === "save_ref") return parseFile(step, base);
    if (step.kind === "slate_edit") return parseSlateEdit(step, base.slate ?? null, base.form, library);
    if (step.kind === "params_patch") return { kind: "params_patch" as const, params: parseParameters(step.params) };
    if (step.kind === "prompt_patch") {
      const target = text(step.target, 80), mode = text(step.mode, 20);
      if (!/^(?:image\.(?:prompt|negative|char\.c[1-9]\d*\.(?:prompt|negative))|chat\.composer)$/.test(target)) throw new Error("草稿目标无效");
      if (target === "chat.composer") outsideChat(base);
      if (!["replace", "before", "after", "append", "rewrite"].includes(mode)) throw new Error("草稿修改方式无效");
      const anchor = step.anchor === undefined ? "" : text(step.anchor);
      if (!["append", "rewrite"].includes(mode) && !anchor.trim()) throw new Error("局部修改需要非空 anchor");
      return { kind: "prompt_patch" as const, target: target as TextTarget, mode: mode as TextMode, anchor, text: text(step.text) };
    }
    if (step.kind === "character_edit") {
      if (!["add", "remove", "reorder", "set_enabled", "set_position", "set_placement"].includes(String(step.op))) throw new Error("角色动作无效");
      const op = step.op as CharacterStep["op"];
      const result: { kind: "character_edit"; op: CharacterStep["op"]; id?: string; ids?: string[]; prompt?: string; negative?: string; on?: boolean; cell?: string; x?: number; y?: number; placement?: "auto" | "manual" } = { kind: "character_edit", op };
      if (["remove", "set_enabled", "set_position"].includes(op)) { result.id = text(step.id, 80); if (!/^c[1-9]\d*$/.test(result.id)) throw new Error("需要稳定角色 ID，如 c2"); }
      if (op === "add") { result.prompt = text(step.prompt); result.negative = step.negative === undefined ? "" : text(step.negative); }
      if (op === "add" || op === "set_enabled") { if (step.on !== undefined && typeof step.on !== "boolean" || op === "set_enabled" && typeof step.on !== "boolean") throw new Error("on 需要布尔值"); result.on = step.on !== false; }
      if (op === "reorder") { if (!Array.isArray(step.ids) || !step.ids.every(v => typeof v === "string")) throw new Error("ids 需要完整角色 ID 顺序"); result.ids = [...step.ids] as string[]; }
      if (op === "set_position" || op === "add") {
        if (step.cell !== undefined) { result.cell = text(step.cell, 2); cellCenter(result.cell); }
        if (step.x !== undefined || step.y !== undefined) { if ([step.x, step.y].some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("x/y 需要 0–1 坐标"); result.x = step.x as number; result.y = step.y as number; }
        if (result.cell && result.x !== undefined) throw new Error("位置只选 cell 或 x/y");
        if (op === "set_position" && !result.cell && result.x === undefined) throw new Error("缺少角色位置");
      }
      if (op === "set_placement") { if (step.placement !== "auto" && step.placement !== "manual") throw new Error("placement 需为 auto/manual"); result.placement = step.placement; }
      return result;
    }
    if (step.kind === "chat_distill_branch") {
      outsideChat(base);
      if (rawSteps.length !== 1 || !base.chat) throw new Error("分支草稿需要当前会话快照，且必须独立提交");
      const source = text(step.source, 30), image = chatImage(base.chat, source);
      if (!image) throw new Error("分支起点不在当前分支或没有已完成图片");
      if (!image.selected) throw new Error("分支起点须在该轮当前选中的版本中；请让用户先在 CHAT 切换版本，或改用 chat_handoff 新开会话");
      if (!Array.isArray(step.exclude) || step.exclude.some((id) => typeof id !== "string" || !chatTurn(base.chat!, id))) throw new Error("排除轮次不在本轮分支快照中");
      return { kind: "chat_distill_branch" as const, source, exclude: [...new Set(step.exclude as string[])], text: text(step.text) };
    }
    if (step.kind === "chat_handoff") {
      const model = base.chatModel;
      if (rawSteps.length !== 1) throw new Error("交接草稿必须独立提交");
      if (!model) throw new Error("CHAT 模型目录未就绪，暂不能交接；请让用户打开对话页或检查连接后再提议");
      if (!Array.isArray(step.images) || step.images.some((id) => typeof id !== "string")) throw new Error("images 需要图片 ID 列表");
      const images: HandoffImage[] = [];
      for (const label of step.images as string[]) {
        const image = handoffImage(text(label, 30), base, library);
        if (!images.some((i) => i.ref === image.ref)) images.push(image);
      }
      if (images.length > model.maxImages) throw new Error(`当前 CHAT 模型最多使用 ${model.maxImages} 张图`);
      const options: Record<string, string> = {};
      for (const [key, value] of Object.entries(record(step.options ?? {}))) {
        if (!chatSizeKeys.includes(key)) throw new Error(`${key} 不能由草稿写入；需要时在回复中提醒用户手动调整`);
        const field = model.writable[key];
        if (!field) throw new Error(`当前 CHAT 模型没有 ${key} 选项`);
        if (typeof value !== "string" || !field.options.includes(value)) throw new Error(`${key} 只能取 ${field.options.join("、")}`);
        options[key] = value;
      }
      const body = text(step.text);
      if (!body.trim()) throw new Error("交接需要非空的输入框文字");
      return { kind: "chat_handoff" as const, images, options, text: body };
    }
    if (step.kind !== "restore_partial") throw new Error("此阶段不支持该草稿类型");
    const source = text(step.source, 30), image = library.find((p) => p.aliases.includes(source));
    if (source.startsWith("#a")) throw new Error("附件参数仅供参考");
    if (!image) throw new Error("恢复来源不在本轮图片快照中");
    if (!canReuseDrawingParams(image.params)) throw new Error("对话图片没有可恢复的绘图配方，请直接提议提示词或参数修改");
    if (!Array.isArray(step.fields) || !step.fields.length || step.fields.some((k) => !restoreKeys.includes(k as RestoreKey))) throw new Error("恢复字段无效");
    const values: Record<string, unknown> = reuseFields(image);
    // Import defaults are useful for full reuse, but a partial restore must not
    // clear a field merely because its source omitted the metadata.
    const p = image.params;
    if (p.basePrompt === undefined && p.prompt === undefined) delete values.prompt;
    if (p.negative_prompt === undefined) delete values.negative_prompt;
    if (p.seed === undefined && p.seedStart === undefined) delete values.seed;
    if (p.batchTotal === undefined && p.batchCount === undefined) delete values.batchCount;
    return { kind: "restore_partial" as const, source, source_ref:image.bindings?.[source], fields: [...new Set(step.fields as RestoreKey[])], values };
  });
  if (steps.filter(s => s.kind === "slate_edit").length > 1) throw new Error("一份草稿只编辑一个任务板，请合并 Todo 操作");
  const workspaces = new Set(steps.map((s) => (s.kind === "chat_distill_branch" || s.kind === "chat_handoff" || s.kind === "prompt_patch" && s.target.startsWith("chat.")) ? "chat" : "image"));
  if (workspaces.size !== 1) throw new Error("一份草稿只能写入一个工作区");
  const newBoardName = input.new_board_name === undefined ? undefined : text(input.new_board_name, 80).trim();
  if (newBoardName !== undefined && (!newBoardName || !workspaces.has("image") || !base.boardId)) throw new Error("new_board_name 需要非空名称，且仅用于有来源画板的 IMAGE 草稿");
  return { title, ...(newBoardName === undefined ? {} : { newBoardName }), baseHash: stateHash(base), question, steps, base: structuredClone(base) };
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
const roleGroupText = (chars: DraftState["form"]["characters"], placement: string) => `${placement === "manual" ? "手动定位" : "自动定位"}\n${chars.map((c, i) => `角色 ${i + 1} (${c.id}) · ${c.on ? "启用" : "停用"} · ${c.centers.map(p => `${p.x}/${p.y}`).join("; ")}\nPrompt: ${c.prompt}\nNegative: ${c.negative || "（空）"}`).join("\n")}`;
const labels: Partial<Record<Field, string>> = { prompt: "Prompt", negative: "Negative", composer: "对话输入框", width: "宽", height: "高", steps: "步数", scale: "Guidance", cfg: "中转 CFG（旧）", cfgRescale: "Guidance Rescale", noiseSchedule: "噪声调度", varietyPlus: "Variety+", naiMode: "模式", complexity: "Complexity", qualityPreset: "质量预设", negativePreset: "负向预设", transparentBg: "透明底", sampler: "采样器", seed: "Seed", model: "模型", batchCount: "批次" };

export function validateDraft(draft: Draft, now: DraftState, options: ValidateOptions): DraftPlan {
  if(draft.editHandoff)return validateEditHandoff(draft,now,options);
  if(draft.target === "edit") return validateEditDraft(draft,now,options);
  if (draft.steps[0].kind === "chat_distill_branch") return validateBranch(draft, now, options);
  if (draft.steps[0].kind === "chat_handoff") return validateHandoff(draft, now, options);
  const workspace: "image" | "chat" = draft.steps[0].kind === "prompt_patch" && draft.steps[0].target.startsWith("chat.") ? "chat" : "image";
  const initial = structuredClone({ ...now.form, characters: now.form.characters ?? [], composer: now.composer }), working = structuredClone(initial);
  let allocation = Math.max(now.nextCharacterId ?? 1, draft.base.nextCharacterId ?? 1, nextCharacterId(draft.base.form.characters ?? []));
  const finalModel = draft.steps.reduce((id, step, i) => {
    if (options.off.has(`${i}:model`)) return id;
    const value = step.kind === 'params_patch' ? step.params.model
      : step.kind === 'restore_partial' && step.fields.includes('model') ? resolveModel(now.models, String(step.values.model ?? ''))?.id : undefined;
    if (!value || !sameValue(initial.model, draft.base.form.model) && !sameValue(initial.model, value)) return id;
    return value;
  }, now.form.model);
  const checked: CheckedStep[] = [];
  let aligned = stateHash(now) !== draft.baseHash;
  const checkText = (id: string, target: TextTarget, mode: TextMode, anchor: string, replacement: string, label?: string) => {
    const match = /^(?:image|edit)\.char\.(c[1-9]\d*)\.(prompt|negative)$/.exec(target);
    const char = match ? working.characters.find(c => c.id === match[1]) : undefined;
    const charField = match?.[2] as "prompt" | "negative" | undefined;
    const field = target === "chat.composer" ? "composer" : target === "image.prompt" ? "prompt" : target === "image.negative" ? "negative" : null;
    const before = char && charField ? char[charField] : field ? working[field] : "";
    const originalChar = match ? draft.base.form.characters?.find(c => c.id === match[1]) : undefined;
    const original = charField ? originalChar?.[charField] ?? "" : field === "composer" ? draft.base.composer : field ? draft.base.form[field] : "";
    const initialText = charField ? initial.characters.find(c => c.id === match![1])?.[charField] ?? "" : field ? initial[field] : "";
    let issue = !field && (!char || !originalChar) ? "目标角色已不存在" : target === "chat.composer" && now.conversationId !== draft.base.conversationId ? "当前对话已切换" : "";
    if (workspace === "image" && now.boardPresent === false) issue = "来源画板已删除";
    let start = 0, end = before.length, moved = false;
    if (mode === "append" || mode === "rewrite") {
      if (initialText !== original) issue ||= "原文已变化，需基于当前内容重新提议";
      if (mode === "append") start = end;
    } else {
      const found = matchAnchor(before, anchor);
      if (!found) issue ||= "锚点不唯一或已不存在";
      else { start = found.start; end = found.end; moved = found.aligned; }
      if (mode === "before") end = start;
      if (mode === "after") start = end;
    }
    const after = before.slice(0, start) + replacement + before.slice(end);
    if (after.length > 24000) issue ||= "结果超过 24000 字";
    const enabled = !options.off.has(id);
    checked.push({ id, ...(match ? { characterId: match[1], characterLabel: `角色 ${initial.characters.findIndex(c => c.id === match[1]) + 1} · ${match[1]}` } : {}), label: label ?? (charField === "negative" ? "Negative" : charField === "prompt" ? "Prompt" : labels[field ?? "prompt"]) ?? target, kind: mode === "rewrite" ? "rewrite" : "patch", enabled, issue, aligned: moved || initialText !== original, before: mode === "rewrite" ? before : before.slice(start, end), after: mode === "rewrite" ? after : replacement, prefix: mode === "rewrite" ? "" : before.slice(Math.max(0, start - 60), start), suffix: mode === "rewrite" ? "" : before.slice(end, end + 60) });
    aligned ||= moved;
    if (enabled && !issue) { if (char && charField) char[charField] = after; else if (field) working[field] = after; }
  };
  const files = draft.steps.flatMap(step => step.kind === "save_ref" ? [step.file] : []);
  const exportIssue = fileIssue(files, now.fileContext);
  const slateStep = draft.steps.find(s => s.kind === "slate_edit");
  let slate = slateStep ? structuredClone(slateStep.change) : undefined;
  draft.steps.forEach((step, i) => {
    if (step.kind === "save_ref") { checked.push({ id: String(i), label: step.file.title, kind: "file", locked: true, enabled: true, issue: exportIssue, aligned: false, before: "", after: step.file.filename }); return; }
    if (step.kind === "slate_edit") {
      const before = step.change.before, live = now.slate ?? null;
      let issue = before && (live?.id !== before.id || live.version !== before.version) ? "任务板版本已变化，请重新提议" : "";
      for (const image of step.change.bindings) if (options.has?.(image) === false) issue ||= `${image.label} 已移除`;
      if (options.off.size) issue ||= "任务与画板是一个组合，请整体应用或重新提议";
      checked.push({ id: String(i), label: step.unlockRecipe ? "任务板 · 解锁配方" : "任务板", kind: "slate", locked: true, enabled: true, issue, aligned: !!issue, before: describe(before), after: describe(step.change.after) });
      return;
    }
    if (step.kind === "prompt_patch") return checkText(String(i), step.target, step.mode, step.anchor, step.text);
    if (step.kind === "character_edit") {
      const id = String(i), enabled = !options.off.has(id), cap = characterCapability(finalModel);
      let issue = now.boardPresent === false ? "来源画板已删除" : !sameValue(initial.characters, draft.base.form.characters ?? []) || initial.placement !== draft.base.form.placement && draft.base.form.placement !== undefined ? "角色组已在外部修改，请重新提议" : "";
      const chars = structuredClone(working.characters), c = chars.find(c => c.id === step.id);
      let before = "", after = "", label = "角色", characterId = step.id;
      const center = step.cell ? cellCenter(step.cell) : step.x !== undefined ? { x: step.x, y: step.y! } : null;
      if (center && (cap.positioning === "grid5" ? !step.cell : !cap.max || !!step.cell)) issue ||= "位置格式与当前模型不匹配";
      if (step.op === "add") {
        const addedId = `c${allocation++}`; characterId = addedId;
        label = "新增"; after = `${step.prompt ?? ""}\n${step.on === false ? "停用" : "启用"} · ${step.cell ?? (step.x === undefined ? "默认位置" : `${step.x}, ${step.y}`)}`;
        if (step.on !== false && (!cap.max || chars.filter(c=>c.on).length >= cap.max)) issue ||= "已达当前模型角色上限";
        chars.push({ id: addedId, on: step.on !== false, prompt: step.prompt ?? "", negative: step.negative ?? "", centers: [center ?? { x: .5, y: .5 }] });
        if (step.negative) after += `\nNegative: ${step.negative}`;
      } else if (step.op === "reorder") {
        label = "角色顺序"; before = chars.map(c => c.id).join(" → "); after = step.ids!.join(" → ");
        if (step.ids!.length !== chars.length || new Set(step.ids).size !== chars.length || step.ids!.some(id => !chars.some(c => c.id === id))) issue ||= "排序必须包含全部现有角色且不重复";
        if (!issue) chars.splice(0, chars.length, ...step.ids!.map(id => chars.find(c => c.id === id)!));
      } else if (step.op === "set_placement") {
        label = "角色定位"; before = working.placement === "manual" ? "手动" : "自动"; after = step.placement === "manual" ? "手动" : "自动";
        if (!cap.max) issue ||= "当前模型不支持角色定位";
        if (enabled && !issue) { working.placement = step.placement!; if (step.placement === "manual") chars.forEach(c => { if (!c.centers.length) c.centers = [{ x: .5, y: .5 }]; }); }
      } else if (!c) issue ||= "目标角色已不存在";
      else if (!draft.base.form.characters?.some(x => x.id === c.id)) issue ||= "目标不在初始角色组中";
      else if (step.op === "remove") { label = "删除"; before = `${c.prompt || c.id}\nNegative: ${c.negative || "（空）"}`; after = "移除"; chars.splice(chars.indexOf(c), 1); }
      else if (step.op === "set_enabled") { label = "状态"; before = c.on ? "启用" : "停用"; after = step.on ? "启用" : "停用"; c.on = step.on!; }
      else if (step.op === "set_position") { label = "位置"; before = c.centers.map(p => `${p.x}, ${p.y}`).join(" / "); after = step.cell ?? `${step.x}, ${step.y}`; c.centers = [center!]; }
      const ordinal = step.op === "add" ? working.characters.length + 1 : initial.characters.findIndex(c => c.id === characterId) + 1;
      checked.push({ id, label, ...(characterId ? { characterId, characterLabel: `角色 ${ordinal || characterId} · ${characterId}` } : {}), kind: step.op === "add" || step.op === "remove" ? "rewrite" : "parameter", enabled, issue, aligned: false, before, after });
      if (enabled && !issue) working.characters = chars;
      return;
    }
    if (step.kind === "params_patch") {
      for (const [key, after] of Object.entries(step.params)) {
        const field = key as ParameterKey, id = `${i}:${key}`, enabled = !options.off.has(id), before = working[field];
        const issue = !sameValue(initial[field], draft.base.form[field]) && !sameValue(initial[field], after) ? "此参数已在外部修改" : "";
        checked.push({ id, label: labels[field] ?? field, kind: "parameter", enabled, issue, aligned: !!issue, before: String(before), after: String(after) });
        if (enabled && !issue) Object.assign(working, { [field]: after });
      }
      return;
    }
    if (step.kind !== "restore_partial") return;
    for (const key of step.fields) {
      const id = `${i}:${key}`, field = key === "negative_prompt" ? "negative" : key;
      const label = `${labels[field]} · ${step.source}`, value = step.values[key];
      if (key === "characters") {
        let issue = !Array.isArray(value) ? "来源没有角色参数" : !sameValue(initial.characters, draft.base.form.characters ?? []) || initial.placement !== draft.base.form.placement ? "角色组已在外部修改" : "";
        if (now.boardPresent === false) issue = "来源画板已删除";
        const chars = Array.isArray(value) ? structuredClone(value) as typeof working.characters : [];
        chars.forEach(c => { c.id = `c${allocation++}`; });
        const enabled = !options.off.has(id);
        checked.push({ id, label: `角色组 · ${step.source}`, kind: "rewrite", enabled, issue, aligned: false, before: roleGroupText(working.characters, working.placement), after: roleGroupText(chars, step.values.placement === "manual" ? "manual" : "auto") });
        if (enabled && !issue) { working.characters = chars; working.placement = step.values.placement === "manual" ? "manual" : "auto"; }
        continue;
      }
      if (key === "prompt" || key === "negative_prompt") {
        if (value !== undefined) { checkText(id, key === "prompt" ? "image.prompt" : "image.negative", "rewrite", "", String(value), label); continue; }
      }
      const samplers = [...new Set([...now.samplers, ...Object.values(now.samplersByModel ?? {}).flat()])];
      const { changes } = prepareDrawingFields({ [key]: value }, now.models, samplers);
      const after = changes[field], before = working[field];
      let issue = value === undefined ? "来源没有此参数" : after === undefined ? "当前模型或采样器不可用" : "";
      if (!sameValue(initial[field], draft.base.form[field]) && !sameValue(initial[field], after)) issue ||= "此参数已在外部修改";
      if ((field === "width" || field === "height") && (typeof after !== "number" || after < 64 || after > 2048 || after % 64)) issue ||= "尺寸须为 64–2048 且对齐 64px";
      if (field === "batchCount" && (typeof after !== "number" || !Number.isInteger(after) || after < 1)) issue ||= "批次数无效";
      if (field === "seed" && after !== "" && (!/^\d+$/.test(String(after)) || Number(after) > 4294967295)) issue ||= "种子无效";
      const enabled = !options.off.has(id);
      checked.push({ id, label, kind: "parameter", enabled, issue, aligned: !sameValue(initial[field], draft.base.form[field]), before: String(before), after: String(after ?? value ?? "—"),
        displayBefore: field === "naiMode" ? before === "furry" ? "Furry" : "Anime" : field === "model" ? resolveModel(now.models, String(before))?.name : field === "sampler" ? samplerName(before) : undefined,
        displayAfter: field === "naiMode" ? after === "furry" ? "Furry" : "Anime" : field === "model" ? resolveModel(now.models, String(after))?.name : field === "sampler" ? samplerName(after) : undefined });
      if (enabled && !issue && after !== undefined) Object.assign(working, { [field]: after });
    }
  });
  const allowedSamplers = now.samplersByModel?.[working.model] ?? now.samplers;
  const model = resolveModel(now.models, working.model);
  const samplerConflict = (working.model !== initial.model || working.sampler !== initial.sampler) && !naiCapabilities(working.model).medium && !allowedSamplers.includes(working.sampler);
  const sizeConflict = !options.editing && model && (working.width !== initial.width || working.height !== initial.height || working.model !== initial.model) && sizeProblem(working.width, working.height, model.maxPixels).fatal;
  if (samplerConflict || sizeConflict) {
    // These four fields form one constraint group. Reverting only the model
    // could leave a sampler that the original model cannot accept.
    const issue = samplerConflict ? "目标模型不支持此采样器，请同时核对模型与采样器" : "组合尺寸超出目标模型范围";
    for (let i = 0; i < checked.length; i++) if (/:model$|:sampler$|:width$|:height$/.test(checked[i].id) && checked[i].enabled) checked[i] = { ...checked[i], issue: checked[i].issue || issue };
    working.model = initial.model; working.sampler = initial.sampler;
    working.width = initial.width; working.height = initial.height;
  }
  // Explicit parameter proposals are one constraint group, including model-dependent fields.
  const direct = draft.steps.some(s => s.kind === "params_patch");
  if (direct) {
    const keys = new Set<ParameterKey>();
    draft.steps.forEach((s, i) => { if (s.kind === "params_patch") for (const key of Object.keys(s.params) as ParameterKey[]) if (!options.off.has(`${i}:${key}`)) keys.add(key); });

    const issue = [...keys].map(key => parameterIssue(key, working, model)).find(Boolean);
    if (issue) for (let i = 0; i < checked.length; i++) if (checked[i].enabled && checked[i].kind === "parameter") checked[i] = { ...checked[i], issue: checked[i].issue || issue };
    if (checked.some(s => s.enabled && s.issue)) Object.assign(working, structuredClone(initial));
  }
  const cap = characterCapability(working.model);
  if (cap.max && working.characters.filter(c => c.on).length > cap.max && (!sameValue(initial.characters, working.characters) || initial.model !== working.model)) {
    for (let i = 0; i < checked.length; i++) checked[i] = { ...checked[i], issue: checked[i].issue || `当前模型最多 ${cap.max} 个启用角色` };
    Object.assign(working, structuredClone(initial));
  }
  if (workspace === "image" && now.boardPresent === false && draft.steps.some(s => s.kind !== "slate_edit")) { for (let i = 0; i < checked.length; i++) checked[i] = { ...checked[i], issue: "来源画板已删除" }; Object.assign(working, initial); }
  if (slate) {
    if (slateStep?.captureRecipe && slate.after?.golden_recipe) slate.after.golden_recipe.form = boardForm(working);
    const row = checked.find(s => s.kind === "slate")!;
    const at = checked.indexOf(row); checked[at] = { ...row, after: `${slateStep?.unlockRecipe ? "本次明确解锁配方并更新\n" : ""}${describe(slate.after)}` };
    for (let i = 0; i < checked.length; i++) checked[i] = { ...checked[i], locked: true };
    if (checked.some(s => s.issue)) { Object.assign(working, structuredClone(initial)); slate = undefined; }
    else if (contentKey(slate.before) === contentKey(slate.after)) slate = undefined;
  }
  if (files.length) { if (options.off.size) for (let i = 0; i < checked.length; i++) checked[i] = { ...checked[i], issue: checked[i].issue || "文件与画板是一个组合，请整体应用或重新提议" }; for (let i = 0; i < checked.length; i++) checked[i] = { ...checked[i], locked: true }; if (checked.some(step => step.issue)) { Object.assign(working, structuredClone(initial)); slate = undefined; } }
  const changes = (Object.keys(working) as Field[]).filter((field) => !sameValue(working[field], initial[field])).map((field) => ({ field, before: initial[field], after: working[field] }));
  const plan = { boardId: slate && !changes.length && !draft.newBoardName ? undefined : draft.base.boardId, boardName: now.boardName, ...(draft.newBoardName === undefined ? {} : { newBoardName: draft.newBoardName }), title: draft.title, workspace, conversationId: draft.base.conversationId, steps: checked, changes, aligned, ...(files.length ? { files } : {}), ...(slate ? { slate } : {}) };
  return { ...plan, fingerprint: hash(canonical(plan)) };
}

function validateBranch(draft: Draft, now: DraftState, options: ValidateOptions): DraftPlan {
  const step = draft.steps[0];
  if (step.kind !== "chat_distill_branch" || !draft.base.chat) throw new Error("分支草稿无效");
  const base = draft.base.chat, image = chatImage(base, step.source);
  if (!image) throw new Error("分支起点不在本轮快照中");
  const issue = now.conversationId !== draft.base.conversationId ? "当前对话已切换" : now.chat?.key !== base.key ? "会话或上下文已变化，请重新提议" : "";
  const exclude = options.off.has("0:exclude") ? [] : step.exclude;
  const before = base.selection, after = { ...before, headId: image.source.turnId, mainId: image.assetId,
    skipTurnIds: [...new Set([...before.skipTurnIds, ...exclude.flatMap((id) => chatTurn(base, id)?.turnId ?? [])])],
    prompt: options.off.has("0:text") ? before.prompt : step.text };
  const steps: CheckedStep[] = [
    { id: "0:source", label: `从 ${step.source} 准备新分支`, kind: "branch", locked: true, enabled: true, issue, aligned: false, before: "当前起点", after: step.source },
    { id: "0:exclude", label: "排除历史文字", kind: "branch", enabled: !options.off.has("0:exclude"), issue, aligned: false, before: "保留现有勾选", after: step.exclude.join("、") || "无额外排除" },
    { id: "0:text", label: "填入描述，等你发送", kind: "rewrite", enabled: !options.off.has("0:text"), issue, aligned: false, before: before.prompt, after: step.text },
  ];
  const branch = !issue && canonical(before) !== canonical(after) ? { before, after, key: base.key } : undefined;
  const plan = { title: draft.title, workspace: "chat" as const, conversationId: draft.base.conversationId, steps,
    changes: branch && before.prompt !== after.prompt ? [{ field: "composer" as const, before: before.prompt, after: after.prompt }] : [], aligned: !!issue, ...(branch ? { branch } : {}) };
  return { ...plan, fingerprint: hash(canonical(plan)) };
}

function validateHandoff(draft: Draft, now: DraftState, options: ValidateOptions): DraftPlan {
  const step = draft.steps[0], model = draft.base.chatModel, live = now.chatModel;
  if (step.kind !== "chat_handoff" || !model) throw new Error("交接草稿无效");
  const stale = !live || live.id !== model.id ? "对话模型已变化，请重新提议" : "", on = (id: string) => !options.off.has(id);
  const steps: CheckedStep[] = [
    { id: "0:new", label: "新开对话", kind: "handoff", locked: true, enabled: true, issue: stale, aligned: false, before: "", after: model.name },
    ...step.images.map((image, i): CheckedStep => ({ id: `0:image:${i}`, label: "参考图", kind: "handoff", enabled: on(`0:image:${i}`),
      issue: stale || (options.has?.(image) === false ? "图片已移除" : ""), aligned: false, before: "", after: image.label })),
    ...Object.entries(step.options).map(([key, value]): CheckedStep => {
      const field = live?.writable[key];
      return { id: `0:option:${key}`, label: chatOptionNames[key] ?? key, kind: "parameter", enabled: on(`0:option:${key}`),
        issue: stale || (field?.options.includes(value) ? "" : "当前模型不支持此值"), aligned: false, before: field?.value ?? "", after: value,
        displayBefore: field ? chatOptionLabel(field.value) : "—", displayAfter: chatOptionLabel(value) };
    }),
    { id: "0:text", label: "对话输入框", kind: "rewrite", enabled: on("0:text"), issue: stale, aligned: false, before: "", after: step.text },
  ];
  const usable = (id: string) => steps.some((s) => s.id === id && s.enabled && !s.issue);
  const images = step.images.filter((_, i) => usable(`0:image:${i}`)), body = usable("0:text") ? step.text : "";
  const handoff = body || images.length
    ? { model: model.id, options: Object.fromEntries(Object.entries(step.options).filter(([key]) => usable(`0:option:${key}`))), text: body, images }
    : undefined;
  const plan = { title: draft.title, workspace: "chat" as const, conversationId: draft.base.conversationId, steps,
    changes: body ? [{ field: "composer" as const, before: "", after: body }] : [], aligned: !!stale, ...(handoff ? { handoff } : {}) };
  return { ...plan, fingerprint: hash(canonical(plan)) };
}
