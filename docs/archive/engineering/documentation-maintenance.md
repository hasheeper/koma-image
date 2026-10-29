# 文档整理记录

本文件按日期保留整理范围，不作为当前规范。现行目录见[文档索引](../../README.md)。

## 2026-10-28 现行专题收拢

本轮只整理文档，保留已有程序与用户样式改动，未提交、推送或部署。现行入口为[文档索引](../../README.md)。

### 合并与移位

| 原入口 | 整理结果 |
| --- | --- |
| CHAT／EDIT 混合说明 | CHAT 归[对话工作区](../../workspaces/chat.md)，编辑参数、蒙版与来源回流归[EDIT](../../workspaces/edit.md)，删除重复 Photopea 段落 |
| Photopea 接入规划 | 唯一内容合入[接入与工作栈](../../integrations/photopea.md)，删除重复接入文档 |
| 独立样式检查文档 | 合入[样式归属](../../engineering/ui-maintenance.md#样式检查)，删除独立文件 |
| 多角色与压缩的 `*-plan.md` | 当前契约分别归[多角色与画板](../../workspaces/image.md#画板与多角色)、[ASK 压缩](../../ask/compaction.md) |
| B1–B3 阶段规划 | 移入[历史规划](../bridge/2026-10-26-bridge-plan.md)，当前行为只由[Bridge](../../integrations/bridge.md)维护 |
| HOME 混合规划 | 原章节保留为[历史记录](../workspaces/2026-10-28-home-plan.md)，当前文档重写为工作区契约 |

现行 `docs/` Markdown 从 32 份收拢为 29 份；主索引不再罗列各阶段验收段落，统一由本目录索引查找。早期完整快照保持原样。

### 现状对齐

同步产品总览、架构、状态、设计语言、ASK、数据与发布说明：五个同级视图、EDIT 原位保活及每板独立现场、Photopea 多文档与自动回传、HOME 三种排列与同一 ASK、默认本地 Todo 和 IMAGE 外部草稿边界。补齐参考资产／Vibe 缓存、HOME 与 Slate 的存储和备份范围，移除“官方编辑尚未开放”等过时描述。

已检查 106 份 Markdown 的 687 处本地链接与章节锚点，无失效目标；历史索引覆盖全部平铺归档，早期完整快照保持原样。`git diff --check` 通过，程序文件摘要比对确认本轮没有程序改动。本轮未执行应用回归或真实收费生成；实现验收仍以各原记录为准。

## 2026-10-29 目录与职责整理

本轮只修改文档，保留前一轮测试组织和按需加载的未提交代码。未提交、推送或部署。

### 合并与移除重复入口

| 原文档 | 当前维护位置 |
| --- | --- |
| `drawing-workspace.md` ＋ `multi-character-boards.md` | [IMAGE](../../workspaces/image.md)：绘图、画板、角色和坐标统一维护 |
| `font-style-governance.md` ＋ `style-ownership.md` | [样式与字体维护](../../engineering/ui-maintenance.md)：保留级联、组件归属、检查及字体重建命令 |
| `ask-implementation-plan.md` ＋ `ask-architecture.md` | [ASK 契约与架构](../../ask/README.md)：唯一入口，保留决策、资源生命周期、工具与模块所有权 |
| `ask-contracts-and-decisions.md` ＋ `ask-debug.md` | [运行契约与调用调试](../../ask/runtime.md)：请求生命周期与实际调用记录统一维护 |

合并后删除四份重复独立文档，不保留转跳占位。其余现行文档按 `product/`、`workspaces/`、`integrations/`、`engineering/`、`ask/` 归位；`implementation-plan.md` 改为准确表达现状的 `status.md`，Bridge 移出 ASK 目录。现行文档从 32 份变为 28 份，`docs/` 根目录从 21 份变为 6 份。

### 保留与校正

- 产品总览、设计语言、架构与业务契约职责不同，继续独立；EDIT／Photopea、协议／NAI、ASK 基础感知／EDIT、压缩与图片身份也保留专题，不堆成一本长文。
- 归档按工程、NAI、ASK、图片身份、Bridge、Photopea、工作区和发布分目录；早期 2026-10-25 快照继续自洽保留。没有删除唯一规划或验收证据，也没有把历史方案重新当成现行规则。
- 修正 ASK 运行契约中残留的 CHAT 三段式展示号：当前使用字母尾缀，旧数字尾段仅兼容解析；裁切前置按原图实体共享。统一 EDIT 上限为 30 张物理图片，逻辑版本与数量分开。
- 根工程约定与用户已确认的单一 `main` 分支现状同步。项目说明、总索引、ASK 入口与交叉链接跟随移动更新。
- `docs/release-guide.md`、`docs/third-party-assets.md` 和公开 `public/skills/koma-bridge/SKILL.md` 保持固定路径；不改变发布包、外部协议或业务代码。

### 验证

检查 122 份 Markdown 的 835 个本地链接及章节锚点，另核对 3 个指向本仓库 main 的网页链接对应的本地目标；全部目标有效，所有 docs 文档均可从总索引到达，现行文档无旧路径残留。网页链接仅核验仓库目标，本轮未推送。

`npm run test:release` 通过：显式发布清单、哈希、免依赖服务、根路径／子路径及运行时注入检查均成功；`git diff --check` 通过。非文档文件摘要与整理前一致；历史归档除链接及整理记录外正文一致，2026-10-25 快照逐文件保持原样。未重复运行应用全量回归，前一轮程序验收由[测试维护记录](2026-10-29-test-maintenance.md)单独说明。
