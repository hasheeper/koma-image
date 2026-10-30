# 架构规范

更新：2026-10-30。描述当前核心技术、模块结构与所有权。产品定位和功能见[产品总览](product/overview.md)，功能状态和真实待验项见[当前状态](status.md)，UI 标准见[设计语言](product/design-language.md)，行为约束见[业务契约](business-contracts.md)。

## 核心技术

| 技术 | 当前用途与边界 |
| --- | --- |
| Vue 3 + TypeScript | 单文件组件与应用服务，`src/` 使用严格类型；KeepAlive 保留工作区，Teleport 与原生 dialog／popover 管理覆盖层、菜单和焦点 |
| Vite | 开发、ES2022 构建和相对资源路径；`dist/` 可独立静态托管，Cloudflare Pages 通过 Direct Upload 显式发布 |
| 浏览器 Canvas 与图片 API | 图片解码、预览缩放、蒙版、画布指针、参考图处理和本地对比合成；高频更新由原生驱动承担 |
| IndexedDB + 本地偏好存储 | 图片收藏、CHAT、已收藏 ASK、Slate 和协同映射分别持久化；页面临时历史与撤销记录保持独立生命周期 |
| Web Locks + BroadcastChannel | 图像任务、数据租约、任务清单和目录同步的同源互斥及轻量跨页通知；不保证外部进程的文件互斥 |
| Fetch + 流式协议适配 | Gateway Profile 负责鉴权、请求和能力；ASK 的 OpenAI Chat／Anthropic Messages 适配器处理流式文本与工具调用 |
| Web Crypto | 图片、资料与交付文件的 SHA-256 校验；Key 不随构建注入浏览器 |
| File System Access API | 用户授权后的协同目录读写与句柄恢复；无该 API 时可手动导入／下载 JSON，Todo 不依赖此能力 |
| 本地 NAI tokenizer Worker | 按型号加载 T5／Qwen3.5 许可词表；有界缓存与空闲终止，不外发提示词，不阻塞主线程分词 |
| Marked + Entities | ASK 的 CommonMark／GFM 解析和实体解码；解析树映射为 Vue 节点，行内裸 `<br>` 可换行，其他原始 HTML 保持文字 |
| 原生 CSS + 本地字体／SVG | tokens、分层共享样式及组件私有样式；资源圆体、Fredoka、JetBrains Mono 与线性图标统一视觉语言 |
| Node 26 + 自动检查 | 可选本地固定路径代理、字体生成和发布打包；严格类型、Stylelint、Node 单元测试与 Playwright 浏览器验证 |

依赖精确版本由 `package.json` 与 `package-lock.json` 维护。静态站承载相同的前端和本地持久化能力，无需云端业务服务；上游模型接口和本地目录访问各有独立权限与兼容条件。

## 单页外壳与所有权

- 单入口 `index.html`，轻量 hash 路由为 `#/home`、`#/image`、`#/chat`、`#/edit`、`#/tags`；HOME／IMAGE／CHAT／TAGS 以稳定 ID 使用 KeepAlive，EDIT 首次挂载后原位隐藏保活，避免移动 iframe 重载。空或未知路由进入 HOME，显式路由保留；HOME 没有车间顶栏。
- 切换保留草稿、附件、选图、滚动和在途任务。EDIT 是独立页面，每张独立来源图拥有自己的编辑画板，设置为单例弹窗，备份为其子页；旧 backup 路由仍可访问。
- `src/app/presentation.ts` 管页面 class、data 属性、标题、favicon 与样式开关；`src/app/theme.ts` 统一解析外观偏好、系统颜色与跨页同步，默认暗色，仅显式选择系统时跟随；IMAGE／CHAT 共用顶栏菜单，通用设置同步，入口脚本先恢复首屏主题。隐藏工作区暂停界面事件和绘制，不取消后台任务。
- 应用级服务在 KeepAlive 外持有数据、任务与资源。ASK 由外壳持有，车间桌面使用不挤压工作区的全局浮层，860px 及以下展开为全屏；HOME 使用半屏／全屏停靠；EDIT 同样可用 ASK，Photopea 打开时收起并让出键盘。
- 设置、任务总览与 Photopea 界面在首次使用时按需加载。设置首次挂载后保留同一 dialog，Photopea 继续原位保留 iframe；应用级服务与工作区切换仍按原所有权运行。设置加载期间切走时，以最新路由决定是否打开。
- `chat.html`、`tags.html`、`transfer.html` 只重定向到同一应用并保留查询参数，不初始化另一套应用或访问旧数据。

## DOM 与高频驱动

Vue 创建、包裹、移动和销毁节点。高亮组件在模板中声明 mirror 与 textarea，移动宿主使用 Teleport。原生 dialog／popover 保留焦点、Esc 和顶层语义。

Canvas、指针、逐帧进度和明确委托的高频样式由原生驱动管理，结束时同步必要业务状态。Blob、ImageBitmap、DOM、数据库、AbortController 和 CryptoKey 不进入深层 reactive。监听器、Observer、rAF 与 Object URL 有明确的激活、暂停、引用和销毁责任。

EDIT 由应用级服务持有独立画板、源版本、蒙版与任务归属。蒙版与手动聚焦框在同板同尺寸版本间沿用；聚焦重绘由客户端裁切／放大后单次请求，再仅合成原尺寸蒙版区域；手动结果与生成结果分型，原始出处及来源配方独立记录，结果留在 EDIT，经收藏与 Slate 交付。Director Tools 使用独立官方工具协议，输入取当前查看版本，去背景三种结果成组展示、保留透明通道与来源配方；所有输出解码与版本处理完成后释放同一任务槽。后台结果归发起画板，不抢占当前页；详见[编辑工作区](workspaces/edit.md)。

Photopea 首次打开后保留单 iframe，每编辑画板拥有独立分层文档。固定脚本、串行消息、输入归一化与临时 PSD 元数据检查由 `src/native/photopea-*` 分工；宿主只持轻量身份与状态。回传冻结来源，经完整校验一次提交；临时内存副本导出干净图像和蒙版，原分层及撤销／重做保留。完整视口、延迟重排、通道隔离与资源清理见[Photopea 接入与工作栈](integrations/photopea.md)。

## 协议与连接

依赖方向为工作区 → domain／services → Gateway Profile → transport。Profile 声明目录、鉴权、报价、额度、路线及图像／推理能力，不按连接名称或域名分支。

登记表包含六种协议：Koma 标准网关、OpenAI Images、Gemini 原生、NovelAI 官方、OpenAI Chat 兼容和 Anthropic Messages。前四种服务图像工作区，后两种仅服务 ASK 推理、命名和压缩。实现边界见[图像协议](integrations/image-protocols.md)和[ASK 运行契约](ask/runtime.md)。

标准网关保留防抖报价、执行前重报、`max_cost`、原生／Studio／工具分流和余额检查。无报价能力保留未知费用状态，与报价失败、零值、加载分开；生成按钮暂不展示未知费用标签。没有协议自动回退或生成自动重试。

图像模型的可用来源与供应商优先级分开保存。连接页按配置能力分为图像与文本两区，综合供应商的两类接口分别显示。仅图像区通过上移／下移排序，非秘密配置为 `Routing.order`；未排序时保持原连接顺序，文本始终保持添加顺序。绘图／CHAT／编辑共用 `services/source-priority.ts`，按同一模型和当前操作筛选可用来源，只在明确额度不足时继续检查下一来源；余额未知仍按优先级使用。执行前重新检查报价和余额，提交生成后不因失败或取消换源重试。原生目录只提供 ID，规范模型匹配与手动来源由用户配置；ASK 仍手动选模，不参与图像优先级分流。

新环境连接为空；启动保留目标工作区，空配置或缺 Key 不自动打开设置或配置窗。用户在设置中通过统一「配置供应商」弹窗一次保存名称、协议、地址与 Key，配置 URL／Key 后才能请求。Key 按供应商选择浏览器保存或仅本次会话，不再使用口令和独立 Key 弹窗；凭据不进入普通备份。兼容服务不内置私有地址，NovelAI 官方可以固定公开官方主机。直连依赖服务支持 CORS。

连接设置采用局部更新：排序、改名和模型来源编辑复用原始目录，保留当前列表与操作状态；地址／协议／Key 改变才使相应目录失效。原始目录缓存与执行上下文分离，后者仍按配置变化失效；报价和余额在执行前重新检查。具体责任见[网关与数据](engineering/data-and-tasks.md)。

## 静态版与本地代理

静态版不读取环境变量、不探测代理。可选 `server.mjs` 只监听回环地址，同时提供静态资源和固定路径转发；三组配置独立可选：

| 用途 | 环境变量前缀 | 能力 |
| --- | --- | --- |
| 标准图像网关 | `KOMA_GATEWAY` | 标准网关固定目录、额度、报价及执行路径 |
| ASK OpenAI Chat | `KOMA_ASK_OPENAI` | 固定目录与流式推理路径 |
| ASK Anthropic Messages | `KOMA_ASK_ANTHROPIC` | 固定目录与流式推理路径 |

每组 URL／Key 成对设置；可只配置 ASK。网页只获得运行模式和临时令牌，服务端地址与 Key 不注入浏览器，不进入 `VITE_*`。只读运行时连接和令牌不持久化；图像模型来源另存 `koma.local.models.v1`。原生图像三协议目前仅浏览器直连。运行与打包步骤见[发布说明](release-guide.md)。

## 调度与数据

图像任务共用应用级调度器和 Web Locks，默认 N=1；忙时返回提示，不自动排队。批次持续占槽直到图片解码与结果处理完成。ASK 推理不占生成锁。数据库写入统一经数据租约和 `data.write`，延迟保存与缓存提供 flush／reload。详细责任见[网关、数据与调度](engineering/data-and-tasks.md)。

数据库为 `koma-image-favorites`、`koma-chat`、`koma-handoff`、`koma-ask`、`koma-bridge`、`koma-slate`、`koma-home`，偏好与凭据使用 `koma.*`，同步频道为 `koma-sync`。锁和键名集中于 `src/storage/names.ts`。ASK 收藏会话及附件、记忆和归档保存在独立库，不进入普通 ZIP；撤销执行记录和调用调试不持久化。

Bridge 的目录句柄、去重回执及预览归属保存在 `koma-bridge/state`，通过 `data.write` 写入且不进入普通备份。应用级 Bridge 服务负责前台文件同步，独立目录锁保证同源单写入者；外部草稿及队列归 ASK 会话持有，共用已有草稿与撤销服务。默认本地任务由 `src/slate/` 管理，`koma-slate` 保存任务、独立成果和跨画板提交记录；目录映射／交付回执保存在 `koma-bridge`，均不进入普通 ZIP。任务不属于 ASK 会话，目录和 Key 缺失时仍可使用。详见[外部协同与任务板](integrations/bridge.md)。

HOME 服务在 App 中创建一次，订阅现有画板、图片、收藏、CHAT、EDIT、Slate 与路由，只投影身份和展示元数据。`koma-home/previews` 保存每 IMAGE 画板最新的 1080px 展示副本，`koma.home.v1` 保存封面、布局与返回位置；均不进入普通 ZIP，副本不可作为原图使用。写入遵守数据租约、flush／reload 和新旧源图校验，界面停用清理监听与测量，资源替换时释放 URL。CHAT 的首页读取仅访问本地存储，不触发目录、报价或额度。布局为纯尺寸计算，ASK 停靠复用同一服务与呈现状态，过渡保持 Vue 节点所有权；详见[HOME 工作区](workspaces/home.md)。

CHAT 收藏复制原始字节到既有收藏库，以会话／轮次／版本／资产组成稳定身份；不依赖源会话继续存在。EDIT 与 Slate 参数白名单保留这些来源和 `editId`／`editParent`；显示编号不作为持久身份。CHAT 的词文和选项不是绘图配方，UI 参数导入和 ASK 部分恢复均拒绝将其写入绘图参数。

这里的本地存储属于当前浏览器和站点来源，Cloudflare Pages 与本地服务均可运行 Todo；域名、端口或浏览器变化不共享数据。会话只关联 Slate ID，不拥有清单和成果；稳定身份与持久版本由任务服务管理，草稿校验沿用[共享编辑规则](integrations/bridge.md#ask-推进与复合草稿)。

ASK 的只读工具与外部 IMAGE 收件共用草稿结构，提示词、参数、`slate_edit` 和 `save_ref` 在 DraftCard 审阅。确认写入器协调原画板路径、本地任务／资产及文件预检与补偿，完成记录复用工具完成态；文件系统与 IndexedDB 之间不提供跨进程原子事务。公开 `/skills/koma-bridge/SKILL.md` 只说明外部操作方式，目录内生成的 `PROTOCOL.md` 才描述当前字段，不构成远程文件访问接口。

NAI 参考资产与编码由应用级 `services/nai-references.ts` 管理，收藏库保留 referenceAssets／vibeEncodings 两个独立存储；画板只持小型 JSON。Vibe 编码与生图共用任务锁，成功编码立即落库，参考准备后固定来源上下文。

普通备份使用 `app=koma-image`、`kind=backup`、`version=2`；数据库 schema version 与备份 envelope version 独立。普通历史、编辑会话、交接数据、HOME 展示副本与偏好、Key 不导出。仅支持新版 Koma 格式，不检测、转换或清理旧应用数据。

## 图片身份

[图片身份与引用](engineering/image-identity.md)区分原图字节实体、操作记录及带作用域的展示短码。收藏库 schema v3 在原存储上增加最小编号登记和库身份；收藏号跨刷新固定，页内历史与 EDIT 号不持久化。ASK 冻结整轮具体绑定，按实体共享视觉编码和已看资格，按记录读取配方。EDIT 结果不自动进入 IMAGE 历史，Bridge 仅导出 EDIT 只读目录，外部草稿仍只写 IMAGE。内置 ASK 的 NAI 能力／预算／费用通过共用只读服务获取；EDIT 草稿经专用无报价写入器应用，蒙版、底图与生成不交给 ASK。见 [NAI 基础感知](ask/nai-awareness.md)及 [ASK × EDIT](ask/edit.md)。

## 代码与维护入口

| 目录 | 责任 |
| --- | --- |
| `src/app` | 外壳、路由、保活、展示协调与服务注入 |
| `src/workspaces`、`src/overlays`、`src/shared` | 工作区、设置／Photopea 覆盖层和共享 Vue 控件 |
| `src/ask` | 推理会话、只读工具、草稿、附件、收藏、提示词与压缩 |
| `src/home` | 创作线投影、展示副本与偏好、HOME 页面／三种布局／导航；ASK 停靠、状态摘要、原图拖入与共享元素过渡 |
| `src/slate` | 默认本地任务、共享编辑规则、独立成果与可恢复提交、目录版本映射／交付、确定性标注及会话待办／轻量总览 |
| `src/bridge` | 外部 IMAGE 状态／预览同步、目录生命周期、JSON 收件与回执、refs 资料读取与用户导出 |
| `src/domain` | 纯业务、模型、参数和角色结构 |
| `src/gateway` | Profile、请求转换、鉴权、连接诊断与传输 |
| `src/services`、`src/storage` | 调度、数据租约、资源、连接、持久化和备份 |
| `src/native` | 画布、蒙版、指针、图片解析和本地合成 |
| `src/config` | 非秘密配置 schema 和运行时配置 |

`src/` 自有逻辑使用严格 TS／Vue TS，类型来自实现，不增加 JS 配对声明。测试、服务器和工具保留原运行方式。

字体由配置生成，公共 CSS 按 tokens／base／controls／ui 分层，组件私有样式回归对应 Vue；保留词典 image＋tags、高亮全局指标等已记录依赖。维护入口见[字体](engineering/ui-maintenance.md#字体配置与重建)、[样式归属](engineering/ui-maintenance.md)与[检查](engineering/ui-maintenance.md#样式检查)。

## 验证边界

用合成数据和模拟接口验证业务。浏览器只断言操作、请求、状态、存储与图片／蒙版结果，不断言 CSS 值、具体控件尺寸、动画帧或四档视口几何。样式调整按需目视检查相关页面。历史验收在[归档](archive/README.md)；真实供应商生成、效果、扣费和缓存命中仍需独立证据。

默认 `check` 执行类型、纯逻辑单元测试和构建；CI 再运行 `scripts/test-browser.mjs` 选出的少量 `[core]` 业务冒烟。专题浏览器测试按功能手动选择，`--all` 才运行全部浏览器用例，发布包另行检查。共享模拟环境在 `tests/helpers/`；每个测试服务器使用独立系统临时缓存，关闭时自动删除。测试不自动累积截图，真实 Photopea 联网仍须显式开启。命令与维护约定见[开发与检查](../README.md#开发与检查)。
