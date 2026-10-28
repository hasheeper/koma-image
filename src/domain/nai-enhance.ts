import type { CatalogModel } from "./catalog.ts";
import { naiCapabilities } from "./nai.ts";
import { NAI_OFFICIAL_MAX_PIXELS } from "./nai-parameters.ts";

export const naiEnhanceMagnitudes = [
  { strength: .2, noise: 0 }, { strength: .4, noise: 0 },
  { strength: .5, noise: 0 }, { strength: .6, noise: 0 },
  { strength: .7, noise: .1 },
] as const;
export const naiEnhanceScales = [2, 1.5, 1] as const;
export type EnhanceScale = typeof naiEnhanceScales[number] | "max";
export const isEnhanceScale = (value: unknown): value is EnhanceScale => value === "max" || naiEnhanceScales.includes(value as typeof naiEnhanceScales[number]);
// The official client only offers Max below 80% of the 3MP limit.
export const NAI_MAX_ENHANCE_AREA_CUTOFF = NAI_OFFICIAL_MAX_PIXELS * .8;
type Size = { width: number; height: number };
export function supportsNaiEnhance(model: Pick<CatalogModel, "id" | "profileId" | "upstreamId" | "tools" | "operations">) {
  return model.profileId === "nai-official-v1" && naiCapabilities(model.id).supported &&
    (!model.upstreamId || model.upstreamId === model.id) && model.operations.includes("edit") && model.tools.includes("img2img");
}

/** Actual output dimensions. Max keeps source dimensions on the wire and the
 * server scales the result; it must not use ordinary Enhance's 64px snapping. */
export function naiEnhanceSize(size: Size, scale: unknown, model = ""): Size {
  if (!isEnhanceScale(scale)) throw new Error("Enhance 仅支持 1×、1.5×、2× 和 V5 Max");
  const { width, height } = size;
  if ([width, height].some(n => !Number.isInteger(n) || n < 64 || n % 64) || width * height > NAI_OFFICIAL_MAX_PIXELS)
    throw new Error("Enhance 底图须 64 像素对齐且不超过 3,145,728 像素");
  if (scale === "max") {
    if (!naiCapabilities(model).v5) throw new Error("Max Enhance 仅支持 V5 型号，设置已保留");
    if (width * height >= NAI_MAX_ENHANCE_AREA_CUTOFF) throw new Error("此底图尺寸不适用 Max Enhance，请选择其他倍率");
    const factor = Math.min(2, Math.sqrt(NAI_OFFICIAL_MAX_PIXELS / (width * height)));
    return { width: Math.floor(width * factor), height: Math.floor(height * factor) };
  }
  const raw = { width: Math.floor(width * Number(scale)), height: Math.floor(height * Number(scale)) };
  // The official client explicitly permits 1.5× for the standard portrait/landscape.
  const standard = width === 832 && height === 1216 || width === 1216 && height === 832;
  if ((!standard && (raw.width % 64 || raw.height % 64)) || raw.width * raw.height > NAI_OFFICIAL_MAX_PIXELS)
    throw new Error("此倍率超出 Enhance 尺寸范围，请选择其他倍率");
  const target = { width: Math.round(raw.width / 64) * 64, height: Math.round(raw.height / 64) * 64 };
  if (target.width * target.height > NAI_OFFICIAL_MAX_PIXELS) throw new Error("Enhance 输出最多 3,145,728 像素，请降低倍率");
  return target;
}
export const availableEnhanceScales = (size: Size, model = ""): EnhanceScale[] => (["max", ...naiEnhanceScales] as const).filter(scale => {
  try { naiEnhanceSize(size, scale, model); return true; } catch { return false; }
});

/** Match the official Enhance correction, keeping generated text after Text: intact. */
export function naiEnhancePrompt(prompt: string, scale?: EnhanceScale) {
  if (scale === "max") return prompt;
  if (prompt.includes("upscaled, blurry")) return prompt;
  const at = /\bText:/i.exec(prompt)?.index ?? prompt.length;
  return `${prompt.slice(0, at)}, -2::upscaled, blurry::,${prompt.slice(at)}`;
}
