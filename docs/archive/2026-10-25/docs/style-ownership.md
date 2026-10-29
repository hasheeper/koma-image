> 历史归档 · 2026-10-25 整理前快照（源码基线 `f7a9c16`）。本文保留当时的设计、授权与验收范围，不作为现行规则或本次发布授权。现行入口见[文档索引](../../../README.md)。

# G2／G3：CSS 分层与样式归属

2026-10-20。本文记录 G2／G3 的本地实施与验收。前一阶段见[字体配置记录](font-style-governance.md)，后续 G4 已完成，检查与本轮 Git 交付见[收口记录](style-checks.md)。

本轮以 G1 完成后的本地工作区为基线，保留已有图片栏、启动连接反馈和 Tag 修复。只整理样式来源与加载边界，保持现有字体、颜色、尺寸、间距、断点、DOM 类名和交互；未调整业务、数据结构或原生高频驱动。

## G2：基础入口与级联

从原 `ui.css` 按连续顺序提取变量、基础规则和控件，保留原选择器、声明值与顺序。`index.html` 显式加载：

```text
fonts/index.css
→ styles/tokens.css → base.css → controls.css → ui.css
→ styles.css（image）→ chat.css → tags.css
→ editor.css → settings.css → transfer.css
→ Vite 输出的组件样式
```

`styles.css` 首行的重复 `@import "./ui.css"` 已删除；没有新增运行时导入链、级联层、预处理器或依赖。字体入口继续由 `config/fonts.json` 生成，字体资源与映射不变。

`presentation.ts` 及三个工作区 stylesheet 的 ID／media 开关保持不变：绘图启用 image，对话启用 chat，词典启用 image＋tags。词典仍需绘图样式中的原有顶栏与移动布局；本轮没有声称消除全部工作区依赖。

## G3：维护责任

| 负责文件 | 维护内容与边界 |
| --- | --- |
| `public/styles/tokens.css` | 全局色彩、尺寸、字重、间距、圆角、层级与动效变量；三个字体角色仍来自生成入口 |
| `public/styles/base.css` | reset、默认排版、表单继承、焦点、选区和滚动条 |
| `public/styles/controls.css` | 表单、按钮、图标、勾选、开关（`.switch`，宿主用 `--sw-w`／`--sw-h` 定尺寸）、分段、滑杆及共享 Tag 分类色点 |
| `public/styles/ui.css` | 跨工作区使用的顶栏、额度、组合布局、分栏、舞台／图片、图片栏／缩略图、结果操作组、加载、灯箱、通用弹窗与 sheet 宿主 |
| `public/styles/styles.css` | 绘图布局、画幅、参数导入、图片栏扩展及结果元数据；先放原公共元数据规则，再放绘图覆盖 |
| `public/styles/chat.css`／`tags.css` | 对话／词典布局与各自上下文；本轮未修改 |
| `public/styles/editor.css` | 编辑布局、画布、版本栏及词典背景下的版本栏宽度修正 |
| `public/styles/settings.css`／`transfer.css` | 设置与备份界面；持续加载。设置行统一为「文字列 + 一个控件或一组控件」：`.s-ctl` 控件组、`.s-field` 字段宽度（≤640px 换到文字下方）、`.s-toggle` 开关、`.s-block` 整行内容、`.s-meta` 标签加说明 |
| `src/shared/TagPicker.vue` | 选择器私有 scoped 规则、局部输入底色、加载动画与移动覆盖；通用 `.sheet` 外框仍由 ui 管理 |
| `src/shared/HighlightInput.vue` | 高亮宿主与镜像指标采用普通样式块，自动补全采用 scoped 样式块；详见下文 |
| `src/shared/ToastList.vue` | Toast 的 scoped 外观、动画、局部底色、移动布局及减少动效下的真实计时例外 |
| `src/shared/ConfirmSheet.vue` | 确认内容与脚注的 scoped 规则；通用 modal 框架仍由 ui 管理 |
| `src/workspaces/image/EmptyStage.vue` | 空白页的 scoped 布局与说明；品牌子组件的字形样式用明确的 `:deep()` 保留 |
| `src/ask/AskDrawer.vue` | ASK 五态透明容器、共享磨砂材质变量、胶囊基线、窗口及响应式边界；图标整数网格与呼吸归 `AskMark.vue`，紧凑草稿归 `DraftCard.vue`，输入与消息的透明底归各自组件；不改变工作区布局 |
| `src/ask/AskMarkdown.vue` | ASK 回复与提问的 Markdown 内容排版，标题层级、嵌套列表、引用、表格与代码块滚动；解析树到 Vue 节点的映射，不接管窗口和消息操作布局 |

组件私有规则已从原全局文件移出，不保留第二份副本。`ui.css` 从 G2 前的 94,293 字节减至 45,582 字节；这是职责转移，不是性能指标。

### 高亮、Teleport 与公共结构

- `.hl-wrap`、textarea 和镜像的指标保留原全局选择器，使绘图／对话／编辑的上下文高度与边框覆盖继续生效。组件仍由 Vue 创建节点，原生测量与滚动逻辑不变。
- `v-html` 生成的权重标记使用 `:where(.hl-mirror) .w`／`.w-mark`，限定在镜像中，同时保留原选择器权重。自动补全与其动画归组件，不再依赖绘图样式。
- 当前编辑器仅使用高亮输入，没有启用自动补全；本轮保持这一行为。共用同一组件不代表开启所有可选功能。
- Tag 选择器、自动补全和 Toast 的 scoped 属性随节点进入 Teleport 宿主；规则不依赖原工作区的父节点。Toast 仍可进入原生 dialog 的顶层，不改变层级或焦点行为。
- `.stage`／`.viewport`／`.print`、图片栏／缩略图、组合面板和 `.result-actions` 存在编辑或对话消费者，因此继续共享；仅图片结果的元数据、参数、Seed 和关联容器查询归入绘图 CSS。

### 编辑版本栏的继承边界

原 `src/app/shell.css` 已删除，唯一导入同时移除。词典上的编辑器宽度修正归入 `editor.css`，只设置编辑器自己的 `--editor-rail`，不再覆盖词典继承的 `--hist`。

保留原来的 132px／窄屏 112px 宽度及实际断点。修正规则放在 `.editor[data-rail="off"]` 之前，确保主动折叠仍优先；词典自身的 `--hist: 0px` 保持原义。

## 验证与证据

基线、截图、源文件快照与日志仅保存于忽略提交的 `.local/css-governance/g23/`，不进入发布包。全部使用合成图片和模拟接口，没有执行收费请求。

- `npm run check` 通过：字体一致性、严格类型检查、52 项单元测试与生产构建。
- Shell 6 项、共享界面 13 项、绘图 8 项、对话／编辑 11 项、发布包 1 项通过；连同单元测试，本轮共 **91 项**。这是本轮执行范围，服务与本地代理专用浏览器套件未重复执行。
- 基础视口为 320／390／768／1440px。绘图、对话、词典、编辑、设置五个代表性界面的计算字体、布局、关键字形宽度与加载的 36 个字体文件集合和基线一致，无运行时或资源错误。
- 选择器、高亮／自动补全、确认／Toast 的桌面与手机六个状态，计算外观与布局和基线一致；倒计时条的当前长度随时间变化，比较其样式与时长而不固定截图时刻。
- 新增回归覆盖共享 Tag 控件在 image CSS 关闭时的外观、从对话／词典打开编辑器的高亮对齐、版本栏折叠／恢复，以及 dialog 内 Toast 在减少动效下的实际关闭时长。
- 五个迁入样式的 Vue 组件，其脚本与模板内容和基线相同；`presentation.ts`、对话／词典／设置／备份样式未改。domain、gateway、native、storage 未产生差异。
- 复用现有四视口、根路径／子路径、Teleport、指针事件不触发 Vue 重渲染、反复开关释放监听与资源的回归，不增加像素矩阵或帧率跑分。

后续修改应回到上表负责处，先核对消费者与覆盖顺序。G4 已[接入 Stylelint 与轻量检查](style-checks.md)；表中列明的全局结构和上下文覆盖继续保留，不要求全部改成 scoped。


2026-10-23 多角色／画板新增样式归属：胶囊与下拉在 `BoardSwitcher.vue`；角色折叠列表、文本页签和放大定位栏在 `CharactersEditor.vue`；定位板与点位在 `CharacterPosition.vue`。历史归属圆点留在 `ImageLibrary.vue`，角色草稿合并和新画板应用入口留在 `DraftCard.vue`。全部复用站内 tokens 与现有高亮输入，不新增全局覆盖。

同日 AI 命名的共用星光／停止按钮与状态动效由 `src/shared/AiNameButton.vue` 的 scoped 样式负责；画板胶囊内的位置归 `BoardSwitcher.vue`，ASK 标题与手动改名行归 `AskConversations.vue`。命名模型设置复用现有设置行与模型列表；减少动效时停止脉动，不新增全局规则。
