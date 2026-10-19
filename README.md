# Koma Image

基于 Vue 3、TypeScript 和 Vite 的图片创作工作区。M1–M7 已完成实现、验收和发布，保留原界面及业务语义；支持静态托管和本地代理两种运行方式。P3（NovelAI 官方连接）已完成连接管理和 Profile 泛化，官方接入等待 Key 实测。

站点：[Koma Image](https://koma-image.pages.dev/)。源码仓库：[hasheeper/koma-image](https://github.com/hasheeper/koma-image)。

绘图／对话／词典在单页外壳中切换并保活，编辑为全屏覆盖层，设置包含备份与恢复。支持报价与串行生成、独立收藏、图片参数导入、对话上下文／附件、编辑／重绘／放大及新版 ZIP 备份。高频画布、蒙版和波浪由原生驱动管理。

连接可在「设置 → 连接」中添加、改名和删除，删除时一并清除 Key 和模型来源。Tag 自动补全与历史保留位于「设置 → 通用」，安全和备份操作集中在「安全与备份」。

可在浏览器中显式填写 URL／Key，也可使用本地 Node 代理，由环境变量提供连接。初始无默认上游地址；本地模式的地址和 Key 为只读，模型来源仍可编辑。

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

`check` 执行严格类型检查、单元测试及构建，输出为 `dist/`。预览使用 http://127.0.0.1:3217，不启用环境变量代理。

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
npm run test:local
npm run test:release
```

工作区地址为 `#/image`、`#/chat`、`#/tags`；`chat.html`、`tags.html`、`transfer.html` 仅重定向到同一应用并保留查询参数。测试截图输出到忽略提交的 `.local/`。当前 86 项自动化测试通过（50 项单元、36 项浏览器与发布包），覆盖四个基础视口及高频原生驱动的渲染／资源清理；基线范围见 [M7 验收记录](docs/release-acceptance.md)，此后新增项见 P3.0／P3.1 记录。所有网关测试使用合成数据，不执行真实收费请求。

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
- 业务通过 Koma Gateway Profile 访问服务，只按 Profile 声明的能力分支，初始 URL／Key 为空。私有渠道与中转只走中性的标准 Profile；公开官方 API（如 NovelAI 官方）可以有自己的 Profile，仍由用户添加连接和 Key。
- 前端构建不包含私有地址或凭据；本地环境变量不进入 `VITE_*`，运行时连接和令牌不写入浏览器存储或备份。
- 正式包仅使用 Koma 命名空间。旧数据迁移整条线已取消，不检测、读取或清理旧库；连接与 Key 重新配置。设置中的「备份与恢复」仅支持新版格式，不内置旧备份转换器。

## 规范与进度

- [架构规范](docs/architecture.md)
- [业务契约](docs/business-contracts.md)
- [实施阶段](docs/implementation-plan.md)
- [M1 外壳实现与验证](docs/app-shell.md)
- [M2 网关、数据与调度实现](docs/gateway-data-scheduler.md)
- [M3 设置、备份与词典实现](docs/shared-settings-tags.md)
- [M4 绘图工作区实现](docs/drawing-workspace.md)
- [M5／M6 对话与编辑工作区实现](docs/chat-editor-workspaces.md)
- [M7 本地代理与发布验收](docs/release-acceptance.md)
- [P3 NovelAI 官方连接](docs/novelai-official.md)：[P3.0 连接管理](docs/shared-settings-tags.md#p30-连接管理)、[P3.1 Profile 泛化](docs/gateway-data-scheduler.md#p31-profile-泛化)
- [发布包使用、更新与回退](docs/release-guide.md)
- [第三方资源](docs/third-party-assets.md)
- [协作约定](AGENTS.md)

依赖使用已核验的固定版本。许可证尚未选定，当前为私有开发工程，`UNLICENSED` 不代表开源授权；引入的第三方资源须保留其许可。
