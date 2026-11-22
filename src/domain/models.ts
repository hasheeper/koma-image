import { SEEDREAM_LITE, SEEDREAM_PRO, SEEDREAM_FLASH, SEEDREAM_55, seedreamFields } from './seedream.ts';
import type { ParameterField, ParameterFields } from './model-parameters.ts';

export interface ModelIdentity {
  id: string; name: string; provider: string; family: string; aliases: string[];
  options?: Record<string, string[]>; inputImages?: number; chat?: boolean; transparentBackground?: boolean;
  templateId?: string; defaults?: Record<string, string>;
  parameters?: ParameterFields;
  referenceNote?: string;
}
/** Saved image entries reuse a known parameter template, with stable local identities. */
export interface ManagedModel { id: string; name: string; templateId: string; defaults: Record<string, string> }
const nai = (id: string, name: string, extra: Partial<ModelIdentity> = {}): ModelIdentity => ({ id, name,
  provider: "novelai", family: "novelai", aliases: [`${id}@local`], ...extra });
const quality = ["auto", "low", "medium", "high"];
const markup: ParameterField = { type: 'boolean', options: ['true', 'false'], default: 'true' };
const gpt = (id: string, name: string, options: Record<string, string[]> = { quality }, parameters?: ParameterFields): ModelIdentity => ({ id, name, provider: "openai", family: "gpt",
  aliases: [`${id}@local`], options, inputImages: 16, chat: true, ...(parameters ? { parameters } : {}) });
const gemini = (id: string, name: string, inputImages: number, extra: Partial<ModelIdentity> = {}): ModelIdentity => ({ id, name,
  provider: "gemini", family: "gemini", aliases: [`${id}@local`], inputImages, chat: true, ...extra });

const seedream = (id: string, name: string, inputImages: number, extra: Partial<ModelIdentity> = {}): ModelIdentity => ({
  id, name, provider: "seedream", family: "seedream", aliases: [], inputImages, chat: true, ...extra,
});

export const MODELS: ModelIdentity[] = [
  nai("nai-diffusion-5-full", "NAI Diffusion V5 Full", { transparentBackground: true }),
  nai("nai-diffusion-5-curated", "NAI Diffusion V5 Curated", { transparentBackground: true }),
  nai("nai-diffusion-4-5-full", "NAI Diffusion V4.5 Full"),
  nai("nai-diffusion-4-5-curated", "NAI Diffusion V4.5 Curated"),
  nai("nai-diffusion-5-full-medium", "NAI Diffusion V5 Full · Medium", { transparentBackground: true }),
  gpt("gpt-image-2", "GPT Image 2"),
  gpt("gpt-image-2-2026-04-21", "GPT Image 2 (2026-04-21)"),
  gpt("gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst", { quality: [...quality, "xhigh", "max"] }, { markup }),
  gpt("gpt-image-2.5-flare", "GPT Image 2.5 Flare", { quality: [...quality, "xhigh", "max"] }, { markup }),
  gpt("gpt-image-2.6-sunburst", "GPT Image 2.6 Sunburst", { quality: [...quality, "xhigh", "max"], complexity: ["low", "medium", "high"] }, { markup }),
  gpt("gpt-image-2.6-flare", "GPT Image 2.6 Flare", { quality: [...quality, "xhigh", "max"], complexity: ["low", "medium", "high"] }, { markup }),
  gpt("gpt-image-1.5", "GPT Image 1.5"),
  gpt("chatgpt-image-latest", "ChatGPT Image Latest"),
  seedream(SEEDREAM_LITE, "Seedream 5.0 Lite", 14, { aliases: ["doubao-seedream-5-0-lite-260128"] }),
  seedream(SEEDREAM_PRO, "Seedream 5.0 Pro", 10),
  seedream(SEEDREAM_FLASH, "Seedream 5.0 Flash", 10),
  seedream(SEEDREAM_55, "Seedream 5.5", 10, {
    aliases: ["doubao-seedream-5-5", "dola-seedream-5-5-261028"],
    referenceNote: "5.5 支持原生透明背景（需搭配 PNG 格式）；其余 API 参数待核验，请绑定供应商实际提供的模型 ID，当前基础参数为参考值。",
  }),
  gemini("gemini-2.5-flash-image", "Nano Banana", 3),
  gemini("gemini-3-pro-image", "Nano Banana Pro", 14),
  gemini("gemini-3-pro-image-preview", "Nano Banana Pro Preview", 14),
  gemini("gemini-3.1-flash-image", "Nano Banana 2", 14),
  gemini("gemini-3.1-flash-image-preview", "Nano Banana 2 Preview", 14),
  gemini("gemini-nano-banana-2.1", "Nano Banana 2.1", 14),
  gemini("gemini-3.1-flash-lite-image", "Nano Banana 2 Lite", 1, { options: { image_size: ["1K"] } }),
];
const byName = new Map(MODELS.flatMap(model => [[model.id, model] as const, ...model.aliases.map(alias => [alias, model] as const)]));
export const findModel = (name: string) => byName.get(name) ?? null;

export const editablePresets = MODELS.filter(m => ["gpt", "gemini", "seedream"].includes(m.family));
export const initialModelEntries = (): ManagedModel[] => editablePresets.map(m => ({ id: m.id, name: m.name, templateId: m.id, defaults: {} }));
export function configuredModels(configuration: { models?: readonly ManagedModel[] }): ModelIdentity[] {
  return [...MODELS.filter(m => m.family === "novelai"),
    ...(configuration.models ?? initialModelEntries()).map(entry => ({
      ...findModel(entry.templateId)!, ...entry,
      aliases: entry.id === entry.templateId ? findModel(entry.templateId)!.aliases : [],
    }))];
}
export function removedModel(configuration: { models?: readonly ManagedModel[] }, id: string) {
  return !!configuration.models && !configuredModels(configuration).some(m => m.id === id || m.aliases.includes(id)) &&
    (id.startsWith("model-") || editablePresets.some(m => m.id === id || m.aliases.includes(id)));
}
export const parameterLabels: Record<string, string> = {
  quality: "质量（Images）", complexity: "复杂度（Images）", size: "尺寸（Images）", background: "背景（Seedream / Images）", output_format: "格式（Images）",
  watermark: "水印（Seedream）",
  aspect_ratio: "比例（Gemini 原生）", image_size: "分辨率（Gemini 原生）",
};
export function imageModelFields(model: ModelIdentity, openai = model.family === "gpt"): ParameterFields {
  if (model.family === 'seedream') {
    const fields = seedreamFields(model.templateId ?? model.id);
    for (const [key, value] of Object.entries(model.defaults ?? {})) if (fields[key]) fields[key] = { ...fields[key], default: value };
    return fields;
  }
  const defaults: Record<string, string> = openai ? { quality: 'auto', size: 'auto', output_format: 'png', complexity: 'high' } : {};
  const options: Record<string, string[]> = openai ? {
    quality: model.options?.quality ?? ["auto", "low", "medium", "high"],
    ...(model.options?.complexity ? { complexity: model.options.complexity } : {}),
    size: ["auto", "1024x1024", "1536x1024", "1024x1536"], output_format: ["png", "jpeg", "webp"],
  } : {
    aspect_ratio: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    ...(!(model.templateId ?? model.id).startsWith("gemini-2.5-") || model.defaults?.image_size
      ? { image_size: model.options?.image_size ?? ["1K", "2K", "4K"] } : {}),
  };
  const fields: ParameterFields = Object.fromEntries(Object.entries(options).map(([key, values]) => {
    const value = model.defaults?.[key] || defaults[key] || "";
    return [key, { options: [...new Set([...values, ...(value ? [value] : [])])], default: value,
      ...(key === "size" ? { allowCustom: true } : {}) }];
  }));
  const configured = openai ? Object.fromEntries(Object.entries(model.parameters ?? {}).map(([key, field]) => [key, { ...field, options: [...field.options] }])) : {};
  return { ...fields, ...configured };
}
