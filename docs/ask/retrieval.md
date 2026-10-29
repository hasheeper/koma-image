# ASK 检索与状态

更新：2026-10-29。R1–R4 已完成本地模拟收口。本文维护当前快照、历史检索、词典查询与消歧；勘探差异、原修订补丁与阶段证据见[归档](../archive/2026-10-25/README.md)。现行决策以[ASK 维护入口](README.md)为准。

## 1. 状态与展示边界

活动画板完整基础 Prompt／Negative 与角色原文始终随初始状态提供；其他画板只传目录，无锚点历史图原文按需读取。`get_state({ board_id })` 默认读取 initial 冻结原文，latest 只追加最新读取结果，不改变本轮草稿基底。

程序不发送猜测的提示词语义分类，不建立代码级画师识别或授权判断。文本结构校验、唯一锚点与参数边界保留，字段差异由 `draft/view.ts` 展示。

## 2. 原始状态与文本校验

### 2.1 两套 L0 命名分开理解

“提示词 L0”指静态宪章；“状态摘要 L0”指每轮 user 消息中的 `<workspace_state>`。六维指导属于前者，原始表单属于后者。不得为了瘦身把动态表单移进 System。

当前摘要版本为 `v:7`，契约如下：

- 删除 `image.prompt_sections`，不换名输出 `segments` 或另一份全文切片。
- 活动画板始终 `image.form.text_included=true`，直接包含完整 prompt/negative 和每角色 id/on/prompt/negative/position；其他画板只给目录。无锚点时 `image.current` 仅含 ID，history 仅 mode/count/latest_id，favorites 仅 count，不预载历史文本、差异或聚类。显式历史／收藏锚点保留模式 A；附件或 CHAT ID 不隐式展开 IMAGE 历史。
- 根层 `base_hash` 在 IMAGE 覆盖源画板 ID、完整生成表单与 CHAT composer，在 EDIT 覆盖编辑板 ID、底图、配置与蒙版修订；不另加 form 内 hash。草稿继续绑定发送时的源板与快照。
- 根层 `image_input` 包含本轮冻结的图片输入许可 `enabled` 和模式 `on_demand`／`metadata_only`。仅元数据模式明确视觉工具与资料图片读取不可用；`get_state({scope:"latest"})` 仍保留本轮限制，不随全局开关变化。该字段不进入 `base_hash`，不改变静态工具定义。
- 根层 `refs_index` 只包含挂载资料的可用性、文件相对路径／大小和截断信息；不含正文或图片，不进入画板 `base_hash`。`read_ref({path, offset?})` 在本轮冻结目录清单内按需读取，完整相对路径用于同名消歧，文本按 `next_offset` 续读。同轮固定首次读取版本，后续轮次可重新读取；具体预算和生命周期见[共享资料](../integrations/bridge.md#共享资料与按需读取)。
- 每个工作区都附 `chat_model`：目录就绪时为当前 CHAT 模型的显示名、`max_images`、可写尺寸项 `writable`（`size`／`aspect_ratio`／`image_size` 中模型声明者的当前值与可选值）与只读项 `read_only`（`quality`）；未就绪为 `{ready:false}`。不含连接、上游模型 ID 或其他设置，不进入 `base_hash`；草稿本地另存模型 ID，用于发现模型已切换。`get_chat_context` 同样返回 `chat_model`，并附 `available_models` 名称列表与各轮版本的图片 ID。
- `characters` 已接通真实角色组，`image.form.references` 提供 Vibe／Precise 的启用与数值配置摘要，不含图片或编码；六维是模型理解方式，不新增六类 JSON 字段。
- 初始快照在整轮冻结。`get_state` 默认 scope=initial，可通过 board_id 读取本轮其他画板完整表单；scope=latest 才读取外部新改动。结果只追加在队尾，历史索引仍不展开；不能使新图进入本轮 library，也不能替换草稿使用的初始 hash。

初始状态已包含 Variety+、noiseSchedule、transparentBg，以及 capabilities／effective／input_budget／cost；角色分段计数后按方向合计，费用只读或纯本地估算，详见 [NAI 基础感知](nai-awareness.md)。get_meta 补齐实际存在的 Variety+、Director 和来源配方，旧记录不补造。

EDIT 活动现场包含表单、底图与查看图、能力、蒙版几何修订和聚焦框；初始版本目录有界截断，get_state 的 edit_board_id 可读取指定板完整状态。check_nai_input 检查冻结候选，不创建卡片或写入。权限、冻结与交接见 [ASK × EDIT](edit.md)。

### 2.2 画师判断交给提示词与用户

是否修改画师由系统提示词「画风与基底配方」原则约束，用户通过草稿卡目视确认。前端不识别画师分类，不检查名字、次序或权重，不分析用户是否点名授权，也不建立 artists.ts。

validate.ts 保留目标存在性、两级锚点匹配、base_hash 与内容冲突、参数范围和模式组合等结构校验。修改仍先预览、再由用户确认，之后可撤销。草稿记录原问题只用于用户点击「重新提议」，不用于自然语言授权判断。

## 3. search_history 契约

### 3.1 参数

```ts
interface SearchHistoryArgs {
  query?: string; // 1–300 字，朴素关键词；不解释布尔、SQL 或正则
  changed_field?: "prompt" | "negative" | "model" | "seed" | "steps" |
    "scale" | "cfg" | "sampler" | "width" | "height" | "size" |
    "strength" | "noise";
  similar_to?: string; // 本轮有效 #h/#f/#e/#c 图片 ID
  scope?: "history" | "favorites" | "edit" | "chat" | "all"; // 默认 all
  limit?: number; // 默认 8，整数 1–15
}
```

补丁原参数没有 chat，却在职责中包含 `#c`；这里显式补齐，保留当前 all 已包含当前分支图片的能力。其他会话/分支、未选版本和无图轮次不在搜索范围；无图轮次用 `get_chat_context`。无任何筛选时列出最近候选；非法字段、ID 或范围返回明确工具错误。新 Schema 不保留 `min_sim`；不重写内存中的旧工具历史。

### 3.2 匹配与排序

1. NFKC、转小写、下划线等同空格；按空白、逗号与分隔标点拆分，去重。仅独立的 AND/OR/NOT（不区分大小写）作为误写操作符忽略，不启用否定逻辑，不破坏 `anderson` 等词。标点清理不等于执行表达式；显式 query 清理后为空时返回参数错误，不意外列出全部记录。
2. 搜索白名单仅 prompt、negative、model、modelName；不扫描整个 JSON 的字段名或数值。当前记录没有用户备注，不能承诺备注检索；将来有正式字段再扩展。
3. query 内多个 token 按 OR-Hit 召回，至少命中一个；按不同命中 token 数、归一后的完整短语子串是否命中降序排列。跨中英文不自动翻译；模型可自行提供同义关键词，但查不到不表示历史不存在。
4. similar_to 用现有词级 Jaccard，排除基准图与其别名；仅返回正相似度候选。基准 prompt 为空时提示不能作相似检索。无查询词时按相似度降序；同时传 query 时先满足关键词召回，再按相似度、token 命中数、短语命中排序。changed_field 是独立过滤条件，所有提供的过滤条件共同生效。
5. 同分优先真实 createdAt 较新者；未知时间排在已知时间之后。CHAT 无真实时间时按当前分支轮序由近及远；最终以稳定 ID 打破平局。时间只来自当轮记录；不伪造 CHAT 的 epoch 时间。
6. 模式 A 的 T2 `.9` 阈值保持；搜索的 Top-N 与摘要分圈阈值是不同用途，不联动修改。

### 3.3 来源、前序与返回结构

- 在筛选前建立每个来源的序列：history 用历史到达顺序；favorites 用记录 createdAt（不是收藏时间）；edit 用板内版本顺序；chat 用当前分支轮序。前序指同来源中仍保留的上一条，不代表完整生成历史。
- `compared_to` 不跨来源，查 query 或 limit 不改变比较对象。只比较双方确实有值的参数；缺失字段不能解释为用户删除。size 在宽或高改变时出现，width/height 保留独立过滤。
- 同一底层记录在历史和收藏中只返回一次；all 优先仍属于本轮 history 的标签，其次 favorites。限定 favorites 时必须返回 `#f` 标签。scope 按本轮列表成员关系判断，不能因 ID 注册表保留了旧 `#h` 就把仅在收藏的图片归入 history。返回 aliases，按记录 ID 去重，不按图片内容哈希合并；相似检索排除基准的所有别名。
- CHAT 携带 prompt、图片尺寸、版本序号、版本内图序、是否选中，以及该轮模型名与已知选项值（`chat_options`，仅尺寸类与 quality）；缺失 seed/negative 等不补值，不从当前表单推断。

```ts
interface HistorySearchResult {
  matches: Array<{
    id: string;
    aliases: string[];
    source: "history" | "favorites" | "edit" | "chat";
    age: string | null;
    size: [number, number];
    seed: number | null;
    matched_field: "prompt" | "negative" | "model" | "modelName" | null;
    matched_snippet: string; // 原文摘录，最多 180 字，不生成 HTML
    compared_to: string | null;
    changed_from_prev: string[] | null; // 无前序为 null，无变化为 []
    similarity?: number; // 仅 similar_to 模式
  }>;
  total_matched: number; // 去重和过滤后、limit 前
}
```

`age` 按本轮捕获一次的时间计算，未知为 null；整轮重查相同参数得到相同结果。最优命中字段依次按 token 数、短语命中、prompt/negative/model/modelName 优先级选择；无 query 时摘录 prompt。若仅指定 changed_field 且该文本缺失，片段可为空。全量参数留给 `get_meta`。

### 3.4 消歧沿用实际 UI 通道

单条命中可继续 get_meta 或 view_image；多条返回时通过 `ToolOutcome.picks` 展示最多 4 个有效 ID。模型在不确定时提示用户选择，不将任意文本 ID 解析成选择器。点击只绑定 anchor 并在空输入框中预填，不自动发送、不改变现有输入；图片失效时禁用选择。

搜索结果本身不在轮内切换摘要模式 A。选择后由下一轮发送时的 anchor 构建模式 A；同轮用 get_meta 获取候选详情即可。`#c` 当前不进入绘图历史同心圆，使用 CHAT 上下文工具，不声称具有 CHAT 的模式 A。

当前使用纯本地关键词与 Jaccard 检索，不承诺“零延迟”。Embedding/RAG、索引持久化、全历史扫描和对应设置均不在当前范围；未来须另定数据范围、连接、费用、删除更新与取消策略。

## 4. search_tags 契约

### 4.1 调用时机

- NAI 常规构图、动作、光影和自然语言表达：直接组织文字，无须逐词查表。
- 需要核对角色/作品标准词、容易混淆的专有词，或用户明确要求查词：按需核验；检索结果是候选，不能保证模型训练收录或出图表现。
- 面向 OpenAI Images/Gemini 等的自然语言创作，不为其主动转换整套 Danbooru 词表。**按任务意图而不是当前路由禁用工具**：用户在 CHAT 中明确查词或准备 NAI 提示词仍可用；静态工具集不随工作区切换。
- 删除“这些模型不认下划线”“角色只认 ASCII/罗马音”“大模型已掌握绝大部分词”等无依据的绝对说法。标准词与自然语言各按实际目标使用。
- `post_count` 仅反映词典来源的帖子收录量；不等于 NAI 数据集量、激活概率或权重建议。不使用 300/3000 的硬分档，不因低频或未命中强制弃词。

### 4.2 查询接口与数据边界

```ts
interface SearchTagsArgs {
  queries: string[]; // 1–5 项；每项 trim 后非空，最多 300 字
  limit_per_query?: number; // 默认 5，整数 1–10
}

interface TagsSearchResult {
  note?: string; // 存在失败项时说明未核验，不把故障当作未收录
  results: Array<{
    query: string;
    status: "ok" | "no_match" | "error";
    matches: Array<{
      tag: string;
      category: number;
      category_label: "general" | "artist" | "copyright" | "character" | "meta" | "unknown";
      post_count: number;
      zh: string | null;
      aliases: string[] | null;
      source: "translated" | "danbooru";
    }>;
    error?: string;
  }>;
}
```

使用数组保留查询顺序及逐项状态，替代补丁按任意 query 建对象键的结构。规范化等价的重复 query 合并，只执行一次，返回首个原始写法；先校验原始数组上限再去重。空数组/空项/超长/非整数均明确拒绝。

`name→tag`、`cnName→zh`、`count→post_count`；分类标签复用 `CATEGORIES` 的 className。上游没有别名时返回 `aliases:null`，没有释义时 `zh:null`，不把生成的同义词冒充词典关系。不修改共享 TagItem，不加 countKnown/categoryKnown。category/count 原样透传，沿用共享服务缺失值归零的行为；因此 0 不能据此证明真实零帖子或已确认分类。工具说明明确这一限制，UI 行为不变。

### 4.3 复用完整查询管线，不承诺完整词库

通过只读异步端口调用应用已有的 `services.tags.suggest`。调用选项为 `{ broad:true, categories:[0,1,3,4,5], limit:30, exactFirst:true, signal }`，其中 **exactFirst 为可选项**，默认关闭。与词典页的 page 共用主数据源、英文回退和缓存，不另建 fetch 入口、不要求用户先打开词典。显式传全分类，避免用户的默认分类 `[0,3,4]` 把画师和 meta 隐藏。

rankTags 默认按收录量优先，精确词可能被高热度近似词挤出。ASK 查询让共享服务在返回候选截断前按英文/中文归一后的精确匹配置顶，其余沿用现有顺序，再由包装层按 limit_per_query 截取。exactFirst 已进入查询结果缓存键，避免影响同词的 UI 查询；主源原始候选缓存仍可共用。只对上游实际返回的候选重排，不承诺穷尽精确匹配。词典 UI/补全的默认排序、分页与偏好不变。

主源为 `tagsuggest.zeabur.app/api/tags/suggest`；只有英文查询可以按共享服务既有规则回退到 Danbooru autocomplete。中文不回退到英文接口，不增加翻译、抓取或任意 URL 能力。双向查询能力依赖数据源实际收录，某个中文角色名未命中不能宣称该词不存在。主源最多 30 条且没有服务端分页，不伪造全量覆盖率。

这是 ASK 工具允许访问**既有固定词典服务**的范围更新；它不是通用联网搜索。外发只有 queries 中的词，不附带完整 prompt、工作台、图片、Key 或其他连接信息。挂载、打开 ASK 或切换工作区不查词，只有实际工具调用才触发；metadataOnly 仅关闭图片发送，不代表禁用文字查词。

### 4.4 异步、取消与预算

- `ToolContext.tags` 从同步缓存函数改为只读异步查询端口；注入共享服务，不把 application 或写接口传给 tools。
- 一次批量 search_tags 计 **1 次工具调用**，最多 5 个独立查询；不承诺等于 1 个 HTTP 请求。Promise.allSettled 并发执行全部查询；不自建限流队列，不占用生成锁，不改变全应用生成并发 1。
- 保留共享服务每来源 8 秒超时及既有英文回退；不增加 ASK 层自动重试。共享 get 目前可能对 TypeError 重取一次，不能将其描述成“所有查词只有一次网络请求”。不新增 20 秒或其他批次定时器；逐项保留共享服务返回的成功、失败与超时结果。
- 传递轮次 AbortSignal；suggest 进入缓存前、批量 await 后均检查取消；透传同一轮次 signal。用户停止时取消在途查询、回滚当前轮，不把取消变成 no_match。
- 区分 no_match、网络/429/超时/格式错误；部分成功保留有效结果并逐项标错，全失败标记工具失败并展示原因。结果以 canonical JSON 包 `<data>`，词典文本不能关闭包裹或成为指令。
- 英文回退也失败时区分“中英词典未命中”与“主源失败”，分别给出两个来源的结果；读取响应体期间仍保留超时、取消与网络错误，JSON 语法或结构不符才报格式异常。失败结果附 note，提示模型保留有效结果、基于已有知识继续，不因服务故障连续换近义词重查；失败不等于词条不存在。
- 草稿校验不依赖词典查询，始终同步；应用前仍检查内容冲突。
## 5. 维护与验证

实现入口为 `digest/`、`search-history.ts`、`search-tags.ts`、`tools.ts` 及共享 `services/tag-search.ts`。模型工具描述与实际 Schema 同步，不以工作区切换动态改变工具集合。

模拟验证覆盖冻结来源、别名去重、时间与缺失字段、OR 关键词、相似度、前序变化、词典逐项失败／取消和候选选择。真实图片诊断及供应商效果仍需独立验证；当前检查入口见[项目说明](../../README.md#开发与检查)。

### 本地任务状态

`active_slate` 在每轮初始状态与 Bridge 状态中为同源摘要：任务板身份／版本、配方概况／锁定、Todo 标题／状态／要求／绑图状态。要求最多 320 字，截短有标记；无活动板为 null。`get_state({include_slate:true})` 按需读取完整冻结任务与配方；scope latest 只用于核验当前修改，不改变草稿基底。原图和连接配置不进入摘要。

## HOME 状态

`workspace: "home"` 时仍携带活动画板的完整基础／角色词文、CHAT 及模型状态；另有 `home.lines`（线 ID、类型、标题、可读取脸编号或 null、状态）和 `home.finals`（数量、最近最多 12 个 `#f` 与来源链）。活动任务板仍使用 `active_slate`。其他会话没有本轮可读取编号时脸编号为空；暂存 WebP 永不分配 `#h`／`#f`。此索引不预载历史词文和像素，读取继续使用现有工具。

## 图片身份与 EDIT 现场

[图片身份](../engineering/image-identity.md)统一原图实体、参数记录与冻结展示绑定。`picture_ref_version=2` 的状态同时给出页面与收藏库作用域；EDIT 目录包含板号、完整／本板编号、版本、尺寸、工具、出处和实体。`search_history(scope="edit")`、元数据、Diff、看图与 Slate 交付可访问本轮编辑图；内置编辑配置经草稿确认写入，外部目录保持只读编辑索引。

回复、草稿、账本与压缩归档保留具体绑定，切编辑板或 CHAT 分支不重解旧短码。视觉按实体共享资格与派生编码；同轮同规格重复请求不重发，新的规格／区域与跨轮重看按实际发送计预算。元数据按具体记录读取，不能因同字节覆盖另一份配方。附件原图身份与发送编码分离，拼图仍不授予单图裁切资格。
