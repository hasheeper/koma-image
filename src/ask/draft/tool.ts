import type { ToolEntry } from "../tools.ts";
import { parseDraft } from "./validate.ts";
import { draftSchema } from "./schema.ts";

export const proposeDraft: ToolEntry = {
  tool: {
    name: "propose_draft",
    description: "提交一份待用户确认的草稿，随后停止工具调用；不会写入或生成。必须同时用简短正文说明改动。一份草稿只针对一个工作区。save_ref 将 recipe（提议时画板）、memo（text 原文）或 slate（提议时活动清单）作为文件加入同卡，确认后写 refs/，未挂载时下载；可填 document_title，不能指定路径、覆盖或运行命令。slate_edit 可新建或推进本地任务板：已有任务需要 slate_id 和 expected_version，创建标题使用 slate_title、todo_title，新 Todo ID 本机分配；图像任务完成必须同时 bind 本轮 #h/#f，绑定明确 caption_source（base/sent/character）与 caption_mode（full/strip_syntax）。锁定配方修改须显式 unlock；capture_current 保存同稿修改后的完整画板配方。可与 IMAGE prompt_patch/params_patch 同稿整体确认；directory_required 仅在用户要求目录已交付时设 true。完整任务详情用 get_state(include_slate=true)。base_hash 必须用本轮初始快照值。局部 replace/before/after 用唯一 anchor；append 追加原样 text；rewrite 为完整新文本。params_patch.params 可直接建议安全表单参数，使用状态中的型号能力，Seed 为字符串、空串随机；不会报价或生成。restore_partial 只能选来源图已有字段，characters 恢复整组角色和定位。character_edit 的 add 自带完整 prompt/negative/on 和可选位置，本地分配 ID；不要在同份草稿 patch 新增角色。add/set_position 的坐标不自动开启手动定位；当前为 auto 且需要坐标生效时，同草稿另加 kind=character_edit、op=set_placement、placement=manual 的步骤。set_position 将该角色的位置替换为单中心，与界面选点一致。草稿始终以本轮源画板为基底，读取其他画板不改变基底。IMAGE 可用 new_board_name 提议复制源画板后应用到具名新画板；省略则默认写回源画板。两者都需用户点击确认，不会立即创建画板。chat_handoff 必须是草稿唯一步骤：确认后新开 CHAT 会话（复用空白会话），写入参考图、尺寸类选项和输入框，不发送、不报价；在 IMAGE／TAGS 提问时写入 CHAT 只能用它。",
    schema: draftSchema,
  },
  verb: "整理", object: () => "草稿", final: true,
  run(input, context) {
    if (!context.draftBase) throw new Error("本轮草稿快照不可用");
    const draft = parseDraft(input, context.draftBase, context.library ?? [], context.question);
    return { content: [{ type: "text", text: "草稿已交给用户核对；尚未应用，未生成或发送。" }], stat: `${draft.steps.length} 步`, draft };
  },
};
