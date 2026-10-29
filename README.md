# Koma Image

以图片为中心的 AI 创作工作台，使用 Vue 3、TypeScript 和 Vite。HOME、绘图、对话、编辑和词典在同一外壳中切换并保持状态；EDIT 按来源图管理独立编辑画板，设置为弹窗。Koma ASK 提供可审阅的创作建议，会话内 Todo 管理多图进度，外部 Agent 可通过用户选择的目录协同。支持静态托管和可选本地 Node 代理。

站点：[Koma Image](https://koma-image.pages.dev/)。源码：[hasheeper/koma-image](https://github.com/hasheeper/koma-image)。本文说明仓库当前功能；线上部署版本需单独核对。

产品定位、功能与整体框架从[产品总览](docs/product/overview.md)开始；技术实现见[架构](docs/architecture.md#核心技术)，视觉与交互原则见[设计语言](docs/product/design-language.md)。

## 功能

- **HOME**：默认创作桌面，继续上次车间、查看进行中与定稿；行对齐／列对齐／拼图三种排列。大图复用绘图参数、CHAT 交接、EDIT、Slate 交付和封面操作；头部与同一 ASK 共用输入，支持右侧停靠／全屏、收起状态行与连续过渡。
- **IMAGE**：正负提示词、画幅与参数、批量生成、普通历史、独立收藏、图片参数导入、多角色和独立画板。
- **CHAT**：对话生图和参考图修改、附件、上下文选择、分支、多版本和会话管理。
- **EDIT**：每张来源图拥有独立编辑画板，支持图生图、普通／聚焦蒙版重绘、Enhance／Max、原生／外部放大与六项 Director Tools；去背景的抠图／重建／混合结果可直接切换。Photopea 保留各板分层文档、自动回传图像／蒙版，同尺寸沿用区域。纯修图保留为 EDIT 版本，可直接收藏和任务交付；编辑现场仅本页保留，生成工具取决于连接和模型能力。
- **TAGS**：Tag 搜索、分类、组合和输入补全，Anime／Furry 使用对应词库。
- **ASK**：工作台诊断、NAI 能力／token／只读费用、按需看图与候选检查、IMAGE／EDIT 修改草稿与图片交接、多会话和附件、检查点与撤销、上下文压缩及归档召回。写入前由用户确认，不自动生图或发送 CHAT 消息。
- **待办**：默认浏览器本地任务与持久成果，HTTPS 在线站与本地运行均可用；会话输入框上方是紧凑 Todo，顶栏提供轻量总览，无需目录或 ASK Key。ASK 通过草稿推进任务与配方，可与提示词／参数／文件一并确认；需交图的任务绑图后才能完成，挂载后同步选定任务与成果。
- **外部协同**：在 HOME 头部或 ASK 输入框附件旁挂载目录，手动 JSON 兜底位于现有「设置 → ASK → 外部协同」。外部 Agent 可提交 IMAGE 提示词、角色和参数草稿，无需 ASK 文本 Key；用户确认后应用。共享 `refs/` 由 ASK 按需读取，手动文件走原生附件入口；配方、备忘录与任务资料统一在草稿卡确认后保存或下载。详见[使用说明](docs/integrations/bridge.md)。
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

初始连接为空，启动不弹出配置窗；在设置中统一填写供应商名称、协议、地址与 Key，未配置 URL／Key 不请求上游。未知费用不显示为免费。上述接线已通过本地模拟检查，真实型号、效果、扣费、权限与 CORS 仍需按供应商核验；具体边界见 [NAI 专题](docs/integrations/novelai.md)与[当前待办](docs/status.md)。

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

`check` 只运行严格类型、纯逻辑 Node 单元测试和生产构建，不启动浏览器。预览为 http://127.0.0.1:3217。

| 命令 | 使用时机 |
| --- | --- |
| `npm run check` | 类型、逻辑和构建检查；CI 使用同一入口 |
| `node scripts/test-browser.mjs` | 使用已有 `dist/` 运行少量 `[core]` 业务冒烟；CI 仅额外执行这些用例 |
| `npm run test:browser` | 先构建，再运行上述核心冒烟 |
| `node scripts/test-browser.mjs --list` | 只查看默认选中的文件，不启动浏览器 |
| `npm run test:ask`、`test:native`、`test:home`、`test:edit` | 对相关功能改动手动运行专题测试，使用已有构建 |
| `node scripts/test-browser.mjs shell ask-vision` | 按文件名前缀组合专题；也可传完整 `.browser.mjs` 文件名 |
| `npm run test:browser:all` | 显式运行全部浏览器测试，日常修改不默认执行 |
| `npm run test:release` | 修改打包／本地服务器时单独检查发布包 |
| `npm run styles:check`、`npm run fonts:check` | 修改相关样式规范／字体配置时按需检查 |

核心冒烟复用现有测试，以标题中的 `[core]` 标记为唯一清单：

| 链路 | 保护的实际结果 |
| --- | --- |
| IMAGE 生成 → 历史 → 收藏 | 请求载荷、原图和参数、收藏持久化与撤销 |
| CHAT 发送 → 多版本 | 发送上下文、附件消费、版本／分支和草稿保存 |
| EDIT 编辑 → 蒙版 → 衍生图 | 编辑请求、蒙版像素、撤销／重做与结果归属 |
| ASK 提议 → 确认 → 撤销 | 未确认不写入，确认和撤销操作正确，不触发生图 |
| 图片身份 | 收藏删除／撤销／重收藏／刷新后的稳定编号 |

协议型号组合、参考编码、压缩归档、Bridge／Slate、备份失败恢复与 Photopea 具体分层行为保留为按需专题；新增业务才补必要用例。纯样式改动目视确认涉及页面，不因布局变化运行所有专题。

浏览器断言只覆盖业务操作、载荷、状态、IndexedDB 和图片／蒙版结果。**不锁死字号、圆角、阴影、动画、控件尺寸或间距，不做四档视口几何巡检。** 画笔／框选操作可以读取元素坐标，但验证的是实际蒙版和聚焦范围，不是 CSS。

测试使用合成图片和模拟接口，不执行真实收费生成。各测试服务器使用系统临时 Vite 缓存并在关闭时清理，不自动保存截图。`.local/` 仅保留轻量原型源稿及唯一历史恢复备份；旧截图、录屏、审计代码树和重复环境已清除，文字验收记录仍在[归档](docs/archive/README.md)。测试文件通过 `.gitattributes` 排除出 GitHub 语言占比，仍正常展示差异。

真实 Photopea 往返仍需显式运行 `KOMA_PHOTOPEA_LIVE=1 node --test tests/photopea-live.browser.mjs`；静态包核验先构建，再运行 `KOMA_PHOTOPEA_LIVE=1 KOMA_PHOTOPEA_ENGINES=chromium,edge node --test tests/photopea-compat.browser.mjs`。这些核验使用合成图片，默认不联网；Edge 须已安装，Playwright WebKit 不等同实际 Safari。

## 本地运行与发布

```sh
npm run build
npm start
```

打开 http://127.0.0.1:3218。可在浏览器配置连接，也可由独立可选的 `KOMA_GATEWAY_*`、`KOMA_ASK_OPENAI_*`、`KOMA_ASK_ANTHROPIC_*` 提供本地代理配置；Key 留在服务端。代理只监听回环地址。

`npm run package` 生成可解压运行的发布包。`dist/` 可独立静态托管；构建和 Git 推送均不会自动发布 Pages。推送仓库和部署 Pages 每次须用户明确授权，并先脱敏复查。使用、备份、更新、回退和发布步骤见[发布说明](docs/release-guide.md)。

## 文档与目录

从[产品总览](docs/product/overview.md)了解产品，从[文档索引](docs/README.md)按任务进入现行规范；[工程约定](AGENTS.md)保存稳定边界，[架构](docs/architecture.md)说明核心技术与模块，[设计语言](docs/product/design-language.md)说明界面取舍。旧阶段记录已退出必读入口，归档保留。

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
scripts/        字体构建、测试入口与发布打包
tests/          单元、浏览器与发布包验证
docs/           产品／工作区／集成／工程／ASK 规范与主题归档
```

源码公开与使用授权分开：当前许可证为 `UNLICENSED`，尚未授予开源许可。字体与图标各自保留[第三方许可](docs/third-party-assets.md)。公开前检查与凭据报告方式见[安全说明](SECURITY.md)。
