import { externalDraftSchema } from './draft-schema.ts';
import { DRAFT_SCHEMA, LIVE_SCHEMA } from './protocol.ts';

export function protocolDocument() {
  return `# Koma 企划目录与外部协同协议

状态：${LIVE_SCHEMA}；草稿：${DRAFT_SCHEMA}。
本文件定义当前 Koma 的企划格式与外部接口。外部 Agent 使用本地文件协作，无需站内 ASK Key。

## 文件分工

| 路径 | 用途与写入规则 |
| --- | --- |
| PROTOCOL.md、state.live.json、live/*.webp | Koma 生成；外部只读。分别是协议、实时状态与有限图片预览 |
| project.json、characters/、lore/、references/ | 企划资料；按用户任务直接编辑文件，Koma 重新扫描后读取 |
| refs/ | 兼容共享资料及配方／备忘录；外部可按用户任务维护资料，Koma 的 save_ref 也写到这里 |
| draft.inbox.json | 外部投递一份完整草稿，Koma 只读；修改画板、任务或请求 Koma 保存资料走此入口 |
| slates/*.slate.json | 任务文件；外部变更进入草稿审阅，确认后才更新本机任务 |
| assets/ | Koma 写出的成果原图及参数／标注；外部只读，新增交付使用任务绑图 |

直接改企划资料会改变磁盘文件，不经过 Koma 草稿确认；它不会自动覆盖画板。草稿投递只提出修改，用户确认后才应用，不触发生成或 CHAT 发送。
控制文件始终位于挂载根目录；成果沿用 assets/、slates/、refs/，不另建 outputs/。

## 企划结构与示例

外部 Agent 可按用户要求理解并拆解 TXT、Markdown、YAML、XML 等原始设定稿，将公共设定归入 lore/、角色资料归入 characters/<char_id>/，再按下列字段供 Koma 读取。
下列示例属于同一份企划。没有 JSON 元数据时也可按默认文件名组织。

\`\`\`text
企划根目录/
├── project.json
├── characters/guard/
│   ├── char.json
│   ├── profile.md
│   ├── portrait.png
│   └── extra/weapon.png
├── lore/world.md
├── references/
│   ├── references.json
│   └── city/night.png
├── refs/
├── slates/
└── assets/
\`\`\`

### project.json

\`\`\`json
{
  "title": "夜城企划",
  "description": "角色、城市设定与光线参考。",
  "paths": {
    "characters": "characters",
    "lore": "lore",
    "references": "references"
  }
}
\`\`\`

project.json 可省略，title 默认取目录名；paths 省略的项采用 characters、lore、references。映射相对于企划根目录，只改变资料来源，不重定向 refs/、slates/、assets/、live/ 和控制文件。

### characters/guard/char.json

\`\`\`json
{
  "name": "银发守卫",
  "aliases": ["夜巡者"],
  "brief": "银发红瞳的旧城守卫，谨慎寡言，负责夜间巡查。",
  "profile": "profile.md",
  "portrait": "portrait.png",
  "tags": {
    "prompt": "1girl, silver hair, red eyes",
    "negative": "",
    "outfits": [
      { "id": "uniform", "label": "巡逻制服", "prompt": "military uniform, red cape", "negative": "" },
      { "id": "casual", "label": "日常便服", "prompt": "white shirt, black trousers", "negative": "cape" }
    ]
  },
  "refs": [
    { "file": "extra/weapon.png", "title": "佩剑", "description": "只参考护手与握柄结构。" }
  ]
}
\`\`\`

- char_id 取角色目录名（此处 guard），与画板 c1/c2 槽位解耦。写入 TAG 是一次性操作，档案变更不自动改画板。
- name/title 为简短名称，brief 为角色识别摘要，description 为参考用途或补充说明；profile 指向完整人设原文文件。
- char.json 内的 profile、portrait、brief_file、tags_file、refs[].file 均相对于该角色目录。输出给 Koma 的资料引用则用企划根相对路径，例如 characters/guard/extra/weapon.png。
- brief 内嵌文本优先，其次 brief_file，再其次 brief.md、brief.txt；tags 内嵌字符串／对象优先，其次 tags_file，再其次 tags.txt。使用内嵌值时修改同名独立文件不会改变当前取值。
- profile 缺省查找 profile.md、profile.txt；portrait 缺省查找 portrait.png、portrait.webp、portrait.jpg、portrait.jpeg。显式文件路径缺失或类型错误时提示该项问题，不回退到默认文件。
- Koma 将 tags 字符串和 tags.txt 按完整正向词文读取。Agent 整理换装时使用 tags 对象：顶层 prompt 保存固定外貌，outfits 分别保存主服装与替换装；Koma 组合共同 prompt/negative 与所选的一套 outfits，均有内容时用逗号分隔。不选服装则只用共同部分。
- outfits 的 id 唯一且非空，prompt 必填；label 省略时使用 id，negative 可省略。服装标题只用于识别，不写进 TAG。
- 角色 refs/ 与 extra/ 都自动收录图片，可并存；refs 元数据用于命名及说明。根 refs/ 是另一个共享目录，通过完整路径区分。

### references/references.json

\`\`\`json
{
  "items": [
    {
      "file": "city/night.png",
      "title": "旧城夜景",
      "category": "场景",
      "description": "参考街道透视和冷暖光，不继承画中人物。"
    }
  ]
}
\`\`\`

file 相对于公共参考目录（默认 references/，可由 project.json 映射）。未登记的公共图片、角色 refs/extra 图片仍按文件名显示；缺少某项资料不妨碍其他内容读取。企划路径不能直接充当 restore_partial 或 Todo 绑图的图片编号，也不能通过外部草稿交接到 CHAT／EDIT。

### 索引与读取

state.live.json.refs_index 提供角色摘要及 TAG／档案／立绘／参考图路径，另列设定、公共参考和其他文件。按企划根相对路径读取完整资料；索引有省略或 limited=true 时可继续查看实际资料目录。
路径使用 / 分隔的根内相对路径。Koma 收录配置的资料目录、refs/slates/assets 及根下 TXT/Markdown；整理完成后核对更新的索引与资料读取问题。

## 草稿提交

外部支持 IMAGE 的 prompt_patch、params_patch、character_edit、restore_partial，以及 slate_edit、save_ref；不支持 CHAT／EDIT 写入或 base_image_id。下方 Schema 是完整投递对象。
每稿最多 12 步，单文件不超过 1 MiB；完整写入同目录临时文件后再替换 draft.inbox.json。不同正文使用新 draft_id（1–120 位字母、数字、下划线、点或短横线），source_label 可选，如实填写来源。
推荐原样带回 state.live.json.base_hash，保留本次读取的基底；省略时以接收时活动 IMAGE 画板为基底。显式哈希须匹配本页近期导出的基底，过期则重新读取状态并调整草稿。
以下最小示例省略可选 base_hash；正式操作推荐补上刚读取的值。

### draft.inbox.json

\`\`\`json
${JSON.stringify({ schema: DRAFT_SCHEMA, draft_id: 'example-001', source_label: '外部助手', draft_title: '补充光线', steps: [{ kind: 'prompt_patch', target: 'image.prompt', mode: 'append', text: ', warm evening light' }] }, null, 2)}
\`\`\`

- prompt_patch：rewrite 替换全文，append 末尾追加；replace/before/after 必须带在目标中恰好出现一次的非空 anchor。步骤按顺序执行，锚点匹配前序修改后的文本；空字段用 rewrite 或 append。目标如 image.prompt、image.negative、image.char.c1.prompt。
- params_patch：使用 params 对象和白名单参数，cfgRescale 是正确字段名；Seed 是字符串，空串随机，"0" 合法；宽高对齐 64px。型号和采样器使用当前状态中的可用值，参数还须满足该模型能力。
- character_edit：现有角色使用状态中的稳定 cN，不能用档案 char_id 或数组位置代替。add 的 prompt 必填，新 ID 由 Koma 分配；reorder 给完整 ID 顺序。
- restore_partial：source 使用当前索引的 #h/#f/#e，fields 指定要恢复的字段；该图片须有对应参数，值由 Koma 读取，提交时仅指定字段名。
- new_board_name：需要另开 IMAGE 画板时填写，应用时复制基底并叠加本稿修改。

### 图片引用

引用图片时带 picture_ref_version:2；引用 #h/#e 带回 picture_scope_id，引用 #f 带回 favorites_scope_id，混合引用分别带回。#h/#e 只在本页有效，切板不改变编号空间；#f 属于持久收藏库，普通刷新不重排。旧无标记投递仍校验 picture_scope_id。
EDIT 推荐完整码 #e板号.版本[a-c]。本板简写 #e版本[a-c] 另带 edit_board_id，须匹配 edit.active_board_id；去背景 a/b/c 分别为抠图／重建／混合，不带字母取接收快照中的当前变体。

## 回执、状态与预览

在 state.live.json.last_inbox_receipt 中按 draft_id 核对结果：pending 为排队／待审，applied 为用户选中的修改已保存，dismissed 为已忽略，invalid 为未接收并带 error。applied 仅表示应用草稿，生成是后续操作。
同 ID 同正文幂等，修改内容须新 ID；等本次终态再投下一份，多发送方共用投递槽时需协调。未收藏的 pending 草稿刷新后失效，应基于新状态重新提议。
回执不更新时检查 updated_at、目录连接和页面是否在前台。

boards/form 是当前 IMAGE 画板和表单，active_workspace 为 CHAT／EDIT 时也不改变外部写入目标。selected_image/recent_history.params 是对应图片的参数，basePrompt/baseNegative 与实际请求词文分别保存。
history_index、favorites_index、edit 是图片目录；record_id 对应具体参数记录，entity_key 关联同一原图字节，配方以具体记录为准。IMAGE 的 image_availability 为 thumbnail_only 时只剩缩略图与完整配方，仍可 restore_partial，但不能绑定为成果原图；original 表示原件仍在。
preview 指向导出的缩略预览，null 表示未附带图片文件；原图细节与透明度需读取原件。本机参考资产 ID 是资产标识，图片与编码不随 ID 导出。

## 任务与成果交付

active_slate 是工作台当前任务的摘要，目录归属、完整任务及交付状态以对应 slates/*.slate.json 为准。挂载／切换只加载该目录任务；当前目录新建或用户显式关联的任务才写出。

- slate_edit 的 op 为 create/update/delete。创建使用 slate_title；更新／删除须使用真实 slate_id 与 expected_version。每稿最多一个 slate_edit，每板最多 100 个 Todo、正文总计最多 900 KiB。
- todos 用 add/update/remove；标题字段为 todo_title，新增省略 id，由 Koma 分配。update/remove 使用已有 Todo ID。状态为 todo/in_progress/done/abandoned；mutation 记录改动。
- golden_recipe.capture_current 捕获同稿应用后的完整画板，修改锁定配方须显式 unlock。可与 prompt_patch/params_patch 组合准备下一张图。
- 需要交图的 Todo 必须绑图才能完成；纯文本任务用 image_required:false。bind.source 接受当前 #h/#f/#e，按上节带回作用域。caption_source 必选 base/sent/character，caption_mode 必选 full/strip_syntax；角色标注另给 character_id，缺失来源不替换为其他文本。
- strip_syntax 只剥离配对 {}、[]、数字::正文:: 和无属性的配对 XML 标签；转义、畸形或其他语法保留，不筛画师名。
- 成果保存在 assets/，默认使用唯一路径。标注与回执在图片完整文件名后追加扩展名，例如 assets/scene.png、assets/scene.png.json、assets/scene.png.txt，不是 scene.json。路径冲突不覆盖不同原图字节，换用新 target_path。
- 绑图保存原字节、真实尺寸和已有生成参数；本机成功不保证目录交付成功，核对 deliveries 与实际文件。directory_required:true 表示整稿须等目录交付成功，要求当前已挂载目录。

直接修改现有任务文件时保留 slate.id、slate.version 与已有绑定，版本由 Koma 确认后递增；新增成果用 slate_edit.bind。新任务文件、修改和 deleted:true tombstone 都进入审阅。目录交付失败时可查看同步错误并重试。

## 让 Koma 保存资料

save_ref 的 document 为 recipe/memo/slate，可选 document_title（最长 80 字符）；memo 必须带 text（最多 24000 字符）。recipe 固定保存 koma.bridge.recipe.v1 JSON，memo 保存 Markdown，slate 保存 koma.bridge.slate.v1 JSON。
recipe/slate 保存提议时的快照，不是同稿应用后的结果或出图回执；本机参考资产不附原图或编码。与 golden_recipe.capture_current 的取值时点不同。
确认后写入提议时固定目录的 refs/，未挂载时下载；不指定路径、格式或覆盖文件，文件名自动带唯一后缀。目录失联或已切换时阻断整稿，不静默改为下载。

## 外部草稿完整 Schema

base_hash 可省略；除字段结构外，提交还会校验锚点、图片作用域、模型能力与任务版本。

\`\`\`json
${JSON.stringify(externalDraftSchema, null, 2)}
\`\`\`
`;
}
