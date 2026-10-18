# 架构规范

状态：2026-10-19 确立；M1 单页外壳已实现，其余模块按实施阶段推进。此文同时描述后续目标，具体已验证范围见 [外壳实现](app-shell.md)。

## 复刻原则

以既有应用的源码、实际界面和业务验证为依据，重新组织组件与服务。正式界面保留字体、尺寸、间距、布局、输入语义和动效；允许的变化是工作区原地切换、备份并入设置、默认头像、渠道信息脱敏和 Koma 数据命名。

原生绘制、蒙版、图片解析与纯参数算法可以在审查后复用。内部研究记录、旧应用、真实图片与备份、Git 历史及部署资料不复制进本工程。

## App Shell 与工作区

- 单入口 `index.html`，轻量 hash 路由使用 image／chat／tags 三个工作区。
- 使用 KeepAlive，以工作区 ID 为稳定 key。切换保留草稿、附件、选图、列表与滚动；不取消或重复提交任务。
- 编辑是单例全屏覆盖层；设置是弹窗，备份为其子页；已关闭编辑会话仍按原语义保留。
- 共享数据、认证、图片资源和任务服务位于工作区缓存之外；隐藏工作区暂停界面事件和绘制，不干扰当前界面的全局状态。
- 既有 HTML 地址仅保留中性重定向，保留业务查询参数；旧入口不得再启动独立应用。

## DOM 与高频驱动

Vue 拥有节点创建、包裹、搬移和销毁。高亮组件模板包含包裹、镜像和 textarea；工具位置切换采用 Teleport，不执行外部节点移动脚本。

原生绘制只操作独立宿主内部、Canvas 内容与明确委托的高频样式。指针坐标与逐帧进度不进入组件响应式更新链；操作结束时同步必要业务状态。Blob、ImageBitmap、DOM、AbortController、数据库连接和 CryptoKey 不放进深层 reactive。

监听器、Observer、rAF、Object URL 和输入实例均有明确的激活、暂停与销毁责任。原生 dialog／popover 保留浏览器焦点与关闭语义。

## Gateway Profile

依赖方向：工作区 → domain／services → Gateway Profile → transport。

Profile 明确声明以下能力，默认策略复刻现有业务，不按渠道名称或域名分支：

| 能力 | 责任 |
| --- | --- |
| quote | 原预报价时序、防抖、失效请求与未知／零值区分 |
| costCeiling | 执行前重报，携带 max_cost；涨价提示后继续、批量最多提示一次，无付费确认弹窗 |
| executionRoutes | 按原条件选择原生免费、Studio 与工具路线；无自动重试或回退 |
| quotaPolicy | 原日额度、临时 Key、300 阈值、400 警示条件及未知额度处理 |
| quotaPresentation | 原额度环、余额单位、零值和未知态，复用既有界面布局 |
| catalog／modelMapping | 规范模型、目录解析、手动来源与参数能力 |
| auth／transport | 显式连接上下文、认证、规范结果、错误及取消 |

初始连接为空。用户配置 URL 和 Key 后才能请求上游；本地服务可使用 KOMA_GATEWAY_URL／KOMA_GATEWAY_KEY，环境变量不进入客户端产物。测试、示例、图标和默认头像不包含私有渠道指纹。用户自配直连地址可在其浏览器查看；如需隐藏实际上游，使用同源服务端网关。

## 任务与数据

全应用共用任务调度器和 Web Locks 槽位，默认 N=1，忙时提示返回；批次占同一槽位直到结束，不自动排队。后续可扩展并发与在途 max_cost 预占，本阶段不启用。

数据库使用 koma-image-favorites、koma-chat、koma-handoff；偏好、连接与凭据采用 koma.*；同步频道为 koma-sync。数据锁为 koma-image-data-v1，任务门为 koma-image-generation-v1，槽位为 koma-image-generation-slot-v1:1..N。命名集中管理，避免组件硬编码。

独立过渡工程处理历史数据。正式包只读取 Koma schema／迁移状态，不包含旧标识、旧备份解析器或迁移桥 chunk。过渡工程负责排空旧会话、复制、映射、校验、凭据续办和成功后清理；不可先删后拷。新备份 schema 为 version=2，偏好用逻辑字段，继续排除 Key、派生密钥、普通历史和编辑会话。

## 目录目标

```text
index.html
src/
  app/          外壳、路由、保活及全局样式协调
  workspaces/   绘图、对话、词典
  overlays/     编辑、设置及备份
  shared/       通用界面与默认头像引用
  domain/       纯业务、参数和模型
  gateway/      Profile、能力校验和请求转换
  services/     调度、资源和连接服务
  storage/      Koma 持久化接口
  config/       非秘密配置 schema
public/         经审查的本地静态资源
docs/           中性工程说明和业务契约
```

目录随真实模块建立，不用占位实现冒充功能完成。App 直接挂载 body 并使用 Fragment；绘图顶栏仍是 body 直接子节点，对话仍保留 chat-app 容器。KeepAlive 只缓存三种工作区；覆盖层在其外侧持续挂载。绘图／对话／词典样式通过原 stylesheet 的 media 切换，避免全局选择器相互影响。

## 验证范围

业务以 [B01–B31](business-contracts.md) 为准，使用合成数据和模拟接口。基础视口仅 320／390／768／1440px；高频验证仅检查指针／逐帧操作不引起 Vue 重渲染，以及反复开关／切换无资源泄漏。独立过渡工程的数据校验与失败恢复单独验证。
