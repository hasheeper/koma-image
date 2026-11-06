# ASK 的 NAI 基础感知

更新：2026-11-04。EA0 已接入 IMAGE，并由 [EDIT](edit.md)复用；本文维护现行读取与计算口径。获批方案见[规划归档](../archive/ask/2026-10-29-ask-nai-awareness-plan.md)，本地验证与真实待验边界见[验收记录](../archive/ask/2026-10-29-ask-edit-verification.md)。

## 数据来源与权限

`services/nai-awareness.ts` 将现有型号、Profile、参数编译、角色、参考、tokenizer 和费用函数组合为只读快照；`services/edit-awareness.ts` 适配编辑模式与实际请求尺寸。没有第二套分词器或计价公式，也不从组件或 tooltip 读取数字。

ASK 不选源、不刷新额度、不请求报价、不编码参考、不生成图片。摘要、`get_state`、草稿内自动检查、应用与撤销均遵守该限制。分词只加载同站点许可词表；真实执行仍由用户按工作区原有流程发起。

## 保存值、生效值与能力

IMAGE 表单在初始状态中展开或经 `get_state({board_id})` 显式读取时，保留完整原始词文及保存参数，包括 Variety+、noiseSchedule 和 transparentBg，并附带以下投影。EDIT 无有效 IMAGE 历史／收藏锚点时，初始与 latest 的 IMAGE 目录摘要不附这些字段，也不额外运行其分词；冻结原文仍留在本地供指定画板读取与草稿校验。


| 字段 | 内容 |
| --- | --- |
| `capabilities` | 规范型号、显示名、Profile、操作、可用型号、参数范围／选项／固定值、角色上限及定位、参考支持与当前启用情况 |
| `effective` | 实际采用的步数、采样器、Guidance／Rescale、调度、Variety+、预设、Complexity、透明底及被忽略的保存值 |
| `input_budget` | 分词状态、型号／分词器、输入指纹、正负各自合计／上限／剩余／超出量、基础与角色小计、Text 字符 |
| `cost` | 状态、估算或报价、单位、操作、计算尺寸、输入指纹、取得时间和已知分项 |
| `diagnostics` | 能力、结构和输入问题，区分 warning 与 error |

当前支持性来自实际来源与操作：Variety+ 仅官方 V4.5；V5 固定 Karras；Medium 生效为 14 步、Euler Ancestral、固定 Heavy 负向，不采用保存的用户负向与可调 Rescale。切换型号可保留休眠配置，但不能把新提议的不支持字段静默吞掉。参考的 `supported_kinds` 与 `active_kind` 分开；支持 Vibe／Precise 不代表可同时启用，Inpaint 仅 Precise，V5 两种参考仍未开放。

具体范围由 [NAI 专题](../integrations/novelai.md)和 `domain/nai*.ts` 维护。ASK 不把 Guidance 滑杆的 10 当作 API 硬上限，不把 IMAGE 的 2048 单边限制套给 EDIT，也不重开遗留 cfg 写入。

## Token 与 Text 预算

先编译有效基础词段与启用角色词段，逐段分词，再按方向求和：

```text
正向 used = T(有效基础正向) + Σ T(每个启用角色正向)
负向 used = T(有效基础负向) + Σ T(每个启用角色负向)
```

正负分别对照型号上限，不能相加后与一个额度比较，也不能互借。角色小计属于共同预算，新增角色没有额外额度；停用角色不计入。预设、Furry／Complexity／透明底与普通 Enhance 追加词在有效输入中计一次，Max 不追加普通 Enhance 词。Medium 的用户负向不参与；空段和 T5 EOS 沿用实际分词器，不能自行记为零。

上限直接读取 `naiInputLimits`：V4.5 为 T5／512 tokens／118 Text 字符，V5 Curated 为 Qwen3.5／703／374，V5 Full High 与 Medium 为 Qwen3.5／1471／750。每个方向独立使用 token 上限；Text 将基础与启用角色正向中的 `Text:` 后正文按 Unicode 字符合计，含空白和换行。Koma 不自动把双引号内容转换成 Text 块。

Token 超限为警告，说明上游可能截断，不自动删词；Text 超限是既有执行阻断。`pending/unavailable/error` 不填假零、不沿用旧输入计数；Upscale／Director 不套用生成词文预算。以上与 ASK 自身 220,000 tokens 的压缩阈值独立。

## 冻结与费用

每轮冻结表单、图片绑定、目录、来源修订及参考／费用读取端口。`input_hash` 绑定实际计算输入和来源；`get_state` 的 latest 只追加读取，不替换草稿基底。异步计数只回到对应冻结对象；费用和计数完成不进入草稿冲突 hash。

费用只使用匹配输入／来源且在有效时间内的工作区报价，或调用纯本地官方估算。当前账户／报价缓存超过 60 秒即不再当作当前有效依据；改输入、来源或连接修订会使旧报价失效。非秘密的计价字段按白名单保存，原始账户响应、地址、Key 和私有上游 ID 不进入模型上下文。

- `provider_quote` 与 `local_estimate` 分开；标准网关积分不能用官方 Anlas 公式替代。
- 已知时提供每张费用、每张参考附加费、一次编码费和批量总额。批量为「每张基础／参考费 × 张数 + 唯一待编码费」，不重复计算编码。
- 参考缓存未就绪、权益不足以判断或来源失效时保持 unknown／stale；已知参考下限单独标为 `lower_bound`，不冒充总价。
- 不恢复“Opus 免费”宣传；零 Anlas 不等于 V5 用量无消耗。V5 只提供近似口径说明，不在摘要默认输出冗长百分比。
- 用户执行仍使用原来的选源、执行前重报、max_cost、取消和不重试规则。

## 候选检查与元数据

每轮初始状态与 `get_state`（包括指定其他 IMAGE／EDIT 画板和 latest）自动附带计算好的 `input_budget` 与 `capabilities`。没有底图或计数不可用时如实标记，不能填零或声称已通过。

已知 NAI 型号尚未配置来源时，仍按本地型号规则编译词文并计算预算，允许先准备提示词草稿；`capabilities.ready` 保持 false，费用保持 unknown，草稿结果提示来源不可用。此时不选择来源、不推断渠道特有能力，Text 与 Medium 固定字段等已知约束仍照常检查。

内部 `checkNaiInput` 在 `propose_draft` 提交 NAI 词文、参数、角色、部分恢复或编辑配置时自动运行，不注册为模型可调用工具。使用共享草稿解析与验证器投影完整候选，在无效参数组回滚之前取出候选词文，因此错误回复不会拿原表单的计数冒充新稿。普通任务板、文件、CHAT 和非 NAI 草稿不套用 NAI 预算。

- 校验通过或只有普通 Token 超限提示：接纳草稿，返回正向／负向 Token 和 Text 的 `used / limit / remaining / overflow` 摘要，结束工具阶段。
- Text 字符超限、明确的位置错误、Medium 锁定字段或其他候选硬性错误：不接纳草稿，返回具体原因及可计算的精确计数；模型可修正后重新调用同一个 `propose_draft`。
- 分词暂不可用：保留 unavailable/error 状态与未核验提示，不伪造 Token 计数，也不因只读分词故障反复退回同一草稿；本地 Text 字符与结构约束仍检查。结构本身无法解析时沿用结构错误，不能捏造完整候选预算。

`Text:` 没有结束标记，其后全部内容均计入 Text 字符数。位置校验只处理明确结构：完整引号文字块之后又追加描述，或 Text 后另起 `Character N:`／Prompt／Negative／Style／Caption、artist／style 等段落。普通逗号、未加引号的台词、多行文字不凭语义猜测拦截；无法区分的自然语言仍整体计数。不会改写或挪动用户原文。

检查不写入、不消耗真实角色 ID，不额外占用工具额度，也不重复回传整套能力目录与费用结构。应用前仍检查当前目标、能力和冲突；生成前的原有校验保持。
图片 `get_meta/diff_meta` 已补齐 Variety+、调度、Enhance／聚焦、Director 参数及适用的来源配方。只读该图片记录中存在的字段，不从当前表单或同实体的另一条记录补造。原图、蒙版像素和参考编码不进入这些元数据。
