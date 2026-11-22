import {layerSchemas} from './layer.ts';
import { editReferencesSchema, editReferencesStepSchema } from './edit-references.ts';
import { editParameterProperties,directorSchema,focusSchema } from "./edit-schema.ts";
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
        steps: { type: "array", description: "按数组顺序执行；后续文本锚点必须匹配前序步骤修改后的文本，不能引用已被替换或删除的片段。没有实际修改时直接回复，不要凑写空步骤。", minItems: 1, maxItems: 12, items: { anyOf: [
          slateEditSchema, fileSchema, directorSchema,
          {type:'object',additionalProperties:false,required:['kind','image'],properties:{kind:{type:'string',enum:['edit_handoff']},image:{type:'string',description:'#h/#f/#c/#e 图片编号'},mode:{type:'string',enum:['img2img','inpaint','upscale']},inpaint_kind:{type:'string',enum:['normal','focused']},prompt:{type:'string',maxLength:24000},negative:{type:'string',maxLength:24000},params:{type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries({...parameterSchema.properties,...editParameterProperties}).filter(([key])=>!['width','height','batchCount','editMode','inpaintKind','focusRect'].includes(key)))},focus_rect:focusSchema,director_tool:{...directorSchema,required:['tool'],properties:Object.fromEntries(Object.entries(directorSchema.properties).filter(([key])=>key!=='kind'))}}},
          { type: "object", additionalProperties: false, required: ["kind", "params"], properties: { kind: { type: "string", enum: ["params_patch"] }, params: {...parameterSchema,properties:{...parameterSchema.properties,...editParameterProperties}} } },
          { type: "object", additionalProperties: false, required: ["kind", "target", "mode", "text"], properties: {
            kind: { type: "string", enum: ["prompt_patch"] }, target: { type: "string", description: "edit.prompt、edit.negative、edit.char.c2.prompt（仅 EDIT）；image.prompt、image.negative、chat.composer（仅在 CHAT 提问时）；角色文本如 image.char.c2.prompt 或 image.char.c2.negative，c2 替换为状态中的稳定角色 ID，目标不存在时作废" },
            mode: { type: "string", enum: ["replace", "before", "after", "append", "rewrite"] }, anchor: { type: "string", description: "replace/before/after 必须在前序步骤执行后的目标文本中唯一匹配；append/rewrite 不需要。", maxLength: 24000 }, text: { type: "string", description: "原样写入。replace 的空串表示删除锚点片段，rewrite 的空串表示清空字段；before/after/append 的空串会被忽略，空格不会被忽略。", maxLength: 24000 },
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
            kind: { type: "string", enum: ["chat_distill_branch"] }, source: { type: "string", description: "仅在 CHAT 提问时可用。本轮已读取的已完成图片 ID，可为版本演进读到的旧分支或未选中版本，如 #c2.1、#c2.1b 或带会话号的 #c1:2.1。仅切换当前会话到该具体版本，不新建、不发送。" },
            exclude: { type: "array", items: { type: "string" }, description: "从 get_chat_context 读取的当前分支轮次 ID；仅排除其文字" }, text: { type: "string", maxLength: 24000 },
          } },
          { type: "object", additionalProperties: false, required: ["kind", "images", "options", "text"], properties: {
            kind: { type: "string", enum: ["chat_handoff"] },
            images: { type: "array", items: { type: "string" }, description: "作为新会话参考图的 #h、#f、#e 或 #c 图片编号（含带会话号的完整编号），按顺序，数量不超过 chat_model.max_images；可为空" },
            options: { type: "object", additionalProperties: false, description: "仅填 chat_model.writable 中出现的键，值取其 options；quality 等只读项不能写入", properties: Object.fromEntries(chatSizeKeys.map((key) => [key, { type: "string" }])) },
            text: { type: "string", minLength: 1, maxLength: 24000, description: "新会话输入框文字，不会发送" },
          } },
        ] } },
      },
    };

/** Internal ASK only. Bridge and manual JSON retain draftSchema above. */
export const internalDraftSchema = { ...draftSchema, properties: { ...draftSchema.properties,
  steps: { ...draftSchema.properties.steps, items: { anyOf: [...layerSchemas, editReferencesStepSchema, {
    type: 'object', additionalProperties: false, required: ['kind', 'source'], properties: {
      kind: { type: 'string', enum: ['chat_open_child'] },
      source: { type: 'string', maxLength: 64, description: '仅在 CHAT 提问且为唯一草稿步骤。使用当前对话的已完成结果图编号，只新建一个图片子区；不带入消息、底图或参考图。' },
    },
  }, ...draftSchema.properties.steps.items.anyOf.map(step => {
    if ('image' in step.properties && step.properties.kind.enum.includes('edit_handoff')) return { ...step, properties: { ...step.properties, references: editReferencesSchema, image: { type: 'string', maxLength: 1024, description: '工作区 #h/#f/#c/#e、普通图片附件 #aN 或企划根相对图片路径；使用原图作为 EDIT 底图' } } };
    if ('images' in step.properties && step.properties.kind.enum.includes('chat_handoff')) return { ...step, properties: { ...step.properties,
      destination: { type: 'string', enum: ['new', 'current'], description: '默认 new 新开对话；仅在 CHAT 提问时可用 current 更新当前对话的本轮图片组合与输入框。images 是完整组合，要保留的当前图片也需列出；不改历史轮次，不发送。' },
      base_image: { type: 'string', maxLength: 1024, description: '编辑底图，必须在 images 中。程序将它放到发送序列第 1 张，其余图片顺序不变；省略时使用 images 第一张。' },
      images: { type: 'array', items: { type: 'string', maxLength: 1024 }, description: '全部输入图片：工作区图片 ID（含 CHAT 上传图 #c1:r1）、图片附件 #aN 或企划根相对图片路径；base_image 指定其中的底图，其余按顺序作为参考图，总数不超过 chat_model.max_images。无图可为空' },
      text: { ...step.properties.text, description: '目标对话的输入框文字，不会发送。用图片 ID 说明各图用途，程序按最终图片顺序转换为第 N 张图。' },
    } };
    return step;
  })] } },
  base_image_id: { type: 'string', minLength: 1, maxLength: 32, description: '仅内置 IMAGE／EDIT：IMAGE 使用当前活动演进内的具体基底，EDIT 使用同编辑板同尺寸的原生版本。IMAGE 恢复原始配方（保留 Seed／批次）；EDIT 切换至该图为底图并恢复已记录配置，保留画布蒙版，之后执行 steps。IMAGE 确认后回拨主干基底；EDIT 只改原生配置，不移动 IMAGE 游标，不生成。不能与 new_board_name 或交接组合。CHAT 回退使用 chat_distill_branch。' },
} };
