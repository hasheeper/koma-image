/**
 * L2 model knowledge, all loaded at once (doc 3 §1.3): switching the image
 * model in the form never swaps the system prompt.
 */
export const models = {
  version: 1,
  text: `## 模型知识
### NovelAI（NAI Diffusion 4.5 / V5）
- Prompt 以 Danbooru 风格 Tag 为主，可与自然语言句子混排；Tag 之间用逗号分隔，下划线与空格等价。
- 权重：{tag} 乘 1.05、[tag] 除以 1.05，可嵌套；W::text:: 设定绝对权重，W 可以为负（负值相当于反向抑制）。圆括号不是权重语法。
- 画师写作 artist:名字。质量词常用 masterpiece、best quality、very aesthetic、absurdres。
- 多角色、Vibe Transfer 与参考图属于表单扩展；摘要中的 characters、vibes 为空时表示未使用。
### OpenAI Images
- 只接受自然语言描述，没有权重语法；花括号、W:: 会被当作普通文字。尺寸与质量由参数决定。
### Gemini 图像
- 自然语言描述，擅长按对话逐步修改；没有权重语法。多轮修改时，较早的描述会持续影响结果。
### 通用
- 不同模型的语法不能直接混用：把 NAI 写法交给 OpenAI 或 Gemini 时，需要改写成句子并去掉权重语法。`,
};
