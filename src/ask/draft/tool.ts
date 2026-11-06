import type { ToolEntry } from "../tools.ts";
import { parseDraft, validateDraft } from "./validate.ts";
import { isGenerativeEditorModel } from '../../domain/media.ts';
import { draftSchema } from "./schema.ts";
import { checkNaiInput } from "./nai-input.ts";
import { canonical } from "../canonical.ts";
import { dataBlock } from "../prompts/index.ts";

export const proposeDraft: ToolEntry = {
  tool: {
    name: "propose_draft",
    description: "提议 NAI 的 IMAGE／EDIT 修改时自动校验完整候选并返回精确 Token／Text 预算摘要，无需单独检查。普通 Token 超限仅提示；硬性错误会拒绝本次草稿并返回具体原因，修正后可重新提交，只有成功才结束工具阶段。EDIT 默认修改本轮冻结编辑画板，使用 edit.* 靶点与 params_patch 编辑字段。Image 2／Gemini 等通用 EDIT 支持 edit.prompt、model、editMode 及 image_options；image_options 仅写目标型号 capabilities.parameters 声明的键，null 恢复默认、空串不发送，支持字符串/数字/布尔。来源参数需整稿确认，蒙版和外扩/羽化继续由用户操作；director_patch 仅预设工具面板。edit_handoff 将图片准备到新建/已有编辑画板，仅可组合 slate_edit，应用不跳转、不报价。IMAGE 与 EDIT 不能同稿；禁止修改蒙版、底图与底图尺寸；通用输出档位仅经 image_options 设置。提交一份待用户确认的草稿，随后停止工具调用；不会写入或生成。提交后须用正文说明改了什么、为什么。一份草稿只针对一个工作区。save_ref 将 recipe（IMAGE 提议时画板；EDIT 同稿修改后的配方）、memo（text 原文）或 slate（提议时活动清单）作为文件加入同卡，确认后写 refs/，未挂载时下载；可填 document_title，不能指定路径、覆盖或运行命令。slate_edit 可新建或推进本地任务板：已有任务需要 slate_id 和 expected_version，创建标题使用 slate_title、todo_title，新 Todo ID 本机分配；图像任务完成必须同时 bind 本轮 #h/#f/#e，绑定明确 caption_source（base/sent/character）与 caption_mode（full/strip_syntax）。锁定配方修改须显式 unlock；capture_current 保存同稿修改后的完整画板配方。可与 IMAGE prompt_patch/params_patch 同稿整体确认；directory_required 仅在用户要求目录已交付时设 true。完整任务详情用 get_state(include_slate=true)。base_hash 必须用本轮初始快照值。局部 replace/before/after 用唯一 anchor；append 追加原样 text；rewrite 为完整新文本。params_patch.params 可直接建议安全表单参数，使用状态中的型号能力，Seed 为字符串、空串随机；不会报价或生成。restore_partial 只能选来源图已有字段，characters 恢复整组角色和定位。character_edit 的 add 自带完整 prompt/negative/on 和可选位置，本地分配 ID；不要在同份草稿 patch 新增角色。add/set_position 的坐标不自动开启手动定位；当前为 auto 且需要坐标生效时，同草稿另加 kind=character_edit、op=set_placement、placement=manual 的步骤。set_position 将该角色的位置替换为单中心，与界面选点一致。草稿始终以本轮源画板为基底，读取其他画板不改变基底。IMAGE 可用 new_board_name 提议复制源画板后应用到具名新画板；省略则默认写回源画板。两者都需用户点击确认，不会立即创建画板。chat_handoff 必须是草稿唯一步骤：确认后新开 CHAT 会话（复用空白会话），写入参考图、尺寸类选项和输入框，不发送、不报价；在 IMAGE／TAGS 提问时写入 CHAT 只能用它。",
    schema: draftSchema,
  },
  verb: "整理", object: () => "草稿", final: true,
  async run(input, context) {
    if (!context.draftBase) throw new Error("本轮草稿快照不可用");
    const draft = parseDraft(input, context.draftBase, context.library ?? [], context.question);
    const candidate=draft.editHandoff?.proposal??draft, edit=candidate.base.edit;
    if(candidate.target==='edit'&&edit) {
      const plan=validateDraft(candidate,candidate.base,{off:new Set()});
      const config=plan.edit?.after??edit.config;
      if(isGenerativeEditorModel(edit.models.find(m=>m.id===config.chosen[config.upscaleOpen?'upscale':config.mode]))||candidate.steps.some(s=>s.kind==='edit_config'&&s.params.image_options!==undefined)) {
        const errors=[...new Set(plan.steps.filter(s=>s.enabled&&s.issue).map(s=>s.issue))];
        if(errors.length)return {error:true,reason:errors.join('；'),stat:'编辑参数校验未通过',content:[{type:'text',text:`草稿尚未接纳，请按当前来源能力修正后重新提交：${errors.join('；')}`}]};
      }
    }
    const checked = await (context.checkNaiInput ?? checkNaiInput)(draft);
    context.signal?.throwIfAborted();
    const budget = checked ? [{ type: 'text' as const, text: dataBlock(canonical(checked)) }] : [];
    if (checked && !checked.ok) return { error: true, reason: checked.errors.join('；'), stat: '输入校验未通过',
      content: [{ type: 'text', text: '草稿尚未接纳。请按以下错误修正后重新调用 propose_draft；不要重复提交未修正的草稿。' }, ...budget] };
    const status = !checked ? '' : ['ready', 'not_applicable'].includes(String(checked.input_budget.status)) ? ' · 输入已检查' : ' · Token 预算未核验';
    return { content: [{ type: "text", text: "草稿已交给用户核对；尚未应用，未生成或发送。" }, ...budget], stat: `${draft.steps.length} 步${status}`, draft };
  },
};
