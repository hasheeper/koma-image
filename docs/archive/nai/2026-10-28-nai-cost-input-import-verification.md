# NAI 费用、输入预算与 PNG 参考编码收口

日期：2026-10-28。分支：`codex/ask-chat-handoff`。基于既有未提交工作树继续实现，保留 HOME／EDIT／Photopea 等既有改动；本记录不代表 Git 推送、Pages 发布或真实收费联调。

## 公开依据与实现

核对 [NovelAI 当前图片客户端](https://novelai.net/image) 的公开价格、Opus 条件、型号预算、Vibe 元数据导入和 Alpha LSB 读取规则，以及 [FAQ](https://docs.novelai.net/en/faq)、[文字绘制](https://docs.novelai.net/en/image/textrendering)与[参考图](https://docs.novelai.net/en/image/vibetransfer)。价格和分词配置依据当日公开客户端，不分发其应用代码；词表使用公开许可的 T5／Qwen3.5 来源，许可与改动清单随静态产物保留。

- 本地 Anlas 公式覆盖五型号、Medium、Img2Img／Inpaint 强度、Enhance 实际请求尺寸、聚焦裁切尺寸和官方 Upscale 面积分档。资格依据账户、到期／特殊类型、尺寸、步数、Precise 与 V5 用量状态；关键数据未知时不猜免费。参考附加费按张重复，唯一编码费仅计一次，提交前重新检查；已知费用下限仍能在权益未知时拦截不足余额。
- 最终 UI 按用户补充要求只显示正 Anlas 估算，隐藏免费和 V5 近似百分比标签，零值不留下空胶囊。内部资格及用量估算保留，不更改标准网关费用展示、报价、max_cost、取消或重试规则。
- 原字符小计改为 token 数，预算放入提示与辅助阅读。V4.5 T5 512；V5 Curated Qwen3.5 703；V5 Full High／Medium 1471。正负独立合计启用角色，包含预设、Medium 固定负向及普通 Enhance 追加词；超限提示而不改词。显式 Text: 使用 Unicode 字符，上限 118／374／750，编码与生成前拦截。
- 词表按需进入本机 Worker，缓存有界、空闲终止。T5 词表约 1.06MB，Qwen3.5 约 9.09MB，不发送提示词进行远程计数。
- 外部 PNG 从文本块或 stealth_pngcomp 恢复 Vibe 编码与配对参数。先对照勾选，点击导入后才落库；无原图时锁定提取量并按型号复用缓存，保留已有 Precise。损坏／不兼容编码不影响普通参数。分配像素、压缩长度和解压输出设限，不从成图反推原参考图。

## 本地验证

- `npm run check`：字体、样式、严格类型、362 个单元检查及生产构建通过。
- `node --test tests/native-protocols.browser.mjs`：45 个模拟浏览器用例通过，含费用／编码下限、缓存、取消、失败不重试、角色、Enhance／Max、Focused Inpaint 和 320／390／768／1440px。
- 最终按钮文案调整后，费用／输入、PNG 编码、参考下限、Upscale、Enhance 5 项相关浏览器用例复验通过。
- `node --test tests/nai-static.browser.mjs`：生产构建在根路径和 `/nested/` 下，真实 Worker 加载两套词表并计算已知词文，许可／NOTICE 文件可访问。测试关闭补全，所有外部账户请求模拟，未发生成请求。
- `node --test tests/release.package.mjs`：发布包显式文件清单、校验和、解包后的独立服务器及根／子路径检查通过。
- `git diff --check` 通过。构建保留已有主包体积提示；新增词表独立静态加载，不进入主 JS。

所有图片与提示词均为合成测试资料，账户和编码／生成响应均为模拟。未进行真实收费生成、编码、实际账单或 Opus 权益核验；V5 用量公式只有公开基准近似，未声称精确消费或回充。没有提交、推送或部署。
