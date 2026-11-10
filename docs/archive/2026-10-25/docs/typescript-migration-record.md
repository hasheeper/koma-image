# TypeScript 迁移 T0–T5 基线与验收记录

历史基线：2026-10-25 整理前的 `f7a9c16` 文档；各节保留原日期、阶段结果及当时的模拟／真实边界。2026-11-07 删除已完成的排期、实施指令与重复规范，仅保留以下独有记录。节号沿用原稿，文中的旧路径、测试数量与授权只描述当时情况；现行规则见[维护专题](../../../architecture.md)。

## 1. 当前规模与检查边界

以下是 T0 基线的 Git 跟踪文件统计；行数包含空行与注释，字节数采用 UTF-8 文件大小，排除依赖、构建产物与 `.local/`。T4 完成后，`src/` 已无 JS 实现，当前统计见第 9 节。

| 应用源码 | 文件 | 行数 | 字节 |
| --- | ---: | ---: | ---: |
| TS 实现 | 55 | 7,830 | 260,868 |
| TS 声明 `.d.ts` | 10 | 152 | 4,613 |
| Vue 单文件组件 | 33 | 9,651 | 310,499 |
| JS 实现 | 9 | 1,840 | 67,552 |

33 个 Vue 文件中，32 个使用 `<script setup lang="ts">`，另一个 `ModelLogos.vue` 是纯 SVG 模板。应用源文件字节中 Vue＋TS 已占约 89.5%；Vue 文件的模板与样式也计算在内，这不是纯 TS 逻辑的比例。

全仓库 JS 还有 15 个测试文件（232,778 字节、6,071 行）及 5 个服务器／工具／配置／重定向文件（28,019 字节、689 行）。测试占全部 JS 字节约 70.9%。即使应用 9 个模块全部迁完，仓库仍会显示较多 JavaScript。

当前 `tsconfig.json` 已启用 `strict`、`isolatedModules`、`noUnusedLocals`、`noUnusedParameters` 和 `verbatimModuleSyntax`；入口为 `src/**/*.ts`、`src/**/*.vue` 与 `vite.config.ts`。没有启用 `allowJs`／`checkJs`。T0 时 9 个 JS 模块各有同名 `.d.ts`，调用方读取声明，JS 函数体未接受严格类型检查；T1–T4 已将全部 9 个实现纳入检查并移除对应声明。

因此不需要再搭建 Vue／TS 工程、放宽 strict 或引入新的编译器。迁移后由现有 `vue-tsc --noEmit` 直接检查实现。

## 2. 模块清单与调用关系

下表的路径均相对 `src/`。调用方列列出直接应用调用方，测试另见第 6 节。

| 模块（当前路径） | 原 JS 行数 | 职责与直接调用方 | 阶段 |
| --- | ---: | --- | --- |
| `native/image-dimensions.ts` | 78 | PNG／JPEG／WebP 尺寸读取；`domain/media.ts` 使用 | T1 已完成 |
| `native/prompt-converter.ts` | 147 | 显式提示词转换；`PromptDraft.vue` 使用 | T1 已完成 |
| `domain/conversation.ts` | 306 | 会话、轮次、版本、引用与上下文；`services/chat.ts`、`ChatTurn.vue`、`ContextPanel.vue` 使用 | T2 已完成 |
| `domain/media.ts` | 333 | 对话／编辑／放大参数与输入限制；chat、editor、assets、handoff 服务及 `EditorOverlay.vue` 使用 | T2 已完成 |
| `native/image-meta.ts` | 310 | 图片参数、压缩文本、NAI／WebUI 字段映射；`ImportSheet.vue` 使用 | T3 已完成 |
| `native/native-images.ts` | 72 | 原生图片响应／ZIP、CRC 与解压限制；image-response、media-response 服务使用 | T3 已完成 |
| `native/comparison.ts` | 125 | 本地批量对比图合成；`services/drawing.ts` 使用 | T3 已完成 |
| `native/mask-editor.ts` | 212 | 原生蒙版、笔画、撤销、源像素导出；编辑覆盖层、editor 服务和 `native/editor-canvas.ts` 使用 | T4 已完成 |
| `native/tile-wave.ts` | 257 | 共享逐帧调度、加载／揭示动画；`WaveHost.vue`、`ChatPrint.vue` 使用 | T4 已完成 |

主要依赖顺序为 `image-dimensions → media → chat/editor 服务 → Vue 调用方`；conversation 与 media 可分别落地。图片元数据与响应解码是独立模块。蒙版与波浪最后处理，因为它们涉及可空状态、原生事件、异步回调和资源生命周期。

`services/`、`gateway/`、`storage/`、App Shell、工作区有逻辑的 Vue 组件，以及 `native/editor-canvas.ts`／`splitter.ts` 已经使用 TS。本轮只修改它们为接入新类型所必需的导入与类型边界，不另行重写服务或拆分工作区。

## 3. 勘探发现与处理原则

### 声明不能代替实现检查

T0 时 `media.js` 的 `NAI_UPSCALE_MAX_PIXELS`、`EDITOR_MODES`、`buildUpscalePayload` 和 `buildNAIEditPayload` 四个实际导出未出现在 `media.d.ts` 中；当时 TS 调用方没有直接使用这些导出，不能据此判定现有功能故障。T2 已保留这些导出并直接在实现中定义类型。

T0 时 `MaskState.strokes` 是 `unknown[]`，无法表达普通笔画与清空记录的差别；`ImageMetadata.fields` 是宽泛的字典，未区分可导入的数字与文本字段。T3／T4 已分别改为明确的可选字段与笔画联合类型。media 原先统一声明返回带任意键的 `ImagePayload`；T2 已改为具体请求联合类型，并保持与网关边界兼容。

### 同一数据结构只保留一个权威定义

| 边界 | 实施方式 |
| --- | --- |
| 会话／轮次／版本／消息 | 复用 `storage/records.ts` 的 `ConversationRecord`、`ConversationTurn`、`ConversationVersion`、`MessageBlock`；不另建一套近似模型 |
| 模型目录 | 复用 `domain/catalog.ts` 的 `CatalogModel`；仅需要 models／samplers 的函数采用实际使用的最小结构 |
| 媒体参数 | 将已有 `EditorMode`、`EditMode`、`EditorFields` 移入 TS 实现；为不同输出补足具体结构，并保持可传给现有 `ImagePayload` 网关边界 |
| 图片元数据 | 本模块定义明确的可选字段与 extras；原始 JSON 先作为 `unknown`，在访问处收窄，不把解析结果直接断言成完整内部模型 |
| 蒙版 | 本模块定义 `MaskPoint`、普通笔画、清空记录及 `MaskState`；采用可区分的联合类型，保持 snapshot 的现有运行时结构 |
| 波浪 | 本模块区分公开控制接口和带 canvas／visible 的内部实例；标明 `boolean \| null`、完成回调、图像源与 TypedArray 状态 |

类型优先放在所属模块并通过 `import type` 引用；确有多个实现共享时才抽取小型类型文件。不新增全局 `types/` 大杂烩、泛型驱动框架或运行时 schema 依赖。

### 收窄类型不能顺便改变业务

- 保留 0、空字符串、`null`、`undefined` 的原有区别。例如图片元数据的 `finiteNumber` 使用 `Number(value)`，与 `domain/value.ts` 的 `finite` 对空值的处理不同，不能为了共用工具直接替换。
- 保留会话原地修改、复制时的 ID 重映射、附件消费、迟到结果的 selectionRevision 判断与原报错时机。布尔值相减排序可改为显式 `Number(...)`，但置顶和稳定排序规则不变。
- 请求字段白名单、图片次序、源图与 EXIF 归一化 PNG 的选择、Seed 0、8MB／32MB 上限、模型面积和蒙版尺寸判断保持一致。
- 解析边界需明确哪些输入已有检查、哪些是内部不变量。新增对异常文件的拒绝、容错或默认值均属于行为变化；发现问题单独记录和验证，不伪装成类型补丁混入迁移。
- Canvas context 的可空性、Promise 的完成值、`ImageBitmap` 与 `HTMLImageElement` 的不同清理方法必须表达清楚。优先保留现有检查；新增失败分支须说明影响，不能用批量 `!`、`as any` 或 `as unknown as` 掩盖问题。
- 已存在的宽泛 JSON 持久化结构不在本轮全面收紧。`storage/records.ts` 与 conversation 都有 `assetRefs`；这次不顺便合并或改变依赖方向。

### 原生驱动继续保持原生

TS 类型会在构建时擦除；高频驱动改成 `.ts` 并不要求接入 Vue reactive。保持独立 Canvas 宿主、普通局部变量、Map／Set、同一 rAF 调度与 Observer 管理，维持暂停／恢复／销毁责任。指针逐点数据、Blob、ImageBitmap 和完整蒙版不移入深层响应式状态。

### 隔离试验结果

在忽略提交的 `.local/ts-migration/discovery/` 复制应用源码，仅将 9 个 JS 改名、移除配对声明并替换相关导入，使用继承当前配置的 `vue-tsc` 检查，得到 **351 条诊断**。其中包括 188 条未标注参数，以及未迁入的导出类型引起的下游连锁报错。这只是证明“仅改后缀不能完成迁移”，**不代表 351 个运行 Bug，也不作为工作量估算**。

T0 时正式源码的 `npm run typecheck` 与 52 项单元测试通过；当时未重跑浏览器与完整发布验收。试验副本不是迁移成果，不复制回正式目录。后续 T1／T2 的验证另见第 8 节。

## 8. T1／T2 实施记录

2026-10-20。四个应用模块已迁为 `.ts`，对应四份 `.d.ts` 已删除，应用与 Node 测试的导入同步更新。沿用原 TS 配置与依赖，不增加 `allowJs`、忽略诊断指令或类型检查例外。

- **T1。** 尺寸解析标明字节辅助函数和尺寸返回值；提示词转换标明片段、分隔符、实体及权重结果。增加两项必要用例，覆盖 JPEG 标记、WebP 三种头与奇数长度元数据、截断拒绝，以及嵌套／零权重、转义、实体和换行。
- **会话。** 复用 `storage/records.ts` 的权威类型。Map／Set、分支、版本和消息均受实现检查；布尔排序显式转数字，结果完成先找到首张图片再更新状态。复制时只有当前源轮次的 ID 使用已填充 Map 的非空不变量，缺失引用仍保留原 fallback／过滤行为。
- **媒体。** 保留所有真实导出，增加 `ChatPayload`／`NAIEditPayload`／`UpscalePayload`／`EditorPayload` 联合类型。重绘要求蒙版；图生图与放大不能携带蒙版；原生放大与专用放大的选项不同。数值校验保持原顺序、范围、默认值和错误，显式组装必需字段，避免以宽泛字典或断言冒充完整输出。
- **行为边界。** 新增两项会话／媒体用例核对稳定排序、缺失引用、完成保护、首图选择、空报价、数值转换、Seed 0、源图要求与输出字段。没有改 UI 模板／样式、持久化结构、收费流程、调度或原生驱动。

| 本轮实际检查 | 结果 |
| --- | --- |
| T1 `npm run check` | 字体／样式／严格类型／54 项单元／生产构建通过 |
| T2 `npm run check` | 字体／样式／严格类型／56 项单元／生产构建通过 |
| `npm run test:services` | 6 项通过；数据租约、任务槽、凭据、备份与原图字节 |
| `npm run test:workspaces` | 11 项通过；对话／编辑、费用字段、四视口、高频所有权与资源生命周期 |
| 同一组用例对照迁移前实现 | 绘图与会话共 13 项在 `2fd8863` 的四个 JS 模块上同样通过，包括全部新增边界用例 |
| 临时类型契约探针 | 请求可传入网关；重绘必需蒙版；其他模式排除蒙版；会话返回值无 any，检查通过 |

T2 最终共 **73 项不同的自动化用例通过（56 单元＋6 服务＋11 工作区）**；T1、基线对照和临时类型探针不重复计数。浏览器套件使用模拟网关和合成图片，覆盖 320／390／768／1440px；未执行真实收费请求。T2 阶段未重跑 shell、shared、drawing、local、release 全部浏览器／发布套件；后续 T5 全量收口见第 10 节。

对照副本与类型探针位于忽略提交的 `.local/ts-migration/t12/`，不进入正式包。四个已迁模块的旧导入已清除，Vue 变更仅为模块路径。T2 完成时剩余 JS 为 image-meta、native-images、comparison、mask-editor、tile-wave，共 **5 个、976 行**；后续实施见下节。

## 9. T3／T4 实施记录

2026-10-20。剩余五个应用模块已迁为 `.ts`，移除五份配对声明，服务、Vue 与测试调用方同步使用新实现。没有改动模板、CSS、依赖或 TS 检查配置。

- **图片元数据。** `ImageFields` 明确文本与数值字段；`cfg` 仅保留历史导入用途，文件中的 CFG Rescale 仍为只读 extras。JSON 从 `unknown` 收窄，嵌套属性保持原有空值与原始值装箱语义。压缩文本、JPEG 中文、采样器映射、`Number(null)`／`Number("")`、异常角色数据的拒绝结果保持原样。
- **二进制与合成。** 标明缓冲区、TypedArray、解压流、分块与 Blob；ZIP 解码擦除类型后的代码与旧实现一致。对比图明确 Canvas 上下文、解码图像联合类型与释放回调；成功、`Image.decode`／`onload` 回退、解码失败和取消均释放 Bitmap／Object URL，原布局和字体保持不变。
- **蒙版。** 笔画使用非空点列，清空记录通过联合类型区分，snapshot 结构不变。活动笔画、监听控制器与编码缓存分别表达可空状态；保留源像素坐标、32 阈值、撤销／重做、双指取消及三态缓存。
- **波浪。** 公开控制接口与内部 Canvas／visible 状态分离；图像源、边缘数组、计时器和完成回调有明确类型。共享 rAF、Observer、动效常量和公式不变，重置／销毁仍完成为 `false`，正常揭示为 `true`，减弱动态／后台／离屏保持跳过。
- **明确的失败分支调整。** 蒙版与波浪在 `getContext("2d")` 返回 `null` 时，改为抛出「当前浏览器不支持 Canvas 蒙版／动画」，代替后续偶发的空对象 TypeError；波浪初始化失败同时移除刚创建的 Canvas。只影响无法获得 Canvas 上下文的环境；该分支已单独验证，未把它描述为错误文本完全不变。

严格类型检查、生产构建与阶段回归记录见下表；测试只使用模拟网关和合成图片。

| 本轮实际检查 | 结果 |
| --- | --- |
| T3、T4 `npm run check` | 字体／样式／严格类型／58 项单元／生产构建通过 |
| `npm run test:drawing` | 9 项通过；含新增对比图解码回退、取消与释放检查 |
| `npm run test:workspaces` | 13 项通过；原 11 项加蒙版状态／缓存与波浪完成／释放边界 |
| 迁移前实现对照 | 将元数据／ZIP 导入替换为 `2fd8863` 的 JS 实现后，绘图单元 9 项通过；对比图浏览器 1 项也在原 JS 上通过，不重复计入阶段总数 |
| 静态核对 | 五个模块的运行时导出保持一致；旧导入清除；Vue 模板／样式块逐个对照无变化，无新增类型忽略或 `any` 逃逸 |

T4 最终共 **80 项不同的自动化用例通过（58 单元＋9 绘图＋13 工作区）**。工作区回归保留 320／390／768／1440px，验证高频指针和波浪没有触发 Vue 组件逐帧更新，以及重复切换后的监听、Canvas、Observer 和 Object URL 清理；这不是长期内存压测结论。临时基线副本位于忽略提交的 `.local/ts-migration/t34/`，不进入正式包。

当前 `src/` 统计（含空行与注释，字节采用 UTF-8）：

| 应用源码 | 文件 | 行数 | 字节 |
| --- | ---: | ---: | ---: |
| TS 实现 | 64 | 9,883 | 338,341 |
| 环境声明 `env.d.ts` | 1 | 1 | 38 |
| Vue 单文件组件 | 33 | 9,652 | 310,629 |
| JS 实现 | 0 | 0 | 0 |

T4 结束时，9 个应用 JS 和配对声明已全部替换，尚待 T5 完成集中验收、发布包验证与脱敏复查。T3／T4 阶段没有提交、推送或部署；测试、服务器和工具脚本按计划保留 JS。后续收口记录如下。

## 10. T5 集中验收与收口

2026-10-20。沿用既有锁定依赖和 CI 检查顺序，在本地完成全部检查命令，没有新增测试框架、检查例外或业务改动。T1–T4 的实现与回归用例合并为本地提交 `26ae802`，验收文档单独提交。

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 字体／样式／严格类型／生产构建通过；58 项单元测试通过 |
| `node --test tests/shell.browser.mjs` | 6 项通过，复用 check 生成的生产构建 |
| `npm run test:services` | 6 项通过 |
| `npm run test:shared` | 13 项通过 |
| `npm run test:drawing` | 9 项通过 |
| `npm run test:workspaces` | 13 项通过 |
| `npm run test:local` | 2 项通过 |
| `npm run test:release` | 1 项通过 |

合计 **108 项不同的自动化用例全部通过，无失败、跳过或取消**。验证使用模拟网关、测试凭据和合成图片，没有真实收费请求；这是本地结果，不代表远端 CI 已运行。

收口核对结果：

- **实现与类型一致。** 对照 `2fd8863`，九个模块的运行时导出全部保留，直接／间接调用已接入新实现，无旧 `.js` 导入、转发壳或双份实现；九份配对声明已删除，只保留 `env.d.ts`。新迁入实现无显式 `any`、`@ts-ignore`、`@ts-nocheck` 或双重断言逃逸。
- **范围不变。** 七个受影响 Vue 文件的模板与样式块逐个对照一致；正式 CSS、依赖、TS 配置、网关、存储与连接 schema 均未修改。报价、`max_cost`、路线、额度、N=1、备份格式及图片字节由既有套件回归验证。Canvas 不可用时的明确报错与清理是第 9 节已记录的失败分支调整。
- **交互与生命周期。** 保留 320／390／768／1440px 四视口检查，高频指针与波浪不触发 Vue 逐帧更新；反复激活后的监听、Observer、Canvas 和 Object URL 清理通过，不增加性能跑分。
- **脱敏与配置边界。** 正式源码、测试、文档、资源和 `dist/` 的旧渠道标识／前缀及凭据特征扫描无命中，未发现敏感配置文件进入交付清单。默认连接仍为空；以合成服务端 URL／Key 重新构建，337 个静态文件与普通构建逐字节一致，产物不含测试值。
- **发布包。** 显式清单、逐文件 SHA-256、无 npm 依赖的解压运行、根路径／子路径和运行时代理注入均通过。包内只含应用交付文件和空环境模板，不包含测试、审计副本、真实配置或工作目录。

本地交付文件为 `.local/releases/koma-image-0.1.0.tar.gz` 与同名 `.sha256`；最终源码版本以包内 `release.json` 为准。检查日志与审计结果位于忽略提交的 `.local/ts-migration/t5/`。本轮未推送 GitHub 或部署 Pages。

**T0–T5 无剩余实施项。** `src/` 现有 64 个 TS 实现、33 个 Vue 组件、1 份环境声明和 0 个 JS 实现，详细规模见第 9 节。测试、服务器、工具及静态兼容脚本继续按第 7 节保留 JS；不以仓库语言占比作为后续改写理由。
