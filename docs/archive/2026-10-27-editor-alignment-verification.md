# EDIT 与 NAI 控件对齐核验

日期：2026-10-27。基于 `codex/ask-chat-handoff`、HEAD `a537b53` 上的本地未提交工作区，包含前一轮 Guidance／Rescale 统一修改。以下均为合成图片和模拟供应商验证，不代表线上已发布或真实生成、扣费成功。

## 本轮范围

- EDIT 继承原始正负词、模式、Complexity、质量／负向预设、透明底、完整角色与参考配置；绘图和编辑共用预设编译。
- 显式执行时确定随机 Seed；请求、编辑版本及绘图历史使用同一实际值，保留 Seed 0。
- 角色增删、排序、启停、词文与定位复用绘图控件，稳定 ID 不因删除复用；定位浮层归编辑 dialog。
- 模型区移至提示词上方，参数与参考使用共享底部抽屉；独立控件 ID、会话写入所有者、Esc 层级和移动端底部空间。
- 官方 V4.5 img2img 参考接入现有原图／编码缓存、全局任务槽、费用下限与固定来源约束。编码失败、取消及 Key 变化不导致自动重试或换源。

## 实际检查

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 字体检查、Stylelint、严格 TS、297 个单元测试及构建通过；构建仍有已有的大 chunk 提示 |
| `node --test --test-name-pattern='NAI\|NovelAI\|EDIT ' tests/native-protocols.browser.mjs` | 26 个浏览器测试通过，包含本轮新增的 5 个 EDIT 用例与共享绘图控件、参考缓存／备份回归 |
| `node --test --test-name-pattern='M6' tests/workspaces.browser.mjs` | 5 个浏览器测试通过，覆盖蒙版源尺寸／EXIF、版本淘汰、CHAT 归属、放大隔离、长词高亮、原生高频驱动与覆盖层资源清理 |
| `git diff --check` | 通过 |

新增用例覆盖官方／标准网关的词文与预设往返、实际随机 Seed／0、角色启停与坐标、本地历史复用、官方不提供 Medium 编辑而中转仅按已声明能力提供、High 控件值保留、两组参考与编码缓存、操作不兼容拦截、低余额、编码失败、取消、Key 变化、迟到上传的会话隔离，以及 320／390／768／1440px 下的控件、抽屉和菜单。

本地截图位于 `.local/native-protocols/editor-aligned-*`、`editor-vibe-drawer-*` 和 `editor-rescale-*`。检查了 320／390px 参考抽屉、1440px 主表单与角色区、390／1440px 参数抽屉，未见横向溢出；这批截图不进入发布包。

## 保持的边界

未执行真实收费生成，未推送 Git 或部署 Pages。官方 Medium img2img、蒙版重绘／Focused Inpainting、Upscale 与独立工具未因此开放；V5 的 Vibe／Precise 仍不开放。真实参考效果、消费和供应商兼容仍按 NAI 专题核验。
