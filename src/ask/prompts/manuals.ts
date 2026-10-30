/** Local field guides. Engine facts and suggested experiments are kept distinct. */
export const manuals = {
  "nai5-prompting": {
    title: "NAI 混排、权重、构图与多人排错",
    body: `适用：NovelAI Diffusion V4.5 / V5。以下为适配 Koma 工作台的提示词组织、构图与排错方法；字段分工是写作约定，不是引擎硬限制，具体效果仍需看图验证。已有原串局改保留原有分工，实际能力与生效参数以工作台状态为准。

## 字段分工与混排结构
- 主提示词（Base Prompt）：按「人数与主体锚 → 持握与遮挡实体 → 单人姿势/表情/视线 → 镜头与机位 → 场景与光影 → 空间/接触/动态关系句 → 本图负权重排除项 → 画风/画师串」组织，用空行分段；已有 fur dataset / background dataset 前缀仍留在首位。用户已有的画风/画师串逐字保留顺序、权重与年份；局部修改只动目标范围，不顺手重排或增删无关词。
- 角色栏（Characters）：普通有人插画每人一栏，以不带数字的 girl / boy / other 开头（人数 tag 如 1girl、2girls 在主提示词前部只计一次；solo 仅配单人无动物画面，多人聚焦一人可用 solo focus）。无人场景不为模板补角色栏。
  - 原创角色（OC）：完整保留发型、发色、瞳色、种族体征（耳朵/角/尾巴/翅膀）、体型、服装与标志饰品锚点，不为压短而删减辨识特征。
  - 具名版权角色：写 Danbooru 实际收录的规范英文/罗马音名称及必要的作品消歧（如 girl, hanami saki 或 girl, archetto (arknights)），不按统一姓名称序改造标准名；拿不准时用 search_tags 核验，未收录不编造标准 tag。常规外观可由名称触发，不凭印象默写默认设定；用户已有的外貌锚点及指定的换装、配饰或改动仍逐项保留。
- 词组与句子分工：离散事实（人数、机位高低如 from below/from above、景别如 cowboy shot/upper body、基础坐立姿势）用词组；空间层次（谁占画幅多大、近大远小透视对比）、动作冻结瞬间（将起/进行中/接触承重/衣发随风响应）、多光源方向与道具归属用自然语言短句。叙事句绝不包双引号。

## 权重、文字与预设冲突
- 权重语法：W::text:: 为数值权重，末尾用 :: 闭合（漏写 :: 会作用到整条提示词结尾）。旧括号换算时，每层 {} 乘 1.05（一层 1.05，两层 1.1025），每层 [] 除以 1.05（约 0.952），保留原有作用范围，不因换算另选强度。新写内容默认不加权，已有权重照留，需要调强弱时每次只微调少量权重。
- 数字结尾标签防崩：画师名或标签以数字结尾且紧跟 :: 时（如 na_tarapisu153:: 或 aki99::），数字可能被误作权重；在名称后加英文逗号隔开（写成 na_tarapisu153, ::），避免异常高权重。不把所有糊图都归因于此。
- 画中文字与质量预设冲突：用双引号标明准确原文并写清载体、位置与样式（如 A speech bubble beside her head reads "Hello!"）。Koma 不会像官网一样自动从引号生成 Text: 块；写入时须显式准备对应字段末尾的 Text: 文字段，后面不再追加画师、质量词或叙事句。基础与启用角色共享 Text 字符预算，精确计数读 input_budget 或 check_nai_input。先查实际生效值：质量预设含 no text 且本图要画字时，草稿将 qualityPreset 设为 "none"；手写 no text 也需核对冲突。Koma 的质量预设默认关闭，不假定它开着，也不自动补一组质量词。
- 排除项与负面预设：本图特定不想要的元素优先在主串画面内容末尾另起一行写正词负权重（如 -1::hat::，白底虚空用 -1::simple background::，缺色用 -1::monochrome::），不往通用 Negative 里堆。多人图或分格图若手写负面词中含有单人模板的 extra characters，必须将其删去以免与多人数词冲突。
- V5 Full Medium 档位：固定 14 步、Euler Ancestral 与 Heavy 负向，不支持自定义 Negative 与 Rescale；需排除元素时一律在正向主串末尾使用负权重。
- V5 专有标签：low/medium/high/ultra complexity 会改变画面复杂度与画风，按需选用不默认堆叠，不与 Medium/High Effort 档位混淆；depthness 用于明暗纵深，attractive male 按主体需要选用；transparent background 表达透明背景，has alpha 表达使用 Alpha 通道，alpha transparency 表达场景内物体的 Alpha 半透明效果（普通带背景插画画透明伞可用 transparent umbrella）。生成后检查真实 Alpha，不把画出的棋盘格当透明。

## 多人交互与防串味
- 两人以上时，不要把各人的动作、姿势、表情和视线词混堆在主串前两行。有两种可选组织方式：
  1. 主串末尾按人分行：在主串画面内容后空一行，从左往右编号写 Character 1: girl, source#动作, 姿势, 表情, 视线, 与 Character 2: ...；角色栏只保留性别、外貌和服装。
  2. 动作并入角色栏（适合配合 Koma 角色坐标定位，或在多人动作发生错配时使用）：各人的角色栏在前两行写完性别外貌与服装后，第三行写该角色的 source#/target#/mutual# 动作、表情与视线（此时看向对方可写 looking at target）。
  官方施受前缀示例放在角色栏；写在主串 Character N: 行是原资料的组织经验，不保证前缀生效。这些文本编号不会创建或寻址 Koma 角色，草稿仍使用状态中的稳定角色 ID；不为重新编号改动已有角色顺序。
- 施受方向前缀：使用 source#动作（发起方）、target#动作（承受方，须用同一个动作 tag）与 mutual#动作（双方互做，如 mutual#holding hands、mutual#eye contact）。一人可同时挂两个方向以表达 A→B→C 链式交互（如 Character 2 写 target#headpat, source#hug）；target# 只说明动作方向，不代表表情、气势或构图上的被动。找不到现成动作 tag 时不自造前缀词，改用主串英文句子写清；只是同屏、没有互动时不强凑前缀。相同姿势配 imitate pose 属于 V4.5 经验，V5 效果待验证。
- 英文关系句主语：主串用一两句写清从看画人视角谁在左右、谁对谁做什么，以及已定的接触部位与持物归属（如 The microphone belongs only to the girl on the left.）。用位置加简短外观锚点（如 the girl with a short black bob on the left）代替未建立指认的 Character 1 / Character 2 或角色真名；不在实际提示词中给整句叙述套双引号。
- Cosplay 同点位技巧（A cos B）：原资料明确为 V4.5 经验、V5 待验证。主串写单人（1girl / 1boy / 1character），尝试启用两个角色栏：source# 对应 cos 者本体（保留脸型、身材、瞳色），target# 对应被 cos 角色（尝试转移服饰发型），自定义坐标放在同一点；不把同点位或施受前缀当作稳定的服装迁移保证。

## 常见词义陷阱与排错表
- 服装状态词陷阱（切勿把“一种衣服”当成“一种穿法”）：
  - loose socks 是粗针棉质堆堆袜，不是丝袜滑落；写 white thighhighs, loose socks 会静默把白丝换成棉袜。
  - single thighhigh 是只穿了一只袜子；thighhighs pull 是手拉丝袜的动作。
  - 表达“白丝一侧滑落堆在膝下”等不对称穿法时，用形制词（white thighhighs, uneven legwear）配合状态句（One thighhigh has slipped down to bunch just below the knee.）。

| 症状 | 优先核对 | 修正方向 |
| --- | --- | --- |
| 串发色/服饰/道具 | 主串是否混写双方外貌或动作，句子是否误用 Character N 当主语 | 外貌归各角色栏，主串用简短锚点指明道具归属，检查并删去 UC 中的 extra characters |
| 谁对谁动作做反/漏动作 | 前缀 source#/target# 是否配对同一词，三人交互是否漏写第三人状态 | 核对前缀方向与接触归属句；仍串味时将各人动作与表情移入各自角色栏末尾并配合坐标定位 |
| 整图变成抽象纹理/泥浆 | 画师名或 tag 是否以数字结尾且紧贴 ::，或存在未闭合的数值权重 | 在数字结尾词与 :: 之间补英文逗号（如 artist123, ::），补齐缺失的闭合 :: |
| 画中文字不出或残缺 | 生效词中的 no text、文字与载体对应、显式 Text: 及输入预算 | 按上文文字规则修正实际冲突，核验 Text: 字符与 token 后再提议草稿 |`,
  },

  "nai5-comics": {
    title: "NAI 多格漫画、逐框编译与色彩模式",
    body: `适用：NovelAI V5 的单页多格漫画、分格叙事与中英日文字渲染。这是借用角色栏组织分镜的创作方法，不是官方逐格寻址 API，不保证精确分格；局改不因此重建所有角色框。

## 整页人数去重与主串布局
- 主串人数按「本生成单元内出现的不同角色身份」去重：同一名女性在四格中反复出现仍写 1girl（多格漫画绝不加 solo）；两名女性轮流单独出镜写 2girls；一女一男写 1girl, 1boy。绝不按格数、出场次数或 Character 框总数计算人数。
- 阅读顺序与布局声明：主串只写去重人数、manga、阅读方向与总格数及行组排布，不写局部剧情或人物外貌。例如默认 2×2 四格（左上→右上→左下→右下）：
  1girl, manga. Read left to right, then top to bottom. The page is divided into four panels: two panels side by side across the top and two panels side by side across the bottom.
- 画格称呼：用唯一的位置与大小短语指代画格（如 the top left panel、the narrow middle right panel、the wide bottom panel），主串与各角色框保持一致，不用 Panel 1 / Panel 2 数字编号。

## Character 框的逐格容器写法
- 采用此写法时，每个 Character 框代表「某画格中的一次出场或局部画面」，未必对应新人物（例如同一主角在四格出场可使用四个 Character 框，配合 V5 自由坐标分别定在左上、右上、左下、右下对应画格区域内）。框数与基础加角色的总输入仍受当前 capabilities 和 input_budget 限制，每框不另赠 token；新增角色或坐标本身不会自动开启手动定位。
- 普通框统一以「In the <方位与大小> panel, <视图及镜头>: <本框可见的外貌衣物子集>, <本格新动作 + 仍入镜的持续状态>, <本格场景、光线与文字>.」起句：
  - 可见子集重填铁律：每个框都必须重新填入该镜头实际能看见的角色外貌与衣物（如面部特写填发型、发色、瞳色与衣领，省略画外的鞋裤），绝不能用角色名、“the same girl”或“同上”代替外貌描述。
  - 状态连续性：前格右手拿钥匙、后格左手端杯子时，只要右手仍在镜内就继续写出持钥匙状态；空手用 her empty left hand 等简短正词表达，不列否定清单。
- 一格用几个框：
  - 单名可识别人物：1 个框（含人物、动作、环境与台词）。
  - 同格多名可识别人物：每人 1 个框，复用完全相同的 In the ... panel 定位开头，只在其中一个框写共享背景，坐标同放该格内按站位分左右。
  - 匿名双手接触/抓袖口特写或纯道具空镜：合用 1 个框写清接触方向与可见袖口，不按手的主人拆成两个框，避免增加同一次接触被误拆成两格的风险。
  - 无框前景覆盖（Foreground Overlay）：不增加主串底层格数；单独占 1 个框，以 In the lower-center foreground overlay spanning the two bottom panels, waist-up: 等自然语言定位开头，只画一个冻结瞬间。

## 台词载体与预设冲突必检
- 文字就近绑定：在说话者所属的 Character 框写清载体与引号原文，如 speech bubble, "..."（喊声可用 jagged speech bubble）、thought bubble, "..."（内心独白）、Narrator box, "..."（旁白）、或 Small sound-effect lettering beside the latch reads "咔". Koma 不自动从引号生成文字段，按 nai5-prompting 的文字规则在对应字段末尾显式写 Text:；全页共享当前文字预算。静默无字格直接省略文字描述，不写 No text in this panel。用户要后期排字时，原文放独立文字清单，生成词只描述留位。
- 预设冲突处理（提议漫画/分格草稿时一并检查调整）：
  1. 负面预设（negativePreset）：V5 的 Heavy / Human Focus 含 multiple views, halftone, screentone，Furry Focus 含 comic, multiple scenes, sequence，可能压制分格与网点；实际启用了冲突预设且型号可改时，草稿提议 "light" 或 "none"。检查手写负面中的 multiple views、halftone、screentone、extra characters，以及有字页的 logo、需要留白时的 negative space / blank page，仅删除与本图冲突的项，同段其他词和权重保持。
  2. 质量预设（qualityPreset）：任一格生成文字时，按实际 no text 冲突提议 "none"，不是布尔 false；已经关闭的不重复修改。预设默认值与文字规则见 nai5-prompting。
  3. V5 Full Medium 固定 Heavy，不能用切换负面预设或改 Negative 来解除冲突；需要这些控制时说明限制并建议可用的 High / Curated，不擅自换型号或承诺 Medium 可关 Heavy。

## 三种色彩模式与全字段色相清洗
- 全彩（默认）：主串用 manga，不加灰阶词，各框保留角色与环境原色。
- 半黑白（仅头发与眼睛保色）：主串用 manga, {{{greyscale with colored eyes,greyscale with colored hair}}}（不加 monochrome）。仅头发与眼睛自身保留原色；必须将主串与各 Character 框中其余所有部位（肤色、兽耳、翅膀、服装、发饰、眼镜、道具、天空、建筑、光效）的彩色色相词直接替换为 pale / light gray / mid-gray / dark 等灰阶明暗词（如 golden bell 改 metallic bell，warm golden sunlight 改 soft daylight），避免同一物体残留原色词导致漏色。
- 纯黑白：主串用 manga, monochrome。将全部人物、头发、眼睛、服装、道具与环境的色相词替换为 pale / light gray / dark 等明暗对比词（保留深浅层次以防跨格发色反转，不直接删空外观描述），且不残留 colored eyes/hair 等局部保色词。`,
  },

  "oc-costume-design": {
    title: "原创角色服装设计、结构拆解与词条映射",
    body: `适用：原创角色（OC）服装构思、换装设计，以及将服装方案转换为 NAI 标签与自然语言混排描述。只要设计时交设计；只要衣物片段时不扩写人数、场景、质量词或 UC。用户明确要完整提示词时，再接 nai5-prompting 或 nai5-comics 的字段组织。

## 轮廓层级与构思工具箱
- 先根据角色身份、性格、世界观与固定外貌锚点（发色、瞳色、体型、物种特征）确立一眼可读的服装原型与重心（头肩/胸腰/胯腿），再按需选用以下构思路径：
  1. 异质配件与尺度反差：基础服装搭配反差感强烈的工具或武器（如普通雨衣配死神镰刀、娇小角色配结构清晰的巨剑，巨型武器仍需写明握柄与刃部朝向以免糊成柱子）。
  2. 跨风格单品组合：如复古衬衫、运动夹克与工装下装混搭，用衣长、松紧与色块比例统合。
  3. 剪裁结构重组：在主单品中借用异类领型或围裹方式（如连帽外套结合水手领、外层围裹裙片）。
  4. 材质与工艺转换：如用柔软针织做军装分割短外套，或在帆布工装袋上做礼服刺绣。
  5. 穿法与场合错位：如正装衬衫卷袖松领、制服外搭居家开衫，用穿着状态体现随性或生活感。
  6. 角色母题转译：把兔耳、花瓣、棋盘等角色母题转化为口袋盖、裙摆弧度或滚边节奏，而非单纯堆砌挂件。
- 细节做减法：配色遵循「主色 + 辅色 + 少量强调色」；可爱感优先靠圆润轮廓、宽紧比例、柔软边缘与清晰色块表达，不靠无限叠加荷叶边与碎饰。上述路径不要求逐项使用；用户明确指定的部件先保留，通过层级与位置协调，不以减法为由自行删除。

## 材质表现、穿着关系与词条转换
- 材质对比与褶皱：优先建立一组主材质对比，直接描述受光与聚褶形态（如硬皮革边缘挺直、亮面金属扣高光集中、软针织在腰肘处自然聚褶、薄纱半透层叠），不用笼统的“精致/华丽”代替结构。
- 穿着与附肢边界：交代长发位于帽兜/衣领内外、袖口与手套衔接、背带斜跨方向与落点（如背带斜跨胸口、包落左胯）。翅膀、尾巴、兽耳、角等二次元幻想特征默认遵循视觉美感逻辑，不主动补写衣物开洞、分片或加固边（除非用户专门指定该接口为设计重点）。
- 转写为提示词：基础衣类形制用准确词组（拿不准时用 search_tags 批量核对 Danbooru 标准名与中文释义，词义陷阱见 nai5-prompting），不对称穿法、局部滑落、开合状态、层叠搭接与运动中的衣料响应用自然语言短句补充。未命中时保留准确自然语言，不编造标准 tag；本手册不是完整 FASHIONPEDIA 或 Danbooru 数据库。未要求改画风时保留原有基底配方。`,
  },

  "nai5-reverse": {
    title: "照图反推提示词与局部提取",
    body: `适用：用户提供图片（或指定工作区已有图片）要求反推可直接使用的 NAI V5 提示词，或仅提取其中某一部分（构图/光影/服装/姿势/配色）。只问画面内容时不自动扩成完整提示词；普通插画字段规则接 nai5-prompting，漫画或分格接 nai5-comics。

## 来源区分与反推范围
- 先区分三种信息来源并在回复中明确说明：
  1. 原图元数据（原文）：若图片自带生成参数与原提示词，默认先告知并提取原文或照原文修改，不把它包装成反推。用户明确要求看图反推时才反推；要求先盲推再对照时，先只看图片并保留初稿，再读取元数据对比，比较后的改稿另列。若原提示词已经随 workspace_state、历史消息或工具结果读到，说明参考过原文，不能声称独立盲推；不能为了盲推假装没读过状态。
  2. 用户给定事实：用户已点名的 OC 设定、指定保留的画风或修改要求。
  3. 视觉推测：本次看图归纳出的描述。遮挡、裁切或模糊处只写能确认的轮廓与关系，并在说明中标出存疑点，不在提示词中强行编造画外细节。
- 按需提取范围：用户只要求提取构图镜头、光影配色、服装或动作时，只反推该部分并放入对应靶点，不动用户已有的其他字段；未指定范围时反推完整主串与各角色栏。

## 视觉观察与字段落点
- 主串前部词组：统计准确人数（单人无动物加 solo，多人按总人数写 2girls 等）、持握物、身体支撑物及形成前景遮挡的实体（保留数量、颜色与形态）。
- 镜头与视线分离判断：根据物体顶面/底面可见度、地平线与透视判断机位高低（from above / from below），不把单纯的“人物低头/抬头”误判为俯拍/仰拍，也不把近大远小单独当成仰拍。
- 手部与接触关系句：先看清镜头见到的是手背（指节/指甲）还是手掌（掌心/掌纹），再写手从哪一侧进入画面、接触哪个部位、谁承托谁以及前后遮挡关系。多人图从看画人视角由左至右编号为 Character 1、Character 2，动作与方向前缀（source#/target#/mutual#）按多人规则分列。
- 角色栏提取：每人一栏，以 girl / boy / other 开头，第一行写可见的发型、发色、瞳色与种族体征，第二行写可见的服装与配饰。

## 不从画面盲推的内容
- 不盲猜画师串：不从画风臆测画师名。修改当前画板时保留其已有基底；独立反推新图且用户未要求沿用时，不把当前画板的画师串自动套上去，无来源就省略并说明。
- 不盲加质量词与 UC：不因原图精细就堆砌质量词，也不从画面反推负面词或负权重（除非用户明确要求排除某元素）。原图含文字时，按 nai5-prompting 检查实际 no text 冲突与显式 Text:，不假定质量预设已开启。
- 不凭长相断定角色真名：除非用户点名或确认，否则即使外观像某版权角色也先按可见外貌与服饰描述（或询问用户是否采用该版权角色 tag），避免未经确认的角色名触发多余默认设定；自动识别标签也不是身份依据。`,
  },
} as const;

export type ModelManualId = keyof typeof manuals;
export const modelManualIds = Object.keys(manuals) as ModelManualId[];
