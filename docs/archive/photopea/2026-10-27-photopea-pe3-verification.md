# Photopea PE3：界面与静态包兼容收口

日期：2026-10-27。范围：`codex/ask-chat-handoff` 中 PE1／PE2 基础上的界面收口；macOS 14.8.7。代码与本地静态包验收完成，未推送或发布。所有图片均为合成 PNG，未读取用户图片、配置供应商或执行收费生成。

## 本轮实现

- 保持已确认的最大化 iframe、紧凑顶栏和单一「应用并返回」组合按钮，未增加外围面板或常驻说明。320／390／768／1440px 检查最长「图像与选区」标签、品牌、按钮和菜单边界；窄屏继续给画布让位。
- Photopea 就绪后聚焦 iframe；打开回传菜单时聚焦当前选项。修正原先菜单展开后焦点仍停在触发按钮、方向键无法进入的问题，补齐触发按钮的上下键与菜单 Home／End、Enter、Esc 操作。
- 就绪期间注册 `beforeunload`，用于浏览器允许时的刷新／关页提醒；应用或退出时清理。Koma 内返回／重新载入仍使用现有放弃确认，不推断 Photopea 的脏状态，不承诺跨刷新恢复 PSD。
- 增加显式联网的生产静态包交互套件 `tests/photopea-compat.browser.mjs`，默认跳过，开启后默认只运行 Chromium，可指定 Edge／WebKit。通过文件选择器上传合成图，再使用真实 Photopea 工具输入；不通过 Vue 服务注入图片或伪造编辑结果。

## 验证结果

| 检查 | 结果与边界 |
| --- | --- |
| `npm run check` | 字体、Stylelint、严格类型、315 项单元测试与生产构建通过；仍有既有大 chunk 提示 |
| `tests/photopea.browser.mjs` + `tests/editor-return.browser.mjs` + `tests/release.package.mjs` | 9 项通过；含回传、取消、来源、发布包白名单／校验和／根路径与子路径 |
| Photopea 宿主新增断言后补验 | 3 项通过：四宽、iframe 焦点、键盘菜单、离页监听器及反复开关后的清理；离页检查验证注册与取消，不声称所有浏览器都会显示系统确认框 |
| Chromium 151.0.7922.34 + 真实 Photopea + `dist/` | 四宽、键盘、鼠标矩形选区、图像与选区回传、入口焦点恢复、手动结果直入 IMAGE 历史通过；页面无脚本异常 |
| Microsoft Edge 156.0.4314.42 + 真实 Photopea + `dist/` | 同上；使用本机实际 Edge 二进制的隔离无头会话，未接触用户浏览器数据 |
| Chromium 触摸模拟 | 通过触摸事件选择画笔并点画，回传后逐像素确认与输入图不同；不等同手机／平板真机验收 |
| 发布说明更新后 | 发布包套件再验 1 项通过；文档包含 Photopea 联网、CSP frame 来源与未保存文档边界 |

真实交互命令（先构建）：

```sh
npm run build
KOMA_PHOTOPEA_LIVE=1 KOMA_PHOTOPEA_ENGINES=chromium,edge node --test tests/photopea-compat.browser.mjs
```

触摸初次验证失败是测试定位错误：Photopea 画笔光标另用一个小 Canvas，不能用「最后一个 Canvas」当作编辑画布。改为定位最大可见画布后，触摸笔触、真实像素变化和回历史断言全部通过。产品代码没有依赖这个 DOM 定位；正式集成仍只用公开消息／脚本协议。

合成截图及构建日志位于被 Git 忽略的 `.local/pe3/`，不进入源码与发布包。

## 尚未计入通过的环境

- **WebKit 测试环境不可用**：Playwright 在本机提供的 macOS 14 冻结构建可以启动浏览器、创建 context，但创建空白页即挂起。独立的无站点探针在 `browserContext.newPage` 超时，与 Koma 和 Photopea 无关；实际站点用例也未完成。不能据此判断 Safari 产品兼容性，实际 Safari 仍待验。
- **移动真机与复杂工具**：本轮覆盖浏览器触摸模拟和实际鼠标选区；未覆盖手机／平板、长时间液化／修复、复杂图层混合模式及弱网大图。现有原生蒙版仍可用；第三方工具体验不视为 Koma 已全面验收。
- **Pages 线上版本**：只读检查生产站响应未发现拦截 Photopea iframe 的 CSP／Permissions-Policy；这不证明线上已包含当前实现。发布包已通过本地静态服务验证，线上脚本与真实 iframe 往返待取得本次发布授权后核验。

本地实现收口不构成新的推送或发布授权，遵守 `AGENTS.md`。当前行为见[编辑工作区](../../workspaces/edit.md)，范围与阶段见[接入规划](../../integrations/photopea.md)。
