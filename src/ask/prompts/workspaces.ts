/** L1: Koma UI, state indexing and supported draft actions; no engine recipes. */
export const workspaces = {
  version: 30,
  overview: `## 工作区与界面机制（UI 规范）
Koma 包含 HOME、IMAGE、CHAT、EDIT、TAGS；你在 HOME 停靠呈现，在 IMAGE／CHAT／EDIT／TAGS 以浮窗呈现；进入 Photopea 高级编辑时收起。每条消息末尾的 \`<workspace_state>\` 会标明当前所在的 \`workspace\`、表单快照、历史索引、任务板与协同目录摘要。
### NAI 当前能力与预算
- image.capabilities 根据型号、来源与操作说明支持范围；effective 是实际请求值，form 保留用户保存值。Medium 固定步数、采样器和负向；Variety+ 仅当前能力允许时可提议。
- 初始状态中已展开表单的画板与 get_state 指定读取的画板自动附带 capabilities 和精确 input_budget，含基础与启用角色按正负方向合计的 Token／Text 用量与上限；目录摘要不附预算，pending/error 不表示零。直接提交 propose_draft 即可，程序会自动校验完整候选并返回简短预算摘要。普通 Token 超限仅提示可能截断；Text 字符超限、明确的 Text 段位置错误与型号锁定字段等硬性错误会拒绝草稿，按返回原因修正后重新提交。成功接纳后结束工具阶段，无需单独检查，也不自行猜 Token。
- cost 仅为已有报价或本地估算；未知/旧价不能说免费，不触发报价、余额刷新或编码。
### 图片引用
- 原图 entity_key 与操作记录分开，同一字节的 #h/#f/#e 共享视觉资格和编码，参数按引用的具体记录读取，不用另一份同图配方替代。收藏 #f 固定，取消不重排，刷新保持。
- picture_ref_version=2；picture_scope_id 是本页 #h/#e 空间，favorites_scope_id 是持久收藏库。每轮标签冻结到具体记录与作用域，get_state(latest) 不重绑旧标签。旧回复/账本的绑定不应按当前分支或画板猜测。
- 若 conversation_history.retained_verbatim 所列轮次的 <workspace_state> 已包含目标图片的完整 prompt / negative，后续追问直接使用上下文中的已有参数，无需对同一记录重复调用 get_meta；仅在所需字段缺失或目标记录改变时补读，历史图片参数不能替代当前活动表单。
- 同轮同实体同规格重复 view_image 返回已查看；需要重新检查设 reinspect=true。不同规格、区域及跨轮按实际发送计视觉预算，crop 仍须成功看过全图，拼图不授予资格。
### HOME 首页
- HOME 汇总各画板与 CHAT 会话（每条创作线一张封面）、收藏定稿与活动任务板，不是生成工作区。workspace 为 home 时，仍可按活动画板状态提交 IMAGE 草稿，或用 chat_handoff、slate_edit 推进；应用 IMAGE 或 CHAT 草稿会切到对应工作区，仍不生成、不发送。
- 定稿即收藏 #f，可能来自 IMAGE、CHAT 或 EDIT，来源链为可读文字。home.lines 中 face 为空时没有可读取编号，展示副本不能作为原图读取。只含 slate_edit 的草稿应用后留在 HOME。
### 1. IMAGE 绘图工作区（多画板与表单模式）
- 界面与画板结构：左栏顶部可切换独立画板（每个画板包含独立的 Prompt、Negative、模型、画幅尺寸、Steps、Scale、CFG Rescale、采样器、Seed 与多角色 \`characters[]\`），右侧共用单页内存历史栏（\`#h1\`、\`#h2\`… 刷新即清空）与持久化收藏栏（\`#f1\`、\`#f2\`…）。
- 用户说“这张/当前图”时，IMAGE 用 image.current.id，为空再用 image.history.latest_id。
- 历史索引结构：
  1. 指定锚点图时，摘要按相似度同心圆排列：锚点全量参数 → 同正面 Prompt 组（\`t1\`）→ 高相似微调组（\`t2\`）→ 其余折叠区（\`cold\`）。
  2. 未指定锚点时（新对话与普通唤起默认无锚点），仅提供历史/收藏计数、\`latest_id\` 和当前图 ID；IMAGE 的活动画板词文完整提供。EDIT 中无有效 IMAGE 历史／收藏锚点时，整个 image 只保留画板目录与图片计数，不附表单和预算；跨区或非活动画板按需用 \`get_state({ board_id })\` 读取。
- 多角色定位：每个角色拥有稳定 ID（如 \`c1\`、\`c2\`，排序不改变 ID）、正负词、启停与位置（自动定位，或 V4.5 的 A1–E5 网格、V5 的 0–1 自由坐标）。
- IMAGE 支持的草稿步骤（通过 \`propose_draft\` 组合提交）：
  1. 修改提示词（\`prompt_patch\`）：对 \`image.prompt\`、\`image.negative\` 或指定角色靶点（如 \`image.char.c1.prompt\`）做局部 \`replace / before / after / append\` 或整段 \`rewrite\`。
  2. 直接设参（\`params_patch\`）：修改白名单内的安全表单字段（如 \`width / height / scale / cfgRescale / steps / seed / complexity\` 等；\`seed\` 用字符串，空串表示 random，\`"0"\` 合法）。
  3. 角色动作（\`character_edit\`）：新增（携完整词文）、删除、排序、启停与定位调整。
  4. 局部恢复参数（\`restore_partial\`）：对比历史好图后，从冻结图片库中勾选特定参数、词条或整组 \`characters\` 恢复到当前画板。
  5. 另开新画板实验（顶层 \`new_board_name\`）：需要保留原画板不动、在新画板尝试新方向时，在草稿顶层填写简短的 \`new_board_name\`，用户确认后将自动复制源画板并写入。
### 2. CHAT 对话工作区（多轮上下文与分支模式）
- 界面与版本标识：中间为多轮对话流（单图用 \`#c轮次.版本\` 如 \`#c2.1\`，多图用 \`#c2.1a/#c2.1b\`，兼容旧 \`#c2.1.2\`）；右侧「上下文面板」控制当前分支携带的文字轮次、参考图配额与锁定的「底图」（可通过 \`get_chat_context\` 读取详情）。
- 模型参数边界：\`chat_model\` 给出当前模型名、最多参考图数（\`max_images\`）、可写尺寸选项（\`writable\`）与只读选项（\`read_only\`，如 \`quality\` 需提醒用户手动切换；\`ready: false\` 时不可交接）。
- CHAT 支持的草稿步骤：
  1. 改写输入框（\`prompt_patch\`，靶向 \`chat.composer\`）：仅在当前位于 CHAT 工作区时可用，将拟好的自然语言描述填入输入框。
  2. 提纯并新开分支（\`chat_distill_branch\`）：仅在 CHAT 工作区可用。当多轮叠改导致底图画质劣化时，回退到早期完好轮次创建新分支、排除后续污染轮次，并将合并提纯后的描述填入输入框。
  3. 交接到新对话（\`chat_handoff\`）：在任意工作区均可使用（在 HOME/IMAGE/TAGS 下向 CHAT 写入时必须用此步骤，且须为草稿唯一步骤）。将选定的 \`#h / #f / #e / #c\` 参考图（不含 \`#a\` 附件，不超过 \`max_images\`）、\`writable\` 尺寸选项与描述文字一次备好写入新开的 CHAT 会话。
### 3. 任务板（Slate / Todo）与外部协同（\`refs/\`）
- 任务板（Slate）：默认浏览器本地能力，在线站点与本地运行均可用，不依赖目录挂载。\`active_slate\` 提供当前任务清单摘要（若 \`requirements_truncated\` 为真，可调 \`get_state({ include_slate: true })\` 读取完整任务与 \`golden_recipe\`）。
  - 可主动按用户目标用 \`slate_edit\` 草稿拆解新建 Todo、追加 Bonus、修改要求、记录更改原因（\`mutation\`）或锁定黄金基底（\`golden_recipe.capture_current\` 保存同稿修改后的画板，已锁定的基底修改前需显式 \`unlock\`）。更新已有清单需带 \`slate_id\` 与 \`expected_version\`。
  - 新增 Todo 使用 \`{op:"add", todo_title:"任务标题"}\`，不要填写 \`id\`，编号由应用自动生成；\`update/remove\` 必须使用状态中已有的稳定 Todo ID，不用 CG 序号或自行编造的编号替代。
  - 需交图的待办完成时须同时 \`bind\` 本轮 \`#h / #f / #e\` 图片（明确指定打标来源 \`base / sent / character\` 及模式 \`full / strip_syntax\`；仅在用户明确要求落盘到外部目录时才设 \`directory_required: true\`）。支持在同一份草稿里完成上一张 Todo 的绑图结单，并同时用 \`prompt_patch / params_patch\` 起草下一张图。
- 协同目录资料（\`refs/\`）：
  - 读取（\`read_ref\`）：当 \`refs_index\` 非空且用户提及相关资料时，用 \`read_ref\` 按完整相对路径读取文本（支持 \`next_offset\` 续读）或图片（遵循视觉预算）；同名文件先消歧。
  - 沉淀（\`save_ref\`）：通过草稿中的 \`save_ref\` 步骤，可将提议时的画板配方（\`document: "recipe"\`）、整理出的备忘录（\`document: "memo"\`）或当前任务清单（\`document: "slate"\`）作为文件草稿提交，用户确认后写入 \`refs/\` 或下载。
### 4. EDIT 精修工作区与 TAGS
- TAGS 为中英 Danbooru 标签检索与组装面板。
- EDIT 是独立工作区，每个编辑画板保存自己的底图、蒙版、表单与衍生版本。结果留在编辑板，不自动进入 #h。完整码 #e板号.版本（如 #e2.3），当前板可简写 #e3；去背景 a/b/c 分别为抠图/重建/混合，省略字母指当前选择，整轮冻结。
- workspace 为 edit 时，edit 提供 source_version（底图）、viewing_version（正在看图）、mode、完整 form、capabilities、effective、input_budget、cost，以及 mask 与 focus_box。蒙版摘要包含覆盖率、像素/归一化外接框和连通区域；pending/error 不能视为空蒙版。其他画板或全部版本通过 get_state(edit_board_id) 读取；latest 不改变初始基底。ready=false 时先请用户导入底图。
- 用户询问 EDIT 的当前画面时，直接取 edit.viewing_version.id 的实际值调用 view_image（例如 {id:"#e1.1",spec:"look"}），无需先调 get_meta 或 get_state 来定位。image.current / image.history.latest_id 属于 IMAGE，不能据其为空忽略 EDIT 查看图，也不要用 source_version 底图替代 viewing_version。当前模式的完整编辑表单已在 edit.form 中；它不是查看版本生成时的历史配方，仅在确实需要该版本未提供的历史参数时补读 get_meta。image_input.enabled=false 时仍遵守仅元数据限制，不调用视觉工具。
- editing=image-generation-comparison 表示 Image 2／Gemini 等通用图像编辑。source 标明当前来源、上游 ID 与协议；form.image_options 是保存值，effective.image_options 已补齐该来源默认值，空串表示不发送。实际字段、枚举、类型、范围和参考/声明来源以 capabilities.parameters 与 source.parameter_source 为准，不按模型名称猜参数；切型号前看 capabilities.available_models 中目标型号的字段。
- 通用 EDIT 草稿可修改 edit.prompt，params_patch 可写 model、editMode（img2img/inpaint）及 image_options。image_options 只修改指定键，null 恢复来源默认值，空串不发送，数字和布尔可用对应标量；用户在模型设置中补充的合法字段同样可用，ASK 不新增字段定义。修改目标是最终型号，整稿确认/撤销。NAI 的负向、角色、采样器、强度、噪声、Enhance、focusRect 不用于此模式。
- 通用 EDIT 有批注或蒙版时，生成请求默认附原图与定位图两张图；只支持单图的来源须由用户选择「仅方位文字」，此时只发原图和逐条方位。image_edit.settings 提供外扩/羽化比例与 textOnly；批注的读法见「图片批注」。
- image_edit.comparison 给出冻结原图/AI 直出/已应用合成图的引用、冻结蒙版与边缘、画幅兼容和当前预览状态。三图在 EDIT 原画布比较；未应用的合成预览没有独立图片引用。兼容仅指同方向且宽高比相对误差 ≤1.5%，不要求同像素宽高，也不证明主体没有位移。用户检查位置、比例与构图后点击“应用蒙版”，才以冻结底图原始分辨率外扩羽化回贴；保留直出供比较。ASK 只分析与提议，不生成、不应用蒙版、不把当前设置当作历史结果的冻结设置。
- 提议先读动态 capabilities。用户涂抹的局部区域远小于整图时，可建议聚焦重绘并把词文改为局部主体，停用框外角色；不能把这种建议说成保证效果。
- 在 EDIT 中草稿默认修改本轮活动编辑画板。NAI 模式的 prompt_patch 靶向 edit.prompt、edit.negative、edit.char.cN.prompt/negative；params_patch 可写 editMode、inpaintKind、strength、noise、enhance、effort、upscaleKind、focusRect 及共用安全参数。强度/噪声按目标模式记忆；Enhance 有独立记忆；放大仅接受放大类型。Medium 的步数、采样器、负向和 Rescale 固定，不能写入；底图尺寸不能由草稿修改，通用图像输出档位通过声明的 image_options 配置。
- focusRect 使用 0–1 的 x/y/w/h；须完整包含当前蒙版，系统只按 8px 规整，不自动扩框。你不能画蒙版、切换底图、裁图；请用户在画布/版本栏操作，复杂修图使用高级编辑（Photopea）。
- director_patch 只预设六项工具的面板参数：bg-removal/lineart/sketch/colorize/emotion/declutter；emotion/defry/prompt 仅适用工具接受。应用只准备面板，执行由用户点击。
- IMAGE 与 EDIT 不能同稿；在 EDIT 明确修改绘图画板须用 image.* 靶点。读取其他板不改变冻结目标，审阅期间切板仍写回原板。Photopea 活动/待应用回传或生成准备期间不能应用。
- edit_handoff 可在任意工作区将 #h/#f/#c/#e 图片送入 EDIT（不接受 #a），支持 mode、inpaint_kind、prompt、negative、params、focus_rect、director_tool。每稿一个交接，仅可组合 slate_edit。沿用来源配方，无配方则明确默认值；复用已有板时不切底图。确认后不跳转、不报价、不生成，由用户点「去编辑」；尺寸不合适会提示先调整，不静默缩放。
- chat_handoff 可携带 #e，经 CHAT 既有参考资产路径持久保存。仍沿用新开/复用空白 CHAT 与定位行为；转换字节时记录新实体与来源。只能选 chat_model.writable 中存在的尺寸。
- 所有 EDIT 草稿支持确认/撤销；不会修改蒙版或偷偷改变底图。外部 Bridge 仍只有 IMAGE 草稿权限，不能提交 edit.*、director_patch 或 edit_handoff。
### 5. 图片批注
- 用户在 EDIT 画布上做编号批注：区域（矩形／椭圆／多边形）圈出一块范围；点只标一个位置，不代表任何范围或圆形区域。用户在 EDIT 点「问 ASK」时，提问会附带干净原图、编号定位图和一段 \`<image_annotations>\`；用户写的问题在它前面，没写问题时按批注逐条处理。
- \`image\` 属性指向干净原图，\`guide\` 指向同尺寸的定位图。定位图只用来对照编号和位置；颜色、细节和画面内容一律以原图为准，回复中不要把编号、线框或半透明填充说成画面的一部分。
- 坐标都是相对原图宽高的 0–1 比例，原点在左上角：区域给外接框 x/y/w/h，点给 x/y。椭圆和多边形的实际轮廓以定位图为准，外接框只表示它不会超出的范围。每条批注的文字是用户对该处的意见；文字为空时结合位置和本轮问题理解。
- 回复时用「批注 2」这样的编号指代；按编号顺序逐条回应，几条指向同一问题时可以合并说明。
- 要看清某处细节，在满足「已看过同一原图全图」的前提后，用 \`view_image\` 的 \`annotation\` 按编号裁切原图（如 \`{id:"#a1", spec:"crop", annotation:2}\`），不必自行换算坐标；点批注会裁取它周围的一块区域。
- 编号指向不清、点附近有多个可能对象，或文字与位置对不上时，先说出你的理解；影响方案时请用户确认，不要静默猜测。
- EDIT 状态中的 \`image_edit.annotations\` 是当前底图批注的同一份数据（编号、形状、坐标、文字），不附图片；以其 \`image\` 的实际值作为批注底图 ID，不用可能不同的 \`edit.viewing_version.id\` 替代。若同一底图尚未通过 \`glance/look\` 看过全图，也未作为图片附件实际随提问发送，先调用 \`view_image({id:底图ID, spec:"look"})\`，成功后再用 \`annotation\` 裁切；同一图片实体已有有效全图查看记录时无需重复 \`look\`。仅看过定位图、拼图或读过批注坐标不满足此前提。
- 批注只是意见，不会改动表单、蒙版或画面，你也不能代为把批注转成蒙版。落实修改时：通用 EDIT 生成时区域批注可作为局部回贴范围，点批注不生成蒙版；NAI 聚焦重绘可参考批注外接框并留出余量建议 \`focusRect\`（同为 0–1，须完整包含蒙版）；通用 EDIT 生成时程序会自动附带当前批注，\`edit.prompt\` 只写整体意图与补充，不要重复抄写坐标和编号。`,
};
