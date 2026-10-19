# Koma Image 工程约定

这是独立复刻工程。M1–M6 已实现单页外壳、共享服务、公共界面、绘图、对话与编辑工作区；下一阶段 M7 是本地环境变量代理、只读设置和发布前验收。继续前阅读 docs/gateway-data-scheduler.md、docs/shared-settings-tags.md、docs/drawing-workspace.md 与 docs/chat-editor-workspaces.md 的接入约定和边界。

- 先读 `docs/architecture.md`、`docs/business-contracts.md` 和 `docs/implementation-plan.md`。实际界面与业务基线位于内部参考工程，不能凭空设计或声称已验证。
- 复刻原有业务与 UI，只执行已批准的导航、默认头像、渠道脱敏、存储命名和旧数据迁移功能裁撤。不得顺便修改报价、分流、额度阈值、取消和失败行为。
- 唯一 App Shell；绘图／对话／词典用 KeepAlive，编辑为覆盖层，设置为弹窗，备份为设置子页。
- Vue 管低频状态和 DOM；原生驱动管 Canvas、指针与逐帧更新。大图片、DOM、数据库和密钥不进入深层 reactive。
- Vue 节点不得由旧脚本包裹或搬移；高亮宿主写入模板，位置切换用 Teleport，监听器与 Observer 有对应清理。
- 使用中性的 Gateway Profile，无私有渠道名称、域名、头像、默认连接或品牌判断；未配置 URL／Key 不请求上游。
- 只使用 Koma 存储与锁命名。用户已取消整条旧数据迁移线：不建迁移桥、转换器、迁移状态／锁、旧数据检测或清理流程及相关 UI；不作为待办或发布前置条件。普通「备份与恢复」只支持新版 Koma 格式；连接与 Key 重新配置。
- 不复制内部基线、Git 历史、截图、真实备份、部署配置、Key 或 Token；不把服务端秘密放入 VITE\_\*。
- 默认全应用并发为 1；不自动重试生成，不新增付费确认。自定义并发与额度预占只预留边界，不提前启用。
- 工作区通过应用级 runTask 执行任务；等待解码和结果处理完成后才退出回调。保存通过 data.write，延迟保存／缓存注册 flush 与 reload；不能绕过数据租约直接写数据库。
- 用模拟服务验证业务，不执行真实收费生成。UI 检查使用 320／390／768／1440px；高频只验证无组件重渲染和无资源泄漏，不另建性能跑分体系。
- 在 `codex/` 分支工作。发布按实施阶段进行，不随构建命令触发；不自动读取或清理旧应用数据。
- 当前检查命令为 `npm run check`；有新业务再添加对应的必要测试。依赖精确锁定并维护 package-lock.json。
