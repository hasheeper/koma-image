# 普通 Enhance 接入核验

日期：2026-10-28。范围为 NovelAI 官方五型号的普通 Enhance；V5 Max 明确保留后续适配。本轮只使用合成图片与模拟服务，未调用真实收费生成、未推送或部署。

## 依据与实现

复核官网公开客户端（部署标识 `6fb7f79-40608358333-1`）与[公开 Schema](https://image.novelai.net/docs/doc.json)，未执行下载脚本或读取用户 Key。

- `1tae-3ze2k-ak.js`：五档 `EffectMagnitudes`；V4.5／V5 Enhance 提示词修正与 V5 `maxEnhance` 能力区别。
- `35np5iwst-km7.js`：普通倍率目录、832×1216 特例与高级强度／噪声控件。
- `2qhfr6iicb3zg.js`：`generateEnhance` 的 `action: img2img`、源图与目标宽高、单张输出、随机 Seed、`applyEnhancePromptAdd` 与 64 像素对齐。Max 另使用 `upscaled_enhance`，本轮明确拒绝。

领域规则位于 `src/domain/nai-enhance.ts`，请求、选源、编辑会话与图像参数白名单复用既有路径。Enhance 作为图生图内开关，倍率与档位紧凑并排，手调后显示自定义；关闭恢复普通图生图参数。底图不预先放大，结果校验目标尺寸后才写入编辑版本／历史，快照保留倍率、档位、原文与实际 Seed。

## 验证

新增单元测试覆盖五型号 × 三倍率 × 五档位、尺寸过滤／标准画幅对齐、Medium、提示词与 `Text:`、参数白名单、网关拒绝和 Max 拒绝。浏览器检查覆盖随机 Seed、原参数保留、历史、官方选源、失败／取消／尺寸错误及 320／390／768／1440px。

`npm run check` 已通过，包含字体／样式、严格类型检查、347 项单元测试与生产构建；完整原生协议浏览器套件 37 项通过。加强后的 Enhance 定向浏览器检查 2 项再次通过，覆盖画板设置隔离，以及官方额度不足时不降级至同样提供 V5 Full 的中转。320／390／768／1440px 截图均已查看，文档本地链接与 `git diff --check` 通过。真实效果、参数采用和实际消耗仍须单独验证。
