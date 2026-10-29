# HOME、EDIT 与 NAI 更新发布核验

日期：2026-10-28。用户明确授权本轮文档整理、Git 推送与 Cloudflare Pages 发布。基线为 `a537b53` 后在本会话确认的 HOME、独立 EDIT、Photopea、NAI 编辑与 Director Tools 更新；不延伸为今后的发布授权。

## 文档与实现对齐

- 现行入口统一为产品总览、架构、业务契约、设计语言与当前状态；HOME、CHAT、EDIT、Photopea、NAI 和 ASK／Bridge 各自维护专题，旧计划及阶段证据归入历史索引。
- README 与发布说明补齐独立编辑画板、Enhance／Max、普通／聚焦重绘、六项 Director Tools、去背景三种结果、输入计数词表及对应验证入口。
- 保留真实验证边界：本地模拟不代表实际生成效果或扣费；V5 参考、自动引号提取、V4.5 质量入口调整、EDIT 专用 ASK／Bridge 和跨刷新 PSD 恢复仍未开放。
- 复核并清理个人本机路径，保留有效的工程相对链接与路由示例。源码和静态产物的凭据、私有地址与额外文件检查未发现需发布的敏感内容；原型、日志、真实配置及 `.local/` 不纳入提交或上传。

## 发布前验证

全部使用隔离浏览器、合成图片和模拟上游，不向真实账户执行生成或工具请求。

- `npm run check`：字体、Stylelint、严格类型、367 项单元测试与生产构建通过，保留已有的大 chunk 提示。
- 扩展浏览器与发布包检查涵盖 Shell、服务、共享控件、绘图、ASK、Bridge、HOME、Photopea、本地代理、静态分词器和发布包，共 206 项。首次 202 项通过；另外四项为旧断言，修正后各自定向复测通过：HOME 已读取本地 CHAT 索引、Guidance 保留 7.3、IMAGE 收藏测试显式进入 IMAGE、EDIT 待处理状态随独立页面返回 HOME。
- Director Tools 六项浏览器回归通过，新增保持面板打开并连续切换 320／390／768／1440px 的检查。核验发现费用／字体或视口改变后固有宽度面板可能越界，已补尺寸观察及关闭清理，复测通过。
- 此前相同业务实现的原生协议、EDIT 画板、结果回流与工作区共 72 项通过，范围见[Director Tools 核验](2026-10-28-director-tools-verification.md)。本轮没有用这些数字代替实际供应商联调。
- 静态产物核对主 JS／CSS、Worker、两套词表及许可、公开 Skill；隔离页面检查五个工作区、设置、token 计数与工具入口，未执行收费操作。

完整日志、脱敏扫描和截图保存在本机 `.local/release-2026-10-28/`，不进入仓库或 Pages。113 份项目文档的本地文件链接检查通过。

## Git 与 Pages

- 应用及文档提交：[8c32b73](https://github.com/hasheeper/koma-image/commit/8c32b73c84d3385ebb9bc41464685fcdd02afe17)，已推送至 `main` 和 `codex/ask-chat-handoff`。首次 HTTPS 推送遇到 HTTP 400，确认两分支仍在旧提交后，使用本次命令的 HTTP/1.1 与缓冲设置完成正常快进，没有强推。
- 执行 `npm run deploy:pages`，Wrangler 4.151.1 重新构建后仅上传 `dist/` 至既有 `koma-image` 项目，生产分支 `main`。部署地址：[0fc880ec.koma-image.pages.dev](https://0fc880ec.koma-image.pages.dev/)，生产域名：[koma-image.pages.dev](https://koma-image.pages.dev/)。
- 生产首页引用 `index-CgkSvfhQ.js` 与 `index-DiP0r8d3.css`，实际下载的字节 SHA-256 与本地产物一致；分词器 Worker、T5／Qwen 词表及三份许可／来源说明同样一致。
- [公开 Skill](https://koma-image.pages.dev/skills/koma-bridge/SKILL.md) 返回 200、`text/plain; charset=utf-8` 与 `Content-Disposition: inline`，内容与发布文件一致。
- 独立 Chromium 上核对 HOME／IMAGE／CHAT／EDIT／TAGS、现有设置页、V4.5 token 计数与六项工具入口；HOME 和保持打开的 Director 面板检查 320／390／768／1440px。使用合成图片与模拟账户响应，无页面异常、无真实生图或工具 POST。

本记录随后作为纯文档提交补回仓库，不改变已部署的应用产物。线上检查没有读取用户现有页面、密钥、图片或 Photopea 文档；真实 NAI 效果与扣费、实际 Safari 和移动真机仍按[待办](../implementation-plan.md#仍待真实验证)单独核验。
