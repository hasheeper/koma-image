# Koma Image 发布包使用说明

包内 `dist/` 为独立静态站点，`server.mjs` 为可选本地服务。默认没有网关地址或 Key。生产静态站点为 [Koma Image](https://koma-image.pages.dev/)，通过 Cloudflare Pages Direct Upload 显式发布。

## 本机运行

安装 Node 26（验收版本为 26.8.2）。解压后进入发布包目录，无需安装 npm 依赖：

```sh
npm start
```

打开 http://127.0.0.1:3218。未设置环境变量时，在网页「设置 → 连接」中选择协议并填写 URL 和 Key，浏览器直接访问所填服务。标准网关或 ASK 推理服务不允许跨域时，可使用下面的本地代理模式；OpenAI Images、Gemini 原生和 NovelAI 官方目前仅支持浏览器直连。

## 本地代理

本地代理支持 Koma 标准网关、OpenAI Chat 和 Anthropic Messages。将 `.env.example` 复制为 `.env`，按需填写下表。每组 URL／Key 必须同时设置，三组独立可选；可只配置 ASK。所有组都留空时使用浏览器配置模式。URL 使用 HTTPS 或本机 HTTP，不附带查询参数或 Key。不要提交或分享 `.env`。

| 用途 | 环境变量 | URL 规则 |
| --- | --- | --- |
| 图像标准网关 | `KOMA_GATEWAY_URL`、`KOMA_GATEWAY_KEY` | 服务根地址，可带服务前缀，不附加 `/v1` |
| ASK OpenAI Chat | `KOMA_ASK_OPENAI_URL`、`KOMA_ASK_OPENAI_KEY` | 含版本路径的接口地址；只填根地址时补 `/v1` |
| ASK Anthropic Messages | `KOMA_ASK_ANTHROPIC_URL`、`KOMA_ASK_ANTHROPIC_KEY` | 服务根地址或 `/v1` 地址；版本前缀只拼接一次 |

```sh
cp .env.example .env
# 编辑 .env，填写连接 URL 与 Key
npm start
```

也可从进程环境注入同名变量。服务仅监听 `127.0.0.1`，不作为公网代理使用；网页只访问本机固定的协议路径。Key 在服务端添加，网页中的地址和 Key 显示为只读；图像模型来源仍可编辑，ASK 模型在「设置 → ASK」选择或手动填写。ASK 转发支持流式输出和停止，不自动重试。修改环境变量后重启服务并刷新页面。

可选 `KOMA_PORT` 默认 `3218`。可选 `KOMA_BASE_PATH` 默认 `/`；例如 `/app/`，此时打开 http://127.0.0.1:3218/app/。保持访问端口和主机名稳定，否则浏览器视为另一站点，已有图片和偏好不会自动出现。

## 静态托管

将 `dist/` 的内容放在 HTTPS 静态站点根目录或子目录即可。不要上传 `.env`；也不需要上传服务端文件。使用相对资源路径和 hash 路由，不要求服务器重写。

`skills/koma-bridge/SKILL.md` 是外部 Agent 可直接读取的公开说明。Pages 使用 `dist/_headers` 将该路径按 UTF-8 纯文本内联返回；其他静态托管需配置对应响应类型，本地 Node 服务已按纯文本提供。它不包含本机协同目录的状态或图片，也不提供远程文件读写权限。

静态版不读取服务端环境变量，不主动探测代理。用户必须在设置中配置连接和 Key，网关需要支持跨域访问。`chat.html`、`tags.html`、`transfer.html` 仅作导航重定向。

HOME、独立 EDIT、六项 Director Tools 与本地任务均随静态站发布。Director Tools 仍需用户配置 NovelAI 官方连接；线上部署不构成真实生成或计费验证。NAI token 计数所需的 `tokenizers/` 词表与许可必须随 `dist/` 一并上传，不向外部分词服务发送提示词。

EDIT 的「高级编辑」按需加载官方 Photopea，静态站同样可用，不依赖本地代理或目录挂载。需联网访问 `https://www.photopea.com`；若站点配置 CSP，`frame-src` 须显式允许该来源。保留应用的 iframe sandbox 与 origin 校验，不用放宽成任意来源。免费版自带品牌与广告；无法加载时可返回 Koma 原生编辑器，原图不变。Koma 不保存 PSD 或跨刷新恢复 Photopea 文档，离开前须应用回传或自行保存。

### 维护者发布

源码仓库为 `hasheeper/koma-image`，生产分支 `main`；Pages 项目名为 `koma-image`，上传目录由 `wrangler.jsonc` 固定为 `dist/`。Git 推送和站点发布是两步独立操作，不存在 Git 自动部署。

每次推送和部署前取得用户明确授权。在源码工程完成 `npm run check` 和相关浏览器验收，确认源码、提交历史与构建产物不含私有渠道标识或凭据后，推送生产分支，再执行 `npm run deploy:pages`。该命令使用固定版本 Wrangler 重新构建并上传静态目录；首次使用可执行 `npx --yes wrangler@4.151.1 login`。发布后核对生产域名实际加载的脚本及工作区导航。登录凭据保存在本机，不写入仓库。

## 数据、更新和回退

通过「设置 → 安全与备份」导出新版 Koma ZIP。备份包含图片收藏、NAI 参考资产／编码缓存、CHAT 对话、IMAGE 画板及偏好；排除 Key、普通历史、EDIT 现场／PSD、HOME 副本／偏好、Slate 任务／成果、Bridge 状态和交接数据；本地模式的模型来源可备份，但服务端 URL、Key 和会话令牌不导出。ASK 收藏会话及其附件单独保存在本机 `koma-ask`，刷新后可续聊，不包含在此 ZIP 中；撤销执行栈只保留本页。

更新前导出备份并保留旧发布包和独立的 `.env`。停止本地服务，解压新包，将 `.env` 放回后在相同端口启动。回退时使用先前兼容 Koma schema 的包，保持同源地址；不要清空或降级浏览器数据库。新版备份不提供旧应用格式转换，也不自动访问或清理旧数据。

## 校验与许可

归档旁的 `.sha256` 校验整个包，包内 `SHA256SUMS` 校验每个交付文件。`release.json` 记录版本、源码提交和构建环境。macOS 可运行：

```sh
shasum -a 256 -c koma-image-0.1.0.tar.gz.sha256
# 解压并进入目录后
shasum -a 256 -c SHA256SUMS
```

许可证尚未选定，当前为私有开发工程，`UNLICENSED` 不代表开源授权。第三方字体与图标许可已随 `dist/` 保留，见 `docs/third-party-assets.md`。
