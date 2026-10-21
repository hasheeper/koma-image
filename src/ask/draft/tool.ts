import type { ToolEntry } from "../tools.ts";
import { parseDraft } from "./validate.ts";
import { restoreKeys } from "./types.ts";

export const proposeDraft: ToolEntry = {
  tool: {
    name: "propose_draft",
    description: "提交一份待用户确认的草稿，本轮立即结束；不会写入或生成。一份草稿只针对一个工作区。base_hash 必须用本轮初始快照值。局部 replace/before/after 用唯一 anchor；append 追加原样 text；rewrite 为完整新文本。restore_partial 只能选来源图已有字段，不能自造参数值。",
    schema: {
      type: "object", additionalProperties: false, required: ["base_hash", "title", "steps"],
      properties: {
        base_hash: { type: "string" }, title: { type: "string", minLength: 1, maxLength: 120 },
        steps: { type: "array", minItems: 1, maxItems: 12, items: { anyOf: [
          { type: "object", additionalProperties: false, required: ["kind", "target", "mode", "text"], properties: {
            kind: { const: "prompt_patch" }, target: { type: "string", description: "image.prompt、image.negative、chat.composer；image.char.N.prompt/negative 预留，目标不存在时作废" },
            mode: { enum: ["replace", "before", "after", "append", "rewrite"] }, anchor: { type: "string", maxLength: 24000 }, text: { type: "string", maxLength: 24000 },
          } },
          { type: "object", additionalProperties: false, required: ["kind", "source", "fields"], properties: {
            kind: { const: "restore_partial" }, source: { type: "string", description: "本轮图片 ID，如 #h1" }, fields: { type: "array", minItems: 1, uniqueItems: true, items: { enum: [...restoreKeys] } },
          } },
        ] } },
      },
    },
  },
  verb: "整理", object: () => "草稿", final: true,
  run(input, context) {
    if (!context.draftBase) throw new Error("本轮草稿快照不可用");
    const draft = parseDraft(input, context.draftBase, context.question ?? "", context.library ?? []);
    return { content: [{ type: "text", text: "草稿已交给用户核对；尚未应用，未生成或发送。" }], stat: `${draft.steps.length} 步待确认`, draft };
  },
};
