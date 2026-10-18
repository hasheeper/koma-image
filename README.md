# Koma Image

基于 Vue 3、TypeScript 和 Vite 的图片创作工作区重构工程。

当前为工程准备阶段：构建骨架、架构约束、业务契约和默认头像已建立。页面仅显示开发占位，不代表最终 UI。绘图、对话、词典、编辑、设置、Gateway 服务及数据迁移均尚未实现。

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

`check` 执行严格类型检查与构建，输出为 `dist/`。预览使用 http://127.0.0.1:3217。当前没有生成、自动部署或数据迁移命令。

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
- [协作约定](AGENTS.md)

依赖使用已核验的固定版本。许可证尚未选定，当前为私有开发工程，`UNLICENSED` 不代表开源授权；引入的第三方资源须保留其许可。
