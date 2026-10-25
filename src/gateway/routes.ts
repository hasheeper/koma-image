import { referenceModel, referenceWire } from "../domain/nai-references.ts";
import type { PreparedReferences, ReferencePlan } from "../domain/nai-references.ts";
import { readCharacters, activeCharacters } from "../domain/characters.ts";
import { profilePath } from "./profile.ts";
import type { GatewayProfile } from "./profile.ts";
import type { Quote } from "../domain/quote.ts";
import { naiCapabilities } from "../domain/nai.ts";
export type ImagePayload = { model: string; tool?: string; cache?: boolean; referencePlan?: ReferencePlan; preparedReferences?: PreparedReferences; referenceMinimum?: number; [key: string]: unknown };
export const usesNative = (payload: ImagePayload, quote: Quote | null) => !payload.tool && payload.model.startsWith("nai-") && quote?.cost === 0 && payload.cache !== true;
export function executionRoute(payload: ImagePayload, quote: Quote | null, profile: GatewayProfile) {
  const route = payload.tool ? "tools" : profile.executionRoutes.nativeFree && usesNative(payload, quote) ? "native" : "studio";
  if (route === "tools" && !profile.executionRoutes.tools || route === "studio" && !profile.executionRoutes.studio) throw new Error("连接不支持本次操作");
  return { kind: route, path: profilePath(profile, route === "tools" ? "toolRun" : route === "native" ? "native" : "generate"), usesDailyQuota: route !== "native" } as const;
}
export const naiPrompt = (prompt: unknown) => typeof prompt === "string" && prompt.trim() ? prompt : "best quality";
/** Standard gateway wire fields; the application keeps its complete role snapshot. */
export function toStandardPayload(payload: ImagePayload): ImagePayload {
  if (payload.referencePlan || payload.preparedReferences) throw new Error("此连接未声明参考生成协议");
  const { characters: value, placement, referenceMinimum: _minimum, ...rest } = payload;
  const characters = readCharacters(value).filter(c => c.on);
  if (!characters.length) return rest;
  return { ...rest, use_coords: placement === "manual", characters: characters.map(c => {
    if (placement === "manual" && c.centers.length > 1) throw new Error("标准网关角色仅支持单个位置，请在角色区重新定位后生成");
    return { prompt: c.prompt, uc: c.negative, center: { ...(c.centers[0] ?? { x: 0.5, y: 0.5 }) } };
  }) };
}
export function toNativePayload(payload: ImagePayload, random = Math.random, official = false) {
  const model = payload.model.replace(/@local$/, "");
  if (!/^nai-diffusion-[\w-]+$/.test(model)) throw new Error("原生接口只接受 NAI 模型");
  if ((payload.referencePlan || payload.preparedReferences) && (!official || !referenceModel(model))) throw new Error("当前模型或连接不支持参考生成，配置已保留");
  if (payload.referencePlan && !payload.preparedReferences) throw new Error("参考图片尚未准备完成");
  const cap = naiCapabilities(model);
  const prompt = naiPrompt(payload.prompt), negative = cap.medium ? "" : payload.negative_prompt || "";
  const characters = activeCharacters(readCharacters(payload.characters), model);
  const caption = (text: unknown, negative = false) => ({ caption: { base_caption: text, char_captions: characters.map(c => ({ char_caption: negative ? cap.medium ? "" : c.negative : c.prompt, centers: c.centers })) }, use_coords: characters.length > 0 && payload.placement === "manual", use_order: true });
  return { input: prompt, model, action: "generate", max_cost: payload.max_cost,
    parameters: { ...(payload.preparedReferences ? referenceWire(payload.preparedReferences) : {}), width: payload.width, height: payload.height, n_samples: 1,
      seed: typeof payload.seed === "number" && payload.seed >= 0 ? payload.seed : Math.floor(random() * 4294967296),
      scale: payload.scale, ...(!official ? { cfg: payload.cfg } : {}),
      steps: cap.medium ? 14 : payload.steps, sampler: cap.medium ? "k_euler_ancestral" : payload.sampler,
      negative_prompt: negative, qualityToggle: false, legacy: false,
      // Presets have already been expanded into the effective text by the client.
      ...(official && cap.v5 ? { ucPresetId: cap.medium ? "heavy" : "none", qualityPresetId: "none" } : { ucPreset: 3 }),
      ...(!cap.medium ? { cfg_rescale: typeof payload.cfg_rescale === "number" && Number.isFinite(payload.cfg_rescale) ? Math.min(1, Math.max(0, payload.cfg_rescale)) : 0 } : {}),
      params_version: official && cap.v5 ? 4 : 3, dynamic_thresholding: false, controlnet_strength: 1,
      add_original_image: true, legacy_v3_extend: false, noise_schedule: "karras",
      deliberate_euler_ancestral_bug: false, prefer_brownian: true,
      v4_prompt: caption(prompt), v4_negative_prompt: caption(negative, true) } };
}
