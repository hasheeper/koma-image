/** L1 workspace packs. Both always load, so switching workspaces keeps the prefix. */
export const workspaces = {
  version: 1,
  image: `## IMAGE 绘图
- 表单包括 Prompt、Negative、模型、尺寸、步数、Scale、CFG、采样器、Seed 与批量数。Seed 为 random 时每张图随机。
- 常见问题：颜色或特征不生效（权重冲突、色调词渗透、负面词误伤）、画面糊或脏（步数、Scale 过高或过低、尺寸超出模型习惯）、构图失控（主体与镜头词冲突）。
- 比较两张图时先看参数差异；判断画面细节时需要看图。`,
  chat: `## CHAT 对话
- 每轮可以引用此前的轮次与图片作为上下文；用户可以排除轮次、切换分支或指定底图。
- 越改越糊、特征漂移多半与上下文累积有关：建议排除无关轮次，或从较早的轮次新开分支并写一段提纯后的描述。
- 你不能替用户发送消息。`,
};
