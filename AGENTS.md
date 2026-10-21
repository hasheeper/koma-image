# Koma Image 工程约定

这是独立复刻工程。M1–M7 已完成单页外壳、共享服务、公共界面、绘图／对话／编辑、本地代理、只读设置、验收与发布包，并已发布到 koma-image Cloudflare Pages。已新增 OpenAI Images、Gemini 原生与 NovelAI 官方基础协议适配；供应商实测、NAI 官方重绘／放大和订阅优惠仍待核验，不能用模拟测试声称真实接入成功。推送 hasheeper/koma-image 和发布 Pages 每次需用户授权，并先通过脱敏复查。继续前阅读 docs/gateway-data-scheduler.md、docs/shared-settings-tags.md、docs/drawing-workspace.md、docs/chat-editor-workspaces.md、docs/release-acceptance.md、docs/novelai-official.md 与 docs/native-image-protocols.md 的接入约定和边界。已批准新子产品 Koma ASK（只读诊断，草稿为唯一写入出口），A0.1 推理协议与设置、A0.2 会话与抽屉已实现并模拟验证（见 `docs/ask/ask-a0.md`），A1 只读工具、视觉与经截图批准的 Ask／Ask Diff／Ask Why 入口已实现并通过合成图片与模拟服务验证（见 `docs/ask/ask-a1.md`）；用户本轮选择先用合成图片，真实图片黄金样例与供应商实测仍待办，A2 起未开发；开工前阅读 `docs/ask/` 下文档 1–4，冲突时以 `docs/ask/ask-implementation-plan.md` 为准。

- 先读 `docs/architecture.md`、`docs/business-contracts.md` 和 `docs/implementation-plan.md`。实际界面与业务基线位于内部参考工程，不能凭空设计或声称已验证。
- 复刻原有业务与 UI，已批准的调整包括导航、默认头像、渠道脱敏、存储命名、旧数据迁移功能裁撤，以及设置分组、样式统一、结果参数单行滚动、绘图空白页居中与品牌字（Fredoka），以及界面字体改用资源圆体。不得顺便修改报价、分流、额度阈值、取消和失败行为。ASK 是批准的新产品形态，不受复刻约束，但遵守本文全部工程约定；现有工作区只增加 ASK 入口与草稿写入路径。
- 唯一 App Shell；绘图／对话／词典用 KeepAlive，编辑为覆盖层，设置为弹窗，备份为设置子页。
- 设置分为连接、模型、通用、安全与备份及独立的 ASK 分组。Tag 自动补全和历史保留在通用中，沿用绘图服务的同一份偏好；安全、备份和配置导入导出合页，旧 backup 路由仍可访问。界面只保留基本信息与操作反馈，避免重复标题和大段说明。
- Vue 管低频状态和 DOM；原生驱动管 Canvas、指针与逐帧更新。大图片、DOM、数据库和密钥不进入深层 reactive。
- TypeScript 迁移 T0–T5 已完成，见 `docs/typescript-migration-plan.md`。`src/` 自有逻辑使用 TS／Vue TS，类型直接来自实现，不再新增 JS 与手写配对声明；测试、服务器、工具和静态兼容脚本保留原运行方式。不放宽 strict 或以忽略诊断代替边界收窄。
- Vue 节点不得由旧脚本包裹或搬移；高亮宿主写入模板，位置切换用 Teleport，监听器与 Observer 有对应清理。
- 字体族、字重、用途与预加载统一维护于 `config/fonts.json`，资源圆体范围位于 `config/font-ranges/koma-rounded.json`；`public/fonts/index.css` 为生成文件，不手改。普通构建复用既有 WOFF2，Python 仅用于主动离线重建。G0–G4 已完成，维护方式见 `docs/font-style-governance.md`、`docs/style-ownership.md` 与 `docs/style-checks.md`；变量／基础／控件／共享组合分层，组件私有规则回对应 Vue，保留已记录的全局结构与工作区覆盖。`npm run styles:check` 使用唯一 Stylelint 配置，已接入 `check`／CI；必要禁用指令须注明原因，不新增全局补丁。
- 使用中性的 Gateway Profile，无私有渠道名称、域名、头像、默认连接或品牌判断；未配置 URL／Key 不请求上游。公开官方 API（如 NovelAI 官方）属于协议适配，可以有自己的 Profile、固定官方地址和合法图标，仍由用户添加连接和 Key。兼容服务由用户显式选择其实际支持的标准网关、OpenAI Images 或 Gemini 原生协议；不内置私有地址，不按域名猜测或自动回退协议。业务按 Profile 声明的能力分支，无报价不等于免费；原标准网关的报价／max_cost／额度护栏保持。
- ASK 只新增 `openai-chat` 与 `anthropic-messages` 推理协议，按 Profile 能力过滤连接；不调用生图、编辑、放大、报价或扣费接口，不发送 CHAT 消息，不参与生成锁。模型能力由用户界定，不按名称拦截。保持技术与态度中立；成年语境与词表混淆仅在用户自行确认 R18 后启用，确认状态不进备份；未成年与 R18G 由代码排除表强制，不可编码。
- 只使用 Koma 存储与锁命名。用户已取消整条旧数据迁移线：不建迁移桥、转换器、迁移状态／锁、旧数据检测或清理流程及相关 UI；不作为待办或发布前置条件。普通「备份与恢复」只支持新版 Koma 格式；连接与 Key 重新配置。
- 不复制内部基线、Git 历史、截图、真实备份、部署配置、Key 或 Token；不把服务端秘密放入 VITE\_\*。
- 本地代理只监听回环地址，沿用标准 Profile 的固定路径；服务端 URL／Key 不注入浏览器。只读连接不持久化，本地模型来源单独保存；静态版不探测代理，默认不通信。发布使用显式文件清单，不复制 .env 或工作目录。
- 默认全应用并发为 1；不自动重试生成，不新增付费确认。自定义并发与额度预占只预留边界，不提前启用。
- 工作区通过应用级 runTask 执行任务；等待解码和结果处理完成后才退出回调。保存通过 data.write，延迟保存／缓存注册 flush 与 reload；不能绕过数据租约直接写数据库。
- 用模拟服务验证业务，不执行真实收费生成。UI 检查使用 320／390／768／1440px；高频只验证无组件重渲染和无资源泄漏，不另建性能跑分体系。
- 在 `codex/` 分支工作。构建不会自动发布；获授权的生产分支为 main，Pages Direct Upload 仅上传 dist/；不自动读取或清理旧应用数据。
- 当前检查命令为 `npm run check`；有新业务再添加对应的必要测试。依赖精确锁定并维护 package-lock.json。
