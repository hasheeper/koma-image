# 第三方资源

模型图标使用 LobeHub Icons（基线来源版本 1.95.1）的 SVG 路径，按 MIT 许可保留于源码 `src/shared/ModelLogos.vue`，许可原文在 `public/assets/model-icons-LICENSE`；发布包中的对应许可位于 `dist/assets/model-icons-LICENSE`。

ASK 模型列表补充的 Claude、DeepSeek、Kimi、MiniMax（color 变体）与 Z.ai（单色，用于 GLM）图标取自同一来源版本 `@lobehub/icons-static-svg` 1.95.1，Doubao 复用既有 ByteDance 图标。推理目录不带厂商字段，ASK 只按模型 ID 选择分组标题和图标（末尾「[渠道]」不参与识别），不据此限制使用。

这些图标表示合法模型供应商，不表示部署站点或聚合网关身份。NovelAI 官方 Profile，以及已识别的 Google AI Studio／GCP Vertex AI、OpenAI 官方／Azure OpenAI 地址，在连接卡、模型列表标题和模型来源中复用已有 NovelAI、Gemini、OpenAI Logo 及许可。其他连接使用本地 `icons.svg` 中的对话／图片图标区分文本与生图，兼容协议不据此冒用官方身份。空连接列表使用中性连接图标，不再使用人形默认头像。

原有字体资源各自保留随包附带的许可文件，发布包位于 `dist/fonts/<字体名>/LICENSE`。品牌字「Koma」使用 Fredoka（@fontsource-variable/fredoka 5.3.0，OFL-1.1），只带拉丁子集、只用于品牌字，许可同样位于 `dist/fonts/fredoka/LICENSE`。界面中英文使用资源圆体（Resource Han Rounded CN 0.990，CyanoHao/Resource-Han-Rounded，OFL-1.1），自托管为 `fonts/koma-rounded`，只含 400／500／700 三个字重，半粗用 Bold。它由 `scripts/build-rounded-font.py` 用 fontTools 4.60.1 生成：按原思源黑体的 unicode-range 切成 woff2 分片按需加载，并为 U+00B7「·」和 U+00D7「×」补上比例宽度字形（原 CN 版为全角，分别由句点和加号生成）。因修改版不得使用思源部分的保留字体名「Source」，字体内部改名为 Koma Rounded，保留原版权与许可，许可位于 `dist/fonts/koma-rounded/LICENSE`。

本工程的 `UNLICENSED` 不替代这些第三方许可。

高级编辑按用户操作加载 [Photopea 官方免费嵌入](https://www.photopea.com/api/)，通过官方 Live Messaging 与 Scripting API 交换当前图片和选区。其应用代码不复制、自托管或打入 Koma 发布包。宿主展示完整编辑视口，不扩宽裁剪品牌／广告或改写第三方 DOM／CSS。未购买 Distributor／白标服务，详见[官方授权说明](https://www.photopea.com/api/accounts)。

高级编辑入口的 `public/assets/photopea-logo.png` 来自 [Photopea 官方 Logo](https://www.photopea.com/promo/icon512.png)。保留官方轮廓，去除绿色底色与阴影，生成 128px 透明单色图；通过 CSS mask 跟随工具栏的文字色、悬停与禁用状态。该标识仅用于识别 Photopea 入口，商标归原权利人，不适用上述 LobeHub Icons 的 MIT 许可。

HOME 页脚与设置「关于」的 GitHub 标志取自 GitHub Primer Octicons 的 `mark-github` 路径，作为 `i-github` 收入 `public/assets/icons.svg`，跟随文字色。SVG 路径的 MIT 许可保留于 `public/assets/octicons-LICENSE`，随构建发布；该许可不授予 GitHub 商标权，标志仅用于链接本项目源码仓库，商标归 GitHub, Inc.。

字体配置现集中于 `config/fonts.json` 与 `config/font-ranges/koma-rounded.json`，浏览器只加载由 Node 生成的 `public/fonts/index.css`。普通构建复用现有 WOFF2；上述 Python 脚本只用于主动离线重建，并继续保留原字形修改和许可。维护命令与 G0／G1 验证见[字体维护](https://github.com/hasheeper/koma-image/blob/main/docs/font-style-governance.md)。

NAI token 计数使用 `@huggingface/tokenizers` 0.2.0（Apache-2.0）与自托管的 [google-t5/t5-small](https://huggingface.co/google-t5/t5-small)／[Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) 公开 tokenizer 词表（Apache-2.0）。只分发词表和计数所需配置，不含模型权重或 NovelAI 应用代码；根据公开客户端核对的预处理规则配置 T5／Qwen 计数。调整及来源清单在 `public/tokenizers/NOTICE.txt`，许可在同目录 `LICENSE` 和 `tokenizers-LICENSE.txt`，构建原样复制至 `dist/tokenizers/`。首次按需加载词表约 1.1MB／9.1MB；提示词仅在本机 Worker 内处理。
