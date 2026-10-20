import { MODELS } from "../domain/models.ts";
import { object, strings } from "../domain/value.ts";
import { imageDimensions } from "../native/image-dimensions.ts";
import type { GatewayProfile } from "./profile.ts";
import { profilePath } from "./profile.ts";
import { toNativePayload } from "./routes.ts";
import type { ImagePayload } from "./routes.ts";

const field = (options: string[], value = options[0]) => ({ options, default: value });
const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** Adapt public protocol metadata into the application's catalog, without inventing quotes. */
export function nativeCatalog(profile: GatewayProfile, raw: unknown) {
  const data = object(raw), models: Record<string, unknown> = {};
  if (profile.protocol === "novelai") {
    if (typeof data.active !== "boolean" || typeof data.tier !== "number")
      throw new Error("订阅响应不符合 NovelAI 协议");
    if (!data.active) throw new Error("NovelAI 订阅未启用");
    for (const model of MODELS.filter(m => m.provider === "novelai"))
      models[model.id] = { name: model.name, provider: "novelai", editor_family: "novelai", operations: ["generate", "edit"], tools: ["img2img"], max_resolution: 4_194_304 };
    return { models, valid_samplers: ["k_euler_ancestral", "k_euler", "k_dpmpp_2m", "k_dpmpp_2m_sde", "k_dpmpp_sde", "ddim_v3"], catalog_source: "static", verification: "unverified" };
  }
  const entries = profile.protocol === "openai-images" ? data.data : data.models;
  if (!Array.isArray(entries)) throw new Error("模型列表不符合所选接口协议");
  for (const entry of entries) {
    const item = object(entry);
    const id = String(profile.protocol === "openai-images" ? item.id || "" : item.name || "").replace(/^models\//, "");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,191}$/.test(id)) continue;
    const openai = profile.protocol === "openai-images";
    if (openai ? !/^(gpt-image-|chatgpt-image-)/.test(id)
      : !/^gemini-.*image/.test(id) || !strings(item.supportedGenerationMethods).includes("generateContent")) continue;
    const fields = openai ? {
      quality: field(["auto", "low", "medium", "high"], "auto"),
      size: field(["auto", "1024x1024", "1536x1024", "1024x1536"], "auto"),
      output_format: field(["png", "jpeg", "webp"], "png"),
    } : {
      aspect_ratio: field(ratios, "1:1"),
      ...(!id.startsWith("gemini-2.5-") ? { image_size: field(["1K", "2K", "4K"], "1K") } : {}),
    };
    models[id] = {
      name: item.displayName || MODELS.find(m => m.id === id)?.name || id,
      provider: openai ? "openai" : "gemini", editor_family: openai ? "gpt" : "gemini",
      operations: ["generate", "edit"], tools: ["image-edit"], chat: true,
      max_context_images: openai ? 16 : id.startsWith("gemini-2.5-") ? 3 : 14,
      image_capabilities: { fields },
    };
  }
  if (!Object.keys(models).length) throw new Error("此连接没有支持的图像模型");
  return { models };
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
  if (profile.protocol !== "novelai" && payload.tool && payload.tool !== "image-edit")
    throw new Error("此协议仅支持参考图编辑");
  const input = images(payload), options = object(payload.image_options);
  const path = profilePath(profile, payload.tool ? "toolRun" : "generate");
  if (profile.protocol === "openai-images") {
    if (!/^(gpt-image-|chatgpt-image-)/.test(payload.model)) throw new Error("请选择 GPT Image 模型");
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
    if (!/^gemini-.*image/.test(payload.model)) throw new Error("请选择 Gemini 图像模型");
    const imageConfig: Record<string, string> = {};
    if (typeof options.aspect_ratio === "string") imageConfig.aspectRatio = options.aspect_ratio;
    const size = options.image_size ?? options.output_size;
    if (typeof size === "string" && size !== "original") imageConfig.imageSize = size.toUpperCase();
    return { path, model: payload.model, native: false, body: {
      contents: [{ role: "user", parts: [{ text: String(payload.prompt || "") }, ...input.map(inlineData => ({ inlineData }))] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) },
    } };
  }
  if (profile.protocol === "novelai") {
    if (input.length > 1 || payload.tool && payload.tool !== "img2img") throw new Error("NovelAI 基础接入仅支持生图与单图图生图");
    const size = input.length ? imageDimensions(String(payload.init_image)) : {};
    const body = toNativePayload({ ...payload, ...size });
    // max_cost belongs to the standard gateway, not the official protocol.
    const { max_cost: _cost, ...wire } = body;
    if (input.length) {
      wire.action = "img2img";
      Object.assign(wire.parameters, { image: input[0].data, strength: payload.strength, noise: payload.noise });
    }
    return { path, body: wire, native: true };
  }
  throw new Error("接口协议无效");
}
