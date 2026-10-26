# 样式加载与维护归属

更新：2026-10-26。维护现行级联与组件责任；G0–G4 过程、大小对比和验收见[归档](archive/2026-10-25/README.md)。视觉标准见[设计语言](design-language.md)，检查规则见[样式检查](style-checks.md)。

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

`presentation.ts` 及三个工作区 stylesheet 的 ID／media 开关保持不变：绘图启用 image，对话启用 chat，词典启用 image＋tags。词典仍需绘图样式中的原有顶栏与移动布局；这些工作区依赖仍然保留。

## 维护责任

| 负责文件 | 维护内容与边界 |
| --- | --- |
| `public/styles/tokens.css` | 全局色彩、尺寸、字重、间距、圆角、层级与动效变量；三个字体角色仍来自生成入口 |
| `public/styles/base.css` | reset、默认排版、表单继承、焦点、选区和滚动条 |
| `public/styles/controls.css` | 表单、按钮、图标、勾选、开关（`.switch`，宿主用 `--sw-w`／`--sw-h` 定尺寸）、分段、滑杆及共享 Tag 分类色点 |
| `public/styles/ui.css` | 跨工作区使用的顶栏、额度、组合布局、分栏、舞台／图片、图片栏／缩略图、结果操作组、加载、灯箱、通用弹窗与 sheet 宿主 |
| `public/styles/styles.css` | 绘图布局、画幅、参数导入、图片栏扩展及结果元数据；先放原公共元数据规则，再放绘图覆盖 |
| `public/styles/chat.css`／`tags.css` | 对话／词典布局与各自上下文；按各工作区加载 |
| `public/styles/editor.css` | 编辑布局、画布、版本栏及词典背景下的版本栏宽度修正 |
| `public/styles/settings.css`／`transfer.css` | 设置与备份界面；持续加载。设置行统一为「文字列 + 一个控件或一组控件」：`.s-ctl` 控件组、`.s-field` 字段宽度（≤640px 换到文字下方）、`.s-toggle` 开关、`.s-block` 整行内容、`.s-meta` 标签加说明 |
| `src/shared/TagPicker.vue` | 选择器私有 scoped 规则、局部输入底色、加载动画与移动覆盖；通用 `.sheet` 外框仍由 ui 管理 |
| `src/shared/HighlightInput.vue` | 高亮宿主与镜像指标采用普通样式块，自动补全采用 scoped 样式块；详见下文 |
| `src/shared/ToastList.vue` | Toast 的 scoped 外观、动画、局部底色、移动布局及减少动效下的真实计时例外 |
| `src/shared/ConfirmSheet.vue` | 确认内容与脚注的 scoped 规则；通用 modal 框架仍由 ui 管理 |
| `src/workspaces/image/EmptyStage.vue` | 空白页的 scoped 布局与说明；品牌子组件的字形样式用明确的 `:deep()` 保留 |
| `src/ask/AskDrawer.vue` | ASK 五态透明容器、共享磨砂材质变量、胶囊基线、窗口及响应式边界；图标整数网格与呼吸归 `AskMark.vue`，紧凑草稿归 `DraftCard.vue`，输入与消息的透明底归各自组件；不改变工作区布局 |
| `src/ask/AskMarkdown.vue` | ASK 回复与提问的 Markdown 内容排版，标题层级、嵌套列表、引用、表格与代码块滚动；解析树到 Vue 节点的映射，不接管窗口和消息操作布局 |

NAI 提示词内底栏归 `NaiPromptOptions.vue`，档位菜单归 `NaiSelect.vue`，模型／模式／Effort 同行归 `DrawingControls.vue`；复用站内 popover 和 `switch-menu`，不新增全局补丁。

组件私有规则归对应 Vue，不保留第二份全局副本。

外部协同目录标签归 `src/bridge/DirectoryChip.vue`，锚定菜单的材质、定位和焦点清理归 `AskMenu.vue`；手动 JSON 兜底归 `BridgeSettings.vue`，在已有设置 ASK 页面内复用共享设置行。无资料选择或独立导出弹窗。

任务与配方审阅归 `DraftSlate.vue`，文件紧凑行与可读详情归 `DraftFiles.vue`；共用 DraftCard 的图标槽、缩进和颜色变量。完成记录复用 `AskToolGroup.vue`，外部来源以同行小字显示，详细来源按需展开；不添加全局补丁或独立草稿卡。

连接图标由 `src/shared/ConnectionAvatar.vue` 统一展示，`src/domain/connection-icon.ts` 按官方 Profile／已识别官方地址选择 Logo，按 Profile 能力选择通用图标，复用已有模型 Logo 和站内 sprite；设置卡片、模型列表标题与来源行的图标容器、尺寸仍归 `settings.css`。

图像／文本分组标题、连接卡底行的优先级控件与模型来源顺序归 `settings.css`；不另套分组面板。顶栏实际来源的 Logo 与同行张数估算归 `ui.css`，不增加下方注释行。

### 高亮、Teleport 与公共结构

- `.hl-wrap`、textarea 和镜像的指标保留原全局选择器，使绘图／对话／编辑的上下文高度与边框覆盖继续生效。组件仍由 Vue 创建节点，原生测量与滚动逻辑不变。
- `v-html` 生成的权重标记使用 `:where(.hl-mirror) .w`／`.w-mark`，限定在镜像中，同时保留原选择器权重。自动补全与其动画归组件，不再依赖绘图样式。
- 当前编辑器仅使用高亮输入，没有启用自动补全；保持这一行为。共用同一组件不代表开启所有可选功能。
- Tag 选择器、自动补全和 Toast 的 scoped 属性随节点进入 Teleport 宿主；规则不依赖原工作区的父节点。Toast 仍可进入原生 dialog 的顶层，不改变层级或焦点行为。
- `.stage`／`.viewport`／`.print`、图片栏／缩略图、组合面板和 `.result-actions` 存在编辑或对话消费者，因此继续共享；仅图片结果的元数据、参数、Seed 和关联容器查询归入绘图 CSS。

### 编辑版本栏的继承边界

原 `src/app/shell.css` 已删除，唯一导入同时移除。词典上的编辑器宽度修正归入 `editor.css`，只设置编辑器自己的 `--editor-rail`，不再覆盖词典继承的 `--hist`。

保留原来的 132px／窄屏 112px 宽度及实际断点。修正规则放在 `.editor[data-rail="off"]` 之前，确保主动折叠仍优先；词典自身的 `--hist: 0px` 保持原义。

## 角色、画板与命名

多角色／画板样式归属：胶囊与下拉在 `BoardSwitcher.vue`；角色折叠列表、文本页签和放大定位栏在 `CharactersEditor.vue`；定位板与点位在 `CharacterPosition.vue`。历史归属圆点留在 `ImageLibrary.vue`，角色草稿合并和新画板应用入口留在 `DraftCard.vue`。全部复用站内 tokens 与现有高亮输入，不新增全局覆盖。

AI 命名的共用星光／停止按钮与状态动效由 `src/shared/AiNameButton.vue` 的 scoped 样式负责；画板胶囊内的位置归 `BoardSwitcher.vue`，ASK 标题与手动改名行归 `AskConversations.vue`。命名模型设置复用现有设置行与模型列表；减少动效时停止脉动，不新增全局规则。

绘图统一底栏、三段导航与抽屉动画归 `DrawingBottomPanel.vue`，参考缩略图及控件私有排布归 `NaiReferenceEditor.vue`，原参数宿主归 `DrawingParameters.vue`，底栏表面归 `ImageWorkspace.vue`；不改公共 scrub 的填充矩形样式。

会话内紧凑 Todo 与高度展开动画归 `src/slate/AskTodos.vue`，280px 轻量总览归 `SlatePanel.vue`，必要的成果选图／查看归 `SlateDeliverable.vue`；复用共享 modal、控件和 tokens。没有大任务板、单项详情编辑或常驻关联行，不新增全局样式补丁。
