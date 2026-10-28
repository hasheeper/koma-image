/** Current V4.5/V5 official-client controls. UI ranges are not API maxima. */
export const NAI_OFFICIAL_MAX_PIXELS = 3_145_728;
export const naiSamplers = ["k_euler_ancestral", "k_euler", "k_dpmpp_2s_ancestral", "k_dpmpp_2m_sde", "k_dpmpp_2m", "k_dpmpp_sde"] as const;
export const noiseSchedules = ["auto", "karras", "exponential", "polyexponential"] as const;
export type NoiseSchedule = typeof noiseSchedules[number];
export type WireNoiseSchedule = Exclude<NoiseSchedule, "auto">;
const varietyModel = (id: string) => /^nai-diffusion-4-5-(full|curated)(-inpainting)?$/.test(id);
export const supportsNaiVariety = (model: { id: string; profileId?: string } | undefined) => model?.profileId === "nai-official-v1" && varietyModel(model.id);
/** Official V4.5 CFG Delay: sigma 58, scaled by latent area relative to 832×1216. */
export function naiVarietySigma(model: string, enabled: unknown, width: unknown, height: unknown): number | undefined {
  if (!varietyModel(model) || enabled !== true) return undefined;
  if ([width, height].some(n => typeof n !== "number" || !Number.isFinite(n) || n < 64)) throw new Error("Variety+ 需要有效的输出尺寸");
  return 58 * Math.sqrt(Math.floor(Number(width) / 8) * Math.floor(Number(height) / 8) / (104 * 152));
}
export const readNoiseSchedule = (value: unknown): NoiseSchedule => noiseSchedules.includes(value as NoiseSchedule) ? value as NoiseSchedule : "auto";
export function naiNoiseSchedule(model: string, sampler: string, value: unknown): WireNoiseSchedule {
  if (model.startsWith("nai-diffusion-5-")) return "karras";
  const chosen = readNoiseSchedule(value);
  return chosen === "auto" ? sampler === "k_dpmpp_2m" ? "exponential" : "karras" : chosen;
}
/** Connection catalogs remain authoritative for non-official gateways. */
export function modelSamplers(model: { id: string; profileId?: string } | undefined, declared: readonly string[]): string[] {
  if (model?.profileId !== "nai-official-v1") return [...declared];
  return model.id === "nai-diffusion-5-full-medium" ? ["k_euler_ancestral"] : [...naiSamplers];
}
export const editStrengthRange = (official: boolean, inpaint: boolean) => ({ min: official ? .01 : 0, max: official && !inpaint ? .99 : 1 });

/** Validate again at the official wire boundary, including non-UI callers. */
export function validateNaiParameters(value: { model: string; sampler?: unknown; steps?: unknown; scale?: unknown; seed?: unknown; cfg_rescale?: unknown; noise_schedule?: unknown; noiseSchedule?: unknown; varietyPlus?: unknown; width?: unknown; height?: unknown }) {
  const medium = value.model === "nai-diffusion-5-full-medium";
  if (!medium && value.sampler !== undefined && !naiSamplers.includes(value.sampler as typeof naiSamplers[number])) throw new Error("当前 NovelAI 型号不支持此采样器");
  if (!medium && value.steps !== undefined && (typeof value.steps !== "number" || !Number.isInteger(value.steps) || value.steps < 1 || value.steps > 50)) throw new Error("步数须为 1–50 的整数");
  if (value.scale !== undefined && (typeof value.scale !== "number" || !Number.isFinite(value.scale) || value.scale < 0)) throw new Error("Guidance 须为非负有限数值");
  if (value.varietyPlus !== undefined && typeof value.varietyPlus !== "boolean") throw new Error("Variety+ 须为开关值");
  if (value.seed !== undefined && (typeof value.seed !== "number" || !Number.isInteger(value.seed) || value.seed < -1 || value.seed > 0xffffffff)) throw new Error("Seed 须为 uint32 或随机值 -1");
  if (!medium && value.cfg_rescale !== undefined && (typeof value.cfg_rescale !== "number" || !Number.isFinite(value.cfg_rescale) || value.cfg_rescale < 0 || value.cfg_rescale > 1)) throw new Error("Guidance Rescale 须在 0–1 之间");
  for (const schedule of [value.noiseSchedule, value.noise_schedule]) if (schedule !== undefined && !noiseSchedules.includes(schedule as NoiseSchedule)) throw new Error("噪声调度无效");
  if (value.width !== undefined || value.height !== undefined) {
    if ([value.width, value.height].some(n => typeof n !== "number" || !Number.isInteger(n) || n < 64 || n % 64)) throw new Error("NovelAI 宽高须至少 64 且对齐 64 像素");
    if (Number(value.width) * Number(value.height) > NAI_OFFICIAL_MAX_PIXELS) throw new Error("NovelAI 图像面积不超过 3,145,728 像素");
  }
}
