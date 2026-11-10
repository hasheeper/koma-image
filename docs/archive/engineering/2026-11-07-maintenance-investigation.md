# 测试、残留代码与文档勘探及收口记录

日期：2026-11-07。源码基线：`main` / `2d5eba5`，产品版本 `0.5.0`。

状态：用户随后已授权并开展本地收口，结果见[收口结果](#收口结果)。下方“范围与取证方式”至“验证范围与尚未定论的事项”保留收口前调查基线，其中候选、行号与未执行说明只描述勘探当时；不取代现行契约，也不构成推送或部署授权。

用户关注三个方面：测试膨胀与样式细节测试、无用代码与僵尸功能、过时计划及文档职责重复。调查方向是保留主链路回归保障，识别其余内容的实际价值；具体保留／删除清单尚未逐例定稿。

## 范围与取证方式

- 读取[架构](../../architecture.md)、[业务契约](../../business-contracts.md)、[当前状态](../../status.md)、[文档索引](../../README.md)和相关专题。
- 统计 Git 跟踪文件及物理行数；行数含空行、注释和同文件辅助代码，不等于净逻辑行数。不计依赖、构建产物、Git 历史和本地原型。
- 检索测试中的样式、几何、截图及文本断言，并抽查相关用例；用 TypeScript AST 统计浏览器测试定义和按协议展开的循环。
- 从前端、开发预览、本地服务入口追踪静态导入、动态导入字面量和 Worker URL，再检索导出符号与服务方法的源码／测试调用。
- 核对现行文档、历史索引和代表性旧计划的内容归属；检查扫描到的相对文件链接目标。没有以本次检查代替全部锚点、远程链接或历史内容审计。

开始时已有两份历史文档的未提交修改：`docs/archive/2026-10-25/docs/ask/ask-a0.md`、`docs/archive/2026-10-25/docs/implementation-plan.md`。本次未改动它们。下述数量是新增本文之前的快照。

## 测试调查

### 规模与分布

| 类别 | 文件数 | 物理行数 | 口径 |
| --- | ---: | ---: | --- |
| Node 单元测试 | 53 | 8,869 | `tests/*.test.mjs` |
| 浏览器测试 | 47 | 15,312 | `tests/*.browser.mjs` |
| 发布包测试 | 1 | 127 | `tests/release.package.mjs` |
| 测试辅助 | 6 | 564 | `tests/helpers/*.mjs` |
| 合计 | 107 | 24,872 | 另有 1 份 Markdown 样例，测试目录共 108 个文件 |

浏览器测试占测试代码约 61.6%。AST 找到 336 处浏览器 `test` 定义；循环会继续展开，因此这不是实际执行用例总数。ASK 前缀的单元及浏览器测试合计 40 个文件、9,066 行。

[浏览器调度脚本](../../../scripts/test-browser.mjs)默认只选择 `[core]`，当前有 5 条，分布于绘图、CHAT、EDIT、收藏编号和 ASK 草稿。该标记用于现有 CI 冒烟，不能直接解释为全部主链路保障；备份、跨页锁、Bridge、部分协议等重要行为仍在其他用例中。

### 已确认的断言与收缩候选

| 编号 | 证据位置 | 实际内容 | 勘探判断 |
| --- | --- | --- | --- |
| T01 | [home-layout.test.mjs](../../../tests/home-layout.test.mjs)，基线第 6、18、23、37 行 | 四档宽度 × 三种布局；列数、8／16 间距和单图 220px 尺寸写死 | 固定排版取值属于收缩候选。同文件的不漏图、不裁切、比例与边界检查具有算法意义，不能把所有断言一概称为样式测试 |
| T02 | [native-nai-models.browser.mjs](../../../tests/native-nai-models.browser.mjs)，第 289 行 | 直接断言额度条 CSS 变量 `--p` 为 `100%` | 绑定呈现实现；与额度数值、未知状态、来源选择的业务检查应分开判断 |
| T03 | [ask-prompts.test.mjs](../../../tests/ask-prompts.test.mjs)，第 54、67 行 | 正则匹配指定中文句子、字段示例及提示词所在层 | 只能证明文字存在，不能证明模型效果；措辞锁定属于收缩候选。工具权限和实际出站结构有独立业务价值 |
| T04 | [ask-compact.test.mjs](../../../tests/ask-compact.test.mjs)，第 200 行起 | 同一用例混合 memo 完成／失败解析、固定版本 `8`／`.k8` 和多句提示词检查 | 版本与措辞锁定可独立识别；解析、截断、拒绝及上下文隔离不能随整段误删 |
| T05 | `tests/updates.browser.mjs`（收口时已删除），第 35 行 | 更新日志浏览流程硬编码历史版本 `v0.3.3` | 历史版本依赖不提供主链路保障；整个独立浏览器场景也是精简候选，但阅读状态持久化是实际行为 |
| T06 | `tests/ui-components.browser.mjs`（收口时已删除） | 测开发预览页的示例状态、示例文案及共享菜单 | 预览页独立流程属于低优先级候选；菜单 Esc、焦点、KeepAlive 清理已有真实画板场景，仍需核对具体覆盖重叠 |

对 `tests/` 的检索未发现 `getComputedStyle`、`toHaveCSS` 或 `screenshot()` 调用，未发现大面积字号、圆角与间距锁定。`boundingBox()` 等坐标读取多数用于笔刷、框选、批注拖动和 Photopea 指针输入；这些输入和图像／蒙版像素结果不是无用样式断言。

### 重复业务场景

AST 识别到 25 处浏览器测试定义位于按连接／协议展开的循环中。明显集中于：

- [ASK 压缩](../../../tests/ask-compaction.browser.mjs)：8 处循环定义，涉及压缩、恢复、编辑／分支、失败和保存边界。
- [ASK 草稿](../../../tests/ask-drafts.browser.mjs)、[上下文](../../../tests/ask-context.browser.mjs)、[持久化](../../../tests/ask-persistence.browser.mjs)：相同 UI／状态流程在多个协议中重复运行。
- [附件](../../../tests/ask-attachments.browser.mjs)、[命名](../../../tests/ask-naming.browser.mjs)、[工具正文](../../../tests/ask-response.browser.mjs)及[Bridge](../../../tests/bridge.browser.mjs)也存在同类展开。

这些是冗余候选，不等于 25 处都可直接删除。协议的流式结构、工具调用配对、签名回传、缓存标记和用量字段确有差异；完整 UI 流程的重复与必要协议覆盖需要分开判断。目前尚未形成“每个拟移除用例由哪条保留用例覆盖”的逐例对应表，也未给出删减比例。

### 本轮识别到的业务保障范围

下表记录判断测试价值时涉及的现有行为，不是已确定的测试文件保留名单。

| 业务范围 | 需要区分于展示细节的实际结果 |
| --- | --- |
| 启动与连接 | 缺配置不请求；凭据与目标地址不串用；切换工作区保留现场 |
| IMAGE | 单张／串行批量、提交参数、报价与 `max_cost`、取消、失败不重试、原图与收藏 |
| CHAT | 参考图和实际上下文、分支／版本、附件消费、刷新恢复与图片交接 |
| EDIT 与 Photopea | 源图／蒙版像素、原图／直出／合成、手动应用、回传校验及后台任务归属 |
| ASK | 推理协议、工具与最终正文、冻结目标、草稿确认／冲突／撤销、停止及收藏恢复 |
| 数据与调度 | 图片身份、跨页锁、保存失败、备份校验／冲突／恢复、原图字节及凭据隔离 |
| Slate 与 Bridge | 草稿审阅、任务版本、独立绑图、目录边界、文件与本地数据失败补偿 |
| 本地运行与交付 | 固定代理路径、服务端凭据隔离、静态子路径、运行包和必要资源 |

## 残留代码调查

### 方法与导出证据

静态导入图未发现完全脱离前端、开发入口或本地服务的自有源码模块；`src/env.d.ts` 属类型声明，不作为运行时孤立文件。文件可达不代表每个方法、字段或条件分支都有效。

| 编号 | 代码位置 | 调用证据与判断 |
| --- | --- | --- |
| C01 | [editor.ts](../../../src/services/editor.ts) 的 `applyAnnotations`，第 1410 行 | 生产源码未找到调用；仅 `tests/annotations-focus.browser.mjs`（收口时已删除） 和 [annotations.browser.mjs](../../../tests/annotations.browser.mjs)调用。批注转 NAI 蒙版／聚焦已没有界面入口 |
| C02 | 同文件 `runAnnotations`，第 1434 行 | 仅 `annotations.browser.mjs` 调用。当前通用 EDIT 使用 `prepareEditorImageEdit` 与比较状态，旧独立批注生成链路是残留候选 |
| C03 | [bridge/export.ts](../../../src/bridge/export.ts) 的 `writeReference`，第 23 行 | 仅 [bridge-refs.test.mjs](../../../tests/bridge-refs.test.mjs) 调用；现行文件写入通过草稿确认及 [draft-files.ts](../../../src/bridge/draft-files.ts) |
| C04 | [slate/documents.ts](../../../src/slate/documents.ts) 的 `combineSlateDocument`，第 49 行 | 仅 [slate.test.mjs](../../../tests/slate.test.mjs) 调用；没有产品调用者 |
| C05 | [ask/pacer.ts](../../../src/ask/pacer.ts) 的 `rush()`，第 47 行 | 仅 [ask-session.test.mjs](../../../tests/ask-session.test.mjs) 调用；实际停止路径使用 `cancel()`。`rushed` 状态也只服务于该方法 |
| C06 | [services/annotations.ts](../../../src/services/annotations.ts) 的 `openReview()`，第 92 行 | 源码和测试均未找到调用者 |
| C07 | [domain/catalog.ts](../../../src/domain/catalog.ts) 的 `shownId` | 只有定义，未找到源码或测试引用 |
| C08 | [domain/media.ts](../../../src/domain/media.ts) 的 `EDITOR_MODES` | 只有定义，未找到源码或测试引用 |
| C09 | [native/image-meta.ts](../../../src/native/image-meta.ts) 的 `DIALECTS` | 只有定义，未找到源码或测试引用 |
| C10 | [native/photopea-scripts.ts](../../../src/native/photopea-scripts.ts) 的 `resetPhotopea` | 只有定义，未找到源码或测试引用；不代表其他 Photopea 初始化／关闭脚本无用 |

以上依据是当前仓库的调用检索及局部实现核对，不是删除后的编译或运行验证。没有进行全量动态可达性、CSS 动态类名或所有资源的覆盖率证明。

### 旧 EDIT 批注路径的连带状态

`EditorVersion.annotation` 的旧结果数据由 `runAnnotations` 创建，旧 `annotationReview` 继续创建回贴版本。相关代码仍包括：

- [EditWorkspace.vue](../../../src/workspaces/edit/EditWorkspace.vue) 的 `reviewAnnotations()` 以及依赖 `shown.annotation` 的审核按钮。
- 编辑服务中的 `annotationReview()`、关联版本保护、蒙版对齐例外和删除后的关系清理。
- 批注服务的 `editorReview()` 转接。

这些位置在文本和导入关系上仍有引用，但数据生产入口只被测试调用，属于同一残留链的候选范围。现行[批注专题](../../workspaces/annotations.md)和[状态页](../../status.md)也记录了服务层保留情况；本次没有改写该现行说明。

### 不能混入残留清单的内容

| 对象 | 当前用途或约束 |
| --- | --- |
| [AnnotationReview.vue](../../../src/shared/annotations/AnnotationReview.vue) | CHAT 的人工审核／回贴仍通过 `chatReview()` 使用；不能据旧 EDIT 链路失去入口就认定整个共享窗口无用 |
| `annotationMask`、`annotationPreview`、本地合成函数 | 当前批注定位图、CHAT 回贴及通用 EDIT 等仍有实际调用，不能按旧方法的 import 列表整包删除 |
| [scheduler.ts](../../../src/services/scheduler.ts) 的 `ReservationPort` | 没有生产调用，但[现状范围](../../status.md#当前范围之外与已取消事项)明确保留额度预占边界。它是显式预留，不能仅按测试调用判定为意外残留 |
| [ask/service.ts](../../../src/ask/service.ts) 的 `attachmentText()` | 当前仅供多份测试读取附件内容，属于测试观察接口。是否仍必要取决于实际保留的验证方式，尚未定论 |
| 模块内部调用、外部只供测试导入的函数 | 本文件内被生产逻辑使用仍然具有实际作用；“没有其他源码 import”不足以证明死代码 |
| 旧入口和新版 Koma 数据字段兼容 | HTML 重定向、备份／图片身份的合法兼容读取有现行契约，不能与已取消的旧应用数据迁移混为一谈 |

## 文档调查

### 数量与可达性

新增本文前，`docs/` 有 29 份现行 Markdown、103 份历史 Markdown，分别为 3,853 行和 10,793 行；另有 3 个说明资源文件。

相对文件链接扫描未发现目标不存在的链接，也未发现扫描范围内没有入链的 `docs/` 文档。该结果只说明入口可达，不能证明内容仍准确；逐字段落比较也未发现长段完全相同的复制，重复主要发生在主题和规则的维护责任上。

### 已确认的冲突与职责重叠

| 编号 | 证据 | 判断 |
| --- | --- | --- |
| D01 | [业务契约 B27](../../business-contracts.md)写每页 25 条；[设置与 TAGS](../../workspaces/settings-and-tags.md#词典与描述控件)及 [TagsWorkspace.vue](../../../src/workspaces/tags/TagsWorkspace.vue) 的 `pageSize` 为 24 | 现行文档与实现存在明确冲突 |
| D02 | [根 README](../../../README.md)仍写暗色／系统／亮色；[theme.ts](../../../src/app/theme.ts) 只定义 `light`／`dark` | 使用说明保留了已取消的系统主题选择 |
| D03 | [status.md](../../status.md)基线为 192 行、35,237 字节，包含 26 个归档链接，以及多个版本的发布过程、调试实验和界面微调记录 | 现状与待办、变更过程和验收记录混在同一入口；其中许多事项已有专题或归档维护 |
| D04 | [压缩文档 §14](../../ask/compaction.md#14-界面与设置)与 [ASK UI §9](../../ask/ui.md#9-上下文压缩)同时维护记忆行字号、行高、间距、展开高度和交互 | 同一呈现规则有两个详细维护位置；链接本身没有消除重复职责 |
| D05 | [批注规划](../workspaces/2026-11-04-region-annotations-research-plan.md)顶部仍写“未发布”；[归档索引](../README.md)及 [v0.5.0 发布记录](../releases/2026-11-06-v0.5.0-release.md)说明后续已发布 | 当时状态与最终状态的时间边界不够直观；不能据此把历史验收事实改成当前事实 |

### 旧计划与完整快照

[2026-10-25 快照](../2026-10-25/README.md)共 39 份 Markdown、5,566 行，保留了旧 README、工程约定、架构、业务契约、ASK 文档 1–4、窗口 v5、压缩、TS 迁移、字体／样式和多角色计划等。现行专题已经接替这些文档的日常维护职责。

其中也混有阶段实施记录、原始设计依据和验收事实。当前只能确认旧规范和计划存在较大的重复候选范围，尚未完成逐份“独有内容是否已保存到其他位置”的核对，不能把整个快照目录判为可直接删除。

近期的模型与连接、批注、HOME、ASK 编辑接入等规划也已归档，并从现行文档提供背景链接。归档链接本身不是问题；问题在于旧正文中的当前口吻、未发布状态或规则优先级可能与现行专题产生歧义。

### 对照现有约定的职责边界

以下是依据[文档维护规则](../../README.md#文档维护规则)识别重叠时采用的职责，不是本次新增的文档重组方案。

| 入口 | 应承担的维护责任 |
| --- | --- |
| 根 README | 产品使用入口、快速开始、协议与运行概览、许可 |
| 产品专题 | 产品定位、功能框架和设计原则 |
| 架构 | 技术结构、模块分工、依赖与生命周期所有权 |
| 业务契约 | 跨模块必须保持的业务约束；细节链接到责任专题 |
| 工作区／集成／工程／ASK 专题 | 各自负责的现行行为和维护细节，同主题保持单一维护位置 |
| 当前状态 | 当前实现、真正待验项和未开放范围 |
| 归档 | 有明确基线和时间范围的设计依据、阶段过程及验证证据 |

`docs/release-guide.md`、`docs/third-party-assets.md` 和公开 Bridge Skill 路径是现有发布接口，不属于任意移动或删除的普通文档。

## 验证范围与尚未定论的事项

- 同一会话先前在上述源码基线上实际执行过严格类型检查和 Node 单元测试：类型检查通过，474 个单元测试通过，零失败、零跳过。该结果记录的是清理前基线，不证明候选删除已经安全。
- 本次勘探未重跑浏览器全量测试、构建或真实供应商调用，也未执行收费生成、推送或部署。
- 尚未形成逐例测试保留／移除映射；跨协议循环、开发预览和非主链路功能测试只是收缩候选，不能按文件名或 `[core]` 标签直接批量删除。
- 尚未验证残留链删除后的类型、引用、资源和运行行为，也未给出可削减行数承诺。
- 尚未逐份核对历史计划中的唯一决策与验收内容；未迁移历史证据或合并旧文档，本次仅补充本文的归档索引与状态页入口。

以上为勘探时记录，实施结果单独列于下方。

## 收口结果

2026-11-07，用户明确要求开始收口后实施。改动仅在本地 `main`，版本仍为 0.5.0，未提交、推送或部署。

### 代码清理

- 移除旧 EDIT `applyAnnotations`／`runAnnotations`／`annotationReview`、结果字段及关联保护／清理分支，连同转接按钮、服务方法和专属 CSS。现行通用 EDIT 比较／合成、NAI 手绘蒙版／聚焦和 CHAT `AnnotationReview` 保留。
- 删除仅测试调用的 Bridge `writeReference`、Slate `combineSlateDocument`、pacer `rush` 及专属状态；保留确认后文件草稿写入和实际停止 `cancel`。
- 删除无引用导出 `shownId`、`EDITOR_MODES`、`DIALECTS`、`resetPhotopea`。
- `ReservationPort` 是现行契约的显式预留；`attachmentText` 仍供持久化测试观察附件；均保留。

### 测试取舍

| 移除或缩减 | 保留的保障 |
| --- | --- |
| 旧 EDIT 批注生成／蒙版转换两例及 `annotations-focus` 文件 | 现行 `annotations` 通用 EDIT 请求／合成、CHAT 双图／ZIP 恢复；原生 NAI focus 专题 |
| 更新日志历史版本、开发预览示例、连接图标文件及浏览器图标矩阵 | 更新日志解析单元、真实画板菜单；连接／协议／Key／实际来源请求 |
| HOME 四宽度排版矩阵、固定列数／间距／单图尺寸、加载期间空卡闪现 | 三种布局不漏图／比例／边界／重叠算法；HOME 数据恢复与导航 |
| 额度条 CSS、全工作区×视口主题矩阵、Toast 动效计时、长文本高亮镜像反复校验 | 额度实际数值与选择；主题持久化／跨页同步；高亮逻辑和主链路参数往返 |
| 两例提示词措辞断言、固定压缩提示词版本／文案 | 自由创作门控、按需手册、memo 完整性／错误解析与上下文隔离 |
| ASK 长附件预览、编辑框层级、多个展示入口的重复流程 | 附件发送／持久化、会话切换／编辑／分支、草稿 IME／Tab 护栏、真实视觉工具与手动操作 |
| 20 处按协议重复的状态／UI／持久化／Bridge 流程，每处保留 OpenAI 代表场景 | 双协议压缩请求往返、工具正文／命名／视觉隐私协议用例，Gemini 集成及三协议适配／错误单元仍保留 |

默认核心冒烟由 5 条扩为 9 条：原有 IMAGE、CHAT、EDIT、收藏编号、ASK 草稿，加上既有外壳保活、跨页任务锁、无 Key 备份界面和 Bridge 手动草稿；不新建重复测试。未将所有非核心专题删除，计费、取消、失败补偿、数据与像素边界继续按需运行。

### 文档归属

- 状态页移除已发布过程与重复界面描述，保留供应商、NAI、ASK 空响应／质量、目录与设备真实待验，以及未实施／未开放范围。
- 修正 TAGS 每页 24 条、两档外观、旧 EDIT 服务说明和批注规划的历史“未发布”边界。压缩 UI 只由 `ask/ui.md` 维护。
- 早期九份重复副本删除：架构、业务契约、设计语言、发布指南、第三方资源、ASK UI、CSS 治理计划、旧工程约定和旧项目 README。G0–G4 基线及验收已在字体／样式记录中保留；ASK UI 独有的中日韩解析核验转入窗口记录。
- 五份已完成计划裁为记录：ASK 初期交付、窗口 W1–W6、压缩 CP1–CP4、角色画板 C1–C5、TS 迁移 T0–T5。独有阶段结果保留原文、日期和模拟／真实边界，不再重复维护计划正文。
- 原始 ASK 产品构想与边界修订、A0–A4／R1–R4、M1–M7 及发布证据保留。预存的两份用户修改继续保留，仅同步文档引用及对应说明。发布包固定路径与公开 Bridge Skill 不变。

### 本地验证

| 检查 | 结果与边界 |
| --- | --- |
| `npm run check` | 严格类型、458 项 Node 单元和生产构建通过；保留既有的大包体积提示 |
| `npm run styles:check` | 通过；仅删除旧入口专属规则，没有新增可见布局 |
| 受影响专题浏览器 | 197 项：196 项首轮通过，1 项批注多边形拖动使用旧画布尺寸而失败；修正为手势开始时测量当前画布，保留坐标及撤销断言，定向复测通过 |
| 默认 `node scripts/test-browser.mjs` | 9 条 `[core]` 全部通过；与专题回归重叠，不相加为独立覆盖数 |
| `npm run test:release` | 1 项通过，固定文档路径、显式清单、哈希与解压后服务可用 |
| Bridge refs 辅助清理后 | 5 项单元再次通过；清除仅旧写入测试需要的 mock 写入分支 |
| 静态复查 | 删除符号在源码／测试／样式无残留；Markdown 本地文件链接、章节锚点与索引可达性通过；`git diff --check` 通过 |

专题命令：`node scripts/test-browser.mjs annotations ask-attachments ask-compaction ask-context ask-conversations ask-drafts ask-persistence ask-vision bridge home-ui native-protocols native-nai-models workspaces shared shell services editor-workspace editor-return`。批注失败的独立复现及修正后检查均使用 `--test-name-pattern='^annotation polygon vertices'`；没有通过删除或放宽业务断言掩盖失败。

统计相对源码基线 `2d5eba5`，均为物理行（含空行和注释）：

| 对象 | 清理前 | 清理后 | 变化 |
| --- | ---: | ---: | ---: |
| 测试代码 | 107 文件／24,872 行 | 103 文件／24,357 行 | 少 4 文件、515 行 |
| Node 单元定义文件 | 53 | 52 | 删除图标展示矩阵；执行用例由 474 减至 458 |
| 浏览器定义文件／静态 test 定义 | 47／336 | 44／322 | 删除 3 文件、14 处定义；另减少 20 次跨协议重复执行 |
| TS／Vue 源码 | 44,460 行 | 44,329 行 | 净减 131 行 |
| 状态入口 | 192 行 | 55 行 | 只保留现状、待验、范围与证据入口 |

本轮未执行真实供应商、收费生成、真实 Photopea 长时／移动设备验收，也未推送或部署。全部测试使用合成图片与模拟服务；运行日志和统计暂存在系统临时目录，不加入仓库或 `.local/`。
