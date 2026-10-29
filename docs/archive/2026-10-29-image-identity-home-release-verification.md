# 图片身份与 HOME 空状态发布核验

日期：2026-10-29。用户明确授权将本会话确认的图片身份重构与 HOME 空状态提交至 Git 并更新 Cloudflare Pages；授权仅适用于本次发布。基线为 `611e1d8`，现行契约见[图片身份](../image-identity.md)及[HOME](../koma-home.md)。

## 发布范围

- ID1–ID4：原图实体与记录分离、固定收藏号、EDIT 完整码与当前板简写、同组字母尾缀、逐轮冻结引用、实体视觉缓存共享，以及备份／Bridge／Slate／HOME 对齐。EDIT 结果不自动进入 IMAGE 历史。旧实时编号与外部入库残留已清理，兼容读取边界见[本地验收](2026-10-28-image-identity-verification.md)。
- HOME：数据就绪后才判断空状态，使用五格交错图形、文案「这里还空着呢」「有个想法？快去试试吧。」及整页中央柔光。卡片采用较浅的 `--chrome` 纯色底，背景粘贴图片进入 EDIT，ASK／输入框粘贴沿用原有附件行为。
- 更新现行产品、架构、业务、设计与专题文档。ASK 提示词版本核对为 `c12.w21.m6.k8`；公开外部协同 Skill 同步图片编号与作用域。

静态试稿、截图、日志和本机配置保留在忽略目录，不提交或上传。源码与构建产物已检查凭据、本机路径、额外文件和符号链接，未发现待发布敏感内容。

## 发布前验证

全部使用合成图片、隔离浏览器、本地存储和模拟服务，没有使用真实 Key 或执行收费生成。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 字体、Stylelint、严格类型、376 项单测及生产构建通过；保留已有大 chunk 提示 |
| 图片身份、HOME、HOME ASK、EDIT 画板 | 31 项浏览器检查通过 |
| Shell 与发布包 | 7 项检查通过，包含允许清单、校验和、解包服务及 root／subpath |
| ASK 与 Bridge | 136 项完整回归通过，无失败或跳过 |

本机日志、脱敏报告与截图位于 `.local/release-2026-10-29/`，不进入仓库或 Pages。117 份项目文档的本地文件链接检查通过，`git diff --check` 通过；源码与构建扫描无发现。

## Git 与 Pages

- 应用及文档提交：[daaa438](https://github.com/hasheeper/koma-image/commit/daaa438c26f05a3434fa4e2866a4614444576435)，正常快进推送至 `main` 与 `codex/ask-chat-handoff`，没有强推。
- 执行 `npm run deploy:pages`，Wrangler 4.151.1 重新构建后仅上传 `dist/` 至既有 `koma-image` 项目，生产分支 `main`。部署地址：[3a52ddc9.koma-image.pages.dev](https://3a52ddc9.koma-image.pages.dev/)，生产域名：[koma-image.pages.dev](https://koma-image.pages.dev/)。Git 推送与 Direct Upload 分别完成。
- 生产首页引用 `index-DMpua3Gq.js` 与 `index-Cq1tMrah.css`，实际下载的字节 SHA-256 与本地构建一致；分词器 Worker、T5／Qwen 词表及三份许可／来源说明同样一致。
- [公开 Skill](https://koma-image.pages.dev/skills/koma-bridge/SKILL.md) 返回 200、`text/plain; charset=utf-8` 与 `Content-Disposition: inline`，字节与本地发布文件一致。
- 使用全新隔离 Chromium，不配置连接或 Key：核对 HOME／IMAGE／CHAT／EDIT／TAGS 和现有设置页、ASK 开合且无重复实例；HOME 空状态在 320／390／768／1440px 无横向溢出，五格图形为 80px，品牌居中，卡片底色为 `rgb(24, 24, 28)`。390px 与 1440px 截图已目视检查。
- 通过 HOME 原生文件入口载入合成 PNG，进入 EDIT 后初始版标识为 `#e1`，返回 HOME 后显示继续入口并收起空状态。生产检查无页面异常、无站外请求、无模型或生成调用。

本记录与现状文档随后以纯文档提交补回仓库，不改变已部署的应用产物。

## 验证边界

本次静态站发布和本地模拟不代表真实供应商图片效果、缓存命中或扣费验证。实际 Safari／移动真机、Photopea 复杂分层长时使用与目录重启恢复继续按[当前待办](../implementation-plan.md#仍待真实验证)独立核验。
