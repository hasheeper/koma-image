# 样式加载与维护归属

更新：2026-10-29。维护现行级联与组件责任；G0–G4 过程、大小对比和验收见[归档](archive/2026-10-25/README.md)。视觉标准见[设计语言](design-language.md)，检查规则集中在本文[样式检查](#样式检查)。

## 基础入口与级联

变量、基础规则和控件分层加载，保持选择器和级联顺序。`index.html` 显式加载：

```text
fonts/index.css
→ styles/tokens.css → base.css → controls.css → ui.css
→ styles.css（image）→ chat.css → tags.css
→ editor.css → settings.css → transfer.css
→ Vite 输出的组件样式
```

`styles.css` 首行的重复 `@import "./ui.css"` 已删除；没有新增运行时导入链、级联层、预处理器或依赖。字体入口继续由 `config/fonts.json` 生成，字体资源与映射不变。

`presentation.ts` 及三个工作区 stylesheet 的 ID／media 开关保持不变：绘图启用 image，对话启用 chat，词典启用 image＋tags。HOME 不启用这三个工作区样式，仅使用公共 tokens／控件和 `src/home/*.vue` 的 scoped 样式。词典仍需绘图样式中的原有顶栏与移动布局；这些工作区依赖仍然保留。

## 维护责任

| 负责文件 | 维护内容与边界 |
| --- | --- |
| `public/styles/tokens.css` | 全局色彩、尺寸、字重、间距、圆角、层级与动效变量；三个字体角色仍来自生成入口 |
| `public/styles/base.css` | reset、默认排版、表单继承、焦点、选区和滚动条 |
| `public/styles/controls.css` | 表单、按钮、图标、勾选、开关（`.switch`，宿主用 `--sw-w`／`--sw-h` 定尺寸）、分段、滑杆、共享菜单（`.menu`／`.menu-item`）及共享 Tag 分类色点 |
| `public/styles/ui.css` | 跨工作区使用的顶栏、额度、组合布局、分栏、舞台／图片、图片栏／缩略图、结果操作组、加载、灯箱、通用弹窗与 sheet 宿主 |
| `public/styles/styles.css` | 绘图布局、画幅、参数导入、图片栏扩展及结果元数据；先放原公共元数据规则，再放绘图覆盖 |
| `public/styles/chat.css`／`tags.css` | 对话／词典布局与各自上下文；按各工作区加载 |
| `public/styles/editor.css` | 独立编辑页面、画布及版本栏；工具栏、放大／Director 共用的紧凑面板几何与排版、去背景变体与工具角标 |
| `public/styles/settings.css`／`transfer.css` | 设置与备份界面；持续加载。设置行统一为「文字列 + 一个控件或一组控件」：`.s-ctl` 控件组、`.s-field` 字段宽度（≤640px 换到文字下方）、`.s-toggle` 开关、`.s-block` 整行内容、`.s-meta` 标签加说明 |
| `src/home/*.vue` | HOME 头部、空状态、继续／进行中、定稿与大图的 scoped 布局；不复制 IMAGE／CHAT 全局样式。HOME 标记复用 `WaveMark.vue` 的分块动画与现有品牌字标；`HomeEmpty.vue` 维护五格欢迎卡，整页空状态柔光与静态粒纹归 `HomeWorkspace.vue` scoped 样式，不写全局背景补丁。其独立样式块仅维护带 HOME 临时状态限定的 View Transition 伪元素；资源 URL 留给既有服务 |
| `src/ask/AskModelPicker.vue`、`AskSend.vue`、`AskActivity.vue`、`src/bridge/DirectoryChip.vue` | ASK 与 HOME 共用的模型菜单、发送／停止、运行动作与工具计数、目录状态与菜单；目录的 HOME 尺寸通过 prop 区分，菜单 ID 保持唯一，停用时关闭 |
| `src/shared/TagPicker.vue` | 选择器私有 scoped 规则、局部输入底色、加载动画与移动覆盖；通用 `.sheet` 外框仍由 ui 管理 |
| `src/shared/HighlightInput.vue` | 高亮宿主与镜像指标采用普通样式块，自动补全采用 scoped 样式块；详见下文 |
| `src/shared/ToastList.vue` | Toast 的 scoped 外观、动画、局部底色、移动布局及减少动效下的真实计时例外 |
| `src/shared/ConfirmSheet.vue` | 确认内容与脚注的 scoped 规则；通用 modal 框架仍由 ui 管理 |
| `src/workspaces/image/EmptyStage.vue` | 空白页的 scoped 布局与说明；品牌子组件的字形样式用明确的 `:deep()` 保留 |
| `src/ask/AskDrawer.vue` | ASK 五态透明容器、共享磨砂材质变量、胶囊基线、窗口及响应式边界；图标整数网格与呼吸归 `AskMark.vue`，紧凑草稿归 `DraftCard.vue`，输入与消息的透明底归各自组件；车间不改变工作区布局，HOME 的半屏／全屏实色停靠规则仍归该组件 |
| `src/ask/AskStream.vue` | 提问气泡与右对齐、消息间距、正文对比度和行高、复制／编辑／分支操作及候选图片；工具摘要与明细的私有样式归 `AskToolGroup.vue`，抽取工具组件时保留消息布局规则 |
| `src/ask/AskMarkdown.vue` | ASK 回复与提问的 Markdown 内容排版，标题层级、嵌套列表、引用、表格与代码块滚动；解析树到 Vue 节点的映射，不接管窗口和消息操作布局 |

绘图与 EDIT 通过 `src/app/nai-composer.ts` 共享展示控件，各服务独立持有数据、异步写入目标和控件 ID；EDIT 的专用强度／噪声与 Seed 控件归 `EditorParameters.vue`／`src/workspaces/edit/EditWorkspace.vue`，编辑页面布局归 `editor.css`。

`GuidanceControl.vue` 共用 Guidance 滑杆、手输值与同行 Variety+ 小按钮；开关消费共享按钮材质，按官方 V4.5 能力显示，不增加参数面板行高或公共样式补丁。

Photopea 高级编辑宿主、固定紧凑顶栏与加载／错误反馈归 `PhotopeaPanel.vue` 的 scoped 样式，覆盖现有 EDIT 的全部可用空间。顶栏无展开／折叠功能。回传下拉复用共享菜单；跨域 iframe 内部只用官方 Environment API 设置 Dark Blue、中文、面板折叠以及菜单／工具白名单，配置归 `photopea-scripts.ts`，不覆写第三方 DOM／CSS。

宿主容器为相对定位的 block，使用 `overflow: clip` 阻止 iframe 内部聚焦导致宿主自动滚动；iframe 绝对固定 `top: 0; left: 0; margin: 0`，宽高均为 100%。不使用固定 gutter 扩宽，避免裁掉右侧工具。

NAI 提示词内底栏归 `NaiPromptOptions.vue`，档位菜单归 `NaiSelect.vue`，模型区（模型框与模式／Effort 分段）归 `ModelField.vue`，画幅归 `DrawingControls.vue`；复用站内 popover 和共享菜单，不新增全局补丁。

组件私有规则归对应 Vue，不保留第二份全局副本。

菜单的表面、行高、状态、分组标题、右侧附注、分隔线与入场只写在 `controls.css`；`switch-menu`（ui）、`conv-menu`／`model-panel`（chat）、`editor-mini`（editor）、`conn-menu`（settings）与各组件菜单只保留宽度、定位和特殊部件，例如画板行内 ⋯ 与底栏、模型分组、编辑参数输入。ASK 菜单在触屏保持 32px 行的例外写在 `AskMenu.vue`。

外部协同目录标签归 `src/bridge/DirectoryChip.vue`，锚定菜单的定位和焦点清理归 `AskMenu.vue`，材质取共享菜单；手动 JSON 兜底归 `BridgeSettings.vue`，在已有设置 ASK 页面内复用共享设置行。无资料选择或独立导出弹窗。

任务与配方审阅归 `DraftSlate.vue`，文件紧凑行与可读详情归 `DraftFiles.vue`；共用 DraftCard 的图标槽、缩进和颜色变量。完成记录复用 `AskToolGroup.vue`，外部来源以同行小字显示，详细来源按需展开；不添加全局补丁或独立草稿卡。

连接图标由 `src/shared/ConnectionAvatar.vue` 统一展示，`src/domain/connection-icon.ts` 按官方 Profile／已识别官方地址选择 Logo，按 Profile 能力选择通用图标，复用已有模型 Logo 和站内 sprite；设置卡片、模型列表标题与来源行的图标容器、尺寸仍归 `settings.css`。

图像／文本分组标题、连接卡底行的优先级控件与模型来源顺序归 `settings.css`；不另套分组面板。顶栏实际来源的 Logo 与同行张数估算归 `ui.css`，不增加下方注释行。

### 高亮、Teleport 与公共结构

- `.hl-wrap`、textarea 和镜像的指标保留原全局选择器，使绘图／对话／编辑的上下文高度与边框覆盖继续生效。组件仍由 Vue 创建节点，原生测量与滚动逻辑不变。
- `v-html` 生成的权重标记使用 `:where(.hl-mirror) .w`／`.w-mark`，限定在镜像中，同时保留原选择器权重。自动补全的单行布局归组件，表面、行状态与入场取共享菜单，不再依赖绘图样式。
- 当前编辑器仅使用高亮输入，没有启用自动补全；保持这一行为。共用同一组件不代表开启所有可选功能。
- Tag 选择器、自动补全和 Toast 的 scoped 属性随节点进入 Teleport 宿主；规则不依赖原工作区的父节点。Toast 仍可进入原生 dialog 的顶层，不改变层级或焦点行为。
- `.stage`／`.viewport`／`.print`、图片栏／缩略图、组合面板和 `.result-actions` 存在编辑或对话消费者，因此继续共享；仅图片结果的元数据、参数、Seed 和关联容器查询归入绘图 CSS。

### 编辑版本栏的继承边界

EDIT 已独立，版本栏由 `editor.css` 的 `--editor-rail` 管理，不再继承底下工作区的尺寸。画板菜单归 `src/workspaces/edit/EditBoards.vue`，沿用 IMAGE 的布局和管理菜单。重绘／放大共用 `EditToolMode.vue` 的分体入口、尺寸对齐、类型菜单定位及生命周期，表面与菜单行复用共享样式；原生／外部放大的模型与参数过滤归 `EditWorkspace.vue`，不改放大服务链路。模板内范围覆盖层归 `EditWorkspace.vue` 的 scoped 样式，尺寸角标与指针几何由 `src/native/focus-region.ts` 更新，不新增公共 Canvas 补丁。

Director 魔棒、工具条、强度分段与选项菜单的私有规则归 `DirectorTools.vue`；放大与 Director 共用 `editor.css` 的 `.editor-mini-*` 行和动作布局，定位归 `src/workspaces/edit/panels.ts`，面板位于工具栏上方 6px 并限制到视口内。NovelAI Upscale 与其他模型文字使用 `--sans`／`--fw-semibold`，不改共享菜单字重。

版本栏使用 132px／中等宽度 112px 及原有窄屏断点；主动折叠用 `.editor[data-rail="off"]` 设置为 0，不读取其他工作区的 `--hist`。

## 角色、画板与命名

多角色／画板样式归属：胶囊与下拉在 `BoardSwitcher.vue`；角色折叠列表、文本页签和放大定位栏在 `CharactersEditor.vue`；定位板与点位在 `CharacterPosition.vue`。历史归属圆点留在 `ImageLibrary.vue`，角色草稿合并和新画板应用入口留在 `DraftCard.vue`。全部复用站内 tokens 与现有高亮输入，不新增全局覆盖。

AI 命名的共用星光／停止按钮与状态动效由 `src/shared/AiNameButton.vue` 的 scoped 样式负责；画板胶囊内的位置归 `BoardSwitcher.vue`，ASK 标题与手动改名行归 `AskConversations.vue`。命名模型设置复用现有设置行与模型列表；减少动效时停止脉动，不新增全局规则。

绘图统一底栏、三段导航与抽屉动画归 `DrawingBottomPanel.vue`，参考缩略图及控件私有排布归 `NaiReferenceEditor.vue`，原参数宿主归 `DrawingParameters.vue`，底栏表面归 `ImageWorkspace.vue`；不改公共 scrub 的填充矩形样式。

会话内紧凑 Todo 与高度展开动画归 `src/slate/AskTodos.vue`，280px 轻量总览归 `SlatePanel.vue`，必要的成果选图／查看归 `SlateDeliverable.vue`；复用共享 modal、控件和 tokens。没有大任务板、单项详情编辑或常驻关联行，不新增全局样式补丁。

## 样式检查

### 同一检查入口

```sh
npm ci
npm run styles:check
npm run check
```

`stylelint.config.mjs` 为唯一样式检查配置，精确锁定 Stylelint 17.16.0 和 Vue 样式解析器 postcss-html 2.0.0。`styles:check` 检查 `public/styles/**/*.css` 与 `src/**/*.vue` 的样式块，不解析 Vue 的脚本、模板事件或动态样式值。

`check` 依次执行字体一致性、样式检查、严格类型、单元测试和生产构建。现有 CI 已调用同一个 `check`，没有另建一套 CI 规则。`dev`／`build` 保持原工作方式，不强制每次热更新都完整检查；提交前运行 `check`。

生成字体 CSS、构建输出、依赖和 `.local/` 不参与手写样式检查。字体仍由 `fonts:check` 核对配置、生成声明、字体资源、许可与预加载，不因排除生成文件而放弃验证。

### 规则与例外

- 检查 CSS 语法、未知属性／值／函数／单位、非法颜色、重复声明／自定义属性、被简写意外覆盖的属性、关键帧与媒体特征等实际错误。
- 不检查排版格式、不限制选择器命名或复杂度、不禁止合法重复选择器、不重排声明，不强制 scoped 或全部 token 化。连续且语法不同的兼容声明可以保留。
- 手写 `font-family` 使用 `var(--sans)`／`var(--mono)`／`var(--brand)` 或 CSS 继承关键字；`font` 简写须以字体角色结束或使用继承关键字。三个角色的定义禁止出现在手写 CSS，统一由字体配置生成。
- 图标尺寸 `--ico` 只接受 `var(--ico-xs|sm|md|lg)`，`stroke-width` 只接受 `var(--ico-stroke)`／`var(--ico-stroke-strong)`。ASK 上下文占用环是独立 viewBox 的进度环，就近注明后保留原线宽。
- 禁止无说明的 `!important`。必要例外使用就近的 Stylelint 指令，注明具体原因；缺少说明、无效作用域和已经无用的禁用指令同样报错。不要用文件级豁免跳过新问题。
- Vue 的 `:deep()`／`:global()`／`:slotted()` 作为合法伪类处理；允许现有容器查询、现代色彩函数与上下文覆盖。

现有优先级例外保留原声明和值：

| 位置 | 保留原因 |
| --- | --- |
| chat／editor／settings／通用 modal 的 `[hidden]` | 使隐藏状态优先于组件 display 布局 |
| controls 中 `.fld-hero` 及其 resized 状态 | 提示词占用剩余高度，手动调整后停止伸展 |
| ui 的 reduced-motion 区域 | 覆盖组件动效，并将加载光带改为可见的静态状态 |
| Toast 的 reduced-motion 计时器 | 隐藏进度动效，但保留真实停留时长，避免提示立即消失 |

共享颜色和字号继续优先消费现有变量；图片几何、光学校正、类别色和组件局部数值可以保留。是否值得新增 token 由实际复用语义决定，不靠 lint 将所有数值机械替换。

### 检查范围与依赖

按变更运行 `styles:check` 或完整 `check`；UI 基础视口为 320／390／768／1440px。跨工作区共享控件、Teleport、普通样式块和词典依赖必须按归属文档维护，不为消除选择器而改业务或外观。

历史 G4 审计记录中的开发依赖问题见归档；不把当时的漏洞数量或「零告警」作为当前审计结果。检查只使用仓库固定模式，不接受用户输入，工具依赖不进入静态产物或无需安装依赖的本地包。若更新检查依赖，核验锁文件并复验规则，不强制降级或放宽检查来消除告警。
