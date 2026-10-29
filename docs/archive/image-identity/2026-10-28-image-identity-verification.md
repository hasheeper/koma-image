# 全局图片身份 ID1–ID4 本地验收

日期：2026-10-28。基线为 `codex/ask-chat-handoff` 的 `611e1d8` 及本轮已有未提交修改。用户授权实施 ID1–ID4；现行规则见[图片身份与引用](../../engineering/image-identity.md)，设计背景见[已批准规划](2026-10-28-image-identity-plan.md)。未推送或部署，未使用真实 Key 或执行收费生成。

## 实现范围

| 阶段 | 本轮结果 |
| --- | --- |
| ID1 | 原图文件字节 SHA-256 实体；原有记录保留各自参数及血统；收藏库 schema v3、固定 `favSeq`、最小登记与库身份；现有 Koma 字段补齐及 Koma v2 备份合并 |
| ID2 | 本页单调 `#h`、持久 `#f`、EDIT 完整码／本板简写／去背景字母组、CHAT 字母码与旧数字别名；逐轮及历史引用冻结到具体记录；EDIT 结果不自动进入 IMAGE 历史 |
| ID3 | 实体视觉缓存与全图资格共享，同轮重复请求去重；EDIT 只读状态和检索；Bridge 引用格式与作用域；EDIT 直接交付 Slate，保留 HOME 原有记录指针 |
| ID4 | IMAGE／HOME／EDIT 角标与完整码复制；ASK `#` 紧凑候选和键盘／IME 边界；相关回归及现行文档同步 |

既有 HOME 样式及透明棋盘等未提交修改继续保留。本轮不改生成费用、路由、任务槽、付费行为或 Photopea 工作栈；不开放 EDIT 内 ASK 窗口、EDIT 参数草稿、编辑跨刷新恢复或 PSD 持久化。

## 检查结果

| 检查 | 结果 | 本机日志 |
| --- | --- | --- |
| `npm run check` | 375 项单元测试通过；字体、样式、严格类型及生产构建通过 | `.local/id-check-final.log` |
| 图片身份浏览器专项 | 10 项通过 | `.local/id-identity-final.log` |
| 存储、绘图、EDIT、Director Tools、回传 | 40 项通过 | `.local/id-workspaces-final.log` |
| Photopea 宿主模拟、外壳、发布包 | 13 项通过，1 项真实 Photopea 兼容检查按环境开关跳过 | `.local/id-lifecycle-final.log` |
| ASK、Bridge、共享 UI、HOME、CHAT 与原生协议首次完整回归 | 229 项中 223 项通过，6 项发现见下文；受影响范围另行补验 | `.local/id-regressions-final.log` |
| Bridge 与原生协议完整补验 | 67 项通过，首次发现项均已修正并通过，无剩余失败 | `.local/id-bridge-native-final.log` |
| ASK 视觉工具／附件补验 | 6 项通过 | `.local/id-ask-vision-final.log` |

浏览器套件命令：

```sh
node --test tests/image-identity.browser.mjs
node --test --test-concurrency=1 tests/services.browser.mjs tests/editor-workspace.browser.mjs tests/director-tools.browser.mjs tests/editor-return.browser.mjs tests/drawing.browser.mjs
node --test --test-concurrency=1 tests/photopea.browser.mjs tests/photopea-compat.browser.mjs tests/shell.browser.mjs tests/release.package.mjs
node --test --test-concurrency=1 tests/ask.browser.mjs tests/bridge.browser.mjs tests/shared.browser.mjs tests/home.browser.mjs tests/home-ui.browser.mjs tests/home-ask.browser.mjs tests/workspaces.browser.mjs tests/native-protocols.browser.mjs
node --test --test-concurrency=1 tests/bridge.browser.mjs tests/native-protocols.browser.mjs
node --test --test-name-pattern='ASK A1 S1|ASK A1 S2|ASK A1 crop failure|ASK A1 Anthropic|ASK W5: .*attachments reach' tests/ask.browser.mjs
```

首次完整回归中的 5 项旧断言仍要求重复像素计量或 EDIT 结果更新 IMAGE 当前图；按新契约改为不同像素的共享预算检查及 EDIT 原记录参数检查，并增加 IMAGE 历史不变断言。另 1 项余额失败测试在模拟充值后未等待刷新，依赖请求时序，现显式等待已有刷新入口。补齐 `read_ref` 与拼图重复读取的「本轮已查看」及结构化反馈，保持原预算上限。源代码最终修订后重新执行 `npm run check`，重跑受影响的 Bridge／原生协议完整套件及 ASK 视觉路径；图片身份专项也补验拼图重复请求不再次发图。

最终 `git diff --check` 通过；34 份现行文档、身份规划／验收归档、历史索引及公开技能的本地链接路径检查没有缺失。测试与构建不授予推送或部署权限。

## 关键断言

- 收藏删除中间项不移动后续编号，8 秒撤销保号，真正重新收藏用新号，删空及刷新不重置库身份和计数器。多标签页同时写不同记录分号唯一，同一记录并发收藏只保留一个有效号。
- 现有 Koma 收藏补齐保留有效固定号，优先使用无歧义的旧 ASK 映射；存在歧义时分配新号，重复初始化保持幂等。没有引入旧应用库检测或迁移。
- 新空库从备份继承原库身份／固定号；异库合并保留本地号并分配新增号；重复导入幂等。同字节但不同参数的冲突记录保留独立副本，CHAT 冲突分支与收藏来源、父记录及血统一起重映射。
- EDIT 两板短码、完整码、同组默认选择及具体变体分别冻结；旧引用保留原板和记录，不能被另一板同号图补位。原始版本受保护，去背景三图成组淘汰，物理容量与逻辑编号分开。
- `#h → #e → #f` 的原图共享实体与原记录；EDIT 位置信息不写进原记录配方。`get_meta` 仍能区分同实体的两个生成事件，Slate 绑定不会误用另一份参数。
- 看过原图后可用其收藏／EDIT 别名 crop；同轮同规格重复查看不再发图或扣视觉预算，升级规格、新 crop、显式重新查看及跨轮查看仍正常计量。跨 ASK 会话和仅元数据状态不借用查看资格，原有每轮 4 次、1.5MP、400KB 上限保持。
- CHAT 新字母码与旧数字尾段兼容；保存的引用保留原分支／轮次／版本／资产身份，收藏别名合并、取消收藏或切分支后不能错误定位。回复、草稿、候选、账本、压缩和归档保留绑定。
- Bridge v2 图片引用分别校验页面／收藏库；旧页 `#h/#e`、错库 `#f` 拒绝。EDIT 简写同时检查接收当刻活动板，不能利用旧 `base_hash` 快照绕过切板检查，完整码可跨板引用。旧无标记草稿保留保守检查。
- EDIT 原图及衍生图可直接保存为独立 Slate 成果，无需先注册 `#h` 或收藏；HOME 封面继续按创作线／记录绑定，预览缓存没有原图身份。

## UI 与资源

图片候选与 EDIT 编号均检查 320／390／768／1440px；候选支持方向键、Enter／Tab 插入与 Esc 关闭，插入不发送；中文组字及 Shift+Enter 不被抢占。非法编号前缀、额外点号段和句末标点通过共享语法检查。

本机截图为 `.local/image-identity/picker-{320,390,768,1440}.png` 及 `.local/edit-workspace/identity-{320,390,768,1440}.png`。390px 候选与 EDIT 版本栏、1440px 页面已目视检查；测试另外检查边界与溢出。外壳与 ASK 生命周期回归覆盖反复激活、拖动不触发组件重渲染和监听清理。

## 验证边界

仅使用合成图片、浏览器本地存储、模拟图像／推理服务和测试文件系统。发布包测试检查允许清单、校验和、解包运行及 root／subpath，并未发布到 Pages。

`tests/photopea-compat.browser.mjs` 的真实 Photopea 检查要求 `KOMA_PHOTOPEA_LIVE=1`，本轮未启用；宿主模拟通过不能代替真实第三方长时编辑或实际 Safari／移动真机验证。真实供应商视觉质量、缓存命中、生成效果、扣费、目录重启恢复及线上版本仍按[当前待办](../../status.md#仍待真实验证)独立核验。

## 旧链路清理复核

在 ID1–ID4 完成后继续按运行时调用点复核，删除以下残留：

- `ConversationScope.ids` 的分配与恢复，以及编号表的 `restore()`。ASK 只用一套本页编号表；收藏 ASK 的旧标签快照仅用于历史绑定恢复，不再预占或改写新页编号。
- 收藏编号表中按时间排序、根据内存表补号及保留已取消收藏登记的逻辑。实时编号必须来自持久 `favSeq`；缺号、非法号及重号明确拒绝，停用登记由收藏存储独占维护。
- 无运行时调用方的 `drawing.addExternal()` 外部入库入口。合成图片初始化移至测试夹具；真实 IMAGE 生成仍通过 `runTask → consumeImage → addImage` 发布，编辑版本留在 EDIT。补验正常 IMAGE 完成事件与 HOME 预览均指向真实生成记录。
- 测试夹具中废弃的编辑板作用域字段，以及 ASK 工具说明／Schema 漏写 `#e` 的旧文案。工作区提示词升为 v21，统一检索、CHAT 参考交接和 Slate 绑图可用编号；CHAT 示例优先字母尾缀。

保留的兼容读取限于当前 Koma 的旧 CHAT 数字尾段、已保存 ASK 引用、已有收藏身份补齐、Koma v2 备份可选字段与无版本标记 Bridge 的保守校验。这些路径不恢复会话级实时编号表；收藏补齐与备份合并仍由持久事务管理编号，不恢复旧应用数据库，也不将 EDIT 结果送入 IMAGE 历史。

清理后的验证：

| 检查 | 最终覆盖结果 | 本机日志 |
| --- | --- | --- |
| `npm run check` | 字体／样式／严格类型、376 项单测及生产构建通过 | `.local/id-cleanup-check-final.log` |
| 图片身份、IMAGE、HOME 数据与布局 | 38 项用例覆盖；初次 37 项通过，收藏夹具修正后受影响用例及真实生成发布共 2 项复测通过 | `.local/id-cleanup-browser.log`、`.local/id-cleanup-drawing-final.log` |
| ASK、Bridge、HOME ASK 与工作区 | 160 项用例覆盖；初次 159 项通过，热更新打断的一项交互测试在代码稳定后单独复测通过 | `.local/id-cleanup-flows.log`、`.local/id-cleanup-island-final.log` |
| CHAT 交接 | 6 项通过，既有用例补验 EDIT 简写／完整码去重后仍绑定同一记录 | `.local/id-cleanup-chat-final.log` |

初次浏览器失败分别为：旧夹具复制收藏记录时也复制了 `favSeq`，触发新重号校验；验收期间源代码热更新打断 ASK 状态过渡。前者改用正式 `assignFavorite` 事务，后者在源代码稳定后复测，均已通过。未通过放宽编号校验或恢复旧入库接口绕过问题。

最终 `git diff --check` 通过；清理涉及的 4 份文档本地链接无缺失。生产源代码与构建产物不含 `addExternal`／测试夹具入口，ASK 仅创建一次实时编号表。本次只作本地修改和验证，没有提交、推送或部署。
