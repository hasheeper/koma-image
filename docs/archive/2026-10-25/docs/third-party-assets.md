> 历史归档 · 2026-10-25 整理前快照（源码基线 `f7a9c16`）。本文保留当时的设计、授权与验收范围，不作为现行规则或本次发布授权。现行入口见[文档索引](../../../README.md)。

# 第三方资源

模型图标使用 LobeHub Icons（基线来源版本 1.95.1）的 SVG 路径，按 MIT 许可保留于源码 `src/shared/ModelLogos.vue`，许可原文在 `public/assets/model-icons-LICENSE`；发布包中的对应许可位于 `dist/assets/model-icons-LICENSE`。

ASK 模型列表补充的 Claude、DeepSeek、Kimi、MiniMax（color 变体）与 Z.ai（单色，用于 GLM）图标取自同一来源版本 `@lobehub/icons-static-svg` 1.95.1，Doubao 复用既有 ByteDance 图标。推理目录不带厂商字段，ASK 只按模型 ID 选择分组标题和图标（末尾「[渠道]」不参与识别），不据此限制使用。

这些图标只表示合法模型供应商，不表示部署站点或聚合网关身份。连接与账户使用本地通用头像。

原有字体资源各自保留随包附带的许可文件，发布包位于 `dist/fonts/<字体名>/LICENSE`。品牌字「Koma」使用 Fredoka（@fontsource-variable/fredoka 5.3.0，OFL-1.1），只带拉丁子集、只用于品牌字，许可同样位于 `dist/fonts/fredoka/LICENSE`。界面中英文使用资源圆体（Resource Han Rounded CN 0.990，CyanoHao/Resource-Han-Rounded，OFL-1.1），自托管为 `fonts/koma-rounded`，只含 400／500／700 三个字重，半粗用 Bold。它由 `scripts/build-rounded-font.py` 用 fontTools 4.60.1 生成：按原思源黑体的 unicode-range 切成 woff2 分片按需加载，并为 U+00B7「·」和 U+00D7「×」补上比例宽度字形（原 CN 版为全角，分别由句点和加号生成）。因修改版不得使用思源部分的保留字体名「Source」，字体内部改名为 Koma Rounded，保留原版权与许可，许可位于 `dist/fonts/koma-rounded/LICENSE`。

本工程的 `UNLICENSED` 不替代这些第三方许可。

字体配置现集中于 `config/fonts.json` 与 `config/font-ranges/koma-rounded.json`，浏览器只加载由 Node 生成的 `public/fonts/index.css`。普通构建复用现有 WOFF2；上述 Python 脚本只用于主动离线重建，并继续保留原字形修改和许可。维护命令与 G0／G1 验证见[字体与样式治理记录](font-style-governance.md)。
