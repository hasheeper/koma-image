# Koma Image

基于 Vue 3、TypeScript 和 Vite 的图片创作工作区重构工程。

当前完成 M1 单页外壳：绘图／对话／词典原地切换并保活，编辑与设置为全局覆盖层宿主，备份入口已并入设置。原有样式、字体与图标已接入，默认头像为本地中性资源。

这仍是分阶段开发版本。工作区只有布局、草稿与空态；生成、报价、收藏持久化、词典查询、Key、Canvas 和备份读写尚未接入，相关按钮禁用。不能用于生产创作。下一步为 M2 的网关能力、Koma 数据层与调度器。

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

`check` 执行严格类型检查、路由单元检查与构建，输出为 `dist/`。预览使用 http://127.0.0.1:3217。当前没有自动部署或数据迁移命令。

外壳浏览器检查使用本地临时静态服务器，覆盖根路径和子路径；不连接上游。

```sh
npx playwright install chromium
npm run test:shell
```

工作区地址为 `#/image`、`#/chat`、`#/tags`；`chat.html`、`tags.html`、`transfer.html` 仅重定向到同一应用并保留查询参数。测试截图输出到忽略提交的 `.local/m1/`。

## 工程边界

- 复刻既有业务和 UI，按已批准范围调整工作区导航、默认头像、连接配置及数据命名。
- Vue 管理低频界面状态；高频绘制与图片资源交给原生驱动。
- 业务通过中性的 Koma Gateway Profile 接口访问服务，初始 URL／Key 为空。
- 前端构建不包含私有地址或凭据；`.env.example` 仅预留未来本地 Node 服务的配置名称，当前没有服务端实现。
- 正式包仅使用 Koma 命名空间。旧数据与旧备份由独立的同源过渡工程处理，不是本仓库的依赖。

## 规范与进度

- [架构规范](docs/architecture.md)
- [业务契约](docs/business-contracts.md)
- [实施阶段](docs/implementation-plan.md)
- [M1 外壳实现与验证](docs/app-shell.md)
- [协作约定](AGENTS.md)

依赖使用已核验的固定版本。许可证尚未选定，当前为私有开发工程，`UNLICENSED` 不代表开源授权；引入的第三方资源须保留其许可。
