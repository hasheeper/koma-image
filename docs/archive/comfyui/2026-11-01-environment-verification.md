# ComfyUI 独立环境与单图 API 验收

日期：2026-11-01。按 [Custom Workflow 极简方案](2026-11-01-custom-workflow-plan.md)准备一份 SDXL 文生图样例。**独立 GPU 后端已通过实际出图、下载与解码；Koma 适配器、字段识别和应用内闭环尚未实施。**

## 环境与资产

| 项目 | 实际配置 |
| --- | --- |
| 主机 | Ubuntu 22.04、RTX 4090 24GB、NVIDIA 驱动 550.54.14；容器内存限制 96GiB |
| Python | 用户目录内独立 Python 3.12.16 与虚拟环境 |
| PyTorch | torch 2.6.0+cu124、torchvision 0.21.0+cu124、torchaudio 2.6.0+cu124；FP16／BF16 CUDA 小矩阵检查通过 |
| ComfyUI | v0.3.59，commit `72212fef660bcd7d9702fa52011d089c027a64d8`；前端包 1.25.11；PyTorch SDPA；自定义节点和预览关闭 |
| 样例权重 | SDXL Base 1.0，revision `462165984030d82259a11f4367a4eed129e94a7b`；仅单文件 checkpoint，自带编码器与 VAE |
| 权重校验 | 6,938,078,334 字节，SHA-256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b` |
| 环境锁 | 75 个精确版本；锁文件 SHA-256 `69ab76feac614d183ae051761fe9c941551b4623c26040cdd329e124f46264a8` |

环境、模型、工作流和测试产物均保存在 GPU 用户目录下的独立 `koma-comfy/`，未进入 Koma 源码或 `.local/`。权重只下载到 GPU；使用镜像传输后按官方固定 revision 的大小与完整哈希核验，README／许可证也与官方字节一致。ComfyUI 为 GNU GPLv3，SDXL 为 CreativeML Open RAIL++-M，分别保留许可文件。

该基线适用于本次 SDXL 样例，不代表全部新架构的支持情况。当前驱动可运行所选 CUDA 12.4 wheel，新方案没有统一 CUDA 13 或全套模型下载的前置要求。

## 实际 API 结果

API JSON 使用七个核心节点：CheckpointLoaderSimple、EmptyLatentImage、正负 CLIPTextEncode、KSampler、VAEDecode、SaveImage。Prompt 为 `6.inputs.text`，Seed 为 `3.inputs.seed`，最终输出节点为 `9`。

固定参数为 1024×1024、batch 1、20 步、CFG 6、DPM++ 2M／Karras、denoise 1。一次 `POST /prompt` 提交后，只按返回的 `prompt_id` 轮询 `/history/{prompt_id}`，再通过 `/view` 下载节点 `9` 的图片。Seed 0 在实际请求、历史和 PNG 元数据中一致；返回一张正常解码的 1024×1024 RGB PNG，服务器与下载副本 SHA-256 均为 `81610ea4d92985b3aaf2a182fe161e898cc969bf7344a25a1567ef59e541d414`。没有重复提交或自动重试生成。

队列删除和定向中断路由以自建的未运行 ID 做了无副作用请求，均返回 200；固定源码具有按 `prompt_id` 判断运行项的逻辑。未测试运行中取消，未调用无条件全局中断。

## 访问与后续边界

ComfyUI 只监听 GPU 回环地址，经已有认证 WeTTY 会话映射到 Mac 本机回环 HTTP 入口，未修改 nginx 或新增公网映射。该通道支持本方案的 HTTP 提交、轮询和下载，不提供 WebSocket 或完整前端隧道。CORS 的预检与实际 GET 响应均允许当前 Koma 公开站点来源；真实浏览器的本机网络权限和 Koma 调用仍待接线后验收。

验收后队列为空，GPU 模型缓存已释放，显存约 530MiB、利用率 0%，ComfyUI 服务保留运行。GPU 目录保存启动脚本、API JSON、环境锁、权重清单与原图；本机任务记录保存认证转发的恢复方法，密码未持久化。

下一步仍是方案中的适配器模拟验证与 Koma 真实闭环，覆盖结果归属、历史、收藏、下载、失败、超时和取消。本次没有修改 Koma 业务代码、推送或发布。
