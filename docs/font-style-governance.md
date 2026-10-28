# 字体维护

更新：2026-10-25。本文维护字体配置与重建流程；G0–G4 的基线、资源哈希和验收见[归档](archive/2026-10-25/README.md)。样式加载和检查见[样式归属](style-ownership.md)与[样式检查](style-ownership.md#样式检查)。

## 唯一配置来源


| 文件 | 职责 |
| --- | --- |
| `config/fonts.json` | 字体族、样式、字重映射、格式、许可路径、用途与预加载清单；资源圆体还声明离线源文件及工具版本 |
| `config/font-ranges/koma-rounded.json` | Unicode 分片的唯一源配置；不按字重重复手工维护 |
| `scripts/build-font-css.mjs` | 仅用 Node 生成字体声明与角色，并检查资源、许可、预加载和生成一致性 |
| `public/fonts/index.css` | 生成输出，供浏览器加载；不要手改 |
| `scripts/build-rounded-font.py` | 可选的离线 WOFF2 重建，读取同一清单和分片配置 |

三个字体用途也由清单生成，其他样式继续只消费 `var(--sans)`、`var(--mono)`、`var(--brand)`：

- `sans`：Koma Rounded 与 sans-serif，用于界面中英文。
- `mono`：JetBrains Mono Variable、Koma Rounded 与 monospace，用于参数／数字等。
- `brand`：Fredoka Variable、Koma Rounded 与 sans-serif，仅用于品牌字。

资源圆体仍为三个静态字重：400＝Regular，500＝Medium，`600 700`＝Bold；保留 `font-synthesis: none`。JetBrains Mono 与 Fredoka 继续使用原有可变字重与字符覆盖。没有重新切分或合并 WOFF2，原文件名、二进制、比例 `·`／`×` 字形和许可均保留。

HTML 的拉丁字体预加载与清单保持一致，检查程序核对 type 和匿名 crossorigin。只使用统一字体 CSS，不增加第二份手写声明。

### 日常维护

修改字体清单或范围后运行：

```sh
npm run fonts:build
npm run fonts:check
```

如调整预加载清单，同时更新 `index.html` 的对应 `<link>`；不匹配时生成与检查都会报错。生成失败不会覆盖现有 CSS。源码中的生成文件应随清单变更一起提交。

`npm run dev` 与 `npm run build` 会先生成字体 CSS；已开启的开发服务器中修改配置后，重新执行 `fonts:build` 即可更新静态 CSS。`npm run check` 先检查生成一致性，过期时直接失败，避免构建自动修正后掩盖漏提交。CI 继续使用同一 `check`。

普通构建只需要 Node 与已提交的 WOFF2，不需要 Python、原始 TTF、外部字体服务或额外 npm 依赖。

### 可选：更新字体二进制

只有主动更新字体资源时才执行以下流程。源文件由维护者自行准备，不纳入普通构建或发布包：

```sh
python3 -m venv .local/font-tools
.local/font-tools/bin/python -m pip install fonttools==4.60.1 brotli==1.1.0
.local/font-tools/bin/python scripts/build-rounded-font.py /path/to/ttf-dir
npm run fonts:build
npm run check
```

源目录需含清单指定的 `ResourceHanRoundedCN-Regular.ttf`、`Medium.ttf`、`Bold.ttf`，版本为 0.990。离线脚本核对工具版本，保留比例字形补丁与内部重命名；先在同一文件系统的临时目录完成全部分片，再替换 `files/`。生成失败不清空原目录，替换异常尝试恢复原目录；极端恢复失败时保留原文件的暂存目录。许可文件不参与替换。

可用 `--output /path/to/scratch-family` 将重建结果写到临时位置而不替换正式资源，`--workers` 控制离线处理进程数，默认最多 4 个。该设置与应用任务并发无关。

字体来源、比例字形修改及许可见[第三方资源](third-party-assets.md)。
