# NovelAI 官方接入与模型能力

更新：2026-10-25。官方 API 作为独立 `nai-official-v1` Profile；用户单独添加连接和 Key。本文区分已实现的请求与界面、真实只读验证、尚未接入的能力和真实生成待验项。发布版本与线上页面核验见[发布记录](archive/2026-10-25-nai-release-verification.md)，历史接口来源见[归档](archive/2026-10-25/README.md)。

## 适配结论

当前已覆盖五个型号的文生图、常规四型号的单图图生图、绘图页参数与模式、角色、账户额度、来源优先级，以及 V4.5 的 Vibe／Precise 生成准备、编码缓存和备份链路。它们已完成代码和本地模拟验证；官方 Key 与账户已有真实只读验证，公开 Furry 补全已有免鉴权只读核对。

真实文生图／图生图效果、参考编码与缓存命中、角色采用效果、实际扣费和订阅优惠尚未完成验证。当前不是官网图像功能的完整适配；单次消耗估算、官方重绘和独立工具等缺口见[后续工作](#后续工作与核验顺序)。

## 已接入能力

- **主机与鉴权**：订阅、余额与图片统一使用 `https://image.novelai.net`；账户只读请求为 `GET /user/subscription`，Bearer Key。设置明确说明 Key 仅发送到该主机；不从另一主机的连接自动转发已有 Key。
- **目录与账户**：账户鉴权成功、响应结构有效后提供本地静态 V5／V4.5 Full、Curated 及 V5 Full Medium 表；`active=false` 或零余额不等于 Key 无效，不阻止识别模型及余额。连接显示「Key 有效」，完整状态区分「订阅已激活／未订阅」，继续标注「生图尚未实测」。静态目录不承诺具体型号的账户权限、免费资格或实际生成成功。
- **基础生图／图生图**：`POST /ai/generate-image`，`input/model/action/parameters`；常规四型号图生图提交单张 PNG 底图和 strength／noise，读取 ZIP 原图。V5 Full Medium 当前只接文生图，请求层拒绝带底图编辑。
- **多角色**：按同一领域快照生成 `v4_prompt`／`v4_negative_prompt`，正负数组同序；自动定位关闭 `use_coords`，V4.5 发送格中心，V5 保留自由坐标。见[角色映射](multi-character-boards-plan.md#协议映射与元数据)。
- **额度**：读取订阅中的 `fixedTrainingStepsLeft` 与 `purchasedTrainingSteps`，有效值相加显示 Anlas，缺失显示未知。连接卡另行展示官方返回的 V5 `usage.percent`，正值 `purchasedPercent` 单列「V5 加购」，不与 Anlas 或主百分比相加；超过 100% 保留原值，仅进度条封顶。
- **V5 张数估算**：官方账户 Schema 的 `usage` 提供 `percent`、`purchasedPercent`、`isNegative`、`timeUntilNextPercent`，没有精确剩余图片数量。已激活 Opus 且用量可用时，按官方 FAQ 的 23 步、约 1MP 基准，将主百分比换算为「约 X 张」（100% 约 1,730 张，四舍五入）；提示中注明依据及尺寸、步数和 Effort 的影响。只使用主百分比，不叠加单列加购额度或折算 Anlas；未知、不可用或无 Opus 权益时不展示张数。不作为当前画板的报价或免费承诺。
- **V5 状态**：`isNegative=true` 标明额度暂不可用。未订阅／非 Opus 账号不因有百分比就被视为享有权益；有效 Opus 账号缺少用量时显示未知。卡片保留额度、进度条、张数估算与必要状态，不显示恢复时间。打开连接设置或手动测试成功后刷新，不新增轮询。
- **错误反馈**：连接失败保留具体原因；401 仍表示鉴权失败，403 表示访问被拒绝，明确返回的 Cloudflare 拦截单独说明，不据此断言 Key 无效。没有自动换域名或重试。
- **优先级与顶栏**：在连接页将官方连接上移到中转之前，即对其可用模型优先检查。V5 明确暂不可用、加购百分比为零且 Anlas 为零时，可在提交前选择后面的来源；余额／费用未知不跳过。官方 V5 生效时，顶栏同一行显示 NAI Logo、V5 百分比／约张数和 Anlas；V4.5 等非 V5 型号以订阅档位（Paper／Tablet／Scroll／Opus，或未订阅）代替百分比，与 Anlas 同排两段；不会混用标准网关的免费张数、积分或阈值。提交后失败不自动换源重试。

## 当前边界

本项目的官方 Profile 未实现预报价或费用上限，不发送 `max_cost`，不预占。常规型号声明基础 img2img 工具；Medium 当前只接文生图，官方蒙版重绘与放大尚未接入本项目。它们出现在官方文档或 Schema 中不代表本工程已完成适配或联调。

仅支持浏览器直连，依赖官方 CORS。本地代理支持标准网关和 ASK 两协议，不代理 NAI 官方。任务仍共用 N=1、支持取消、失败停止且不自动重试；标准网关原有报价与余额检查不变。

## 费用与额度的实现状态

账户余额读取与单次生成消耗估算独立。当前能展示 Anlas、V5 主百分比、加购百分比和基准下的约张数；尚不能根据当前画板准确给出单次 Anlas 或 V5 用量消耗，也未实现经核验的 Opus 免费资格判断。V4.5 不能一律视为免费，V5 的约张数也不是当前配置的单次报价。

没有有效报价时，绘图和编辑生成按钮暂时隐藏费用标签；内部仍保留未知费用状态，不记录为零费用。标准网关已有的有效报价、免费／不计额度标签和执行前报价保护保持。参考编码费和参考附加费仅用于已知费用下限检查，不能据此给出整次生成总价。订阅优惠、V5 消耗与回充规则仍待真实核验。

## 型号与模式覆盖

在 V4.5／V5 范围内，四个基础型号及 Full Medium 模式都在本地目录中。下表表示代码接入范围，不表示真实生成与扣费已经验证：

| 基础型号 | 当前规范 ID | 当前接入 | Vibe／Precise |
| --- | --- | --- | --- |
| V4.5 Full | `nai-diffusion-4-5-full` | 文生图、单图 img2img、角色参数 | 绘图页接入，仅官方来源 |
| V4.5 Curated | `nai-diffusion-4-5-curated` | 文生图、单图 img2img、角色参数 | 绘图页接入，仅官方来源 |
| V5 Full（High） | `nai-diffusion-5-full` | 文生图、单图 img2img、角色参数、透明底提示词开关 | 不开放 |
| V5 Curated | `nai-diffusion-5-curated` | 文生图、单图 img2img、角色参数、透明底提示词开关 | 不开放 |
| V5 Full Medium | `nai-diffusion-5-full-medium` | 仅文生图，支持角色正向、质量／Complexity／透明底 | 不开放 |

Full 与 Curated 主要是训练数据覆盖和取舍不同，并不是「收费版／免费版」。两代都有 Full／Curated；V5 的两者还有不同的提示长度限制。Furry／Background 是数据集提示词，不是需要增加的 V4.5／V5 独立型号。

**V5 Full 的 Effort 已接入 High／Medium**。High 使用常规模型；Medium 使用独立的 `nai-diffusion-5-full-medium`，不是只改步数。普通绘图模型菜单合并显示 V5 Full，在模型框下方的分段切档；供应商模型页仍分别管理两种真实 ID 的来源，只有具备对应来源才能切换。额度不足或来源消失不会将 Medium 静默降为 High。Curated／V4.5 不显示 Effort。

官方重绘模式仍未接入。官方公告说明 Medium 是蒸馏模型并公布约束，但公开 Schema 未列模型枚举；Medium wire ID 和 V5 `params_version: 4` 参考公开第三方 [novelai-python](https://github.com/LlmKira/novelai-python) 客户端，并经过本地请求模拟核验。这不是官方接口承诺或真实生成认证。官方重绘应独立核验模型、蒙版和费用；不将重绘变体混入普通文生图列表。

## V4.5 与 V5 的功能差异

以下依据官方产品专题；「项目状态」仅描述代码与模拟能力。标准中转提供的工具不能替代官方 Profile 的接入证明。

| 能力 | V4.5 Full／Curated | V5 Full／Curated | 项目状态 |
| --- | --- | --- | --- |
| 文生图、单张图生图 | 支持 | 常规 Full／Curated 支持；Medium 的编辑约束须独立核对 | 五型号文生图和常规四型号 img2img 已接线；Medium img2img 未接入，真实生成待验 |
| 多角色与定位 | 最多 6 个；5×5 网格 | 最多 22 个；自由坐标 | 已实现，切换模型保留本地角色与原坐标，发送时按能力检查 |
| 原生 Alpha 透明 | 不支持 | 两个型号均支持 | 开关只在支持的模型出现；附加 `transparent background`，保留原描述，不保证每次结果都有 Alpha |
| Effort | 无该切换 | 仅 Full：High／Medium | 已接入文生图；Medium 固定 14 步、Euler Ancestral，不发送自定义负向／角色负向／Rescale，仍可改 Guidance；High 参数在本地保留 |
| Complexity 标签 | 无 V5 的这组能力 | `low`／`medium`／`high`／`ultra complexity` | 已有独立选择器，发送时添加所选标签；影响画面复杂度和风格，不是 Effort 算力档位 |
| Precise Reference 精确参考 | 官方明确支持，含角色／风格／角色加风格，可结合重绘 | 官方专题明确仅 V4.5，不能宣称 V5 支持 | 已接绘图页上传、类型／强度／保真度、预处理和请求数组；与 Vibe 互斥，不等于角色文字提示或 img2img；真实效果待验 |
| Vibe Transfer | 两个型号在当前官网均有入口 | 当前官网 Full High／Medium、Curated 均无入口；通用专题的“V4 及以上”不足以证明 V5 可用 | 已接 V4.5 上传、生成时编码、本机缓存、强度／提取量、归一化及文件导入导出；真实编码、扣费与效果待验 |
| 提示词语言 | 主要英文，T5 对日文等 Unicode 有限制 | 多语言理解更强，官方明确举出日文等 | 原文发送，无按语言拦截；没有型号专用 tokenizer／超长校验 |
| 提示长度 | 基础与角色提示合计约 512 T5 tokens | Full 基础提示约 1,471 有效 tokens；Curated 约 703 | 未实现官方精确计数；不能用 ASK 文本模型的 token 估算代替 |
| 图中文字 | 英文，专页给出不超过 118 字符 | 英／日／中文等；Full 不超过 750 字符，Curated 374 | 可手写 `Text:`，无专用长度检查；字符数含空白与换行，不是提示 token 数 |
| Quality Tags | 两个型号的预设正文不同；开／关 | 两个型号均有 Light／Standard | V4.5 为关闭／Standard，V5 为关闭／Light／Standard；在请求快照展开质量词，不改输入原文 |
| Undesired Content 预设 | Full／Curated 的可选预设、正文有区别 | Full／Curated 有 Heavy、Light、Furry／Human 等；Medium 除外 | 按型号提供关闭／Light／Heavy／Human／Furry，V4.5 Curated 无 Furry；Medium 不提供负向控制 |
| 官方重绘与局部重绘 | 支持；含 Inpainting Strength、Focused Inpainting | 支持；Full Medium 也有重绘模式 | 本项目未接入官方重绘；中转编辑器已有重绘不代表官方适配完成 |
| Opus 额度 | 满足官方条件时有不限次数的免费生成 | 有单独的滚动用量额度；Medium 消耗较低 | 展示 Anlas／V5 用量，未知费用标签暂时隐藏；未实现单次消耗估算与经核验的免费规则 |

模型介绍页将文字长度写作 tokens，而专门的 Text Rendering 页明确写作 characters；文字绘制按专题的字符口径说明，不将其混作输入 token 上限。采样页面包含旧代 SMEA 说明，公共 Schema 的采样器也是任意字符串；不能据此把 SMEA／DYN 等旧能力直接开放给 V4.5／V5。

独立工具还包括官方 Upscale、Enhance 和 Director Tools（去背景、线稿、草图、上色、表情、去杂物），本项目没有完整接入。**生成时的透明底**是 V5 模型能力；**对现有图去背景**是独立 Director Tool，不应限制成「只有 V5 图片才能处理」。官方能力和计费须分别核验。

## Anime／Furry 模式

官方 [Models](https://docs.novelai.net/en/image/models) 明确 V4.5 Full／Curated、V5 Full／Curated 均可切 Anime／Furry。V4 也采用同类模式；V3 则有独立 Anime／Furry 型号，不能统一改成两个新模型 ID。V5 Full 的 High／Medium 与模式独立，官方 Effort 专题将两个开关放在一起；Medium 仍不支持用户负向与 UC 选择。

[Dataset Tags](https://docs.novelai.net/en/image/tags#dataset-tags) 规定 Furry 模式以 `fur dataset` 开头，并把 Tag 补全切到 Furry 数据集；Anime 模式无须新增一个虚构的 `anime dataset` 参数。V4.5 及以上另有 `background dataset` 标签，不等于这组开关中的第三个选项。Furry Focus／Human Focus 是 UC 预设，和 Anime／Furry 模式不同；V4.5 Curated 虽没有 Furry Focus UC，仍支持 Furry 模式。

绘图模型区位于画板与提示词之间。模型框只放模型名，按钮与菜单统一显示官方全称（如 `NAI Diffusion V5 Full`）；标准网关提供的 NAI 型号也按 ID 显示官方名称，其他模型沿用连接目录名称。模型框下方并排 Anime｜Furry 与 High｜Medium 两组分段，直接点选；Curated／V4.5 隐藏 Effort，模式分段占满整行并带樱花／爪垫图标。模式默认 Anime，随画板、历史参数、备份和 ASK 参数恢复保存。旧 Koma v2 数据缺少模式时默认 Anime。

Furry 模式只在有效基础提示词首位补充 `fur dataset`，原文不变，不创建另一套模型 ID，也不联动质量／负向预设。自动补充时会去重正文中已有的裸 `fur dataset`；人工首位前缀保持原样；`Text:` 内的文字不参与处理。原文已以 `fur dataset` 或 `background dataset` 开头时，显式标签优先；前者显示 Furry 并禁用 Anime 选项，后者保留原标签并禁用 Furry 选项，提示先移除手写标签。不会因切模式静默删改用户原文。外部有效词文导入重置自动模式，手写前缀仍有效；本机历史复用恢复原文及模式。

绘图的基础／角色输入补全及页内查词面板跟随有效模式：Anime 沿用中英词典与 Danbooru；Furry 查询公开的 `https://image.novelai.net/ai/generate-image/suggest-tags`，用已核对的 `model=nai-diffusion-furry-3` 词库标识和当前查询片段 `prompt`。这是补全词库标识，生图仍使用当前 V4.5／V5 型号，不代表官方保证 V5 词库完全等价。只发送查询片段，不发送 Key 或完整绘图描述；补全缓存按数据集隔离，切换即取消旧查询、清空旧候选。Furry 结果没有 Danbooru 分类字段，保留服务端次序、标注 Furry，不套用动漫分类过滤；中文查询提示使用英文，失败不会退回动漫词库。完整词典及其他工作区沿用原有中英词典。

## 界面与参数边界

- Prompt 框底部放 Complexity、质量和透明底，Negative 页同一位置放负向预设。使用站内裸按钮与菜单，不增加输入区总高度。关闭时只显示入口，选中时显示档位；透明底使用图标开关。V4.5 隐藏 Complexity／透明底，保留本地选择；换回 V5 恢复。V4.5 的质量入口目前仍在 Prompt 底栏，仅提供关闭／Standard，并未迁入参数抽屉。底栏背景覆盖至右边缘，滚动文字不从手柄旁透出；原生拖动调整高度仍可用。
- 模型名独占模型框，模式与 Effort 是框下方的两组分段；模型及提示词底栏菜单复用站内实色浮层，取消重复标题与选中整圈描边，以字重和紫色勾区分选择。Medium 显示固定 14 步／Euler Ancestral，禁用 Rescale，基础与角色负向只读；本地 High 参数不被覆盖。请求层再次约束有效参数，不能只靠禁用 UI。
- `Guidance` 对应 `scale`，即 CFG Scale（提示词引导强度）。`Guidance Rescale` 对应独立的 `cfg_rescale`，范围 0–1、默认 0，用于缓和高 Guidance 导致的过饱和／高对比。两者有关联但不是同一参数。旧中转 `cfg` 仍在本地及标准网关保留，界面不再将其当官方控制项，官方请求不发送 `cfg`，旧值 10 不会被换算成 Rescale。
- 质量、负向和 Complexity 默认关闭，保留既有输入。`domain/nai.ts` 集中管理官方预设正文和型号能力；只在出站快照扩展，保留原始正负词和角色负向。自动标签置于 `Text:` 前，只去重相同的字面标签，不改用户权重／手写词。历史复用使用原文与预设；外部元数据导入有效词文时关闭对应自动追加，避免重复。Rescale 可独立导入。旧 Koma v2 备份缺少新字段时读取默认值。
- 预设已由客户端展开，原生请求不再固定开启质量／Heavy：普通模式使用关闭自动追加的标记；V5 官方使用版本 4 与字符串预设 ID，Medium 使用固定 `heavy` ID，仍不发送用户负向。标准网关保留版本 3、原 `cfg`、报价和 `max_cost`；Studio／报价与原生获得相同的有效词文，新增 Rescale 直接传递。
- 常规型号仍共用采样器列表和面积上限，`noise_schedule` 固定 `karras`，`dynamic_thresholding` 关闭；Variety Boost 等尚未实现。Medium 官方图生图／重绘、其他模式参数与实际消耗须单独核验。
- 不提供服务端缓存，请求固定 `cache: false`、`optimize: false`。「去除元数据」在本机删除结果 PNG 的文本、EXIF 与时间块，不重编码、不改像素，透明结果保留 Alpha。编辑器沿用自身参数，尚无本次绘图页的预设入口与可调 Rescale。
- ASK 接收新字段并可从历史审阅恢复；模型知识已将 Complexity 修正为画面复杂度。已有工具权限、草稿确认和不自动生成的边界保持。

## Vibe 与精确参考边界

2026-10-25 在未登录的[官方生图页](https://novelai.net/image)逐一切换核对：V4.5 Full／Curated 的 Reference Images 分区同时显示 Image2Image、Vibe Transfer、Precise Reference；V5 Curated、V5 Full High／Medium 只显示 Image2Image。Vibe 通用专题仍写“V4 及以上”，与当前界面存在范围差异，不能据此直接开放 V5。界面未显示不等于已证明 API 必然拒绝；在有进一步契约证据之前，V5 Vibe 保持未核验。精确参考则由官方专题明确限定 V4.5，并与 Vibe 互斥。

Vibe 使用强度与信息提取量，最多 16 个；V4 及以上首次编码每份 2 Anlas，修改提取量需重新编码；超过 4 个后，每多一个，每张生成附加 2 Anlas。官方支持本机编码缓存、`.naiv4vibe`／Bundle 导入导出和从 PNG 元数据恢复编码；仅编码导入没有原图，不能修改提取量。编码缓存只在本机。

精确参考有角色、风格、角色＋风格三类及 Strength／Fidelity 两个控制；每张参考每张生成附加 5 Anlas。多张角色参考会混合特征，不能视为独立角色绑定。图片等比缩放并黑边填入官方三种大画布；可配合官方重绘，但本工程未接入。公开客户端上限为 16 张；当前 UI 的 Strength／Fidelity 采用 0–1，类型对应 `character`／`style`／`character&style`，Fidelity 映射为接口 secondary strength 的 `1 - Fidelity`。

绘图页使用已确认的统一底部抽屉：参数／Vibe／Precise 三段入口位于内容上方，启用开关只放在正在查看的参考段旁。浏览和上传不会启用参考；启用两组互斥，独立配置保留。64×80 缩略图横向滚动，不显示文件名；每张通过眼睛图标控制参与。原有参数滑杆样式不变，生成按钮前固定保留 12px 非滚动空间；不支持参考时收为单一参数入口。切换到不支持的型号或来源后，若仍有启用参考则阻止生成并提供停用入口。

收费编码只在显式生成取得 `runTask` 槽位后执行。Vibe 通过官方 `POST /ai/encode-vibe` 发送原始图片 base64、型号及提取量，读取有界二进制响应；缓存按原图内容哈希＋准确型号＋提取量区分。上传、调参、恢复与预报价均不编码。每份成功编码立即经 `data.write` 落库；后续生成失败或取消不丢缓存，也不自动重试编码。生成发送编码后的 `reference_image_multiple` 和 `reference_strength_multiple`，不重复发送提取量数组。归一化只在多图绝对强度总和超过 1 时生效。

Precise 用 Canvas 高质量插值等比缩放并居中填黑边，目标从 1024×1536／1536×1024／1472×1472 中按比例差选择；发送 PNG base64 及配对的描述、信息量、强度和反向 Fidelity 数组。插值实现与官网的 Lanczos 不完全相同，真实效果待验。当前两组均只开放准确映射到官方 V4.5 的来源；不假设标准中转具有相同参考协议。源选择检查已知参考附加费和待编码费下限；余额未知仍可用，整次费用保留未知状态且不显示按钮费用标签。参考准备后固定原画板、配置和连接上下文，不能换源重试。

参考配置随画板和结果参数保留，原图／缩略图与编码分别存在 `koma-image-favorites` 的 `referenceAssets`／`vibeEncodings`；普通 Koma v2 备份包含其资源闭包及编码校验，恢复不触发上游。支持官方 v1 Vibe／Bundle 的原图和编码文件导入导出；仅编码导入锁定提取量，缺当前型号编码时拒绝导入；带 Mask 或未支持的编码参数明确拒绝。Precise 使用独立的 Koma JSON 格式。外部 PNG 元数据中的参考编码恢复仍未接入；本机历史参数导入可恢复配置。ASK 仅接收不含图片与编码的参考摘要，不因此新增写入权限。

公开字段依据与本地模拟边界见[实施核验](archive/2026-10-25-nai-references-integration.md)，前期能力勘探见[研究记录](archive/2026-10-25-nai-references-research.md)。

## 后续工作与核验顺序

| 顺序 | 工作 | 当前缺口与验收边界 |
| --- | --- | --- |
| 1 | 现有链路的真实验证 | 五型号文生图、常规四型号 img2img、多角色、Vibe 编码／缓存命中与 Precise／Vibe 效果；逐项记录请求、原图和前后额度。账户只读、模拟成功及线上页面加载都不能代替这一步 |
| 2 | 单次消耗与账户规则 | 根据型号、Effort、尺寸、步数及参考配置核验 Anlas／V5 用量估算，核验 Opus 免费资格、加购额度与回充规则；当前没有这套完整计算，未知标签隐藏不等于免费 |
| 3 | 基础参数和编辑器收口 | 按型号核验尺寸／步数／采样器限制、固定 `karras` 等请求参数；补齐 Variety Boost 等已确认适用的控制。编辑器尚无绘图页的预设入口与可调 Rescale；中转缓存／JPEG 选项不能宣称为官方同名能力 |
| 4 | 官方编辑与独立工具 | Medium img2img、官方重绘／局部重绘及 Focused Inpainting 尚未接入；Upscale、Enhance、Director Tools 也未接入。须逐项核对操作、模型、蒙版、预处理、返回与费用，不能复用中转能力声明 |
| 5 | 导入与输入检查 | 外部 PNG 中的参考编码恢复、NAI 型号专用 token 计数与超长校验、`Text:` 字符限制检查尚未实现；Vibe 文件／Bundle 与 Koma 备份往返已有接线 |
| 6 | 界面精简 | V4.5 只有质量入口时仍保留 Prompt 底栏；改成参数抽屉内开关尚未实施。这是界面精简项，质量标签功能本身已接入 |

V5 的两种参考保持不开放：Precise 官方专题限定 V4.5，Vibe 的通用说明与所观察官网入口存在差异。获得进一步能力证据前，不把 V5 参考列成已确认应实现的缺口。

真实收费验证须单独取得授权。后续每项检查 UI、请求、参数导入／恢复、原图字节与额度影响；不因此新增生成自动重试或付费确认。当前模拟和线上页面验证范围见[发布核验](archive/2026-10-25-nai-release-verification.md)。

公开参考为[图片 Schema](https://image.novelai.net/docs/doc.json)、[当前 API 文档](https://image.novelai.net/docs/index.html)、[产品说明](https://docs.novelai.net/en/image/)及 [Opus 用量 FAQ](https://docs.novelai.net/en/faq)。型号与功能依据为[Models](https://docs.novelai.net/en/image/models)、[Effort](https://docs.novelai.net/en/image/effort)、[特殊标签](https://docs.novelai.net/en/image/tags)、[角色](https://docs.novelai.net/en/image/multiplecharacters)、[精确参考](https://docs.novelai.net/en/image/precisereference)、[Vibe](https://docs.novelai.net/en/image/vibetransfer)、[文字绘制](https://docs.novelai.net/en/image/textrendering)、[质量预设](https://docs.novelai.net/en/image/qualitytags)、[负向预设](https://docs.novelai.net/en/image/undesiredcontent)、[重绘](https://docs.novelai.net/en/image/inpaint)和[Director Tools](https://docs.novelai.net/en/image/directortools)。

2026-10-25 的验证过程见[连接验证记录](archive/2026-10-25-novelai-connection-check.md)、[V5 额度展示验证](archive/2026-10-25-novelai-v5-usage.md)与[模型能力核对](archive/2026-10-25-novelai-model-capabilities.md)；旧读取日期与证据保存在历史归档。

本次控件与协议兼容的模拟证据见 [NAI 参数兼容记录](archive/2026-10-25-nai-controls.md)。

模式与菜单整理的模拟证据见 [NAI 模式与菜单记录](archive/2026-10-25-nai-modes.md)。
