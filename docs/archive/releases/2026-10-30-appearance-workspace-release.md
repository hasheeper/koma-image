# 外观与工作区发布核验

日期：2026-10-30。范围为本次实际提交和部署；本地模拟与静态发布不证明真实供应商生成、扣费或提示词质量。

## 交付范围

- 暗／亮语义变量及共享材质；默认暗色，IMAGE／CHAT 顶栏和手机侧栏提供暗色／系统／亮色菜单，与通用设置共用偏好、首屏恢复和跨标签同步。
- IMAGE 结果栏与右侧面板使用相同底板，参数与操作轻微分层；Photopea 新实例按当前外观使用 White／Dark Blue，保活分层文档不因外观切换重建。
- 手机图片侧栏整理与 EDIT 可选全屏画布；不改变图像、蒙版和工作区保活。
- ASK 任务清单移除关联、删除及状态修改经草稿确认／撤销；补齐清单删除后的会话关联清理。
- 上下文默认压缩阈值 220,000 tokens，保留自定义值；统计分项与调用调试整理；四份 NAI 专项手册及索引同步。

现行行为维护在[设置](../../workspaces/settings-and-tags.md)、[样式维护](../../engineering/ui-maintenance.md)、[EDIT](../../workspaces/edit.md)及 [ASK 入口](../../ask/README.md)，本记录不复制实现契约。

## 检查

- `npm run check`：严格类型、391 项纯逻辑测试及构建通过。
- `npm run styles:check` 通过；没有新增样式或像素几何断言。
- CI 核心冒烟 5 条通过；按本次功能选出的 8 条行为测试通过，覆盖主题持久化／同步、任务删除／撤销、上下文阈值／调用调试、手机全屏保留蒙版。
- 应用提交的 [GitHub Actions Check](https://github.com/hasheeper/koma-image/actions/runs/41028890232) 已完成并通过。
- 本地目视确认主题菜单、手机侧栏及结果栏；官方 Photopea 使用合成图确认 White 主题。未执行真实收费生成。
- Gitleaks 检查全部 Git 引用、当前源码及 `dist/`，未发现泄漏；新增内容未发现个人绝对路径、邮箱或私有地址，提交身份使用 noreply。
- Markdown 本地链接检查及 `git diff --check` 通过；测试临时服务器缓存用后清理，没有增加仓库截图或审计副本。

## Git 与 Pages

- 应用提交：[ce0f528](https://github.com/hasheeper/koma-image/commit/ce0f52836a24df82c440c32c8cef417671e57ced)，已推送唯一生产分支 `main`；本记录作为后续纯文档提交，不改变应用构建。
- 使用固定版本 Wrangler Direct Upload，仅上传 `dist/`；部署地址：[7e1fc8c0.koma-image.pages.dev](https://7e1fc8c0.koma-image.pages.dev/)。
- 生产域名：[koma-image.pages.dev](https://koma-image.pages.dev/)。27 个入口、脚本、样式、图标、技能说明和许可文件与本地构建 SHA-256 一致；入口脚本为 `assets/index-D936sQWm.js`。
- 实际生产页面可打开 IMAGE，并显示暗色外观入口；空连接不会发起上游生成。外部技能仍通过公开路径提供。
