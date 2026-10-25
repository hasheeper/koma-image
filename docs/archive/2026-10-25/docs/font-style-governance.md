> 历史归档 · 2026-10-25 整理前快照（源码基线 `219463c`）。本文保留当时的设计、授权与验收范围，不作为现行规则或本次发布授权。现行入口见[文档索引](../../../README.md)。

# G0／G1：样式基线与字体配置

2026-10-20。本文记录 G0／G1 当时的基线与验证；后续 G2–G4 已完成，现行入口与归属见[样式归属记录](style-ownership.md)，检查与本轮 Git 交付见[收口记录](style-checks.md)。范围见[CSS 治理计划](css-governance-plan.md)。

## G0：当前应用基线

基线取自本工程当时的工作区，包含图片栏、启动连接反馈和 Tag 修复等已有未发布调整，没有用线上版本覆盖本地修改。基线所在 HEAD 为 `0e3a0a7a3a62fd19a99e0d8fa1aa8908f3190394`；另记录了当前文件哈希、已有差异与未跟踪文件清单，供区分本轮改动。

本地证据位于忽略提交的 `.local/css-governance/`：

- `g0/`：源文件哈希、已有差异、字体声明、资源哈希、HTML／样式／展示协调代码快照。
- `before/` 与 `after/`：绘图 1440px、对话 390px、词典 1440px、编辑 768px、设置 320px 五个代表性界面，以及计算样式、布局尺寸、关键字形宽度和字体加载记录。
- 所有数据为合成图片、测试文本和模拟连接，未读取用户凭据、真实图片或备份，未执行真实生成请求。

治理前共有 310 条字体声明与 310 个 WOFF2 文件：资源圆体 303 个，JetBrains Mono 6 个，Fredoka 1 个；另有 3 份字体许可。应用样式为 8 份、228,970 字节，字体声明为 3 份、300,171 字节。

### 样式依赖与所有权

| 入口／宿主 | G0 时的责任与依赖 | G0／G1 处理 |
| --- | --- | --- |
| 字体入口 | 字体声明与三个字体用途 | G1 统一为生成的 `fonts/index.css` |
| `styles/ui.css` | 全局变量、基础、控件、公共组合、工作区组件及反馈 | 仅移出三个字体用途、纠正过时字体注释，其余保留 |
| `styles/styles.css` | 绘图布局、Tag 公共控件、移动适配；重复导入 `ui.css` | 保留，入口去重和归属整理属于 G2／G3 |
| `styles/chat.css` | 对话布局、`.chat-page` 上下文 | 保留 |
| `styles/tags.css` | 词典布局、`.tags-body`、`--hist: 0px` | 保留，仍依赖绘图样式中的公共规则 |
| `editor.css`／`settings.css`／`transfer.css` | 编辑、设置、备份；持续加载 | 保留 |
| `src/app/shell.css` | 词典背景下编辑器 `--hist` 的继承修正 | 保留，不作为无用规则删除 |

G0／G1 的显式加载顺序为：字体 → ui → image → chat → tags → editor → settings → transfer，之后是 Vite 输出的 shell 样式。`presentation.ts` 负责三个 `#style-*` 的 `media`：绘图启用 image，对话启用 chat，词典启用 image＋tags。

`body > .topbar`、`body[data-*]`、`.chat-page` 与 `.tags-body` 等全局／上下文选择器维持原义。没有新增包装 DOM、scoped 属性或级联层。

需要在后续治理中保留的动态样式边界包括：分栏的 `--rail`／`--editor-panel`、图片显示尺寸、移动视口的 `--vp-h`／`--mobile-foot-h`、对话视口补偿，以及画布、蒙版光标和高亮测量节点的几何样式。它们继续由现有模板与受委托的原生驱动写入，不归入静态字体配置。

## G1：唯一配置来源

| 文件 | 职责 |
| --- | --- |
| `config/fonts.json` | 字体族、样式、字重映射、格式、许可路径、用途与预加载清单；资源圆体还声明离线源文件及工具版本 |
| `config/font-ranges/koma-rounded.json` | 101 个 Unicode 分片的唯一源配置；不再按字重重复手工维护 |
| `scripts/build-font-css.mjs` | 仅用 Node 生成字体声明与角色，并检查资源、许可、预加载和生成一致性 |
| `public/fonts/index.css` | 生成输出，供浏览器加载；不要手改 |
| `scripts/build-rounded-font.py` | 可选的离线 WOFF2 重建，读取同一清单和分片配置 |

三个字体用途也由清单生成，其他样式继续只消费 `var(--sans)`、`var(--mono)`、`var(--brand)`：

- `sans`：Koma Rounded 与 sans-serif，用于界面中英文。
- `mono`：JetBrains Mono Variable、Koma Rounded 与 monospace，用于参数／数字等。
- `brand`：Fredoka Variable、Koma Rounded 与 sans-serif，仅用于品牌字。

资源圆体仍为三个静态字重：400＝Regular，500＝Medium，`600 700`＝Bold；保留 `font-synthesis: none`。JetBrains Mono 与 Fredoka 继续使用原有可变字重与字符覆盖。没有重新切分或合并 WOFF2，原文件名、二进制、比例 `·`／`×` 字形和许可均保留。

HTML 原有三个拉丁字体预加载项保持不变，只将三份字体样式引用换成一个统一入口。检查程序核对它们与清单一致，并验证 `type` 和匿名 `crossorigin`。旧的三份 `public/fonts/<family>/index.css` 已删除，不保留第二份声明来源。

生成文件仍会包含 310 条 `@font-face`：这是浏览器按分片和字重选字所需的输出，配置集中管理不等于移除必要声明。

### 日常维护

修改字体清单或范围后运行：

```sh
npm run fonts:build
npm run fonts:check
```

如调整预加载清单，同时更新 `index.html` 的对应 `<link>`；不匹配时生成与检查都会报错。生成失败不会覆盖现有 CSS。源码中的生成文件应随清单变更一起提交。

`npm run dev` 与 `npm run build` 会先生成字体 CSS；已开启的开发服务器中修改配置后，重新执行 `fonts:build` 即可更新静态 CSS。`npm run check` 先检查生成一致性，过期时直接失败，避免构建自动修正后掩盖漏提交。CI 继续使用同一 `check`。

普通构建只需要 Node 与已提交的 WOFF2，不需要 Python、原始 TTF、外部字体服务或额外 npm 依赖。

### 可选：更新字体二进制

只有主动更新字体资源时才执行以下流程。源文件由维护者自行准备，不纳入普通构建或发布包：

```sh
python3 -m venv .local/font-tools
.local/font-tools/bin/python -m pip install fonttools==4.60.1 brotli==1.1.0
.local/font-tools/bin/python scripts/build-rounded-font.py /path/to/ttf-dir
npm run fonts:build
npm run check
```

源目录需含清单指定的 `ResourceHanRoundedCN-Regular.ttf`、`Medium.ttf`、`Bold.ttf`，版本为 0.990。离线脚本核对工具版本，保留比例字形补丁与内部重命名；先在同一文件系统的临时目录完成全部分片，再替换 `files/`。生成失败不清空原目录，替换异常尝试恢复原目录；极端恢复失败时保留原文件的暂存目录。许可文件不参与替换。

可用 `--output /path/to/scratch-family` 将重建结果写到临时位置而不替换正式资源，`--workers` 控制离线处理进程数，默认最多 4 个。该设置与应用任务并发无关。

## 验证

- 与 G0 对比，310 条声明的字体族、字重、范围、格式、显示策略和实际文件引用一致；三个字体用途一致，310 个字体文件与 3 份许可的 SHA-256 一致。
- 五个代表性界面的计算字体、布局尺寸、关键字形宽度与加载的分片集合一致，两轮累计请求同一组 36 个字体文件，没有运行时或资源错误。
- `npm run check` 通过：字体检查、类型、52 个单元测试与生产构建成功。应用 JS 与 shell CSS 的构建哈希与 G0 一致。
- Shell 6 项通过，包含新增的生产根路径／子路径字体用例，以及四视口、Teleport、工作区隔离与生命周期检查；公共界面 11 项、发布包 1 项通过。
- 新字体浏览器用例验证按需加载、400／500／`600 700` 映射、等宽数字、比例 `·`／`×` 与禁用合成字体。
- 临时目录中验证生成文件过期、预加载缺失／不匹配、Unicode 越界均被拒绝，原 CSS 不被覆盖；模拟离线切片失败及替换失败，原字体目录保留。
- 离线脚本已在临时目录完整生成 303 个分片。除重建产生的 `head` 时间戳与校验字段外，所有字体表与现有分片一致；正式 WOFF2 未被替换。

字体来源与许可见[第三方资源](third-party-assets.md)。G2／G3 已完成基础拆分、入口去重与组件归属整理，后续维护请同时参阅[现行样式归属](style-ownership.md)。
