# 历史文档索引

更新：2026-10-29。这里只保存当时的方案、设计确认与验收证据。现行行为从[文档索引](../README.md)进入；历史的测试数量、供应商结果、发布记录和授权只适用于其注明范围。

## 早期基线与文档维护

- [2026-10-25 完整快照](2026-10-25/README.md)：M1–M7、ASK A／R／W／CP、角色画板、TS 与字体／样式治理的原文和过程；快照内相对链接保持自洽。
- [本轮文档整理](2026-10-28-documentation-cleanup.md)：现行专题的合并、移位与校验范围。
- [HOME／EDIT／NAI 发布核验](2026-10-28-home-edit-nai-release-verification.md)：本轮文档、回归、脱敏与线上版本证据。
- [ASK CHAT 交接 H0–H4](ask-chat-handoff-plan.md)：能力感知、编号与交接草稿的设计及验收。

## NAI、连接与基础编辑

| 日期 | 记录 |
| --- | --- |
| 10-25 | [官方连接兼容](2026-10-25-novelai-connection-check.md)、[V5 额度](2026-10-25-novelai-v5-usage.md)、[型号能力](2026-10-25-novelai-model-capabilities.md) |
| 10-25 | [连接图标](2026-10-25-connection-icons.md)、[供应商优先级](2026-10-25-source-priority.md)、[局部更新](2026-10-25-settings-local-updates.md) |
| 10-25 | [参数控件](2026-10-25-nai-controls.md)、[模式与菜单](2026-10-25-nai-modes.md)、[参考勘探](2026-10-25-nai-references-research.md)、[参考链路与抽屉](2026-10-25-nai-references-integration.md) |
| 10-25 | [适配发布与线上核验](2026-10-25-nai-release-verification.md) |
| 10-27 | [EDIT 参数对齐](2026-10-27-editor-alignment-verification.md)、[Img2Img／Inpaint／Upscale](2026-10-27-nai-basic-edit-verification.md) |
| 10-28 | [官方参数边界收口](2026-10-28-nai-parameters-verification.md)：六采样器、调度、Guidance 手输、强度／噪声、Medium Heavy 与参数往返 |
| 10-28 | [普通 Enhance](2026-10-28-nai-enhance-verification.md)：图生图内倍率／Magnitude、独立配置、随机 Seed、目标尺寸与历史记录 |
| 10-28 | [费用／输入／PNG 编码](2026-10-28-nai-cost-input-import-verification.md)：本地 Anlas 与 Opus、T5／Qwen 预算、Text: 上限、隐藏元数据与缓存恢复 |
| 10-28 | [V5 Max Enhance](2026-10-28-nai-max-enhance-verification.md)：原尺寸请求、服务端标记、实际输出尺寸及同一倍率入口 |
| 10-28 | [Focused Inpainting](2026-10-28-focused-inpaint-verification.md)：手动蒙版／框选、客户端裁切放大、单次 infill 与原尺寸合成 |
| 10-28 | [Director Tools](2026-10-28-director-tools-verification.md)：六项独立工具、费用与尺寸、去背景三种结果、紧凑工具栏及放大面板 |

## 图片身份与引用

- [ID1–ID4 设计规划](2026-10-28-image-identity-plan.md)：实体／记录、固定收藏号、逐轮引用和作用域的已批准设计；现行规则见[图片身份](../image-identity.md)。
- [ID1–ID4 本地验收](2026-10-28-image-identity-verification.md)：收藏／备份、冻结引用、视觉预算、EDIT／Slate／Bridge 与相关回归的证据和真实待验边界。
- [图片身份与 HOME 空状态发布核验](2026-10-29-image-identity-home-release-verification.md)：本轮发布范围、回归、脱敏与 Git／Pages 核验记录。

## 外部协同与任务

- [B1–B3 阶段规划](2026-10-26-bridge-plan.md)：阶段边界、六项补充和验收契约，已退出现行入口。
- [B1 外部草稿](2026-10-26-bridge-b1-verification.md)、[B2 共享资料](2026-10-26-bridge-b2-verification.md)、[B3 本地任务与交付](2026-10-26-bridge-b3-verification.md)。
- [Edge 外部 Agent 实战](2026-10-26-bridge-field-verification.md)、[协同 UI 与文件草稿](2026-10-26-bridge-ui-verification.md)、[发布前核验](2026-10-26-bridge-release-verification.md)。

## Photopea

- [PE1 回传与纯修图交付](2026-10-27-photopea-pe1-verification.md)、[PE2 官方 iframe 与选区](2026-10-27-photopea-pe2-verification.md)、[PE3 静态包兼容](2026-10-27-photopea-pe3-verification.md)。
- [主题和界面勘探](2026-10-27-photopea-ui-research.md)、[界面精简／保活／视口修复](2026-10-27-photopea-ui-verification.md)。
- [工作栈、自动回传与同尺寸复用](2026-10-27-photopea-workstack-verification.md)。

## HOME 与独立 EDIT

- [HOME 设计与实施规划](2026-10-28-home-plan.md)：保留原章节和概念稿差异，当前契约已收拢到 [HOME 工作区](../koma-home.md)。
- [HD 页面形态确认](2026-10-27-home-hd-confirmation.md)、[头部与 ASK 停靠确认](2026-10-28-home-head-ask-confirmation.md)。
- [HM1 数据](2026-10-28-home-hm1-verification.md)、[HM2 页面](2026-10-28-home-hm2-verification.md)、[HM3 ASK 与动效](2026-10-28-home-hm3-verification.md)。
- [EDIT 独立页面、编辑画板与收口](2026-10-28-edit-workspace-verification.md)。
