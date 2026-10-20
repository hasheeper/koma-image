# 原生图像协议接入

2026-10-21。新增 OpenAI Images、Gemini 原生和 NovelAI 官方基础接入。现有 Koma 标准网关继续保留报价、max_cost、原生／Studio／工具分流、额度护栏及 N=1 调度。

## 接口能力与当前范围

| 协议 | 模型与鉴权 | 基础生成与修改 | 费用与额度 | 当前边界 |
| --- | --- | --- | --- | --- |
| OpenAI Images | GET /v1/models；Bearer；筛选 GPT Image 图像模型 | POST /v1/images/generations：JSON；POST /v1/images/edits：multipart，参考图使用 image[]；返回 data[].b64_json | 不假造预报价或账户余额；费用未知 | 对话页生图与参考图修改；不包含 Responses、流式部分图片、DALL·E、蒙版编辑或远程结果 URL 下载 |
| Gemini 原生 | GET /v1beta/models，读取分页；x-goog-api-key | POST /v1beta/models/{model}:generateContent；contents/parts/inlineData；generationConfig；读取文本和内嵌图片 | 不套用标准网关的积分与 300／400 阈值；费用未知 | 对话页生图与参考图修改；沿用现有拼接上下文，每次请求独立，不宣称已经实现有状态的原生多轮和 thoughtSignature 续传 |
| NovelAI 官方 | 图片主机 image.novelai.net；账户主机 api.novelai.net；Bearer；GET /user/subscription | POST /ai/generate-image；input/model/action/parameters；基础生图、img2img、ZIP 原图解包 | 显示账户返回的两类可用额度之和为 Anlas；不推断免费、不生成虚拟报价，不承诺本次扣费 | 静态模型表沿用现有 NAI 型号，界面标记尚未实测；官方蒙版、放大、订阅优惠、V5 限额与具体模型参数仍待核验 |
| Koma 标准网关 | 原目录、统计与鉴权 | 原三条执行路线 | 650/400ms 报价、执行前重报、max_cost、涨价提示、批量最多提示一次、原额度保护 | 行为保持；新增协议不关闭此协议的报价保护 |

这里的“协议”与连接名称、渠道无关。用户配置的兼容服务可以选择其真正提供的 OpenAI Images 或 Gemini 原生协议；不按域名推断，不在正式源码中内置私有服务名称、地址或 Key。新环境连接仍为空。

## 已落地的结构

- `gateway/profile.ts` 统一登记四种协议及鉴权、目录、报价、额度和路径能力。新增连接和现有连接均显式选择协议；未知 Profile 继续拒绝。
- `gateway/native-protocols.ts` 负责原生目录和请求转换；UI／领域层继续使用现有规范模型与参数。模型目录不再要求所有协议返回 studio_features。
- `gateway/transport.ts` 处理 Gemini 的安全模型路径、目录分页、OpenAI 的 multipart 边界，以及官方 NAI 的账户／图片两主机。URL 不携带 Key，不跟随重定向；版本前缀不会重复拼接。
- 原生协议不支持报价时，对话与编辑不再把“没有报价接口”显示成连接错误；编辑执行条件仍校验所选模型、源图和操作能力。费用始终为未知，不伪装成免费。
- NAI 官方只允许固定图片地址；添加时明确说明 Key 的两个官方接收域名。已有其他地址的连接不能通过切换协议把保存的 Key 自动发送到官方域名，需单独添加并填写 Key。
- 所有任务继续走应用级 runTask，共用 N=1；保留取消、超时、失败停止、不自动重试及原图字节。不改变数据键名；新版连接配置和备份携带 profileId。
- 本地 server.mjs 本轮仍仅代理 Koma 标准网关，不将其改为任意 URL 转发器。原生协议先用于浏览器直连；服务须允许跨域。

## 文档依据与验证边界

- [OpenAI Image generation](https://developers.openai.com/api/docs/guides/image-generation) 与 [Images API](https://platform.openai.com/docs/api-reference/images)：本轮访问返回 403／连接中断，未完成当日在线文档复核。当前实现限于既有稳定 Images REST 请求形状；不据此宣称新的模型型号、定价或账户可用性。
- [Gemini Image generation](https://ai.google.dev/gemini-api/docs/image-generation)：本轮访问超时；Discovery 服务亦未成功读取。已按原生 generateContent 的基础请求／响应结构实现模拟契约验证；实际服务的模型列表、可选参数与权限仍需真实连接核实。
- [NovelAI API Swagger](https://api.novelai.net/docs)（其 swagger-ui-init.js 内的 OpenAPI 已读取）明确列出 /user/subscription、/ai/generate-image、Bearer，以及 generate／img2img／infill 动作；但模型枚举较旧、parameters 为不透明对象，未覆盖现有 V4.5／V5 细节，也未列出 /ai/upscale。
- [NovelAI 图像说明](https://docs.novelai.net/en/image/)已读取，确认图生图强度／噪声等产品能力；产品文档不等同于最新版请求 Schema。不能仅凭订阅成功就声称具体模型生成成功。

实现验证使用合成图片、模拟 Key、拦截的网关响应，没有调用用户配置，也没有真实收费生成。模拟契约测试只能确认前端如何发请求、如何处理结果，不能替代供应商联调。

## 本轮验收

2026-10-21，本地完成：

- `npm run check` 通过：字体一致性、Stylelint、严格类型、65 项单元测试及生产构建。
- `node --test --test-concurrency=2 tests/*.browser.mjs tests/release.package.mjs`：55 项通过，合计 120 项自动化测试。
- 新增协议测试覆盖显式协议选择、版本路径去重、安全模型 ID、Gemini 分页、鉴权、JSON／multipart／inlineData、NAI ZIP 与图生图、未知费用保存与备份、不调用标准网关报价／额度接口，以及失败与取消不重试。
- 真实页面用合成响应完成两种对话协议的生成／参考图修改、NAI 绘图与编辑、协议保存／切换。禁止将已有其他地址连接的 Key 自动切到 NAI 官方，拒绝时控件恢复实际协议。未改原有标准网关回归断言。
- 320／390／768／1440px 设置界面检查通过，复用原有样式，无横向溢出；截图位于忽略提交的 `.local/native-protocols/`。
- 源码、文档、测试和构建产物的私有渠道标识／凭据模式扫描无命中。未增加依赖；此处记录本地验收，发布状态以实际 Git 提交与 Pages 部署为准。

## 后续步骤

1. **基础接入（本轮）**：协议选择、目录归一化、OpenAI JSON／multipart、Gemini inlineData、NAI 基础生图／图生图、无报价状态、备份与已有网关回归。
2. **协议联调**：用用户在设置中配置的目标地址与 Key 做只读目录／订阅检查；真实生成需单独明确授权，记录实际支持的型号、参数、图片格式、鉴权和 CORS。
3. **NAI 完整能力**：核验 V4.5／V5 请求参数、infill 模型与蒙版规格、upscale 请求及扣费，之后才开放官方蒙版／放大。订阅优惠与费用估计不能用原网关规则代替。
4. **可选后续**：OpenAI 蒙版、Responses；Gemini 原生多轮签名与流式结果；本地服务的多协议代理。各自独立验收，不混入基础接入。
