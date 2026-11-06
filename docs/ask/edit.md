# ASK 感知与操作 EDIT 工作区

更新：2026-11-06。EA1–EA3 及通用图像编辑的基础感知／参数草稿已接入，依赖 [NAI 基础感知](nai-awareness.md)与[统一图片身份](../engineering/image-identity.md)。本文维护编辑现场、草稿与交接；获批[实施方案](../archive/ask/2026-10-29-ask-edit-plan.md)和[本地验收](../archive/ask/2026-10-29-ask-edit-verification.md)已单独归档。

## 入口与权限

EDIT 顶栏可打开同一 ASK，桌面为浮窗、860px 及以下为全屏，⌘J／Ctrl+J 与其他车间一致。ASK 只读取状态、查看图片和准备待确认配置；用户应用后仍须自己执行生成、放大或 Director Tools。

Photopea 打开时 ASK 收起并让出键盘，不中断正在进行的推理；高级编辑回传尚未处理、生成准备或蒙版笔画未结束时，EDIT 草稿保持待审。ASK 不修改蒙版、不切换底图、不裁切图片，也不重建 Photopea 文档。

## 编辑状态

在 EDIT 发起的 `<workspace_state>.edit` 包含：

- 活动画板稳定 ID、短板号、名称、原始底图／当前底图／查看版本的引用与血统；空板为 `ready:false`。
- 当前模式、保存表单、角色与参考摘要，以及共用的 `capabilities/effective/input_budget/cost/diagnostics`。
- `mask_revision` 和蒙版几何摘要；聚焦框的归一化／像素坐标、实际处理尺寸与包含关系。
- Director 预设及独立处理尺寸／本地费用；Upscale 使用当前查看版本，不套用休眠的生成词文预算。

`capabilities.available_models` 只提供 EDIT 三种模式菜单实际支持的型号，按内部 ID 去重；`modes` 提供可用模式，不再按模式重复发送 `models` ID 列表。Director 保留工具预设与当前已选设置，不发送完整 `emotions` 枚举；本地情绪值校验继续执行。服务内部完整供应商目录不直接发给 ASK，避免无关模型及重复来源膨胀每轮状态。筛选复用编辑菜单的能力判断，自定义上游 ID 不受名称限制；初始状态、`get_state` 与候选预算校验使用同一投影。

选择 Image 2／Gemini 等通用编辑模型时，`editing` 为 `image-generation-comparison`，`input_budget` 为 `not_applicable`，不把休眠的 NAI 参数或预算当成生效值：

- `source` 提供连接身份／显示名、上游 ID、协议与参数声明来源，不含地址或凭据。`capabilities.parameters` 是当前来源字段；`available_models` 提供可切换通用型号及各自来源字段。
- `form.image_options` 保留保存值；`effective.image_options` 复用请求侧 `normalizeOptions` 补齐默认值，空串表示不发送。
- `image_edit.settings` 是当前外扩／羽化及单图文字回退设置；`annotations` 提供底图 ID、批注编号、形状、三位小数的归一化坐标和评论，不展开多边形顶点，点只有 x/y。普通读取不附图片；「问 ASK」准备配对附件卡片，发送时追加 XML v2。`view_image({id,spec:"crop",annotation:n})` 按冻结几何换算坐标，仍须先看同一原图全图；未附图的底图先 `look`，ID 取 `annotations.image` 而非可能不同的 `viewing_version.id`。详见[批注专题](../workspaces/annotations.md#ask原图指示图与坐标)。
- `image_edit.comparison` 提供冻结原图／直出／已应用合成的引用、冻结蒙版摘要和边缘设置、比例兼容、人工应用状态与正在查看的比较项；临时合成预览没有独立图片引用。冻结配置和当前设置分别表达，蒙版像素不发送。

同方向且宽高比相对误差 ≤1.5% 仅代表几何兼容，不代表主体没有位移。原画布三图比较、原尺寸羽化回贴与人工应用规则见 [EDIT](../workspaces/edit.md#image-2gemini-等通用图像模型)。

初始版本列表保留原图、底图、查看版本及最近 12 个条目，字母变体按组保留；画板目录按活动时间取最近 8 个，截断有标记。`get_state({edit_board_id, scope})` 按需读取指定板完整版本与表单，与 IMAGE 的 `board_id` 互斥；initial 读取冻结板，latest 不改变草稿基底。非 EDIT 页面仍可按需读取编辑板；Bridge 继续只导出轻量目录。

图片沿用 `#e板号.版本[a-c]` 和本板简写，整轮冻结解析。候选列表在 EDIT 优先列本板图片，然后其他编辑板、历史和收藏。看图与 crop 继续按实体共享已看资格和预算，不自动发送蒙版像素。

用户未给出明确 ID 而询问 EDIT「这张／当前图／刚才那张」时，优先使用本轮 `edit.viewing_version.id`，直接调用 `view_image({id:"#e1.1",spec:"look"})` 等实际编号。`image.current` 和 `image.history.latest_id` 仅属于 IMAGE，为空不代表 EDIT 没有图片；`source_version` 是编辑底图，不能替代查看版本。当前模式的完整表单已在 `edit.form` 提供，单纯看图无需先查 `get_meta`／`get_state`；只有需要该版本未提供的历史配方时才补读。仅元数据轮次仍不发送像素，空编辑板也不构造 null ID 工具调用。

## 蒙版几何

覆盖阈值与出站一致：Alpha 大于 32 为重绘区域。覆盖率、总外接框按源像素计算；连通区域使用最长边不超过 512 格的占用网格，返回区域数量和面积最大的 3 个区域，超出则标记截断。

服务按 `mask_revision` 缓存，在空闲任务计算，ASK 发起时等待当前几何任务；同一修订不重复扫描。隐藏画布仍可读取保存状态；计算中或失败明确返回 pending／error，不以空蒙版冒充。摘要只含几何与修订，没有 Base64 或蒙版图。

## 页内草稿

EDIT 中默认目标为本轮活动编辑画板；显式 `image.*` 可以改 IMAGE，但不能与 `edit.*` 同稿。空编辑页不把草稿悄悄投给 IMAGE。

| 步骤 | 可做什么 |
| --- | --- |
| `prompt_patch` | `edit.prompt`、`edit.negative`、`edit.char.cN.prompt/negative` 的唯一锚点修改或整段改写 |
| `character_edit` | 沿用共享稳定角色 ID、增删／排序、启停与定位；不写参考资产 |
| `restore_partial` | 从本轮有效图片恢复允许字段；不恢复 EDIT 尺寸和批次，CHAT 文本不伪装为 NAI 配方 |
| `params_patch` | NAI 安全生成／编辑参数；通用图像编辑使用 model、editMode 与 image_options |
| `director_patch` | 六项工具、适用的 emotion／defry／prompt；仅填配置并展开既有工具面板 |
| `slate_edit/save_ref` | 可与页内修改组合确认，沿用任务／文件预检、补偿与撤销 |

配方导出沿用共享画板配方字段，保存本次修改后的词文、角色、型号与通用参数；不打包蒙版、版本链或 Photopea 分层，不作为 EDIT 会话备份。

模式与型号按整份候选的最终值验证，不依赖步骤顺序。强度／噪声写入最终模式；Enhance 开启时写其独立配置，不覆盖普通 Img2Img。Magnitude 与不一致的自定义值报冲突，执行 Enhance 使用随机 Seed。Effort 解析为规范 High／Medium 型号，不保存第二份漂移状态；与显式型号矛盾时拒绝。

Medium 不接受新的步数、采样器、负向与 Rescale 修改；切入 Medium 可保留旧的休眠配置。放大只接受模式／放大类型，拒绝生成词文与参数。型号必须存在于该操作的当前可选目录，不静默替换 Curated 重绘或没有来源的型号。

通用编辑模型的草稿支持修改说明、型号、图生图／重绘模式和 `params_patch.params.image_options`。参数按最终目标型号的来源字段校验，支持字符串、数字、布尔及用户已声明的自定义字段；null 恢复来源默认，空串不发送，未指定字段保留。多个参数步骤合并后校验，型号与模式切换不依赖步骤顺序。草稿不会新增参数定义，未声明键和非法取值在提议时返回可修正错误；确认前重检来源身份、修订与字段声明，避免换源后静默套用。

来源参数在既有 Diff 中逐项展示，沿用整稿确认、配置冲突检查和撤销；拒绝 NAI 采样器、强度、负向、角色与聚焦参数变更。外扩／羽化与单图回退本轮只读，蒙版和生成继续由用户操作。

聚焦框使用 `{x,y,w,h}` 的 0–1 坐标，换算源像素并规整到 8px。必须完整包含最新蒙版，系统不自动扩框；无蒙版时可准备框并提示用户涂抹。草稿后新增的蒙版超出框、比例或尺寸不合法都会阻止应用。

DraftCard 复用紧凑 Diff，显示编辑画板名称与已知底图完整编号；模式、强度、聚焦框和 Director 预设按参数行展示，整份配置共同确认。确认写入器在写入前重检目标存在、底图、配置、当前能力及蒙版，直接写服务字段，不调用用户切模式的快捷路径。

应用、撤销、恢复不切页面、不换底图、不改蒙版、不报价、不刷新额度、不编码、不生成；清除旧价，画布恢复或自动重排不能重新启动报价。用户后续主动调整／重试／执行才回到工作区原有流程。审阅中切板仍写回冻结的原板；目标已关闭则拒绝。撤销与原有全局检查点共用一套所有权和冲突规则。

## 送入 EDIT

`edit_handoff` 接受本轮的 `#h/#f/#c/#e`，不接受 `#a`。可指定模式、重绘类型、词文、参数、聚焦框或 Director 预设；每稿只允许一个画面交接，可组合 `slate_edit`。

- 按真实来源记录定位已有板；已有板按其当前配置显示 Diff，保留其实际底图。没有则在确认时创建，继承实际存在的 NAI 来源配方、角色与参考。CHAT 没有 NAI 配方时使用默认配置，不伪造原生成参数。
- 尺寸不满足目标操作时显示需先调整，可以建板但不缩放；执行继续受原有输入校验约束。
- 应用留在原页面，完成检查点提供「去编辑」，用户点击才定位该板。没有报价或生成请求。
- 新板仍只有初始版本、未画蒙版、未打开 Photopea 时，撤销移除新板；已有后续操作则只恢复写入的配置。复用板始终保留。

## EDIT 交给 CHAT 与持久身份

`chat_handoff` 可携带 `#e` 原图，仍沿用新开／复用空白会话、写参考及输入框、定位 CHAT 的原行为，不自动发送。尺寸仅使用 `chat_model.writable`，不新开资产库。

原字节直接保存时共享实体键；既有 `fitReference` 因大小或像素限制转换字节时，保存新实体并记录父实体、父记录、冻结来源引用和 `reference-fit`。CHAT 资产与血统持久保存并进入其既有备份，刷新后参考仍可读；来源短码只作历史说明，不再解析成新页面的同号图。

所有编辑输出仍留在 EDIT，不自动写 `#h`；CHAT 来源的编辑结果仍通过用户显式回传。

## 外部协同与未开放范围

Bridge 仍只接受 IMAGE 写入。外部 `edit.*`、`director_patch`、`edit_handoff`／内部 `edit_config` 返回 invalid；只读 `#e` 索引、元数据引用和 Slate 成果绑定继续可用。公开技能与生成的 PROTOCOL 同步这一边界。

本轮未增加：ASK 生成／改蒙版、换底、裁图、自动执行或图像生成自动重试、蒙版叠加视觉工具、外部 EDIT 草稿、EDIT 跨刷新恢复与 PSD 持久化。真实供应商图像质量与实际费用另行验证。
