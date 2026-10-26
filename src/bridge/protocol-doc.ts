import { draftSchema } from "../ask/draft/schema.ts";
import { DRAFT_SCHEMA, LIVE_SCHEMA } from "./protocol.ts";
export function protocolDocument() {
  return `# Koma 外部协同协议（B1–B3）

状态：${LIVE_SCHEMA}；草稿：${DRAFT_SCHEMA}。
无需配置 ASK 文本推理 Key；前台近实时同步。未经用户选择，不向外部工程目录写出原图。

## 文件

- Koma 写 PROTOCOL.md、state.live.json 与 live/*.webp。不要编辑这些文件。
- 外部将完整 JSON 写入 draft.inbox.json。建议先写临时文件再替换；Koma 不删除收件文件。
- refs/ 放共享文本与图片资料；Koma 只索引文件名和字节数，按 ASK read_ref 请求读取正文；手动附件使用原生文件选择器。
- slates/*.slate.json 使用 koma.bridge.slate.v1，完整 slate 与 Koma 维护的 deliveries 分开；外部变更须经草稿审阅。
- 挂载映射活动任务板和已绑成果；挂载期间手动新建或确认草稿创建的活动任务板自动加入，其他已有任务板显式加入。assets/ 只写用户选中的原图、同名 .json 参数回执与 .txt 标注。

## 共享资料与导出

state.live.json 和 ASK 初始状态的 refs_index 仅含清单，不含文件正文或图片。
清单最多展示 48 项，omitted 为省略项数；扫描上限为 512 个支持的文件、4096 项目录条目、8 层子目录。
limited=true 表示还有文件未扫描，total 此时仅为已发现数量。只扫描 refs/，不接受父级或绝对路径，隐藏及已知凭据文件不读取。
ASK 可按完整相对路径调用 read_ref；同名须消歧，文本每次最多 8000 字符，同轮续读固定版本。
本地附件和工具读取共享附件数量、大小与文本限制，工具读图共享视觉预算；实际读取内容随收藏会话保存，目录修改不回改历史。
文件保存使用共享草稿步骤 save_ref，document 为 recipe/memo/slate，可选 document_title（最长 80 字符）；memo 必须带 text（最多 24000 字符）。
配方固定 JSON（koma.bridge.recipe.v1），备忘录固定 Markdown，任务交接资料固定 JSON（koma.bridge.slate.v1）。
recipe/slate 冻结提议时的画板/任务快照，不是同稿应用后的结果，也不是出图回执；本机参考资产不附原图和编码。
文件在 DraftCard 的文件行中审阅，用户统一确认后保存。不能指定路径、格式或覆盖文件；文件名自动生成唯一后缀。
挂载时目标固定为该目录 refs/，未挂载时固定为浏览器下载。原目录失联、改变或权限失效时阻断整稿，不静默改为下载。
写入失败保留草稿并补偿本次文件；撤销仅删除仍属于本次操作且未被修改的 refs 文件。已经发起的下载不能收回。
写入 refs/ 后刷新清单，不额外调用推理。

## 提交

外层字段为 schema、draft_id（1–120 位字母、数字、下划线、点或短横线）、可选 source_label。
其余正文直接使用下方 propose_draft Schema。外部支持 IMAGE 的 prompt_patch、character_edit、restore_partial、params_patch 、slate_edit 与 save_ref；不能写 CHAT。
缺失 base_hash 时按收件当刻活动 IMAGE 画板的实时状态冻结；显式 base_hash 须匹配本页已导出的基底，过期请重新导出。
引用 #h/#f 必须另附 state.live.json 中的 picture_scope_id。它仅是投递元数据，不是步骤字段。
编号目录包含尺寸、Seed 与短摘录；restore_partial 的真实恢复值由 Koma 读取，不能提交 values。
params_patch.params 仅允许 Schema 白名单参数，使用表单字段 cfgRescale，Seed 为字符串，空串随机、"0" 合法。
角色目标使用 image.char.c1.prompt 等稳定 ID；插入方式用 after，不使用 ops 或 insert_after。
prompt_patch 的 rewrite 替换目标全文，append 追加文本；replace/before/after 是局部修改，必须提供在目标中恰好出现一次的非空 anchor。空 Prompt 应使用 rewrite 或 append。

\`\`\`json
${JSON.stringify({ schema: DRAFT_SCHEMA, draft_id: "example-001", source_label: "外部助手", draft_title: "补充光线", steps: [{kind:"prompt_patch",target:"image.prompt",mode:"append",text:", warm evening light"}] }, null, 2)}
\`\`\`

## 回执与确认

仅读取 state.live.json.last_inbox_receipt：draft_id、status（pending/applied/dismissed/invalid）、可选 error。
pending 表示等待或审阅；applied 表示用户勾选部分已保存，不代表已生成，也不保证用户后来没有撤销。
ASK 忙或已有草稿时排队，绝不覆盖原草稿。用户确认后才应用，可应用到新画板、可撤销，所有生成仍由用户自己操作。
同 ID 同正文幂等；更改正文使用新 draft_id。收到本 ID 的终态后再投下一份。单文件不保证多个写入方无损排队。
坏 JSON 静默重读一次，不吞掉后续完整版本。未收藏的 pending 草稿刷新失效，必须基于新状态重新投递。

## 状态与图片

boards/form 保留画板与表单字段；selected_image/recent_history.params 是该图已有的真实参数，缺失字段不补造。
历史与收藏索引分别在 history_index、favorites_index；它们不代表原图已持久化。
最多导出选中图和最近三张历史的去重预览，最长边 768。文本变更不重新编码。
手动状态 JSON 中 preview 为 null 时没有附带可读预览文件。本机参考资产 ID 不代表外部已获得原图或 Vibe 编码。
只应有一个 Koma 写入者；跨来源页面、应用或外部程序没有共享文件锁保证。

## 默认本地任务与目录交付

任务板无需目录或 ASK Key。active_slate 为轻量摘要，完整任务/配方位于 slates 文件；内置 ASK 使用 get_state(include_slate=true) 按需读取。
挂载自动加入当刻的活动任务板；挂载期间手动新建或经草稿确认创建的活动任务板也自动加入。通过外部任务文件创建时沿用原文件映射，不重复生成任务文件。切换到其他已有且未映射的任务板，仍需点击「同步到当前目录」。同步失败或尚未完成时 active_slate 摘要不代表任务文件已经写出；请检查 slates/，可用摘要中的 ID/版本继续提交草稿。
slate_edit 的 op 为 create/update/delete；现有目标带 slate_id 和 expected_version。创建使用 slate_title，Todo 标题用 todo_title，避免兼容中转剥离 Schema 的 title 元数据。每份草稿一个 slate_edit，todos 内 add/update/remove；每板最多 100 Todo、任务正文总计最多 900 KiB。新对象 ID 由本机分配。
可以在同稿记录 mutation/绑图/完成并用 prompt_patch/params_patch 准备下一张，用户整体确认。需交图任务没有绑定不能完成；锁定配方修改须显式 unlock。
绑定仅接受本轮 #h/#f，带 picture_scope_id；目标默认 assets/ 唯一路径。caption_source 明确选择 base/sent/character，caption_mode 仅 full/strip_syntax，角色须给 character_id；缺失来源不替换原文。
strip_syntax 只剥离配对 {}、[]、数字::正文:: 和无属性的配对 XML 标签；转义、畸形或其他语法保留，不筛画师名。
绑图即时保存本机原字节、SHA-256、真实尺寸和已有生成参数；目录失败保留本机任务与成果。directory_required=true 仅用于用户要求已完成目录交付的组合，文件/回执失败不报告整稿应用成功。
外部文件不可声明新的本机绑定或伪造 deliveries。现有 binding 原样保留或明确解绑；新成果使用 slate_edit.bind。新目录任务、修改或 deleted:true tombstone 都转为草稿。
修改已有任务文件须保留当前 slate.id/slate.version，版本过期或缺失拒绝接收；版本由 Koma 在确认后递增，外部不要自行递增。
路径冲突不覆盖不同原图字节，换新 target_path。交付按原图、回执、标注、任务 JSON 顺序校验，部分完成可续办。删除/撤销保留外部成果文件。目录冲突需审阅或用户明确保留本机版本。
任务/资产/画板通过提交记录补偿和恢复，跨文件/跨存储并非原生原子事务；外部程序不共享浏览器锁。

## 共享草稿 Schema

此处直接由站内工具定义生成；CHAT 分支仅供站内 ASK 使用。

\`\`\`json
${JSON.stringify(draftSchema, null, 2)}
\`\`\`
`;
}
