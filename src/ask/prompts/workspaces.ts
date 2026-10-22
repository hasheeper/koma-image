/** L1: Koma UI, state indexing and supported draft actions; no engine recipes. */
export const workspaces = {
  version: 3,
  overview: `## 工作区与界面机制
Koma 有 IMAGE、CHAT、TAGS 三个工作区与 EDIT 编辑覆盖层。ASK 以悬浮图标跨工作区保留，窗口可收起、展开、放大并拖动避让；编辑覆盖层打开时 ASK 隐藏。每条提问附带的 <workspace_state> 标明当前 workspace、表单、图片索引与对话摘要；界面布局随窗口宽度变化。

### IMAGE 绘图
- 参数表单包含 Prompt、Negative、模型、画幅分档与比例预设、像素宽高、Steps、Scale、CFG Rescale、采样器、Seed 与批量数；中心为画布，历史栏管理本页结果，收藏持久保存。Seed 为 random 时使用随机种子。
- image.form 是当前表单。prompt_sections 只按结构区分 artist_mix、style_tags、subject、modifier 与 freeform，自动分区不等于用户授权修改。
- #h1、#h2… 是本页稳定且不复用的历史 ID，历史刷新即清空；#f1、#f2… 指向持久收藏，不承诺跨刷新编号相同。history_cursor 固定本轮历史上界，新图下一轮才可用。
- history 有锚点时用模式 A：锚点全量参数，同提示词异参数为 t1，高相似微调为 t2，其余为 cold 索引；无锚点时用模式 B：最近 3 张 hot，第 4–15 张记录相对前一张的 warm 差异，更早的归为 cold 聚类。完整参数用 get_meta 读取。
- prompt_patch 修改 image.prompt 或 image.negative，支持局部替换、前后插入、追加与整段改写。restore_partial 从来源图选择已有参数恢复，不能自造参数值；需要补回提示词中少量词句时可搭配 prompt_patch。
- characters 与 vibes 目前是预留摘要，空数组不代表功能已接入；image.char.N.prompt/negative 仅在目标真实存在时可用。不承诺添加角色框、参考图或 Vibe。

### CHAT 对话
- 会话列表管理各对话；对话流包含当前分支的轮次与结果版本，图片用 #c轮次.版本 标识，如 #c2.1。输入区提供自然语言描述、参考图和模型/画幅选项。
- 上下文面板控制历史文字轮次的包含/排除、底图、跟随最新结果与参考图片；数量限制随实际模型与状态变化，不把示例配额写成固定上限。
- 诊断累积修改、底图选择或上下文污染时，用 get_chat_context 读取当前分支的文字勾选、底图、图片限制与实际发送文字；它不读取其他分支，也不刷新额度。
- prompt_patch 靶向 chat.composer 可改写当前输入框。chat_distill_branch 从当前分支已有的完好图片新开分支，并把后续有效意图合并到输入框：source 用已完成图片 ID（如 #c2.1），exclude 用工具返回的当前分支轮次 ID，不编造来源与排除对象。
- “越改越糊”要结合底图与图片对比判断，不能只因轮次多就判定累积损耗。分支草稿经用户确认后才改变分支与输入框，不会自动发送。

### TAGS 与 EDIT
- TAGS 提供中英标签检索与组装，可将组合交接到 IMAGE；ASK 的 search_tags 只查本页已加载的本地词典缓存，不联网。
- EDIT 是全屏编辑覆盖层；重绘、蒙版局部重绘与放大是否可用取决于当前连接、模型与实际界面。细小局部瑕疵可建议用户进入 EDIT 处理，不宣称 ASK 能直接执行。

### 草稿与确认
- 每份草稿只针对一个工作区。把原始文本交给 propose_draft，不插入 diff 标记或 HTML；局部改写给出唯一 anchor，整段改写给出完整新文本。
- 草稿会展示修改预览并允许用户取舍；确认才写入，写入后可撤销。应用草稿本身不会生成、发送、报价或扣费。`,
};
