# 界面工程：样式与字体维护

更新：2026-10-30。维护现行级联、主题材质、组件责任与字体配置／重建；G0–G4 过程、大小对比和验收见[归档](../archive/2026-10-25/README.md)。视觉标准见[设计语言](../product/design-language.md)，检查规则集中在本文[样式检查](#样式检查)。

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

## 主题与材质变量

颜色的唯一维护入口是 `public/styles/tokens.css`：`:root` 保留暗色基线，`:root[data-theme="light"]` 提供柔白背景、白色浮起表面与紫色强调的亮色基底。两种主题使用同一套语义变量，组件不按主题分支、不复制整份 CSS。用户从顶栏外观菜单或通用设置选择外观，默认暗色；行为与持久化边界见[外观](../workspaces/settings-and-tags.md#外观)。

| 调整目标 | 变量入口 |
| --- | --- |
| 表面、文字、分隔、状态 | `--canvas/chrome/sunken/raised/hover`、`--fg*`、`--line*`、`--a*`、`--ok/warn/err` |
| 图片舞台与环境柔光 | `--stage`、`--stage-wash`、`--ambient-ink`；舞台底色独立于页面 `--canvas`，亮色不保留大面积紫色柔光 |
| HOME／CHAT 底板与缩略图衬底 | `--page-bg` 管首页与对话阅读区，亮色为稍浅的 `#f8f8fb`；`--thumb-backdrop-filter` 管缩略图留白处的模糊图像，亮色低饱和、18% 不透明度，暗色沿用原有压暗效果；不作用于原图 |
| 输入与分段控件 | `--well*`、`--field-line/hover`、`--field-shadow` 管输入，弹窗、导入卡、小编辑器和尺寸面板内的输入用 `--panel-well`；分段内槽用 `--seg-bg/line/shadow`（`.seg`、图片分类和底部标签共用），未选中字色 `--seg-ink`，选中用 `--seg-active-*`（含 `--seg-active-weight`）／`--seg-quiet-shadow`；画幅方向、比例及尺寸分组分别用 `--choice-*`（含 `--choice-active-shadow`）、`--ratio-*`（含 `--ratio-active-shadow`）、`--size-panel-bg`。亮色为浅灰内槽加白色滑块，方向与比例为淡紫底加 1.5px 紫边；`--seg-hover-bg` 管灰色悬停 |
| 导航状态与悬停 | `--nav-active-bg/ink/shadow` 管导航选中，亮色为白色凸起、紫字；`--hover`、`--ghost-hover`、`--tab-hover-bg` 管灰色悬停，选中态不由悬停覆盖 |
| 外观选择器 | `--appearance-bg/selected-bg/selected-shadow`；紧凑三等分、浅色白色浮片、深色亮一级浮片，中性选中文字；专用材质不改变其他分段控件 |
| IMAGE 结果信息栏 | `--result-*`；亮色与右侧栏共用 `--chrome` 底板、不加顶部投影，参数名／数值分层，ID 浅紫、可复制 Seed 白色、只读参数极浅灰；下载实心紫白字、ASK 保留紫色图形配中性文字。暗色保留原材质，布局与尺寸归 `styles.css` 和 `ImageStage.vue` |
| 卡片与分组 | `--card-bg/shadow`、`--group-bg/line`、历史栏空槽 `--ghost-tile-bg/ring`；亮色按明度分层，`--canvas` 最低、`--chrome` 高一级，白色只给控件与浮起表面 |
| 共享菜单 | `--menu-*` 管表面、边界、磨砂与交互状态；暗色保持实底，亮色用接近实色的白色玻璃与浅紫选中底 |
| ASK 玻璃、输入、悬停及高光边缘 | `--glass-*`；`AskDrawer.vue` 保留 `--ask-*` 别名和 HOME／手机实色覆盖 |
| 遮罩、阴影及表面叠色 | `--scrim*`、`--lightbox-bg`、`--shadow-rgb/strength`、`--surface-tint`、`--specular` |
| 品牌字标、主按钮与加载效果 | `--brand-fill` 可为纯色或渐变，其他材质取 `--brand-*`、`--action-*`（含各状态阴影）、`--bar-ink`、`--sheen-ink`、`--a-shine`；HOME 五格空状态图形使用 `--empty-mark-back/front` |
| 草稿差异、Tag 分类、权重高亮 | `--diff-*`、`--tag-*`、`--weight-*` |
| 透明图棋盘底 | `--checker-a/b`，由 `--image-checker` 组合 |

组件继续负责布局、局部阴影几何、渐变方向与透明度；共享颜色取变量，需要半透明时用 `color-mix()`，不在组件中重复色值。`--surface-tint` 是随主题变化的表面叠色，`--specular` 是固定白色高光，二者不能混用。提示词权重解析只计算强度，生成的高亮样式引用 `--weight-*`，换配色不重算词文。

亮色强调色与玻璃材质参考 [AgIzT/NovelAI-Tag 的 tokens.css](https://github.com/AgIzT/NovelAI-Tag/blob/569ed7199e1df2e78d69085000ffff2644db4f9a/site/assets/tokens.css)及[控件状态](https://github.com/AgIzT/NovelAI-Tag/blob/569ed7199e1df2e78d69085000ffff2644db4f9a/site/assets/ui-kit.css)，以已核对的提交 `569ed71` 为准。底板按用户给定的明度层级并按反馈提亮：图片舞台与通用页面底 `#f4f4f8`，HOME／CHAT 阅读区 `#f8f8fb`，侧栏、顶栏与历史栏 `#f9f9fb`，控件、卡片、额度条、输入和浮窗为白色；悬停 `#efeff4`；分隔与边界为半透明冷灰 `rgb(30 32 72 / .05)`、`.07`，在灰底和白底上读数一致；分段内槽 `#e9eaf2`。主文及操作标签用 `#232a3c`，分段未选中 `#6b7184`，弱色 `#878da3` 只给占位、附注或装饰；强调色 `#6f5cf2`、浅选中底 `#ece9fe`。中性底板和画幅填充状态是 Koma 的适配，不宣称来自参考仓库；不引入该项目依赖、字体、布局或业务脚本。

Koma 字标在亮色中为纯墨蓝，方块保留品牌紫，形状与字体不变。HOME 五格图形使用内联 SVG 消费主题变量，亮色为淡紫后层、白色前层，暗色保持原值。生成主按钮为紫底白字及淡紫投影；结果栏下载用实心紫白字，不加光晕。分段（含角色自动／手动与草稿分段）为浅灰内槽加白色凸起滑块，选中深色中粗字、未选中弱灰字；画幅方向卡与比例选中为 7% 淡紫底、1.5px 紫边和紫字，比例不用下划线；菜单选中为浅紫底。尺寸输入与所在分组均为白色；ASK 建议卡、输入框和设置卡片沿用同一层次。边界保持极淡，卡片与输入投影向下柔和扩散，不形成硬底边，键盘焦点仍有清晰提示。设置导航、图片历史／收藏、底部标签及 HOME 排列选中为白色凸起、紫字；历史栏空槽为半透明白；未选中控件保留灰度悬停反馈。共享表面阴影收敛为低透明度中性双层投影，避免边缘出现厚重灰晕。ASK 浮窗与菜单采用参考菜单的 93% 白色和 18px 磨砂，ASK 不增饱和；HOME 停靠和手机全屏仍用实色。Koma 常驻面板为 `--chrome` 浅灰实色，不移植参考站点 74% 白色的悬浮侧栏布局。环境紫色柔光关闭，亮色不反转原图，也不靠整体滤镜转换暗色。

以下颜色有意独立：图片内的操作、编号和关闭按钮用固定的 `--media-*`，保持深底、浅字与浅紫强调；CSS mask、画笔光标黑白描边、聚焦范围遮罩属于功能性颜色；原图、导出图片、黑白蒙版字节及供应商品牌原色不进入主题。Photopea 内部主题由官方环境配置控制，首次创建随当前外观使用 White（`6`）或 Dark Blue（`3`）。保活实例沿用内部主题，Koma 外观切换不重建分层文档。

`index.html` 在首屏样式加载前解析保存值和系统偏好，避免主题闪烁；App Shell 的 `src/app/theme.ts` 接管根元素 `data-theme`，两套 tokens 各自声明 `color-scheme`。同一服务监听系统与跨页偏好变化，销毁时释放订阅。Canvas 加载方块与 EDIT 蒙版预览通过 `src/native/theme-watch.ts` 重新读取 `--a` 并重绘，实例销毁时断开观察；只改变展示色，不改变原图、蒙版字节与编辑历史。

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
| `src/shared/ToastList.vue` | Toast 的 scoped 外观、动画、局部底色、移动布局及减少动效下的真实计时例外；车间通知避开 ASK 的启动图标、结果胶囊与窗口操作 |
| `src/shared/ConfirmSheet.vue` | 确认内容与脚注的 scoped 规则；通用 modal 框架仍由 ui 管理 |
| `src/workspaces/image/EmptyStage.vue` | 空白页的 scoped 布局与说明；品牌子组件的字形样式用明确的 `:deep()` 保留 |
| `src/ask/AskDrawer.vue` | ASK 五态透明容器、磨砂材质的局部别名、胶囊基线、窗口及响应式边界；材质颜色由 tokens 管理，图标整数网格与呼吸归 `AskMark.vue`，紧凑草稿归 `DraftCard.vue`，输入与消息的透明底归各自组件；车间不挤压工作区布局，HOME 停靠与手机端全屏共用该组件的实色表面，背景交互由工作区模板随全屏状态隔离 |
| `src/ask/AskStream.vue` | 提问气泡与右对齐、消息间距、正文对比度和行高、复制／编辑／分支操作及候选图片；工具摘要与明细的私有样式归 `AskToolGroup.vue`，抽取工具组件时保留消息布局规则 |
| `src/ask/AskMarkdown.vue` | ASK 回复与提问的 Markdown 内容排版，标题层级、嵌套列表、引用、表格与代码块滚动；解析树到 Vue 节点的映射，不接管窗口和消息操作布局 |

绘图与 EDIT 通过 `src/app/nai-composer.ts` 共享展示控件，各服务独立持有数据、异步写入目标和控件 ID；EDIT 的专用强度／噪声与 Seed 控件归 `EditorParameters.vue`／`src/workspaces/edit/EditWorkspace.vue`，编辑页面布局归 `editor.css`。

`GuidanceControl.vue` 共用 Guidance 滑杆、手输值与同行 Variety+ 小按钮；开关消费共享按钮材质，按官方 V4.5 能力显示，不增加参数面板行高或公共样式补丁。

`src/shared/ThemeMenu.vue` 维护 IMAGE／CHAT 共用的外观菜单，复用共享菜单、定位和键盘行为；月亮／显示器／太阳取本地图标精灵。`src/app/theme.ts` 同时提供菜单和通用设置的选项，首屏脚本与服务均以暗色为缺省，仅显式 `system` 跟随系统。

Photopea 高级编辑宿主、固定紧凑顶栏与加载／错误反馈归 `PhotopeaPanel.vue` 的 scoped 样式，覆盖现有 EDIT 的全部可用空间。顶栏无展开／折叠功能。回传下拉复用共享菜单；跨域 iframe 内部只用官方 Environment API 设置首次创建时的 White／Dark Blue、中文、面板折叠以及菜单／工具白名单，配置归 `photopea-scripts.ts`，不覆写第三方 DOM／CSS。

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

EDIT 底部工具栏保持单行，宽度不足时将图片操作显示为上方左对齐的独立胶囊。布局材质归 `editor.css`，实际宽度测量与溢出标记归 `src/native/editor-toolbar.ts`；不搬移 Vue 节点，页面隐藏时暂停 Observer 与 rAF，恢复时重新测量，卸载时清理。

版本栏使用 132px／中等宽度 112px 及原有窄屏断点；主动折叠用 `.editor[data-rail="off"]` 设置为 0，不读取其他工作区的 `--hist`。

## 角色、画板与命名

多角色／画板样式归属：胶囊与下拉在 `BoardSwitcher.vue`；角色折叠列表、文本页签和放大定位栏在 `CharactersEditor.vue`；定位板与点位在 `CharacterPosition.vue`。历史归属圆点留在 `ImageLibrary.vue`，角色草稿合并和新画板应用入口留在 `DraftCard.vue`。全部复用站内 tokens 与现有高亮输入，不新增全局覆盖。

AI 命名的共用星光／停止按钮与状态动效由 `src/shared/AiNameButton.vue` 的 scoped 样式负责；画板胶囊内的位置归 `BoardSwitcher.vue`，ASK 标题与手动改名行归 `AskConversations.vue`。命名模型设置复用现有设置行与模型列表；减少动效时停止脉动，不新增全局规则。

绘图统一底栏、三段导航与抽屉动画归 `DrawingBottomPanel.vue`，参考缩略图及控件私有排布归 `NaiReferenceEditor.vue`，原参数宿主归 `DrawingParameters.vue`，底栏表面归 `ImageWorkspace.vue`；不改公共 scrub 的填充矩形样式。

会话内紧凑 Todo 与高度展开动画归 `src/slate/AskTodos.vue`，280px 轻量总览归 `SlatePanel.vue`，必要的成果选图／查看归 `SlateDeliverable.vue`；复用共享 modal、控件和 tokens。没有大任务板、单项详情编辑或常驻关联行，不新增全局样式补丁。

供应商配置复用共享 modal、输入控件与设置样式；原有 Koma Logo＋品牌名排布、字段间距、Key 内嵌显隐按钮和保存 Key 复选行归 `SettingsOverlay.vue` scoped 样式。原全屏 Key gate 组件、属性钩子和全局专用样式已删除。

## 样式检查

### 按改动检查

```sh
npm ci
npm run styles:check
npm run check
```

`stylelint.config.mjs` 为唯一样式检查配置，精确锁定 Stylelint 17.16.0 和 Vue 样式解析器 postcss-html 2.0.0。`styles:check` 检查 `public/styles/**/*.css` 与 `src/**/*.vue` 的样式块，不解析 Vue 的脚本、模板事件或动态样式值。

`check` 仅执行严格类型、纯逻辑单元测试和构建；样式与字体检查为按需命令。CI 额外只跑少量业务冒烟，不对 CSS 值、尺寸、动画或视口间距做断言。纯样式调整目视核对涉及页面即可，不要求全量浏览器回归。

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

## 字体配置与重建

### 唯一配置来源


| 文件 | 职责 |
| --- | --- |
| `config/fonts.json` | 字体族、样式、字重映射、格式、许可路径、用途与预加载清单；资源圆体还声明离线源文件及工具版本 |
| `config/font-ranges/koma-rounded.json` | Unicode 分片的唯一源配置；不按字重重复手工维护 |
| `scripts/build-font-css.mjs` | 仅用 Node 生成字体声明与角色，并检查资源、许可、预加载和生成一致性 |
| `public/fonts/index.css` | 生成输出，供浏览器加载；不要手改 |
| `scripts/build-rounded-font.py` | 可选的离线 WOFF2 重建，读取同一清单和分片配置 |

三个字体用途也由清单生成，其他样式继续只消费 `var(--sans)`、`var(--mono)`、`var(--brand)`：

- `sans`：Koma Rounded 与 sans-serif，用于界面中英文。
- `mono`：JetBrains Mono Variable、Koma Rounded 与 monospace，用于参数／数字等。
- `brand`：Fredoka Variable、Koma Rounded 与 sans-serif，仅用于品牌字。

资源圆体仍为三个静态字重：400＝Regular，500＝Medium，`600 700`＝Bold；保留 `font-synthesis: none`。JetBrains Mono 与 Fredoka 继续使用原有可变字重与字符覆盖。没有重新切分或合并 WOFF2，原文件名、二进制、比例 `·`／`×` 字形和许可均保留。

HTML 的拉丁字体预加载与清单保持一致，检查程序核对 type 和匿名 crossorigin。只使用统一字体 CSS，不增加第二份手写声明。

### 日常维护

修改字体清单或范围后运行：

```sh
npm run fonts:build
npm run fonts:check
```

如调整预加载清单，同时更新 `index.html` 的对应 `<link>`；不匹配时生成与检查都会报错。生成失败不会覆盖现有 CSS。源码中的生成文件应随清单变更一起提交。

`npm run dev` 与 `npm run build` 会先生成字体 CSS；已开启的开发服务器中修改配置后，重新执行 `fonts:build` 即可更新静态 CSS。字体配置变更应在构建前显式运行 `npm run fonts:check`，避免构建自动生成后掩盖漏提交；普通检查不重复执行字体专项验证。

普通构建只需要 Node 与已提交的 WOFF2，不需要 Python、原始 TTF、外部字体服务或额外 npm 依赖。

### 可选：更新字体二进制

只有主动更新字体资源时才执行以下流程。源文件由维护者自行准备，不纳入普通构建或发布包：

```sh
python3 -m venv /tmp/koma-font-tools
/tmp/koma-font-tools/bin/python -m pip install fonttools==4.60.1 brotli==1.1.0
/tmp/koma-font-tools/bin/python scripts/build-rounded-font.py /path/to/ttf-dir
npm run fonts:build
npm run check
```

源目录需含清单指定的 `ResourceHanRoundedCN-Regular.ttf`、`Medium.ttf`、`Bold.ttf`，版本为 0.990。离线脚本核对工具版本，保留比例字形补丁与内部重命名；先在同一文件系统的临时目录完成全部分片，再替换 `files/`。生成失败不清空原目录，替换异常尝试恢复原目录；极端恢复失败时保留原文件的暂存目录。许可文件不参与替换。

可用 `--output /path/to/scratch-family` 将重建结果写到临时位置而不替换正式资源，`--workers` 控制离线处理进程数，默认最多 4 个。该设置与应用任务并发无关。

字体来源、比例字形修改及许可见[第三方资源](../third-party-assets.md)。
