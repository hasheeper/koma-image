# 图像协议能力与边界

更新于 2026-11-28。基础适配已经完成代码和模拟验证；供应商型号、权限、CORS、实际生成与扣费仍须逐项核验。NovelAI 官方已有授权的账户只读验证，范围见[官方接入](novelai.md)，不能推导为生成成功。

## 接口能力与当前范围


| 协议 | 模型与鉴权 | 基础生成与修改 | 费用与额度 | 当前边界 |
| --- | --- | --- | --- | --- |
| OpenAI Images | GET /v1/models；Bearer；读取 ID，由现有模型页匹配 | POST /v1/images/generations：JSON；POST /v1/images/edits：multipart，参考图使用 image[]，支持来源可独立上传 markup PNG；返回 data[].b64_json | 不假造预报价或账户余额；费用未知 | CHAT／EDIT 生图与参考图修改、GPT Image 2.5／2.6 原生标注；不包含 Responses、部分图片流式返回、SVG／GIF 输出、DALL·E、API Mask 上传或远程结果 URL 下载 |
| Gemini 原生 | GET /v1beta/models?pageSize=1000，单次读取 ID；x-goog-api-key | POST /v1beta/models/{model}:generateContent；contents/parts/inlineData；generationConfig；读取文本和内嵌图片 | 不套用标准网关的积分；费用未知 | 对话页生图与参考图修改；沿用现有拼接上下文，每次请求独立，图像链路未实现原生签名续传；ASK 文字链路另见[运行契约](../ask/runtime.md) |
| NovelAI 官方 | 账户与图片统一为 image.novelai.net；Bearer；GET /user/subscription；未订阅不阻止 Key 识别 | POST /ai/generate-image；五型号文生图／img2img／普通 Enhance、V5 Max Enhance，V4.5 与 V5 Full High／Medium 的普通／聚焦 infill；POST /ai/upscale 提交独立 4× 放大，ZIP／原图解包；V5 文生图与无蒙版图生图支持 Precise，V4.5 支持 Vibe／Precise。Vibe 编码为 POST /ai/encode-vibe；六项 Director Tools 为 POST /ai/augment-image | 读取 Anlas、V5 百分比、基准约张数及加购百分比；本地 Anlas／参考／编码费估算及 Opus 判断，V5 用量仅基准近似；未知标签隐藏 | 模式／Effort／Complexity／预设／Rescale、Enhance 与参考链路已模拟核验，真实生成／编码／扣费待验；V5 Curated 无独立重绘接口；Focused Inpainting 已接入客户端裁切／放大／原尺寸合成，沿用单次 infill；Director Tools 已接独立工具请求、尺寸预处理与去背景三种结果；型号采样器／调度／数值边界已有统一校验，Max 使用独立服务端标记和输出尺寸校验，实际参数采用仍待真实核验 |
| Koma 标准网关 | 原目录、统计与鉴权 | 原三条执行路线 | 650/400ms 报价、执行前重报、max_cost、涨价提示、批量最多提示一次、余额不足不提交 | 行为保持；新增协议不关闭此协议的报价保护 |
| Seedream 原生 | GET /api/v3/models；Bearer；可手动绑定供应商模型 ID | POST /api/v3/images/generations；JSON 文生图与单／多参考图编辑，image 使用 data URL，返回 b64_json | 费用未知；不套用网关报价 | CHAT／EDIT 可使用 5.0 Lite／Pro／Flash 和 5.5 模板，5.5 支持透明背景与单图拆层。双图标注和蒙版回贴由本地处理，各来源的型号权限待验 |
| 通用图像接口 | 每条连接自定基础地址、后缀和请求格式。Gemini 用 `x-goog-api-key`，fal 队列用 `Authorization: Key`，其余格式用 Bearer | 按所选格式处理同步图像、Kie 异步任务或 fal 模型队列 | 费用未知 | CHAT、EDIT 和支持拆层的 Seedream 来源可用。[第三方图像渠道](#第三方图像渠道) |

OpenAI Chat + Images 共用一份地址和 Key，按 OpenAI `/v1` 基础地址拼接 `/chat/completions`、`/images/generations` 与 `/images/edits`，不重复已有 `/v1` 后缀。Chat 用于 ASK，Images 用于现有图像工作区；目录不会把所有 LLM 条目自动变成生图模型。Gemini 原生也可在同一连接开启文字和图像：ASK 使用 `streamGenerateContent?alt=sse` 并限制 TEXT 输出，图像工作区继续使用 `generateContent`。接口开关由用户指定，不自动发现或回退，不新增 Chat 生图或 Responses。

这里的“协议”与连接名称、渠道无关。用户配置的兼容服务可以选择其真正提供的 OpenAI Images 或 Gemini 原生协议；不按域名推断，不在正式源码中内置私有服务名称、地址或 Key。新环境连接仍为空。

多角色映射：标准报价／Studio／工具发送 `characters: [{ prompt, uc, center }]` 与顶层 `use_coords`；免费原生与官方继续使用同一领域快照构造 `v4_prompt`／`v4_negative_prompt` 正负数组，避免标准转换影响原生内容。字段依据为实际只读解析与报价探测，请求及参数往返已模拟验证，真实生成仍待实测。详情见[多角色与画板](../workspaces/image.md#协议映射与元数据)。

## 已落地的结构

- `gateway/profile.ts` 统一登记图像协议、三种 ASK 推理协议及 OpenAI／Gemini 共用连接，声明鉴权、目录、报价、额度和路径能力。新增连接和现有连接均显式选择协议；未知 Profile 继续拒绝。
- `gateway/native-protocols.ts` 分开处理原生 ID 列表与匹配后的执行能力；UI／领域层继续使用现有规范模型与参数。不要求目录返回 studio_features，不按 ID 的品牌前缀或 supportedGenerationMethods 筛掉模型；未匹配 ID 留在设置供用户选择，不自动变成可生图模型。
- `gateway/transport.ts` 处理 Gemini 的安全模型路径、OpenAI 的 multipart 边界，以及官方 NAI 的固定主机请求。Gemini 单次请求最多 1000 条，不追读 nextPageToken；URL 不携带 Key，不跟随重定向，版本前缀不重复拼接。
- 原生协议不支持报价时，对话与编辑不再把“没有报价接口”显示成连接错误；编辑执行条件仍校验所选模型、源图和操作能力。内部费用保留未知状态，绘图和编辑生成按钮暂不显示未知费用标签，不记录为免费。
- NAI 官方只允许固定图片地址，账户查询也使用该地址；添加时明确说明 Key 的唯一接收域名。已有其他地址的连接不能通过切换协议把保存的 Key 自动发送到官方域名，需单独添加并填写 Key。
- 所有任务继续走应用级 runTask，共用 N=1；保留取消、超时、失败停止、不自动重试及原图字节。不改变数据键名；新版连接配置和备份携带 profileId。
- 本地 `server.mjs` 支持标准网关与两种 ASK 推理协议的固定路径。通用图像接口、Seedream、OpenAI Images、Gemini 原生与 NovelAI 官方均由浏览器直连，服务须允许跨域。

## 模型目录与来源

OpenAI／Gemini 每次拉取只发一次模型列表请求；Gemini 使用 `pageSize=1000`，不追读分页。列表用于取得 ID，并保留兼容服务在 `image_capabilities.fields` 中提供的参数声明及 `image_capabilities.markup` 布尔能力声明；Gemini 去掉 `models/` 前缀；不按品牌、`studio_features` 或 `supportedGenerationMethods` 筛掉条目。未知 ID 留在设置中，用户可手动指定映射；仅有 ID 不自动成为可执行图像模型。

GPT／Gemini 参数能力按模型与来源独立管理，优先采用目录声明，缺失时以明确标注的参数参考起步；用户可补充或关闭标量字段，刷新保留手动覆盖。工作区显示并发送真实默认值，数字和布尔值在请求边界转换；来源筛选校验实际字段和值。表单及扩展字段映射见[来源参数](../workspaces/settings-and-tags.md#连接目录与反馈)。条目可增删改，NAI 五型号固定。实际请求保留每个来源的完整上游 ID，包含空格、渠道后缀和非官方名称；Gemini 路径对整个 ID 编码，不允许控制字符或 URL 注入。手动 ID 不要求在目录中，Images／Gemini／Seedream 原生目录不可用时仍可使用手动来源；标准网关仍校验目录中的报价保护声明，缺项 ID 可手动补充。目录、匹配和执行能力分开；关闭来源后不能继续使用该来源。模型存在于本地目录不代表真实型号能力或账户权限已经核验。

可用来源和供应商优先级独立配置；同一模型、当前操作及参数先筛选可用来源，再按连接页顺序检查报价和余额。明确不足才顺位选择，余额未知仍按优先级；生成提交后不换源重试。NAI 官方不支持的工具可以由后面的兼容来源执行。排序、额度判定与同步规则见[设置](../workspaces/settings-and-tags.md#连接目录与反馈)。

## Seedream 5.0、5.5 与标准网关兼容

设置继续复用连接、模型与来源参数组件，新增 Seedream 模型分组。新安装提供以下参数参考；已有自定义模型列表保持原样，可在「设置 → 模型 → Seedream → 新增」选择模板，再绑定上游 ID。目录显式参数优先；未声明的 Seedream 来源使用标明的参考预设，来源参数可修改或停用。

| 参数参考 | 已公开的模型 ID | 输入图片上限（含底图） | 输出尺寸参考 |
| --- | --- | --- | --- |
| 5.0 Lite | `doubao-seedream-5-0-260128`，兼容别名 `doubao-seedream-5-0-lite-260128` | 14 | 2K／3K／4K；自定义总像素 3,686,400–16,777,216 |
| 5.0 Pro | `doubao-seedream-5-0-pro-260628` | 10 | 1K／1.5K／2K；自定义总像素 921,600–4,624,220 |
| 5.0 Flash | `doubao-seedream-5-0-flash-260915` | 10 | 同 Pro |
| 5.5 | 本地模板为 `seedream-5.5`；自动匹配别名含 `doubao-seedream-5-5`、`dola-seedream-5-5-261028`，亦可手动绑定供应商实际 ID | 暂以 10 张为参考 | `1K／1.5K／2K`（默认 `2K`），可自定义且未硬套 5.0 面积边界；新增 `background`（`auto / transparent / opaque`，默认 `auto`） |

5.0 官方协议在发送前校验分辨率档位、自定义面积及 1:16–16:1 宽高比，手动上游别名仍按所选模板校验。参考默认值为 `size=2K`、`output_format=png`、`watermark=true`；关闭水印发送布尔 `false`。5.5 新增 `background` 背景参数（`auto`／`transparent`／`opaque`），原生直连与标准网关均可透传；选择 `transparent` 必须搭配 `output_format=png`（工作区切换时自动对齐 PNG，请求边界拒绝 `transparent + jpeg` 组合）。固定 `response_format=b64_json`，不下载远程结果 URL。5.5 的真实目录、权限、参数及原生透明底效果还须随供应商实际开放逐项核验，不以模板或模拟测试作为上线依据。

配置方式：

- **火山方舟**：协议为「Seedream 原生」，上游地址为 `https://ark.cn-beijing.volces.com/api/v3`（服务根地址亦可）。2026-11-10 无凭据只读实测：模型目录跨域预检返回 404 且未提供 CORS 许可；生图端点的 POST 预检则返回 200，并允许请求来源、Authorization 和 Content-Type。两条端点的跨域行为不同，目录失败不能直接判定生图不可用。目录受限时在模型设置中手动绑定控制台提供的模型／推理接入点 ID，现有执行路径无需先成功读取目录；预检通过不代表 Key、权限或实际生成已验证。若实际生成也被跨域拦截，仍须对应转发服务，现有本地代理尚不转发 Seedream。
- **Scylla 等网关来源**：复用已有「Koma 标准网关」连接，刷新目录后将真实 Seedream ID 关联到对应模板，不为 Seedream 再建一套网关协议。地址支持服务根或 `/v1` 地址；目录、报价、生成、编辑、`max_cost` 与额度检查沿用原有标准网关调用链。标准网关的 Studio 生图仍为 `/v1/studio/image/*`，工具编辑仍为 `/v1/image/tools/*`；供应商文档中的其他路径或 Provider 上游 Schema 不自动触发端点切换。具体供应商路径与模型权限须真实联调确认。
- 两种接入均使用 CHAT 文生图／多图续改及 EDIT 通用编辑；EDIT 局部修改继续传入干净底图＋指示图，冻结蒙版在本地回贴，保留直出和正式合成。IMAGE 的 NAI 专属表单不扩成 Seedream 参数面板。

本轮不接组图或流式图片；没有新增收费生成、自动重试或付费确认。Seedream 5.5 的 `background` 透明背景参数已在原生直连、标准网关与 Koma Layer 可选透明直出路径接入并模拟验证；原生 `layer_decomposition=true` 多图层拆分已接入 Koma Layer（严格单图输入、支持可选引导 `prompt` 与 `layer_decomposition_options.max_images`，按实际返回张数计费，真实火山方舟拆分粒度与扣费待验）。官方及标准网关路径、映射、布尔／背景／尺寸参数、CHAT 上下文、EDIT 本地回贴与结果保存已用合成素材模拟验证；方舟目录与生图端点的跨域预检已分别只读核验，带鉴权目录、生成结果与扣费尚未验证。连接检测使用无凭据 HEAD 探测辅助判断跨域限制；原生图像目录受限时提示手动绑定及生成未验证，探测失败保留网络／地址／浏览器限制多种可能，不直接断言域名错误。标准网关若未返回现行 `studio_features` 报价保护契约，将明确拒绝执行。

连接卡的自动目录检查和手动测试已共用目录受限分类，并联动模型配置与本页成功请求记录，区分「等待配置」「已配置」和「连接成功」，不会仅因目录缺省将已配置的原生来源标成无法连接。具体显示与凭据失效规则见[连接、目录与反馈](../workspaces/settings-and-tags.md#连接目录与反馈)。

契约依据：[方舟图片生成 API](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api.md)、[官方模型目录](https://ark.volcengine.com/region:cn-beijing/docs/model-list.md)、[Scylla 文档](https://proxy.scylla.love/docs)（2026-11-10 查阅；产品不内置该供应商地址或 Key）。

## 第三方图像渠道

在「设置 → 连接 → 配置供应商」选择 **通用图像接口**，填写名称、基础地址和 Key，按供应商文档选择请求格式及各操作后缀。不同渠道可以分别添加并在「生图顺序」排序。已有 Kie.ai 和 OpenRouter 连接继续可用，打开配置时可在同一表单调整并保存。

最终请求地址为基础地址加该操作的后缀。例如基础地址 `https://relay.example/v1` 加生图后缀 `/images/generations`，最终请求 `https://relay.example/v1/images/generations`。如果基础地址已经写入版本路径，只在后缀填写剩余部分。生图与改图各有独立后缀，同一端点可以填写两次。新连接的基础地址留空，由用户填写。

| 请求格式 | 何时选择 | 模型设置 |
| --- | --- | --- |
| Images | 生图接收 JSON，改图接收 multipart 的 `image[]`，结果返回 `data[].b64_json` | 在「设置 → 模型」绑定上游 ID |
| Seedream JSON | 方舟兼容的生图／改图 JSON，拆层接收 `layer_decomposition` | 同上，拆层后缀留空时走改图后缀 |
| Gemini generateContent | 参考图使用 `contents[].parts[].inlineData` | 后缀可用 `{model}` 代入绑定的 ID，也可填写供应商给出的固定模型路径 |
| 同步 JSON（OpenRouter 兼容） | 参考图使用 `input_references`，同一请求直接返回内嵌图像 | 在连接的「上游模型 ID」填写生图与改图共用的 ID |
| 异步任务（Kie 兼容） | 上传参考图后创建任务，按任务 ID 轮询并下载结果 | 可分别填写生图、改图及支持拆层的模型 ID |
| 模型队列（fal.ai 兼容） | 参考图随请求提交，在模型路径排队，完成后取结果并下载图片 | 按生图、改图和拆层分别绑定模型路径，可自定义任务查询和结果后缀 |

CHAT 与 EDIT 共用模型来源，结果记录实际使用的上游 ID。在连接的「上游模型 ID」中选择模板，再修改该型号的操作 ID。用连接卡片打开「图像模型」，可按名称或 ID 搜索，也可点「重新拉取」更新目录。用户已停用的来源和已删除的本地模型继续按原配置处理。

下表按 2026-11-28 的公开图像目录和操作文档核对。每个列出的型号均有文生图和参考图编辑入口。

| 模型系列 | 同步 JSON（OpenRouter） | 异步任务（Kie） | 模型队列（fal.ai） |
| --- | --- | --- | --- |
| Seedream | 5.0 Lite、Pro、Flash，5.5 | 同左 | 同左 |
| GPT Image | 2，2.5 Sunburst／Flare，2.6 Sunburst／Flare | 同左，另含 1.5 | 与 Kie 相同 |
| Nano Banana | 初代、Pro、Pro Preview、2、2 Preview、2 Lite、2.1 | 初代、Pro、2、2 Lite、2.1 | 与 OpenRouter 相同 |
| Koma Layer 拆层 | Seedream 5.5，须指定 2–16 层上限，含底图 | 5.5 可指定上限或交由上游决定。5.0 Pro／Flash 自动决定层数 | 5.5 可指定上限或使用上游默认值。5.0 Pro／Flash 自动决定层数 |

同步格式会将 19 个本地图像模板的上游 ID 与连接返回的目录取交集，公开目录当日匹配 16 个。目录留空时，沿用 GPT Image 2、Nano Banana 2、Seedream 5.5 的基本请求，也可为其他模板显式填写上游 ID。Kie 格式提供 15 个模板，账户检查只验证凭据。fal 队列提供 17 个本地模板，首次成功出图后连接才显示「已验证生图」。兼容服务的实际模型权限需由该服务确认。NAI 继续使用原有来源。

`config/image-channel.ts` 解析自定义路径和操作 ID。`gateway/image-channel-models.ts` 与 `gateway/fal-models.ts` 声明参考图上限、参数和拆层能力。`gateway/image-channel.ts` 校验输入，底图排第一。兼容这些请求和响应的其他服务也可在同一入口配置。

### Kie.ai 配置示例

选择「异步任务（Kie 兼容）」。以 Kie.ai 服务为例，基础地址填 `https://api.kie.ai`，账户检查后缀为 `/api/v1/chat/credit`，生图和改图均为 `/api/v1/jobs/createTask`，任务查询为 `/api/v1/jobs/recordInfo`。上传基础地址另填 `https://kieai.redpandaai.co`，上传后缀为 `/api/file-base64-upload`。上传与任务使用同一把 Key，结果下载不带 Key。兼容服务的上传地址留空时使用本连接基础地址。查询后缀可含 `{taskId}`，省略时通过 `taskId` 查询参数传入。取消会停止本地等待，上游已提交的任务仍可能继续。

Seedream 5.5 生图和改图可选 1K／1.5K／2K／3K。拆层使用独立的尺寸参数，支持自动、1K、1.5K、2K。生图的自动比例按 1:1 提交，编辑可让模型决定比例。三种操作默认发送 `nsfw_checker: false`，可在来源参数中开启附加审核。5.0 Lite 以 2K／3K／4K 对应 `quality` 的 basic／high／ultra，Pro 以 1K／2K 对应 basic／high，Flash 直接发送 `size`。Pro 和 Flash 拆层只上传一张底图，接受输出尺寸、格式和可选提示词。

来源参数中关闭尺寸后，Koma Layer 只显示「自动」。5.0 Pro 的拆层接口要求填写尺寸，自动模式发送 `size: "auto"`。5.0 Flash 和 5.5 可省略该字段。关闭输出格式后，底图采用接口默认格式。

GPT Image 1.5 同时要求比例与质量。GPT Image 2 和 2.5 指定背景仅适用于 1K，2K／4K 的受限比例在提交前检查。2.6 支持独立 PNG 标注、质量、复杂度与静态 PNG／JPEG／WebP 输出。编辑接口的 `input_urls` 保持原图和参考图的顺序，标注图单独上传并通过 `markup` 发送。

Nano Banana 初代与 2 Lite 使用 `image_urls`，Pro、2 与 2.1 使用 `image_input`。Koma 编辑时的上限含底图，初代为 3 张，Pro 为 8 张，2 与 2.1 为 10 张，2 Lite 为 1 张。2 Lite 由上游决定输出分辨率。

[文件上传](https://docs.kie.ai/file-upload-api/quickstart) · [Seedream 5.5 拆层](https://docs.kie.ai/market/seedream/5-5-layer-decomposition.md) · [5.0 Pro 拆层](https://docs.kie.ai/market/seedream/5-pro-layer-decomposition.md) · [5.0 Flash 拆层](https://docs.kie.ai/market/seedream/5-flash-layer-decomposition.md) · [GPT Image 2.6 编辑](https://docs.kie.ai/market/gpt/gpt-image-2-6-flare-image-to-image.md) · [Nano Banana 2.1](https://docs.kie.ai/market/google/nanobanana-2-1.md)

### OpenRouter 配置示例

选择「同步 JSON（OpenRouter 兼容）」。以 OpenRouter 为例，基础地址填 `https://openrouter.ai`，目录后缀为 `/api/v1/images/models`，生图和改图均为 `/api/v1/images`。配置了目录时，Koma 将模型 ID 与目录取交集，读取声明的分辨率、比例、质量、背景、输出格式和参考图上限。连接页显示「已读取图像目录」。目录留空时使用模板的基本生图与参考图输入。

文生图和参考图编辑共用 `POST /api/v1/images`，每次请求 `n=1` 和 `response_format=b64_json`。GPT Image 2.6 可另传 `markup.image_url`。目录声明压缩范围时，可为 JPEG／WebP 指定整数压缩值。Seedream 5.5 拆层发送 `provider.options.seed.layer_decomposition` 及 `layer_decomposition_options.max_images`，读取 `data[].layer` 的层序和边界框，按原画布坐标进入候选池。拆层后缀留空时沿用改图后缀。

公开目录和 OpenAPI 已只读核对。生成、参考图编辑和图层落位使用模拟服务验证。真实账号权限、跨域、画质及计费仍待验证。[OpenRouter 图像目录](https://openrouter.ai/api/v1/images/models) · [OpenRouter OpenAPI](https://openrouter.ai/openapi.json)

### fal.ai 配置示例

选择「模型队列（fal.ai 兼容）」，基础地址填 `https://queue.fal.run`，API Key 栏填账户 Key。官方端点可使用默认后缀。生图与改图都填 `/{model}`，拆层、任务查询和任务结果后缀留空。以 Seedream 5.5 为例，Koma 分别提交到 `bytedance/seedream/v5.5/text-to-image`、`bytedance/seedream/v5.5/edit` 和 `bytedance/seedream/v5.5/layerize`。兼容服务可以在「上游模型 ID」替换任一操作路径。

本地模板含 4 款 Seedream、6 款 GPT Image 和 7 款 Nano Banana。参考图按底图在前的顺序以 Data URL 直接提交，GPT Image 2.6 可另传透明 PNG 标注。5.5 拆层可选自动、1K、1.5K、2K，省略层数时 fal 默认最多返回 30 张，含底图。Koma 按 `layers[].z_index` 排序，使用每层的图片及边界框还原原图位置。Seedream 附加审核开关默认关闭，fal 是否接受由账户权限决定。[5.5 拆层模型](https://fal.ai/models/bytedance/seedream/v5.5/layerize) · [5.5 拆层参数](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance%2Fseedream%2Fv5.5%2Flayerize)

提交只发一次，查询与取结果使用 fal 返回的本连接内任务地址。自定义这两个后缀时用 `{taskId}` 标出任务 ID。队列请求使用 `Authorization: Key`，下载结果图片时不携带 Key。取消只停止本地等待，已提交任务仍可能运行并计费。[fal 队列协议](https://docs.fal.ai/model-apis/model-endpoints/queue)

37 个操作的请求已与公开 OpenAPI 的必填字段和参数选项核对。以 Koma Pages 为来源，官方队列的状态及结果端点均允许携带鉴权头的 GET 预检，公开 PNG 样例也允许跨域读取。设置连接、参考图续改、拆层及画布落位已用合成图和模拟队列验证。真实账户的生成权限、画质与扣费待实测。

### 其他供应商的图像接口实测

2026-11-28 核对了以下六家的公开目录、具体模型文档和接口。下表以 Koma 静态版为准。浏览器预检使用来源 `https://koma-image.pages.dev`，按各操作声明实际请求头。回放测试使用本地合成请求和公开样例，未用真实 Key 提交任务。

| 渠道 | 查到的图像能力 | 现有配置能用到哪一步 |
| --- | --- | --- |
| fal.ai | 17 款图像模型可生图和改图，其中 Seedream 5.5、5.0 Pro／Flash 支持拆层 | 已接入「模型队列（fal.ai 兼容）」。所测两个提交端点放行了浏览器预检所需的请求头。[fal.ai 配置示例](#falai-配置示例) · [拆层模型及公开样例](https://fal.ai/models/bytedance/seedream/v5.5/layerize) |
| APIMart | Seedream 5.5 生图、参考图编辑和 2–100 张拆层，含底图。另有 GPT Image 2／2.5／2.6 和 Nano Banana 2.1 | 需要 APIMart 任务格式。`POST /v1/images/generations` 返回 `data[0].task_id`，查询走 `GET /v1/tasks/{task_id}`。拆层输入可直接传一张 Base64 Data URL。结果中每组 `url[i]` 要与 `layers[i]` 配对，元数据可能缺省。提交与查询预检均返回 204，允许头为 `*`。[5.5 协议及结果样例](https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md) · [图像目录](https://docs.apimart.ai/_llms/en/api-manual.txt) |
| WaveSpeedAI | 目录列有 Seedream 5.5、5.0 Pro／Flash 的独立拆层端点，也有 GPT Image 2.6 和 Nano Banana 2.1 的生图与编辑 | 需要 WaveSpeed 任务格式。提交返回 `data.id`，轮询 `/api/v3/predictions/{id}/result` 读取 `data.outputs`。预检明确放行鉴权头。该模型的公开结果说明未给出逐层坐标样例，Koma 原位回贴仍待验证。按公开计费说明，拆层按指定的 `max_images` 计费，默认 30。APIMart 会按上限预留，再按实际输入和输出结算。[拆层接口及计费](https://wavespeed.ai/models/bytedance/seedream-v5.5/layer-decomposition/llms.txt) · [模型目录](https://wavespeed.ai/model-sitemap.xml) |
| Replicate | 官方模型集合中查到 Seedream 5 Lite／Pro、GPT Image 2／2.5／2.6 和 Nano Banana 2.1；本次未找到字节官方的 5.5 拆层条目 | 需要 Predictions 格式。按模型创建 prediction，随后从 `id`、`status` 和 `output` 取结果。所测创建端点的预检未返回跨域许可。[官方模型集合](https://replicate.com/collections/official) · [Predictions API](https://replicate.com/docs/reference/http) |
| AIHubMix | 图像目录列有 Seedream 5.5、GPT Image 2 和 Nano Banana 2.1 等 | Nano Banana 可选择「Gemini generateContent」，基础地址 `https://aihubmix.com`，生图和改图后缀均为 `/gemini/v1beta/models/{model}:generateContent`。该前缀的目录本次返回 404，可留空目录后缀并手动绑定 ID。GPT Image 2 的「OpenAI Images」生图请求可对齐，质量选 low、medium 或 high。编辑文档和 Schema 指定单文件 `image`，Koma 当前发送 `image[]`，兼容别名待验。5.5 的模型 Schema 仅列出自有媒体端点，回图在 `output[]`，未查到拆层声明。[Gemini 协议](https://docs.aihubmix.com/cn/api-reference/google-vertex-ai-compatible/generate-content.md) · [GPT Image 2 Schema](https://aihubmix.com/call/schema/models/gpt-image-2/endpoints) · [5.5 Schema](https://aihubmix.com/call/schema/models/doubao-seedream-5-5/endpoints) |
| BytePlus ModelArk（字节海外官方） | 模型 `dola-seedream-5-5-261028` 支持生图、编辑和拆层，回传各层的层序和边界框 | 现有「Seedream JSON」的请求结构匹配。官方示例端点是 `https://ark.ap-southeast.bytepluses.com/api/v3/images/generations`。模型目录预检放行 `Authorization`，生图端点两次预检只列出 `Origin, Content-Length, Content-Type`。所测 Koma 网页来源无法直接发送带 Key 的生图或拆层请求。[官方 5.5 配置与拆层示例](https://docs.byteplus.com/en/docs/ModelArk/seedream-5-5) |

fal 的公开案例提供了一张 2504 × 1675 的底图和五张带 Alpha 通道的 PNG。六张图片的 PNG 头均已读取。按层序 0–5 和五个原图边界框回放，Koma 的现有坐标换算能还原五个框的位置与尺寸。APIMart 文档的示例也能按数组下标配对文件、层序与边界框，其文档将该返回标为示意数据。

将 12 个实际预检响应头在本机跨域回放，Chromium 151 允许 fal、WaveSpeed、AIHubMix 和 APIMart 的所测请求继续，拦住了 BytePlus 生图和 Replicate 创建 prediction。此项只验证请求能否发出。真实生成响应和任务下载的跨域许可、账户权限与扣费另行核验。

## OpenAI Images 2.6 与原生标注

参考预设包含 `gpt-image-2.6-sunburst` 和 `gpt-image-2.6-flare`，沿用 Images 的生成／编辑端点。2.6 质量选项为 `auto/low/medium/high/xhigh/max`，新增 `complexity: low/medium/high`；默认质量为 `auto`、尺寸为 `auto`、格式为 `png`、2.6 复杂度为 `high`；工作区直接显示并发送这些真实值，目录及手动配置优先，不再提供「跟随接口」选项。已保存的模型条目列表保持原样，需要时在模型设置中新增并选择 2.6 参考，不恢复用户删除的条目。

OpenAI Images 的 GPT Image 2.5／2.6 Sunburst 与 Flare 均默认启用原生标注。通用接口中的 OpenRouter、Kie 和 fal 队列兼容格式也为两款 2.6 型号提供此开关。来源声明覆盖参考值，手动参数覆盖优先；设置中的普通字段开关可停用它，默认值设为关闭同样表示该来源不支持。官方地址和兼容地址使用同一规则，不按域名或上游别名猜测；使用参考值不等于真实来源已完成联调。配置值只参与来源能力判断，不进入标量请求参数。标准网关、Gemini、NAI 不接收该字段。

OpenAI Images 编辑请求将干净原图放在首个 `image[]`，透明 PNG 以独立 `markup` 文件上传，其他参考图继续放入 `image[]`。按官方当前契约，标注层与首图归一化方向后的尺寸相同，首图不超过 16,777,216 像素、标注文件不超过 50MB；Koma 另沿用每图 8MB 和 CHAT 总输入限制。原图与透明层同步缩小至可发送范围，不经通用 JPEG／白底转换；完整原图及本地蒙版另行保留。`markup` 不作为标量参数或普通参考图转发，也不能与 API `mask` 同传。Koma 仍未接入 API Mask 上传。

提交前按来源能力筛选，未支持原生标注的来源不参与此次请求；没有支持来源时明确报错。已提交的请求若被上游拒绝，仍不自动降级为双图或换源重试。标注只是修改提示，不能保证模型保持范围外内容；选区、本地审核与回贴见[批注发送方式](../workspaces/annotations.md#双图与原生标注)。

契约依据：[官方 markup 指南](https://developers.openai.com/api/docs/guides/image-generation#guide-an-edit-with-markup)、[Images 编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)、[2.6 Sunburst 模型页](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst)。此项已完成本地模拟，具体来源的权限、CORS、2.6 可用性和标注效果仍待真实核验。

## 费用、运行与待验

标准网关的报价、重报、`max_cost`、分流与余额检查保持。NAI 官方提供独立的本地估算，区别于服务端报价；其他图像协议没有预报价时保留未知费用状态，生成按钮暂不显示费用标签；不推算免费或每次实际扣费。所有图像任务共用 N=1，取消、超时、失败停止和不自动重试保持。

真实联调须分别记录目录／鉴权、参数、响应格式、CORS、生成效果及扣费；只读成功不能代替生成实测。NAI 高级能力见[官方接入](novelai.md)，其他未实现范围见[当前待办](../status.md)。

NAI 官方另声明固定 `POST /ai/upscale`（multipart 原图与 JSON request，固定 4×；不携带生图提示词、Seed 或 max_cost）及 `POST /ai/encode-vibe`，仅任务作用域可调用。V4.5／V5 参考请求与原图预处理、编码缓存和费用下限见[参考契约](novelai.md#vibe-与精确参考边界)；标准网关和其他协议未声明这些字段时明确拒绝，不转发应用内参考计划。

NAI 官方另提供固定 `POST /ai/augment-image` JSON：`req_type`、PNG Base64、宽高及上色／表情的 Prompt、defry。六项工具与生图型号独立，不发送 Seed／CFG／蒙版／参考／max_cost；返回 ZIP 全部解码后才写入，去背景三种结果按成员身份分组。按独立 Anlas 规则估算，不套用 V5 百分比；当前只对官方来源声明，标准网关不自动代发。尺寸、费用和结果边界见[Director Tools](novelai.md#director-tools)。

NAI 五型号的实际覆盖、V5 参考能力边界、未接入功能与核验顺序统一见[官方接入](novelai.md#后续工作与核验顺序)。官方文档存在某项能力，不代表本项目已经接入；已接线也不代表真实生成与扣费已通过。
