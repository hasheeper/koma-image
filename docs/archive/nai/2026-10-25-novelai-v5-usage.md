# NovelAI V5 额度展示验证

日期：2026-10-25。基线提交：`72fb655`，验证对象为其上的工作区修改，包含此前的[连接兼容修复](2026-10-25-novelai-connection-check.md)。现行规则见 [NovelAI 官方基础接入](../../integrations/novelai.md)。

## 依据与范围

- 复核官方 [Schema](https://image.novelai.net/docs/doc.json) 中 `usagelimit.Status`，以及 [FAQ](https://docs.novelai.net/en/faq) 和[订阅说明](https://docs.novelai.net/en/subscription)。V5 Opus 用量与 Anlas 分开；用量会持续恢复，未订阅时也可能返回百分比，但这不代表当前享有权益。
- 复用已有账户查询返回的 `subscription.usage`，无需新增端点。连接卡显示 `percent`、进度条与必要状态，正值 `purchasedPercent` 单列，不合并余额。百分比超过 100 时保留文字原值，仅限制进度条宽度；缺失或非法数据不伪装为零。
- 按用户要求移除恢复时间注释。没有新增倒计时、轮询、额度拦截或收费逻辑，标准网关的额度规则保持原样。

## 首次额度展示验证

- `npm run check` 通过：字体、Stylelint、严格类型检查、236 项单元测试和生产构建；保留已有大 JS 分块提示。
- `node --test tests/native-protocols.browser.mjs`：8 项通过，全部上游由模拟服务拦截。V5 新增覆盖独立百分比、正值加购、手动刷新、超过 100%、不可用的零值、缺失用量、未订阅账号，以及不展示恢复时间。
- 320／390／768／1440px 截图复核，无横向溢出；正常额度无下方注释。全部使用合成凭据和合成账户数据。

本次仅访问公开说明与 Schema，没有重新查询真实账户、执行真实生成或扣费，没有推送或部署。V5 实际消耗、回充和免费资格仍待独立验证。

## 剩余张数估算补充

用户随后要求展示大致剩余张数。依据同日复核的官方 FAQ：23 步、约 1MP 时，100% 约能生成 1,730 张。连接卡在 V5 百分比下显示「约 X 张」，以主百分比乘 1,730 / 100 后四舍五入；换算基准及尺寸、步数、Effort 的影响放在提示中。未订阅、非 Opus、用量未知或暂不可用时不展示张数；不将加购百分比或 Anlas 相加，不恢复时间注释。

- `npm run check` 通过：237 项单元测试及字体、样式、类型和生产构建；保留已有大 JS 分块提示。
- `node --test --test-name-pattern='NovelAI V5 settings' tests/native-protocols.browser.mjs`：1 项定向回归通过，覆盖估算显示、刷新、超过 100% 和不可估算状态。
- 320／390／768／1440px 截图复核通过，使用合成账户；没有真实生成、扣费、推送或部署。

随后按用户要求将张数移至百分比右侧同行显示，移除独占的下方行，恢复卡片原高度；重新通过 `npm run check`、V5 定向浏览器回归及四种宽度截图复核。换算逻辑和提示依据不变。
