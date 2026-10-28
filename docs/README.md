# 文档索引

更新：2026-10-28。现行文档直接说明当前行为；阶段方案、设计迭代、验收数字与过去授权统一放入[历史归档](archive/README.md)。代码实现、本地模拟、真实供应商验证和线上发布分别核验。

## 开始阅读

1. [产品总览](product-overview.md)：产品定位、理念、功能与创作闭环。
2. [当前状态与待办](implementation-plan.md)：已实现范围、真实待验项与未开放能力。
3. [架构](architecture.md)与[业务契约](business-contracts.md)：核心技术、模块所有权与必须保持的行为。
4. [设计语言](design-language.md)：视觉、交互、动效和文案的共同标准。

开发和运行见[项目说明](../README.md)，协作边界见[工程约定](../AGENTS.md)。

## 工作区与共享能力

| 主题 | 现行文档 |
| --- | --- |
| HOME：继续、创作线、定稿、ASK 停靠 | [HOME 工作区](koma-home.md) |
| IMAGE：绘图、历史、收藏、参数导入 | [绘图工作区](drawing-workspace.md) |
| IMAGE 独立画板、多角色与坐标 | [多角色与画板](multi-character-boards.md) |
| CHAT：会话、上下文、多版本与图片交接 | [对话工作区](chat-workspace.md) |
| EDIT：独立画板、图生图／重绘、增强／放大、Director Tools 与来源回流 | [编辑工作区](edit-workspace.md) |
| Photopea：宿主、分层、蒙版及自动回传 | [Photopea 接入与工作栈](photopea-workstack-spec.md) |
| 图像协议与供应商能力 | [协议能力](native-image-protocols.md)、[NAI 覆盖与缺口](novelai-official.md) |
| 连接、模型优先级、Key、备份与 TAGS | [设置、备份与词典](shared-settings-tags.md) |
| 网关、数据租约、存储与任务调度 | [网关、数据与调度](gateway-data-scheduler.md) |
| 字体、CSS 归属与检查 | [字体维护](font-style-governance.md)、[样式归属与检查](style-ownership.md) |
| 运行、打包、发布与回退 | [发布说明](release-guide.md) |
| 字体、图标与嵌入服务许可 | [第三方资源](third-party-assets.md) |

## ASK 与外部协同

先读[ASK 现行契约与维护入口](ask/ask-implementation-plan.md)。ASK 专题冲突以该文为准，工程约定和用户已确认要求继续优先。

| 文档 | 唯一维护职责 |
| --- | --- |
| [产品与架构](ask/ask-architecture.md) | 模块、所有权与工具总览 |
| [协议与运行契约](ask/ask-contracts-and-decisions.md) | 消息、缓存、预算、草稿校验、失败及并发 |
| [UI 规范](ask/ask-ui-spec.md) | B v5 浮窗、消息、草稿、附件与键盘交互 |
| [检索与状态](ask/ask-retrieval-state.md) | 工作台快照、图片编号、历史和标签查询 |
| [提示词维护](ask/ask-prompts.md) | 提示词文件、版本、自由创作与独立命名 |
| [上下文压缩](ask/compaction.md) | 账本、记忆、归档、触发与恢复事务 |
| [调用调试](ask/ask-debug.md) | 实际请求、用量与缓存记录 |
| [外部协同与本地任务](ask/bridge.md) | IMAGE 外部草稿、目录／JSON、refs 按需读取、默认本地 Todo、复合草稿与成果交付 |

外部 Agent 的操作说明为[公开 SKILL.md](../public/skills/koma-bridge/SKILL.md)；精确字段以应用在协同目录生成的 `PROTOCOL.md` 为准。

## 维护方式

每条规则只在负责专题中维护，入口文档提供摘要和链接。已完成阶段不继续占用实施待办，不追加“覆盖前文”的补丁。历史文件保留当时的事实和验证边界，不参与现行规则优先级，也不构成新的推送或发布授权。

[历史索引](archive/README.md)集中列出 NAI、Bridge、Photopea、HOME 和 EDIT 的设计与验收记录，以及早期完整快照。
