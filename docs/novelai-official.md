# NovelAI 官方基础接入

更新：2026-10-25。官方 API 作为独立 `nai-official-v1` Profile；用户单独添加连接和 Key。基础协议、角色参数和响应处理已模拟验证，真实型号、账户、生成和扣费尚待核验。历史接口来源与阶段证据见[归档](archive/2026-10-25/README.md)。

## 已接入能力

- **主机与鉴权**：图片固定为 `https://image.novelai.net`，订阅读取 `https://api.novelai.net/user/subscription`，Bearer Key。设置明确显示两个接收域名；不从另一主机的连接自动转发已有 Key。
- **目录**：订阅验证后提供本地静态 V5／V4.5 Full、Curated 表；界面保持「基础接入」「生图尚未实测」。本地目录不等于所有型号已经实测。
- **基础生图／图生图**：`POST /ai/generate-image`，`input/model/action/parameters`；图生图提交单张 PNG 底图和 strength／noise，读取 ZIP 原图。
- **多角色**：按同一领域快照生成 `v4_prompt`／`v4_negative_prompt`，正负数组同序；自动定位关闭 `use_coords`，V4.5 发送格中心，V5 保留自由坐标。见[角色映射](multi-character-boards-plan.md#协议映射与元数据)。
- **额度**：读取订阅中的 `fixedTrainingStepsLeft` 与 `purchasedTrainingSteps`，有效值相加显示 Anlas，缺失显示未知。不推断本次扣费、免费额度、订阅优惠或 V5 用量。

## 当前边界

不提供预报价或费用上限，不发送 `max_cost`，不预占；费用为未知。仅声明已接入的基础 img2img 工具，官方蒙版重绘与放大未开放。它们出现在官方文档或 Schema 中不代表本工程已完成联调。

仅支持浏览器直连，依赖官方 CORS。本地代理支持标准网关和 ASK 两协议，不代理 NAI 官方。任务仍共用 N=1、支持取消、失败停止且不自动重试；标准网关原有报价与额度保护不变。

## 后续核验

真实生成需明确授权，分别检查：

1. 订阅响应、CORS、鉴权及账户访问权限。
2. 具体 V4.5／V5 型号、必需字段、尺寸限制、返回格式和角色采用效果；记录生成前后额度。
3. 图生图对齐、强度与噪声；官方重绘模型、蒙版规格、请求参数与扣费。
4. 放大路径、请求体、返回格式、倍数与价格，核验后才声明能力。
5. 订阅优惠、V5 用量／回充及各档规则，未知时继续显示费用未知。

公开参考为[图片 Schema](https://image.novelai.net/docs/doc.json)、[账户 API](https://api.novelai.net/docs)及[产品说明](https://docs.novelai.net/en/image/)。本轮文档整理未重新访问这些来源，旧读取日期与证据保存在归档。
