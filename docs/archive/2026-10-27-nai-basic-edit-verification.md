# NovelAI 基础编辑适配核验

日期：2026-10-27。代码基线为 `codex/ask-chat-handoff`、HEAD `1fd1be3fc0edccce51ebf6bf4a861e62649ef4dd` 上的未提交工作区，延续前轮 Guidance／Rescale 与 EDIT 配置对齐修改。本记录使用合成图片与模拟服务，不代表官方生成、扣费或线上部署已通过。

## 适配范围

| 操作 | 本轮结果 |
| --- | --- |
| Img2Img | V4.5 Full／Curated、V5 Full High／Medium／Curated 五型号；单图、源尺寸、强度／噪声、实际 Seed，Medium 保留固定参数约束 |
| Inpaint | V4.5 Full／Curated、V5 Full High／Medium 四型号；`action: infill`、对应 `-inpainting` ID、源尺寸黑白 PNG 蒙版、局部强度；空蒙版禁止执行 |
| Upscale | 独立 `/ai/upscale` multipart，固定 V5 Full 放大器与 4× 输出；源图原字节提交，不携带生图提示词、Seed、Guidance 或 `max_cost` |
| 参考 | V4.5 img2img 支持 Vibe／Precise，普通 Inpaint 只开放 Precise；不兼容配置保留并阻止提交，不静默丢参考或付费编码 |
| 界面 | 复用现有 EDIT、模型控件与参数抽屉；官方重绘隐藏噪声，放大合并为一个 NovelAI Upscale 入口并显示输出尺寸 |

V5 Curated 没有独立重绘接口。公开客户端虽有同名枚举，实际会转用 V4.5 Curated；本工程不提供该组合，用户可以明确选择支持的型号。标准网关仍按目录声明筛选能力，不套用官方型号禁用规则。

普通官方编辑要求边长 64–2048、64 像素对齐、面积不超过 3,145,728 像素；放大使用独立 3,145,728 像素面积上限。超限明确阻止，不自动缩图。标准网关已有的放大面积限制保持。

普通 Inpaint 的返回必须与源图同尺寸。本机仅替换白色蒙版内像素，保留蒙版外的归一化底图；输出重新编码为 PNG，不保留上游 PNG 文本块，完整参数随编辑版本和本机历史保存。Focused Inpainting 的裁剪、放大、羽化与贴回组合不在本轮范围。

官方放大校验实际输出宽高均为源图的 4 倍，错尺寸不新增版本；ZIP 和直接图片均可接收。该操作的 ZIP 上限按源面积 × 16 × RGBA 字节数加 PNG 余量单独计算，至少保留 32MiB，避免大结果被普通解包上限拒收；其他操作仍为单图 32MiB、合计 64MiB。CRC 和声明解压长度检查保留。

## 公开接口依据

- 官方 [Inpainting](https://docs.novelai.net/en/image/inpaint)、[Models](https://docs.novelai.net/en/image/models)、[Effort](https://docs.novelai.net/en/image/effort) 及 [Precise Reference](https://docs.novelai.net/en/image/precisereference) 说明。
- 复核前轮保存的 [NovelAI 公开客户端模型模块](https://novelai.net/_next/static/chunks/1e943u861145k.js?dpl=32f2478-39929112768-1)：`getInpaintingModelForModel` 将 V5 Curated 映射为 V4.5 Curated；其余四型号映射到各自的 Inpainting ID。枚举中的名称不单独作为可用接口证据。
- 公开客户端生成模块 `42wv5qb9evl5c.js` 的局部强度逻辑采用 `img2img: { strength, color_correct: true }`；存在 mask 时跳过 Vibe，Precise 可用于 infill。请求模块 `1nooe5qj9uix4.js` 包含独立放大路径与 multipart 的 `image`／`request` 字段。
- 本轮下载并核对公开第三方 [novelai-python Upscale](https://github.com/LlmKira/novelai-python/blob/main/src/novelai_python/sdk/ai/upscale.py) 与[模型映射](https://github.com/LlmKira/novelai-python/blob/main/src/novelai_python/sdk/ai/_enum.py)：放大固定 4×、`model: nai-diffusion-5-full`、`declared_blur_sigma: 0`；SDK 同样明确 V5 Curated 独立 Inpainting 不存在。第三方 SDK 是交叉证据，不等同官方承诺。

本轮未能重新取得 `image.novelai.net/docs/doc.json`（超时／TLS 连接失败），官网新静态脚本请求也受访问限制。以上客户端依据来自前轮缓存，不宣称已取得本轮最新官方 Schema。研究缓存仅在被 Git 忽略的 `.local/` 中，不进入发布包。

## 实际验证

| 命令／范围 | 结果 |
| --- | --- |
| `npm run check` | 字体检查、Stylelint、严格 TypeScript、301 项单元测试及构建通过；保留原有大 chunk 提示 |
| `node --test tests/native-protocols.browser.mjs` | 34 项中 32 项首轮通过，包括基础接入及全部 8 项 EDIT 用例；2 项时序用例单独复跑通过，见下文 |
| `node --test --test-name-pattern='NAI guidance\|drawer interrupt/collapse' tests/native-protocols.browser.mjs` | 2/2 通过；未修改业务代码或放宽断言 |
| `node --test --test-name-pattern='M6' tests/workspaces.browser.mjs` | 5/5 通过，覆盖既有中转报价、蒙版、EXIF、版本、CHAT 回传、高频驱动及资源清理 |
| 320／390／768／1440px | 新 Inpaint 参数与 Upscale 菜单截图及几何断言通过；人工查看窄屏菜单、390px 参数与1440px 编辑布局 |
| `git diff --check` | 通过 |

完整浏览器回归中，Guidance 用例遇到 Playwright `Resulting promise was garbage collected`；抽屉中断用例在两个 rAF 后尚未取得缩小中的高度。两者在原断言下单独复跑通过，记录为时序波动，不将完整首轮写成全通过。

新增验证覆盖：五型号 Img2Img、四型号 Inpaint、Curated 不可用组合的菜单与请求拦截、局部强度与 Medium 参数、Seed 0、蒙版内外像素、空蒙版与错尺寸、官方 3MP／64 对齐、独立放大 multipart 和原字节、ZIP／裸图返回、4× 尺寸、失败／取消不重试，以及超过普通 ZIP 上限时的独立容量上限与 CRC 检查。

日志与合成截图位于 `.local/nai-edit-*.log`、`.local/native-protocols/editor-official-*`，不进入 Git 或发布包。

## 验证边界

未使用真实 Key 执行生成或放大，未验证官方账户型号权限、CORS、实际参数采用、视觉效果及额度消耗。V5 的 Vibe／Precise、Enhance、Director Tools 与 Focused Inpainting 均未新增。本轮没有 Git 推送或 Pages 发布。
