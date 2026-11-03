# 供应商接口用途样式咨询

日期：2026-11-04（Asia/Shanghai）。来源：model-consult，`proxy:claude-opus-5-5 [perplexity]`；返回型号：`claude-opus-5-5 [perplexity]`。

咨询：`c-1dc29abe-1b55-43a8-90f4-8f465d1234fd`；版本：`t-090fba26-686c-4cfc-a03a-d72a70db07f3`。以下保留顾问原稿，不代表用户已接受，也不作为代码事实或验收结论。

## 主 Agent 核对

现有 fieldset 已重置 border、padding 和 margin，需补齐的是 legend 的 padding 与字段排版。公共 `.check` 的 class 应放在 label 上，并提供相邻装饰 span，不能照抄原稿中的 input class。保留现有至少开启一项的校验，不采用额外禁用和常驻提示；改动只涉及布局与公共控件复用。

## Opus 5.5 原始答复

# Koma Image「开启接口」区域改良方案

## 一、诊断：不算崩，但这一块确实没对齐上设计系统

对照截图和你描述的代码，问题有五处：

1. **legend 和上方字段标签没对齐。**「开启接口」比「接口协议」略向右缩进，颜色和字号也不一致。原因是 fieldset 和 legend 自带的 padding、border、margin 没有重置，legend 也没有复用字段标签的样式。
2. **字号偏大。** label 没设字号，继承了比 13px 更大的值，视觉上和 select 里的「Gemini 原生」一样大。结果是「选项」比「字段值」还抢眼，主次颠倒。
3. **原生 checkbox 太亮。** accent-color 渲染出的是浅紫色实心块，比 select 的边框重得多，而且与项目自绘的 `.check` 不是同一种视觉语言。
4. **一行里挤了三种符号。** 勾选框、线性图标、文字三种元素并排。图标只是在重复文字已经表达的意思（文字 / 图像），属于你说的「重复图标」。
5. **文字没有层级。**「文字 · ASK」用中点把主名称和说明拼成同一级，后半段「生图与编辑」又比前半段长，两项长度和重心都不均衡。

## 二、改良方向

- **组件**：复用 `.check`，不引入 `.switch`（它的语义是即时生效，而这里要保存后才生效），也不用 `.seg`（它是单选语义）。
- **去掉图标**：勾选框本身就是行首的视觉锚点，再加图标就重复了。
- **文字分两级**：
  - 主名称 13px，颜色 `--fg`：「文字」「图像」。
  - 补充说明 12px，颜色 `--fg-3`：「ASK」「生图与编辑」。
  - 两者行内并排，不再用中点拼接。
- **legend 等同字段标签**：12px、`--fg-2`，左边缘与「接口协议」对齐，与选项间距和其他字段的「标签 → 控件」间距一致。
- **两列等宽 grid**：桌面端两项各占一半，起点对齐。手机窄屏自动变为单列，不会出现半截换行。
- **不加外框、不加说明段落**：最多只在需要时显示一行错误提示。

示意（桌面）：

```
接口协议
[ Gemini 原生                     ▾ ]

开启接口
☑ 文字  ASK              ☑ 图像  生图与编辑

名称
```

## 三、模板

```vue
<fieldset class="field cap-field">
  <legend class="field-label">开启接口</legend>

  <div class="cap-options">
    <label class="cap-option">
      <input
        type="checkbox"
        class="check"
        v-model="form.capText"
        :disabled="form.capText && !form.capImage"
        :aria-describedby="lastOne ? 'cap-hint' : undefined"
      />
      <span class="cap-name">文字</span>
      <span class="cap-desc">ASK</span>
    </label>

    <label class="cap-option">
      <input
        type="checkbox"
        class="check"
        v-model="form.capImage"
        :disabled="form.capImage && !form.capText"
        :aria-describedby="lastOne ? 'cap-hint' : undefined"
      />
      <span class="cap-name">图像</span>
      <span class="cap-desc">生图与编辑</span>
    </label>
  </div>

  <p v-if="lastOne" id="cap-hint" class="cap-hint">至少开启一项</p>
</fieldset>
```

```ts
const lastOne = computed(() => form.capText !== form.capImage) // 只剩一项被选中
```

**关于「至少选一个」：** 上面的写法是把最后一个已选项置为 disabled，从源头上就无法取消，配合一行 12px 的 `--fg-3` 提示，比保存时报错更直接。

如果你们现有逻辑是「保存时校验」，可以保留原逻辑：去掉 `:disabled`，把 `cap-hint` 改为仅在校验失败时显示，颜色换成项目现有的错误语义 token。两种做法任选其一，不要同时用。

## 四、CSS

```css
/* fieldset / legend 重置，使其与普通字段同构 */
.cap-field {
  border: 0;
  padding: 0;
  margin: 0;
  min-inline-size: 0;
}
.cap-field > legend {
  padding: 0;
  /* 复用现有 .field-label：12px / --fg-2 / 与控件的间距 */
}

.cap-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
}

.cap-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;              /* 整行可点 */
  font-size: 13px;
  line-height: 1.4;
  color: var(--fg);
  cursor: pointer;
  min-width: 0;
}
.cap-option .check { flex: none; } /* .check 自身 16px，勿再覆盖宽高 */

.cap-name { flex: none; }
.cap-desc {
  font-size: 12px;
  color: var(--fg-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* 已锁定的最后一项：保持可读，只表达"不可取消" */
.cap-option:has(.check:disabled) { cursor: default; }

.cap-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--fg-3);
}

/* 手机：单列，触控高度加大 */
@media (max-width: 480px) {
  .cap-options { grid-template-columns: 1fr; }
  .cap-option { min-height: 40px; }
}
```

**样式细节：**

- `.check` 默认的 disabled 样式通常会变淡。这里锁定的是**已选中**项，不建议让它淡到像未启用。如果现成 disabled 透明度过低，可以单独放宽：

  ```css
  .cap-option .check:disabled:checked { opacity: .7; }
  ```

  这仍然只用公共组件和 tokens，不新增配色。
- 不要给 `.cap-option` 加背景或边框，避免「大框套小框」。

## 五、键盘与无障碍

- 保留原生 `<input type="checkbox">`（`.check` 是在原生 input 上自绘的话）。这样 Tab 逐项聚焦、Space 切换、focus-visible 环都由 `.check` 现有样式提供，不需要额外处理。
- fieldset + legend 让读屏器播报「开启接口，组合」。`aria-describedby` 会把「至少开启一项」关联到被锁定的那一项。
- 整个 label 都可点击，桌面端热区 32px，手机端 40px。

## 六、验证清单

1. 「开启接口」的左边缘与「接口协议」「名称」的标签对齐。
2. 选项字号不大于 select 的值文字。
3. 360px 宽度下变为单列，两项都不截断主名称。
4. 切换主题后 `.check` 的边界在亮色下依然可见。
5. 只剩一项时无法取消，并出现提示。
6. 切换到不显示此区域的协议再切回来，勾选状态与原业务逻辑一致（本方案未改动数据流）。


## 第二轮咨询

用户反馈：「这个还是有点丑有点散，为什么？怎么调整？」

版本：`t-c0f64a52-3e76-4889-95a0-04c2eb5d49ce`，承接第一轮；返回型号：`claude-opus-5-5 [perplexity]`。顾问原稿如下，未作为用户接受记录。

# 「开启接口」二次改良：为什么还散，以及怎么收拢

## 一、为什么还是散

现在单个元素都已经对齐了设计系统，散是布局造成的。对着截图看，有四个原因：

1. **两列把一组拆成了两半。** 「图像」被推到弹窗中线，和「文字」之间隔着约 300px 的空白。这段空白不属于任何元素，眼睛会把两个选项读成两个互不相干的东西，而不是同一个字段的两个选项。
2. **这一行是表单里唯一没有控件外形的字段。** 上面「接口协议」和下面「名称」都是有边界的输入框，中间这一行只有零散的勾选框和文字，像是飘在两个框之间，节奏在这里断了一拍。
3. **垂直间距被叠加了。** legend 下方的间距、32px 行高里的上下余量、再到「名称」之间的字段间距，三段叠在一起，明显比其他字段的「标签 → 控件 → 下一字段」更松。截图里「开启接口」到勾选框、勾选框到「名称」的距离，都比「接口协议」到输入框的距离大。
4. **副文字把每项拉成了两段。** 「文字 ASK」「图像 生图与编辑」各有两个重心，加上灰色副文字，每个选项的长度和视觉重量都不统一。尤其「生图与编辑」比主名称还长，读起来像注释。

## 二、调整方案

**1. 两个选项从左起紧凑成组，不再撑满宽度**

改用 flex 从左排列，项间距 24px，约为项内间距 8px 的 3 倍。这样项内明显比项间紧，两个选项自然读成一组，右侧留白归属整个字段，不会再像是两项中间的空洞。

**2. 选项行高度等于输入框高度**

把这一行当作这个字段的「控件」，高度与 select 和 input 一致（按截图约 36 到 40px，以你们 `--control-h` 或实际值为准）。去掉选项行自身的额外 margin，标签到控件的间距、字段之间的间距都复用其他字段的规则。这样三个字段的节奏完全一致，散的感觉主要就是靠这一步消除的。

**3. 去掉可见的副信息**

「文字」「图像」本身已经足够区分两个选项：

- **ASK**：如果它是产品里其他地方也在用的功能名，用户认得，可以直接做成主名称的一部分，写成「文字 ASK」，同色同号，不要灰色分级。如果不是，就删掉。
- **「生图与编辑」**：属于说明性文字，弹窗里不需要常驻。

这里不建议改成 tooltip，因为手机上看不到，等于又藏了一层。

**4. legend 保持在上方，不改成左侧标签**

改成「标签在左、选项在右」会和其他字段的上下结构不一致，左边缘对齐会被打破，所以保持现状。

**5. 手机端不再改单列**

两个短选项在 360px 宽度下一行完全放得下，改单列反而又把间距拉松了。手机端只需要把行高和热区加大。

调整后的效果：

```
接口协议
[ OpenAI 兼容                      ▾ ]

开启接口
☑ 文字    ☑ 图像

名称
[ 供应商名称                         ]
```

## 三、关键 CSS

```css
.cap-field {
  border: 0;
  padding: 0;
  margin: 0;
  min-inline-size: 0;
}
.cap-field > legend {
  padding: 0;               /* 其余复用 .field-label */
}

.cap-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 24px;          /* 项间 ≈ 3 倍项内间距，读成一组 */
  min-height: var(--control-h, 38px); /* 与 select/input 同高 */
  margin: 0;                 /* 不额外加距，节奏交给 .field */
}

.cap-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: var(--control-h, 38px); /* 热区等于控件高，不再叠加 32px 行 */
  font-size: 13px;
  color: var(--fg);
  cursor: pointer;
}

@media (max-width: 480px) {
  .cap-options,
  .cap-option {
    min-height: 44px;
    height: auto;
  }
  /* 保持同一行，不改单列 */
}
```

模板方面，删掉 `.cap-desc` 的 span 即可，其余结构、`.check`、校验逻辑都不变。

## 四、如果收拢后仍觉得这一行「飘」

这时可以再走一步：让 `.cap-options` 采用和输入框相同的井槽外观，即 `--well` 背景、`--line` 边框、同样的圆角，内边距对齐输入框文字起点（约 12px）。这样它和上下两个控件就是同一种形态。

这只是一层框，和输入框同级，里面的选项不加任何底色或边框，所以不算大框套小框。

不过建议先上线前面的无框版本：如果第 2 步的高度和间距已经对齐，大概率就够了。

## 五、验证要点

1. 「开启接口」到选项、选项到「名称」的距离，与「接口协议」到输入框、输入框到「名称」的距离一致。
2. 两个勾选框之间没有超过 24px 的空隙。
3. 360px 宽度下仍是一行，且行高不小于 44px。
4. 键盘 Tab、Space 的操作和 focus 环沿用 `.check`，行为不变。
