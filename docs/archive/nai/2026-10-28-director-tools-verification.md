# Director Tools 接入与界面核验

日期：2026-10-28。基线为独立 EDIT、普通／聚焦重绘、Enhance／Max、原生／外部放大与 Photopea 工作栈。范围为用户确认的六项 Director Tools，以及按更新预览应用画布工具栏和放大面板。未推送或部署，未使用真实 Key 或执行收费调用。

## 依据与界面

- 用户指定预览：`http://127.0.0.1:3216/.local/dt-ui/preview.html?bar=a&pick=strip&open=tools`，实现以 `.local/dt-ui/` 当时的 toolbar A、底部 strip 为准；原型不进入发布包。
- 官方 [Director Tools](https://docs.novelai.net/en/image/directortools)、[接口 Schema](https://image.novelai.net/docs/doc.json)及当日公开客户端。公开客户端的 `augmentImage`、工具费用与尺寸处理位于本机 `.local/nai-parameter-audit-2026-10-28/chunks/` 只读审计材料；不复制厂商客户端实现。
- 重绘／放大使用图标分体入口，与魔棒组成一个不拆分的操作组，其后只有一条分隔线。Desktop 为 32px 主操作与 14px 箭头，窄屏为 40px／18px；保留原类型菜单与操作语义。
- Director 紧凑面板在工具栏上方 6px，底部六项图标加名称，窄屏横向滚动；上色和表情的参数向上展开。放大复用同一材质与动作行。NovelAI Upscale 在预览和主应用均使用 `--sans`、600 字重。

## 实现与边界

六项请求为 `POST /ai/augment-image`，`req_type` 分别为 `bg-removal`、`lineart`、`sketch`、`colorize`、`emotion`、`declutter`。JSON 只发送工具所需字段；表情使用 `emotion;;extraPrompt` 和反向强弱的 defry 0–5，不带生图型号、Seed、CFG、采样器、蒙版、参考或 max_cost。

工具独立使用当前查看版本与画板设置。按官方客户端做约 1MP 下限／3MP 上限的等比例准备，不按 64 像素对齐；Canvas 高质量插值不宣称与厂商 Lanczos 逐像素一致。费用按 V3／28 步规则，去背景为三张基础费加 5 Anlas；不使用 V5 百分比抵扣。面板与任务的顶栏显示实际官方来源、订阅和 Anlas。

所有返回图片先完整解包与解码。去背景的 `image_0.png`／`image_1.png`／`image_2.png` 按身份映射抠图／重建／混合，成员顺序可变；三张结果归同组，切换不再请求。透明通道保留；分组删除／淘汰释放全部 URL，底图及查看组受到保护。无效数量、尺寸组、失败占位图或解码错误不写部分版本。

执行沿用应用级任务槽、提交前选源／余额检查，明确不足才顺位到另一个官方来源；标准网关不能冒充此协议，取消与失败不重试。冻结来源版本与所属画板，结果不抢占当前查看图；解码及历史处理完成才退出任务。结果保存实际工具参数、尺寸和来源配方，不伪造 Seed；IMAGE／上传来源入历史，CHAT 仍显式回传，收藏与 Slate 延续原路径。

现行维护入口为 [NAI](../../integrations/novelai.md#director-tools)、[EDIT](../../workspaces/edit.md#director-tools)与[样式归属](../../engineering/ui-maintenance.md)。Pixel Snap 不在本轮六项工具范围；真实生成质量、实际扣费、实际 Safari 与移动真机仍待核验。

## 本地验证

仅使用合成图片、隔离浏览器和模拟上游，阻止其他外部请求：

- `npm run check`：字体一致性、Stylelint、严格类型、367 项单元测试及生产构建通过；保留既有大 chunk 提示。
- `node --test tests/director-tools.browser.mjs`：6 项通过。覆盖六项请求、24 种表情的界面选择、强度、官方选源／不足顺位、独立 Anlas 顶栏、标准网关禁用、异常／取消不重试、跨板归属与任意来源尺寸。
- `node --test --test-concurrency=1 tests/native-protocols.browser.mjs tests/editor-workspace.browser.mjs tests/editor-return.browser.mjs tests/workspaces.browser.mjs`：72 项通过，包含既有编辑、放大、参考编码、Enhance／Max、聚焦重绘、任务与来源回流。
- 去背景覆盖打乱 ZIP 成员顺序、三种稳定版本切换、透明像素、来源配方与原 Seed、历史条数、分组 URL 释放，切换不增加 POST。
- 320／390／768／1440px 检查面板与类型菜单处于视口内、工具选择／Esc／焦点、放大模型与统一字体；本机截图已查看。
- `git diff --check` 与本轮现行文档的本地链接检查通过。未推送或部署。

检查日志与四宽截图保存在 `.local/director-tools-verification/`，不进入源码或发布包。真实 API 效果与账单不能用本记录中的模拟通过替代。
