/** Option keys a new conversation may take from an ASK draft; quality stays the user's choice. */
export const chatSizeKeys: readonly string[] = ["size", "aspect_ratio", "image_size"];
/** Shown to ASK so it can remind the user, never written by a draft. */
export const chatReadOnlyKeys: readonly string[] = ["quality"];

/** Parameter panel names and values, shared by CHAT and ASK draft cards. */
export const chatOptionNames: Readonly<Record<string, string>> = {
  quality: "质量",
  size: "画幅",
  aspect_ratio: "比例",
  image_size: "分辨率",
  output_format: "格式",
};
const values: Readonly<Record<string, string>> = {
  auto: "自动",
  low: "草稿",
  medium: "标准",
  high: "高质量",
  xhigh: "超高",
  max: "最高",
  "1024x1024": "方形",
  "1536x1024": "横向",
  "1024x1536": "竖向",
};
export const chatOptionLabel = (v: string) => values[v] || v.toUpperCase();
