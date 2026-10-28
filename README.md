# Koma Image

以图片为中心的 AI 创作工作台，使用 Vue 3、TypeScript 和 Vite。HOME、绘图、对话、编辑和词典在同一外壳中切换并保持状态；EDIT 按来源图管理独立编辑画板，设置为弹窗。Koma ASK 提供可审阅的创作建议，会话内 Todo 管理多图进度，外部 Agent 可通过用户选择的目录协同。支持静态托管和可选本地 Node 代理。

站点：[Koma Image](https://koma-image.pages.dev/)。源码：[hasheeper/koma-image](https://github.com/hasheeper/koma-image)。本文说明仓库当前功能；线上部署版本需单独核对。

产品定位、功能与整体框架从[产品总览](docs/product-overview.md)开始；技术实现见[架构](docs/architecture.md#核心技术)，视觉与交互原则见[设计语言](docs/design-language.md)。

## 功能

- **HOME**：默认创作桌面，继续上次车间、查看进行中与定稿；行对齐／列对齐／拼图三种排列。大图复用绘图参数、CHAT 交接、EDIT、Slate 交付和封面操作；头部与同一 ASK 共用输入，支持右侧停靠／全屏、收起状态行与连续过渡。
- **IMAGE**：正负提示词、画幅与参数、批量生成、普通历史、独立收藏、图片参数导入、多角色和独立画板。
- **CHAT**：对话生图和参考图修改、附件、上下文选择、分支、多版本和会话管理。
- **EDIT**：每张来源图拥有独立编辑画板，支持图生图、普通／聚焦蒙版重绘、Enhance／Max、原生／外部放大与六项 Director Tools；去背景的抠图／重建／混合结果可直接切换。Photopea 保留各板分层文档、自动回传图像／蒙版，同尺寸沿用区域。纯修图可直接进入历史、收藏和任务交付；编辑现场仅本页保留，生成工具取决于连接和模型能力。
- **TAGS**：Tag 搜索、分类、组合和输入补全，Anime／Furry 使用对应词库。
- **ASK**：工作台诊断、按需看图与只读查询、修改草稿、多会话和附件、检查点与撤销、上下文压缩及归档召回。写入前由用户确认，不自动生图或发送 CHAT 消息。
- **待办**：默认浏览器本地任务与持久成果，HTTPS 在线站与本地运行均可用；会话输入框上方是紧凑 Todo，顶栏提供轻量总览，无需目录或 ASK Key。ASK 通过草稿推进任务与配方，可与提示词／参数／文件一并确认；需交图的任务绑图后才能完成，挂载后同步选定任务与成果。
- **外部协同**：在 HOME 头部或 ASK 输入框附件旁挂载目录，手动 JSON 兜底位于现有「设置 → ASK → 外部协同」。外部 Agent 可提交 IMAGE 提示词、角色和参数草稿，无需 ASK 文本 Key；用户确认后应用。共享 `refs/` 由 ASK 按需读取，手动文件走原生附件入口；配方、备忘录与任务资料统一在草稿卡确认后保存或下载。详见[使用说明](docs/ask/bridge.md)。
- **数据**：画板、图片收藏、CHAT 与偏好保存在当前站点的浏览器中，支持新版 Koma ZIP 备份；域名与浏览器之间不自动同步。ASK 收藏会话及附件、Slate 任务与成果独立持久保存，不进入普通备份；未收藏 ASK、普通绘图历史和撤销栈刷新清空。

## 连接与验证边界

在「设置 → 连接」显式选择协议，不按连接名称或域名推断，不自动回退。

| 协议 | 用途 | 本地环境变量代理 |
| --- | --- | --- |
| Koma 标准网关 | 绘图、对话、编辑、报价与余额检查 | 支持 |
| OpenAI Images | CHAT 生图与参考图修改 | 浏览器直连 |
| Gemini 原生 | CHAT 生图与参考图修改 | 浏览器直连 |
| NovelAI 官方 | V4.5／V5 绘图、五型号图生图／Enhance、V5 Max、四型号普通／聚焦重绘、4× 放大、六项 Director Tools、账户额度、多角色与 V4.5 Vibe／Precise | 浏览器直连 |
| OpenAI Chat 兼容 | ASK 推理、命名与压缩 | 支持 |
| Anthropic Messages | ASK 推理、命名与压缩 | 支持 |

初始连接为空；未配置 URL／Key 不请求上游。无法取得预报价时，生成按钮暂不展示费用标签，内部仍保留未知费用状态。NAI 官方图生图／普通重绘／4× 放大已接线并模拟验证；普通／Max Enhance、手动 Focused Inpainting、六项 Director Tools、本地 Anlas 估算／Opus 资格、型号 token／Text 检查和外部 PNG Vibe 编码恢复均已接入。Director Tools 独立处理当前查看图，不继承左侧生图参数，也不使用 V5 百分比抵扣；按钮只显示正 Anlas 消耗。订阅优惠和实际扣费待核验，新增协议的真实型号、生成效果、扣费、权限和 CORS 不能以模拟测试代替。详见 [NAI 当前覆盖与缺口](docs/novelai-official.md)、[当前状态与待办](docs/implementation-plan.md)及[图像协议](docs/native-image-protocols.md)。

## 开发与检查

使用 Node 26（`.nvmrc` 为 26.8.2）、npm 11.19.1，依赖精确锁定。

```sh
npm ci
npm run dev
```

开发地址为 http://127.0.0.1:3216，端口占用直接报错。检查和预览：

```sh
npm run check
npm run preview
```

`check` 包含字体一致性、Stylelint、严格类型、单元测试和生产构建；不包含浏览器及发布包套件。预览为 http://127.0.0.1:3217。业务回归按变更范围选择 `test:shell`、`test:services`、`test:shared`、`test:drawing`、`test:workspaces`、`test:home`、`test:native`、`test:ask`、`test:bridge`、`test:local`、`test:release`。已有 `dist/` 后可运行全部浏览器与发布包套件：

```sh
node --test --test-concurrency=2 tests/*.browser.mjs tests/release.package.mjs
```

自动化业务验证使用合成数据和模拟生成接口，不执行真实收费生成。历史实战、测试数量与执行范围保存在[归档](docs/archive/README.md)，不作为当前测试总数。

Photopea 的本地宿主回归为 `node --test tests/photopea.browser.mjs tests/editor-return.browser.mjs`。真实官方 iframe 往返须显式运行 `KOMA_PHOTOPEA_LIVE=1 node --test tests/photopea-live.browser.mjs`，仅使用合成图片，不配置 Key 或执行生图；默认浏览器套件跳过该联网核验。

Director Tools 的协议与费用测试随 `check` 执行；界面、完整结果、选源与取消的模拟验证为 `node --test tests/director-tools.browser.mjs`，不向真实账户提交工具请求。

Photopea 的生产静态包交互核验须先 `npm run build`，再运行 `KOMA_PHOTOPEA_LIVE=1 KOMA_PHOTOPEA_ENGINES=chromium,edge node --test tests/photopea-compat.browser.mjs`；Edge 需本机已安装。可显式添加 `webkit` 检查 Playwright WebKit 引擎，但不等同实际 Safari。该套件覆盖四档宽度、键盘菜单、真实鼠标选区、Chromium 触摸模拟改图与纯修图回历史，结果和未验环境见 [PE3 收口记录](docs/archive/2026-10-27-photopea-pe3-verification.md)。

## 本地运行与发布

```sh
npm run build
npm start
```

打开 http://127.0.0.1:3218。可在浏览器配置连接，也可由独立可选的 `KOMA_GATEWAY_*`、`KOMA_ASK_OPENAI_*`、`KOMA_ASK_ANTHROPIC_*` 提供本地代理配置；Key 留在服务端。代理只监听回环地址。

`npm run package` 生成可解压运行的发布包。`dist/` 可独立静态托管；构建和 Git 推送均不会自动发布 Pages。推送仓库和部署 Pages 每次须用户明确授权，并先脱敏复查。使用、备份、更新、回退和发布步骤见[发布说明](docs/release-guide.md)。

## 文档与目录

从[产品总览](docs/product-overview.md)了解产品，从[文档索引](docs/README.md)按任务进入现行规范；[工程约定](AGENTS.md)保存稳定边界，[架构](docs/architecture.md)说明核心技术与模块，[设计语言](docs/design-language.md)说明界面取舍。旧阶段记录已退出必读入口，归档保留。

```text
src/app/         单页外壳、路由和工作区生命周期
src/workspaces/  IMAGE、CHAT、EDIT、TAGS
src/home/        HOME 创作线、定稿布局与 ASK 停靠
src/ask/         ASK 会话、工具、草稿、提示词与压缩
src/slate/       默认本地任务、成果、复合提交与目录交付
src/bridge/      外部目录、状态预览、草稿收件与回执、共享资料读取与导出
src/overlays/    设置、备份、Photopea 高级编辑及编辑参数
src/shared/      共用控件
src/domain/     纯业务与模型参数
src/gateway/    协议、鉴权、请求转换和连接诊断
src/services/   数据租约、调度、连接与工作区服务
src/storage/    Koma 数据库与备份
src/native/     Canvas、指针、元数据和图片处理
public/         本地静态资源、字体和样式
server.mjs      可选本地服务与固定路径代理
scripts/        字体构建与发布打包
tests/          单元、浏览器与发布包验证
docs/           现行文档与历史归档
```

当前许可证为 `UNLICENSED`，不代表开源授权。字体与图标各自保留[第三方许可](docs/third-party-assets.md)。
