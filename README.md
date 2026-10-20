# Koma Image

基于 Vue 3、TypeScript 和 Vite 的图片创作工作区。M1–M7 已完成实现、验收和发布，保留原界面及业务语义；支持静态托管和本地代理两种运行方式。支持 OpenAI Images、Gemini 原生与 NovelAI 官方基础适配，已用模拟接口验证，真实供应商联调尚未完成。

站点：[Koma Image](https://koma-image.pages.dev/)。源码仓库：[hasheeper/koma-image](https://github.com/hasheeper/koma-image)。

绘图／对话／词典在单页外壳中切换并保活，编辑为全屏覆盖层，设置包含备份与恢复。支持报价与串行生成、独立收藏、图片参数导入、对话上下文／附件、编辑／重绘／放大及新版 ZIP 备份。高频画布、蒙版和波浪由原生驱动管理。

连接可在「设置 → 连接」中添加、改名和删除，删除时一并清除 Key 和模型来源。Tag 自动补全与历史保留位于「设置 → 通用」，安全和备份操作集中在「安全与备份」。

可在浏览器中显式填写 URL／Key，也可使用本地 Node 代理，由环境变量提供连接。初始无默认上游地址；本地模式的地址和 Key 为只读，模型来源仍可编辑。

## 连接协议

在「设置 → 连接 → 添加连接」中选择实际接口协议。已有连接也可修改协议，修改后重建其模型映射；不会按连接名称或域名自动猜测。

| 协议 | 当前用途 | 地址填写 |
| --- | --- | --- |
| Koma 标准网关 | 原生图、对话、编辑、报价与额度保护 | 支持标准聚合协议的服务根地址 |
| OpenAI Images | 对话页生图与参考图修改 | 接口根地址或以 `/v1` 结尾的地址，保留服务前缀 |
| Gemini 原生 | 对话页生图与参考图修改 | 接口根地址或以 `/v1beta` 结尾的地址，保留服务前缀 |
| NovelAI 官方 · 基础接入 | 绘图、图生图、Anlas 查询 | 选择后固定为官方图片地址；单独填写对应 Key |

原生接口没有预报价时显示“费用未知”，不套用标准网关的积分或免费额度。NAI 官方重绘／放大尚未开放。浏览器直连需服务允许 CORS；环境变量本地代理本轮仍只支持标准网关。完整范围与联调边界见[原生图像协议](docs/native-image-protocols.md)。

## 本地开发

使用 Node 26.8.2 与 npm 11.19.1；具体版本记录在 `.nvmrc` 和 `package.json`。

```sh
npm ci
npm run dev
```

开发地址为 http://127.0.0.1:3216，端口占用时直接报错，不自动占用其他站点的端口。

```sh
npm run check
npm run preview
```

`check` 执行字体一致性、CSS／Vue 样式检查、严格类型检查、单元测试及构建，输出为 `dist/`。预览使用 http://127.0.0.1:3217，不启用环境变量代理。

字体由 `config/fonts.json` 集中配置，Unicode 分片独立保存，统一 CSS 自动生成。`dev`／`build` 会先生成声明，`check` 会核对生成文件与预加载清单；修改字体配置后可运行 `npm run fonts:build`。普通构建继续复用已有 WOFF2，无需 Python 或原始 TTF。详见[字体维护与验证](docs/font-style-governance.md)。

公共 CSS 按变量、基础、控件和共享组合分层，组件私有细节归对应 Vue 样式块，工作区仍按原 media 开关加载。维护入口、覆盖关系与保留的全局依赖见[样式归属](docs/style-ownership.md)。

单独检查手写样式运行 `npm run styles:check`；本地与 CI 使用同一 Stylelint 配置，不强制重排现有 CSS。必要的优先级例外及检查依赖限制见[G4 检查说明](docs/style-checks.md)。

## 本地运行与发布包

```sh
npm run build
# 可选：复制并编辑 .env.example 为 .env，填写 KOMA_GATEWAY_URL 与 KOMA_GATEWAY_KEY
npm start
```

打开 http://127.0.0.1:3218。两项环境变量都为空时使用浏览器配置模式；都填写后启用同源本地代理。Key 保留在服务端，网页只显示只读状态。服务只监听本机回环地址。

```sh
npm run package
```

发布包及校验文件位于 `.local/releases/`，解压后用 Node 26 执行 `npm start` 即可，无需安装依赖。`dist/` 也可独立放到 HTTPS 静态站点根路径或子路径。详见 [使用、更新与回退说明](docs/release-guide.md)。打包不会推送或部署，发布包不含 `.env`。

## Cloudflare Pages

现有 `koma-image` 项目使用 Direct Upload，生产分支为 `main`。GitHub 推送不会自动发布站点；`wrangler.jsonc` 将上传范围限定为 `dist/`。

```sh
npm run check
# 首次使用或授权过期时登录
npx --yes wrangler@4.151.1 login
npm run deploy:pages
```

发布命令先构建再上传静态文件，不上传本地服务器、环境变量或用户数据。静态版需在设置中填写连接 URL 和 Key。

## 验证

外壳浏览器检查使用本地临时静态服务器，覆盖根路径和子路径；不连接上游。

```sh
npx playwright install chromium
npm run test:shell
npm run test:services
npm run test:shared
npm run test:drawing
npm run test:workspaces
npm run test:native
npm run test:local
npm run test:release
```

工作区地址为 `#/image`、`#/chat`、`#/tags`；`chat.html`、`tags.html`、`transfer.html` 仅重定向到同一应用并保留查询参数。测试截图输出到忽略提交的 `.local/`。G4 收口本地验收通过 99 项检查（52 项单元、47 项浏览器与发布包），覆盖四个基础视口及高频原生驱动的渲染／资源清理，具体执行范围见[检查收口记录](docs/style-checks.md)。业务与发布基线见 [M7 验收记录](docs/release-acceptance.md)。所有网关测试使用合成数据，不执行真实收费请求。

## 目录

```text
src/          应用源码，分层见架构规范「目录结构」
public/       静态资源、样式与旧地址重定向页
server.mjs    可选本地服务与固定协议代理
scripts/      发布包脚本
tests/        单元、浏览器与发布包测试
docs/         规范、实施记录与发布说明
```

## 工程边界

- 复刻既有业务和 UI，按已批准范围调整工作区导航、默认头像、连接配置及数据命名。
- Vue 管理低频界面状态；高频绘制与图片资源交给原生驱动。
- 业务通过 Gateway Profile 访问服务，初始 URL／Key 为空。用户显式选择标准网关、OpenAI Images、Gemini 原生或 NovelAI 官方协议；兼容服务不内置私有名称或地址，不按域名判断或自动回退。原标准网关的报价与额度保护保持。
- 前端构建不包含私有地址或凭据；本地环境变量不进入 `VITE_*`，运行时连接和令牌不写入浏览器存储或备份。
- 正式包仅使用 Koma 命名空间。旧数据迁移整条线已取消，不检测、读取或清理旧库；连接与 Key 重新配置。设置中的「备份与恢复」仅支持新版格式，不内置旧备份转换器。

## 规范与进度

- [架构规范](docs/architecture.md)
- [业务契约](docs/business-contracts.md)
- [实施阶段](docs/implementation-plan.md)
- [主要模块 TypeScript 迁移与验收](docs/typescript-migration-plan.md)：T0–T5 已完成，九个应用模块纳入严格类型检查；108 项全量测试、脱敏与发布包验证通过
- [字体与 CSS 治理计划](docs/css-governance-plan.md)：G0–G4 已完成本地验收，见[字体维护](docs/font-style-governance.md)、[样式归属](docs/style-ownership.md)与[检查收口](docs/style-checks.md)
- [M1 外壳实现与验证](docs/app-shell.md)
- [M2 网关、数据与调度实现](docs/gateway-data-scheduler.md)
- [M3 设置、备份与词典实现](docs/shared-settings-tags.md)
- [M4 绘图工作区实现](docs/drawing-workspace.md)
- [M5／M6 对话与编辑工作区实现](docs/chat-editor-workspaces.md)
- [M7 本地代理与发布验收](docs/release-acceptance.md)
- [P3 NovelAI 官方连接](docs/novelai-official.md)：[P3.0 连接管理](docs/shared-settings-tags.md#p30-连接管理)、[P3.1 Profile 泛化](docs/gateway-data-scheduler.md#p31-profile-泛化)
- [原生图像协议接入](docs/native-image-protocols.md)：OpenAI Images、Gemini 原生、NAI 官方基础适配及实测边界
- [发布包使用、更新与回退](docs/release-guide.md)
- [第三方资源](docs/third-party-assets.md)
- [协作约定](AGENTS.md)

依赖使用已核验的固定版本。许可证尚未选定，当前为私有开发工程，`UNLICENSED` 不代表开源授权；引入的第三方资源须保留其许可。
