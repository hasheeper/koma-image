import { fileSchema } from "./file-schema.ts";
import { slateEditSchema } from "../../slate/edit.ts";
import { restoreKeys } from "./types.ts";
import { chatSizeKeys } from "../../domain/chat-options.ts";
import { parameterSchema } from "./parameters.ts";

/** Shared wire schema for the ASK tool and external JSON. */
export const draftSchema = {
      type: "object", additionalProperties: false, required: ["base_hash", "draft_title", "steps"],
      properties: {
        // Avoid `title`: relays may strip schema metadata even inside properties.
        base_hash: { type: "string" }, draft_title: { type: "string", description: "草稿标题", minLength: 1, maxLength: 120 },
        new_board_name: { type: "string", description: "仅 IMAGE：填写即锁定目标为此名称的新画板，确认时复制来源画板并写入草稿；不会提供写回来源画板的选项。由本次回复直接给出简短场景／主题名，建议 4–12 字；与 draft_title 的改动摘要分开。省略则默认应用到来源画板，用户可在应用菜单选择新画板。", minLength: 1, maxLength: 80 },
        steps: { type: "array", minItems: 1, maxItems: 12, items: { anyOf: [
          slateEditSchema, fileSchema,
          { type: "object", additionalProperties: false, required: ["kind", "params"], properties: { kind: { type: "string", enum: ["params_patch"] }, params: parameterSchema } },
          { type: "object", additionalProperties: false, required: ["kind", "target", "mode", "text"], properties: {
            kind: { type: "string", enum: ["prompt_patch"] }, target: { type: "string", description: "image.prompt、image.negative、chat.composer（仅在 CHAT 提问时）；角色文本如 image.char.c2.prompt 或 image.char.c2.negative，c2 替换为状态中的稳定角色 ID，目标不存在时作废" },
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
            kind: { type: "string", enum: ["chat_distill_branch"] }, source: { type: "string", description: "仅在 CHAT 提问时可用。当前分支、该轮选中版本内的已完成图片 ID，如 #c2.1 或 #c2.1.2" },
            exclude: { type: "array", items: { type: "string" }, description: "从 get_chat_context 读取的当前分支轮次 ID；仅排除其文字" }, text: { type: "string", maxLength: 24000 },
          } },
          { type: "object", additionalProperties: false, required: ["kind", "images", "options", "text"], properties: {
            kind: { type: "string", enum: ["chat_handoff"] },
            images: { type: "array", items: { type: "string" }, description: "作为新会话参考图的 #h、#f 或 #cN.M[.K]，按顺序，数量不超过 chat_model.max_images；可为空" },
            options: { type: "object", additionalProperties: false, description: "仅填 chat_model.writable 中出现的键，值取其 options；quality 等只读项不能写入", properties: Object.fromEntries(chatSizeKeys.map((key) => [key, { type: "string" }])) },
            text: { type: "string", minLength: 1, maxLength: 24000, description: "新会话输入框文字，不会发送" },
          } },
        ] } },
      },
    };
