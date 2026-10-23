import { readCharacters, activeCharacters } from "../domain/characters.ts";
import { profilePath } from "./profile.ts";
import type { GatewayProfile } from "./profile.ts";
import type { Quote } from "../domain/quote.ts";
export type ImagePayload = { model: string; tool?: string; cache?: boolean; [key: string]: unknown };
export const usesNative = (payload: ImagePayload, quote: Quote | null) => !payload.tool && payload.model.startsWith("nai-") && quote?.cost === 0 && payload.cache !== true;
export function executionRoute(payload: ImagePayload, quote: Quote | null, profile: GatewayProfile) {
  const route = payload.tool ? "tools" : profile.executionRoutes.nativeFree && usesNative(payload, quote) ? "native" : "studio";
  if (route === "tools" && !profile.executionRoutes.tools || route === "studio" && !profile.executionRoutes.studio) throw new Error("连接不支持本次操作");
  return { kind: route, path: profilePath(profile, route === "tools" ? "toolRun" : route === "native" ? "native" : "generate"), usesDailyQuota: route !== "native" } as const;
}
export const naiPrompt = (prompt: unknown) => typeof prompt === "string" && prompt.trim() ? prompt : "best quality";
/** Standard gateway wire fields; the application keeps its complete role snapshot. */
export function toStandardPayload(payload: ImagePayload): ImagePayload {
  const { characters: value, placement, ...rest } = payload;
  const characters = readCharacters(value).filter(c => c.on);
  if (!characters.length) return rest;
  return { ...rest, use_coords: placement === "manual", characters: characters.map(c => {
    if (placement === "manual" && c.centers.length > 1) throw new Error("标准网关角色仅支持单个位置，请在角色区重新定位后生成");
    return { prompt: c.prompt, uc: c.negative, center: { ...(c.centers[0] ?? { x: 0.5, y: 0.5 }) } };
  }) };
}
export function toNativePayload(payload: ImagePayload, random = Math.random) {
  const model = payload.model.replace(/@local$/, "");
  if (!/^nai-diffusion-[\w-]+$/.test(model)) throw new Error("原生接口只接受 NAI 模型");
  const prompt = naiPrompt(payload.prompt), negative = payload.negative_prompt || "";
  const characters = activeCharacters(readCharacters(payload.characters), model);
  const caption = (text: unknown, negative = false) => ({ caption: { base_caption: text, char_captions: characters.map(c => ({ char_caption: negative ? c.negative : c.prompt, centers: c.centers })) }, use_coords: characters.length > 0 && payload.placement === "manual", use_order: true });
  return { input: prompt, model, action: "generate", max_cost: payload.max_cost,
    parameters: { width: payload.width, height: payload.height, n_samples: 1,
      seed: typeof payload.seed === "number" && payload.seed >= 0 ? payload.seed : Math.floor(random() * 4294967296),
      scale: payload.scale, cfg: payload.cfg, steps: payload.steps, sampler: payload.sampler,
      negative_prompt: negative, ucPreset: 0, qualityToggle: true, legacy: false,
      cfg_rescale: 0, params_version: 3, dynamic_thresholding: false, controlnet_strength: 1,
      add_original_image: true, legacy_v3_extend: false, noise_schedule: "karras",
      deliberate_euler_ancestral_bug: false, prefer_brownian: true,
      v4_prompt: caption(prompt), v4_negative_prompt: caption(negative, true) } };
}
