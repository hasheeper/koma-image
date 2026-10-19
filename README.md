# Koma Image

基于 Vue 3、TypeScript 和 Vite 的图片创作工作区。M1–M7 已完成本地实现和验收，保留原界面及业务语义；此次交付本地发布包，暂不部署。

绘图／对话／词典在单页外壳中切换并保活，编辑为全屏覆盖层，设置包含备份与恢复。支持报价与串行生成、独立收藏、图片参数导入、对话上下文／附件、编辑／重绘／放大及新版 ZIP 备份。高频画布、蒙版和波浪由原生驱动管理。

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

工作区地址为 `#/image`、`#/chat`、`#/tags`；`chat.html`、`tags.html`、`transfer.html` 仅重定向到同一应用并保留查询参数。测试截图输出到忽略提交的 `.local/`。本次 77 项自动化测试通过，覆盖四个基础视口及高频原生驱动的渲染／资源清理；具体范围见 [M7 验收记录](docs/release-acceptance.md)。所有网关测试使用合成数据，不执行真实收费请求。

## 工程边界

- 复刻既有业务和 UI，按已批准范围调整工作区导航、默认头像、连接配置及数据命名。
- Vue 管理低频界面状态；高频绘制与图片资源交给原生驱动。
- 业务通过中性的 Koma Gateway Profile 接口访问服务，初始 URL／Key 为空。
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
- [第三方资源](docs/third-party-assets.md)
- [协作约定](AGENTS.md)

依赖使用已核验的固定版本。许可证尚未选定，当前为私有开发工程，`UNLICENSED` 不代表开源授权；引入的第三方资源须保留其许可。
