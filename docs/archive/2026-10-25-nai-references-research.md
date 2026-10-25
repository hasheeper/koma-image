# NAI Vibe 与精确参考勘探

日期：2026-10-25。代码基线：`codex/ask-chat-handoff`，HEAD `2d0d490`，包含本轮之前尚未提交的兼容改动。本文记录只读勘探和建议，不代表功能已经实现或收费联调通过。

## 证据与核验范围

- 读取官方 [Vibe Transfer](https://docs.novelai.net/en/image/vibetransfer)、[Precise Reference](https://docs.novelai.net/en/image/precisereference)、[Effort](https://docs.novelai.net/en/image/effort)、[Models](https://docs.novelai.net/en/image/models) 和 [API Schema](https://image.novelai.net/docs/doc.json)。
- 在未登录的[官方生图页](https://novelai.net/image)切换 V5 Curated、V5 Full High／Medium、V4.5 Full／Curated，读取可见控件；没有登录、上传图片、编码、生成或消耗额度，没有使用聊天中的 Key。
- 读取本工程绘图表单、请求转换、Profile 路径、供应商优先级、元数据导入、画板／备份与 ASK 快照。未改变业务代码。

## 型号支持：通用文档与当前界面有差异

| 型号 | 官方生图页 Vibe 入口 | 官方生图页精确参考入口 |
| --- | --- | --- |
| V4.5 Full | 显示 | 显示 |
| V4.5 Curated | 显示 | 显示 |
| V5 Full High | 不显示 | 不显示 |
| V5 Full Medium | 不显示 | 不显示 |
| V5 Curated | 不显示 | 不显示 |

Vibe 专题泛称 “V4 or higher models”，没有单独说明 V5；当前产品页在 V5 只显示 Image2Image，切到 V4.5 后，在同一 Reference Images 分区增加 Vibe Transfer 与 Precise Reference。这是同一未登录环境的界面对照，不能据此证明 V5 API 必然拒绝所有参考字段；也不能仅凭通用文档就向用户承诺 V5 Vibe 可用。建议首轮只开放已对齐的 V4.5，两种 V5 Effort 都不继承参考能力。

精确参考专题明确写 “only available on our V4.5 models”，并明确与 Vibe Transfer 互斥。V5 不开放精确参考有明确产品文档依据。

## 三种图片用途

| 用途 | 官方语义 | 主要控制 |
| --- | --- | --- |
| Image2Image | 把图片作为底图变换 | Strength、Noise |
| Vibe Transfer | 从图中提取风格、色彩、构图等信息，作为生成灵感 | Reference Strength、Information Extracted |
| Precise Reference | 更精确地参考角色外观、风格或两者 | Type、Strength、Fidelity |

Vibe 不是只传画风：降低提取量会先丢掉纹理等高频信息，更保留构图；较高强度可能压过文字描述。精确参考支持 Character、Style、Character & Style 三种用途；多张角色参考会混合特征，不能将多张图直接理解成独立角色绑定。现有文字多角色与这组图片参考必须分别建模。

## Vibe：参数、编码与复用

- 每张有启停、缩略图、Reference Strength 与 Information Extracted；官方示意图中有名称、删除和下载。专题未明确统一默认数值，不把示意值当作 API 默认契约。
- 最多 16 个 Vibe。官方建议总强度不超过 1；V4 及以上提供 Normalize Reference Strengths。该开关是可选的，不能无条件归一化用户原值；具体官方归一化算法和对应 wire 字段仍待核对。
- V4 及以上每次首次编码消耗 2 Anlas；修改 Information Extracted 需另一份编码，也再消耗 2 Anlas。改变 Reference Strength 不改变已提取的编码。
- 前 4 个 Vibe 以外，每多一个，每张生成另加 2 Anlas；16 个的附加费用为每张 24 Anlas，另算首次编码与基础生成费用。这是官方专题规则，未做账户扣费验证，不能用 V5 百分比推导其抵扣方式。
- 官网在浏览器保存同图不同提取量的编码。支持 `.naiv4vibe`（原图、缩略图、多份编码）、`.naiv4vibeBundle`（当前多图组合）与仅编码导出。清理本机缓存后若无导出，可能需要重新编码。
- 官方下载 PNG 的普通元数据可带编码；复制粘贴不保证携带。元数据中的编码不包含原参考图，能够复用，但不能据此重新修改提取量。导入支持替换／追加。

API 已公开 `POST /ai/encode-vibe`，Bearer 鉴权，返回二进制；不是生成 ZIP。请求字段为 `model`、base64 `image`、`information_extracted`（0–1），另有可选 `mask`、`crop_to_mask`、`focus_seed`、`info_extract_seed`。两个 seed 留空时，Schema 建议使用按图像内容确定的值。首轮普通图片编码不必同时开放蒙版与种子高级控制。

生成仍调用 `POST /ai/generate-image`。Schema 包含：

```text
reference_image_multiple
reference_information_extracted_multiple
reference_strength_multiple
```

也保留单张 `reference_image`／`reference_information_extracted`／`reference_strength`。公开 Schema 只声明字符串／数组类型，没有完整解释 V4.5 编码到生成字段的封装、兼容模型族或规范化算法；不能仅凭字段名断言应发送原图或任意编码。正式实现前须核对公开客户端／官网请求契约，模拟请求不代替真实联调。

## 精确参考：类型、图片预处理与费用

- 类型为角色、风格、角色＋风格；每张有启停、删除、预览、Strength 和 Fidelity。
- Strength 控制参考影响的强弱；太高容易复制表情、角度与姿态。Fidelity 控制严格程度，越高越难被提示词覆盖。
- 官方专题允许直接输入负数；公开 Schema 注释主要写 0–1，两者不完全一致。不能直接把本地其他强度控件的边界搬过来，负值的真实支持范围需独立核验。
- 每张参考图使每张生成额外消耗 5 Anlas；多图附加费累加。V4.5 Opus 的基础免费规则不能推出参考也免费。
- 支持多张，但该专题及相关数组 Schema 未明确统一数量上限；不能将 Vibe 的 16 张直接套用到精确参考。
- 官方建议清楚的设定图，必要时加面部局部，支持多视图／转面图。原图会等比放入 `1024×1536`、`1472×1472` 或 `1536×1024` 画布，放大或缩小并填边；API 注释明确为黑色填边，不能按输出画幅裁切人物。
- 可以配合官方 Inpainting；本工程官方重绘尚未接入，精确参考上线不能顺带声称已具备该组合。

生成请求的 `parameters` 已公开以下字段，属于另一组并行数组，不使用 Vibe 编码接口：

```text
director_reference_images
director_reference_descriptions
director_reference_information_extracted
director_reference_strength_values
director_reference_secondary_strength_values
```

其中 images 是上述尺寸的参考图，descriptions 是 `image.V4ConditionInput[]`，secondary_strength_values 对应 Fidelity；各数组应同序。Schema 的 descriptions 注释只示例 `character` 和 `character&style`，但产品另有 Style 模式；风格单独模式的准确 caption、information_extracted 的固定／可调语义及完整示例仍须核对，不能以猜测替代请求契约。

## 本工程现状与需要补齐的链路

| 环节 | 现状 | 适配工作 |
| --- | --- | --- |
| 绘图表单与画板 | `domain/drawing.ts` 没有图片参考字段 | 独立用途、资产 ID、启停、每图参数及板间隔离；图片大对象不进深层 reactive 或 localStorage |
| 官方编码路径 | `gateway/profile.ts` 未登记 `/ai/encode-vibe` | 增加显式路径与二进制响应处理、鉴权、取消；仍走应用级任务纪律 |
| 出站转换 | `gateway/routes.ts` 仅组装文字／角色／基础采样字段 | 分开构造 Vibe 与 director 数组，提交前检查互斥、尺寸、数量、有效参数 |
| 来源筛选 | `supportsSourcePayload` 只检查现有工具、图片数和常规选项 | 按型号和连接明确声明两种参考能力；不能选择后丢弃图片／参数，不能把中转字段假定为官方协议 |
| 余额与执行 | 当前官方预检未识别编码和参考附加费 | 编码与生成分别看 Anlas；已知不足不能因 V5 用量或基础免费资格而放行，不改未知余额顺位规则 |
| 缓存与存储 | 没有独立绘图参考原图／编码存储 | 资产、缩略图与多份编码放本机存储，写入经 data.write；缓存键包含图片内容、编码模型／版本、提取量及会影响编码的选项，不假设跨代通用 |
| 元数据导入 | `native/image-meta.ts` 仅显示 Vibe／角色参考张数 | 解析可复用编码和每图参数；旧“角色参考”概括需区分精确参考类型；无原图的编码进入只读提取量状态 |
| 收藏、历史与备份 | 现有字段没有参考资产闭包 | 冻结在途快照，历史／收藏保留复用所需内容；导出与恢复不能只有悬空 ID，制定编码体积上限与资源回收 |
| ASK | 摘要中的 `vibes` 固定空数组 | 先能读取实际用途、参数和可用状态；不能因此自动开放上传、收费编码、生成或写入工具权限 |

Vibe 缓存和现有中转“服务端缓存”是不同概念。编码由明确用户操作触发，上传／移动提取量滑杆／预报价／挂载与恢复都不自动收费；应在明确提交时编码，或提供明确的“编码 · 2 Anlas”操作。无需恢复逐次付费确认弹窗。编码成功后立即按数据租约保存，即使后续生成失败，也不丢掉已付费得到的编码。取消或超时不自动重试编码／生成。

官方、兼容中转的参考与编码能力需分别声明；首轮官方适配不证明标准网关同时支持。来源变更应保持用户完整意图，不静默删参考、不自动切型号；提交后不换源重试。固定附加费只能标为官方附加费用，不能冒充整张图的精确报价。

## 界面建议与实施顺序（尚未实施）

保留当前模型行 `NAI V5 Full ⌄　动漫 ⌄　High ⌄`，不往该行继续加功能。在描述／角色区域附近提供紧凑的“参考图”入口，空态收起，选中后显示数量与少量横向缩略图；点击进入站内同质感浮层。上传时明确图片用途，Vibe 和精确参考分开管理；不把图片参考塞进文字角色卡并暗示一对一绑定。

编辑浮层：Vibe 每图显示强度、提取量和已编码／待编码状态；精确参考显示类型、强度与保真度；归一化和导入／导出放在 Vibe 的次级操作中。不在主侧栏常驻所有滑杆与长说明。切到 V5 后保留本地参考配置并标为当前型号不可用；仍启用的参考须先由用户停用或切回支持型号再提交，不能静默删图或忽略参数。

建议先收口 V4.5 两条请求的精确契约，再实施共享参考资产与 UI，优先让精确参考的类型／图片预处理／生成闭环可测；随后补 Vibe 的付费编码、持久缓存与生成，避免交付一个每次重复编码收费的临时版本。官方编码文件与 PNG 元数据的导入／导出、收藏／备份恢复属于复用闭环，不能因按钮先上线而宣称完整适配。

必要模拟覆盖包括并行数组一致性、Vibe／精确互斥、切型号不丢本地设置、未验证来源拦截、同图同提取量复用、不同提取量不误命中、取消／失败不重试、编码成功而生成失败仍保留缓存、资产引用回收、无原图编码导入，以及 320／390／768／1440px 浮层与缩略图布局。真实收费联调另行授权。
