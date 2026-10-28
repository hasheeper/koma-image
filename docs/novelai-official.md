# NovelAI 官方接入与模型能力

更新：2026-10-28。官方 API 作为独立 `nai-official-v1` Profile；用户单独添加连接和 Key。本文区分已实现的请求与界面、真实只读验证、尚未接入的能力和真实生成待验项。当前发布版本与线上页面核验见[本轮发布记录](archive/2026-10-28-home-edit-nai-release-verification.md)，历史接口来源见[归档](archive/2026-10-25/README.md)。

## 适配结论

当前已覆盖五个型号的文生图／单图图生图、V4.5 与 V5 Full High／Medium 四型号的普通／聚焦蒙版重绘，以及官方 4× 放大、绘图页参数与模式、角色、账户额度、来源优先级，以及 V4.5 的 Vibe／Precise 生成准备、编码缓存和备份链路。它们已完成代码和本地模拟验证；官方 Key 与账户已有真实只读验证，公开 Furry 补全已有免鉴权只读核对。

普通 Enhance 已在官方五型号图生图中接入，V5 三型号另提供 Max；EDIT 另有六项 Director Tools。真实文生图／图生图／Enhance／重绘／放大／Director Tools 效果、参考编码与缓存命中、角色采用效果、实际扣费和订阅优惠尚未完成验证。本地单次消耗估算、输入检查及 PNG 参考编码恢复已接入，剩余边界见[后续工作](#后续工作与核验顺序)。

## 已接入能力

- **主机与鉴权**：订阅、余额与图片统一使用 `https://image.novelai.net`；账户只读请求为 `GET /user/subscription`，Bearer Key。设置明确说明 Key 仅发送到该主机；不从另一主机的连接自动转发已有 Key。
- **目录与账户**：账户鉴权成功、响应结构有效后提供本地静态 V5／V4.5 Full、Curated 及 V5 Full Medium 表；`active=false` 或零余额不等于 Key 无效，不阻止识别模型及余额。连接显示「Key 有效」，完整状态区分「订阅已激活／未订阅」，继续标注「生图尚未实测」。静态目录不承诺具体型号的账户权限、免费资格或实际生成成功。
- **基础生图／图生图**：`POST /ai/generate-image`，`input/model/action/parameters`；五型号图生图提交单张 PNG 底图和 strength／noise，读取 ZIP 原图，包含 Full Medium。
- **普通蒙版重绘**：同一接口使用 `action: infill` 与对应 `-inpainting` 型号，不把重绘变体加入生图菜单。发送源尺寸黑白 PNG 蒙版；局部强度低于 1 时映射为 `parameters.img2img.strength` 与 `color_correct: true`。收到同尺寸结果后本机合成，保证蒙版外保留原图像素。
- **聚焦重绘（Focused Inpainting）**：在同一重绘面板中手动画蒙版、手动框选周边参考范围，客户端裁切／放大到约 1MP 后发送一次普通 `infill`，再缩回并合成原尺寸整图；不自动识别主体、不新增上游 Focused 标记。详见[聚焦重绘](#聚焦重绘focused-inpainting)。
- **官方放大**：`POST /ai/upscale`，multipart `image` 与 JSON `request`，固定 `model: nai-diffusion-5-full`、`declared_blur_sigma: 0`；原图字节不重编码，输出宽高各 4 倍，保留 ZIP／直接图片返回。源图面积上限 3,145,728 像素。菜单使用独立 NovelAI Upscale 一行并展示目标尺寸；不假装每个生图型号都有一套独立放大器。
- **Director Tools**：EDIT 画布工具栏提供去背景、线稿、草图、上色、表情与去杂物，独立调用 `POST /ai/augment-image`；处理当前查看图，不受来源图片的生成型号限制。去背景的三种结果同组切换，不重复请求。详见[工具协议](#director-tools)。
- **多角色**：按同一领域快照生成 `v4_prompt`／`v4_negative_prompt`，正负数组同序；自动定位关闭 `use_coords`，V4.5 发送格中心，V5 保留自由坐标。见[角色映射](multi-character-boards.md#协议映射与元数据)。
- **额度**：读取订阅中的 `fixedTrainingStepsLeft` 与 `purchasedTrainingSteps`，有效值相加显示 Anlas，缺失显示未知。连接卡另行展示官方返回的 V5 `usage.percent`，正值 `purchasedPercent` 单列「V5 加购」，不与 Anlas 或主百分比相加；超过 100% 保留原值，仅进度条封顶。
- **V5 张数估算**：官方账户 Schema 的 `usage` 提供 `percent`、`purchasedPercent`、`isNegative`、`timeUntilNextPercent`，没有精确剩余图片数量。已激活 Opus 且用量可用时，按官方 FAQ 的 23 步、约 1MP 基准，将主百分比换算为「约 X 张」（100% 约 1,730 张，四舍五入）；提示中注明依据及尺寸、步数和 Effort 的影响。只使用主百分比，不叠加单列加购额度或折算 Anlas；未知、不可用或无 Opus 权益时不展示张数。不作为当前画板的报价或免费承诺。
- **V5 状态**：`isNegative=true` 标明额度暂不可用。未订阅／非 Opus 账号不因有百分比就被视为享有权益；有效 Opus 账号缺少用量时显示未知。卡片保留额度、进度条、张数估算与必要状态，不显示恢复时间。打开连接设置或手动测试成功后刷新，不新增轮询。
- **错误反馈**：连接失败保留具体原因；401 仍表示鉴权失败，403 表示访问被拒绝，明确返回的 Cloudflare 拦截单独说明，不据此断言 Key 无效。没有自动换域名或重试。
- **优先级与顶栏**：在连接页将官方连接上移到中转之前，即对其可用模型优先检查。V5 明确暂不可用、加购百分比为零且 Anlas 为零时，可在提交前选择后面的来源；余额／费用未知不跳过。官方 V5 生效时，顶栏同一行显示 NAI Logo、V5 百分比／约张数和 Anlas；V4.5 等非 V5 型号以订阅档位（Paper／Tablet／Scroll／Opus，或未订阅）代替百分比，与 Anlas 同排两段；不会混用标准网关的免费张数、积分或阈值。提交后失败不自动换源重试。

## 当前边界

本项目的官方 Profile 提供本地估算，没有服务端预报价或费用上限，不发送 `max_cost`，不预占。五型号声明 img2img／upscale，普通 Inpaint 仅声明 V4.5 Full／Curated 与 V5 Full High／Medium；普通编辑要求宽高至少 64、64 像素对齐、面积不超过 3,145,728，不额外限制 2048 单边；8MB 是 Koma 本地文件限制，放大遵守独立面积上限。能力来自公开客户端与接口资料，已完成模拟验证，不代表真实供应商联调成功。

仅支持浏览器直连，依赖官方 CORS。本地代理支持标准网关和 ASK 两协议，不代理 NAI 官方。任务仍共用 N=1、支持取消、失败停止且不自动重试；标准网关原有报价与余额检查不变。

## 费用与额度的实现状态

账户余额与单次消耗分开。绘图／EDIT 按 2026-10-28 公开客户端的尺寸、步数、Effort 和编辑强度计算 Anlas，生成按钮标为 `≈N Anlas`；提交前重新读取账户。官方 4× Upscale 按源面积分档估算，不享受 Opus 免费。普通 Enhance 使用实际请求尺寸，Max 使用官网的原尺寸请求规则；聚焦重绘使用裁切放大后的请求尺寸。

Opus 基础免费资格要求有效订阅、tier ≥3、面积 ≤1,048,576、步数 ≤28，且未使用 Precise；V5 还要求可确认 `usage.isNegative=false`。订阅到期时间和官方特殊账户类型参与判断。缺少影响判断的账户信息时保持未知，不猜测免费。免费资格只参与内部判断，生成按钮不显示「Opus 免费」或零费标签。V5 内部按 FAQ 的 23 步／1MP／约 1,730 张基准估算用量百分比，尺寸、步数与 Medium 系数参与换算；按已确认的界面要求，该近似百分比不在生成按钮展示。此百分比是基准近似，官方未公开精确用量公式，不用于额度拦截，也不承诺实际扣费或回充。

Vibe 超过 4 张后的每张附加费、Precise 每参考 5 Anlas，以及待编码 Vibe 每个唯一「资源＋型号＋提取量」2 Anlas 一并计入。串行批量仅首张计入待编码费，后续复用成功缓存；费用包含编码时不能显示免费。未知费用仍隐藏按钮标签，不记录为零费用。已知 Anlas 不足时复用现有提交前选源；额度未知保留优先级，不新增确认、重试或预占。标准网关的服务端报价、`max_cost`、积分和涨价规则保持。实际账单、Opus 资格与用量效果仍待真实验证。

## 输入预算与图片参数导入

IMAGE／EDIT 的原字符小计位置改为 token 数，悬停／辅助阅读显示共享预算：V4.5 使用 T5、512 tokens；V5 Curated 使用 Qwen3.5、703 tokens；V5 Full High／Medium 为 1471。基础与启用角色合计，正负预算独立，计入生效预设及 Enhance 追加词；停用角色不参与，Medium 使用实际固定负向。超限变色并提示上游可能截断，生成时提醒，保留用户原文。

计数在按需 Worker 中完成，本地加载 T5／Qwen3.5 公开许可词表，不向第三方发送提示词。词表首次载入、失败和未知状态分别显示；缓存有界，空闲终止 Worker。`Text:` 按 Unicode 字符计入标记后的正文、空格与换行，V4.5／V5 Curated／V5 Full 上限分别为 118／374／750，超限在付费编码与生成之前拦截。只检查显式 `Text:`，不添加 V5 自动引号提取功能。

参数导入沿用 PNG 文本／压缩文本、JPEG、NAI／WebUI 和对照勾选；新增官方 `stealth_pngcomp` Alpha LSB 隐藏元数据读取，解压和像素分配有上限。可见字段优先，隐藏数据补足缺失字段；损坏隐藏数据不丢弃正常文本参数。外部 PNG 中的 `reference_image_multiple` 按配对强度、提取量、归一化和 V4.5 型号恢复为可勾选的「参考」项，仅点击导入后经数据租约保存至现有资源／编码缓存。只恢复 PNG 内实际附带的编码，不能从成图反推参考原图或 Precise 图片。编码型号不匹配或损坏时禁用该项，普通参数仍可导入；只编码参考锁定提取量。导入 Vibe 保留当前 Precise 配置，历史、备份及 `.naiv4vibe` 链路继续共用原缓存。结果「去除元数据」仍只删除文本、EXIF 与时间块，不重编码 Alpha 像素。

本轮实现与模拟／静态产物检查见[收口核验](archive/2026-10-28-nai-cost-input-import-verification.md)。

## 型号与模式覆盖

在 V4.5／V5 范围内，四个基础型号及 Full Medium 模式都在本地目录中。下表表示代码接入范围，不表示真实生成与扣费已经验证：

| 基础型号 | 当前规范 ID | 当前接入 | Vibe／Precise |
| --- | --- | --- | --- |
| V4.5 Full | `nai-diffusion-4-5-full` | 文生图、单图 img2img、普通／聚焦 Inpaint、角色参数 | 绘图／img2img 接入，仅官方；Inpaint 仅 Precise |
| V4.5 Curated | `nai-diffusion-4-5-curated` | 文生图、单图 img2img、普通／聚焦 Inpaint、角色参数 | 绘图／img2img 接入，仅官方；Inpaint 仅 Precise |
| V5 Full（High） | `nai-diffusion-5-full` | 文生图、单图 img2img、普通／聚焦 Inpaint、角色参数、透明底提示词开关 | 不开放 |
| V5 Curated | `nai-diffusion-5-curated` | 文生图、单图 img2img、角色参数、透明底提示词开关；无独立 Inpaint 接口 | 不开放 |
| V5 Full Medium | `nai-diffusion-5-full-medium` | 文生图、img2img、普通／聚焦 Inpaint；保留角色正向、质量／Complexity／透明底 | 不开放 |

Full 与 Curated 主要是训练数据覆盖和取舍不同，并不是「收费版／免费版」。两代都有 Full／Curated；V5 的两者还有不同的提示长度限制。Furry／Background 是数据集提示词，不是需要增加的 V4.5／V5 独立型号。

**V5 Full 的 Effort 已接入 High／Medium**。High 使用常规模型；Medium 使用独立的 `nai-diffusion-5-full-medium`，不是只改步数。普通绘图模型菜单合并显示 V5 Full，在模型框下方的分段切档；供应商模型页仍分别管理两种真实 ID 的来源，只有具备对应来源才能切换。额度不足或来源消失不会将 Medium 静默降为 High。Curated／V4.5 不显示 Effort。

官方普通重绘已按操作映射到四个 `-inpainting` 型号；Medium 保留 14 步、Euler Ancestral、自定义负向与 Rescale 约束。型号映射、局部强度与参考边界参考官网公开客户端；4× 放大的 multipart 字段另与公开第三方 [novelai-python](https://github.com/LlmKira/novelai-python) 核对。虽然客户端枚举包含 V5 Curated 重绘名称，实际映射使用 V4.5 Curated；SDK 也明确指出 V5 Curated 的独立重绘接口不存在。本项目不声明该组合，不将请求静默换成 V4.5，用户可以在重绘菜单中明确选择 V4.5 Curated 或其他支持的型号。接口依据和验证边界见[基础编辑适配](archive/2026-10-27-nai-basic-edit-verification.md)。

## V4.5 与 V5 的功能差异

以下依据官方产品专题；「项目状态」仅描述代码与模拟能力。标准中转提供的工具不能替代官方 Profile 的接入证明。

| 能力 | V4.5 Full／Curated | V5 Full／Curated | 项目状态 |
| --- | --- | --- | --- |
| 文生图、单张图生图 | 支持 | Full／Curated／Full Medium 支持 | 五型号文生图与 img2img 已接线，真实生成待验 |
| 多角色与定位 | 最多 6 个；5×5 网格 | 最多 22 个；自由坐标 | 已实现，切换模型保留本地角色与原坐标，发送时按能力检查 |
| 原生 Alpha 透明 | 不支持 | 两个型号均支持 | 开关只在支持的模型出现；附加 `transparent background`，保留原描述，不保证每次结果都有 Alpha |
| Effort | 无该切换 | 仅 Full：High／Medium | 已接入文生图／图生图／普通重绘；Medium 固定 14 步、Euler Ancestral 和 Heavy 负向正文，不发送自定义负向／角色负向／Rescale，仍可改 Guidance；High 参数在本地保留 |
| Complexity 标签 | 无 V5 的这组能力 | `low`／`medium`／`high`／`ultra complexity` | 已有独立选择器，发送时添加所选标签；影响画面复杂度和风格，不是 Effort 算力档位 |
| Precise Reference 精确参考 | 官方明确支持，含角色／风格／角色加风格，可结合重绘 | 官方专题明确仅 V4.5，不能宣称 V5 支持 | 已接绘图页上传、类型／强度／保真度、预处理和请求数组；与 Vibe 互斥，不等于角色文字提示或 img2img；真实效果待验 |
| Vibe Transfer | 两个型号在当前官网均有入口 | 当前官网 Full High／Medium、Curated 均无入口；通用专题的“V4 及以上”不足以证明 V5 可用 | 已接 V4.5 上传、生成时编码、本机缓存、强度／提取量、归一化及文件导入导出；真实编码、扣费与效果待验 |
| 提示词语言 | 主要英文，T5 对日文等 Unicode 有限制 | 多语言理解更强，官方明确举出日文等 | 原文发送，无按语言拦截；本地 T5／Qwen3.5 计数，超长提示不改原文 |
| 提示长度 | 基础与角色提示合计约 512 T5 tokens | Full 基础提示约 1,471 有效 tokens；Curated 约 703 | 已按型号词表及公开客户端预处理计数；正负预算独立，合计启用角色，不使用 ASK 文本估算代替 |
| 图中文字 | 英文，专页给出不超过 118 字符 | 英／日／中文等；Full 不超过 750 字符，Curated 374 | 可手写 `Text:`，按 Unicode 字符检查专用上限；含空白与换行，超限在编码／生成前拦截 |
| Quality Tags | 两个型号的预设正文不同；开／关 | 两个型号均有 Light／Standard | V4.5 为关闭／Standard，V5 为关闭／Light／Standard；在请求快照展开质量词，不改输入原文 |
| Undesired Content 预设 | Full／Curated 的可选预设、正文有区别 | Full／Curated 有 Heavy、Light、Furry／Human 等；Medium 除外 | 按型号提供关闭／Light／Heavy／Human／Furry，V4.5 Curated 无 Furry；Medium 不提供负向控制 |
| 官方重绘与局部重绘 | 支持；含 Inpainting Strength、Focused Inpainting | Full High／Medium 有独立重绘；Curated 在官网转用 V4.5 Curated | 已接四型号普通／聚焦蒙版重绘与局部强度，不静默跨型号转换；聚焦范围由用户框选，真实效果待验 |
| Opus 额度 | 满足官方条件时有不限次数的免费生成 | 有单独的滚动用量额度；Medium 消耗较低 | 已接本地 Anlas 估算与 Opus 资格判断；按钮不显示免费或 V5 用量估算，实际权益与扣费仍待核验 |

模型介绍页将文字长度写作 tokens，而专门的 Text Rendering 页明确写作 characters；文字绘制按专题的字符口径说明，不将其混作输入 token 上限。采样页面包含旧代 SMEA 说明，公共 Schema 的采样器也是任意字符串；不能据此把 SMEA／DYN 等旧能力直接开放给 V4.5／V5。

官方 Upscale 已接入独立 4× 链路，普通 Enhance 与 V5 Max Enhance 复用 Img2Img，六项 Director Tools 使用独立工具协议。**生成时的透明底**是 V5 模型能力；**对现有图去背景**不限制图片来源型号。官方能力和计费须分别核验。

## Director Tools

六项工具只在配置 NovelAI 官方来源时可执行，与左侧生图模型、强度、蒙版、角色和参考配置独立。画布工具栏的魔棒入口打开紧凑面板，底部单行图标与名称选择工具，参数向上展开；窄屏横向滚动，不增加左侧表单内容。执行使用当前查看版本，提交时冻结画板、底图与工具设置。

| 工具 | `req_type` | 额外参数与结果 |
| --- | --- | --- |
| 去背景 | `bg-removal` | 三张结果：抠图 `masked`、重建 `generated`、混合 `blend`；保留透明通道 |
| 线稿 | `lineart` | 单张图片 |
| 草图 | `sketch` | 单张图片 |
| 上色 | `colorize` | 可选 Prompt、`defry` 整数 0–5 |
| 表情 | `emotion` | 24 种表情；`prompt` 为 `表情英文值;;补充描述`，`defry` 0–5 对应标准至最弱 |
| 去杂物 | `declutter` | 单张图片 |

- 请求为 `POST /ai/augment-image` JSON，公共字段仅 `req_type`、PNG Base64 `image`、`width`、`height`；上色／表情附带 `prompt`、`defry`。不发送生图型号、Seed、CFG、采样器、蒙版、参考或 `max_cost`，标准网关未声明此协议时不可代发。
- 尺寸按公开客户端预处理：等比例缩小到不超过 `3,145,728 − 2,000` 像素；小于 1,011,712 像素时等比例放大到约 1,048,576，两边向下取整，不做 64 像素对齐。832×1216 保持原尺寸。Koma 使用浏览器 Canvas 高质量插值；尺寸与官网一致不代表插值逐像素一致。结果保留实际输出尺寸。
- 按 V3／28 步公式独立估算 Anlas；去背景为三张基础费用加 5 Anlas，约 1MP 为 65 Anlas。其他工具仅在可确认的订阅资格与面积条件下内部判定零费用；账户信息不足保持未知。V5 百分比不抵扣工具费用，界面不展示免费或零费标签。
- 完整解包并解码后才写入版本；去背景按 ZIP 的 `image_0.png`／`image_1.png`／`image_2.png` 身份映射三种结果，不依赖成员排列顺序。版本栏合为一个带工具图标的入口，在图片信息栏切换三种结果；切换、收藏和下载不再次调用工具。数量、尺寸组或内容无效时不写入部分结果。
- 单次调用使用全应用任务锁、提交前选源和余额检查；明确 Anlas 不足才顺位到另一官方来源，未知余额保持优先级，提交后失败／取消不重试。结果归发起画板，保留当前查看图；图片、参数与历史处理完成后才释放任务槽。
- 结果记录工具、参数、实际尺寸、来源身份及独立 `sourceRecipe`，不伪造生成 Seed。IMAGE／上传来源进入主历史，CHAT 来源保持显式回传；收藏与 Slate 继续使用原图和既有路径。来源为绘图配方时可恢复该配方，工具参数不冒充生成参数。

依据为[官方工具文档](https://docs.novelai.net/en/image/directortools)、[公开接口 Schema](https://image.novelai.net/docs/doc.json)与当日公开客户端；模拟和界面检查见[接入核验](archive/2026-10-28-director-tools-verification.md)。Pixel Snap 不在本轮六项工具范围内；真实效果与实际扣费仍待单独核验。

## 普通 Enhance

EDIT 的图生图表单提供 Enhance 开关，默认关闭；仅准确映射到官方五型号的连接可用。开启后显示倍率与 Magnitude，复用原有强度、噪声、模型／预设、角色与适用参考，以及底部同一个执行按钮。普通图生图的强度／噪声／Seed 独立保留，关闭开关恢复；切到重绘时保留设置但不生效，不将其列为第四种编辑模式。

- 请求仍为 `POST /ai/generate-image`、`action: img2img`，原尺寸 PNG 底图与目标宽高分开传递，单张输出；不经过 `/ai/upscale`，也不在浏览器里先把底图放大。
- 提供 1×／1.5×／2×，按官方当前客户端过滤倍率并对齐 64 像素，输出不超过 3,145,728 像素；标准 832×1216 及横向尺寸允许 1.5×，目标分别对齐至 1280×1856 及 1856×1280，界面显示实际目标尺寸。换底后不适用的旧倍率须重新选择，不静默降倍率。
- Magnitude 1–5 对应 `strength/noise` 为 `0.2/0`、`0.4/0`、`0.5/0`、`0.6/0`、`0.7/0.1`。手动微调强度或噪声后显示「自定义」；其他 High／Medium 参数约束继续生效。
- 每次显式执行冻结新的随机 Seed，原手填 Seed 不覆盖；预览不生成。当前有效正向按官网补充 `-2::upscaled, blurry::`，放在 `Text:` 前，输入原文保持不变。
- 结果宽高必须符合请求，完整记录原词文、有效词文、实际 Seed、强度／噪声、倍率与档位，沿用编辑版本、历史／收藏与 Slate 交付。失败、取消或尺寸错误不写入结果、不重试；额度和任务锁规则不变。
- 标准网关未声明 Enhance 能力，不将增强请求降级到普通图生图或丢弃倍率。多个官方来源仍沿用原优先级和余额规则。

公开客户端依据与普通倍率的本地验证见[Enhance 核验](archive/2026-10-28-nai-enhance-verification.md)。

### V5 Max Enhance

V5 Full High／Medium／Curated 在同一个倍率下拉框中提供 `Max`，沿用 Magnitude、强度／噪声微调、随机 Seed 和原执行按钮，不增加型号或面板。按官方客户端，只在底图面积小于 `3,145,728 × 0.8` 时提供；切换到 V4.5 或不适用底图时保留 Max 设置并阻止提交，须主动另选倍率。

- 请求仍是 `action: img2img`，发送原尺寸 PNG、原宽高与 `parameters.upscaled_enhance: true`，不预先放大底图。普通倍率不发送该标记；不允许其他协议丢弃标记后降级。
- 实际倍率为 `min(2, sqrt(3,145,728 / (原宽 × 原高)))`，两边分别向下取整。512×512 输出 1024×1024，832×1216 输出 1467×2144；界面预告实际尺寸，返回后按该尺寸检查并写入历史，而不是以请求中的原宽高校验。
- Max 沿用原有效提示词，不追加普通 Enhance 的 `-2::upscaled, blurry::`。Medium 固定设置继续生效；快照记录 `enhanceScale: "max"`、实际尺寸与实际 Seed。
- Max 输出可以不对齐 64 像素，下载／收藏／Slate 交付保留真实像素。普通图生图／重绘的 64 像素底图约束仍适用，继续编辑此类结果须先调整尺寸，不静默缩放。

Max 属于带重绘的增强，画面可能随强度变化，不承诺无损或免费。实现与模拟验证见[Max 核验](archive/2026-10-28-nai-max-enhance-verification.md)，真实效果和实际消耗待单独核验。

## 聚焦重绘（Focused Inpainting）

EDIT 工具栏「重绘 ⌄」的箭头菜单提供普通／聚焦二选一，主按钮记住上次类型并切换启停；默认普通。聚焦只适用于准确映射官方 V4.5 Full／Curated 与 V5 Full High／Medium 的来源。首次选择聚焦且无框时进入手动框选，已有框则直接恢复；类型互切不清除蒙版或框。手动画笔／橡皮控制实际修改区域，工具栏框选按钮（F）调整周边上下文；尺寸与自动处理尺寸显示在框的角标，不占左侧表单。框选后可拖动、拖四角改尺寸，聚焦框获得焦点后方向键以 8px 移动、Shift 加速；B／E 返回涂画，Esc 优先关闭菜单，否则取消未完成框选并退出框选工具。没有自动识别或自动扩框。

- 框按底图像素保存，对齐 8px、最小 8×8，必须位于底图内并包含全部白色蒙版；缺框、空蒙版、框外覆盖或无效比例均在提交前阻止。用户应留足周边上下文。界面显示所选尺寸与处理尺寸。
- 先裁切归一化底图与黑白蒙版；小于约 0.8MP 的区域按官网 `largestValidWithinPixelCount` 算法放大到约 1MP、两边向下取 64 倍数，较大区域保留尺度后按公共尺寸规则对齐 64。过于狭长或目标超限时须重新框选。源图仍遵守官方 64 对齐／3MP 和本地 8MB 限制。
- 仅裁切区域离开浏览器，发送一次 `action: infill`、对应 `-inpainting` 型号与既有强度／Seed／词文／适用参考。上游没有 `Focused` 或 `zoomArea` 参数。角色位置先按原型号定位规则处理，再转换至裁切坐标并限制到 0–1；原始角色、源尺寸和聚焦范围保留在本地结果参数。
- 返回图必须等于处理尺寸；本地 Canvas 高质量插值缩回聚焦框，再仅替换完整原图的白色蒙版像素。最终尺寸等于原图，蒙版外像素保持不变；没有叠加调用 Enhance／Upscale。与官网的蒙版膨胀／模糊不同，Koma 延续原有精确蒙版边界，不自动扩大修改范围；接缝与真实效果须单独核验。
- 配置归各编辑画板，同板同尺寸换图保留框和蒙版，不同尺寸清空几何；回看旧版本不复活清空的框。普通重绘关闭聚焦后恢复全图请求。Photopea／文件导入的蒙版共用相同校验。
- 处理使用原有任务锁、选源、额度和取消规则；标准网关未声明该处理协议，不能降级或静默丢弃。失败、取消、返回尺寸不符均不保存版本、不重试。结果沿用原尺寸历史／收藏与 Slate 交付，记录 `inpaintFocus`，不保存底图／蒙版字节。

依据为[官方 Inpainting 文档](https://docs.novelai.net/en/image/inpaint)及当前公开客户端的裁切／放大实现；代码和本地模拟验证见[聚焦重绘核验](archive/2026-10-28-focused-inpaint-verification.md)。没有真实收费生成验收结论。

## Anime／Furry 模式

官方 [Models](https://docs.novelai.net/en/image/models) 明确 V4.5 Full／Curated、V5 Full／Curated 均可切 Anime／Furry。V4 也采用同类模式；V3 则有独立 Anime／Furry 型号，不能统一改成两个新模型 ID。V5 Full 的 High／Medium 与模式独立，官方 Effort 专题将两个开关放在一起；Medium 仍不支持用户负向与 UC 选择。

[Dataset Tags](https://docs.novelai.net/en/image/tags#dataset-tags) 规定 Furry 模式以 `fur dataset` 开头，并把 Tag 补全切到 Furry 数据集；Anime 模式无须新增一个虚构的 `anime dataset` 参数。V4.5 及以上另有 `background dataset` 标签，不等于这组开关中的第三个选项。Furry Focus／Human Focus 是 UC 预设，和 Anime／Furry 模式不同；V4.5 Curated 虽没有 Furry Focus UC，仍支持 Furry 模式。

绘图模型区位于画板与提示词之间。模型框只放模型名，按钮与菜单统一显示官方全称（如 `NAI Diffusion V5 Full`）；标准网关提供的 NAI 型号也按 ID 显示官方名称，其他模型沿用连接目录名称。模型框下方并排 Anime｜Furry 与 High｜Medium 两组分段，直接点选；Curated／V4.5 隐藏 Effort，模式分段占满整行并带樱花／爪垫图标。模式默认 Anime，随画板、历史参数、备份和 ASK 参数恢复保存。旧 Koma v2 数据缺少模式时默认 Anime。

Furry 模式只在有效基础提示词首位补充 `fur dataset`，原文不变，不创建另一套模型 ID，也不联动质量／负向预设。自动补充时会去重正文中已有的裸 `fur dataset`；人工首位前缀保持原样；`Text:` 内的文字不参与处理。原文已以 `fur dataset` 或 `background dataset` 开头时，显式标签优先；前者显示 Furry 并禁用 Anime 选项，后者保留原标签并禁用 Furry 选项，提示先移除手写标签。不会因切模式静默删改用户原文。外部有效词文导入重置自动模式，手写前缀仍有效；本机历史复用恢复原文及模式。

绘图的基础／角色输入补全及页内查词面板跟随有效模式：Anime 沿用中英词典与 Danbooru；Furry 查询公开的 `https://image.novelai.net/ai/generate-image/suggest-tags`，用已核对的 `model=nai-diffusion-furry-3` 词库标识和当前查询片段 `prompt`。这是补全词库标识，生图仍使用当前 V4.5／V5 型号，不代表官方保证 V5 词库完全等价。只发送查询片段，不发送 Key 或完整绘图描述；补全缓存按数据集隔离，切换即取消旧查询、清空旧候选。Furry 结果没有 Danbooru 分类字段，保留服务端次序、标注 Furry，不套用动漫分类过滤；中文查询提示使用英文，失败不会退回动漫词库。完整词典及其他工作区沿用原有中英词典。

## 界面与参数边界

- Prompt 框底部放 Complexity、质量和透明底，Negative 页同一位置放负向预设。使用站内裸按钮与菜单，不增加输入区总高度。关闭时只显示入口，选中时显示档位；透明底使用图标开关。V4.5 隐藏 Complexity／透明底，保留本地选择；换回 V5 恢复。V4.5 的质量入口目前仍在 Prompt 底栏，仅提供关闭／Standard，并未迁入参数抽屉。底栏背景覆盖至右边缘，滚动文字不从手柄旁透出；原生拖动调整高度仍可用。
- 模型名独占模型框，模式与 Effort 是框下方的两组分段；模型及提示词底栏菜单复用站内实色浮层，取消重复标题与选中整圈描边，以字重和紫色勾区分选择。Medium 显示固定 14 步／Euler Ancestral，禁用 Rescale，基础与角色负向只读；本地 High 参数不被覆盖。请求层再次约束有效参数，不能只靠禁用 UI。
- `Guidance` 对应 `scale`，即 CFG Scale（提示词引导强度）。官方绘图和 EDIT 滑杆为 0–10、步长 0.1；点击数值可手输更高的非负有限值，10 不是 API 硬上限，导入不再截断至 20。`Guidance Rescale` 对应独立的 `cfg_rescale`，范围 0–1、默认 0，用于缓和高 Guidance 导致的过饱和／高对比。官方绘图、标准网关绘图与 EDIT 统一使用这两个字段。遗留 `cfg` 默认空（`null`），仅兼容本机历史数据；报价、Studio、原生和编辑请求均不发送，旧值 10 不会被换算成 Rescale。Medium 仍不发送可调 Rescale。
- 质量、负向和 Complexity 默认关闭，保留既有输入。`domain/nai.ts` 集中管理官方预设正文和型号能力；只在出站快照扩展，保留原始正负词和角色负向。自动标签置于 `Text:` 前，只去重相同的字面标签，不改用户权重／手写词。历史复用使用原文与预设；外部元数据导入有效词文时关闭对应自动追加，避免重复。Rescale 可独立导入。旧 Koma v2 备份缺少新字段时读取默认值。
- 预设已由客户端展开，原生请求不再固定开启质量／Heavy：普通模式使用关闭自动追加的标记；V5 官方使用版本 4 与字符串预设 ID；Medium 同时展开固定 Heavy 正文写入 `negative_prompt` 与 V4 基础负向，不依赖 ID 代替正文；正向未含 `nsfw` 时按官网加入该负向词，用户与角色负向保留本地、不发送。标准网关保留版本 3、报价和 `max_cost`；Studio／报价与原生获得相同的有效词文，Rescale 直接传递，不携带遗留 `cfg`。
- 绘图与 EDIT 共用 `domain/nai-parameters.ts` 的官方参数规则：六种采样器，包含 DPM++ 2S Ancestral，不提供 DDIM；目录与出站再次校验。V4.5 可选 Karras／Exponential／Polyexponential，默认随采样器，DPM++ 2M 为 Exponential、其余为 Karras；V5 固定 Karras，不展示调度选择。选择随画板、结果、备份、PNG 参数导入和 ASK 草稿保存，切 V5 时保留本地选择。官方绘图与普通编辑面积均为 3,145,728、64 对齐；绘图自定义控件仍保留产品级 64–2048 边长，EDIT 不加此单边限制。标准网关沿用其目录、尺寸与既有 Karras，不据官方规则扩展其能力。`dynamic_thresholding` 关闭。
- 官方 V4.5 Full／Curated 的参数区在 Guidance 同行提供紧凑 `Variety+` 开关，默认关闭；绘图、Img2Img、Enhance 与 Inpaint 共用。内部保存布尔值 `varietyPlus`，出站按官网客户端计算 `skip_cfg_above_sigma = 58 × sqrt(floor(width/8) × floor(height/8) / (104 × 152))`，使用实际请求输出尺寸，增强／聚焦预处理后重新计算。关闭时省略该字段；V5 不支持，切换后隐藏且不发送，返回 V4.5 恢复本地选择。标准网关未声明该能力，不显示且两种出站均不透传开关或原始 sigma。画板、备份、历史／收藏、PNG 导入、EDIT 继承与 ASK 参数草稿保留开关；结果记录实际生效状态。外部 PNG 的正有限 sigma 还原为开启，重新发送时按当前尺寸计算，不沿用原阈值。其作用是延后 CFG 以增加多样性，可能降低词文贴合度；与 `scale`／`cfg_rescale` 独立。
- 不提供服务端缓存，请求固定 `cache: false`、`optimize: false`。「去除元数据」在本机删除结果 PNG 的文本、EXIF 与时间块，不重编码、不改像素，透明结果保留 Alpha。编辑器提供 Guidance／Guidance Rescale，继承来源图片的 `cfgRescale` 或 `cfg_rescale`，缺失时为 0；编辑结果及回到绘图页复用均保留实际 Rescale。EDIT 已复用绘图页的模型、模式、预设、角色和底部抽屉；原始词文与自动标签分别保留，结果记录实际提交 Seed 与完整配置。详见[编辑契约](edit-workspace.md#编辑表单与生成)。
- ASK 接收新字段并可从历史审阅恢复；模型知识已将 Complexity 修正为画面复杂度。已有工具权限、草稿确认和不自动生成的边界保持。

基础编辑的官网输入范围为：Img2Img `strength` 0.01–0.99、`noise` 0–0.99；Inpaint 强度 0.01–1，低于 1 写入嵌套 `img2img`，等于 1 则省略。步数为 1–50 整数，Seed 使用实际 uint32。公开 Schema 未完整声明这些字段的最小／最大值，项目依据当前官网客户端设置前端和出站校验，不将滑杆范围宣称为服务端硬限制。尤其 Guidance 的 10 只是滑杆上限；Koma 的 8MB 文件和绘图 2048 单边属于产品限制。当前核对依据与本地模拟见[参数边界收口](archive/2026-10-28-nai-parameters-verification.md)。

## Vibe 与精确参考边界

2026-10-25 在未登录的[官方生图页](https://novelai.net/image)逐一切换核对：V4.5 Full／Curated 的 Reference Images 分区同时显示 Image2Image、Vibe Transfer、Precise Reference；V5 Curated、V5 Full High／Medium 只显示 Image2Image。Vibe 通用专题仍写“V4 及以上”，与当前界面存在范围差异，不能据此直接开放 V5。界面未显示不等于已证明 API 必然拒绝；在有进一步契约证据之前，V5 Vibe 保持未核验。精确参考则由官方专题明确限定 V4.5，并与 Vibe 互斥。

Vibe 使用强度与信息提取量，最多 16 个；V4 及以上首次编码每份 2 Anlas，修改提取量需重新编码；超过 4 个后，每多一个，每张生成附加 2 Anlas。官方支持本机编码缓存、`.naiv4vibe`／Bundle 导入导出和从 PNG 元数据恢复编码；仅编码导入没有原图，不能修改提取量。编码缓存只在本机。

精确参考有角色、风格、角色＋风格三类及 Strength／Fidelity 两个控制；每张参考每张生成附加 5 Anlas。多张角色参考会混合特征，不能视为独立角色绑定。图片等比缩放并黑边填入官方三种大画布；可配合官方普通重绘，本工程已接入，真实效果待验。公开客户端上限为 16 张；当前 UI 的 Strength／Fidelity 采用 0–1，类型对应 `character`／`style`／`character&style`，Fidelity 映射为接口 secondary strength 的 `1 - Fidelity`。

绘图页与 EDIT 使用已确认的统一底部抽屉：参数／Vibe／Precise 三段入口位于内容上方，启用开关只放在正在查看的参考段旁。浏览和上传不会启用参考；启用两组互斥，独立配置保留。64×80 缩略图横向滚动，不显示文件名；每张通过眼睛图标控制参与。原有参数滑杆样式不变，生成按钮前固定保留 12px 非滚动空间；不支持参考时收为单一参数入口。切换到不支持的型号或来源后，若仍有启用参考则阻止生成并提供停用入口。

收费编码只在显式生成取得 `runTask` 槽位后执行。Vibe 通过官方 `POST /ai/encode-vibe` 发送原始图片 base64、型号及提取量，读取有界二进制响应；缓存按原图内容哈希＋准确型号＋提取量区分。上传、调参、恢复与预报价均不编码。每份成功编码立即经 `data.write` 落库；后续生成失败或取消不丢缓存，也不自动重试编码。生成发送编码后的 `reference_image_multiple` 和 `reference_strength_multiple`，不重复发送提取量数组。归一化只在多图绝对强度总和超过 1 时生效。

Precise 用 Canvas 高质量插值等比缩放并居中填黑边，目标从 1024×1536／1536×1024／1472×1472 中按比例差选择；发送 PNG base64 及配对的描述、信息量、强度和反向 Fidelity 数组。插值实现与官网的 Lanczos 不完全相同，真实效果待验。当前两组均只开放准确映射到官方 V4.5 的来源；不假设标准中转具有相同参考协议。源选择检查已知参考附加费和待编码费下限；余额未知仍可用；可确定账户权益时提供包含参考的整次本地估算，否则保持未知且隐藏按钮费用标签。参考准备后固定来源画板／编辑会话、配置和连接上下文，不能换源重试。EDIT 的官方 V4.5 img2img 复用同一准备与缓存能力；普通 Inpaint 只开放 Precise；官网公开客户端会跳过蒙版下的 Vibe 编码，本项目保留配置并阻止发送，不付费编码或通过中转静默丢弃参考。

参考配置随画板、编辑会话和结果参数保留，原图／缩略图与编码分别存在 `koma-image-favorites` 的 `referenceAssets`／`vibeEncodings`；普通 Koma v2 备份包含其资源闭包及编码校验，恢复不触发上游。支持官方 v1 Vibe／Bundle 的原图和编码文件导入导出；仅编码导入锁定提取量，缺当前型号编码时拒绝导入；带 Mask 或未支持的编码参数明确拒绝。Precise 使用独立的 Koma JSON 格式。外部 PNG 元数据中的 Vibe 编码通过参数导入页恢复；本机历史参数导入可恢复配置。ASK 仅接收不含图片与编码的参考摘要，不因此新增写入权限。

公开字段依据与本地模拟边界见[实施核验](archive/2026-10-25-nai-references-integration.md)，前期能力勘探见[研究记录](archive/2026-10-25-nai-references-research.md)。

## 后续工作与核验顺序

| 顺序 | 工作 | 当前缺口与验收边界 |
| --- | --- | --- |
| 1 | 现有链路的真实验证 | 五型号文生图／img2img、四型号 Inpaint、官方 4× Upscale、多角色、Vibe 编码／缓存命中与 Precise／Vibe 效果；逐项记录请求、原图和前后额度。账户只读、模拟成功及线上页面加载都不能代替这一步 |
| 2 | 单次消耗与账户规则 | 根据型号、Effort、尺寸、步数及参考配置核验 Anlas／V5 用量估算，核验 Opus 免费资格、加购额度与回充规则；已接入本地 Anlas 公式、参考／编码费与 Opus 资格判断；V5 百分比仅基准近似，实际扣费与权益仍待核验 |
| 3 | 基础参数核验 | 尺寸／步数／采样器、V4.5 调度／Variety+、V5 固定 Karras、强度／噪声与 Medium Heavy 已按当前官网客户端对齐；真实参数采用情况与 Variety+ 效果仍待核验。Guidance／Rescale、模式与预设已在绘图和 EDIT 对齐；中转缓存／JPEG 选项不能宣称为官方同名能力 |
| 4 | 官方编辑与独立工具 | 五型号 Img2Img／普通 Enhance、V5 三型号 Max Enhance、四型号普通／聚焦 Inpaint、官方 4× Upscale 及六项 Director Tools 已接线；真实效果与消费待验；V5 Curated 不开放独立重绘，Pixel Snap 不在本轮范围 |
| 5 | 导入与输入检查 | 外部 PNG Vibe 编码与 Alpha 隐藏元数据恢复、型号 token 预算和 `Text:` 检查已接入；不恢复未附带的参考原图／Precise，不新增 V5 自动引号提取 |
| 6 | 界面精简 | V4.5 只有质量入口时仍保留 Prompt 底栏；改成参数抽屉内开关尚未实施。这是界面精简项，质量标签功能本身已接入 |

V5 的两种参考保持不开放：Precise 官方专题限定 V4.5，Vibe 的通用说明与所观察官网入口存在差异。获得进一步能力证据前，不把 V5 参考列成已确认应实现的缺口。

真实收费验证须单独取得授权。后续每项检查 UI、请求、参数导入／恢复、原图字节与额度影响；不因此新增生成自动重试或付费确认。当前模拟和线上页面验证范围见[发布核验](archive/2026-10-25-nai-release-verification.md)。

公开参考为[图片 Schema](https://image.novelai.net/docs/doc.json)、[当前 API 文档](https://image.novelai.net/docs/index.html)、[产品说明](https://docs.novelai.net/en/image/)及 [Opus 用量 FAQ](https://docs.novelai.net/en/faq)。型号与功能依据为[Models](https://docs.novelai.net/en/image/models)、[Effort](https://docs.novelai.net/en/image/effort)、[特殊标签](https://docs.novelai.net/en/image/tags)、[角色](https://docs.novelai.net/en/image/multiplecharacters)、[精确参考](https://docs.novelai.net/en/image/precisereference)、[Vibe](https://docs.novelai.net/en/image/vibetransfer)、[文字绘制](https://docs.novelai.net/en/image/textrendering)、[质量预设](https://docs.novelai.net/en/image/qualitytags)、[负向预设](https://docs.novelai.net/en/image/undesiredcontent)、[重绘](https://docs.novelai.net/en/image/inpaint)和[Director Tools](https://docs.novelai.net/en/image/directortools)。

连接、额度、型号、参数、模式、参考与基础编辑的验证记录统一见[历史索引](archive/README.md#nai连接与基础编辑)，各记录保留实际读取日期和模拟／真实边界。
