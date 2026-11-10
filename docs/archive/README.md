# 历史文档索引

更新：2026-11-09。这里只保存当时的方案、设计确认与验收证据。现行行为从[文档索引](../README.md)进入；历史的测试数量、供应商结果、发布记录和授权只适用于其注明范围。公开前匿名化历史作者邮箱后，文内提交号同步映射到对应新提交；过程和验收事实保持原意。

## 目录与早期基线

`engineering/` 保存文档、测试与连接维护记录；`nai/`、`ask/`、`image-identity/`、`bridge/`、`photopea/`、`workspaces/` 按主题保留设计与验收；`releases/` 单独保存推送、脱敏和线上核验。验收日期和结论保持原意；移除重复规范或裁去已完成计划时，单独记录保留范围。

[早期设计与阶段证据](2026-10-25/README.md)保留 M1–M7、ASK A／R／W／CP、角色画板、TS 与字体／样式的独有记录；2026-11-07 已删除重复规范、收拢已完成计划，旧规则不参与现行契约优先级。

## 工程与连接维护

- [测试、残留代码与文档收口](engineering/2026-11-07-maintenance-investigation.md#收口结果)：保留调查基线，记录测试删减、旧 EDIT 链路清理、文档归属和本地验证。
- [未发布版本本地收口](engineering/2026-11-06-unreleased-closeout.md)：运行包依赖、批注 ZIP 往返、HTML 定稿与提示词迁入，以及推送前文档／产物复核；记录当时的本地模拟验收；后续随 v0.5.0 发布。
- [供应商接口用途样式咨询](engineering/2026-11-04-supplier-interface-consult.md)：Opus 5.5 原稿与主 Agent 代码核对，复用公共复选框及局部排版建议。
- [模型与供应商连接调整规划](workspaces/2026-11-03-models-and-connections-plan.md)：已随 v0.4.0 发布；范围为 GPT／Gemini 条目管理与任意上游 ID、Chat／Images 共用连接、NAI 混列与 401 提示修复。
- [公共 UI 与设置拆分](engineering/2026-11-01-ui-components.md)：共用画板、菜单基础行为、设置职责、开发预览与本地检查。

- [文档整理记录](engineering/documentation-maintenance.md)：10-28 专题收拢与 10-29 目录重整、四组合并和链接校验。
- [测试组织与按需加载整理](engineering/2026-10-29-test-maintenance.md)：自动发现的 CI 清单、共享模拟环境、功能拆分、加载边界与本地验证。
- [连接图标](engineering/2026-10-25-connection-icons.md)、[供应商优先级](engineering/2026-10-25-source-priority.md)、[设置局部更新](engineering/2026-10-25-settings-local-updates.md)。

## NAI 与基础编辑

| 日期 | 记录 |
| --- | --- |
| 10-25 | [官方连接兼容](nai/2026-10-25-novelai-connection-check.md)、[V5 额度](nai/2026-10-25-novelai-v5-usage.md)、[型号能力](nai/2026-10-25-novelai-model-capabilities.md) |
| 10-25 | [参数控件](nai/2026-10-25-nai-controls.md)、[模式与菜单](nai/2026-10-25-nai-modes.md)、[参考勘探](nai/2026-10-25-nai-references-research.md)、[参考链路与抽屉](nai/2026-10-25-nai-references-integration.md) |
| 10-27 | [EDIT 参数对齐](nai/2026-10-27-editor-alignment-verification.md)、[Img2Img／Inpaint／Upscale](nai/2026-10-27-nai-basic-edit-verification.md) |
| 10-28 | [官方参数边界收口](nai/2026-10-28-nai-parameters-verification.md)：六采样器、调度、Guidance 手输、强度／噪声、Medium Heavy 与参数往返 |
| 10-28 | [普通 Enhance](nai/2026-10-28-nai-enhance-verification.md)：图生图内倍率／Magnitude、独立配置、随机 Seed、目标尺寸与历史记录 |
| 10-28 | [费用／输入／PNG 编码](nai/2026-10-28-nai-cost-input-import-verification.md)：本地 Anlas 与 Opus、T5／Qwen 预算、Text: 上限、隐藏元数据与缓存恢复 |
| 10-28 | [V5 Max Enhance](nai/2026-10-28-nai-max-enhance-verification.md)：原尺寸请求、服务端标记、实际输出尺寸及同一倍率入口 |
| 10-28 | [Focused Inpainting](nai/2026-10-28-focused-inpaint-verification.md)：手动蒙版／框选、客户端裁切放大、单次 infill 与原尺寸合成 |
| 10-28 | [Director Tools](nai/2026-10-28-director-tools-verification.md)：六项独立工具、费用与尺寸、去背景三种结果、紧凑工具栏及放大面板 |

## ASK 回复模式

- [通用图像模型知识咨询](ask/2026-11-10-image-model-knowledge-consult.md)：GPT Image 2.6／Gemini／Seedream 的共性介绍、按来源读取能力与新增模型适配，保留 Opus 5.5 原稿与实施取舍。
- [工作区提示词精简修订稿](ask/2026-11-09-workspaces-prompt-review.md)：已按用户确认应用为 w37，清除 UI 操作与实现叙述，修正图片／配方／批注数据含义；保留采用时的完整正文与 Opus 5.5 原始精修记录。
- [可选工具正文模式](ask/2026-11-02-ask-tool-response-plan.md)：按入口拆信封原则重写并实施，默认关闭、双协议宽容接收，接收后统一为普通文本，下游存储与压缩不作改动。

## ASK 的 NAI 基础感知与 EDIT

- [EDIT 空响应分组隔离](ask/2026-11-06-edit-empty-response-isolation.md)：同内容非流式返回 `content_filter`，流式漏掉原因；记录字段隔离与实验边界，未宣称稳定修复。

- [CHAT 交接 H0–H4](ask/ask-chat-handoff-plan.md)：能力感知、编号与交接草稿的设计及验收。

- [EA0 获批规划](ask/2026-10-29-ask-nai-awareness-plan.md)、[EA1–EA3 获批规划](ask/2026-10-29-ask-edit-plan.md)：实施前的完整方案与验收矩阵。
- [本地实施验收](ask/2026-10-29-ask-edit-verification.md)：只读预算／费用、编辑草稿与交接、模拟请求边界和待真实核验项。

## 图片身份与引用

- [ID1–ID4 设计规划](image-identity/2026-10-28-image-identity-plan.md)：实体／记录、固定收藏号、逐轮引用和作用域的已批准设计；现行规则见[图片身份](../engineering/image-identity.md)。
- [ID1–ID4 本地验收](image-identity/2026-10-28-image-identity-verification.md)：收藏／备份、冻结引用、视觉预算、EDIT／Slate／Bridge 与相关回归的证据和真实待验边界。

## 外部协同与任务

- [企划集 P1–P6 实施记录](bridge/2026-11-09-project-collection-plan.md)：根目录分层索引、四栏面板、Slate 目录归属、12 个工具文本与企划图片交接的需求、实施和本地验证；[咨询原稿](bridge/2026-11-09-project-collection-design.md)保留设计来源与取舍。
- [B1–B3 阶段规划](bridge/2026-10-26-bridge-plan.md)：阶段边界、六项补充和验收契约，已退出现行入口。
- [B1 外部草稿](bridge/2026-10-26-bridge-b1-verification.md)、[B2 共享资料](bridge/2026-10-26-bridge-b2-verification.md)、[B3 本地任务与交付](bridge/2026-10-26-bridge-b3-verification.md)。
- [Edge 外部 Agent 实战](bridge/2026-10-26-bridge-field-verification.md)、[协同 UI 与文件草稿](bridge/2026-10-26-bridge-ui-verification.md)。

## Photopea

- [PE1 回传与纯修图交付](photopea/2026-10-27-photopea-pe1-verification.md)、[PE2 官方 iframe 与选区](photopea/2026-10-27-photopea-pe2-verification.md)、[PE3 静态包兼容](photopea/2026-10-27-photopea-pe3-verification.md)。
- [主题和界面勘探](photopea/2026-10-27-photopea-ui-research.md)、[界面精简／保活／视口修复](photopea/2026-10-27-photopea-ui-verification.md)。
- [工作栈、自动回传与同尺寸复用](photopea/2026-10-27-photopea-workstack-verification.md)。
- [边界色彩对齐与结果融合实施验证](workspaces/2026-11-04-region-annotations-research-plan.md#9-验收与真实待验)：2026-11-09 本地实现、真实 Photopea 合成素材验证、比较工具栏与单按钮修复；尚未发布。

## HOME 与独立 EDIT

- [ASK 版本演进提示词提取稿](ask/2026-11-09-evolution-prompt-extract.md)：2026-11-09 当前代码原文审阅快照，包含系统段落、工具说明与 Schema、回退草稿和入口模板；不参与运行时加载。
- [版本演进需求与实施规划](workspaces/2026-11-08-version-evolution-plan.md)：E1–E5 本地实施与模拟验证；活动树、自动归组、回退基底草稿、同树重整、显式定稿、NEW 与停止跟踪边界。
- [单图演进复盘概念记录](workspaces/2026-11-07-recipe-retrospect.md)：实施前的职责收敛；平时零侵入、程序按需折叠配方、ASK 语义推演，现行规则见[版本演进专题](../workspaces/recipe-retrospect.md)。
- [单图复盘正式接入与收口](workspaces/2026-11-08-recipe-retrospect-closeout.md)：连续分组 Diff、关系图／大图、图上批注、入口与本页状态的本地模拟验证；尚未发布。
- [图片区域批注勘探与规划](workspaces/2026-11-04-region-annotations-research-plan.md)：共享批注、ASK 与 CHAT 双图已随 v0.5.0 发布；原始 EDIT 转换入口后来已收口。另含 2026-11-09 未发布的色彩对齐、NAI 直出保留与 Photopea 融合实施结果，不接 OpenAI Mask。
- [HOME 设计与实施规划](workspaces/2026-10-28-home-plan.md)：保留原章节和概念稿差异，当前契约已收拢到 [HOME 工作区](../workspaces/home.md)。
- [HD 页面形态确认](workspaces/2026-10-27-home-hd-confirmation.md)、[头部与 ASK 停靠确认](workspaces/2026-10-28-home-head-ask-confirmation.md)。
- [HM1 数据](workspaces/2026-10-28-home-hm1-verification.md)、[HM2 页面](workspaces/2026-10-28-home-hm2-verification.md)、[HM3 ASK 与动效](workspaces/2026-10-28-home-hm3-verification.md)。
- [EDIT 独立页面、编辑画板与收口](workspaces/2026-10-28-edit-workspace-verification.md)。

## 发布与脱敏记录

- [v0.6.0 发布](releases/2026-11-10-v0.6.0-release.md)：版本演进、企划集、融合精修与多模型接入；记录本地验收、独立包依赖修复、脱敏与发布结果。
- [v0.5.0 发布](releases/2026-11-06-v0.5.0-release.md)：图片批注、EDIT 通用图像模型、ASK 联动与诊断修复；记录 CI、脱敏和生产资源核验。

- [v0.4.0 发布](releases/2026-11-04-v0.4.0-release.md)：模型与连接管理、来源参数、Gemini ASK、更新日志及导入安全修复，记录本地检查、脱敏与 Git／Pages 核验。

- [v0.3.4 发布](releases/2026-11-02-v0.3.4-release.md)：修复 TAGS 打开设置时顶栏被裁切，记录检查、脱敏与线上桌面／手机核验。
- [v0.3.3 发布](releases/2026-11-02-v0.3.3-release.md)：撤回 Danbooru 示例图与帖子导入，记录本地检查、脱敏及 Git／Pages 交付核验。
- [v0.2 系列发布](releases/2026-11-02-v0.2-release.md)：公共 UI、版本管理与 TAGS 顶部留白修复的历史发布记录。

这些记录只证明注明提交和部署的状态，不能推导出后续工作已发布。

| 日期 | 记录 |
| --- | --- |
| 10-25 | [NAI 适配发布与线上核验](releases/2026-10-25-nai-release-verification.md) |
| 10-26 | [Bridge 发布前核验](releases/2026-10-26-bridge-release-verification.md) |
| 10-28 | [HOME／EDIT／NAI 发布核验](releases/2026-10-28-home-edit-nai-release-verification.md) |
| 10-29 | [图片身份与 HOME 空状态发布核验](releases/2026-10-29-image-identity-home-release-verification.md) |
| 10-29 | [ASK／EDIT 发布与公开前核验](releases/2026-10-29-ask-edit-public-release-verification.md)：凭据与历史邮箱、单一 main 分支、Git／Pages 证据 |
| 10-30 | [外观与工作区发布核验](releases/2026-10-30-appearance-workspace-release.md)：默认暗色、主题菜单、手机 EDIT、ASK 任务与上下文统计、脱敏及线上产物 |
