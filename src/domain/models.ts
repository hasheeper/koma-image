export interface ModelIdentity {
  id: string; name: string; provider: string; family: string; aliases: string[];
  options?: Record<string, string[]>; inputImages?: number; chat?: boolean; transparentBackground?: boolean;
}
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
  nai("nai-diffusion-4-5-full", "NAI Diffusion 4.5 Full"),
  nai("nai-diffusion-4-5-curated", "NAI Diffusion 4.5 Curated"),
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
  gemini("gemini-3.1-flash-lite-image", "Nano Banana 2 Lite", 1, { options: { image_size: ["1K"] } }),
];
const byName = new Map(MODELS.flatMap(model => [[model.id, model] as const, ...model.aliases.map(alias => [alias, model] as const)]));
export const findModel = (name: string) => byName.get(name) ?? null;
