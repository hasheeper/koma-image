import { emptyReferences, readReferences, referencePlan } from "./nai-references.ts";
import { resolveModel } from "./catalog.ts";
import type { CatalogModel } from "./catalog.ts";
import type { FavoriteRecord } from "../storage/records.ts";
import type { ImagePayload } from "../gateway/routes.ts";
import { naiPrompt } from "../gateway/routes.ts";
import { activeCharacters, readCharacters, nextCharacterId, sameValue } from "./characters.ts";
import type { Character, Placement } from "./characters.ts";
import { naiCapabilities, qualityTags, negativeTags, appendNaiTags, prependNaiTag, readNaiSettings, naiModes, naiModePrompt, effectiveNaiMode, complexities, qualityPresets, negativePresets } from "./nai.ts";
export const DEFAULTS = {
  prompt: "",
  negative: "",
  model: "nai-diffusion-5-full",
  sampler: "k_euler_ancestral",
  width: 832,
  height: 1216,
  steps: 25,
  scale: 5,
  cfg: 10, // Legacy standard-gateway field; never interpreted as Guidance Rescale.
  ...readNaiSettings({}),
  seed: "",
  batchCount: 1,
  optimize: false,
  transparentBg: false,
  localCache: true,
  historyLimit: 25,
  tagSuggest: true,
  naiReferences: emptyReferences(),
  characters: [] as Character[],
  placement: "auto" as Placement,
};
export type DrawingForm = typeof DEFAULTS;
export const boardKeys = ["prompt", "negative", "model", "sampler", "width", "height", "steps", "scale", "cfg", "cfgRescale", "naiMode", "complexity", "qualityPreset", "negativePreset", "seed", "batchCount", "optimize", "transparentBg", "characters", "placement", "naiReferences"] as const;
export type BoardForm = Pick<DrawingForm, typeof boardKeys[number]>;
export interface DrawingBoard { id: string; name: string; color: string; nextCharacterId: number; form: BoardForm }
export interface Boards { activeId: string; items: DrawingBoard[] }
export const boardColors = ["#b3a1ff", "#7bc4a8", "#e0ab68", "#7bb7ef", "#e58fb0", "#9fd17a"];
export const boardForm = (form: DrawingForm): BoardForm => structuredClone(Object.fromEntries(boardKeys.map(k => [k, form[k]]))) as BoardForm;
export function readBoards(value: unknown): Boards {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = root.boards && typeof root.boards === "object" ? root.boards as Record<string, unknown> : {};
  const seen = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((entry): DrawingBoard[] => {
    if (!entry || typeof entry !== "object") return [];
    const b = entry as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id || seen.has(b.id)) return [];
    seen.add(b.id);
    const f = { ...DEFAULTS, ...(b.form && typeof b.form === "object" ? b.form : {}) } as DrawingForm;
    Object.assign(f, readNaiSettings(f));
    f.naiReferences = readReferences(f.naiReferences);
    f.characters = readCharacters(f.characters); f.placement = f.placement === "manual" ? "manual" : "auto"; f.seed = String(f.seed ?? "");
    return [{ id: b.id, name: String(b.name || "画板").slice(0, 80), color: boardColors.includes(String(b.color)) ? String(b.color) : boardColors[0],
      nextCharacterId: Math.max(nextCharacterId(f.characters), Number(b.nextCharacterId) || 1), form: boardForm(f) }];
  });
  if (!items.length) {
    const f = { ...DEFAULTS, ...root } as DrawingForm;
    Object.assign(f, readNaiSettings(f));
    f.naiReferences = readReferences(f.naiReferences);
    f.characters = readCharacters(f.characters); f.placement = f.placement === "manual" ? "manual" : "auto"; f.seed = String(f.seed ?? "");
    items.push({ id: "board-1", name: "画板 1", color: boardColors[0], nextCharacterId: nextCharacterId(f.characters), form: boardForm(f) });
  }
  return { activeId: items.some(b => b.id === raw.activeId) ? String(raw.activeId) : items[0].id, items };
}
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
  | "cfgRescale"
  | "naiMode"
  | "complexity"
  | "qualityPreset"
  | "negativePreset"
  | "batchCount"
  | "optimize"
> & { cache: boolean; transform_prompt: false } & {
  seed: number;
  basePrompt: string;
  baseNegative: string;
  modelName: string;
  negative_prompt: string;
  randomSeed: boolean;
  transparentBg: boolean;
  batchIndex?: number;
  batchTotal?: number;
  characters: Character[];
  localCharacters: Character[];
  placement: Placement;
  naiReferences: ReturnType<typeof emptyReferences>;
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
  const cap = naiCapabilities(model.id), settings = readNaiSettings(form);
  const basePrompt = form.prompt.trim(), baseNegative = form.negative.trim();
  const transparentBg = form.transparentBg && model.transparentBackground;
  const qualityPreset = cap.quality.includes(settings.qualityPreset) ? settings.qualityPreset : "none";
  const negativePreset = cap.negative.includes(settings.negativePreset) ? settings.negativePreset : "none";
  const complexity = cap.v5 ? settings.complexity : "none";
  const naiMode = cap.supported ? effectiveNaiMode(settings.naiMode, basePrompt) : "anime";
  const modePrompt = cap.supported ? naiModePrompt(basePrompt, naiMode) : basePrompt;
  let prompt = transparentBg && !/transparent background/i.test(basePrompt)
    ? prependNaiTag(modePrompt, "transparent background") : modePrompt;
  prompt = appendNaiTags(prompt, complexity === "none" ? "" : `${complexity} complexity`);
  prompt = appendNaiTags(prompt, qualityTags(model.id, qualityPreset));
  const characters = activeCharacters(form.characters, model.id).map(c => cap.medium ? { ...c, negative: "" } : c);
  return {
    width: form.width,
    height: form.height,
    steps: cap.medium ? 14 : form.steps,
    sampler: cap.medium ? "k_euler_ancestral" : form.sampler,
    scale: form.scale,
    cfg: form.cfg,
    cfgRescale: cap.medium ? 0 : settings.cfgRescale,
    qualityPreset, negativePreset, complexity, naiMode,
    optimize: form.optimize,
    cache: false,
    transform_prompt: false,
    prompt,
    basePrompt,
    baseNegative,
    negative_prompt: cap.medium ? "" : appendNaiTags(baseNegative, negativeTags(model.id, negativePreset)),
    model: model.id,
    modelName: model.name,
    batchCount,
    randomSeed: form.seed.trim() === "",
    seed:
      form.seed.trim() === ""
        ? randomSeed()
        : Math.min(4294967295, Math.max(0, Math.floor(Number(form.seed)) || 0)),
    transparentBg,
    characters,
    localCharacters: structuredClone(form.characters),
    naiReferences: readReferences(form.naiReferences),
    placement: form.placement,
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
  } = p;
  const references = referencePlan(p.naiReferences);
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
    cfg_rescale: p.cfgRescale,
    seed,
    // Metadata stripping happens locally; the gateway never re-encodes or caches.
    optimize: false,
    cache: false,
    transform_prompt: false,
    transform_mode: "off",
    ...(references ? { referencePlan: references } : {}),
    ...(p.characters.length ? { characters: structuredClone(p.characters), placement: p.placement } : {}),
  };
}
export function reuseFields(item: Pick<ImageRecord, "params">) {
  const p = item.params;
  return {
    ...(p.naiReferences ? { naiReferences: readReferences(p.naiReferences) } : {}),
    prompt: p.basePrompt ?? p.prompt ?? "",
    negative_prompt: p.baseNegative ?? p.negative_prompt ?? "",
    cfgRescale: p.cfgRescale,
    naiMode: p.naiMode ?? "anime",
    complexity: p.basePrompt !== undefined ? p.complexity ?? "none" : "none",
    qualityPreset: p.basePrompt !== undefined ? p.qualityPreset ?? "none" : "none",
    negativePreset: p.baseNegative !== undefined ? p.negativePreset ?? "none" : "none",
    transparentBg: p.transparentBg ?? false,
    model: p.model,
    width: p.width,
    height: p.height,
    steps: p.steps,
    scale: p.scale,
    cfg: p.cfg,
    sampler: p.sampler,
    seed: p.isComparison ? (p.seedStart ?? "") : (p.seed ?? ""),
    batchCount: p.batchTotal ?? p.batchCount ?? 1,
    ...(Array.isArray(p.localCharacters ?? p.characters) ? { characters: readCharacters(p.localCharacters ?? p.characters), placement: p.placement === "manual" ? "manual" : "auto" } : {}),
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

/** Shared by image import and ASK parameter review; preserves existing normalization. */
export function prepareDrawingFields(fields: Record<string, unknown>, models: CatalogModel[], samplers: string[]) {
  const changes: Partial<DrawingForm> = {};
  const applied: string[] = [];
  // Imported effective text already includes its presets; only explicit local metadata restores them.
  if (fields.prompt !== undefined) {
    changes.naiMode = "anime"; changes.qualityPreset = "none"; changes.complexity = "none"; changes.transparentBg = false;
  }
  if (fields.negative_prompt !== undefined) changes.negativePreset = "none";
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === "naiReferences") { changes.naiReferences = readReferences(value); applied.push(key); continue; }
    if (key === "characters" && Array.isArray(value)) { changes.characters = readCharacters(value); applied.push(key); continue; }
    if (key === "placement" && (value === "auto" || value === "manual")) { changes.placement = value; applied.push(key); continue; }
    const target = key === "negative_prompt" ? "negative" : key;
    if (key === "model") {
      const resolved = resolveModel(models, String(value));
      if (resolved) {
        changes.model = resolved.id;
        applied.push(key);
      }
      continue;
    }
    if (key === "transparentBg" && typeof value === "boolean") { changes.transparentBg = value; applied.push(key); continue; }
    const choices = { naiMode: naiModes, complexity: complexities, qualityPreset: qualityPresets, negativePreset: negativePresets };
    if (key in choices) {
      if ((choices[key as keyof typeof choices] as readonly unknown[]).includes(value)) { Object.assign(changes, { [key]: value }); applied.push(key); }
      continue;
    }
    if (key === "sampler" && !samplers.includes(String(value))) continue;
    if (["prompt", "negative", "sampler", "seed"].includes(target)) {
      Object.assign(changes, { [target]: String(value ?? "") });
      applied.push(key);
    }
    if (
      ["width", "height", "steps", "scale", "cfg", "cfgRescale", "batchCount"].includes(
        target,
      ) &&
      Number.isFinite(Number(value))
    ) {
      const range = (
        {
          steps: [1, 50, 1],
          scale: [0, 20, 0.5],
          cfg: [0, 30, 0.5],
          cfgRescale: [0, 1, 0.01],
        } as Record<string, number[]>
      )[target];
      const numeric = range
        ? Math.max(
            range[0],
            Math.min(
              range[1],
              Math.round(Number(value) / range[2]) * range[2],
            ),
          )
        : Number(value);
      Object.assign(changes, { [target]: numeric });
      applied.push(key);
    }
  }
  return { changes, applied };
}

/** Roll back a failed form write without normalizing a later manual choice. */
export function rollbackDrawingEdit(before: DrawingForm, written: DrawingForm, current: DrawingForm, fields: readonly (keyof DrawingForm)[]): DrawingForm {
  const coupled: readonly (keyof DrawingForm)[] = ["model", "sampler", "width", "height"];
  const groupEdited = coupled.some((key) => current[key] !== written[key]);
  const restored = { ...current };
  for (const key of fields) {
    if (!sameValue(current[key], written[key]) || (groupEdited && coupled.includes(key))) continue;
    Object.assign(restored, { [key]: before[key] });
  }
  return restored;
}
