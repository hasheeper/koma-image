# 图像协议能力与边界

更新：2026-10-25。基础适配已经完成代码和模拟验证；供应商型号、权限、CORS、实际生成与扣费仍须逐项核验。NovelAI 官方已有授权的账户只读验证，范围见[官方接入](novelai-official.md)，不能推导为生成成功。历史协议勘探和测试范围见[归档](archive/2026-10-25/README.md)。

## 接口能力与当前范围


| 协议 | 模型与鉴权 | 基础生成与修改 | 费用与额度 | 当前边界 |
| --- | --- | --- | --- | --- |
| OpenAI Images | GET /v1/models；Bearer；读取 ID，由现有模型页匹配 | POST /v1/images/generations：JSON；POST /v1/images/edits：multipart，参考图使用 image[]；返回 data[].b64_json | 不假造预报价或账户余额；费用未知 | 对话页生图与参考图修改；不包含 Responses、流式部分图片、DALL·E、蒙版编辑或远程结果 URL 下载 |
| Gemini 原生 | GET /v1beta/models?pageSize=1000，单次读取 ID；x-goog-api-key | POST /v1beta/models/{model}:generateContent；contents/parts/inlineData；generationConfig；读取文本和内嵌图片 | 不套用标准网关的积分与 300／400 阈值；费用未知 | 对话页生图与参考图修改；沿用现有拼接上下文，每次请求独立，不宣称已经实现有状态的原生多轮和 thoughtSignature 续传 |
| NovelAI 官方 | 账户与图片统一为 image.novelai.net；Bearer；GET /user/subscription；未订阅不阻止 Key 识别 | POST /ai/generate-image；input/model/action/parameters；基础生图、img2img、ZIP 原图解包 | Anlas 为订阅与购买余额之和；连接卡另显 V5 百分比、官方基准下的张数估算、加购百分比及必要状态；不推断免费或本次扣费 | 静态表包含四个基础型号和 V5 Full Medium 文生图；绘图预设、Effort、Complexity 与独立 Rescale 已模拟核验，真实生成尚未实测；官方蒙版、放大、订阅优惠、V5 实际消耗／回充与具体模型参数仍待核验 |
| Koma 标准网关 | 原目录、统计与鉴权 | 原三条执行路线 | 650/400ms 报价、执行前重报、max_cost、涨价提示、批量最多提示一次、原额度保护 | 行为保持；新增协议不关闭此协议的报价保护 |

这里的“协议”与连接名称、渠道无关。用户配置的兼容服务可以选择其真正提供的 OpenAI Images 或 Gemini 原生协议；不按域名推断，不在正式源码中内置私有服务名称、地址或 Key。新环境连接仍为空。

多角色映射：标准报价／Studio／工具发送 `characters: [{ prompt, uc, center }]` 与顶层 `use_coords`；免费原生与官方继续使用同一领域快照构造 `v4_prompt`／`v4_negative_prompt` 正负数组，避免标准转换影响原生内容。字段依据为实际只读解析与报价探测，请求及参数往返已模拟验证，真实生成仍待实测。详情见[多角色与画板](multi-character-boards-plan.md#协议映射与元数据)。

## 已落地的结构

- `gateway/profile.ts` 统一登记四种图像协议及两种 ASK 推理协议，声明鉴权、目录、报价、额度和路径能力。新增连接和现有连接均显式选择协议；未知 Profile 继续拒绝。
- `gateway/native-protocols.ts` 分开处理原生 ID 列表与匹配后的执行能力；UI／领域层继续使用现有规范模型与参数。不要求目录返回 studio_features，不按 ID 的品牌前缀或 supportedGenerationMethods 筛掉模型；未匹配 ID 留在设置供用户选择，不自动变成可生图模型。
- `gateway/transport.ts` 处理 Gemini 的安全模型路径、OpenAI 的 multipart 边界，以及官方 NAI 的固定主机请求。Gemini 单次请求最多 1000 条，不追读 nextPageToken；URL 不携带 Key，不跟随重定向，版本前缀不重复拼接。
- 原生协议不支持报价时，对话与编辑不再把“没有报价接口”显示成连接错误；编辑执行条件仍校验所选模型、源图和操作能力。费用始终为未知，不伪装成免费。
- NAI 官方只允许固定图片地址，账户查询也使用该地址；添加时明确说明 Key 的唯一接收域名。已有其他地址的连接不能通过切换协议把保存的 Key 自动发送到官方域名，需单独添加并填写 Key。
- 所有任务继续走应用级 runTask，共用 N=1；保留取消、超时、失败停止、不自动重试及原图字节。不改变数据键名；新版连接配置和备份携带 profileId。
- 本地 `server.mjs` 支持标准网关与两种 ASK 推理协议的固定路径，不是任意 URL 转发器。OpenAI Images、Gemini 原生与 NovelAI 官方仅用于浏览器直连，服务须允许跨域。

## 模型目录与来源

OpenAI／Gemini 每次拉取只发一次模型列表请求；Gemini 使用 `pageSize=1000`，不追读分页。列表只用来取得 ID，Gemini 去掉 `models/` 前缀；不按品牌、`studio_features` 或 `supportedGenerationMethods` 筛掉条目。未知 ID 留在设置中，用户可手动指定映射；仅有 ID 不自动成为可执行图像模型。

能力来自用户选择的规范模型，实际请求保留所选上游 ID。目录、匹配和执行能力分开；关闭来源后不能继续使用该来源。模型存在于本地目录不代表真实型号能力或账户权限已经核验。

可用来源和供应商优先级独立配置；同一模型、当前操作及参数先筛选可用来源，再按连接页顺序检查报价和余额。明确不足才顺位选择，余额未知仍按优先级；生成提交后不换源重试。NAI 官方不支持的工具可以由后面的兼容来源执行。排序、额度判定与同步规则见[设置](shared-settings-tags.md#连接目录与反馈)。

## 费用、运行与待验

标准网关的报价、重报、`max_cost`、分流与额度保护保持。其他图像协议没有预报价时保留未知费用状态，生成按钮暂不显示费用标签；不推算免费或每次实际扣费。所有图像任务共用 N=1，取消、超时、失败停止和不自动重试保持。

真实联调须分别记录目录／鉴权、参数、响应格式、CORS、生成效果及扣费；只读成功不能代替生成实测。NAI 高级能力见[官方接入](novelai-official.md)，其他未实现范围见[当前待办](implementation-plan.md)。

NAI 官方另声明固定 `POST /ai/encode-vibe`，仅任务作用域可调用。V4.5 参考请求与原图预处理、编码缓存和费用下限见[参考契约](novelai-official.md#vibe-与精确参考边界)；标准网关和其他协议未声明这些字段时明确拒绝，不转发应用内参考计划。
