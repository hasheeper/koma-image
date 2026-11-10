import { seedreamLimits, validateSeedreamSize } from "../domain/seedream.ts";
import type { CatalogModel } from "../domain/catalog.ts";
import { MODELS, configuredModels, imageModelFields } from "../domain/models.ts";
import { object } from "../domain/value.ts";
import { catalogEntries, linkFor } from "../domain/catalog.ts";
import type { Routing } from "../config/connections.ts";
import type { GatewayProfile } from "./profile.ts";
import { profilePath } from "./profile.ts";
import type { ImagePayload } from "./routes.ts";
import { novelaiRequest } from "./novelai-edit.ts";
import { naiOfficialInpaintModel } from "../domain/nai.ts";
import { naiSamplers, NAI_OFFICIAL_MAX_PIXELS } from "../domain/nai-parameters.ts";
import { declaredParameterFields, validParameterKey } from "../domain/model-parameters.ts";
import { validateMarkupImage } from "../domain/image-markup.ts";

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
  // Gemini keeps its native models[] shape even when ASK is enabled.
  const listed = profile.protocol !== "gemini-native";
  const entries = listed ? data.data : data.models;
  if (!Array.isArray(entries)) throw new Error("模型列表不符合所选接口协议");
  for (const entry of entries) {
    const item = object(entry);
    const rawId: unknown = listed ? item.id : item.name ?? item.id;
    if (typeof rawId !== "string") continue;
    const id = profile.protocol === "gemini-native" ? rawId.replace(/^models\//, "") : rawId;
    if (!id.trim() || id.length > 512 || /[\x00-\x1f\x7f]/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) continue;
    const name = typeof item.displayName === "string" ? item.displayName : typeof item.display_name === "string" ? item.display_name : id;
    const capabilities = object(item.image_capabilities);
    models[id] = { name, ...(capabilities.fields && typeof capabilities.fields === "object" && !Array.isArray(capabilities.fields) || typeof capabilities.markup === "boolean" ? { image_capabilities: {
      ...(capabilities.fields && typeof capabilities.fields === "object" && !Array.isArray(capabilities.fields)
        ? { fields: declaredParameterFields(capabilities.fields) } : {}),
      ...(typeof capabilities.markup === "boolean" ? { markup: capabilities.markup } : {}),
    } } : {}) };
  }
  if (!Object.keys(models).length) throw new Error("连接没有返回模型 ID");
  return { models };
}

/** Capabilities follow the chosen application model, never an upstream alias's spelling. */
export function nativeMappedCatalog(profile: GatewayProfile, raw: Record<string, unknown>, routing: Routing, connection: string) {
  const standard = !profile.protocol || profile.protocol === "standard";
  if (!standard && profile.protocol !== "openai-images" && profile.protocol !== "gemini-native" && profile.protocol !== "seedream") return raw;
  const entries = catalogEntries(raw);
  const models: Record<string, unknown> = Object.assign(Object.create(null), standard ? object(raw.models) : {});
  for (const model of configuredModels(routing).filter(m => ["gpt", "gemini", "seedream"].includes(m.family))) {
    const link = linkFor(routing, connection, model, entries);
    if (!link?.on || (!link.manual && !Object.hasOwn(object(raw.models), link.id))) continue;
    const fields = imageModelFields(model, standard ? model.family === "gpt" : profile.protocol === "openai-images");
    if (standard && Object.hasOwn(models, link.id)) {
      const meta = object(models[link.id]), capabilities = object(meta.image_capabilities);
      if (model.family === "seedream" && !Object.hasOwn(capabilities, "fields")) {
        models[link.id] = { ...meta, image_capabilities: { ...capabilities, fields, source: "reference" } };
        continue;
      }
      // Existing explicit defaults remain readable; fresh capability declarations take priority.
      const defaults = Object.fromEntries(Object.entries(fields).filter(([key]) => model.defaults?.[key]));
      models[link.id] = { ...meta, image_capabilities: { ...capabilities, fields: { ...defaults, ...object(capabilities.fields) } } };
      continue;
    }
    const metadata = object(object(raw.models)[link.id]), declared = object(metadata.image_capabilities);
    const hasDeclaration = Object.hasOwn(declared, "fields");
    models[link.id] = {
      name: model.name,
      provider: model.provider, editor_family: model.family,
      operations: ["generate", "edit"], tools: ["image-edit"], chat: true,
      max_context_images: model.inputImages ?? 16,
      ...(model.family === "seedream" ? { max_resolution: seedreamLimits(model.templateId ?? model.id)?.maxPixels ?? 4_624_220 } : {}),
      image_capabilities: { fields: hasDeclaration ? declared.fields : fields, source: hasDeclaration ? "declared" : "reference",
        ...(typeof declared.markup === 'boolean' ? { markup: declared.markup } : {}) },
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

export function nativeRequest(profile: GatewayProfile, payload: ImagePayload, model?: Pick<CatalogModel, "templateId" | "maxImages">) {
  if (payload.markup_image !== undefined) {
    if (profile.protocol !== "openai-images" || payload.tool !== "image-edit") throw new Error("此操作不支持原生标注");
    if (payload.mask_image) throw new Error("原生标注不能与接口蒙版同时上传");
    validateMarkupImage(payload.init_image, payload.markup_image);
  }
  if (profile.protocol === "novelai") return novelaiRequest(payload);
  if (payload.referencePlan || payload.preparedReferences) throw new Error("此连接未声明 NAI 参考生成协议");
  if (payload.tool && payload.tool !== "image-edit")
    throw new Error("此协议仅支持参考图编辑");
  const input = images(payload), options = object(payload.image_options);
  const path = profilePath(profile, payload.tool ? "toolRun" : "generate");
  if (profile.protocol === "seedream") {
    if (!payload.model?.trim() || payload.model.length > 512 || /[\x00-\x1f\x7f]/.test(payload.model)) throw new Error("模型 ID 无效");
    const templateId = model?.templateId ?? payload.model;
    const limit = model?.maxImages ?? seedreamLimits(templateId)?.images ?? 10;
    if (input.length > limit) throw new Error(`本模型最多带入 ${limit} 张图片（包含底图）`);
    const body: Record<string, unknown> = { model: payload.model, prompt: String(payload.prompt || ""), response_format: "b64_json" };
    for (const [key, value] of Object.entries(options)) {
      if (value === "") continue;
      if (key === "response_format") {
        if (value !== "b64_json") throw new Error("Seedream 当前使用 b64_json 返回图片");
        continue;
      }
      if (!validParameterKey(key) || !["string", "number", "boolean"].includes(typeof value)) throw new Error(`Seedream 参数 ${key} 无效`);
      if (key === 'layer_decomposition' && value !== false || key === 'sequential_image_generation' && value !== 'disabled')
        throw new Error('Seedream 当前接入单图生成与参考图编辑，尚未接入图层拆分或组图');
      setParameter(body, key, value);
    }
    validateSeedreamSize(body.size, templateId);
    if (input.length) body.image = input.length === 1 ? payload.init_image : [payload.init_image, ...(payload.additional_images as string[] ?? [])];
    return { path, body, native: false };
  }
  if (profile.protocol === "openai-images") {
    if (!payload.model?.trim() || payload.model.length > 512 || /[\x00-\x1f\x7f]/.test(payload.model)) throw new Error("模型 ID 无效");
    if (input.length > 16) throw new Error("最多使用 16 张参考图");
    const body: Record<string, unknown> = { model: payload.model, prompt: String(payload.prompt || ""), n: 1 };
    for (const [key, value] of Object.entries(options)) {
      if (value === "") continue;
      if (!validParameterKey(key) || !["string", "number", "boolean"].includes(typeof value)) throw new Error(`Images 参数 ${key} 无效`);
      setParameter(body, key, value);
    }
    if (!input.length) return { path, body, native: false };
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    for (const [index, image] of input.entries()) {
      const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
      form.append("image[]", new Blob([bytes], { type: image.mimeType }), `reference-${index + 1}.${image.mimeType.split("/")[1]}`);
    }
    if (payload.markup_image !== undefined) {
      const markup = imageData(payload.markup_image), bytes = Uint8Array.from(atob(markup.data), c => c.charCodeAt(0));
      form.set("markup", new Blob([bytes], { type: "image/png" }), "annotations.png");
    }
    return { path, body: form, native: false };
  }
  if (profile.protocol === "gemini-native") {
    const imageConfig: Record<string, unknown> = {};
    if (typeof options.aspect_ratio === "string" && options.aspect_ratio) imageConfig.aspectRatio = options.aspect_ratio;
    const size = options.image_size ?? options.output_size;
    if (typeof size === "string" && size && size !== "original") imageConfig.imageSize = size.toUpperCase();
    const generationConfig: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) };
    for (const [key, value] of Object.entries(options)) {
      if (["aspect_ratio", "image_size", "output_size"].includes(key) || value === "") continue;
      if (!validParameterKey(key) || !["string", "number", "boolean"].includes(typeof value)) throw new Error(`Gemini 参数 ${key} 无效`);
      setParameter(generationConfig, key, value);
    }
    return { path, model: payload.model, native: false, body: {
      contents: [{ role: "user", parts: [{ text: String(payload.prompt || "") }, ...input.map(inlineData => ({ inlineData }))] }],
      generationConfig,
    } };
  }
  throw new Error("接口协议无效");
}

/** Gemini extension paths are relative to generationConfig; Images paths are relative to its body. */
function setParameter(target: Record<string, unknown>, key: string, value: unknown) {
  const path = key.split(".");
  for (const part of path.slice(0, -1)) {
    if (target[part] !== undefined && (typeof target[part] !== "object" || Array.isArray(target[part]))) throw new Error(`参数路径 ${key} 冲突`);
    target[part] ??= {};
    target = target[part] as Record<string, unknown>;
  }
  const leaf = path.at(-1)!;
  if (Object.hasOwn(target, leaf)) throw new Error(`参数路径 ${key} 冲突`);
  target[leaf] = value;
}
