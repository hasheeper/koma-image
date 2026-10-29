# 文档索引

更新：2026-10-29。现行文档按职责组织；已完成的方案与验收证据只放在 `archive/`。代码实现、本地模拟、真实供应商验证和线上发布分别核验，历史记录不代表当前版本或新的发布授权。

## 阅读入口

| 要了解什么 | 从哪里开始 |
| --- | --- |
| 产品定位、功能与设计理念 | [产品总览](product/overview.md)、[设计语言](product/design-language.md) |
| 现在做到哪一步、还缺什么 | [当前状态与待办](status.md) |
| 系统如何组织、改动有哪些边界 | [架构](architecture.md)、[业务契约](business-contracts.md) |
| 开发、检查与发布 | [项目说明](../README.md#开发与检查)、[发布说明](release-guide.md) |
| ASK 开发 | [ASK 契约与架构](ask/README.md)，再按其专题索引阅读 |

协作边界见[工程约定](../AGENTS.md)，凭据与公开前审查见[安全说明](../SECURITY.md)，许可证见[第三方资源](third-party-assets.md)。

## 目录职责

```text
docs/
├── README.md                 文档导航与维护规则
├── status.md                 当前实现、待验事项与未开放范围
├── architecture.md           核心技术、模块与所有权
├── business-contracts.md     全局业务与交互约束
├── release-guide.md          发布包固定路径：运行与发布
├── third-party-assets.md     发布包固定路径：第三方资源
├── product/                  产品定位、设计语言
├── workspaces/               各工作区、设置与词典的行为
├── integrations/             图像协议、NAI、Photopea、外部协同
├── engineering/              数据调度、图片身份、样式与字体维护
├── ask/                      ASK 契约、状态、UI、提示词与协作
└── archive/                  按主题整理的方案与验收；早期快照独立保留
```

## 工作区

| 文档 | 维护范围 |
| --- | --- |
| [HOME](workspaces/home.md) | 创作线、继续、定稿布局、封面、ASK 停靠与空状态 |
| [IMAGE](workspaces/image.md) | 绘图、历史／收藏、参数导入、独立画板、多角色及坐标 |
| [CHAT](workspaces/chat.md) | 会话、上下文、分支、多版本与图片交接 |
| [EDIT](workspaces/edit.md) | 独立编辑画板、版本、蒙版、编辑工具与来源回流 |
| [设置与 TAGS](workspaces/settings-and-tags.md) | 供应商／Key、模型优先级、备份、词典与补全 |

## 协议与集成

| 文档 | 维护范围 |
| --- | --- |
| [图像协议](integrations/image-protocols.md) | 标准网关、OpenAI Images、Gemini、NovelAI 的协议能力与差异 |
| [NovelAI 官方适配](integrations/novelai.md) | 型号、参数、参考、费用、输入预算及真实待验边界 |
| [Photopea](integrations/photopea.md) | iframe 生命周期、分层工作栈、蒙版分离与自动回传 |
| [外部协同与本地任务](integrations/bridge.md) | Bridge 目录／JSON、IMAGE 外部草稿、refs、Slate 任务与交付 |

外部 Agent 直接读取[公开 SKILL.md](../public/skills/koma-bridge/SKILL.md)；精确字段以应用在协同目录生成的 `PROTOCOL.md` 为准。外部协同是应用级能力，不依赖 ASK 文本 Key。

## 工程维护

| 文档 | 维护范围 |
| --- | --- |
| [数据与任务调度](engineering/data-and-tasks.md) | 网关执行、数据租约、存储、任务锁和备份 |
| [图片身份与引用](engineering/image-identity.md) | 原图实体、记录、五类编号、冻结绑定、视觉共享与跨域引用 |
| [样式与字体维护](engineering/ui-maintenance.md) | CSS 级联、组件归属、Stylelint、字体配置与离线重建 |

## ASK

[ASK 契约与架构](ask/README.md)是唯一入口，维护权限、会话与资源、模块分工和已确认决策。专题分别负责[运行与调试](ask/runtime.md)、[UI](ask/ui.md)、[检索与状态](ask/retrieval.md)、[提示词](ask/prompts.md)、[压缩](ask/compaction.md)、[NAI 基础感知](ask/nai-awareness.md)和[EDIT 协作](ask/edit.md)。

## 文档维护规则

- **一个主题一个维护位置**：入口只写摘要和链接。产品理念不重复实现字段，架构不重复完整操作规范，状态页不复制验收过程。
- **现行文档直接写当前行为**：新能力完成后更新负责专题和 `status.md`；明确区分已实现、本地模拟通过、真实待验及已发布。
- **规划与证据按主题归档**：日期放文件名，状态写在正文开头。未实施事项在 `status.md` 提供入口；完成后从待办撤下，不继续追加“覆盖前文”的补丁。
- **合并后移除旧入口**：不留空白占位或重复转跳文档；移动时同步 Markdown 链接、章节锚点和代码中的文档引用。
- **保留独立证据与固定接口**：历史授权不延续；不为减少数量删除唯一验收证据。发布包依赖的 `docs/release-guide.md`、`docs/third-party-assets.md` 和公开 SKILL 路径保持稳定。

历史检索见[归档索引](archive/README.md)，本次合并与目录变更见[文档整理记录](archive/engineering/documentation-maintenance.md#2026-10-29-目录与职责整理)。
