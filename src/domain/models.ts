export interface ModelIdentity {
  id: string; name: string; provider: string; family: string; aliases: string[];
  options?: Record<string, string[]>; inputImages?: number; chat?: boolean; transparentBackground?: boolean;
  templateId?: string; defaults?: Record<string, string>;
}
/** Saved image entries reuse a known parameter template, with stable local identities. */
export interface ManagedModel { id: string; name: string; templateId: string; defaults: Record<string, string> }
const nai = (id: string, name: string, extra: Partial<ModelIdentity> = {}): ModelIdentity => ({ id, name,
  provider: "novelai", family: "novelai", aliases: [`${id}@local`], ...extra });
const quality = ["auto", "low", "medium", "high"];
const gpt = (id: string, name: string, options = quality): ModelIdentity => ({ id, name, provider: "openai", family: "gpt",
  aliases: [`${id}@local`], options: { quality: options }, inputImages: 16, chat: true });
const gemini = (id: string, name: string, inputImages: number, extra: Partial<ModelIdentity> = {}): ModelIdentity => ({ id, name,
  provider: "gemini", family: "gemini", aliases: [`${id}@local`], inputImages, chat: true, ...extra });

export const MODELS: ModelIdentity[] = [
  nai("nai-diffusion-5-full", "NAI Diffusion V5 Full", { transparentBackground: true }),
  nai("nai-diffusion-5-curated", "NAI Diffusion V5 Curated", { transparentBackground: true }),
  nai("nai-diffusion-4-5-full", "NAI Diffusion V4.5 Full"),
  nai("nai-diffusion-4-5-curated", "NAI Diffusion V4.5 Curated"),
  nai("nai-diffusion-5-full-medium", "NAI Diffusion V5 Full · Medium", { transparentBackground: true }),
  gpt("gpt-image-2", "GPT Image 2"),
  gpt("gpt-image-2-2026-04-21", "GPT Image 2 (2026-04-21)"),
  gpt("gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst", [...quality, "xhigh", "max"]),
  gpt("gpt-image-2.5-flare", "GPT Image 2.5 Flare", [...quality, "xhigh", "max"]),
  gpt("gpt-image-1.5", "GPT Image 1.5"),
  gpt("chatgpt-image-latest", "ChatGPT Image Latest"),
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

export const editablePresets = MODELS.filter(m => m.family === "gpt" || m.family === "gemini");
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
  quality: "质量（Images）", size: "尺寸（Images）", output_format: "格式（Images）",
  aspect_ratio: "比例（Gemini 原生）", image_size: "分辨率（Gemini 原生）",
};
export function imageModelFields(model: ModelIdentity, openai = model.family === "gpt") {
  const options: Record<string, string[]> = openai ? {
    quality: model.options?.quality ?? ["auto", "low", "medium", "high"],
    size: ["auto", "1024x1024", "1536x1024", "1024x1536"], output_format: ["png", "jpeg", "webp"],
  } : {
    aspect_ratio: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    ...(!(model.templateId ?? model.id).startsWith("gemini-2.5-") || model.defaults?.image_size
      ? { image_size: model.options?.image_size ?? ["1K", "2K", "4K"] } : {}),
  };
  return Object.fromEntries(Object.entries(options).map(([key, values]) => {
    const value = model.defaults?.[key] ?? "";
    return [key, { options: [...new Set([...values, ...(value ? [value] : [])])], default: value,
      ...(key === "size" ? { allowCustom: true } : {}) }];
  }));
}
