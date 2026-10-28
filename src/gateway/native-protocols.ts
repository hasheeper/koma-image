import { MODELS } from "../domain/models.ts";
import { object } from "../domain/value.ts";
import { catalogEntries, linkFor } from "../domain/catalog.ts";
import type { Routing } from "../config/connections.ts";
import type { GatewayProfile } from "./profile.ts";
import { profilePath } from "./profile.ts";
import type { ImagePayload } from "./routes.ts";
import { novelaiRequest } from "./novelai-edit.ts";
import { naiOfficialInpaintModel } from "../domain/nai.ts";
import { naiSamplers, NAI_OFFICIAL_MAX_PIXELS } from "../domain/nai-parameters.ts";

const field = (options: string[], value = options[0]) => ({ options, default: value });
const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

export function novelaiConnectionLabel(catalog: unknown) {
  const active = object(object(catalog).subscription).active;
  return `Key 有效 · ${active === true ? "订阅已激活" : "未订阅"} · 生图尚未实测`;
}

/** Discovery lists upstream IDs; their use is decided by the existing model mappings. */
export function nativeCatalog(profile: GatewayProfile, raw: unknown) {
  const data = object(raw), models: Record<string, unknown> = {};
  if (profile.protocol === "novelai") {
    if (typeof data.active !== "boolean" || typeof data.tier !== "number")
      throw new Error("订阅响应不符合 NovelAI 协议");
    // Successful account authentication is independent of subscription benefits or balance.
    for (const model of MODELS.filter(m => m.provider === "novelai"))
      models[model.id] = { name: model.name, provider: "novelai", editor_family: "novelai", operations: ["generate", "edit"], tools: ["img2img", ...(naiOfficialInpaintModel(model.id) ? ["inpaint"] : []), "upscale", "director"], max_resolution: NAI_OFFICIAL_MAX_PIXELS };
    return { models, valid_samplers: [...naiSamplers], catalog_source: "static", verification: "unverified", subscription: { active: data.active, tier: data.tier } };
  }
  // OpenAI-style lists, including both reasoning protocols, keep the ID in data[].id.
  const listed = profile.protocol === "openai-images" || !!profile.reasoning;
  const entries = listed ? data.data : data.models;
  if (!Array.isArray(entries)) throw new Error("模型列表不符合所选接口协议");
  for (const entry of entries) {
    const item = object(entry);
    const rawId: unknown = listed ? item.id : item.name ?? item.id;
    if (typeof rawId !== "string") continue;
    const id = profile.protocol === "gemini-native" ? rawId.replace(/^models\//, "") : rawId;
    if (!id.trim() || id.length > 512 || /[\x00-\x1f\x7f]/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) continue;
    const name = typeof item.displayName === "string" ? item.displayName : typeof item.display_name === "string" ? item.display_name : id;
    models[id] = profile.reasoning ? { name } : { name, editor_family: profile.protocol === "openai-images" ? "gpt" : "gemini" };
  }
  if (!Object.keys(models).length) throw new Error("连接没有返回模型 ID");
  return { models };
}

/** Capabilities follow the chosen application model, never an upstream alias's spelling. */
export function nativeMappedCatalog(profile: GatewayProfile, raw: Record<string, unknown>, routing: Routing, connection: string) {
  if (profile.protocol !== "openai-images" && profile.protocol !== "gemini-native") return raw;
  const openai = profile.protocol === "openai-images", entries = catalogEntries(raw);
  const models: Record<string, unknown> = {};
  for (const model of MODELS.filter(m => m.family === (openai ? "gpt" : "gemini"))) {
    const link = linkFor(routing, connection, model, entries);
    if (!link?.on || !Object.hasOwn(object(raw.models), link.id)) continue;
    const fields = openai ? {
      quality: field(["auto", "low", "medium", "high"], "auto"),
      size: field(["auto", "1024x1024", "1536x1024", "1024x1536"], "auto"),
      output_format: field(["png", "jpeg", "webp"], "png"),
    } : {
      aspect_ratio: field(ratios, "1:1"),
      ...(!model.id.startsWith("gemini-2.5-") ? { image_size: field(["1K", "2K", "4K"], "1K") } : {}),
    };
    models[link.id] = {
      name: model.name,
      provider: openai ? "openai" : "gemini", editor_family: openai ? "gpt" : "gemini",
      operations: ["generate", "edit"], tools: ["image-edit"], chat: true,
      max_context_images: model.inputImages ?? 16,
      image_capabilities: { fields },
    };
  }
  return { ...raw, models };
}

function imageData(value: unknown) {
  if (typeof value !== "string") throw new Error("缺少图片数据");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("图片格式无效");
  return { mimeType: match[1], data: match[2] };
}
function images(payload: ImagePayload) {
  if (payload.tool && payload.tool !== "image-edit" && payload.tool !== "img2img")
    throw new Error("此协议尚未支持本次编辑操作");
  if (payload.mask_image) throw new Error("此连接的基础接入暂不支持蒙版");
  if (!payload.tool) return [];
  if (payload.additional_images !== undefined && !Array.isArray(payload.additional_images))
    throw new Error("参考图片格式无效");
  return [payload.init_image, ...(payload.additional_images as unknown[] || [])].map(imageData);
}

export function nativeRequest(profile: GatewayProfile, payload: ImagePayload) {
  if (profile.protocol === "novelai") return novelaiRequest(payload);
  if (payload.referencePlan || payload.preparedReferences) throw new Error("此连接未声明 NAI 参考生成协议");
  if (payload.tool && payload.tool !== "image-edit")
    throw new Error("此协议仅支持参考图编辑");
  const input = images(payload), options = object(payload.image_options);
  const path = profilePath(profile, payload.tool ? "toolRun" : "generate");
  if (profile.protocol === "openai-images") {
    if (!payload.model?.trim() || payload.model.length > 512 || /[\x00-\x1f\x7f]/.test(payload.model)) throw new Error("模型 ID 无效");
    if (input.length > 16) throw new Error("最多使用 16 张参考图");
    const body: Record<string, string | number> = { model: payload.model, prompt: String(payload.prompt || ""), n: 1 };
    for (const key of ["size", "quality", "output_format"])
      if (typeof options[key] === "string") body[key] = options[key];
    if (!input.length) return { path, body, native: false };
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) form.set(key, String(value));
    for (const [index, image] of input.entries()) {
      const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
      form.append("image[]", new Blob([bytes], { type: image.mimeType }), `reference-${index + 1}.${image.mimeType.split("/")[1]}`);
    }
    return { path, body: form, native: false };
  }
  if (profile.protocol === "gemini-native") {
    const imageConfig: Record<string, string> = {};
    if (typeof options.aspect_ratio === "string") imageConfig.aspectRatio = options.aspect_ratio;
    const size = options.image_size ?? options.output_size;
    if (typeof size === "string" && size !== "original") imageConfig.imageSize = size.toUpperCase();
    return { path, model: payload.model, native: false, body: {
      contents: [{ role: "user", parts: [{ text: String(payload.prompt || "") }, ...input.map(inlineData => ({ inlineData }))] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) },
    } };
  }
  throw new Error("接口协议无效");
}
