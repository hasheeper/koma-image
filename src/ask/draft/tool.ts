import type { ToolEntry } from "../tools.ts";
import { parseDraft } from "./validate.ts";
import { restoreKeys } from "./types.ts";

export const proposeDraft: ToolEntry = {
  tool: {
    name: "propose_draft",
    description: "提交一份待用户确认的草稿，随后停止工具调用；不会写入或生成。必须同时用简短正文说明改动。一份草稿只针对一个工作区。base_hash 必须用本轮初始快照值。局部 replace/before/after 用唯一 anchor；append 追加原样 text；rewrite 为完整新文本。restore_partial 只能选来源图已有字段，characters 恢复整组角色和定位。character_edit 的 add 自带完整 prompt/negative/on 和可选位置，本地分配 ID；不要在同份草稿 patch 新增角色。add/set_position 的坐标不自动开启手动定位；当前为 auto 且需要坐标生效时，同草稿另加 kind=character_edit、op=set_placement、placement=manual 的步骤。set_position 将该角色的位置替换为单中心，与界面选点一致。草稿始终以本轮源画板为基底，读取其他画板不改变基底。IMAGE 可用 new_board_name 提议复制源画板后应用到具名新画板；省略则默认写回源画板。两者都需用户点击确认，不会立即创建画板。",
    schema: {
      type: "object", additionalProperties: false, required: ["base_hash", "draft_title", "steps"],
      properties: {
        // Avoid `title`: relays may strip schema metadata even inside properties.
        base_hash: { type: "string" }, draft_title: { type: "string", description: "草稿标题", minLength: 1, maxLength: 120 },
        new_board_name: { type: "string", description: "仅 IMAGE：填写即锁定目标为此名称的新画板，确认时复制来源画板并写入草稿；不会提供写回来源画板的选项。由本次回复直接给出简短场景／主题名，建议 4–12 字；与 draft_title 的改动摘要分开。省略则默认应用到来源画板，用户可在应用菜单选择新画板。", minLength: 1, maxLength: 80 },
        steps: { type: "array", minItems: 1, maxItems: 12, items: { anyOf: [
          { type: "object", additionalProperties: false, required: ["kind", "target", "mode", "text"], properties: {
            kind: { type: "string", enum: ["prompt_patch"] }, target: { type: "string", description: "image.prompt、image.negative、chat.composer；角色文本如 image.char.c2.prompt 或 image.char.c2.negative，c2 替换为状态中的稳定角色 ID，目标不存在时作废" },
            mode: { type: "string", enum: ["replace", "before", "after", "append", "rewrite"] }, anchor: { type: "string", maxLength: 24000 }, text: { type: "string", maxLength: 24000 },
          } },
          { type: "object", additionalProperties: false, required: ["kind", "source", "fields"], properties: {
            // parseDraft deduplicates fields; omit uniqueItems for Gemini relays.
            kind: { type: "string", enum: ["restore_partial"] }, source: { type: "string", description: "工作区图片 ID，如 #h1；#a 附件参数仅供参考，不能作恢复来源" }, fields: { type: "array", minItems: 1, items: { type: "string", enum: [...restoreKeys] } },
          } },
          { type: "object", additionalProperties: false, required: ["kind", "op"], properties: {
            kind: { type: "string", enum: ["character_edit"] }, op: { type: "string", enum: ["add", "remove", "reorder", "set_enabled", "set_position", "set_placement"] },
            id: { type: "string", description: "现有角色稳定 ID，如 c2" }, ids: { type: "array", items: { type: "string" }, description: "reorder 使用完整角色 ID 排列" },
            prompt: { type: "string", maxLength: 24000 }, negative: { type: "string", maxLength: 24000 }, on: { type: "boolean" },
            cell: { type: "string", description: "V4.5 位置 A1–E5" }, x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, placement: { type: "string", enum: ["auto", "manual"] },
          } },
          { type: "object", additionalProperties: false, required: ["kind", "source", "exclude", "text"], properties: {
            kind: { type: "string", enum: ["chat_distill_branch"] }, source: { type: "string", description: "当前分支的已完成图片 ID，如 #c2.1" },
            exclude: { type: "array", items: { type: "string" }, description: "从 get_chat_context 读取的当前分支轮次 ID；仅排除其文字" }, text: { type: "string", maxLength: 24000 },
          } },
        ] } },
      },
    },
  },
  verb: "整理", object: () => "草稿", final: true,
  run(input, context) {
    if (!context.draftBase) throw new Error("本轮草稿快照不可用");
    const draft = parseDraft(input, context.draftBase, context.library ?? [], context.question);
    return { content: [{ type: "text", text: "草稿已交给用户核对；尚未应用，未生成或发送。" }], stat: `${draft.steps.length} 步`, draft };
  },
};
