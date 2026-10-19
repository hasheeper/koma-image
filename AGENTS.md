# Koma Image 工程约定

这是独立复刻工程。M1–M7 已完成单页外壳、共享服务、公共界面、绘图／对话／编辑、本地代理、只读设置、验收与发布包，并已发布到 koma-image Cloudflare Pages。P3（NovelAI 官方连接）已完成 P3.0 连接管理与 P3.1 Profile 泛化，P3.2 起等待 NovelAI Key。推送 hasheeper/koma-image 和发布 Pages 每次需用户授权，并先通过脱敏复查。继续前阅读 docs/gateway-data-scheduler.md、docs/shared-settings-tags.md、docs/drawing-workspace.md、docs/chat-editor-workspaces.md、docs/release-acceptance.md 与 docs/novelai-official.md 的接入约定和边界。

- 先读 `docs/architecture.md`、`docs/business-contracts.md` 和 `docs/implementation-plan.md`。实际界面与业务基线位于内部参考工程，不能凭空设计或声称已验证。
- 复刻原有业务与 UI，已批准的调整包括导航、默认头像、渠道脱敏、存储命名、旧数据迁移功能裁撤，以及设置分组、样式统一、结果参数单行滚动、绘图空白页居中与品牌字（Fredoka），以及界面字体改用资源圆体。不得顺便修改报价、分流、额度阈值、取消和失败行为。
- 唯一 App Shell；绘图／对话／词典用 KeepAlive，编辑为覆盖层，设置为弹窗，备份为设置子页。
- 设置分为连接、模型、通用、安全与备份。Tag 自动补全和历史保留在通用中，沿用绘图服务的同一份偏好；安全、备份和配置导入导出合页，旧 backup 路由仍可访问。界面只保留基本信息与操作反馈，避免重复标题和大段说明。
- Vue 管低频状态和 DOM；原生驱动管 Canvas、指针与逐帧更新。大图片、DOM、数据库和密钥不进入深层 reactive。
- Vue 节点不得由旧脚本包裹或搬移；高亮宿主写入模板，位置切换用 Teleport，监听器与 Observer 有对应清理。
- 使用中性的 Gateway Profile，无私有渠道名称、域名、头像、默认连接或品牌判断；未配置 URL／Key 不请求上游。公开官方 API（如 NovelAI 官方）属于协议适配，可以有自己的 Profile、固定官方地址和合法图标，仍由用户添加连接和 Key；私有渠道与中转只走中性的标准 Profile。业务按 Profile 声明的能力分支，不按连接名称或地址判断。
- 只使用 Koma 存储与锁命名。用户已取消整条旧数据迁移线：不建迁移桥、转换器、迁移状态／锁、旧数据检测或清理流程及相关 UI；不作为待办或发布前置条件。普通「备份与恢复」只支持新版 Koma 格式；连接与 Key 重新配置。
- 不复制内部基线、Git 历史、截图、真实备份、部署配置、Key 或 Token；不把服务端秘密放入 VITE\_\*。
- 本地代理只监听回环地址，沿用标准 Profile 的固定路径；服务端 URL／Key 不注入浏览器。只读连接不持久化，本地模型来源单独保存；静态版不探测代理，默认不通信。发布使用显式文件清单，不复制 .env 或工作目录。
- 默认全应用并发为 1；不自动重试生成，不新增付费确认。自定义并发与额度预占只预留边界，不提前启用。
- 工作区通过应用级 runTask 执行任务；等待解码和结果处理完成后才退出回调。保存通过 data.write，延迟保存／缓存注册 flush 与 reload；不能绕过数据租约直接写数据库。
- 用模拟服务验证业务，不执行真实收费生成。UI 检查使用 320／390／768／1440px；高频只验证无组件重渲染和无资源泄漏，不另建性能跑分体系。
- 在 `codex/` 分支工作。构建不会自动发布；获授权的生产分支为 main，Pages Direct Upload 仅上传 dist/；不自动读取或清理旧应用数据。
- 当前检查命令为 `npm run check`；有新业务再添加对应的必要测试。依赖精确锁定并维护 package-lock.json。
