# ASK 检索工具与状态感知：修订规范与勘探

日期：2026-10-22。状态：R1–R4 已完成并通过模拟验收。勘探基线：`fc6d527`；当前行为按下文最新用户确认执行。

来源：用户同日提供的《Koma ASK：检索工具与状态感知技术规范（修订补丁）》。本文保留取消语义分区、关键词检索、批量查词三项方向，并修正与代码及数据来源不符的细节。文档 4 [§2.8](ask-implementation-plan.md#28-检索工具与状态感知修订)采纳本文作为本专题的目标契约；实施与验收记录见本文 §5。其余工程边界仍按文档 4 与 `AGENTS.md`。

## 1. 勘探基线：修订前的差异

### 1.1 修订前十个工具与本次调整

| 工具 | 修订前实现 | 本次调整 |
| --- | --- | --- |
| `get_state` | 追加最新摘要，包含 `image.prompt_sections` | 去掉语义分区；不扩张本轮图片快照 |
| `search_history` | 单一子串匹配；已有 scope、Jaccard 与 picks | 多词命中排序、明确来源/时间/前序、紧凑结果 |
| `get_meta` | 完整参数、无图片 | 继续作为检索后的详情入口 |
| `diff_meta` | 参数变化与提示词 diff | 保留；复用差异算法 |
| `view_image` | glance/look/crop、前置查看与预算 | 保留 |
| `view_sheet` | 2–6 张本地拼图 | 保留 |
| `search_tags` | 同步单词查询 `localTags` 页面缓存 | 异步批量调用站内词典查询管线 |
| `get_chat_context` | 锁定当前分支文本、底图、勾选与已有额度 | 保留；无图片轮次仍由它读取 |
| `get_model_manual` | 三份内置手册，按需只读加载 | 保留；更新其中旧查词说明 |
| `propose_draft` | 校验后展示，用户确认才写入 | 保留确认写入；按最新决策删除代码级画师判断 |

### 1.2 代码证据与实际缺口

| 主题 | 修订前代码事实 | 修订结论 |
| --- | --- | --- |
| 状态分区 | `digest/index.ts` 在 **`image.prompt_sections`** 输出五类切片；不是 `form.segments`；`base_hash` 在根层 | 删除实际字段，保留原始表单、其他状态和根层 hash |
| 六维理解 | `prompts/constitution.ts` 已有六个视觉维度 | 已实现，不重复建设；L1 仍描述分区，需同步移除 |
| 画师保护 | `draft/validate.ts` 已在校验层比较修改前后全文的画师、顺序与有效权重；`segments.ts` 同时供 `.keep` 使用 | 按用户最新确认删除程序拦截，仅保留 `.keep` 文本解析 |
| 关键词 | `tools.ts` 对序列化 metadata 做完整子串 `includes`；大小写与下划线已归一 | 乱序多词、OR-Hit、操作符清理和相关性排序未实现 |
| 参数 | 默认 `scope=history`、`limit=10`，最大 20；有 `min_sim`，默认 .9；没有 `size` 变化别名 | 新默认 all、8/15；移除公开 `min_sim`；补 size |
| 排序/变化 | 无时间次排序；`changed_field` 与过滤后混合列表的下一条比较 | 应先在各来源内部建立前序，再过滤与排序，不能跨历史/收藏/CHAT 比较 |
| 来源成员 | `snapshotPictures` 以 ID 注册表的 aliases 判断历史/收藏；被移出普通历史但仍在收藏的记录可能保留旧 `#h` | scope 依据本轮真实列表成员关系；历史别名用于解析，不用它推断当前来源 |
| CHAT | service 的 library 已含当前分支所选完成版本的第一张图；`scope=all` 会搜到 `#c`，却没有 chat scope；时间被填为 0 | 明确增加 chat scope；不声称检索所有会话、版本或无图轮次；未知时间返回 null |
| 返回值 | `{total,matches}`，每条附完整 metadata；无来源、片段、时间和变化摘要 | 改为紧凑契约，详情用 get_meta，减少重复发送全文 |
| 消歧 | search_history 返回多条即生成前 3 个 `ToolOutcome.picks`；runner/service 转为 `.pick`；正文 ID 只变成引用 | 复用已有结构化 picks，不能宣称“正文列 ID 就会生成缩略选择器” |
| 查词 | `service.ts` 注入 `localTags`；缓存最多 4000 条，未访问过词典的新词可能永远查不到 | 接入共享 `services.tags`；分类判断已取消，无消费者的 tag-memory 一并删除 |
| 数据源 | `tag-search.ts` 的 suggest/page 共用双语在线候选接口，英文可回退 Danbooru；主源每次最多 30 候选，无服务器分页 | 是同一查询管线，不是完整本地词库、穷尽检索或离线服务 |
| 词条字段 | `TagItem` 只有 name/cnName/category/count/source；无 aliases；缺失 count/category 目前折成 0 | 不改 TagItem；透传共享数值，说明缺失值可能已归零；别名/释义不编造 |
| 热度/语义 | 无代码或实测证明 300/3000 能预测 NAI 激活强度 | 删除硬阈值和“低频必须放弃”的规则，只作收录量参考 |
| Embedding | 没有检索设置、模型连接、向量索引或生命周期 | 单列后续研究，不列入本轮实现或现有能力 |

本次复现：用合成快照调用现有工具，`white_hair` 命中，`hair white` 与 `white AND hair` 均不命中；省略 scope 只返回 `#h`，all 可返回 `#h/#f/#c`。27 项现有 digest/tools/draft/prompts 单元测试通过，**只证明旧实现基线**，不是下述新契约验收。

用户随后确认的简化已覆盖早期规划：不建立 artists.ts、不保留代码级画师拦截或自然语言授权识别、取消原验收 #4；不扩展 TagItem，以 Promise.allSettled 并发批量查词，不建立队列或额外批次定时器。用户修改后的提示词正文保持原样。

## 2. 原始状态与文本校验

### 2.1 两套 L0 命名分开理解

“提示词 L0”指静态宪章；“状态摘要 L0”指每轮 user 消息中的 `<workspace_state>`。六维指导属于前者，原始表单属于后者。不得为了瘦身把动态表单移进 System。

摘要版本已由 `v:2` 升为 `v:3`：

- 删除 `image.prompt_sections`，不换名输出 `segments` 或另一份全文切片。
- `image.form.prompt/negative` 原样保留；模型、尺寸、参数、current、generation、history、favorites 与 CHAT 摘要仍保留，不能把整个 form 缩成两个字符串。
- 根层 `base_hash` 继续由 prompt、negative、CHAT composer 计算，算法与草稿确认语义不变；不另加 form 内 hash。
- `characters`、`vibes` 保留当前空数组预留；六维是模型理解方式，不新增六类 JSON 字段。
- 初始快照在整轮冻结。`get_state` 只在工具结果追加新状态；它不能使刚生成的图片进入本轮 library，也不能替换草稿使用的初始 hash。

### 2.2 画师判断交给提示词与用户

是否修改画师由系统提示词「画风与基底配方」原则约束，用户通过草稿卡目视确认。前端不识别画师分类，不检查名字、次序或权重，不分析用户是否点名授权，也不建立 artists.ts。

删除 digest/segments.ts、artistProblem、namedForChange 及分类回调。src/ask/prompt-text.ts 只提取原文跨度与去除权重符号后的词组，供 .keep 下划线使用，不进行语义分类。原先仅服务 ASK 的 tag-memory.ts 已无消费者，一并删除；站内查询服务本身的缓存继续使用。

validate.ts 保留目标存在性、两级锚点匹配、base_hash 与内容冲突、参数范围和模式组合等结构校验。修改仍先预览、再由用户确认，之后可撤销。草稿记录原问题只用于用户点击「重新提议」，不用于自然语言授权判断。

## 3. search_history 契约

### 3.1 参数

```ts
interface SearchHistoryArgs {
  query?: string; // 1–300 字，朴素关键词；不解释布尔、SQL 或正则
  changed_field?: "prompt" | "negative" | "model" | "seed" | "steps" |
    "scale" | "cfg" | "sampler" | "width" | "height" | "size" |
    "strength" | "noise";
  similar_to?: string; // 本轮有效 #h/#f/#c 图片 ID
  scope?: "history" | "favorites" | "chat" | "all"; // 默认 all
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

- 在筛选前建立每个来源的序列：history 用历史到达顺序；favorites 用记录 createdAt（不是收藏时间）；chat 用当前分支轮序。前序指同来源中仍保留的上一条，不代表完整生成历史。
- `compared_to` 不跨来源，查 query 或 limit 不改变比较对象。只比较双方确实有值的参数；缺失字段不能解释为用户删除。size 在宽或高改变时出现，width/height 保留独立过滤。
- 同一底层记录在历史和收藏中只返回一次；all 优先仍属于本轮 history 的标签，其次 favorites。限定 favorites 时必须返回 `#f` 标签。scope 按本轮列表成员关系判断，不能因 ID 注册表保留了旧 `#h` 就把仅在收藏的图片归入 history。返回 aliases，按记录 ID 去重，不按图片内容哈希合并；相似检索排除基准的所有别名。
- CHAT 目前只携带 prompt 和图片尺寸，缺失 seed/model/negative 等不补值。以后若需要这些字段，应从真实轮次 settings 显式提取，不能从当前表单推断。

```ts
interface HistorySearchResult {
  matches: Array<{
    id: string;
    aliases: string[];
    source: "history" | "favorites" | "chat";
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

本轮只做纯本地关键词与 Jaccard 检索，不承诺“零延迟”。Embedding/RAG、索引持久化、全历史扫描和对应设置均不在 R1–R4；未来须另定数据范围、连接、费用、删除更新与取消策略。

## 4. search_tags 契约

### 4.1 调用时机

- NAI 常规构图、动作、光影和自然语言表达：直接组织文字，无须逐词查表。
- 需要核对角色/作品标准词、容易混淆的专有词，或用户明确要求查词：按需核验；检索结果是候选，不能保证模型训练收录或出图表现。
- 面向 OpenAI Images/Gemini 等的自然语言创作，不为其主动转换整套 Danbooru 词表。**按任务意图而不是当前路由禁用工具**：用户在 CHAT 中明确查词或准备 NAI 提示词仍可用；静态工具集不随工作区切换。
- 删除“这些模型不认下划线”“角色只认 ASCII/罗马音”“大模型已掌握绝大部分词”等无依据的绝对说法。标准词与自然语言各按实际目标使用。
- `post_count` 仅反映词典来源的帖子收录量；不等于 NAI 数据集量、激活概率或权重建议。删除 300/3000 的硬分档，不因低频或未命中强制弃词。

### 4.2 查询接口与数据边界

```ts
interface SearchTagsArgs {
  queries: string[]; // 1–5 项；每项 trim 后非空，最多 300 字
  limit_per_query?: number; // 默认 5，整数 1–10
}

interface TagsSearchResult {
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

通过只读异步端口调用应用已有的 `services.tags.suggest`。目标选项为 `{ broad:true, categories:[0,1,3,4,5], limit:30, exactFirst:true, signal }`，其中 **exactFirst 是 R3 新增的可选项**，默认关闭。与词典页的 page 共用主数据源、英文回退和缓存，不另建 fetch 入口、不要求用户先打开词典。显式传全分类，避免用户的默认分类 `[0,3,4]` 把画师和 meta 隐藏。

rankTags 默认按收录量优先，精确词可能被高热度近似词挤出。ASK 查询让共享服务在返回候选截断前按英文/中文归一后的精确匹配置顶，其余沿用现有顺序，再由包装层按 limit_per_query 截取。exactFirst 已进入查询结果缓存键，避免影响同词的 UI 查询；主源原始候选缓存仍可共用。只对上游实际返回的候选重排，不承诺穷尽精确匹配。词典 UI/补全的默认排序、分页与偏好不变。

主源为 `tagsuggest.zeabur.app/api/tags/suggest`；只有英文查询可以按共享服务既有规则回退到 Danbooru autocomplete。中文不回退到英文接口，不增加翻译、抓取或任意 URL 能力。双向查询能力依赖数据源实际收录，某个中文角色名未命中不能宣称该词不存在。主源最多 30 条且没有服务端分页，不伪造全量覆盖率。

这是 ASK 工具允许访问**既有固定词典服务**的范围更新；它不是通用联网搜索。外发只有 queries 中的词，不附带完整 prompt、工作台、图片、Key 或其他连接信息。挂载、打开 ASK 或切换工作区不查词，只有实际工具调用才触发；metadataOnly 仅关闭图片发送，不代表禁用文字查词。

### 4.4 异步、取消与预算

- `ToolContext.tags` 从同步缓存函数改为只读异步查询端口；注入共享服务，不把 application 或写接口传给 tools。
- 一次批量 search_tags 计 **1 次工具调用**，最多 5 个独立查询；不承诺等于 1 个 HTTP 请求。Promise.allSettled 并发执行全部查询；不自建限流队列，不占用生成锁，不改变全应用生成并发 1。
- 保留共享服务每来源 8 秒超时及既有英文回退；不增加 ASK 层自动重试。共享 get 目前可能对 TypeError 重取一次，不能将其描述成“所有查词只有一次网络请求”。不新增 20 秒或其他批次定时器；逐项保留共享服务返回的成功、失败与超时结果。
- 传递轮次 AbortSignal；suggest 进入缓存前、批量 await 后均检查取消；透传同一轮次 signal。用户停止时取消在途查询、回滚当前轮，不把取消变成 no_match。
- 区分 no_match、网络/429/超时/格式错误；部分成功保留有效结果并逐项标错，全失败标记工具失败并展示原因。结果以 canonical JSON 包 `<data>`，词典文本不能关闭包裹或成为指令。
- 草稿校验不依赖词典查询，始终同步；应用前仍检查内容冲突。

## 5. 接入与验收边界

实施顺序见文档 4 的 R0–R4。两个工具 Schema 与专项手册接口说明在同一批次更新；保留用户编辑的 L0/L1/L2 正文，仅升版本为 c5.w4.m4，工具顺序固定且仍为十个；成人模式附加块、词表编解码、六次工具预算、视觉预算与草稿确认出口不变。提示词/Schema 版本升级可能改变前缀，缓存命中以实际 usage 为准。

本次验收覆盖新状态的字段缺席与原文/hash 保真、全部草稿模式的结构校验与确认撤销、检索的排序/去重/前序/无效参数、空缓存中英文批量查词、实际 HTTP 参数、取消与部分失败、两种推理协议工具结果、候选选择与调用调试。mock 返回的词条和热度不能作为真实数据源支持证据。

新增 `tests/ask-retrieval.test.mjs` 的 7 项测试覆盖确定性检索、真实共享查词管线与模拟 fetch、批量预算、来源与取消；`ask.browser.mjs` 增加两协议检索/查词和取消回滚的 3 项测试。应用测试使用独立浏览器与合成数据，未刷新用户当前页面。

2026-10-22 集中验收结果：

| 命令 | 结果 | 本地日志 |
| --- | --- | --- |
| `npm run check` | 133/133 单元测试通过；字体、样式、严格类型检查与生产构建通过 | `.local/ask/retrieval/check.log` |
| `npm run test:ask` | 35/35 通过；含 OpenAI Chat、Anthropic Messages、四视口、请求调试及取消回滚 | `.local/ask/retrieval/ask-browser.log` |
| `npm run test:shared` | 13/13 通过；共享词典与补全回归通过 | `.local/ask/retrieval/shared-browser.log` |

三份 L0/L1/L2 文件与开工时留存的用户版本在忽略版本号后逐字一致；版本升为 `c5.w4.m4`；随后用户修订 `view_sheet` 用途说明，当前为 `c6.w4.m4`（见 [提示词分层记录](ask-prompts.md)）。生产构建已更新，构建保留既有的 chunk 大小提示。上述结果只证明模拟接口与本地流程；未执行真实收费生成，不据此评价供应商接入或用户提示词质量。本次未推送或部署。
