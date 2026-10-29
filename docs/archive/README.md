# 历史文档索引

更新：2026-10-29。这里只保存当时的方案、设计确认与验收证据。现行行为从[文档索引](../README.md)进入；历史的测试数量、供应商结果、发布记录和授权只适用于其注明范围。公开前匿名化历史作者邮箱后，文内提交号同步映射到对应新提交；过程和验收事实保持原意。

## 目录与早期基线

`engineering/` 保存文档、测试与连接维护记录；`nai/`、`ask/`、`image-identity/`、`bridge/`、`photopea/`、`workspaces/` 按主题保留设计与验收；`releases/` 单独保存推送、脱敏和线上核验。文件内日期与当时结论保持不变，仅更新移动后的引用。

[2026-10-25 完整快照](2026-10-25/README.md)保留早期 M1–M7、ASK A／R／W／CP、角色画板、TS 与字体／样式治理的原文和过程。快照自成目录，其旧规范不参与现行契约优先级。

## 工程与连接维护

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

## ASK 的 NAI 基础感知与 EDIT

- [CHAT 交接 H0–H4](ask/ask-chat-handoff-plan.md)：能力感知、编号与交接草稿的设计及验收。

- [EA0 获批规划](ask/2026-10-29-ask-nai-awareness-plan.md)、[EA1–EA3 获批规划](ask/2026-10-29-ask-edit-plan.md)：实施前的完整方案与验收矩阵。
- [本地实施验收](ask/2026-10-29-ask-edit-verification.md)：只读预算／费用、编辑草稿与交接、模拟请求边界和待真实核验项。

## 图片身份与引用

- [ID1–ID4 设计规划](image-identity/2026-10-28-image-identity-plan.md)：实体／记录、固定收藏号、逐轮引用和作用域的已批准设计；现行规则见[图片身份](../engineering/image-identity.md)。
- [ID1–ID4 本地验收](image-identity/2026-10-28-image-identity-verification.md)：收藏／备份、冻结引用、视觉预算、EDIT／Slate／Bridge 与相关回归的证据和真实待验边界。

## 外部协同与任务

- [B1–B3 阶段规划](bridge/2026-10-26-bridge-plan.md)：阶段边界、六项补充和验收契约，已退出现行入口。
- [B1 外部草稿](bridge/2026-10-26-bridge-b1-verification.md)、[B2 共享资料](bridge/2026-10-26-bridge-b2-verification.md)、[B3 本地任务与交付](bridge/2026-10-26-bridge-b3-verification.md)。
- [Edge 外部 Agent 实战](bridge/2026-10-26-bridge-field-verification.md)、[协同 UI 与文件草稿](bridge/2026-10-26-bridge-ui-verification.md)。

## Photopea

- [PE1 回传与纯修图交付](photopea/2026-10-27-photopea-pe1-verification.md)、[PE2 官方 iframe 与选区](photopea/2026-10-27-photopea-pe2-verification.md)、[PE3 静态包兼容](photopea/2026-10-27-photopea-pe3-verification.md)。
- [主题和界面勘探](photopea/2026-10-27-photopea-ui-research.md)、[界面精简／保活／视口修复](photopea/2026-10-27-photopea-ui-verification.md)。
- [工作栈、自动回传与同尺寸复用](photopea/2026-10-27-photopea-workstack-verification.md)。

## HOME 与独立 EDIT

- [HOME 设计与实施规划](workspaces/2026-10-28-home-plan.md)：保留原章节和概念稿差异，当前契约已收拢到 [HOME 工作区](../workspaces/home.md)。
- [HD 页面形态确认](workspaces/2026-10-27-home-hd-confirmation.md)、[头部与 ASK 停靠确认](workspaces/2026-10-28-home-head-ask-confirmation.md)。
- [HM1 数据](workspaces/2026-10-28-home-hm1-verification.md)、[HM2 页面](workspaces/2026-10-28-home-hm2-verification.md)、[HM3 ASK 与动效](workspaces/2026-10-28-home-hm3-verification.md)。
- [EDIT 独立页面、编辑画板与收口](workspaces/2026-10-28-edit-workspace-verification.md)。

## 发布与脱敏记录

这些记录只证明注明提交和部署的状态，不能推导出后续工作已发布。

| 日期 | 记录 |
| --- | --- |
| 10-25 | [NAI 适配发布与线上核验](releases/2026-10-25-nai-release-verification.md) |
| 10-26 | [Bridge 发布前核验](releases/2026-10-26-bridge-release-verification.md) |
| 10-28 | [HOME／EDIT／NAI 发布核验](releases/2026-10-28-home-edit-nai-release-verification.md) |
| 10-29 | [图片身份与 HOME 空状态发布核验](releases/2026-10-29-image-identity-home-release-verification.md) |
| 10-29 | [ASK／EDIT 发布与公开前核验](releases/2026-10-29-ask-edit-public-release-verification.md)：凭据与历史邮箱、单一 main 分支、Git／Pages 证据 |
