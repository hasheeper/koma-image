# ASK 三层提示词与成人模式注入

2026-10-22，按用户提供的分层方案调整。提示词版本为 `c4.w3.m3`；此次调整不改变生图、扣费、草稿确认与撤销行为。

## 文件职责

| 层级 | 文件 | 内容 |
| --- | --- | --- |
| L0 | `src/ask/prompts/constitution.ts` | 创作搭档身份、通用原则、文体/基底配方保护、六维理解与工具方法；adult 单独导出 |
| L1 | `src/ask/prompts/workspaces.ts` | IMAGE / CHAT / TAGS / EDIT 的真实界面、状态字段、图片索引与草稿动作 |
| L2 | `src/ask/prompts/models.ts` | 全模型常驻核心：NAI 4.5/V5、Full/Curated、Medium/High、自然语言图像模型与语法互转 |
| 专项手册 | `src/ask/prompts/manuals.ts` | nai5-prompting、nai5-comics、oc-costume-design；正文按需发送 |
| 组装 | `src/ask/prompts/index.ts` | 不变的 L0 + L1 + L2，之后按 adult 布尔值追加成人语境；个人偏好仍在 System Block 2 |

不再使用旧版「只读诊断助手」「默认不超过 5 句」「对没有把握的事保持沉默」作为表达基调；改为主动创作、详略随事、区分事实与推测。不能生成、发送或扣费，修改仍必须经用户确认草稿。

## 成人模式

- 未确认：不注入「创作语境与题材包容」整段，包括成年环境声明、成人题材包容、防保守化暗改与边界提示；不会通过 L1/L2 或手册重复注入。
- 已确认：在完整的中立核心之后追加 `constitution.adult`，仅一次。以成年虚构角色为前提，范围不含未成年性内容与 R18G；原有代码排除表不变。
- 开关继续保存在独立的 `koma.ask.adult.v1`，默认关闭且不进备份。变化从下一轮发送生效，同一轮各次 AI 调用仍使用已锁定的系统块。
- 关闭后，后续请求的系统块恢复为中立版本；用户已有的对话、提示词与工具历史不会被重写。

## 按需知识与缓存

`get_model_manual({ id })` 只能读取三个内置 ID，不接收任意文件路径或 URL、不联网、不写入工作区；不依赖当前图片或会话，元数据模式也可使用。正常记录在工具轨迹与每次调用调试中，计入原有每轮六次工具预算。

三个专项手册的正文不在 System Block 1 或工具 Schema 中；读取后以 `<data>` 包裹的工具结果追加到队尾。切换工作区或生图模型不换静态核心。系统、工具 Schema 或成人模式变动可能影响缓存匹配；缓存命中仍以服务端实际返回值为准，不能承诺 100% KV 命中。

## 事实与实现边界

- 依据本轮读取的 [官方模型说明](https://docs.novelai.net/en/image/models) 与 [V5 Full Effort 公告](https://journal.novelai.net/novelai-diffusion-v5-full-effort-toggle/)记录 NAI 版本差异、token 统计范围、22 角色、文字/Alpha、Medium 固定参数等事实。
- 专项手册另核对了 [Tagging](https://docs.novelai.net/en/image/tags)、[权重语法](https://docs.novelai.net/en/image/strengthening-weakening)与[多角色](https://docs.novelai.net/en/image/multiplecharacters)：complexity 是画面复杂度标签，不能与 Effort 档位混淆；source#hug / target#hug / mutual#hug 属于独立角色描述，官方也提示并非总是可靠。
- 不采用「Curated 无 NSFW」「Full 必然偏糊」「画师串完全不通用」「某权重区间是通用甜点」「与其他模型等价」等绝对结论。画幅、混排、角色与服装组织建议作为待图像验证的创作经验。
- 不从 GPT Image Flare/Sunburst 或 Nano Banana 的名字推断固定速度、真实权限、参考图上限或质量保证；以实际连接的能力与结果为准。
- L1 反映当前实现：角色分区与 Vibe 仍预留；草稿应用本身不请求报价；CHAT 分支草稿只使用工具返回的当前分支 ID；官方编辑能力以真实界面开放情况为准。

## 验证

新增单元检查：两种协议的成人附加块开关、工作区/模型切换不改变核心、手册不进入静态请求、精确 ID 校验与确定性只读返回。

新增模拟浏览器检查：OpenAI Chat 与 Anthropic Messages 中，发送途中改变成人模式不改变本轮工具循环；下轮追加成人语境，关闭后系统字节恢复；手册通过真实工具循环追加而非提前装载；不触发生图或报价。

本次只验证组装与模拟调用，未执行真实供应商生图或以模拟响应评定提示词质量。

本轮 `npm run check` 通过（字体、Stylelint、严格 TS、127 项单元测试、生产构建），`npm run test:ask` 的 32 项模拟页面测试通过，包含原有四个基础视口、草稿/撤销、视觉、CHAT、悬浮窗口与每次调用调试回归。
