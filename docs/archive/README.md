# 历史发布证据

更新：2026-11-14。只维护版本、提交、部署及未解决问题的必要证据；现行行为从[文档索引](../README.md)进入。这些结果仅适用于注明日期和提交，不代表当前工作区已发布，也不延续当时的推送、部署或真实生成授权。

## 发布记录

历次生产域名均为 [koma-image.pages.dev](https://koma-image.pages.dev/)。下表部署链接标识当次产物；本地模拟、静态资源与页面核验不能替代供应商生成或计费验证。

| 日期 | 版本／范围 | 产品提交 | Pages 部署 | 核验边界 |
| --- | --- | --- | --- | --- |
| 2026-10-25 | NAI 官方适配 | [786e8f45](https://github.com/hasheeper/koma-image/commit/786e8f456b3fbbd2fd10371ee65f164fbe0f14f4) | [53575fbf](https://53575fbf.koma-image.pages.dev/) | 静态资源与页面核验 |
| 2026-10-28 | HOME／EDIT／NAI | [8c32b73c](https://github.com/hasheeper/koma-image/commit/8c32b73c84d3385ebb9bc41464685fcdd02afe17) | [0fc880ec](https://0fc880ec.koma-image.pages.dev/) | 静态资源与工作区核验 |
| 2026-10-29 | 图片身份／HOME | [daaa438c](https://github.com/hasheeper/koma-image/commit/daaa438c26f05a3434fa4e2866a4614444576435) | [3a52ddc9](https://3a52ddc9.koma-image.pages.dev/) | 静态资源与空状态核验 |
| 2026-10-29 | ASK／EDIT | [2e9ec9be](https://github.com/hasheeper/koma-image/commit/2e9ec9bebd1c7eaeeaac24b93837ed93a8290da6) | [afd23d16](https://afd23d16.koma-image.pages.dev/) | 公开前脱敏与页面核验 |
| 2026-10-30 | 外观与工作区 | [ce0f5283](https://github.com/hasheeper/koma-image/commit/ce0f52836a24df82c440c32c8cef417671e57ced) | [7e1fc8c0](https://7e1fc8c0.koma-image.pages.dev/) | [CI 通过](https://github.com/hasheeper/koma-image/actions/runs/41028890232) |
| 2026-10-30 | 同日后续修正 | [2225b527](https://github.com/hasheeper/koma-image/commit/2225b527c602eb3d07641950bbce0daa59d12fc7) | [4d9cb2a8](https://4d9cb2a8.koma-image.pages.dev/) | [CI 通过](https://github.com/hasheeper/koma-image/actions/runs/41032270856) |
| 2026-11-02 | v0.2.0 | [8da1067e](https://github.com/hasheeper/koma-image/commit/8da1067ecd29407d84d610a940f21af289b9759d) | [4d7fe118](https://4d7fe118.koma-image.pages.dev/) | [CI 通过](https://github.com/hasheeper/koma-image/actions/runs/41415043395) |
| 2026-11-02 | v0.2.1 | [9f862939](https://github.com/hasheeper/koma-image/commit/9f8629392a23269e80ffe16fda46c550fa7d79c4) | [c8aede6c](https://c8aede6c.koma-image.pages.dev/) | [CI 通过](https://github.com/hasheeper/koma-image/actions/runs/41416906516) |
| 2026-11-02 | v0.3.3 | [2f1cb295](https://github.com/hasheeper/koma-image/commit/2f1cb295745e117627e2593ddcaa3d1ec728c2fc) | [37dc5f61](https://37dc5f61.koma-image.pages.dev/) | TAGS 撤回项与页面核验 |
| 2026-11-02 | v0.3.4 | [65f61cc8](https://github.com/hasheeper/koma-image/commit/65f61cc8d51fc5258203bc4411ea00c3722bd29b) | [a527e424](https://a527e424.koma-image.pages.dev/) | TAGS 设置顶栏修复核验 |
| 2026-11-04 | v0.4.0 | [72f32c9a](https://github.com/hasheeper/koma-image/commit/72f32c9a768645747127f4cc0b12d6d24825e15c) | [79038092](https://79038092.koma-image.pages.dev/) | 本地检查及线上资源核验；不据此声明远端 CI 通过 |
| 2026-11-06 | v0.5.0 | [67c0fba7](https://github.com/hasheeper/koma-image/commit/67c0fba71dedce350dc35211aed01e16a7596b44) | [e5b78cf8](https://e5b78cf8.koma-image.pages.dev/) | [main CI](https://github.com/hasheeper/koma-image/actions/runs/42190358587)／[标签 CI](https://github.com/hasheeper/koma-image/actions/runs/42190358746) 通过 |
| 2026-11-06 | v0.5.0 高亮修正 | [b83df25b](https://github.com/hasheeper/koma-image/commit/b83df25b511dbe1f3a1b6d8d0eb06be9714488ed) | [ce3aaeae](https://ce3aaeae.koma-image.pages.dev/) | [CI 通过](https://github.com/hasheeper/koma-image/actions/runs/42192983376)，原标签未移动 |
| 2026-11-10 | v0.6.0 | [ac797931](https://github.com/hasheeper/koma-image/commit/ac7979319e022c0835823fdbee33c25a89519a5d) | [1c3418e6](https://1c3418e6.koma-image.pages.dev/) | main CI 通过，标签 CI 备份锁失败，见[完整证据](releases/2026-11-10-v0.6.0-release.md#github-ci) |

2026-10-26 的 Bridge 记录仅有发布前检查，没有部署证据，不计为一次发布。2026-10-29 公开前匿名化历史作者邮箱时保持提交树内容，历史提交号已映射；上表使用映射后的引用。历史脱敏检查不能代替下一次发布前复查。

## API 与真实核验依据

- [NovelAI 来源与验证边界](../integrations/novelai.md#来源与验证边界)：官方资料、只读账户、客户端来源及模拟／真实生成的区别。
- [Photopea 验证范围](../integrations/photopea.md#12-验证范围与回归清单)：真实 iframe、合成素材、工作栈与软图层蒙版往返。
- [Bridge 验证边界](../integrations/bridge.md#验证边界)：macOS Edge 原生目录与外部文件闭环，以及企划集模拟范围。
- [ASK 空响应证据](../ask/runtime.md#空响应的已知证据)：非流式过滤原因与空流差异，仍未证明稳定修复。

当前待查问题只在[状态页](../status.md)维护；本页不保存已完成阶段计划、源码正文快照、咨询往返或测试数量流水账。
