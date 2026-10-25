# ASK CHAT 交接与能力感知规划

更新：2026-10-25。状态：已实施（H0–H4），合成图片与模拟服务下验收通过；源码基线 `219463c` 之上的工作区改动，尚未提交。现行规则已并入[协议与运行契约](../ask/ask-contracts-and-decisions.md)、[检索与状态](../ask/ask-retrieval-state.md)、[UI 规范](../ask/ask-ui-spec.md)、[提示词维护](../ask/ask-prompts.md)与[对话与编辑](../chat-editor-workspaces.md)；本文只保留勘探结论与实施过程，不作现行依据。

## 1. 已确认决策

| 决策 | 内容 |
| --- | --- |
| 目标会话 | ASK 把内容交到 CHAT 时，一律写入一条新会话，不写进当前会话 |
| 可写参数 | 只开放尺寸类：`size`、`aspect_ratio`、`image_size` |
| quality | 不写入草稿；AI 可读取当前值和可选项，需要调整时在回复中提醒用户手动设置 |
| 能力感知 | AI 应能看到当前 CHAT 模型的能力：可写尺寸项及其可选值、只读的质量项、图片数量上限 |
| 多图编号 | 重新生成产生的每个版本、同一版本返回的每张图，都要有可引用的 ID |
| 模型切换 | 本期不由草稿切换 CHAT 模型；AI 可建议，用户手动切换 |

## 2. 勘探结论

### 2.1 草稿不能交接图片与尺寸

- CHAT 草稿只有两种：`prompt_patch` 改 `chat.composer`，以及 `chat_distill_branch`（`src/ask/draft/validate.ts:25`、`:77`；契约见[协议与运行契约](../ask/ask-contracts-and-decisions.md#草稿与校验)）。
- 没有步骤能设置 CHAT 的模型选项，也没有步骤能把 `#h`／`#f` 图片附为 CHAT 参考图。
- CHAT 选项由模型目录声明为固定枚举，键为 `quality`、`size`、`aspect_ratio`、`image_size`、`output_format`（`src/domain/catalog.ts:54`）。OpenAI Images 声明 `size`（auto／1024x1024／1536x1024／1024x1536）与 `quality`；Gemini 声明 `aspect_ratio` 与 `image_size`（1K／2K／4K，2.5 系列无）（`src/gateway/native-protocols.ts:51`）。

### 2.2 AI 看不到 CHAT 能力

- 在 IMAGE 或 TAGS 提问时，工作台摘要的 `chat` 为 null，只有输入框文字参与 `base_hash`（`src/ask/service.ts:461`、`src/ask/digest/index.ts:178`）。
- 在 CHAT 提问时，摘要只有模型名称；`get_chat_context` 只给轮次、底图、图片计数、额度与输入框，不含模型选项（`src/ask/chat-context.ts:19`）。
- L1 提示词只列出两种 CHAT 草稿动作（`src/ask/prompts/workspaces.ts`）。

### 2.3 未进入 CHAT 时，CHAT 草稿必然失败（已复现）

CHAT 工作区按 KeepAlive 首次进入时才挂载，`chat.start()` 只在 `ChatWorkspace.vue:261` 调用。页面停在 IMAGE、从未进入 CHAT 时，ASK 读到的是未加载的临时会话：`loaded=false`、`models=0`、`conversations=0`。

2026-10-25 用临时 Playwright 探针（模拟推理，无生成请求；探针文件已删除）复现：

| 场景 | 提议时 AI 看到 | 应用结果 |
| --- | --- | --- |
| 无已存会话，打开即在 IMAGE | 临时会话 ID、输入框为空 | 切到 CHAT 后报「对话已变化，草稿未写入」，草稿变为「当前对话已切换」 |
| 已存会话输入框为 `stored text`，刷新后停在 IMAGE | 输入框为空（与实际不符） | 同上，写入失败 |

现有浏览器用例都先进入过 CHAT 再提议（`tests/ask.browser.mjs:1601`），因此没有覆盖到这个场景。`chat_distill_branch` 同样受影响：未加载时，当前分支来源为空。

### 2.4 手动拼接的冲突

- 先应用 ASK 输入框草稿，再点图片的「→对话」：`claim` 调 `addConversation()`。当前会话因输入框非空不算空白（`src/domain/conversation.ts:31`），图片进入另一条空白或新建会话，与 ASK 写的文字分家（`src/services/chat.ts:496`）。
- 先发图再应用旧草稿：发图会切换会话，草稿认定的 `conversationId` 已变，报「对话已切换」（`src/ask/draft/apply.ts:18`）。
- 在 IMAGE 提议的 `chat.composer` 写入 CHAT 当前会话，该会话可能是旧会话，其底图和历史文字会随新文字发送，而 AI 看不到它们。

### 2.5 多版本与多图没有 ID

- 一个 CHAT 轮次可多次「重新生成」，形成多个版本（`ChatVersions.vue`）；一个版本也可返回多张图，界面逐张展示并可分别「设为底图」（`ChatTurn.vue:43`、`:274`）。
- ASK 的 `#cN.M` 只覆盖每轮的**选中版本**中的**第一张图**：`chatSnapshot` 用 `t.selectedVersion` 与 `blocks.find(...)`（`src/ask/chat-context.ts:14`）。未选中的版本和同版本的第 2 张以后都无法查看、比较、检索或引用。
- 正则只接受 `#c\d+\.\d+`：`src/ask/ids.ts:11`、`src/ask/tools.ts:86`、`src/ask/format.ts:100`。
- `#c` 图片的元数据只有 prompt 与像素尺寸，不含轮次设置（`chat-context.ts:33`；[检索与状态](../ask/ask-retrieval-state.md)已约定将来从真实轮次 settings 显式提取）。
- IMAGE 批量与对比生成的每张图本来就有独立的 `#h`，不需要改。

## 3. 范围

本期包含：

- H0：ASK 发送前确保 CHAT 会话已恢复。
- H1：CHAT 能力感知。
- H2：`#c` 多版本／多图编号。
- H3：`chat_handoff` 草稿，新开会话并写入参考图、尺寸与输入框，支持撤销与恢复。
- H4：草稿卡 UI、提示词、文档与浏览器验收。

不包含：

- 切换 CHAT 模型，写 `quality`／`output_format`。
- 自动发送、报价、刷新额度或生成。
- 把 ASK 附件 `#a` 作为交接图片（后续可单独确认）。
- 其他分支的图片，以及非 CHAT 的新入口。

## 4. 设计

### 4.1 H0：CHAT 就绪

- CHAT 服务新增 `warm()`：幂等恢复已存会话，并在目录未就绪时读取用户已配置的图像连接目录；目录等待最多 2 秒，超时或失败照旧只记录错误。
- 报价与额度属于 CHAT 工作区本身：只有进入 CHAT 调用 `start()` 后，目录刷新才继续报价和刷新额度；`warm()` 及其后的连接或租约触发的目录刷新都不报价。
- ASK 打开浮窗时触发 `warm()`；发送、应用、撤销／恢复与编辑重发前等待它完成。
- 目录仍未就绪时，能力块标 `ready: false`。提议阶段不能写尺寸，应用时再按实时状态校验。
- 回归用例：不进入 CHAT，ASK 读取到已存会话输入框；预热期间零报价、零额度请求；随后进入 CHAT 恢复报价。

### 4.2 H1：能力感知

摘要新增 `chat_model`，所有工作区都发送。完整内容另由 `get_chat_context` 返回，同时附上可用 CHAT 模型的名称列表。摘要版本从 `v5` 升到 `v6`。

```json
"chat_model": {
  "ready": true,
  "name": "Gemini Image",
  "max_images": 14,
  "writable": { "aspect_ratio": { "value": "1:1", "options": ["1:1", "16:9", "9:16"] }, "image_size": { "value": "1K", "options": ["1K", "2K", "4K"] } },
  "read_only": { "quality": { "value": "auto", "options": ["auto", "low", "medium", "high"] } }
}
```

- 只输出以上已知键，以及模型显示名、图片上限。不输出连接名、上游 ID、URL 或其他 settings（沿用 `tests/ask-chat.test.mjs:14` 的不外发约束）。
- 值保持协议原值；界面中文标签（画幅／比例／分辨率／质量，方形／横向／竖向等）从 `ChatWorkspace.vue:51` 抽到共享模块，CHAT 与草稿卡共用。

### 4.3 H2：`#c` 编号

| ID | 含义 |
| --- | --- |
| `#cN.M` | 当前分支第 N 轮、第 M 个版本（按 `versions` 下标，失败或取消的版本也占号）；单图版本即该图，多图版本等同 `#cN.M.1` |
| `#cN.M.K` | 多图版本中的第 K 张 |

- 当前分支所有已完成版本的每张图都生成 Picture。Picture 的 `id` 改为 `chat:<会话>:<轮次>:<版本>:<序号>`，元数据补 `version`、`image_index`、`selected`，以及轮次 settings 中的模型显示名和尺寸、质量值。
- 同步修改 `idPattern`、`tools.ts` 的 ID 校验、`format.ts` 的链接识别、`search_history` 的 chat 排序、浮窗 `pictureInfo`／`locate`；`locate` 只切到 CHAT，不改选中版本。
- `get_chat_context.turns` 增加 `versions: [{ id, status, images, selected }]`。
- `chat_distill_branch.source` 可以是选中版本内的任一张图（含 `.K`）。未选中版本会被拒绝，提示用户先在 CHAT 切换版本，或改用交接；`exclude` 接受同一轮的任意 `#cN.*`。
- 已收藏会话中记录的「已看过」旧 ID 不再匹配，裁切前需重新 glance；旧回复里的 `#cN.M` 仍可解析。

### 4.4 H3：`chat_handoff` 草稿

```json
{ "kind": "chat_handoff", "images": ["#h25"], "options": { "aspect_ratio": "16:9" }, "text": "改为两人脸贴脸的横版特写……" }
```

**解析**（`parseDraft`）：

- 该步骤必须单独提交。`images` 为 0 到当前 CHAT 模型图片上限张，去重；只接受 `#h`／`#f`／`#cN.M[.K]`，且须在本轮冻结图片库中。
- `options` 只接受当前模型声明的 `size`／`aspect_ratio`／`image_size`，值须在可选项内；出现 `quality` 等其他键时报错，并提示「需要时在回复中提醒用户手动调整」。
- `text` 为非空输入框文字。
- 草稿记录可序列化的图片引用：标签、来源类型、绘图记录 ID 或 CHAT 素材 ID，不含 Blob。`DraftState` 增加 `workspace` 与能力快照。

**IMAGE 发起的 CHAT 写入**：按「一律新开」，在 IMAGE／TAGS 提问时，`chat.composer` 补丁和分支草稿被拒绝，并引导改用 `chat_handoff`；在 CHAT 提问时保持原有两种动作。现有的跨工作区用例需相应调整。

**校验**（`validateDraft`，应用前按实时状态复核）：

- CHAT 未就绪或当前模型与提议时不同，判为整体失效：「对话模型已变化，请重新提议」。
- 图片已从历史、收藏或会话素材中移除，该行判为「图片已移除」；可写选项值不在实时可选项内，该行失效。
- 每张图片、每个选项和输入框各为一行，可单独勾选；「新开对话」行锁定。
- `plan.handoff` 携带实际写入内容；`changes` 含输入框改动，供账本和压缩摘要使用。

**写入**：新增 `chat.writeHandoffDraft`，`createDraftWriter` 统一调用。

- 与「→对话」一致：复用唯一的空白会话，否则新建；对用户而言都是一条新会话。
- 设置为 `{ model: 提议时模型, options: normalizeOptions(当前会话选项 + 草稿尺寸项) }`。不写全局 `chatSettings` 偏好，草稿只影响这条会话。
- `#h`／`#f` 经 `fitReference` 后以 `image` 来源加入素材；`#c` 直接引用既有素材 ID，不复制。按顺序 `attachUpload`。
- 写入输入框，`selectionRevision++`，切到新会话。只 `cancelQuote`，不 `scheduleQuote`，与现有 `writeDraft` 一致；用户手动编辑或发送时按原规则报价。
- 正在导入图片时拒绝写入；保存失败时删除新建的会话或恢复空白会话，并回收新素材。
- 回执为新会话的 `chatDraftKey`（首项即会话 ID）；撤销栈原有的 `beforeReceipt` 记录来源会话。

**撤销与恢复**：

- 撤销前要求新会话仍存在，且 `chatDraftKey` 与回执完全一致；否则报「新对话已删除」或「新对话已继续编辑」。
- 撤销时，新建的会话直接删除（属显式回退，无删除确认）；复用的空白会话恢复为空白和原设置。若当前停在该会话，切回来源会话，来源不存在时切到最近会话；然后回收素材。
- 恢复时重新执行写入，产生新的回执。`simulate()` 同步支持该路径，供编辑和批量回退预检。
- 收藏中的待确认草稿只保存引用。刷新后历史 `#h` 已清空，相关行显示「图片已移除」，`#f` 与 `#c` 仍可用。

### 4.5 H4：界面

- 草稿卡新增「新对话」分组，行依次为：参考图（ID 芯片与缩略图，复用现有引用芯片）、尺寸参数（复用参数行，原值 → 新值）、输入框（复用文本行）。
- 应用按钮：在 CHAT 中为「新开对话并应用」，在其他工作区为「切到对话并新开」，无目标菜单。提示为「新开对话写入参考图、画幅和输入框，不会发送 · Tab」。收起的浮岛只提供应用／忽略。
- 先在 `.local/ask/ui-proposal/` 做 HTML 预览，经用户批准后再改 `src/`；按[设计语言](../design-language.md)与 B v5，检查 320／390／768／1440px。

### 4.6 提示词与版本

- L1 `workspaces.ts`：补充 `chat_model` 的含义、`#c` 编号规则和 `chat_handoff` 动作；IMAGE → CHAT 一律走交接；quality 只读并以回复提醒。版本从 w10 升到 w11。
- `propose_draft`：补充 schema 与说明；`get_chat_context` 与图片 ID 字段说明同步更新。
- 同步[提示词维护](../ask/ask-prompts.md)中的版本串。

## 5. 阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| H0 | CHAT 预热可等待；ASK 打开、发送或写入时触发 | 不进入 CHAT 时，ASK 读取的会话与输入框与已存数据一致；预热无生成、报价或额度请求；进入 CHAT 后报价照旧 |
| H1 | `chat_model` 摘要、上下文与共享标签 | 单元：只外发白名单键；目录未就绪时 `ready:false`；两种原生协议字段正确 |
| H2 | 多版本／多图编号与各处解析 | 单元：三版本、双图版本可查看、比较、检索与取元数据；旧 `#cN.M` 兼容；分支来源规则 |
| H3 | 交接解析、校验、写入、撤销与恢复 | 单元与浏览器：复用空白或新建会话、模型变化、图片移除、超上限、quality 被拒、IMAGE 发起的输入框补丁被拒；撤销删除或还原会话；全程零生成、零报价、零额度请求 |
| H4 | 卡片 UI、提示词与文档 | 预览获批；四种宽度截图；`npm run check` 与 `test:ask` 相关用例通过 |

全部使用合成图片与模拟服务，不执行真实收费生成；真实供应商的尺寸效果仍按[当前待办](../implementation-plan.md)核验。

## 6. 测试清单

- `tests/ask-chat.test.mjs`：能力块白名单、版本与多图编号、分支来源规则。
- `tests/ask-draft.test.mjs`：`chat_handoff` 解析与校验矩阵。
- `tests/ask-stack.test.mjs`：交接回执、撤销、恢复与预检。
- `tests/ask-tools.test.mjs`：新 ID 格式的查看、比较与元数据。
- `tests/ask-compact.test.mjs`：账本中交接草稿的摘要。
- `tests/ask.browser.mjs`：H0 回归；从 IMAGE 交接 `#h`、从 CHAT 交接 `#c2.1.2`；撤销与恢复；请求白名单。

## 7. 文档同步

实施完成后更新：[协议与运行契约](../ask/ask-contracts-and-decisions.md)（草稿表与 ID）、[检索与状态](../ask/ask-retrieval-state.md)（CHAT 快照字段）、[UI 规范](../ask/ask-ui-spec.md)（交接卡）、[提示词维护](../ask/ask-prompts.md)（版本）、[对话与编辑](../chat-editor-workspaces.md)（ASK 交接入口）、[现行契约](../ask/ask-implementation-plan.md)与[当前状态与待办](../implementation-plan.md)；随后把本文移入归档。

## 8. 风险与待确认

- `#cN` 依赖当前分支，切换分支后同号可能指向不同轮次（现有行为）；提示词继续要求以本轮快照为准。
- 尺寸项可能改变费用（如 2K／4K）。草稿不报价，费用以用户发送前 CHAT 的既有报价为准。
- 已定：ASK 附件 `#a` 不作交接图片；复用空白会话与「→对话」按钮一致。

## 9. 验收记录

2026-10-25，本地合成图片与模拟服务，未调用真实上游：

- H4 界面预览经用户批准后实施；标题目标行、参考图行、逐字输入框、单按钮文案与浮岛在 320／390／768／1440px 下无溢出，图片移除只标记对应行。
- `npm run check` 通过（单元 232）；`tests/ask.browser.mjs` 全部通过（112），其中 H0、H3（IMAGE／CHAT 交接）与 H4 用例覆盖零生成、零报价、零额度请求和撤销／恢复。
- 真实供应商的尺寸效果仍按[当前待办](../implementation-plan.md#仍待真实验证)核验。
