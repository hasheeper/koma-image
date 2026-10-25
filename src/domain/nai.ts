/** Official prompt presets and model constraints. No network or account assumptions. */
export const NAI_FULL = "nai-diffusion-5-full";
export const NAI_MEDIUM = "nai-diffusion-5-full-medium";
export const complexities = ["none", "low", "medium", "high", "ultra"] as const;
export const qualityPresets = ["none", "light", "standard"] as const;
export const negativePresets = ["none", "light", "heavy", "human", "furry"] as const;
export const naiModes = ["anime", "furry"] as const;
export type NaiMode = typeof naiModes[number];
/** Explicit leading dataset markers take precedence; never rewrite user text. */
export function naiDataset(prompt: string): "fur" | "background" | undefined {
  return /^\s*(fur|background) dataset\s*(?:,|$)/i.exec(prompt)?.[1]?.toLowerCase() as "fur" | "background" | undefined;
}
export function effectiveNaiMode(mode: NaiMode, prompt: string): NaiMode {
  const dataset = naiDataset(prompt);
  return dataset ? dataset === "fur" ? "furry" : "anime" : mode;
}
export function naiModePrompt(prompt: string, mode: NaiMode) {
  if (mode !== "furry" || naiDataset(prompt)) return prompt;
  const textAt = /\bText:/i.exec(prompt)?.index ?? prompt.length;
  // Deduplicate only literal dataset tags in the effective prompt, never inside Text:.
  const head = prompt.slice(0, textAt).split(",").filter(tag => tag.trim().toLowerCase() !== "fur dataset").join(",").replace(/[,\s]+$/, "").trim();
  return ["fur dataset", head, prompt.slice(textAt)].filter(Boolean).join(", ");
}
export function naiTagDataset(form: { model: string; naiMode: NaiMode; prompt: string }) {
  return naiCapabilities(form.model).supported && effectiveNaiMode(form.naiMode, form.prompt) === "furry" ? "furry" as const : "anime" as const;
}
export type Complexity = typeof complexities[number];
export type QualityPreset = typeof qualityPresets[number];
export type NegativePreset = typeof negativePresets[number];
export function naiCapabilities(id: string) {
  const model = id.replace(/@local$/, ""), v5 = /^nai-diffusion-5-(full|curated)(-medium)?$/.test(model);
  const v45 = /^nai-diffusion-4-5-(full|curated)$/.test(model);
  const medium = model === NAI_MEDIUM;
  return { supported: v5 || v45, v5, medium, effort: model === NAI_FULL || medium,
    quality: v5 ? [...qualityPresets] : v45 ? ["none", "standard"] as QualityPreset[] : ["none"] as QualityPreset[],
    negative: medium || !v5 && !v45 ? ["none"] as NegativePreset[] : negativePresets.filter(p => p !== "furry" || !model.endsWith("4-5-curated")) };
}
export const qualityTags = (model: string, preset: QualityPreset): string => {
  const cap = naiCapabilities(model);
  if (!cap.quality.includes(preset) || preset === "none") return "";
  if (cap.v5) return preset === "light" ? "very aesthetic, amazing quality, no text" : "very aesthetic, masterpiece, no text";
  return model.replace(/@local$/, "").endsWith("curated") ? "location, masterpiece, no text, -0.8::feet::, rating:general" : "location, very aesthetic, masterpiece, no text";
};
const heavy = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
const curatedHeavy = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page";
export function negativeTags(model: string, preset: NegativePreset): string {
  const cap = naiCapabilities(model);
  if (!cap.negative.includes(preset) || preset === "none") return "";
  const curated = model.replace(/@local$/, "").endsWith("4-5-curated");
  switch (preset) {
    case "heavy": return curated ? curatedHeavy : heavy;
    case "human": return curated
      ? "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page"
      : `${heavy}, @_@, mismatched pupils, glowing eyes, bad anatomy`;
    case "light": return cap.v5
      ? "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::"
      : curated ? "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page"
        : "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page";
    case "furry": return "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic";
  }
}
/** Keep the user's exact text; add only missing literal tags before the Text: suffix. */
export function appendNaiTags(prompt: string, tags: string) {
  if (!tags) return prompt;
  const textAt = /\bText:/i.exec(prompt)?.index ?? prompt.length;
  const head = prompt.slice(0, textAt), tail = prompt.slice(textAt);
  const existing = new Set(head.split(",").map(t => t.trim().toLowerCase()));
  const additions = tags.split(",").map(t => t.trim()).filter(t => t && !existing.has(t.toLowerCase()));
  if (!additions.length) return prompt;
  return `${head}${head.trim() && !/[,\s]$/.test(head) ? ", " : head.trim() && !/,\s*$/.test(head) ? ", " : ""}${additions.join(", ")}${tail ? `, ${tail}` : ""}`;
}
/** Dataset markers must remain first even when another automatic tag is prepended. */
export function prependNaiTag(prompt: string, tag: string) {
  const dataset = /^(?:fur|background) dataset\s*(?:,\s*|$)/i.exec(prompt)?.[0];
  if (!dataset) return [tag, prompt].filter(Boolean).join(", ");
  return `${dataset.replace(/,\s*$/, "")}, ${tag}${prompt.slice(dataset.length) ? `, ${prompt.slice(dataset.length)}` : ""}`;
}
export function readNaiSettings(value: { naiMode?: unknown; complexity?: unknown; qualityPreset?: unknown; negativePreset?: unknown; cfgRescale?: unknown }) {
  return {
    naiMode: value.naiMode === "furry" ? "furry" as const : "anime" as const,
    complexity: complexities.includes(value.complexity as Complexity) ? value.complexity as Complexity : "none" as const,
    qualityPreset: qualityPresets.includes(value.qualityPreset as QualityPreset) ? value.qualityPreset as QualityPreset : "none" as const,
    negativePreset: negativePresets.includes(value.negativePreset as NegativePreset) ? value.negativePreset as NegativePreset : "none" as const,
    cfgRescale: typeof value.cfgRescale === "number" && Number.isFinite(value.cfgRescale) ? Math.min(1, Math.max(0, value.cfgRescale)) : 0,
  };
}
