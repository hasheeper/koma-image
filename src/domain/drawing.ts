import type { CatalogModel } from "./catalog.ts";
import type { FavoriteRecord } from "../storage/records.ts";
import type { ImagePayload } from "../gateway/routes.ts";
import { naiPrompt } from "../gateway/routes.ts";
export const DEFAULTS = {
  prompt: "",
  negative: "",
  model: "nai-diffusion-5-full",
  sampler: "k_euler_ancestral",
  width: 832,
  height: 1216,
  steps: 25,
  scale: 5,
  cfg: 10,
  seed: "",
  batchCount: 1,
  optimize: false,
  serverCache: false,
  transparentBg: false,
  localCache: true,
  historyLimit: 25,
  tagSuggest: true,
};
export type DrawingForm = typeof DEFAULTS;
export type DrawingParams = Pick<
  DrawingForm,
  | "prompt"
  | "model"
  | "sampler"
  | "width"
  | "height"
  | "steps"
  | "scale"
  | "cfg"
  | "batchCount"
  | "optimize"
> & { cache: boolean; transform_prompt: false } & {
  seed: number;
  basePrompt: string;
  modelName: string;
  negative_prompt: string;
  randomSeed: boolean;
  transparentBg: boolean;
  batchIndex?: number;
  batchTotal?: number;
};
export interface ImageRecord extends Omit<FavoriteRecord, "favoritedAt"> {
  favoritedAt?: number;
}
export type Tier = "s" | "m" | "l";
export type Orientation = "portrait" | "square" | "landscape";
export const RATIOS = ["2:3", "3:4", "4:5", "9:16", "1:2"];
const portrait: Record<Tier, Record<string, [number, number]>> = {
  s: {
    "2:3": [512, 768],
    "1:1": [640, 640],
    "3:4": [576, 768],
    "4:5": [576, 704],
    "9:16": [448, 768],
    "1:2": [448, 896],
  },
  m: {
    "2:3": [832, 1216],
    "1:1": [1024, 1024],
    "3:4": [896, 1152],
    "4:5": [896, 1088],
    "9:16": [768, 1344],
    "1:2": [704, 1472],
  },
  l: {
    "2:3": [1024, 1536],
    "1:1": [1472, 1472],
    "3:4": [1152, 1536],
    "4:5": [1280, 1600],
    "9:16": [1024, 1792],
    "1:2": [1024, 2048],
  },
};
export const mirror = (shape: string) => shape.split(":").reverse().join(":");
export const sizes = (tier: Tier) =>
  Object.fromEntries(
    Object.entries(portrait[tier]).flatMap(([r, [w, h]]) => [
      [r, [w, h] as [number, number]],
      [mirror(r), [h, w] as [number, number]],
    ]),
  );
export function presetMatch(width: number, height: number) {
  for (const tier of ["s", "m", "l"] as const)
    for (const [shape, [w, h]] of Object.entries(sizes(tier)))
      if (w === width && h === height) return { tier, shape };
  return null;
}
export function closestShape(width: number, height: number, tier: Tier) {
  return Object.entries(sizes(tier)).reduce(
    (best, [shape, [w, h]]) => {
      const distance = Math.abs(
        Math.log((width || 1) / (height || 1) / (w / h)),
      );
      return distance < best.distance ? { shape, distance } : best;
    },
    { shape: "1:1", distance: Infinity },
  ).shape;
}
export function snap(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? Math.min(2048, Math.max(64, Math.round(n / 64) * 64))
    : null;
}
export const count = (value: unknown, minimum = 1) =>
  Number.isFinite(Number(value))
    ? Math.max(minimum, Math.floor(Number(value)) || minimum)
    : minimum;
export function sizeProblem(w: number, h: number, cap = 1048576) {
  const fatal = w < 64 || h < 64 || w * h > cap;
  return {
    fatal,
    message:
      w < 64 || h < 64
        ? "宽高至少 64"
        : w * h > cap
          ? `超出模型上限 ${(cap / 1e6).toFixed(2)}M 像素（约 ${Math.floor(Math.sqrt(cap) / 64) * 64}×${Math.floor(Math.sqrt(cap) / 64) * 64}）`
          : w % 64 || h % 64
            ? "离开输入框后会自动对齐到 64 的倍数"
            : "",
  };
}
export function randomSeed() {
  return typeof globalThis.crypto?.getRandomValues === "function"
    ? crypto.getRandomValues(new Uint32Array(1))[0]
    : Math.floor(Math.random() * 4294967296);
}
export function collect(
  form: DrawingForm,
  model: CatalogModel,
  batchCount: number,
): DrawingParams {
  const basePrompt = form.prompt.trim(),
    transparentBg = form.transparentBg && model.transparentBackground;
  const prompt =
    transparentBg && !/transparent background/i.test(basePrompt)
      ? ["transparent background", basePrompt].filter(Boolean).join(", ")
      : basePrompt;
  return {
    width: form.width,
    height: form.height,
    steps: form.steps,
    sampler: form.sampler,
    scale: form.scale,
    cfg: form.cfg,
    optimize: form.optimize,
    cache: form.serverCache,
    transform_prompt: false,
    prompt,
    basePrompt,
    negative_prompt: form.negative.trim(),
    model: model.id,
    modelName: model.name,
    batchCount,
    randomSeed: form.seed.trim() === "",
    seed:
      form.seed.trim() === ""
        ? randomSeed()
        : Math.min(4294967295, Math.max(0, Math.floor(Number(form.seed)) || 0)),
    transparentBg,
  };
}
export function batchParams(base: DrawingParams, index: number): DrawingParams {
  return {
    ...base,
    seed: base.randomSeed ? randomSeed() : (base.seed + index) % 4294967296,
    batchIndex: index + 1,
    batchTotal: base.batchCount,
  };
}
export function drawingPayload(p: DrawingParams): ImagePayload {
  const {
    negative_prompt,
    model,
    width,
    height,
    steps,
    sampler,
    scale,
    cfg,
    seed,
    optimize,
  } = p;
  return {
    prompt: naiPrompt(p.prompt),
    negative_prompt,
    model,
    width,
    height,
    steps,
    sampler,
    scale,
    cfg,
    seed,
    optimize,
    cache: p.cache,
    transform_prompt: false,
    transform_mode: "off",
  };
}
export function reuseFields(item: ImageRecord) {
  const p = item.params;
  return {
    prompt: p.basePrompt ?? p.prompt ?? "",
    negative_prompt: p.negative_prompt ?? "",
    model: p.model,
    width: p.width,
    height: p.height,
    steps: p.steps,
    scale: p.scale,
    cfg: p.cfg,
    sampler: p.sampler,
    seed: p.isComparison ? (p.seedStart ?? "") : (p.seed ?? ""),
    batchCount: p.batchTotal ?? p.batchCount ?? 1,
  };
}
export function imageFileName(item: ImageRecord) {
  const p = item.params,
    model = String(p.model || "koma-image").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const ext =
    item.blob.type === "image/jpeg"
      ? "jpg"
      : item.blob.type === "image/webp"
        ? "webp"
        : "png";
  return `${model}-${p.isComparison ? `batch-${p.comparisonTotal || p.batchTotal || 1}` : String(p.seed ?? item.id ?? "result").replace(/[^a-zA-Z0-9._-]+/g, "-")}.${ext}`;
}

export const samplerName = (id: unknown) => {
  const value = String(id || "");
  return (
    (
      {
        k_euler_ancestral: "Euler Ancestral",
        k_euler: "Euler",
        k_dpmpp_2m: "DPM++ 2M",
        k_dpmpp_sde: "DPM++ SDE",
        k_dpmpp_2s_ancestral: "DPM++ 2S Ancestral",
        ddim_v3: "DDIM v3",
      } as Record<string, string>
    )[value] || value.replace(/^k_/, "").replaceAll("_", " ")
  );
};
