# 架构规范

更新：2026-10-26。描述当前仓库结构。功能状态和真实待验项见[当前状态](implementation-plan.md)，产品和 UI 标准见[设计语言](design-language.md)，行为约束见[业务契约](business-contracts.md)。

## 单页外壳与所有权

- 单入口 `index.html`，轻量 hash 路由为 `#/image`、`#/chat`、`#/tags`；三个工作区以稳定 ID 使用 KeepAlive。
- 切换保留草稿、附件、选图、滚动和在途任务。编辑是单例全屏覆盖层，设置为单例弹窗，备份为其子页；旧 backup 路由仍可访问。
- `src/app/presentation.ts` 管页面 class、data 属性、标题、favicon 与样式开关。隐藏工作区暂停界面事件和绘制，不取消后台任务。
- 应用级服务在 KeepAlive 外持有数据、任务与资源。ASK 是全局浮层，不预留侧栏；编辑覆盖层打开时隐藏 ASK。
- `chat.html`、`tags.html`、`transfer.html` 只重定向到同一应用并保留查询参数，不初始化另一套应用或访问旧数据。

## DOM 与高频驱动

Vue 创建、包裹、移动和销毁节点。高亮组件在模板中声明 mirror 与 textarea，移动宿主使用 Teleport。原生 dialog／popover 保留焦点、Esc 和顶层语义。

Canvas、指针、逐帧进度和明确委托的高频样式由原生驱动管理，结束时同步必要业务状态。Blob、ImageBitmap、DOM、数据库、AbortController 和 CryptoKey 不进入深层 reactive。监听器、Observer、rAF 与 Object URL 有明确的激活、暂停、引用和销毁责任。

## 协议与连接

依赖方向为工作区 → domain／services → Gateway Profile → transport。Profile 声明目录、鉴权、报价、额度、路线及图像／推理能力，不按连接名称或域名分支。

登记表包含六种协议：Koma 标准网关、OpenAI Images、Gemini 原生、NovelAI 官方、OpenAI Chat 兼容和 Anthropic Messages。前四种服务图像工作区，后两种仅服务 ASK 推理、命名和压缩。实现边界见[图像协议](native-image-protocols.md)和[ASK 运行契约](ask/ask-contracts-and-decisions.md)。

标准网关保留防抖报价、执行前重报、`max_cost`、原生／Studio／工具分流和额度护栏。无报价能力保留未知费用状态，与报价失败、零值、加载分开；生成按钮暂不展示未知费用标签。没有协议自动回退或生成自动重试。

图像模型的可用来源与供应商优先级分开保存。连接页按配置能力分为图像与文本两区，综合供应商的两类接口分别显示。仅图像区通过上移／下移排序，非秘密配置为 `Routing.order`；未排序时保持原连接顺序，文本始终保持添加顺序。绘图／CHAT／编辑共用 `services/source-priority.ts`，按同一模型和当前操作筛选可用来源，只在明确额度不足时继续检查下一来源；余额未知仍按优先级使用。执行前重新检查报价和余额，提交生成后不因失败或取消换源重试。原生目录只提供 ID，规范模型匹配与手动来源由用户配置；ASK 仍手动选模，不参与图像优先级分流。

新环境连接为空；配置 URL／Key 后才能请求。兼容服务不内置私有地址，NovelAI 官方可以固定公开官方主机。直连依赖服务支持 CORS。

连接设置采用局部更新：排序、改名和模型来源编辑复用原始目录，保留当前列表与操作状态；地址／协议／Key 改变才使相应目录失效。原始目录缓存与执行上下文分离，后者仍按配置变化失效；报价和余额在执行前重新检查。具体责任见[网关与数据](gateway-data-scheduler.md)。

## 静态版与本地代理

静态版不读取环境变量、不探测代理。可选 `server.mjs` 只监听回环地址，同时提供静态资源和固定路径转发；三组配置独立可选：

| 用途 | 环境变量前缀 | 能力 |
| --- | --- | --- |
| 标准图像网关 | `KOMA_GATEWAY` | 标准网关固定目录、额度、报价及执行路径 |
| ASK OpenAI Chat | `KOMA_ASK_OPENAI` | 固定目录与流式推理路径 |
| ASK Anthropic Messages | `KOMA_ASK_ANTHROPIC` | 固定目录与流式推理路径 |

每组 URL／Key 成对设置；可只配置 ASK。网页只获得运行模式和临时令牌，服务端地址与 Key 不注入浏览器，不进入 `VITE_*`。只读运行时连接和令牌不持久化；图像模型来源另存 `koma.local.models.v1`。原生图像三协议目前仅浏览器直连。运行与打包步骤见[发布说明](release-guide.md)。

## 调度与数据

图像任务共用应用级调度器和 Web Locks，默认 N=1；忙时返回提示，不自动排队。批次持续占槽直到图片解码与结果处理完成。ASK 推理不占生成锁。数据库写入统一经数据租约和 `data.write`，延迟保存与缓存提供 flush／reload。详细责任见[网关、数据与调度](gateway-data-scheduler.md)。

数据库为 `koma-image-favorites`、`koma-chat`、`koma-handoff`、`koma-ask`、`koma-bridge`、`koma-slate`，偏好与凭据使用 `koma.*`，同步频道为 `koma-sync`。锁和键名集中于 `src/storage/names.ts`。ASK 收藏会话及附件、记忆和归档保存在独立库，不进入普通 ZIP；撤销执行记录和调用调试不持久化。

Bridge 的目录句柄、去重回执及预览归属保存在 `koma-bridge/state`，通过 `data.write` 写入且不进入普通备份。应用级 Bridge 服务负责前台文件同步，独立目录锁保证同源单写入者；外部草稿及队列归 ASK 会话持有，共用已有草稿与撤销服务。默认本地任务由 `src/slate/` 管理，`koma-slate` 保存任务、独立成果和跨画板提交记录；目录映射／交付回执保存在 `koma-bridge`，均不进入普通 ZIP。任务不属于 ASK 会话，目录和 Key 缺失时仍可使用。详见[外部协同与任务板](ask/bridge.md)。

NAI 参考资产与编码由应用级 `services/nai-references.ts` 管理，收藏库 schema v2 增加两个独立存储；画板只持小型 JSON。Vibe 编码与生图共用任务锁，成功编码立即落库，参考准备后固定来源上下文。

普通备份使用 `app=koma-image`、`kind=backup`、`version=2`；数据库 schema version 与备份 envelope version 独立。普通历史、编辑会话、交接数据、Key 和派生密钥不导出。仅支持新版 Koma 格式，不检测、转换或清理旧应用数据。

## 代码与维护入口

| 目录 | 责任 |
| --- | --- |
| `src/app` | 外壳、路由、保活、展示协调与服务注入 |
| `src/workspaces`、`src/overlays`、`src/shared` | 工作区、编辑／设置和共享 Vue 控件 |
| `src/ask` | 推理会话、只读工具、草稿、附件、收藏、提示词与压缩 |
| `src/slate` | 默认本地任务、共享编辑规则、独立成果与可恢复提交、目录版本映射／交付、确定性标注及会话待办／轻量总览 |
| `src/bridge` | 外部 IMAGE 状态／预览同步、目录生命周期、JSON 收件与回执、refs 资料读取与用户导出 |
| `src/domain` | 纯业务、模型、参数和角色结构 |
| `src/gateway` | Profile、请求转换、鉴权、连接诊断与传输 |
| `src/services`、`src/storage` | 调度、数据租约、资源、连接、持久化和备份 |
| `src/native` | 画布、蒙版、指针、图片解析和本地合成 |
| `src/config` | 非秘密配置 schema 和运行时配置 |

`src/` 自有逻辑使用严格 TS／Vue TS，类型来自实现，不增加 JS 配对声明。测试、服务器和工具保留原运行方式。

字体由配置生成，公共 CSS 按 tokens／base／controls／ui 分层，组件私有样式回归对应 Vue；保留词典 image＋tags、高亮全局指标等已记录依赖。维护入口见[字体](font-style-governance.md)、[样式归属](style-ownership.md)与[检查](style-checks.md)。

## 验证边界

用合成数据和模拟接口验证业务。UI 基础宽度为 320／390／768／1440px；高频检查只验证不触发 Vue 重渲染及无资源泄漏。历史验收在[归档](archive/2026-10-25/README.md)；真实供应商生成、效果、扣费和缓存命中仍需独立证据。
