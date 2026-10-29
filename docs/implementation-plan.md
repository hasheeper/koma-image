# 当前状态与待办

更新：2026-10-29。本文保留稳定路径，集中说明仓库现状与剩余工作。产品介绍见[产品总览](product-overview.md)，行为细节由各专题维护；阶段过程与验收数字见[历史索引](archive/README.md)。ASK NAI 基础感知、EDIT 协作、供应商配置与本轮界面整理已推送并发布至 Pages；[发布与公开前核验](archive/2026-10-29-ask-edit-public-release-verification.md)记录脱敏、历史邮箱匿名化及单一 main 分支整理。本地完成和静态发布均不代表真实供应商联调。

## 已实现范围

| 范围 | 当前能力与维护入口 |
| --- | --- |
| 外壳与导航 | HOME／IMAGE／CHAT／EDIT／TAGS 同级切换；HOME 为默认路由，设置为弹窗；HOME／IMAGE／CHAT／TAGS 使用 KeepAlive，EDIT 原位隐藏保活。见[架构](architecture.md) |
| HOME | 真实创作线、继续入口、收藏定稿、行／列／拼图三种排列、每 IMAGE 画板一张 1080px 展示副本、封面与来源链；同一 ASK 停靠、状态行、原图拖入和共享元素过渡。本地数据就绪后显示五格空状态与整页中央柔光，空状态背景粘贴图片进入 EDIT。见[HOME](koma-home.md) |
| IMAGE 与角色 | 独立表单画板、串行批量、历史与收藏、参数往返、多角色与定位；冻结提交来源。见[绘图](drawing-workspace.md)、[角色与画板](multi-character-boards.md) |
| CHAT | 上下文选择、分支、多版本、持久会话、逐图收藏与显式图片交接。见[对话](chat-workspace.md) |
| EDIT | 独立 `#/edit`、每来源图一画板、每板最多 30 张物理图片；参数／角色／参考继承、实际 Seed、同尺寸蒙版沿用、后台任务归属及 HOME 继续。编辑现场仅本页；ASK 可读取蒙版几何、准备编辑草稿与交接，Photopea 打开时收起。见[编辑](edit-workspace.md) |
| Photopea | 单 iframe 多画板分层文档保活；三层及隐藏选区辅助层、干净图像／蒙版自动分离、同尺寸换底保图层、纯修图保留编辑版本并直接收藏／交付 Slate。Dark Blue、紧凑固定顶栏和完整视口。见[接入与工作栈](photopea-workstack-spec.md) |
| 图像协议 | 标准网关、OpenAI Images、Gemini 原生与 NovelAI 官方基础接线及模拟验证；NAI 账户已有授权只读验证。见[协议](native-image-protocols.md) |
| NAI | V4.5 Full／Curated、V5 Full High／Medium／Curated 五型号文生图、Img2Img 与普通 Enhance，V5 三型号另有 Max Enhance；除 V5 Curated 外四型号普通／聚焦 Inpaint、官方 4× Upscale、六项 Director Tools；模式、Effort、Complexity、预设、透明底、Guidance／Rescale、多角色与适用的 V4.5 Vibe／Precise；本地费用估算、型号输入预算和外部 PNG Vibe 编码恢复。见[NAI](novelai-official.md) |
| 连接与选源 | 图像／文本分区、仅图像排序；按模型／操作／额度选择，未知余额按优先级，明确不足才顺位；提交失败不换源重试，连接和模型操作局部更新。见[设置](shared-settings-tags.md) |
| ASK | 两种推理协议、只读工具、图片／附件、多会话、收藏、命名、草稿与撤销、压缩及归档召回、EDIT／CHAT 交接与本地输入检查；图片权限按轮次冻结、回复表格支持行内 `<br>`。见[ASK 入口](ask/ask-implementation-plan.md) |
| Todo 与外部协同 | 默认本地持久任务、紧凑清单与轻量总览、内外复合草稿、持久绑图；目录挂载／权限恢复、状态／预览／索引、refs 按需读取及文件草稿、JSON 兜底、排队与回执。新建活动任务在已挂载时自动映射。见[协同与任务](ask/bridge.md) |
| 供应商配置 | 名称、协议、地址与 API Key 合并为用户主动打开的「配置供应商」单弹窗；空配置或缺 Key 启动不弹窗。按供应商选择浏览器保存／会话使用，移除口令、锁定及停用凭据存储引用，保留跨页同步、清除和备份隔离。见[设置与凭据](shared-settings-tags.md) |
| 数据与工程 | 数据租约、全应用 N=1 调度、新版 Koma ZIP、可选本地代理与发布包；严格 TS、集中字体配置、CSS 归属与检查。见[数据与调度](gateway-data-scheduler.md)、[发布](release-guide.md)、[样式](style-ownership.md) |

上述功能已完成相应代码及本地模拟验收。真实 Photopea 合成图往返、单 iframe 多文档保活另有[核验记录](archive/2026-10-28-edit-workspace-verification.md)；它们不验证 NAI 的真实生成或扣费。

## 仍待真实验证

- **供应商联调**：逐目标地址核验鉴权、CORS、账户权限、型号、请求／返回、生成效果和实际扣费。标准网关曾用一次界面报价免费的 V5 Full 生成完成[绑图实战](archive/2026-10-26-bridge-field-verification.md)，仅证明该次路径，不覆盖其他供应商或型号。
- **NovelAI**：五型号文生图／Img2Img／普通 Enhance、V5 三型号 Max Enhance、四型号普通／聚焦 Inpaint、4× Upscale、六项 Director Tools（含三种去背景结果）、多角色、Vibe 编码／缓存命中与两种参考效果，以及原图／参数／前后额度；Opus 资格、订阅优惠、V5 实际消耗与回充仍需核验。账户和词库只读、本地模拟与页面检查均不能代替生成验证。
- **ASK 质量**：真实图片黄金样例、诊断／提纯／命名、用户提示词效果、交接备忘录质量、CHAT 尺寸项效果与真实缓存命中。
- **目录兼容**：Chromium OPFS 已验证文件写入、句柄保存和跨页锁；macOS Edge 已实测本地选择器、授权、刷新恢复与外部文件闭环。浏览器重启、撤权恢复、其他浏览器与跨进程竞争仍待验。
- **编辑兼容**：实际 Safari、移动真机、Photopea 复杂分层长时使用及 Pages 发布后体验仍待独立核验。Playwright WebKit 不等于实际 Safari。
- **持续发布验证**：本轮 ASK／EDIT 与供应商配置发布已核对静态产物、五个工作区及四档页面宽度；每次发布须按具体提交检查，线上静态检查不能代替 CI 与真实供应商生成验证。

真实收费生成、推送和部署按工程约定取得对应授权。

## NAI 适配收口与剩余项

| 范围 | 缺口 |
| --- | --- |
| 单次消耗 | 本地 Anlas、参考／编码费和 Opus 资格已按公开客户端接入；V5 百分比仅 FAQ 基准近似，实际扣费与权益仍须真实核验，未知标签隐藏且不视为免费 |
| 型号参数 | 官方六采样器、3MP／64 对齐、步数、V4.5 可调调度／Variety+、V5 Karras、强度／噪声和 Medium Heavy 已按公开客户端对齐，实际采用与效果仍须真实核验。Variety+ 仅开放官方 V4.5，按实际请求尺寸换算 sigma；Guidance／Rescale 使用 `scale`／`cfg_rescale`，不发送遗留 `cfg` |
| 工具 | 普通 Enhance 与 V5 Max Enhance（`upscaled_enhance`、原尺寸请求与实际输出校验）已接入；Focused Inpainting 已接手动蒙版／框选、裁切放大与原尺寸回贴；六项 Director Tools 已接独立协议／费用、尺寸预处理与去背景三种结果，真实效果与消费待验；V5 Curated 不开放独立重绘 |
| 导入与检查 | 外部 PNG Vibe 编码／Alpha 隐藏元数据、型号 token 预算及 `Text:` 上限已接入；未附带的参考原图／Precise 无法恢复，V5 自动引号提取未开放 |
| ASK 基础感知 | 型号／来源能力、保存值与生效值、角色共享 token／Text 预算、只读费用、候选检查和元数据已接通，见 [NAI 基础感知](ask/ask-nai-awareness.md) |
| 界面 | V4.5 质量入口迁入参数抽屉尚未实施 |

能力依据与核验顺序由[NAI 专题](novelai-official.md#后续工作与核验顺序)维护。V5 的两种参考保持不开放，须先有适用能力证据。

## ASK 的 NAI 基础感知与 EDIT

[EA0 基础感知](ask/ask-nai-awareness.md)与 [EA1–EA3 编辑接入](ask/ask-edit.md)已按顺序实现。IMAGE 与 EDIT 共用能力／生效值、分段 token／Text 和费用读取；内置 EDIT 草稿使用独立无报价写入路径，支持模式、Enhance、聚焦框、Director 预设与撤销。edit_handoff 留在原页，#e → CHAT 保留原图／转换后的实体与来源。

代码与本地模拟验证记录在[验收归档](archive/2026-10-29-ask-edit-verification.md)，[最终发布核验](archive/2026-10-29-ask-edit-public-release-verification.md)记录已完成的 Git／Pages 交付。真实模型对动态状态的理解、编辑建议质量、实际 token 采用与计费仍按本文真实待验边界核验。

## 图片身份

[全局图片身份](image-identity.md)贯通原图实体、持久收藏号、EDIT／CHAT 短码、逐轮冻结引用、视觉共享、备份和 Bridge／Slate／HOME。编辑结果归 EDIT，不自动注册为 IMAGE 历史；ASK 具备 EDIT 索引、现场与看图能力，内置配置草稿经确认写入，外部 Bridge 仍只写 IMAGE。

实时收藏编号只读持久 `favSeq`，不再在 ASK 会话中分配或恢复实时编号；旧 CHAT 数字尾段、已保存引用及 Koma 备份可选身份字段仍有明确的兼容读取边界。

## 当前范围之外与已取消事项

- EDIT 跨刷新恢复、PSD 持久化与外部 Bridge EDIT 草稿未开放；当前编辑原图可通过收藏或 Slate 保存，分层由用户另存 PSD。
- OpenAI Responses／蒙版／流式部分图片、Gemini 有状态多轮与签名续传、原生图像协议的本地代理不在基础适配范围。
- ASK 不做 RAG／Embedding、跨会话记忆、云端同步、后台静默压缩、自动生成或自动发送。
- 自定义并发和额度预占只保留边界，默认全应用 N=1。
- 旧应用数据迁移整条线已取消：没有迁移桥、旧库检测／清理、旧备份转换或对应 UI，不列为待办。新版 Koma 字段的兼容读取不构成旧应用迁移。

## 检查与证据

命令见[项目说明](../README.md#开发与检查)，按变更运行相关检查。验收记录须注明日期、基线、执行范围及模拟／真实边界；历史数字不累计成当前测试总数。[历史索引](archive/README.md)集中链接各阶段证据，不在现状文档重复过程。
