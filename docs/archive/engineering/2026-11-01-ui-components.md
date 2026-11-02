# 公共 UI 与设置拆分验收

日期：2026-11-01。状态：本地实现与模拟验证完成，未推送、未部署。

基线：`main` 的 `59c757126888418e2168c7ad8fae8dded773e825`。按已确认顺序执行「画板菜单 → 菜单基础行为 → 设置页拆分 → 组件预览与归属整理」，沿用现有界面、CSS tokens、原生 popover／dialog 与业务写入路径。现行维护责任见[UI 维护](../../engineering/ui-maintenance.md#组件层级与开发预览)。

## 实现范围

- IMAGE／EDIT 两套画板呈现合并为 `shared/boards/BoardMenu.vue`；各工作区保留业务包装、删除／关闭确认、命名与任务限制。保留原 ID、行内重命名、列表滚动、嵌套 Escape 与焦点返回。
- `shared/ui/use-popover.ts` 收拢开闭、预定位、resize／scroll、Observer／rAF 和停用／卸载清理，消费者保留焦点策略。`PopoverMenu.vue` 提供通用操作菜单；`AskMenu.vue` 保留 ASK 关闭层。HOME／任务总览直接使用通用菜单，目录组件按所在区域选择包装。
- 设置外壳由约 1,080 行缩至 492 行；供应商表单、连接列表、连接菜单、目录读取分别拆分。表单保持 DOM Key 输入、地址／协议变更重输、暂存凭据与失败回滚；读取保持原目录与执行上下文分开失效、陈旧响应丢弃及局部刷新。
- 九个 NAI 公用组件移至 `shared/nai/`；IMAGE／EDIT 通过原注入端口继续持有各自数据。底部面板通过插槽接收参数，不再反向依赖 IMAGE 的参数实现。
- `/__ui` 提供开发预览：真实公共组件、主题、状态、两套画板实例与连接列表；示例仅在内存。正式引导代码移至 `app/bootstrap.ts`，生产构建裁掉预览分支，无新增依赖或产品导航。

## 检查结果

| 范围 | 结果 |
| --- | --- |
| `npm run check` | 严格类型通过；391 个 Node 单元测试通过；生产构建通过 |
| `npm run styles:check`、`fonts:check` | 通过；沿用公共 CSS 与字体生成入口 |
| `git diff --check` | 通过 |
| drawing 画板相关 | 2 项通过 |
| shared 设置／供应商／主题相关 | 5 项通过 |
| ask-settings | 4 项通过 |
| editor-workspace | 6 项通过，含新加的非活动板改名／关闭目标验证 |
| native-nai-models | 14 项通过 |
| bridge 任务菜单与清单删除、home-ui 交付 | 3 项通过 |
| ui-components | 2 项通过：无业务服务／外部请求／持久写入，以及嵌套 Escape、焦点、KeepAlive、唯一 ID 与同 tick 开闭 |
| shell | 4 项通过：正式构建、单外壳、生命周期、子路径与延迟设置加载 |
| ask-conversations、ask-debug | 18 项最终通过；下述旧断言更正后定向复验通过 |
| 生产产物 | JS／CSS 中未包含 `/__ui`、`UiPreview`、`ui-preview` 或 `/src/dev`；设置等业务面板仍按需加载 |

共覆盖 58 个相关浏览器用例（按上表选取，非全量浏览器测试）。构建仍报告主应用 chunk 超过 500 kB 的提示，本轮未调整拆包阈值或增加包体优化范围。

ASK 的「editor keys, Esc layers」原测试要求收起后 `.ask-draft` 节点数量为零。用系统临时目录中的基线源码独立运行，复现同一失败；当前草稿卡片通过 Teleport 持续挂载，Esc 的契约是收起并保留待确认草稿。测试改为验证 ASK 隐藏与草稿 fingerprint 不变，产品行为未为测试改变。

目视核对使用隔离 Chromium 与虚构数据，检查暗色桌面画板菜单、供应商配置，以及亮色 390px 预览／供应商／设置页面。临时图片检查后删除，不保存成功截图。不读取真实浏览器连接或图片，不进行真实收费生成；上述结果不代表真实供应商联调、移动真机或实际 Safari 验证。
