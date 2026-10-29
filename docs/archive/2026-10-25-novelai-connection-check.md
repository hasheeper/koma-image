# NovelAI 官方连接兼容验证记录

日期：2026-10-25。基线提交：`72fb655`，验证对象为其上的本次工作区修改。本文件保存当时的证据与范围，现行契约见 [NovelAI 官方基础接入](../novelai-official.md)，不构成后续真实生成、推送或部署授权。

## 接口证据与修改

- 获用户授权执行官方账户只读检查。`api.novelai.net/user/subscription` 返回 400，并提示第三方工具更新图片主机；`image.novelai.net/user/subscription` 可以鉴权成功。
- 一个 `active=false`、`tier=0` 的有效账户仍返回购买余额。因此将鉴权识别与订阅权益分开，不再用未订阅或零余额拒绝有效 Key。
- 官方 [Schema](https://image.novelai.net/docs/doc.json) 和 [API 文档](https://image.novelai.net/docs/index.html) 已复核。客户端的账户与图片请求统一使用图片主机；未增加备用域名或自动重试。
- 连接摘要显示「Key 有效」，完整状态区分订阅激活与未订阅，仍注明生图未实测。401、403 和明确的 Cloudflare 拦截分别处理；启动失败提示保留具体原因。

## 实际运行的验证

- `npm run check` 通过：字体、Stylelint、严格类型检查、234 项单元测试及生产构建。保留已有大 JS 分块提示。
- `node --test tests/native-protocols.browser.mjs`：7 项通过。所有上游请求均被模拟服务拦截；覆盖未订阅账号的添加、Key 设置、余额和静态模型加载、手动测试，以及 Cloudflare 失败归因。
- `node --test --test-name-pattern='startup:' tests/shared.browser.mjs`：6 项通过，覆盖启动、恢复 Key、手动测试、锁定和旧请求失效等行为。
- 320／390／768／1440px 页面检查及截图复核通过。未订阅账号使用合成凭据和合成余额，不使用真实账号截图。
- 使用用户授权的 Key 运行修改后的 `testConnection` 和 `createGateway`，实际执行 3 次官方账户 GET，识别为有效未订阅账号，读到余额并加载 4 个静态模型。该检查使用本机 HTTP 传输桥接；真实浏览器跨域行为未由此验证。

## 边界

真实 Key 仅用于临时内存中的只读检查，不写入源码、测试夹具、配置或此文档。真实账户详情不作为测试夹具保存。没有真实生成或扣费，没有推送或部署。静态模型加载和账户鉴权成功不证明模型生成权限、免费资格或效果。
