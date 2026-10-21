# Koma ASK A4：本地推理代理与行内模式

2026-10-21，分支 `codex/ask-a4`，接续 A3 提交 `eef130b`。A0–A4 功能开发收口，真实图片黄金样例、真实模型的诊断／提纯质量及供应商实测仍单列待办。

## 本地推理代理

新增两组独立、可选的服务端环境变量，每组 URL／Key 必须同时设置；不复用图像网关密钥，可只配置 ASK：

| 协议 | 环境变量 | 地址规则 |
| --- | --- | --- |
| OpenAI Chat | `KOMA_ASK_OPENAI_URL`、`KOMA_ASK_OPENAI_KEY` | 含版本路径的接口地址原样拼接；只填服务根地址时补 `/v1` |
| Anthropic Messages | `KOMA_ASK_ANTHROPIC_URL`、`KOMA_ASK_ANTHROPIC_KEY` | 服务根地址或 `/v1` 地址；服务前缀保留，`/v1` 只拼接一次 |

URL 使用 HTTPS 或本机 HTTP，不含查询参数、凭据或 fragment。原 `KOMA_GATEWAY_URL`／`KOMA_GATEWAY_KEY` 的标准网关规则保持不变。所有组都为空时仍使用浏览器配置模式，静态托管不主动探测代理。配置变化后重启服务并刷新页面。

本机白名单路径如下，可在 `KOMA_BASE_PATH` 子目录下使用：

| 本机路径 | 方法 |
| --- | --- |
| `/api/ask/openai/models` | GET |
| `/api/ask/openai/chat/completions` | POST |
| `/api/ask/anthropic/v1/models` | GET（仅允许固定 `limit=1000` 查询） |
| `/api/ask/anthropic/v1/messages` | POST |

沿用回环监听、Host／Origin 与本地会话令牌校验。浏览器只得到已配置的协议标识、同源地址和会话令牌；上游 URL／Key 仅存在于服务端。OpenAI 的 Bearer 和 Anthropic 的 `x-api-key`／版本头由服务端设置，不转发浏览器鉴权、Cookie、本地令牌或 Anthropic 浏览器直连声明头。

请求 JSON 字节保持原样，SSE 增量转发，支持中断与超时，不自动重试。错误保留上游状态码；已配置的凭据与地址在错误及 SSE 回显中脱敏，覆盖跨字节边界与 Unicode。标准网关原有路径和报价／额度行为不变。

本地连接为只读管理连接，不写入 `koma.routing.v1` 或 vault；本地模型来源仍单独保存。「设置 → ASK」可选择已配置的推理连接、获取模型 ID 或手动填写。未配置推理连接时显示配置提示。发布包生成空变量模板，不复制真实 `.env`。

## 行内 ASK

在 Prompt、Negative 或 CHAT 输入框按 ⌘K／Ctrl+K，使用选中文字作为上下文；没有选区时使用整个字段，最多 24,000 字。不自动发送，原表单保持不变。发送时将 `inline_selection` 放在动态工作区快照中，不改变静态前缀。

行内面板复用原会话、工具循环与草稿卡。「展开」保留输入和草稿，切回完整抽屉。草稿确认、冲突校验、应用、一次撤销及 Esc 层级沿用 A2／A3；有未决草稿时先打开该草稿，不覆盖提议。

Tag 补全的 Tab 选词和 Esc 关闭保持原行为；K 将焦点移入 ASK，并关闭补全，不自动选词。输入法组合中、模态面板、编辑器、其他输入框、推理或写入进行中不响应 K。关闭 ASK 后返回来源输入框；输入框中的 Tab 不应用草稿。

定位通过原生滚动／缩放监听、ResizeObserver 和动画帧更新 CSS 变量，不用 Vue 承担逐帧定位；隐藏与销毁时清理监听、观察器和待执行帧。面板在 320／390／768／1440px 内可见，手机宽度简化标题栏以保留操作空间。

## 验证与边界

- `npm run check`：119 项单元测试、字体、样式、严格类型与生产构建通过。
- `node --test --test-concurrency=2 tests/*.browser.mjs tests/release.package.mjs`：78 项全部通过，包含 A3 S6、A4 行内流程、两种协议的生产本地代理与发布包。
- 补齐缩放后定位与观察器清理后，重新执行 `npm run check`，并复验 ASK／外壳浏览器用例 27 项，全部通过。
- 本地代理测试覆盖固定路径、独立配置、鉴权、原始字节、流式提前输出、跨字节脱敏、Unicode、中断、错误状态、只读连接与存储隔离。
- 浏览器验证选区快照、确认前只读、展开保留草稿、应用与撤销、原生焦点、Tag／IME 共存；两种协议均经浏览器 → 本地代理 → 模拟 HTTP 上游完成工具和草稿流程，无图像生成或 CHAT 发送请求。
- 四宽截图位于 `.local/ask/a4/inline-{320,390,768,1440}.png`，仅作本机验收，不提交。A3 截图位于 `.local/ask/a3/`。

全部使用合成图片与模拟推理，不代表真实供应商可用、CORS／账户权限或实际回答质量已经验证。未新增依赖，未推送或部署。
