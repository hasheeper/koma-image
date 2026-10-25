# NovelAI V4.5／V5 能力核对与透明底显隐

日期：2026-10-25。基于 `codex/ask-chat-handoff` 分支、`2d0d490` 之后的未提交工作区；不代表远端或线上版本。

## 公开核对

只读查看官方 Models、Tags、Effort、Multi-Character Prompting、Vibe Transfer、Precise Reference、Sampling、Steps & Prompt Guidance、Inpaint、Upscale、Enhance、Quality Tags、Undesired Content、Text Rendering、Director Tools、Prompt Mixing 专题及图片 API Schema。没有使用真实 Key、读取账户或执行真实生成。

主要结论：四个 V4.5／V5 基础型号已列出，缺口是模式、工具和参数约束；V5 Full Medium 是蒸馏模式，不等于修改步数；精确参考专题明确仅 V4.5；透明 Alpha 与复杂度标签仅 V5。公开 Schema 未列出 model 枚举，未猜测新增重绘／蒸馏 ID。

现行矩阵、参数缺口、来源链接和接入顺序统一维护于 [NovelAI 官方](../novelai-official.md)，不在本记录复制另一份规则。

## 本次变更

- `DrawingControls.vue` 按模型透明能力显示开关；不支持时隐藏并排除参数徽标计数。
- 切换回 V5 保留原开关选择；领域提交继续按模型过滤自动透明标签，用户原文不被删改。
- 同步绘图文档、NAI 现行说明、待办和文档索引。

## 本地验证

- `npm run check`：字体、样式、严格类型、252 项单元测试与生产构建通过；保留现有大 chunk 提示。
- `node --test --test-name-pattern='NovelAI model controls' tests/native-protocols.browser.mjs`：通过。覆盖四个型号切换、偏好保留、参数徽标，以及模拟 V4.5／V5 请求是否附加透明标签。初次脚本点击隐藏的原生 checkbox 超时，改为点击用户可见 label 后通过，没有放宽超时。
- 320／390／768／1440px 分别检查 V4.5 与 V5 完整页面，透明行显隐正常，无横向溢出。
- `node --test tests/local.browser.mjs`：3 项通过，覆盖本地只读连接、模型偏好、备份、生成／编辑与两种 ASK 代理协议。

所有上游请求由本地模拟拦截，合成图片仅验证程序行为，未验证真实透明 Alpha、生成质量或扣费。没有推送或部署。
