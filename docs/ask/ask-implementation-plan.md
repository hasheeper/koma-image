# Koma ASK：决策与实施规划（文档 4）

日期：2026-10-21。状态：A0.1（协议与设置）与 A0.2（会话与抽屉）已实现并通过模拟验证，见 [A0 实施记录](ask-a0.md)；A1 只读工具、视觉与批准后的入口见 [A1](ask-a1.md)，A2 草稿审阅、确认写入与撤销见 [A2](ask-a2.md)，A3 CHAT 适配见 [A3](ask-a3.md)，A4 本地代理与行内模式见 [A4](ask-a4.md)，均已实现并通过合成图片／模拟服务验证。A0–A4 开发收口；真实图片黄金样例、提示词质量及供应商实测仍待办。

本文记录用户在文档 1–3 之后确认的决策，并把 A0–A4 落到当前仓库的模块、测试与退出标准。

文档优先级：本文 > 文档 3《工程边界与深水区规范》（`ask-contracts-and-decisions.md`）> 文档 2《前端 UI 方案与交互定稿》（`ask-ui-spec.md`）> 文档 1《子产品理念、开发需求与基本框架》（`ask-architecture.md`）。工程红线以 `AGENTS.md` 为准。

`实际参考前端UI.txt` 是四份 HTML 原型，只作版式、结构与节奏参考；字体、颜色、按钮和动效时长按本文 §2.2 映射到站内 tokens。

---

## 1. 范围与性质

- ASK 是经用户批准的新子产品，没有内部基线可复刻。`AGENTS.md`「复刻原有业务与 UI」不约束 ASK 的产品形态；字体、样式分层、严格 TS、测试、脱敏、Koma 存储命名和发布约定全部适用。
- ASK 不调用生图、编辑、放大、报价或扣费接口，不替用户发送 CHAT 消息，不参与生成锁与串行调度，不改变现有工作区的报价、分流、额度、取消和失败行为。
- 现有工作区只增加 ASK 入口和草稿写入路径，不顺便调整其业务或界面。
- 每个里程碑单独分支、单独实施记录。

## 2. 已确认决策

### 2.1 推理协议：只做 `openai-chat` 与 `anthropic-messages`

按文档 3 §1.1，在 `src/gateway/profile.ts` 的登记表中新增两种协议，由用户在「设置 → 连接」中作为普通连接添加，Key 沿用现有 vault。

| 协议 | Profile ID | 路径 | 鉴权 | 前缀缓存 |
| --- | --- | --- | --- | --- |
| `openai-chat` | `openai-chat-v1` | `/v1/chat/completions`、`/v1/models` | `Authorization: Bearer` | 隐式前缀匹配 |
| `anthropic-messages` | `anthropic-messages-v1` | `/v1/messages`、`/v1/models` | `x-api-key` + `anthropic-version`；浏览器直连另加直连声明头 | `cache_control` 显式断点 |

- Profile 新增 `reasoning` 能力声明（流式、工具调用、图片输入）。现有标准网关、OpenAI Images、Gemini 原生、NAI 官方均不声明，ASK 模型选择器按能力过滤，不按名称或域名判断。
- 不做 OpenAI `/v1/responses`，不做 Gemini 原生多轮函数调用与 `cachedContents`。Gemini 由用户新建 `openai-chat` 连接，填写其 OpenAI 兼容地址；现有 Gemini 原生连接仍只用于生图。
- 地址规则（A0.1 按两类 SDK 的 base URL 习惯落实，单元测试固定）：
  - `openai-chat`：填写含版本路径的接口地址，原样拼接 `/chat/completions`、`/models`；只填服务根地址（路径为 `/`）时补 `/v1`。Gemini 兼容层 `…/v1beta/openai`、中转 `…/api/v1` 等按服务文档原样填写。
  - `anthropic-messages`：填写服务根地址或以 `/v1` 结尾的地址，统一补一次 `/v1`；带服务前缀的兼容地址（如 `…/anthropic`）得到 `…/anthropic/v1/messages`。
  - 实现沿用 `endpoint()` 的显式路径表，不按域名判断。
- 两种协议均不声明 quote、costCeiling、quotaPolicy。ASK 显示上游 `usage` 返回的 token 用量（含缓存命中），不换算金额；无报价不等于免费。原标准网关的报价、max_cost 与额度护栏不受影响。
- 请求结构严格按文档 3 §1.2–1.3：静态前缀冻结、动态状态追加在队尾、JSON 键序固定、同一轮内快照锁死。

### 2.2 字体与样式统一

| 用途 | 字体 token | 说明 |
| --- | --- | --- |
| 全部正文、标题、按钮、工具行、草稿卡 | `--sans`（Koma Rounded） | 与站内界面一致 |
| ID 锚点、行内 Tag／代码、等宽统计 | `--mono`（JetBrains Mono） | 沿用站内等宽读数约定 |
| 顶栏字标「Koma」 | `--brand`（Fredoka） | 与外壳品牌字一致；「ASK」字样用 `--sans` |

- 不引入 Manrope 或系统字体栈，不新增字体文件，`config/fonts.json` 不变。
- 渲染跟随 `public/styles/base.css` 的全站设置；文档 2 §2「不开启 antialiased」作废。
- 字重沿用 400／600；Koma Rounded 的 600 由 Bold 文件承担（见 `config/fonts.json`）。
- 字号优先使用站内阶梯（11／12／13／15／18）。原型中的 14／13.5／12.5px 在 A0 落地时按截图对比取相邻档位，必要的私有值写在组件样式块内。
- 动效使用站内 `--t1`／`--t2`／`--t3`（与原型同为 120／220／380ms）和 `--e`／`--e-out`；原型的 `--k` 慢放倍率只用于演示，不实现。

颜色映射：

| 原型变量 | 站内 token | 用途 |
| --- | --- | --- |
| `--panel` | `--chrome` | 抽屉主背景 |
| `--l2`／草稿卡 | `--raised` | 草稿卡 |
| `--l3` 输入框 | 与对话输入框一致：`--raised` + `--line-2` 描边、24px 圆角 | 输入框 |
| `--bubble` | `--hover` | 用户提问气泡 |
| `--bg`／`--field` | `--canvas`／`--sunken` | 切片与代码底色 |
| `--line` | `--line`／`--line-2` | 描边 |
| `--hi`／`--tx` | `--fg`（结论句靠 600 字重区分） | 正文与结论 |
| `--ob` | `--fg-3` | 操作对象、次要说明 |
| `--lo` | `--fg-4` | 仅图标与装饰；需读的提示用 `--fg-3` 保证对比度 |
| `--acc` | `--a`（同为 `#b3a1ff`） | ID 锚点、当前步骤、选中描边 |
| `--ins`／`--del` | `--ok`／`--err` | 草稿新增／删除 |

- 主按钮（应用）沿用站内 `.btn-primary`（`--a` 底、`--a-ink` 字），发送按钮沿用对话输入框的发送样式；原型的白底主按钮不保留。A0.2 截图时复核观感。
- 样式按 `docs/style-ownership.md` 分层：ASK 组件私有规则写在对应 Vue 样式块，只在确有跨组件复用时进入公共层；遵守 `docs/style-checks.md`，`npm run styles:check` 无新增禁用指令。

### 2.3 模型能力由用户界定

- 不维护模型白名单或黑名单，不按名称拦截纯文本或小参数量模型。
- 「设置 → ASK」写明能力边界：ASK 需要流式输出、工具调用与图片输入；附一句建议：原生多模态、工具调用稳定的模型效果更好。
- 一个「发送图片给模型」开关随 ASK 模型配置保存，同时承担文档 1 F7 的隐私开关与能力声明；关闭后进入受限模式，只提供元数据，抽屉标明当前模式。
- 模型不返回工具调用、拒收图片或格式不符时，如实显示上游错误；不自动换模型、不自动降级、不自动重试。

### 2.4 内容中立、渠道兼容与 R18 门控

文档 3 §2.1–2.3 全部保留：

- §2.1 宪章：技术中立、态度中立、零说教；不擅自删除、弱化或替换用户已有的标签；超出模型边界时只输出单行固定提示并结束本轮。这几条始终生效。
- §2.2 词表混淆 `src/ask/codec.ts`：纯函数、确定性、不破坏前缀缓存；本地 Store、提示词框和草稿卡永远是原始标签；出站替换、入站先还原再交给校验器和界面。
- §2.3 失败轮次事务回滚：被拦截、报错或空流中断的轮次不写入 `session.messages`。重试只由用户点击触发，符合「不自动重试」。
- 范围边界：不涉及未成年与 R18G。这条边界由代码中的排除表强制执行（见 §5），不只依赖宪章措辞。
- R18 内容由用户自行确认成年，并自行承担渠道风控与封号风险。产品不声称能避免封号。

门控细则见 §5。

### 2.5 「设置 → ASK」单独分组

设置分组变为：连接、模型、通用、安全与备份、ASK。路由沿用 `#/<workspace>/settings/<section>`，`settingsSections` 增加 `ask`。分组内容：

1. **模型**：从声明了 `reasoning` 的连接中选择连接；模型 ID 可从 `/v1/models` 获取或手动填写；能力边界说明与建议；「发送图片给模型」开关。
2. **个人偏好**：最多 300 字，默认空（文档 1 F8）。
3. **成年内容**：R18 确认开关，默认关闭（§5）。
4. **词表**：仅在 R18 确认后显示；内置词表只读，可添加自定义条目，以及「始终启用词表混淆」开关。

界面只保留基本信息与操作反馈，不加大段说明。本地代理模式按服务端已配置的推理连接显示选择器；没有推理连接时显示一行「请在服务端配置 ASK 推理连接后重启」。

### 2.6 文档之间的矛盾以文档 3 为准

| 项目 | 以文档 3 为准的做法 |
| --- | --- |
| Tab 应用草稿 | 仅当焦点在抽屉内且不在输入或选词状态，或焦点在 body 上时生效；不劫持提示词框和 CHAT 输入框 |
| Esc 关闭顺序 | 浮层 → 未决草稿 → 中断正在运行的循环 → 关闭抽屉 |
| L2 模型知识包 | 一次性全部装载进 System Block 1，不随生图模型切换而更换 |
| crop 裁切 | 先看过该图的 glance 或 look 才允许裁切；坐标用 0–100 百分比，自动外扩 25% |
| 草稿锚点 | 先精确匹配，失败后做归一化宽容匹配；`.keep` 下划线由前端本地计算 |
| 历史图片 | 只保留最近 3 轮的真实图片块，更早的替换为文字占位 |
| 并发 | 发送时锁定 `base_hash` 与历史游标；轮次结束后同步外部变化并插入 `.note` |
| 跨工作区草稿 | 靶向其他工作区时主按钮为「切回绘图并应用」 |
| 推理协议与 Gemini | 文档 1 §13 的「复用 Profile、Gemini 系列」按 §2.1 落实为两种协议 |

### 2.7 NAI 多角色与 Vibe 预留

文档 3 §3.1 要求 L0 包含多角色分区与 Vibe 摘要，草稿可靶向 `image.char.N.*`。当前绘图表单没有这两项：`src/gateway/routes.ts` 中 `char_captions` 恒为空，只有 `src/native/image-meta.ts` 读取元数据时会识别。

处理方式：L0 结构与草稿目标类型按 §3.1 定义并预留；表单缺少对应对象时，校验器返回「目标不存在」，该步作废并标注。等绘图页支持后自动生效。ASK 不顺便修改绘图业务。

## 3. 与现有代码的对接

### 3.1 直接复用

| ASK 需要 | 现有代码 |
| --- | --- |
| 跨工作区常驻 | `src/app/App.vue`：覆盖层位于 KeepAlive 外侧持续挂载 |
| 只读工作台快照 | `src/services/drawing.ts` 的 `snapshot()`；对话状态见 `src/services/chat.ts` |
| Prompt 分区 | `src/domain/highlight.ts` 的 `analyze()` |
| 画师串识别、`search_tags` | `src/services/tag-search.ts`；`src/domain/tags.ts` 的 Danbooru 分类（1 = 画师） |
| `view_sheet` 拼图 | `src/native/comparison.ts` |
| `restore_partial` 核对表 | `src/workspaces/image/ImportSheet.vue`、`src/domain/drawing.ts` 的 `reuseFields()`、`src/native/image-meta.ts` |
| CHAT 上下文与分支 | `src/domain/conversation.ts` 的 `contextSnapshot`、`branchTurns`、`ancestry`、`selectSource`；`chat.setPrompt`、`chat.mutate` |
| 请求与鉴权 | `src/gateway/transport.ts` 的 `endpoint()`、`authHeaders()`；`src/services/connections.ts` 的连接上下文 |
| Key 存储 | `src/services/vault.ts` |
| 存储命名 | `src/storage/names.ts` |
| 测试基建 | `node --test` 直接导入 `src/*.ts`；Playwright + Vite 开发服务器 + `context.route` 模拟上游 |

### 3.2 需要新建

1. **推理协议层**：两个 Profile、`reasoning` 能力、新的鉴权类型、SSE 流解析、工具调用增量拼装、图片输入块、`AbortController` 中断。
2. **显示 ID**：现有记录 ID 为 `crypto.randomUUID()`，没有 `#h`／`#f`／`#c`。需要一个会话内稳定、不复用的映射（`src/ask/ids.ts`）。
3. **撤销点**：`src/shared/HighlightInput.vue` 通过 `defineModel` 写值，程序赋值会打断原生 ⌘Z。草稿应用需要自建撤销记录，保证 ⌘Z 一次撤回。
4. **全局快捷键**：`src/` 目前没有 window 级 keydown。⌘J／Ctrl+J 由 ASK 模块注册一个监听，并在 App 作用域销毁时清理；输入法组合中（`isComposing`）不响应。
5. **本地代理推理转发**：`server.mjs` 按已配置的标准网关与两种 ASK 推理 Profile 放行固定路径，推理转发已在 A4 实现。

### 3.3 外壳层级

- `AskDrawer` 不是路由覆盖层，不写入 hash，不影响 KeepAlive 与现有覆盖层的路由守卫。它是非模态 `aside`，挂在 `App.vue` 中工作区之后、模态覆盖层之前，打开状态由应用级 ASK 服务持有。
- 设置、Key、确认面板是模态 dialog，打开时位于抽屉之上；关闭后抽屉状态不变。
- v1 中编辑器覆盖层打开时隐藏抽屉并停用 ⌘J（文档 1 D9）。
- 按 A4 后用户最新选择，ASK 使用「悬浮图标 ↔ 独立窗口」，替代通高抽屉。默认只显示紫色 ASK 图标；点击或 ⌘J／Ctrl+J 展开，标题栏提供放大／还原、设置和收起。工作区布局不切换、不预留侧栏；图标和窗口可拖动避让，边界随视口收窄重新限制，位置仅保留在本页内存。
- 收起保留会话、输入、运行轮次与未决草稿；回复完成不自动展开。编辑器打开时窗口和图标一起隐藏，模态弹窗层级保持。⌘K／Ctrl+K 的行内定位沿用 A4，「展开」进入悬浮窗口；Esc 顺序仍遵守 A2。
- 四个基础视口均为有边距的悬浮窗口，窄屏按可用宽高收窄；键盘可通过标题栏或图标上的 Alt＋方向键移动、Alt＋Home 归位。拖动坐标由原生驱动写 CSS 变量，不进入 Vue 高频状态。
- 图标默认位于顶栏下方 12px：IMAGE 桌面端贴历史栏左侧并保持 8px 间距，跟随历史栏展开／折叠；CHAT／TAG 及 IMAGE 窄屏位于页面右侧。用户拖动的位置按工作区分别保留在本页内存，Alt＋Home 恢复当前工作区的默认位置。

## 4. 目录与模块边界

```text
src/ask/
  service.ts            应用级入口：打开状态、会话、对工作区暴露 open({ anchor })
  AskDrawer.vue         抽屉容器、顶栏、Esc 层级、live region
  AskStream.vue         消息流、工具轨迹行、ID 锚点、.note、.pick
  AskComposer.vue       输入框、上下文胶囊、模型名、发送／停止
  DraftCard.vue         草稿卡与四种切片
  AskMark.vue           B+ 标识与思考态动画
  session.ts            内存会话、轮次事务、预算、图片脱水
  runner.ts             工具循环（async generator，最多 6 步，草稿即停）
  provider.ts           中间消息结构与适配器分派
  adapters/
    openai-chat.ts
    anthropic-messages.ts
    sse.ts
  codec.ts              出站编码、入站还原
  codec-exclusions.ts   不可编码的排除表（未成年、R18G）
  ids.ts                显示 ID 映射
  pacer.ts              诚实节拍器（界面层，A0.2 新增）
  format.ts             回复的轻量格式解析，只产出文本节点（A0.2 新增）
  digest/               L0 组装、模式 A／B、冷区聚类、Prompt 分区
  tools.ts              工具注册，只接收只读视图
  vision.ts             缩放、裁切、拼图与缓存
  library.ts            本轮图片快照、参数与 Prompt 差异（A1 新增）
  AskReference.vue      ID 预览与点击定位（A1 新增）
  draft/
    validate.ts         锚点匹配、hash 校验、目标存在性、画师串拦截
    apply.ts            唯一写入入口
  prompts/              L0–L2 分层，带版本号
  messages.ts           中间消息结构与错误分类（A0.1 从 provider.ts 拆出，避免与适配器循环依赖）
  canonical.ts          固定键序序列化
  settings.ts           ASK 设置的读取与校验（koma.ask.v1）
src/app/ask.ts          注入键与 useAsk()（A0.2 新增）
src/services/tag-memory.ts 本页已加载词典的有界内存索引（A1 新增）
src/overlays/settings/AskSection.vue
```

结构约束：

- 依赖方向：`ask` → `services`（只读视图）／`domain`／`native`／`gateway`。工作区只通过 `service.ts` 打开 ASK，不导入其内部模块。
- `tools.ts` 从类型和结构上接触不到写入接口；`draft/apply.ts` 是唯一写入模块，只由界面确认事件调用，复用现有表单与对话写入路径。
- `codec.ts` 只在 `provider.ts` 的收发边界调用；界面、Store、校验器只见原始文本。
- ImageBitmap、Blob、AbortController、会话消息与图片缓存不进深层 reactive；Vue 只持有低频界面状态。
- 新增依赖为零。

存储：

| 名称 | 内容 | 备份 |
| --- | --- | --- |
| `koma.ask.v1` | 连接引用、模型 ID、发送图片开关、个人偏好、自定义词表、始终启用词表混淆 | 作为可选逻辑字段 `ask` 纳入新版备份 |
| `koma.ask.adult.v1` | R18 确认 | 不纳入备份，换设备重新确认 |

ASK 对话不持久化（文档 1 D10）；连接配置沿用 `koma.routing.v1`，Key 仍排除在备份之外。

## 5. R18 门控

**状态与入口**

- 「设置 → ASK → 成年内容」中一个开关，标签写明「我已成年，自行承担渠道风控与封号风险」，默认关闭。不弹原生确认框。
- 确认状态保存在 `koma.ask.adult.v1`，不进备份。
- 开关变化从下一轮发送时生效，当前轮的快照不变；切换会改变静态前缀，缓存重建一次。

**未确认时**

- 宪章加载中立版本：技术中立、零说教、不擅自删改标签、单行拒绝。不加载成年语境声明。
- 词表混淆不可用，「词表」小节隐藏。
- 拦截后显示「仅发元数据重试」，并附一行「可在设置 → ASK 确认成年内容后启用词表混淆」及设置入口。

**确认后**

- 宪章追加成年语境声明，措辞为「用户已自行确认成年」，不写「已验证」。
- 拦截后同时显示「启用词表混淆并重试」与「仅发元数据重试」。点击前者后，本页会话内保持启用，刷新后恢复默认；「始终启用词表混淆」开关可改为默认启用。
- 代号表附在静态 System 末尾（偏好块之后、断点 #2 之前），启用或停用都只在轮次边界改变前缀。

**排除表（代码强制）**

- `src/ask/codec-exclusions.ts` 维护未成年与 R18G 两类排除表，按代码审查。
- 内置词表不收录排除词；用户添加的自定义条目命中排除表时拒绝保存，并提示「该词不在可混淆范围」。
- 匹配前统一大小写、下划线与空格、全角与半角。
- 单元测试锁定：排除词永远原样出站，编码与还原往返一致，未确认 R18 时编码器为恒等函数。

**验证边界**

- 模拟测试只证明编解码正确与往返一致。是否能通过具体渠道的过滤，要等真实渠道实测；实测前文档不声称已解决拦截问题。

## 6. 里程碑

每个阶段在 `codex/ask-*` 分支实施，完成后补实施记录 `docs/ask/ask-a*.md`。退出时必须通过 `npm run check` 和相关浏览器测试；推送与发布另行授权，推送前做脱敏复查。

### A0.1 协议与设置

- `profile.ts`：两种协议、鉴权类型、`reasoning` 能力、登记表；`config/connections.ts` 校验；「添加连接」表单协议选项；`connection-test.ts` 覆盖新协议的诊断。
- `provider.ts` 与两个适配器：中间消息结构、§1.2 载荷顺序、Anthropic 断点位置、固定键序序列化、SSE 解析（含工具调用增量）、`usage` 解析、中断。
- `codec.ts` 与排除表；`names.ts` 新名称；备份逻辑字段 `ask`；`AskSection.vue`；`settingsSections` 增加 `ask`。
- 测试：`tests/ask-provider.test.mjs`（连续两轮静态前缀字节一致、表单变化只影响队尾、断点位置、SSE 与工具调用增量、中断）、`tests/ask-codec.test.mjs`（往返、排除表、自定义条目拒绝、归一化、门控关闭时恒等）、备份与路由测试更新；设置页浏览器用例覆盖新分组、新协议连接、R18 默认关闭。

### A0.2 会话与抽屉

- `service.ts`、`AskDrawer`、`AskStream`、`AskComposer`、`AskMark`：⌘J／Ctrl+J、Esc 层级（此时草稿层为空实现）、窄屏底部面板、减少动态、`aria-live` 整段播报。
- `ids.ts`：`#hN` 按进入历史的顺序分配、本页会话内不复用；`#fN` 在收藏加载时按收藏时间升序分配、会话内不复用；`#cN.M` 为当前分支第 N 轮第 M 个版本。
- `session.ts`：轮次事务（成功才提交）、预算计数、快照隔离；`runner.ts`：最多 6 步，草稿即停（草稿在 A2 实现）。
- `digest/` L0：表单、Prompt 分区、当前图、生成状态、历史索引、`base_hash`。
- 失败界面：回滚与按门控显示的重试按钮。诚实节拍器（`toolMin` 等）放在界面层。
- 模拟 LLM：按脚本返回两种协议的 SSE，包括文本、工具调用、拦截错误与空流。
- 测试：`tests/ask-digest.test.mjs`、`tests/ask-session.test.mjs`（回滚、预算），`tests/ask.browser.mjs`（开关、Esc 顺序、脚本化文本轮次、模拟网关零生图请求、设置弹窗压在抽屉上、编辑器打开时抽屉隐藏、四视口截图存 `.local/ask/`）。`test:ask` 脚本与 CI 步骤已在 A0.1 提前加入，A0.2 在同一文件中扩充用例。
- 退出：文档 1 A0 的「摘要与预算单测通过」，以及上述浏览器用例。

### A1 只读工具与视觉

实施状态：功能与模拟验证已完成，见 [A1 记录](ask-a1.md)。用户已批准桌面／手机截图方案，并选择本轮先用合成图片；真实图片黄金样例仍单列待办，不以脚本回复替代质量验收。

- 工具：`get_state`、`search_history`、`get_meta`、`diff_meta`、`view_image`、`view_sheet`、`search_tags`；外部文本包在 `<data>` 中。
- `vision.ts`：glance／look／crop（先全图、百分比坐标、25% 扩边、768px 以内）、sheet 复用 `comparison.ts`、按 `id + 规格 + 区域` 缓存；单轮 4 次视觉、1.5MP、400KB 预算，超出时返回错误。
- 模式 A 同心圆、模式 B 衰减、冷区聚类。`historyLimit` 默认 25，聚类先实现简化版，阈值留待真实数据。
- 入口：画框「Ask」、历史选两张时「Ask Diff」、报错卡「Ask Why」；ID 锚点悬停缩略图，点击定位；`.pick` 消歧；历史图片脱水。
- 入口与 ID 展示会改动绘图工作区的现有界面，实施前先给出截图方案，经用户确认后再落地。
- 测试：预算、裁切换算、脱水、同心圆、衰减的单元测试；S1、S2 脚本化浏览器流程；零生图请求。黄金样例用真实图片，存放在 `.local/`，不提交，只在实施记录里登记命中率。

### A2 草稿

实施状态：功能与合成样例／模拟服务验证已完成，见 [A2 记录](ask-a2.md)。支持普通 CHAT 输入框草稿；分支、上下文操作按 A3 实施。

- `draft/validate.ts`：两级锚点匹配、`base_hash` 冲突、目标存在性（含 `image.char.N.*` 预留）、画师串拦截（词典分类 1，用户本轮点名的画师除外）。
- `draft/apply.ts`：唯一写入入口；自建撤销点，⌘Z 一次撤回；应用后不生成，生成按钮照常重新报价。
- `DraftCard`：局部增改、整段改写（`.keep` 本地计算）、参数恢复三种切片；逐步撤回／恢复；完成态与「撤销」；Tab 焦点护栏；「切回绘图并应用」；轮次结束后的 `.note` 与冲突对齐。
- 测试：验收 1、4、5；黄金样例增加「不擅自净化」（成人向与身体特征标签在草稿中保持原样）。

### A3 CHAT 适配

实施状态：已实现并通过合成图片／模拟服务验证，见 [A3 记录](ask-a3.md)。摘要仅覆盖当前分支；其他分支不自动附带。

- `get_chat_context`：各轮勾选、底图、配额、实际发送文字。
- `chat_distill_branch`：选定起点轮次（`selectSource`）、调整上下文勾选（`chat.mutate`）、填入输入框（`chat.setPrompt`）。每一步都是普通界面操作，不发送。
- 分支切片与光标；S6 样例通过；断言对话发送请求数为零。

### A4 本地代理与行内模式

实施状态：已实现并模拟验证，见 [A4 记录](ask-a4.md)。服务端使用 `KOMA_ASK_OPENAI_URL`／`KOMA_ASK_OPENAI_KEY` 和 `KOMA_ASK_ANTHROPIC_URL`／`KOMA_ASK_ANTHROPIC_KEY`；两组成对、独立可选。

- `server.mjs` 增加两种推理协议的固定路径转发与流式透传，沿用 Host／Origin 校验与回环监听；服务端 URL／Key 不注入浏览器。地址规则见 A4 记录。
- ⌘K 行内模式，与 Tag 补全、输入法共存的测试通过。

### v2

跨工作区摆渡、编辑器内 ASK、画师知识库评估（文档 1 §16）。

## 7. 验收映射

| # | 标准 | 阶段 | 方式 |
| --- | --- | --- | --- |
| 1 | 用户确认前提示词框与表单不变 | A2 | 浏览器 |
| 2 | 任意对话路径下生图类请求为零 | A0.2 起每个用例 | 浏览器（模拟网关记录） |
| 3 | 单轮外发图片不超预算 | A1 | 单元 |
| 4 | 涉及 `artist_mix` 的草稿操作被拦截 | A2 | 单元 |
| 5 | 内容变化后的旧草稿不被直接应用 | A2 | 浏览器 |
| 6 | 无原生弹窗；Esc 按层级关闭；回复完成后整段播报 | A0.2／A2 | 浏览器 |
| 7 | 四个基础视口可用；图标／窗口可收起、拖动、放大与还原，窄屏限制在可见范围内 | A0.2／A4 后调整 | 浏览器与截图 |
| 8 | 连续两轮静态前缀字节一致，动态状态只在队尾 | A0.1 | 单元 |
| 9 | 失败轮次不进入会话历史 | A0.2 | 单元 |
| 10 | 编解码往返一致；排除词不编码；未确认 R18 时不编码 | A0.1 | 单元 |
| 11 | 界面与 Store 中始终是原始标签 | A0.2／A2 | 浏览器 |
| 12 | 不擅自净化用户标签 | A2 | 黄金样例 |

## 8. 风险与实测待办

- **CORS**：各供应商和中转对浏览器直连的支持不同；Anthropic 官方需带直连声明头。不支持时静态版明确提示改用本地模式（A4），不静默回退。
- **工具调用格式差异**：OpenAI 兼容中转的流式工具调用增量格式可能不一致，适配器要容错，测试覆盖常见变体。
- **词表混淆实效**：未经真实渠道验证；渠道风险由用户在门控处确认承担。
- **token 预估**：发送前只能本地近似，标注「约」；实际用量以上游 `usage` 为准。
- **快捷键冲突**：Windows／Linux 浏览器的 Ctrl+J 默认打开下载，需实测 `preventDefault` 是否生效；不生效时另选组合并更新文档。
- **历史容量**：`historyLimit` 默认 25，与文档 1「40 张以上」的假设不同，冷区聚类的价值待真实会话评估。
- **提示词质量**：按文档 3 §4.3，先交付结构合规的基础版提示词跑通管道，领域调优在管道验收后独立迭代，用黄金样例回归。

## 9. 未决问题

1. 冷区聚类阈值（文档 1 §17）。
2. 已定：⌘K／Ctrl+K 在 Prompt、Negative 和 CHAT 输入框开启行内模式；Tag 的 Tab／Esc 保留原行为，输入法组合中不响应。
3. 已定：CHAT 摘要只包含当前会话的当前分支，不自动附带其他分支概要。
4. 画师知识库的数据来源、格式与许可（v2，单独立项）。
5. 绘图工作区入口与 ID 位置已由 A1 桌面／手机截图确认并落地，见 [A1 记录](ask-a1.md)。
6. 已定：两种推理协议各用独立的 `KOMA_ASK_*_URL`／`KOMA_ASK_*_KEY`，不复用图像网关密钥。

## 10. 第 0 步记录

- 2026-10-21：`codex/composer-quiet` 上的输入框与连接摘要卡改动在 `npm run check` 和 shared／workspaces／native／local 四组浏览器测试（34 项）通过后提交为 `b37381b`。
- 新建 `codex/ask-plan` 分支，纳入文档 1–3 与原型，新增本文，并同步更新 `AGENTS.md`、`docs/implementation-plan.md` 与 `README.md`。未写实现代码，未推送或部署。
- A0.1 在 `codex/ask-a0` 分支实施，记录见 [ask-a0.md](ask-a0.md)。
- A0.2 在同一分支继续实施，记录见 [ask-a0.md](ask-a0.md) 的 A0.2 部分；与规划的差异（抽屉从顶栏下沿开始、暂只有快捷键入口、`get_state` 提前）已登记在该记录中。
- A0 在完成停止回滚修正与模拟检查后提交为 `468d876`。A1 在独立 `codex/ask-a1` 分支实施，记录见 [ask-a1.md](ask-a1.md)；本轮按用户选择使用合成图片，入口按用户批准的截图接入。
- A2 在独立 `codex/ask-a2` 分支接续 A1 提交 `82f2bc8`，实施记录见 [ask-a2.md](ask-a2.md)。本阶段仅本地实现与验证，未推送或部署。
- A3 在 `codex/ask-a3` 实现并提交为 `eef130b`；A4 在 `codex/ask-a4` 接续，实施与集中回归见 [ask-a4.md](ask-a4.md)。两个阶段均只在本地完成，未推送或部署。
