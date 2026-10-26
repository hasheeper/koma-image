# Koma Image

以图片为中心的 AI 创作工作台，使用 Vue 3、TypeScript 和 Vite。绘图、对话和词典在同一外壳中切换并保持状态；编辑为全屏覆盖层，设置为弹窗。支持静态托管和可选本地 Node 代理。

站点：[Koma Image](https://koma-image.pages.dev/)。源码：[hasheeper/koma-image](https://github.com/hasheeper/koma-image)。本文说明仓库当前功能；线上部署版本需单独核对。

## 功能

- **IMAGE**：正负提示词、画幅与参数、批量生成、普通历史、独立收藏、图片参数导入、多角色和独立画板。
- **CHAT**：对话生图和参考图修改、附件、上下文选择、分支、多版本和会话管理。
- **编辑与词典**：图生图、蒙版重绘、放大、原生画布；Tag 搜索、分类、组合和输入补全。具体工具取决于连接和模型声明的能力。
- **ASK**：工作台诊断、按需看图与只读查询、修改草稿、多会话和附件、检查点与撤销、上下文压缩及归档召回。写入前由用户确认，不自动生图或发送 CHAT 消息。
- **待办**：默认本机任务与持久成果；会话输入框上方是紧凑 Todo，顶栏提供轻量总览，无需目录或 ASK Key。ASK 通过草稿推进任务与配方，可与提示词／参数／文件一并确认；挂载后同步选定任务与成果。
- **外部协同**：在 ASK 输入框附件旁挂载目录，手动 JSON 兜底位于现有「设置 → ASK → 外部协同」。外部 Agent 可提交 IMAGE 提示词、角色和参数草稿，无需 ASK 文本 Key；用户确认后应用。共享 `refs/` 由 ASK 按需读取，手动文件走原生附件入口；配方、备忘录与任务资料统一在草稿卡确认后保存或下载。详见[使用说明](docs/ask/bridge.md)。
- **数据**：图片收藏、CHAT 与偏好保存在本机，支持新版 Koma ZIP 备份。ASK 收藏会话及附件单独保存在本机，不进入普通备份；未收藏 ASK、普通绘图历史和撤销栈刷新清空。

## 连接与验证边界

在「设置 → 连接」显式选择协议，不按连接名称或域名推断，不自动回退。

| 协议 | 用途 | 本地环境变量代理 |
| --- | --- | --- |
| Koma 标准网关 | 绘图、对话、编辑、报价与额度保护 | 支持 |
| OpenAI Images | CHAT 生图与参考图修改 | 浏览器直连 |
| Gemini 原生 | CHAT 生图与参考图修改 | 浏览器直连 |
| NovelAI 官方 | V4.5／V5 绘图、常规四型号图生图、账户额度、多角色与 V4.5 Vibe／Precise | 浏览器直连 |
| OpenAI Chat 兼容 | ASK 推理、命名与压缩 | 支持 |
| Anthropic Messages | ASK 推理、命名与压缩 | 支持 |

初始连接为空；未配置 URL／Key 不请求上游。无法取得预报价时，生成按钮暂不展示费用标签，内部仍保留未知费用状态。NAI 官方重绘／放大尚未接入本项目，单次消耗估算尚未实现，订阅优惠和实际扣费待核验；新增协议的真实型号、生成效果、扣费、权限和 CORS 不能以模拟测试代替。详见 [NAI 当前覆盖与缺口](docs/novelai-official.md)、[当前状态与待办](docs/implementation-plan.md)及[图像协议](docs/native-image-protocols.md)。

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

`check` 包含字体一致性、Stylelint、严格类型、单元测试和生产构建；不包含浏览器及发布包套件。预览为 http://127.0.0.1:3217。业务回归按变更范围选择 `test:shell`、`test:services`、`test:shared`、`test:drawing`、`test:workspaces`、`test:native`、`test:ask`、`test:bridge`、`test:local`、`test:release`。已有 `dist/` 后可运行全部浏览器与发布包套件：

```sh
node --test --test-concurrency=2 tests/*.browser.mjs tests/release.package.mjs
```

所有业务验证使用合成数据和模拟接口，不执行真实收费生成。历史测试数量与执行范围保存在[归档](docs/archive/2026-10-25/README.md)，不作为当前测试总数。

## 本地运行与发布

```sh
npm run build
npm start
```

打开 http://127.0.0.1:3218。可在浏览器配置连接，也可由独立可选的 `KOMA_GATEWAY_*`、`KOMA_ASK_OPENAI_*`、`KOMA_ASK_ANTHROPIC_*` 提供本地代理配置；Key 留在服务端。代理只监听回环地址。

`npm run package` 生成可解压运行的发布包。`dist/` 可独立静态托管；构建和 Git 推送均不会自动发布 Pages。推送仓库和部署 Pages 每次须用户明确授权，并先脱敏复查。使用、备份、更新、回退和发布步骤见[发布说明](docs/release-guide.md)。

## 文档与目录

从[文档索引](docs/README.md)进入，按任务阅读现行规范；[工程约定](AGENTS.md)保存稳定边界，[设计语言](docs/design-language.md)说明界面风格。旧阶段记录已退出必读入口，归档保留。

```text
src/app/         单页外壳、路由和工作区生命周期
src/workspaces/  IMAGE、CHAT、TAGS
src/ask/         ASK 会话、工具、草稿、提示词与压缩
src/slate/       默认本地任务、成果、复合提交与目录交付
src/bridge/      外部目录、状态预览、草稿收件与回执、共享资料读取与导出
src/overlays/    编辑和设置
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
