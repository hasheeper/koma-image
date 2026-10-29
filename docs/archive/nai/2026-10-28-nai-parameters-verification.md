# NAI 官方基础参数边界收口

日期：2026-10-28。范围为绘图与 EDIT 的基础参数、请求校验、参数往返和界面。所有生图响应使用合成图片与模拟服务；未调用真实收费生成，未推送或部署。

## 依据

- [官方公开 Schema](https://image.novelai.net/docs/doc.json)：核对 `scale`／`cfg_rescale`、Img2Img、Inpaint 嵌套 `img2img`、噪声调度与独立 Upscale 字段。多数属性没有数值范围或型号枚举，不能由 Schema 推导未声明的硬上限。
- [官方当前客户端](https://novelai.net/image)，公开部署标识 `6fb7f79-40608358333-1`。只读取公开静态脚本，不执行下载代码，不访问用户账户或 Key。
- 客户端 `22evx8_5gmu-c.js`：V4／V5 采样器目录、64 对齐与 3,145,728 像素边界。
- 客户端 `35np5iwst-km7.js`：Img2Img 强度／噪声与 Inpaint 强度、Guidance 0–10／0.1 和 `uncapMax`。
- 客户端 `1tae-3ze2k-ak.js`：型号能力、采样器默认调度与 Heavy 预设展开。
- 客户端 `2qhfr6iicb3zg.js` 与 `1dvnlckqzo-c7.js`：Medium 固定设置、Inpaint 强度嵌套和 V5 出站固定 Karras。
- 产品说明：[Effort](https://docs.novelai.net/en/image/effort)、[Strength／Noise](https://docs.novelai.net/en/image/strengthnoise)、[Inpainting](https://docs.novelai.net/en/image/inpaint)。

## 实现

| 项目 | 当前行为 |
| --- | --- |
| 采样器 | 官方 V4.5／V5 High 六种：Euler Ancestral、Euler、DPM++ 2S Ancestral、DPM++ 2M SDE、DPM++ 2M、DPM++ SDE；Medium 固定 Euler Ancestral；无 DDIM；目录和出站分别检查 |
| 调度 | V4.5 支持 Karras／Exponential／Polyexponential；默认 DPM++ 2M 为 Exponential，其他为 Karras。V5 强制 Karras，隐藏选择，保留本地 V4.5 选择 |
| Guidance | 官方滑杆 0–10／0.1；点击数值可手输更高的非负有限数值；导入不再截断至 20 |
| Rescale | 0–1，默认 0；Medium 不发送；遗留 cfg 不发送 |
| 强度与噪声 | Img2Img 强度 0.01–0.99、噪声 0–0.99；Inpaint 强度 0.01–1，1 不发送嵌套 img2img |
| Medium | 14 步、Euler Ancestral、固定 Heavy 负向正文；按官网处理正向有无 nsfw；用户与角色负向不发送，原文与 High 参数保留 |
| 尺寸 | 官方文生图与普通编辑采用 3MP／64 对齐；EDIT 不加 2048 单边限制。绘图控件的 64–2048 边长及 8MB 本地文件是 Koma 产品边界，不称作官方硬上限 |
| 参数往返 | 调度保存在画板／历史／收藏快照，Koma v2 备份缺字段时默认 auto；支持官方 PNG 导入、ASK 参数草稿／恢复与 Slate／Bridge 配方快照 |
| 网关 | 标准网关仍使用其声明的采样器、面积与既有 Karras；不把官方可调调度擅自加为标准网关能力；报价、选源与 max_cost 不变 |

## 验证

自动检查覆盖严格类型、样式、字体、单元测试与生产构建。新增参数矩阵覆盖各型号与六采样器的生成／编辑请求、非法值在出站前拒绝、调度默认值与覆盖、Medium Heavy、超过滑杆范围的 Guidance，以及画板／历史／备份／PNG／ASK 往返。

`npm run check` 通过字体、样式、严格类型、343 项单元测试与生产构建；`tests/native-protocols.browser.mjs` 的 35 项浏览器测试全部通过，覆盖官方与标准网关的现有链路及 320／390／768／1440px 参数面板。四种屏宽的截图已检查，文档本地链接与 `git diff --check` 通过。真实生成的参数采用、效果和扣费继续列为待验。

## Variety+ 补充收口

同日按用户要求开放官方 V4.5 Full／Curated 的 Variety+。官网客户端能力表将两型号 `cfgDelay` 设为 true、基础 sigma 为 58；V5 为 false。公开客户端提交前使用 4 通道、8 倍潜空间缩放，相对 832×1216 的潜空间面积平方根修正 sigma。

绘图与 EDIT 的按钮放在既有 Guidance 行内，不增加行高，默认关闭。内部布尔值随画板／历史／备份／导入／ASK 草稿往返；请求在官方边界按实际输出尺寸计算 `skip_cfg_above_sigma`。Img2Img、Inpaint 和 Enhance 共用；关闭、V5 与标准网关不发送。切 V5 保留本地选择，结果只记录实际生效状态。

`npm run check` 通过全部 355 项单元测试、类型／样式／字体及生产构建。定向浏览器测试的 Variety+ 与原参数对齐两项通过，覆盖按钮与键盘操作、复位、模型切换、绘图／EDIT 模拟请求与历史记录；320／390／768／1440px 截图无溢出且未增加参数行高。日志位于 `.local/variety-check.log`、`.local/variety-browser.log`，截图为 `.local/native-protocols/variety-{image,edit}-{width}.png`。`git diff --check` 通过。没有真实收费生成、Git 推送或 Pages 部署，实际多样性与词文相关性仍待实测。
