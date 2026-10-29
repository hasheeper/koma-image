# ASK 感知与操作 EDIT 工作区实施规划

归档说明：这是本轮获准实施前的规划原文；现行行为见 [NAI 基础感知](../ask/ask-nai-awareness.md)与 [ASK × EDIT](../ask/ask-edit.md)，验证证据另存。原文的“未实施”描述只对应规划时点。

日期：2026-10-29。状态：**规划修订，代码尚未实施**。本文基于已完成的 ID1–ID4 全局图片身份基座，只定义目标、契约、阶段与验收。本次按要求补齐 NAI 基础感知前置项，不表示对应能力已经完成，也不构成推送或部署授权。

现行行为仍以[EDIT 工作区](../edit-workspace.md)、[NAI 官方接入](../novelai-official.md)、[ASK 维护入口](../ask/ask-implementation-plan.md)、[检索与状态](../ask/ask-retrieval-state.md)、[协议与运行契约](../ask/ask-contracts-and-decisions.md)及[外部协同](../ask/bridge.md)为准。后续代码按 **EA0 → EA1 → EA2 → EA3** 推进；完成后将实际行为写回现行专题，并归档本稿。

## 0. 前置：NAI 基础感知（EA0）

先完成 [NAI 基础感知规划](2026-10-29-ask-nai-awareness-plan.md)，在 IMAGE 中验证型号／来源能力、保存值与实际生效值、token／Text 字符预算、只读费用与候选检查，EDIT 再复用同一套计算和校验。不能只在 EDIT 中新增一份 capability 表而继续让 IMAGE 的 ASK 依赖静态常识。

- 每个角色独立计数，基础与所有启用角色按正向／负向分别求和；角色不独享额外配额，停用角色不参与。完整口径与示例见 [EA0 的计数契约](2026-10-29-ask-nai-awareness-plan.md#4-token-与-text-字符计入契约)。
- Variety+、调度、透明底、Medium 固定值及当前参考限制必须在初始状态可见，不能依赖模型碰巧再读取原始画板。
- 费用与 token 使用冻结输入；旧价与未完成计数明确标记。ASK 不触发上游报价、额度刷新或付费编码。
- ID1–ID4 已实现 `#e` 目录、元数据／视觉读取和 `chat_handoff` 携带 `#e` 的基本路径。EA1 扩展现场感知，EA3 完善交接血统与边界，不重新建立图片 ID 或资产保存系统。

---

## 1. 目标与边界

### 1.1 目标

1. 在 `#/edit` 主视图开放 ASK 浮窗，与 HOME、IMAGE、CHAT 共用同一会话、检查点和页面撤销栈。
2. 位于 EDIT 时，`<workspace_state>` 提供活动编辑画板的底图、查看版本、编辑模式、完整表单、当前能力，以及蒙版与聚焦框的几何摘要。模型不需要读取蒙版位图，也能知道涂了哪里、涂了多大。
3. 支持 EDIT 页内草稿：改提示词与角色、切换编辑模式、调整编辑参数、提议聚焦框、预设 Director Tools 面板。
4. 打通双向交接：用 `edit_handoff` 从 HOME、IMAGE、CHAT 把图片送入 EDIT 并预设好模式与参数；完善已有 `chat_handoff` 携带 `#e` 的来源血统与持久引用。

### 1.2 不变的边界

- 草稿只修改编辑画板的表单、模式、聚焦框和工具面板预设，或创建／定位编辑画板。**不触发图生图、重绘、放大、Director Tools、Vibe 编码或任何报价与扣费请求。**
- ASK 不生成、不修改蒙版位图。蒙版仍由用户画笔、文件导入或 Photopea 选区决定。
- 聚焦框遵守现行规则：**不自动识别、不自动扩框、不静默换源**。
- 草稿不切换底图版本，不删除版本，不关闭画板。
- 所有 EDIT 结果留在各自编辑画板，**不自动进入 IMAGE 主历史或分配 `#h`**；可显式收藏或交付 Slate。CHAT 来源仍由用户显式回传原会话。
- Bridge 本轮仍只面向 IMAGE，不接受外部投递的 EDIT 步骤。
- 报价、额度、选源、任务锁、取消、失败不重试，以及 Photopea 分层与蒙版规则全部保持。

---

## 2. 界面与生命周期

### 2.1 入口

- 移除 EDIT 隐藏 ASK 的限制。顶栏右侧常驻 ASK 入口；浮窗、消息流、草稿卡和快捷键（`Tab` 应用、`Esc` 忽略、`⌘Z` 撤销）沿用 [UI 规范](../ask/ask-ui-spec.md)。
- 输入框 `#` 候选在 EDIT 中的排序：当前编辑画板的版本（本板简写）→ 其他编辑画板（完整码）→ `#h` → `#f`。

### 2.2 与 Photopea 互斥

- 打开高级编辑（Photopea）时，若 ASK 浮窗展开，自动收起为顶栏胶囊，并停止页内快捷键拦截。Photopea 内的 `Ctrl+Z`、`Tab` 等按键不被 ASK 捕获。
- ASK 正在流式输出时进入 Photopea：请求继续，胶囊显示运行中状态，不中断。
- Photopea 打开期间，或该画板存在尚未应用的 Photopea 回传时，**禁止应用任何修改该画板的 EDIT 草稿**。草稿保持待审，卡片显示原因；回到 EDIT 主视图后再处理。外部 IMAGE 草稿照常排队。

---

## 3. 状态感知

### 3.1 位于 EDIT 时的完整摘要

`workspace` 取值为 `"edit"`。完整摘要只针对活动编辑画板；其他画板只给目录。没有底图时返回 `ready: false` 与空目录／原因，不伪造 source_version，也不把编辑草稿悄悄改投 IMAGE；下列结构用于有底图的 `ready: true` 状态。`mode` 表示当前编辑目标操作；独立放大面板激活时为 `upscale`，不要求把底层保存的 Img2Img／Inpaint 模式记忆改成放大。

```ts
interface EditStateDigest {
  ready: true;
  active_board_id: string;          // 稳定 ID，草稿以此为目标
  board_seq: number;                // 如 1，对应 #e1.x，本板简写 #ex
  board_name: string;
  base_hash: string;                // 见 §4.2
  mask_revision: number;            // 蒙版修订号，参与 base_hash

  mode: "img2img" | "inpaint" | "upscale";
  inpaint_kind?: "normal" | "focused";   // 仅 mode 为 inpaint 时提供

  source_version: VersionDigest;    // 当前底图
  viewing_version: VersionDigest;   // 当前查看图

  mask: MaskDigest;
  focus_box: FocusBoxDigest;

  form: EditFormDigest;
  director_tool?: DirectorDigest;   // 当前面板配置；open 表示面板是否展开
  capabilities: EditCapabilities;
  effective: NaiEffectiveDigest;    // 复用 EA0，保存值与实际采用值分开
  input_budget: NaiInputBudgetDigest; // 复用 EA0；Upscale 不适用
  cost: NaiCostDigest;              // 当前 mode 的冻结费用；不借用 Director 报价

  versions: VersionDigest[];        // 见 §3.4 截断规则
  versions_truncated?: boolean;
  boards: BoardDirectoryEntry[];
  boards_truncated?: boolean;
}

interface VersionDigest {
  id: string;                       // 完整码 "#e1.3a"
  local_id: string;                 // 本板简写 "#e3a"
  width: number;
  height: number;
  via: "init" | "img2img" | "inpaint" | "focused-inpaint" | "enhance"
     | "upscale" | "photopea" | `director:${string}`;
  variant?: "masked" | "generated" | "blend";
  parent_id?: string;
  origin?: string;                  // 原始出处，如 "#h4"、"#f2"、"#c2.1"
}

interface BoardDirectoryEntry {
  board_id: string;
  board_seq: number;
  name: string;
  latest_id: string;
  version_count: number;
  origin?: string;
}
```

### 3.2 蒙版与聚焦框的几何摘要

```ts
interface MaskDigest {
  has_mask: boolean;
  coverage_ratio?: number;          // 重绘像素 / 全图像素，保留 3 位小数
  bbox?: Rect01;                    // 全部重绘像素的外接框，0–1 归一化
  pixel_bbox?: PixelRect;           // 同一框的源像素坐标
  region_count?: number;            // 连通区域数量
  regions?: Array<{ bbox: Rect01; pixel_bbox: PixelRect; coverage_ratio: number }>; // 最多 3 个，按面积降序
  regions_truncated?: boolean;
}

interface FocusBoxDigest {
  has_box: boolean;
  rect?: Rect01;
  pixel_rect?: PixelRect;
  proc_size?: [number, number];     // 裁切放大后的实际请求尺寸
  contains_mask?: boolean;
  valid?: boolean;
  invalid_reason?: "no_mask" | "mask_outside" | "ratio" | "too_large" | "size";
}

type Rect01 = { x: number; y: number; w: number; h: number };
type PixelRect = { x: number; y: number; width: number; height: number };
```

计算规则：

- 二值化与出站一致：覆盖值大于 32 视为重绘区域。模型看到的范围就是实际会重绘的范围。
- 按 `mask_revision` 缓存，每次修订只计算一次，不在每轮或每次渲染时扫描 Canvas。EDIT 隐藏、原生画布暂停时，读取服务层保存的最近结果。
- 计算放在空闲任务或 Worker 中完成，不阻塞绘制。连通区域可以在缩小网格上计算以控制开销；`bbox`、`pixel_bbox` 与 `coverage_ratio` 按源像素精确给出。
- 摘要不包含任何图片或蒙版的 Base64。

用途示例：用户只在左下角涂了一小块（`pixel_bbox` 约 180×200），却使用普通重绘，且 Prompt 里还有全身远景词。模型能据此建议改用聚焦重绘，并把词改成局部描述。两只手分别涂了蒙版时，`region_count: 2` 和两个区域框能避免模型误以为用户涂了大半张图。

### 3.3 能力摘要

```ts
interface EditCapabilities extends NaiCapabilitiesDigest {
  modes: Array<"img2img" | "inpaint" | "upscale">;  // 当前来源与型号实际可执行的模式
  inpaint_kinds: Array<"normal" | "focused">;
  models: { img2img: string[]; inpaint: string[] }; // 可选型号 ID
  enhance_scales: Array<1 | 1.5 | 2 | "max">; // 与现有 EnhanceScale 一致
  director_tools: boolean;          // 已加载的官方来源确实提供该工具，不只看配置是否存在
  upscale_kinds: Array<"native" | "external">;
  source_editable: boolean;         // 是否满足当前来源与目标操作的输入条件
  source_issues: Array<"alignment" | "area" | "file_size">;
}
```

通用的 `NaiCapabilitiesDigest`、`NaiEffectiveDigest`、`NaiInputBudgetDigest`、`NaiCostDigest` 按 [EA0](2026-10-29-ask-nai-awareness-plan.md)维护，包含当前型号／来源、参数范围与固定值、Variety+、参考互斥规则、token 和费用状态。此处只定义 EDIT 增量，不复制数值规则。

能力摘要与校验器使用同一份能力判定，避免模型提议 V5 Curated 重绘、标准网关下的聚焦重绘或没有可用官方来源时的 Director Tools。参考的 supported_kinds 与 active_kind 分开；V4.5 Img2Img 支持两种但不能同时启用，Inpaint 仅 Precise。64 对齐／3,145,728 像素是官方普通编辑规则，8MB 是 Koma 产品限制；放大、Director 和其他来源按自身规则判断，不共用一个普通重绘判定。

### 3.4 表单、目录与截断

```ts
interface EditFormDigest {
  model: string;
  naiMode: "anime" | "furry";
  effort?: "high" | "medium";
  strength?: number;                // 当前模式保存值；upscale 不提供
  noise?: number;                   // 仅 img2img
  enhance?: {
    enabled: boolean;
    scale: 1 | 1.5 | 2 | "max";
    magnitude: 1 | 2 | 3 | 4 | 5 | "custom";
    target_size?: [number, number];
  };
  upscale?: { kind: "native" | "external"; target_size?: [number, number] };
  scale: number;                    // Guidance
  cfgRescale: number;
  varietyPlus?: boolean;
  steps: number;
  sampler: string;
  noiseSchedule?: string;
  seed: string;                     // 字符串，空串为随机
  complexity?: string;
  qualityPreset: string;
  negativePreset: string;
  transparentBg?: boolean;
  prompt: string;
  negative: string;
  characters: Array<{ id: string; on: boolean; prompt: string; negative: string; position?: unknown }>;
  locked_fields?: string[];         // Medium 等固定的字段
  references_summary?: { mode: "none" | "vibe" | "precise"; active_count: number };
}
```

- `form` 保留用户可恢复的原文和配置；当前模式的实际输入以 `effective` 为准。Medium 的原有步数／采样器／负向不能冒充生效值。放大不发送不适用的生成字段；表单实现应按 mode 分型。
- `effort` 是型号 ID 的只读派生展示；切换 High／Medium 必须解析到真实可用的型号。Enhance 倍率采用数字 `1 / 1.5 / 2` 或字符串 `max`，不另建字符串倍率约定。
- Director 配置独立于左侧生成型号。`DirectorDigest` 提供工具、open、该工具适用参数与处理尺寸，并独立附 `cost: NaiCostDigest`；不把 Director 的费用或输入规则混入当前生成表单预算。
- 活动画板的 `versions` 列出原图、当前底图、当前查看版本，以及最近 12 个版本；超出时 `versions_truncated: true`。去背景 a/b/c 成组保留，明确每板上限为 30 张物理图片，不是 30 次三图操作。
- `boards` 最多列 8 个，按最近活动排序；超出时标记截断。
- 需要非活动画板的完整表单或全部版本时，调用 `get_state({ edit_board_id })`。

### 3.5 不在 EDIT 时

位于 HOME、IMAGE、CHAT 时，`<workspace_state>.edit` 保持 ID3 的轻量目录：活动编辑画板的稳定 ID、板号、名称、版本索引和画板目录，不展开表单、蒙版摘要或能力摘要。模型需要时调用 `get_state({ edit_board_id })`。

### 3.6 只读工具

- `view_image`、`view_sheet`、`crop` 支持 `#e` 完整码与本板简写，读取版本原图。查看蒙版区域时，可以把 `mask.pixel_bbox` 换算为 crop 范围。crop 仍要求已看过同一实体的全图，并照常计入视觉预算。
- `get_meta` 读取版本的真实操作快照：`via`、强度与噪声、Enhance 倍率与档位、`inpaintFocus`、Director 工具参数或 `sourceRecipe`。手动版本不伪造生成参数。
- `diff_meta` 支持同板版本之间，以及版本与原始出处之间的对比，例如 `diff_meta("#e1", "#e2")`、`diff_meta("#h4", "#e1.2")`。
- `get_state({ edit_board_id })` 默认 `scope: "initial"`；与 IMAGE 的 `board_id` 互斥。`scope: "latest"` 只用于确认外部最新改动，不改变本轮草稿基底。
- EA0 的 `check_nai_input` 在 EA1 可检查冻结的当前 EDIT 输入，EA2 才接受 EDIT 候选步骤。计数与费用独立于画布是否挂载，不通过触发 EDIT 的 payload／报价准备来获取。

---

## 4. 草稿目标与冻结

### 4.1 默认目标

- 在 EDIT 中提问时，草稿默认靶向**活动编辑画板**。用户说“把提示词改成夜景”，修改的是编辑画板的 Prompt。
- 要修改 IMAGE 画板，必须显式使用 `image.*` 靶点。
- 同一份草稿中，`image.*` 与 `edit.*` 不能同时出现；两者都可以与 `slate_edit`、`save_ref` 组合。
- 解析时一次性确定目标工作区和稳定画板 ID，通用的 params_patch／character_edit／restore_partial 跟随同稿目标；纯参数草稿在 EDIT 中默认归 EDIT。IMAGE 文本靶点显式出现时，同稿通用步骤归 IMAGE；目标互相矛盾时拒绝，不按应用时所在页面推断。配方 capture_current／save_ref 同样读取该目标的最终候选配置，不能退回隐藏的 IMAGE 表单。
- 在 HOME、IMAGE、CHAT 中，`edit.*` 页内步骤不可用；如需修改编辑画板，使用 `edit_handoff`。

### 4.2 EDIT 的 `base_hash`

由以下内容计算：画板稳定 ID、底图版本 ID、`mode` 与 `inpaint_kind`、正负词与角色、当前模式的编辑参数、Enhance 与放大配置、聚焦框、Director 面板配置、`mask_revision`。

`mask_revision` 只使用修订号，不哈希位图。费用、账户、token 计算状态不进入此 hash；能力和计数另按 EA0 的输入／来源修订绑定，确认时再校验，避免刷新费用导致无关草稿冲突。

### 4.3 冻结与阻止条件

- 草稿冻结到画板稳定 ID，不使用 `board_seq` 或“当前活动板”。审阅期间切换画板，应用仍写回原画板；卡片标明目标画板名称。
- 应用时重新计算 `base_hash`。字段级冲突沿用现有冲突行处理；蒙版修订变化后，必须重新执行聚焦框包含校验。
- 以下情况阻止应用，草稿保持待审，卡片显示原因：
  - 目标画板已关闭（显示为无效，不写入其他画板）；
  - 该画板正处于生成准备阶段（快照冻结期间）；
  - 该画板的 Photopea 已打开，或存在未应用的回传。
- 已提交的生成不受影响。提交后修改表单是允许的，不改变已发出的请求。

### 4.4 撤销

EDIT 草稿的应用、回退与恢复纳入页面统一撤销栈。快照包含：表单、模式与重绘类型、各模式的强度与噪声、Enhance 配置、聚焦框（含“原本没有框”）、Director 面板配置。

草稿从不修改蒙版，撤销也不涉及蒙版。回退时如果目标画板已关闭，显示“无法回退”，不报错，也不写入其他画板。

### 4.5 专用草稿写入路径

现有 EDIT 的 patch／setMode／setFocus／setEnhance 等 UI 操作会调度报价，部分操作还会把查看图切成底图；不得逐个调用它们来实现上述草稿。

新增按稳定画板 ID 写入的服务层专用入口，共用纯校验和候选状态计算，一次提交字段变更与撤销快照，不调用 requote／refreshQuota／selectSource，不移动底图、查看版本或 Photopea 文档。旧费用作废但不主动刷新；用户后续显式操作时恢复既有报价／执行路径。应用、撤销、恢复、edit_handoff 及其组合步骤都遵守这一边界；后台在途请求继续使用原冻结快照。

---

## 5. EDIT 页内草稿步骤

### 5.1 步骤一览

| 步骤 | 靶点与字段 | 校验与应用 |
| --- | --- | --- |
| `prompt_patch` | `edit.prompt`、`edit.negative`、`edit.char.<id>.prompt`、`edit.char.<id>.negative` | 沿用 `replace`／`before`／`after`／`append`／`rewrite` 与唯一锚点规则；放大模式下拒绝；Medium 下拒绝负向靶点 |
| `character_edit` | 活动编辑画板的 `characters[]` | 增删、排序、启停、正负词、定位；按当前型号的角色上限与定位方式校验；放大模式下拒绝 |
| `params_patch` | 见 §5.2 | 按目标模式和能力摘要校验 |
| `director_patch` | 见 §5.3 | 校验枚举与范围；需要官方连接 |
| `restore_partial` | 从本轮冻结的 `#h`／`#f`／`#e` 恢复词段、参数或角色 | 沿用现有勾选与回退；只恢复当前模式适用的字段 |

### 5.2 `params_patch` 在 EDIT 下的字段

```ts
interface EditParamsPatch {
  editMode?: "img2img" | "inpaint" | "upscale";
  inpaintKind?: "normal" | "focused";
  model?: string;
  naiMode?: "anime" | "furry";
  effort?: "high" | "medium";
  strength?: number;
  noise?: number;
  enhance?: {
    enabled?: boolean;
    scale?: 1 | 1.5 | 2 | "max";
    magnitude?: 1 | 2 | 3 | 4 | 5;
  };
  upscaleKind?: "native" | "external";
  scale?: number;
  cfgRescale?: number;
  varietyPlus?: boolean;
  steps?: number;
  sampler?: string;
  noiseSchedule?: string;
  seed?: string;
  complexity?: string;
  qualityPreset?: string;
  negativePreset?: string;
  transparentBg?: boolean;
  focusRect?: Rect01 | null;        // null 表示清除聚焦框
}
```

参数归属：

- 强度和噪声按模式分别记忆。同一份草稿中切换了 `editMode` 时，`strength`／`noise` 写入目标模式；没有切换时，写入当前模式。
- NovelAI 官方 Img2Img：强度 0.01–0.99，噪声 0–0.99；官方重绘：强度 0.01–1，不接受噪声。其他来源使用其当前能力范围，不套用官方限制。
- 最终为 Img2Img 且开启 Enhance 时，strength／noise 属于 Enhance 配置，与普通 Img2Img 的记忆值分开；自定义数值使档位变为 custom。若同稿指定 magnitude 和不一致的强度／噪声则报冲突，不静默选一方。
- `enhance` 只属于 Img2Img。目标模式是重绘时，按现行“保留设置但不生效”的规则写入，并在卡片上注明。开启 Enhance 时，执行时会冻结新的随机 Seed；若同稿修改了 `seed`，卡片注明“增强执行时不使用此 Seed”。
- `enhance.scale: "max"` 只在能力摘要包含 `max` 时允许。
- `varietyPlus` 只在能力摘要允许时可写。
- Medium 锁定的字段（步数、采样器、负向、Rescale）拒绝写入，不能写进去再被请求层吞掉。
- 放大模式只接受 `upscaleKind`，拒绝提示词、Seed、Guidance 等生成参数。
- `model` 必须在当前模式的可选型号中；不存在 V5 Curated 与重绘的组合，也不静默换成 V4.5。
- `effort` 是 High／Medium 型号切换的便捷输入，只用于 V5 Full；解析后只保存一个规范型号 ID。与显式 model 冲突或目标型号没有来源时拒绝。
- `editMode`／`inpaintKind` 必须在能力摘要中。

聚焦框（`focusRect`）：

- 只在目标为聚焦重绘时接受。
- 换算为源像素后，只做确定性规整：对齐 8px、最小 8×8、限制在底图内。规整后若与原值差异超过 8px，卡片显示实际像素范围。
- **必须完整包含当前蒙版的 `pixel_bbox`**。不包含时，校验报冲突，不扩框。
- 比例过于狭长或处理尺寸超限时，同样报冲突，提示重新框选。
- 当前没有蒙版时可以设置框，卡片注明“请在框内涂抹蒙版”；执行时的既有校验（空蒙版、框外覆盖）照常生效。
- 应用前按最新 `mask_revision` 重新检查包含关系。

### 5.3 `director_patch`

```ts
interface DirectorPatchStep {
  kind: "director_patch";
  tool: "bg-removal" | "lineart" | "sketch" | "colorize" | "emotion" | "declutter";
  emotion?: string;                 // 仅 emotion：24 种官方枚举之一
  defry?: 0 | 1 | 2 | 3 | 4 | 5;    // 仅 colorize / emotion；0 最强，5 最弱
  prompt?: string;                  // 仅 colorize / emotion，英文补充描述
}
```

- 能力摘要中 `director_tools` 为 `false` 时拒绝。
- 用户应用后，配置保存到该画板，并展开魔棒面板选中对应工具，等待用户点击执行；应用不触发报价、额度刷新或工具请求，不增加付费确认弹窗。费用读取和失效遵守 EA0 与 §4.5。
- 面板沿用现行互斥规则：进入 Photopea、切页、换板时关闭；配置保留。

### 5.4 卡片展示

沿用现有草稿卡，不新增面板。

- 标题下方显示目标：`编辑画板 · 名称 · #e1`。
- 参数行沿用前后对比；模式切换显示为 `图生图 → 聚焦重绘`。
- 聚焦框显示一行：`聚焦框 312, 480 · 384×448`。冲突时用现有冲突样式说明原因。
- Director 预设显示一行：`表情 smug · 弱 · subtle cold smirk`。

---

## 6. 跨工作区交接

### 6.1 `edit_handoff`：把图片送入 EDIT

```ts
interface EditHandoffStep {
  kind: "edit_handoff";
  image: string;                    // #h / #f / #c / #e，不接受 #a
  mode?: "img2img" | "inpaint" | "upscale";
  inpaint_kind?: "normal" | "focused";
  prompt?: string;                  // 省略则继承来源配方
  negative?: string;
  params?: Omit<EditParamsPatch, "editMode" | "inpaintKind" | "focusRect">;
  focus_rect?: Rect01;              // 仅聚焦重绘
  director_tool?: Omit<DirectorPatchStep, "kind">;
}
```

规则：

- 在 HOME、IMAGE、CHAT 中可用；在 EDIT 中可用于把另一画板的版本或其他来源送入（目标可以是另一个编辑画板）。
- 每份草稿只能有一个 `edit_handoff`，且是唯一的画面操作步骤；可以与 `slate_edit` 同稿。
- 来源按本轮冻结的引用解析。`#h`／`#e` 所属页面作用域失效时返回不可用，不改认成新页面的同号图片。
- 校验基于来源图片尺寸和目标型号能力：
  - 来源不满足编辑条件（64 对齐、3,145,728 像素、8MB）而目标模式需要这些条件时，卡片提示“该图尺寸需先调整”，可以创建画板，但不静默缩放；
  - Max Enhance 输出的非对齐尺寸、CHAT 的非对齐尺寸属于这种情况。
- `focus_rect` 按 §5.2 规整。新建画板没有蒙版，包含校验推迟到执行时；复用的画板若已有蒙版，应用时校验包含关系。

应用：

1. 按来源身份定位已有编辑画板；没有则新建，继承实际存在的来源配方、角色与参考配置，再覆盖本步骤指定的字段。CHAT／上传图片没有 NAI 配方时使用明确的默认配置，不伪造原生成参数。
2. **复用已有画板时**，卡片显示与该画板当前状态的 Diff，并标注“修改已有编辑画板 · 名称”。
3. 使用 §4.5 的专用路径，不自动跳转、不报价、不生成。复用已有画板时不因来源图片不同而切换其底图；卡片显示该板实际底图供确认。卡片和完成检查点提供「去编辑」，点击后进入 `#/edit` 并切到该画板。
4. 结果留在 EDIT，不自动进入 `#h`；CHAT 来源的编辑结果显式回传原会话。

撤销：

- 新建的画板如果仍是初始状态（没有新版本、没有蒙版、没有 Photopea 文档），撤销时连同画板一起移除。
- 新建画板已经产生版本、画了蒙版或打开过 Photopea：撤销只恢复本步骤写入的表单与预设，不删除画板。
- 复用的画板：撤销恢复本步骤写入前的字段快照。
- 目标画板已关闭：显示“无法回退”。

### 6.2 完善已有 `chat_handoff` 携带 `#e` 的链路

- 当前 images 已允许 `#h`／`#f`／`#c`／`#e`，仍排除 `#a`，遵守 `max_images`。当前确认写入器也已读取 EDIT 原图，经既有 CHAT 资产路径持久保存；不新增第二套上传与资产库。
- `#e` 只在本页存活，而 CHAT 会话持久保存。本阶段补齐来源记录／实体／作用域血统和刷新验收：原字节直接保存时共享 entity_key；若既有 fitReference 因大小／像素限制转换了图片，必须按实际存储字节生成新实体键并记录派生关系，不能强行沿用原键。来源短码仅作历史说明，不在刷新后重新解析旧号。
- 沿用现有 chat_handoff 的新开／复用空白会话、定位 CHAT、确认与撤销行为，不把 edit_handoff 的“不自动跳转”扩散为对已有 CHAT 行为的更改。
- 尺寸只能填写 `chat_model.writable` 中出现的键和值。需要正方形输出时，选择其中可用的正方形尺寸；没有正方形选项时不提交尺寸，在回复中说明。
- 典型用途：用户在 Photopea 中把立绘裁成正方形面部特写 `#e1.2`，再交给 CHAT 生成 3×3 或 4×4 表情差分。

---

## 7. Bridge 与外部 Agent

- 本轮 Bridge 仍只面向 IMAGE。外部投递中出现 `edit.*` 靶点、`director_patch`、`edit_handoff` 时返回 `invalid`，说明“外部协同暂不支持 EDIT 草稿”。
- `state.live.json` 保持 ID3 的只读 `#e` 索引，不增加蒙版摘要、能力摘要或 EDIT 表单。
- 外部 IMAGE 草稿的 `chat_handoff` 不在 Bridge 范围内，规则不变。
- 生成的 `PROTOCOL.md` 和公开 `SKILL.md` 只补充 `#e` 只读引用的格式说明，并写明 EDIT 草稿不对外开放。

---

## 8. 提示词同步

### 8.1 `workspaces.ts`

EA0 先同步基础状态与检查工具说明；EA1–EA3 按实际开放的能力增补版本，EA2 前不能提前宣称 EDIT 可写。全部接通后的 EDIT 小节目标如下：

```text
### 4. EDIT 精修工作区
- 独立工作区（#/edit），可有多个编辑画板。版本编号为 #e<板号>.<版本号>，如 #e1.2；当前画板内可简写为 #e2。去背景一次产出三张图，用字母区分：#e3a 抠图、#e3b 重建、#e3c 混合。
- 位于 EDIT 时，<workspace_state>.edit 提供底图、查看图、模式（img2img / inpaint，inpaint 分 normal 与 focused / upscale）、当前表单、可用能力，以及蒙版和聚焦框的几何摘要（覆盖率、外接框的归一化与像素坐标、连通区域数量）。提议前先看 capabilities，不提议当前型号或来源做不到的操作。
- effective 表示实际生效配置，input_budget 给出基础与启用角色的正向／负向合计和上限，cost 区分估算／报价／未知。单角色没有独立额外额度；候选改词用 check_nai_input 本地检查，不自行猜 token 或触发报价。
- 判断局部重绘：重绘区域的像素尺寸远小于约 1MP（如单只手、脸部、小配饰）时，普通重绘的有效分辨率偏低，且容易被全身或远景词干扰；可以建议改用聚焦重绘，并把提示词改为该局部的描述，必要时停用框外的角色。
- 位于 EDIT 时，草稿默认修改活动编辑画板：prompt_patch 靶向 edit.prompt、edit.negative、edit.char.<id>.prompt；params_patch 可改 editMode、inpaintKind、strength、noise、enhance、varietyPlus 等，并可用 focusRect 提议聚焦框（0–1 坐标，必须完整包含当前蒙版，系统不会自动扩大）；director_patch 预设去背景、线稿、草图、上色、表情、去杂物的面板参数。要修改 IMAGE 画板须显式用 image.* 靶点，且不能与 edit.* 同稿。
- 强度与噪声按模式分别保存；放大模式没有提示词与生成参数；Medium 的步数、采样器与负向固定。
- 你不能修改蒙版，也不能切换底图版本；需要时提醒用户在画布或版本栏操作。复杂拼贴、液化、裁切或精确选区，建议用户使用「高级编辑」（Photopea）。
- 在 HOME、IMAGE、CHAT 中，可用 edit_handoff 把 #h、#f、#c、#e 图片送入 EDIT，并预设模式、局部提示词、参数、聚焦框或 Director 工具；确认后用户点击「去编辑」进入。chat_handoff 的 images 可以包含 #e 图片。
- 所有 EDIT 草稿只准备表单与面板，生成和工具执行由用户点击完成。
```

### 8.2 `models.ts`／`manuals.ts`：表情差分

现有维护入口是 `src/ask/prompts/models.ts` 和 `manuals.ts`，不新增不存在的 engine-chat.ts。下面是保留的创作建议方向，实施时按实际效果验证，不将某种网格更稳定写成接口保证；产品能力、尺寸选项和交接行为以动态状态为准。

```text
### 表情差分矩阵
- 用自回归图像模型制作同一角色的多表情差分时，单图或 2×2 四宫格留给模型的自由度过大，画风和脸型容易漂移。使用 3×3 或 4×4 的等大网格更稳定：面部细节多（复杂头饰、瞳孔纹样、精细笔触）用 3×3，常规面部用 4×4。
- 参考图应为角色平静表情的面部正方形特写，排除身体和大面积背景。如果用户手上只有全身或半身立绘，建议用户先在 EDIT 的高级编辑中裁成正方形，再用 chat_handoff 带入；你不能代为裁图。
- 输出尺寸选择 writable 中可用的正方形选项；没有正方形选项时，在回复中说明，网格可能被拉伸。
- 提示词写明：网格规格、等大无文字编号；保持参考图的画风、上色、线条、头饰、头部大小与朝向、光照方向不变，只改变眉、眼、嘴与脸颊红晕；再按行逐格列出该角色的表情。
- 夸张的动漫表情（蚊香眼、黑线阴影、猫嘴等）直接描述画面上的符号形态，或请用户附一张表情参考图。微醺、害羞、喘息等细腻状态，拆解为眉眼开合、视线、红晕范围、汗珠等具体描写。
```

---

## 9. 分阶段实施

| 阶段 | 范围 | 主要落点 | 收口条件 |
| --- | --- | --- | --- |
| EA0：NAI 基础感知 | 共用能力、生效值、角色 token 合计／Text、只读费用、候选检查、元数据及提示词事实；详见 [EA0](2026-10-29-ask-nai-awareness-plan.md) | `domain/nai*.ts`、`native/nai-tokenizer.ts`、共享快照服务、`ask/digest/`、`ask/tools.ts`、`ask/library.ts`、`ask/prompts/` | IMAGE 的状态／工具／校验与生成口径一致，读取和草稿不触发上游费用请求；再进入 EA1 |
| EA1：开放入口与状态感知 | EDIT 内显示 ASK；Photopea 收起与按键隔离；复用 EA0，增加表单、蒙版修订／几何摘要、截断；扩展已有 `#e` 读取与候选排序 | `workspaces/edit/EditWorkspace.vue`、`services/editor.ts`、`native/mask-editor.ts`、`ask/digest/`、`ask/tools.ts`、`ask/AskComposer.vue` | 摘要与实际输入一致；不含图片数据；EDIT 隐藏时可读；Photopea 按键不被拦截；不开放 EDIT 草稿 |
| EA2：页内草稿与撤销 | 默认目标、EDIT hash、`edit.*`、编辑参数／聚焦框／Director；专用无报价写入、候选检查、阻止条件及撤销 | `ask/draft/types.ts`、`tool.ts`、`validate.ts`、`view.ts`、`apply.ts`、`stack.ts`、`DraftCard.vue`、`services/editor.ts` | 应用、冲突、撤销正确；不扩框、不改蒙版／底图；无报价／额度／生成请求；不污染 IMAGE |
| EA3：交接与提示词 | 新增 `edit_handoff`；完善已有 `#e → CHAT` 的血统、字节转换与刷新边界；Bridge 拒绝 EDIT 步骤；同步文档 | `ask/draft/`、`services/chat.ts`、`services/assets.ts`、`bridge/`、`ask/prompts/workspaces.ts`、`models.ts`／`manuals.ts`、公开技能说明 | edit_handoff 不跳转；chat_handoff 沿用既有导航；均不生成／报价；CHAT 参考持久可读；外部 EDIT 步骤被拒 |

阶段是依赖顺序，不代表分别上线。EA0 完成前不开始 EDIT 接入；EA2 完成前，EDIT 内 ASK 只能读状态和看图，回复中不提议 EDIT 草稿。本次只更新规划与文档入口，不改运行代码。

---

## 10. 必验矩阵

| 验收项 | 预期 |
| --- | --- |
| EA0 前置 | 基础能力、token／Text 合计、Medium、生效值与只读费用验收全部通过；EDIT 复用同一实现 |
| 空编辑页 | ready 为 false，不编造底图／预算，不将 EDIT 草稿改投 IMAGE；可提示用户先导入或交接图片 |
| 几何摘要 | 涂一块蒙版后，覆盖率、外接框与像素框和出站蒙版一致；两只手分别涂抹时 `region_count` 为 2 并给出两个区域；摘要不含 Base64 |
| 缓存 | 不改蒙版时连续多轮提问不重复扫描；改一笔后修订号与摘要更新 |
| 能力摘要 | V5 Curated 不出现在重绘型号中；无官方连接时 `director_tools` 为 false；Max 仅在 V5 且底图面积符合时出现 |
| 默认目标 | EDIT 中“改提示词”修改编辑画板；IMAGE 画板不变；`image.*` 与 `edit.*` 同稿被拒绝 |
| 按模式归属 | 同稿切到重绘并设强度 1.0 写入重绘；Img2Img 强度保持原值；重绘下的噪声被拒绝 |
| Enhance 参数 | 开启后自定义强度写 Enhance，不覆盖普通 Img2Img；倍率与 Effort 解析一致，冲突不静默覆盖 |
| 无效字段 | 放大模式下改提示词被拒；Medium 下改步数被拒；不支持的型号与模式组合被拒 |
| 聚焦框 | 合法框按 8px 规整；未包含蒙版时报冲突且不扩框；提议后用户补涂超出框外，应用时报冲突 |
| Director | 应用 `director_patch` 后面板展开并填好表情与强度，未发出请求；撤销后恢复原配置 |
| 冻结 | 审阅期间切换画板，应用写回原画板；目标画板关闭后应用显示无效、回退显示无法回退 |
| 阻止条件 | 生成准备期间、Photopea 打开或存在未应用回传时，应用被阻止，草稿保持待审 |
| 撤销 | 应用含模式、强度、聚焦框、Director 预设的草稿后，`⌘Z` 全部恢复，蒙版不变 |
| 写入副作用 | 应用／撤销／恢复不请求报价、额度、编码或生成；底图不因模式／Enhance 切换而改变；旧价失效 |
| 交接：新建 | IMAGE 中对 `#h1` 应用 `edit_handoff`（聚焦重绘）：不跳转、不请求；「去编辑」进入已预设的画板 |
| 交接：复用 | 对已有画板的来源再次交接，卡片显示与现状的 Diff；撤销恢复原字段 |
| 交接：撤销 | 新建后未操作，撤销移除画板；生成过版本后撤销，只恢复字段，画板保留 |
| 交接：尺寸 | 非 64 对齐来源交接到重绘，卡片提示需先调整尺寸，不缩放 |
| 交接：失效 | 刷新前的 `#h` 作为来源返回不可用，不指向新页面的同号图片 |
| CHAT 携带 `#e` | 复用既有交接；刷新后参考图可读；未转换字节共享实体，转换后新键并保留来源；尺寸只使用 writable |
| 结果归属 | 所有编辑结果留在 EDIT，不自动注册 #h；CHAT 来源仍显式回传原会话 |
| Bridge | 外部投递 `edit.*`、`director_patch`、`edit_handoff` 返回 `invalid`；IMAGE 草稿行为不变 |
| Photopea | 打开时 ASK 收起，流式输出不中断；Photopea 内 `Ctrl+Z`、`Tab` 正常 |
| 视觉 | 对 `#e1.2` 查看全图后，按蒙版像素框 crop 通过并计入预算；仅元数据模式不发图 |
| 界面 | 320／390／768／1440px 下浮窗、胶囊、草稿卡无溢出；不泄漏监听、URL 或缓存 |

最终执行 `npm run check` 以及受影响的 ASK、EDIT、CHAT、Bridge、HOME 浏览器回归。只使用合成图片与模拟服务，不执行真实收费生成。

---

## 11. 本轮不包含

- 蒙版叠加的视觉查看（例如 `view_image("#e1", overlay: "mask")` 在本地合成半透明蒙版预览）。对视觉较弱的模型有帮助，但会改变视觉预算口径，另行设计。
- ASK 生成或修改蒙版、切换底图版本、裁切图片。
- 外部 Agent 提交 EDIT 草稿。
- 自动执行生成、Director Tools 或放大，自动重试，自动跳转。
- EDIT 跨刷新恢复、PSD 持久化。

---

## 12. 审阅要点

以下默认选择随本稿一并审阅：

1. 位于 EDIT 时草稿默认靶向活动编辑画板，`image.*` 与 `edit.*` 不同稿。
2. 聚焦框必须由提议方给出完整包含蒙版的范围，系统只做 8px 规整，不扩框。
3. 首版不允许草稿切换底图版本。
4. `edit_handoff` 新建的画板在有后续操作后，撤销不删除画板。
5. 完善已有 `chat_handoff` 携带 `#e` 的资产链路，转换字节时创建新实体并保存来源。
6. Bridge 本轮不开放 EDIT 草稿。
7. 活动画板版本列表截断为原图、底图、查看版本加最近 12 个。
8. EA0 先在 IMAGE 收口，角色共用方向预算，费用只读／本地估算；EDIT 共用同一份基础能力。
9. EDIT 草稿使用专用无报价写入，切换模式不隐式切底图，所有结果继续留在 EDIT。

实施完成后同步[EDIT 工作区](../edit-workspace.md)、[HOME](../koma-home.md)、[对话工作区](../chat-workspace.md)、[ASK 维护入口](../ask/ask-implementation-plan.md)、[检索与状态](../ask/ask-retrieval-state.md)、[协议与运行契约](../ask/ask-contracts-and-decisions.md)、[UI 规范](../ask/ask-ui-spec.md)、[提示词维护](../ask/ask-prompts.md)、[外部协同](../ask/bridge.md)及公开技能说明。规划阶段仅补当前缺口和规划链接，不把目标写成现行能力。
