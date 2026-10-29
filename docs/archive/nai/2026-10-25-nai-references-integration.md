# NAI 参考链路与统一底部抽屉

日期：2026-10-25。分支 `codex/ask-chat-handoff`，在既有未提交改动上实施；没有推送或部署。用户确认将最终静态方案原样应用到主应用，并明确同时接入参考生成链路。现行规则见[官方接入](../../integrations/novelai.md#vibe-与精确参考边界)与[绘图工作区](../../workspaces/image.md#底部参数与参考抽屉)。本文是此次实施的证据，不构成收费接口联调通过。

后续提交、发布及费用标签调整见[发布核验记录](../releases/2026-10-25-nai-release-verification.md)；下文保留实施时的状态。

## 公开字段核对

只读取未登录官网、官方文档与公开客户端脚本，没有上传、编码、生成或使用聊天中的 Key。原始研究保存在忽略目录 `.local/research/nai-references/`；不将客户端实现整体复制进工程。

官网公开脚本来源为 `https://novelai.net/_next/static/chunks/`，本次观察的部署标记为 `32f2478-39929112768-1`：

- `1nooe5qj9uix4.js`：`/ai/encode-vibe` 的 JSON 字段 `image`／`information_extracted`／`model`、120 秒范围及 Blob 响应。
- `42wv5qb9evl5c.js`：编码后的 Vibe 请求数组、仅总强度超过 1 时归一化、缓存与官方 v1 文件结构；Precise 描述、信息量和强度数组，secondary strength 使用 `1 - fidelity`。
- `33ul2lw58_w11.js`：Precise 的三种画布、按绝对比例差选取、等比适配、居中黑边。
- `1e943u861145k.js`：两组最多 16 张，Precise 新图默认 strength／fidelity／information 均为 1；V4.5 Full 的 Vibe 默认 strength .6、information .7。

官方能力与收费说明：[Vibe](https://docs.novelai.net/en/image/vibetransfer)、[Precise](https://docs.novelai.net/en/image/precisereference)、[Schema](https://image.novelai.net/docs/doc.json)。官网当前 V5 没有两种参考入口；首轮只开放准确映射到官方 V4.5 的来源，不根据通用文档推断 V5 或中转支持。

## 实施范围

- 主应用的 `composer-foot` 装入已确认的三段凹槽和同色抽屉，上圆角、导航置顶、当前参考段内开关、64×80 无文件名缩略图及固定 12px 底部间距均保留。原参数表单提取到独立组件，滑杆外观不变；不支持参考时只剩整行参数入口。
- 每画板保存独立的两组参考设置与互斥启用状态；查看不启用。眼睛控制单图参与；Vibe 的归一化放入更多菜单。无报价时整次费用未知，仅生成按钮显示费用。
- 编码进入现有全应用任务锁，成功二进制立即持久化。原图内容、准确型号、提取量共同构成缓存身份；同图同参数不重复计入待编码费下限。请求失败不重试；取消、后续生成失败或连接上下文变更不会丢弃已完整收到的编码。
- Precise 在浏览器生成等比适配的 PNG 并发送匹配数组；Fidelity 反向映射。Canvas 高质量插值与官网的 Lanczos 仍可能有像素差异。
- 参考准备后固定原板快照和连接上下文。来源能力不足或已知参考费用下限不足时停止，不静默丢参考，也不退到未声明协议的中转。未知余额保持原优先级规则。
- 原图／缩略图与缓存分别放入收藏库 schema v2 的独立存储；小配置进入画板和结果参数。本机历史导入可恢复设置，Koma v2 ZIP 携带资产闭包、原图哈希与编码哈希。备份先冻结偏好再读取资产，避免并发上传产生失效引用；恢复不发起编码。
- 官方 v1 Vibe 单文件／Bundle 可导入导出，支持原图和当前型号的仅编码文件；仅编码文件不能调提取量。不支持的 Mask／编码参数明确拒绝。Precise 使用 Koma JSON 格式。外部 PNG 参考编码恢复尚未接入。ASK 只读取不含原图和编码的参考摘要。

## 本地验证

全部使用合成图片、合成 Key 和模拟服务；外部请求由测试拦截，不调用真实收费接口。

- `npm run check`：字体、样式、严格类型、267 项单元测试及生产构建通过。
- `npm run test:services`：6 项通过，包含真实浏览器 schema、租约、并发及备份。
- `npm run test:drawing`：17 项通过，原有生成、报价、批量、收藏、导入、画板、资源和高频驱动回归通过。
- `npm run test:native`：25 项通过，其中新增 11 项参考场景覆盖编码缓存、失败、取消、最低已知费用、官方来源筛选、冻结画板／连接、备份往返、官方文件、仅编码文件、抽屉中断／焦点／KeepAlive／URL 释放。
- 320／390／768／1440px 均无横向溢出，导航在内容上方，生成按钮前保留至少 12px，移动端正文只预留折叠底栏。截图位于 `.local/native-protocols/reference-drawer-{width}.png`；主应用截图经视觉核对，不进入发布包。

真实 NAI 编码与缓存命中、Precise／Vibe 效果、账户优惠和实际扣费仍待验证。本次模拟不能证明真实供应商已成功联调。
