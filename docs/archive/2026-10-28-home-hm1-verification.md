# HOME HM1 数据基础核验

日期：2026-10-28。基于 `codex/ask-chat-handoff` 的本地工作区，HEAD 为 `a537b53`，本轮未提交、推送或发布。工作区还包含此前的 NAI／EDIT／Photopea 改动，本记录仅说明 HM1 范围。

## 范围与确认

用户确认启动 HM1；定稿文档对齐为标准行对齐、标准列对齐、拼图三种，保留已确认的页面规则。连接、模型与目录必须读取现有真实服务，ASK 与资源生命周期按正式应用的所有权接线，不复制静态演示脚本。

本轮完成数据基础与 CHAT 收藏，没有新增 HOME 路由或页面，没有调整 ASK 停靠、提示词、Photopea 生命周期，也没有改变生成报价与付费行为。页面与 ASK 仍分别属于 HM2／HM3。

## 实现

- `src/home/derive.ts` 从现有画板、历史、收藏、CHAT 和 Slate 成果推导创作线、封面、最近图片、来源与排序。输出身份和展示元数据，不把原图 Blob 放进 HOME 视图快照。
- `src/home/store.ts` 保存每画板一张长边不超过 1080px 的 WebP；注册数据维护 flush／reload，跨页旧结果不能覆盖新源图。封面指针、返回位置、三种排列偏好独立保存，画板删除与收藏取消会清理指针。替换、删除和销毁释放 Object URL。
- `src/home/service.ts` 在 App 中订阅真实服务；`chat.readStored()` 只读本机，不触发目录／报价／额度。生成状态使用发起时的画板／会话身份。
- CHAT 结果新增图标式收藏。复用普通收藏存储、取消和撤销；保留原图字节及会话／轮次／版本／资产来源。源会话删除后收藏仍可使用、备份与交付。新完成版本记录时间，旧轮次重试完成后可以成为最新封面；缺字段的旧记录按原顺序读取。
- EDIT 的手动、图生图、重绘与放大记录稳定 `editId`／`editParent`，CHAT 来源及 Slate 白名单同步保留。CHAT 及其纯手动修改没有绘图配方，参数导入和 ASK `restore_partial` 明确阻止误用。

## 核验

| 检查 | 结果与覆盖 |
| --- | --- |
| `npm run check` | 通过；字体、Stylelint、严格类型、325 项单元测试、生产构建。构建仍有已有的大包提示，不影响产物 |
| `node --test tests/home.browser.mjs` | 4 项通过；真实 IndexedDB／Web Locks／BroadcastChannel 与合成图片，覆盖缓存缩放、刷新、删除、封面回落、普通 ZIP 隔离、慢编码／跨页旧写、维护期间排队偏好、CHAT 收藏、手动 EDIT 与 Slate 来源、备份往返 |
| `tests/services.browser.mjs` | 6 项通过；新增数据库注册、数据锁、跨页连接、普通备份兼容等 |
| `tests/editor-return.browser.mjs` | 7 项通过；既有手动回传、蒙版、会话、保存和交付边界保持 |
| `tests/workspaces.browser.mjs` | 15 项通过；CHAT／EDIT 既有任务、会话、资源生命周期和四宽布局保持，新增收藏使工具数由 5 变为 6，旧数量断言已同步；补验图生图、重绘父图与 CHAT 放大来源 |
| 四宽界面 | 320／390／768／1440px 截图检查；收藏按钮、紧凑操作菜单与取消收藏可用，无水平溢出 |

HOME 新增 7 项单元测试覆盖封面优先级、空状态、CHAT 最近会话与旧轮次重试完成、Slate 归属排序、来源白名单、CHAT 配方隔离、三种偏好及响应式默认。展示副本不进入历史／ASK 编号／收藏／Slate 资产／普通 ZIP；刷新仍清空本页历史和画布。CHAT 收藏仍可拖给 ASK，仅绘图参数导入拒绝其非绘图配方。浏览器核验入口为 `npm run test:home`。

本地日志与合成截图在 `.local/hm1/`，不进入发布包。测试未使用用户原图、真实 Key 或收费生成；未执行真实 Photopea 编辑和新一轮供应商联调。真实浏览器长期使用及 HOME 页面视觉验收留在后续阶段。

## 文档同步

[HOME 规划](../koma-home.md)已记录 HM1 现状、三种排列与 HM2／HM3 接线约束；同步[当前状态](../implementation-plan.md)、[架构](../architecture.md)、[业务契约](../business-contracts.md)、[产品总览](../product-overview.md)、[对话与编辑](../chat-workspace.md)、[文档索引](../README.md)和 [ASK UI](../ask/ask-ui-spec.md)中的阶段说明。
