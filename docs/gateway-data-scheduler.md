# 网关、数据与调度

更新：2026-10-25。本文描述当前共享服务；阶段设计和验收见[归档](archive/2026-10-25/README.md)。协议能力见[图像协议](native-image-protocols.md)与[ASK 运行契约](ask/ask-contracts-and-decisions.md)。

## 服务与依赖

`src/services/application.ts` 在 App 中创建应用服务，供保活工作区、编辑覆盖层、设置和 ASK 使用。依赖方向为工作区 → domain／services → Profile → transport；协议识别不进入 UI 的品牌或域名判断。

`profile.ts` 登记六种协议。Profile 声明目录、鉴权、报价、执行路线、额度和图像／推理能力；未知 Profile 不能保存或恢复。transport 接受显式连接上下文，保持请求取消、错误与结果规范化，不从其他连接借 Key 或自动尝试另一协议。

## 报价与生成

- 预报价防抖：绘图／CHAT 650ms，编辑 400ms；旧请求失效、旧价淡显，空值、零值、未知费用、错误与加载分开。
- 标准网关执行前重新报价，发送本次 `max_cost`；涨价提示后继续，批量最多提示一次，不增加付费确认。
- 标准 Profile 保留原生免费、Studio、工具路线及额度策略。无报价能力不显示免费，不套用标准网关积分或 300／400 阈值。
- 图像任务全部经应用级 `runTask`，等待响应解码、缩略图与结果处理完成后才退出。失败停止后续批量，不自动重试；取消保留已完成图片。

## 锁与任务槽

Web Locks 使用集中定义的 Koma 名称：`koma-image-data-v1`、`koma-image-generation-v1`、`koma-image-generation-slot-v1:1..N`。默认全应用 N=1，跨绘图、CHAT、编辑与标签页协调；批次占同一槽直到结束。忙时提示，不自动排队；不支持安全锁时拒绝执行。自定义并发与额度预占仅保留边界。

ASK 推理、命名与压缩不占生图槽，不调用报价、扣费或生成端点。它们的同会话准入与快照隔离见 ASK 契约。

## 数据与租约

| 数据库 | Store／用途 |
| --- | --- |
| `koma-image-favorites` | `favorites`：收藏原图、缩略图与参数 |
| `koma-chat` | `conversations`、`assets`：CHAT 与图片素材 |
| `koma-handoff` | `items`：只认领一次的临时交接 |
| `koma-ask` | `conversations`：用户显式收藏的 ASK 快照与附件 |

数据库 schema version=1，与备份 envelope version=2 独立。名称集中于 `src/storage/names.ts`；偏好和凭据使用 `koma.*`，同步频道为 `koma-sync`。普通绘图历史和编辑会话属于页面内存。

应用持共享数据租约，所有数据库写入经 `data.write`；延迟保存服务提供 flush，缓存提供 reload。备份／恢复先排空写入和本页共享租约，再取得独占数据锁与任务门；其他活跃标签页或任务会阻止独占。完成或失败后恢复租约并刷新缓存，不能直接绕过租约写库。

备份 ZIP 的结构、CRC、哈希、去重、冲突副本和事务已实现，规则见[设置与备份](shared-settings-tags.md#普通备份)。ASK 收藏通过同一租约写入独立库，普通备份不含这些会话。

## 资源与运行方式

Blob、ImageBitmap、Object URL 由应用级资源服务和实际消费者持有；Vue 订阅浅快照。隐藏工作区只暂停 UI 监听与绘制，不释放在途任务或其他会话仍引用的图片。最后一个引用释放时清理临时资源。

静态版使用用户显式配置。可选本地服务支持标准网关和两种 ASK 协议，使用固定路径与服务端凭据，不提供任意 URL 转发；运行时连接／令牌不落盘。详见[发布说明](release-guide.md)。
