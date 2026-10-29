# 2026-10-25 NAI 参数兼容与控件整理

基线：`codex/ask-chat-handoff`，HEAD `72fb655`，包含本地未提交工作。未推送、未部署，未使用真实 Key 生成。此记录不构成真实供应商生成与扣费验证。

## 完成范围

- 绘图页 V5 Full 旁 High／Medium；Medium 使用独立 ID `nai-diffusion-5-full-medium`，固定 14 步／Euler Ancestral，抑制基础与角色负向和 Rescale；保留 High 的本地设置。
- Prompt 内的 Complexity、质量、透明底；Negative 页的按型号 UC 预设。质量、负向与 Complexity 默认关闭，发送时展开，保留原文；自动标签避开尾部 `Text:`，透明底不挤掉首位 dataset 标记。
- Guidance 对应 `scale`，新增独立 `cfg_rescale` 0–1；旧中转 `cfg` 不迁移数值，官方不再发送此字段。标准网关继续报价与费用上限。
- 画板、旧 Koma v2 备份、历史复用、图片元数据导入和 ASK 参数恢复；外部有效词文导入避免重复添加预设。
- 用户对第一版原生控件质感提出修改意见后，替换为复用站内 `switch-menu` 的裸按钮菜单，统一字号／箭头／焦点，透明底使用自有棋盘格图标；无额外行和嵌套卡片。

## 依据与限制

功能与预设正文依据官方 [Effort](https://docs.novelai.net/en/image/effort)、[发布公告](https://journal.novelai.net/novelai-diffusion-v5-full-effort-toggle/)、[Tags](https://docs.novelai.net/en/image/tags)、[Quality](https://docs.novelai.net/en/image/qualitytags)、[UC](https://docs.novelai.net/en/image/undesiredcontent)。Medium wire ID、V5 版本 4 和固定预设标记参考公开第三方 [novelai-python](https://github.com/LlmKira/novelai-python)；官方公开 Schema 无完整型号枚举，因此实际生成仍待验。

Medium 官方只开放本轮文生图接线；图生图／重绘另待核验。现有编辑器没有本轮绘图预设入口和可调 Rescale，不宣称全工作区能力一致。

## 本地验证

- `npm run check`：字体、Stylelint、严格类型、259 个单元用例及生产构建通过；构建保留已有 chunk 体积提示。
- 原生协议浏览器套件 13 项通过；包含官方／网关请求、High／Medium、型号显隐、负向只读、恢复参数、菜单选中态／Esc 焦点及 320／390／768／1440px 无溢出检查。全部请求拦截为模拟服务，图片为合成图。
- 绘图／工作区套件 32 项首次 30 通过；两处失败分别是重载后的测试注入变量未重新获取，以及测试期间文件改动触发开发服务器 HMR。修正测试并在停止源文件改动后重跑相应场景及画板／角色场景，共 4 项通过。
- 生产本地代理套件 3 项通过；生成、推理及备份隔离继续使用模拟上游。
- 截图位于 `.local/native-protocols/nai-controls-polished-{320,390,768,1440}.png`、`nai-menu-*.png` 和 `nai-footer-{off,selected}.png`。原始设计咨询与用户反馈后的修正咨询保存在 `.local/nai-controls-design-*.md`，不是用户批准记录。

## 后续勘探：动漫／兽人

用户另提出模式入口的勘探；本轮仅记录事实与放置建议，未新增模式开关或兽人补全源。

官方 [Models](https://docs.novelai.net/en/image/models) 对 V4／V4.5／V5 的 Full、Curated 都说明 Furry mode；[Dataset Tags](https://docs.novelai.net/en/image/tags#dataset-tags) 明确 `fur dataset` 应放基础提示词开头，兽人模式也切换 Tag 补全词库。[Effort](https://docs.novelai.net/en/image/effort) 明确 High／Medium 开关位于 Anime／Furry 模式开关旁。V3 的 Anime／Furry 是独立型号，不能把 V4 之后的标签模式机制泛化到所有旧代。

项目当前只有 Danbooru／中英词典补全链路，没有模式字段和兽人词库参数。完整接入应包含按画板保存的模式、首位标签、手写标签保护、独立补全缓存、导入／复用，以及与 Medium 负向禁用的组合验证。Furry Focus UC 只是负向预设，不等于开启兽人模式。
