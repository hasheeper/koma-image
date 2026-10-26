# 文档索引

更新：2026-10-26。本目录以当前仓库行为为主；后续规划明确标记为未实施。代码功能的本地模拟验收、真实供应商验证和线上部署状态分别记录，不能互相代替。历史文件不参与现行规则的优先级。

## 开始阅读

- [项目介绍与运行](../README.md)：功能、连接、开发和验证入口。
- [工程约定](../AGENTS.md)：稳定边界、授权、资源与数据纪律。
- [架构](architecture.md)与[业务契约](business-contracts.md)：应用结构和必须保持的行为。
- [当前状态与待办](implementation-plan.md)：已完成范围、真实待验项和已取消事项。
- [设计语言](design-language.md)：产品理念、字体、颜色、布局、动效和文案。

## 按任务阅读

| 任务 | 现行文档 |
| --- | --- |
| 网关、数据租约、任务调度 | [网关／数据／调度](gateway-data-scheduler.md) |
| 连接、Key、备份、词典 | [设置、备份与词典](shared-settings-tags.md) |
| 绘图、结果、收藏和参数导入 | [绘图工作区](drawing-workspace.md) |
| CHAT、上下文、编辑和图片交接 | [对话与编辑](chat-editor-workspaces.md) |
| 画板和角色 | [多角色与画板](multi-character-boards-plan.md) |
| 图像协议 | [能力与请求边界](native-image-protocols.md)、[NAI 当前覆盖、V4.5／V5 对照与后续工作](novelai-official.md) |
| ASK | 先读[现行契约与维护入口](ask/ask-implementation-plan.md)，再按下表选择专题 |
| 字体与样式 | [字体维护](font-style-governance.md)、[样式归属](style-ownership.md)、[检查规则](style-checks.md) |
| 运行、发布、备份和回退 | [发布说明](release-guide.md) |
| 字体和图标许可 | [第三方资源](third-party-assets.md) |

## ASK 专题职责

| 文档 | 负责内容 |
| --- | --- |
| [现行契约与维护入口](ask/ask-implementation-plan.md) | 已确认决策、数据生命周期和专题优先级；原文件名保留以稳定引用 |
| [产品与架构](ask/ask-architecture.md) | 产品定位、模块所有权、状态与工具总览 |
| [协议与运行契约](ask/ask-contracts-and-decisions.md) | 消息、缓存、工具预算、草稿校验、失败与并发 |
| [UI 规范](ask/ask-ui-spec.md) | 当前 B v5 浮窗、消息、草稿、附件、压缩与键盘交互 |
| [检索与状态](ask/ask-retrieval-state.md) | 工作台快照、历史检索、词典查询与消歧 |
| [提示词维护](ask/ask-prompts.md) | 提示词文件、版本、自由创作和独立命名 |
| [上下文压缩](compaction-plan.md) | 账本、记忆、归档、触发、召回与事务 |
| [调用上下文调试](ask/ask-debug.md) | 实际请求、用量、缓存、命名与压缩调试 |
| [外部协同与任务板 B1–B3](ask/bridge.md) | 目录挂载、JSON 传输、IMAGE 外部草稿与直接设参、状态／预览／索引和回执，以及共享资料按需读取、默认本地待办／轻量总览、复合草稿／文件保存／持久绑图和目录交付 |
| [外部协同桥与 Slate 规划](ask/bridge-plan.md) | B1–B3 已实现；保留默认本地 Todo／Slate 与目录协作的阶段验收契约 |

ASK 专题发生冲突时以「现行契约与维护入口」为准，工程红线和用户已确认的要求继续优先。不再使用文档 1–4 的编号链和阶段补丁判断当前行为。

## 历史与维护方式

[2026-10-25 整理前快照](archive/2026-10-25/README.md)保留原 37 份 Markdown 及 ASK 动画 v2 原型，源码基线 `219463c`。M1–M7、A0–A4、R／W／CP、角色画板、TS 和 CSS 治理的计划、过程、测试数量及当时授权均在快照中。旧阶段、窗口专题与原型已退出现行目录；已完成阶段不再作为实施待办。整理后完成的 [CHAT 交接（H0–H4）](archive/ask-chat-handoff-plan.md)保留勘探与验收过程，现行规则见上表各专题。

外部协同的本地验证与真实目录兼容边界见 [B1 验收记录](archive/2026-10-26-bridge-b1-verification.md)、[B2 验收记录](archive/2026-10-26-bridge-b2-verification.md)、[B3 验收记录](archive/2026-10-26-bridge-b3-verification.md)、[Edge 外部 Agent 实战验收](archive/2026-10-26-bridge-field-verification.md)及[协同 UI 与文件草稿收口](archive/2026-10-26-bridge-ui-verification.md)。

本轮公开技能入口及提交前回归范围见[外部协同发布前核验](archive/2026-10-26-bridge-release-verification.md)。

维护现行契约时直接更新本节对应的负责文档，避免复制第二份规则或追加「覆盖前文」说明。历史测试证据注明日期、版本、范围和模拟／真实边界。历史授权不构成新的推送或部署授权。

连接相关后续验证：[NAI 账户兼容](archive/2026-10-25-novelai-connection-check.md)、[V5 额度与张数展示](archive/2026-10-25-novelai-v5-usage.md)、[连接图标与官方 Logo](archive/2026-10-25-connection-icons.md)、[供应商分区与图像优先级](archive/2026-10-25-source-priority.md)、[连接与模型局部更新](archive/2026-10-25-settings-local-updates.md)、[V4.5／V5 能力核对](archive/2026-10-25-novelai-model-capabilities.md)、[NAI 参数兼容](archive/2026-10-25-nai-controls.md)、[NAI 模式与菜单](archive/2026-10-25-nai-modes.md)、[Vibe 与精确参考勘探](archive/2026-10-25-nai-references-research.md)、[参考链路与抽屉实施](archive/2026-10-25-nai-references-integration.md)、[NAI 适配发布与线上页面核验](archive/2026-10-25-nai-release-verification.md)。
