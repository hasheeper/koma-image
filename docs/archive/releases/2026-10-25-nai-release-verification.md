# NAI 适配发布与线上页面核验

日期：2026-10-25。发布源码提交为 `786e8f456b3fbbd2fd10371ee65f164fbe0f14f4`（`Add NovelAI controls, reference workflow and provider priorities`），已推送至 `hasheeper/koma-image` 的 `main`。本次记录已经完成的发布，不构成后续推送或部署授权。现行能力与待办见[NAI 官方接入](../../integrations/novelai.md)和[当前状态](../../status.md)。

生产站点：[koma-image.pages.dev](https://koma-image.pages.dev/)。Pages Direct Upload 回执：[53575fbf.koma-image.pages.dev](https://53575fbf.koma-image.pages.dev)。只上传 `dist/`，构建与 Git 推送各自不触发自动发布。

## 发布范围

- NAI V4.5／V5 型号与模式、Effort／Complexity／质量及负向预设、Guidance Rescale、账户额度与供应商优先级。
- V4.5 官方 Vibe／Precise 参考链路、编码缓存、文件与备份往返，以及已确认的统一底部抽屉。
- V5 单入口参数凹槽，提示词底栏边缘遮挡与原生高度手柄；绘图／编辑按钮隐藏未知费用标签，内部仍保留未知状态，标准网关有效报价保持。
- V4.5 质量入口仍在 Prompt 底栏；本次没有将其移入参数抽屉。

## 本地检查与脱敏复查

- `npm run check` 通过：字体一致性、Stylelint、严格类型、267 项单元测试及生产构建。
- 浏览器与发布包套件按 `--test-concurrency=1` 顺序执行，181 项通过、0 失败。运行范围：`tests/native-protocols.browser.mjs`、`tests/drawing.browser.mjs`、`tests/services.browser.mjs`、`tests/shared.browser.mjs`、`tests/ask.browser.mjs`、`tests/shell.browser.mjs`、`tests/release.package.mjs`。该数字只表示本次所列范围，不作为仓库全部测试总数。
- 发布前扫描 660 个源码文件及 336 个构建文件，未发现待发布凭据或私有连接信息；上传内容不包含 `.env`、聊天 Key、真实备份及本机数据。
- 本地过程证据保留在忽略目录：`.local/release-nai-check.log`、`.local/release-nai-browsers.log`、`.local/release-nai-audit.json`、`.local/release-nai-pages.log`。这些文件不进入发布包。

## 生产页面核验

生产页面引用的主 JS／CSS 与本机构建逐字节 SHA-256 一致：

| 资源 | SHA-256 |
| --- | --- |
| `/assets/index-vvWj64cZ.js` | `cbcf9b5d3e10cdb0ff93b60b46a22a78b092b73a1e040ff0ffe7ef7fac1624ee` |
| `/assets/index-BszDhDoL.css` | `9d33f008c99889b304eae9042182b3436a95b350685f4d59a978ed8f619edb3f` |

生产冒烟使用隔离浏览器、合成连接及模拟订阅响应，检查 320／390／768／1440px 布局、未知费用标签隐藏、V4.5 参考抽屉和 IMAGE／CHAT／TAGS 导航。证据为 `.local/release-production-smoke.json`、`.local/release-production-smoke.log` 及 `.local/production-smoke/nai-{width}.png`，截图不进入仓库或发布包。

本次没有执行真实 NAI 生成或编码。生产资源一致和页面操作通过，仅证明该构建已上线、对应界面可以运行；真实生成效果、参考编码／缓存命中、账户优惠和实际扣费仍未验证。
