/** Reasoning catalogs carry no family, so an ID only picks a heading and an icon; it never limits use. */
export const familyNames: Record<string, string> = {
  gpt: "GPT",
  claude: "Claude",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  glm: "GLM",
  kimi: "Kimi",
  minimax: "MiniMax",
  xai: "xAI",
  doubao: "Doubao",
  other: "其他",
};
const patterns: [string, RegExp][] = [
  ["claude", /claude|anthropic/],
  ["gemini", /gemini|gemma/],
  ["gpt", /gpt|(^|\/)(o\d|chat-latest)|openai/],
  ["deepseek", /deepseek/],
  ["qwen", /qwen|qwq/],
  ["glm", /glm|zhipu/],
  ["kimi", /kimi|moonshot/],
  ["minimax", /minimax|abab/],
  ["xai", /grok|xai/],
  ["doubao", /doubao/],
];
/** A trailing「[provider]」names the host serving it, not the model's family. */
export const familyOf = (id: string) => {
  const model = id.replace(/\s*\[[^\]]*\]\s*$/, "").toLowerCase();
  return patterns.find(([, pattern]) => pattern.test(model))?.[0] ?? "other";
};
