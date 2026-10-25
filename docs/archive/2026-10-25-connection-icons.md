# 连接图标区分与官方 Logo 验证

日期：2026-10-25。基线提交：`2d0d490`，验证对象为其上的工作区修改，保留此前的 NAI 连接与额度展示改动。现行规则见[连接设置](../shared-settings-tags.md)与[第三方资源](../third-party-assets.md)。

## 修改范围

- 用户要求 NovelAI 官方连接显示品牌 Logo，默认图标分为 LLM 与生图；随后补充 Google AI Studio／GCP Vertex AI、OpenAI 官方／Azure OpenAI 的品牌图标。
- `ConnectionAvatar.vue` 统一连接卡片、模型列表标题和模型来源的图标。官方图标复用现有 LobeHub SVG 及许可；默认图标使用站内对话／图片 sprite，空列表使用连接图标。删除不再使用的人形默认头像资源。
- `domain/connection-icon.ts` 只维护展示身份：固定 NAI Profile 或明确的官方 HTTPS 主机使用对应 Logo，其余按 Profile 能力区分。名称、相似主机、转发路径和兼容协议名不构成官方身份；Azure 共用的 AI Services 域名还需 `/openai` 路径。
- 不修改协议选择、请求、鉴权、模型能力、连接配置或默认连接，不增加远程头像请求；卡片尺寸保持原样。

## 实际验证

- `npm run check` 通过：字体、Stylelint、严格类型检查、240 项单元测试与生产构建；保留已有大 JS 分块提示。
- `tests/native-protocols.browser.mjs` 全部 9 项通过，包括 Google AIS、Vertex 全局／区域、OpenAI、Azure OpenAI、Azure AI Services OpenAI 路径在卡片和模型列表中的图标，以及已有原生协议回归。
- `tests/shared.browser.mjs` 的 `settings: empty network default`、`tests/ask.browser.mjs` 的 `ASK settings leave image work alone` 各 1 项通过，覆盖生图与 LLM 默认图标、模型列表及来源行。
- 生产构建的 `tests/shell.browser.mjs` 中 `neutral HTML redirects` 1 项通过，确认根路径与静态子路径下 SVG sprite 可访问；按相对资源地址核对，不要求根路径 URL。
- NovelAI、Google、OpenAI、通用生图和通用 LLM 在 320／390／768／1440px 截图复核通过；Vertex 与 Azure 另有桌面截图。使用合成配置，所有浏览器上游请求均由模拟服务拦截。

未读取真实账户、未执行真实生成或扣费，未推送或部署。图标识别不构成官方接口或账户可用性的联调证明。
