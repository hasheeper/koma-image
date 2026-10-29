# V5 Max Enhance 接入核验

日期：2026-10-28。在普通 Enhance 基础上增加 V5 Full High／Medium／Curated 的 Max 倍率。本轮仅使用合成图片与模拟接口，未调用真实收费生成，未提交、推送或部署。

## 官方依据

复用同日保存的官网公开客户端（部署标识 `6fb7f79-40608358333-1`）与[公开 Schema](https://image.novelai.net/docs/doc.json)，只读分析代码文本，不执行下载脚本，不读取用户 Key。

- `1tae-3ze2k-ak.js`：V5 Full／Curated 的 `maxEnhance: true`，Medium 继承 Full；V4.5 关闭该能力。
- `35np5iwst-km7.js`：只在底图面积大于零且小于 `MAX_ENHANCE_AREA_CUTOFF` 时将 `max` 加入倍率；结果尺寸以 `maxEnhanceResultSize` 记录，内部预估另用 `maxEnhanceTargetSize`，两者不能混作请求尺寸。
- `22evx8_5gmu-c.js`：阈值为 `3,145,728 × 0.8`；实际倍率 `min(2, sqrt(3,145,728 / (width × height)))`，两边向下取整，结果不强制对齐 64。
- `2qhfr6iicb3zg.js`：`generateEnhance` 的 Max 分支保留原图宽高、设置 `upscaled_enhance: true`、使用随机 Seed、单张 `img2img`，跳过普通 Enhance 提示词补充。

## 实现边界

Max 加在现有倍率下拉框，沿用五档 Magnitude、手调、自定义状态、每画板记忆及关闭后的普通参数恢复。切到不适用型号或尺寸时保留选择并提示，禁止生成，不偷偷降倍率或换协议。

领域、出站和选源分别校验 V5／官方／尺寸；请求宽高保留原尺寸，响应按实际输出尺寸校验后才进入版本／历史／收藏／Slate。记录 `enhanceScale: "max"`、原／有效提示词与实际 Seed，结果标识 Enhance Max。普通倍率不发送服务端标记；手工传入原始上游标记被拒绝。普通图生图／重绘的 64 像素底图约束保持，Max 非对齐结果若继续编辑需先调整尺寸。

## 验证

单元覆盖三型号 × 五档、原图字节／原宽高／标记／随机 Seed 参数映射、Max 无普通提示词补充、Medium 固定设置、典型输出尺寸、面积阈值、V4.5／中转拒绝和快照保留。浏览器覆盖 832×1216 → 1467×2144、请求原尺寸误返回时不保存、实际尺寸与历史、画板隔离、切换 V4.5 阻止提交及返回 Medium 后保留 Max，并生成四种宽度截图。

`npm run check` 通过：字体／样式、严格类型、349 项单元测试和生产构建均成功。完整原生协议浏览器套件 38 项通过，Enhance 定向 3 项也已通过；320／390／768／1440px 截图均已查看。8 份更新文档的本地链接和 `git diff --check` 通过。真实效果、接口采用和消费仍待单独验证。
