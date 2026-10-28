import { normalizeOptions } from "./catalog.ts";
import type { CatalogModel } from "./catalog.ts";
import { imageDimensions } from "../native/image-dimensions.ts";
import { naiCapabilities, compileNaiPrompt, NAI_OFFICIAL_UPSCALE, NAI_OFFICIAL_EDIT_MAX_PIXELS } from "./nai.ts";
import { modelSamplers, naiSamplers, naiNoiseSchedule, editStrengthRange, validateNaiParameters } from "./nai-parameters.ts";
import type { WireNoiseSchedule, NoiseSchedule } from "./nai-parameters.ts";
import { naiEnhanceSize, naiEnhancePrompt, supportsNaiEnhance } from "./nai-enhance.ts";
import { readInpaintFocus, supportsFocusedInpaint } from "./inpaint-focus.ts";
import type { InpaintFocus } from "./inpaint-focus.ts";
import type { EnhanceScale } from "./nai-enhance.ts";

export type EditMode = "img2img" | "inpaint";
export type EditorMode = EditMode | "upscale";
import type { NaiSettings } from "./nai.ts";

export interface EditorFields extends Partial<NaiSettings> {
  transparentBg?: boolean;
  prompt?: string;
  negative_prompt?: string;
  sampler?: string;
  steps?: number;
  scale?: number;
  cfgRescale?: number;
  seed?: number;
  strength?: number;
  noise?: number;
  detail?: string;
  options?: Record<string, string>;
  enhance?: boolean;
  enhanceScale?: EnhanceScale;
  enhanceMagnitude?: number | null;
  inpaintFocus?: InpaintFocus;
}
type ModelCatalog = { models: CatalogModel[] };
type PayloadBase = {
  model: string;
  prompt: string;
  cache: false;
  transform_prompt: false;
  transform_mode: "off";
};
export type ChatPayload = PayloadBase & { image_options: Record<string, string> } & (
  | { tool?: never; init_image?: never; additional_images?: never }
  | { tool: "image-edit"; init_image: string; additional_images: string[] }
);
export type UpscalePayload = PayloadBase & {
  init_image: string;
  mask_image?: never;
  max_cost?: number;
} & (
  | { tool: "upscale"; image_options?: never }
  | { tool: "image-edit"; image_options: Record<string, string> }
);
type EditNumbers = Required<Pick<EditorFields, "steps" | "scale" | "seed" | "strength" | "noise">>;
export type NAIEditPayload = PayloadBase & EditNumbers & {
  init_image: string;
  negative_prompt: string;
  sampler: string;
  noise_schedule: WireNoiseSchedule;
  noiseSchedule?: NoiseSchedule;
  varietyPlus?: boolean;
  cfg_rescale?: number;
  max_cost?: number;
  width?: number;
  height?: number;
  enhance?: true;
  enhanceScale?: EnhanceScale;
  enhanceMagnitude?: number | null;
  inpaintFocus?: InpaintFocus;
} & (
  | { tool: "img2img"; mask_image?: never }
  | { tool: "inpaint"; mask_image: string }
);
export type EditorPayload = NAIEditPayload | UpscalePayload;
type EditSettings = Omit<EditorFields, "detail" | "options">;
type UpscaleInput = {
  model: string;
  tool: "upscale" | "image-edit";
  init_image?: string;
  prompt?: string;
  image_options?: Record<string, string>;
  additional_images?: unknown;
  mask_image?: string | null;
  max_cost?: unknown;
};
type NAIEditInput = EditSettings & {
  model: string;
  tool: EditMode;
  init_image?: string;
  mask_image?: string | null;
  additional_images?: unknown;
  max_cost?: unknown;
};

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const NAI_UPSCALE_MAX_PIXELS = 1_048_576;
export const naiUpscaleLimit = (model: CatalogModel) => model.profileId === "nai-official-v1" ? NAI_OFFICIAL_UPSCALE.maxPixels : NAI_UPSCALE_MAX_PIXELS;
const DEFAULT_UPSCALE_PROMPT =
  "Upscale the image while preserving the original composition, colors and details.";
export function chatModels(catalog: ModelCatalog): CatalogModel[] {
  return catalog.models.filter(
    (m) =>
      m.chat &&
      m.operations.includes("generate") &&
      m.operations.includes("edit"),
  );
}

export function isDedicatedUpscaler(model?: CatalogModel): boolean {
  return (
    model?.provider === "fal" &&
    model.operations.includes("edit") &&
    model.tools.includes("image-edit") &&
    /upscal|super[-_ ]?resolution/i.test(`${model.id} ${model.name}`)
  );
}

export function upscaleModels(catalog: ModelCatalog): CatalogModel[] {
  return catalog.models.filter(
    (m) =>
      (m.provider === "novelai" && m.tools.includes("upscale")) ||
      isDedicatedUpscaler(m),
  );
}

export function buildUpscalePayload(
  model: CatalogModel,
  image: string | undefined,
  options: Record<string, string> = {},
  prompt = "",
): UpscalePayload {
  return validateUpscalePayload(
    {
      model: model.id,
      tool: model.provider === "novelai" ? "upscale" : "image-edit",
      init_image: image,
      image_options: options,
      prompt,
    },
    { models: [model] },
  );
}

function validateUpscalePayload(
  input: UpscaleInput,
  catalog: ModelCatalog,
  { execution = false } = {},
): UpscalePayload {
  const model = upscaleModels(catalog).find((m) => m.id === input.model);
  if (
    !model ||
    input.tool !== (model.provider === "novelai" ? "upscale" : "image-edit")
  )
    throw new Error("请选择支持本次放大的模型");
  if (
    input.additional_images !== undefined &&
    (!Array.isArray(input.additional_images) || input.additional_images.length)
  )
    throw new Error("放大只接受一张源图");
  if (input.mask_image) throw new Error("放大不支持蒙版");
  const image = input.init_image;
  if (
    typeof image !== "string" ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
  )
    throw new Error("仅接受 PNG、JPEG、WebP 图片数据");
  const encoded = image.slice(image.indexOf(",") + 1);
  const bytes =
    encoded.length * 0.75 -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > MAX_INPUT_BYTES)
    throw new Error("源图不超过 8MB，请缩小后重新上传");
  const size = imageDimensions(image),
    pixels = size.width * size.height;
  if (model.provider === "novelai" && pixels > naiUpscaleLimit(model))
    throw new Error(
      `NAI 放大源图面积最多 ${naiUpscaleLimit(model).toLocaleString("en-US")} 像素，请改用专用放大模型`,
    );
  if (pixels > model.sourceMaxPixels)
    throw new Error(
      `源图超过模型上限 ${model.sourceMaxPixels.toLocaleString()} 像素`,
    );
  const prompt = input.prompt ?? "";
  if (typeof prompt !== "string" || prompt.length > 24_000)
    throw new Error("描述长度无效");
  const out: PayloadBase & { tool: UpscaleInput["tool"]; init_image: string } = {
    model: model.id,
    tool: input.tool,
    init_image: image,
    prompt:
      model.provider === "novelai"
        ? prompt
        : prompt.trim() || DEFAULT_UPSCALE_PROMPT,
    cache: false,
    transform_prompt: false,
    transform_mode: "off",
  };
  let payload: UpscalePayload;
  if (model.provider !== "novelai") {
    const opts = input.image_options || {};
    for (const [key, value] of Object.entries(opts))
      if (!model.fields[key]?.options.includes(value))
        throw new Error(`参数 ${key} 不受模型支持`);
    payload = Object.assign(out, { tool: "image-edit" as const, image_options: normalizeOptions(model, opts) });
  } else payload = Object.assign(out, { tool: "upscale" as const });
  if (execution) {
    if (
      typeof input.max_cost !== "number" ||
      !Number.isFinite(input.max_cost) ||
      input.max_cost < 0
    )
      throw new Error("缺少有效的费用上限，请先获取报价");
    payload.max_cost = input.max_cost;
  }
  return payload;
}

export function buildChatPayload(
  model: CatalogModel,
  prompt: string,
  options: Record<string, string>,
  images: string[] = [],
): ChatPayload {
  if (!prompt.trim()) throw new Error("请填写描述或修改要求");
  if (prompt.length > 24_000)
    throw new Error("上下文过长，请减少带入轮次或新建对话");
  const operation = images.length ? "edit" : "generate";
  if (!model.operations.includes(operation))
    throw new Error("模型不支持本次操作");
  if (images.length > model.maxImages)
    throw new Error(`本模型最多带入 ${model.maxImages} 张图片（包含底图）`);
  const image_options = normalizeOptions(model, options);
  if (operation === "edit" && model.family === "gemini") {
    // Studio's edit endpoint uses output_size instead of generation's image_size.
    image_options.output_size =
      image_options.image_size?.toLowerCase() || "original";
    delete image_options.image_size;
  }
  const payload: PayloadBase & { image_options: Record<string, string> } = {
    model: model.id,
    prompt,
    image_options,
    cache: false,
    transform_prompt: false,
    transform_mode: "off",
  };
  if (images.length)
    return Object.assign(payload, {
      tool: "image-edit" as const,
      init_image: images[0],
      additional_images: images.slice(1),
    });
  return payload;
}

export function naiEditModels(catalog: ModelCatalog, tool = "img2img"): CatalogModel[] {
  return catalog.models.filter(
    (m) =>
      m.provider === "novelai" &&
      m.operations.includes("edit") &&
      m.tools.includes(tool),
  );
}

export function buildNAIEditPayload(
  model: CatalogModel,
  tool: EditMode,
  image: string | undefined,
  settings: EditSettings = {},
  mask?: string | null,
  samplers: readonly string[] = naiSamplers,
): NAIEditPayload {
  return validateNAIEditPayload(
    {
      ...settings,
      model: model.id,
      tool,
      init_image: image,
      ...(mask ? { mask_image: mask } : {}),
    },
    { models: [model], samplers: modelSamplers(model, samplers) },
  );
}

function validateNAIEditPayload(
  input: NAIEditInput,
  catalog: ModelCatalog & { samplers: string[] },
  { execution = false } = {},
): NAIEditPayload {
  if (!["img2img", "inpaint"].includes(input.tool))
    throw new Error("仅支持图生图与局部重绘");
  const model = naiEditModels(catalog, input.tool).find(
    (m) => m.id === input.model,
  );
  if (!model) throw new Error("请选择支持本次图生图或局部重绘的 NAI 模型");
  if (
    input.additional_images !== undefined &&
    (!Array.isArray(input.additional_images) || input.additional_images.length)
  )
    throw new Error("本次编辑只接受一张底图");
  const checkImage = (image: unknown, label: string, mask = false) => {
    const pattern = mask
      ? /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
      : /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
    if (typeof image !== "string" || !pattern.test(image))
      throw new Error(
        `${label}须为${mask ? " PNG 蒙版" : " PNG、JPEG 或 WebP 图片数据"}`,
      );
    if ((image.length - image.indexOf(",") - 1) * 0.75 > MAX_INPUT_BYTES)
      throw new Error(`${label}不超过 8MB`);
    return { image, ...imageDimensions(image) };
  };
  const size = checkImage(input.init_image, "底图");
  const sourceProblem = validateEditorSource(input.tool, model, size);
  if (sourceProblem) throw new Error(sourceProblem);
  if (input.enhance && (input.tool !== "img2img" || !supportsNaiEnhance(model))) throw new Error("Enhance 仅支持 NovelAI 官方图生图");
  const enhancedSize = input.enhance ? naiEnhanceSize(size, input.enhanceScale, model.id) : undefined;
  const focus = input.inpaintFocus === undefined ? undefined : readInpaintFocus(input.inpaintFocus);
  if (input.inpaintFocus !== undefined && (!focus || input.tool !== "inpaint" || input.enhance || !supportsFocusedInpaint(model) ||
    size.width !== focus.targetWidth || size.height !== focus.targetHeight)) throw new Error("聚焦重绘参数或预处理尺寸无效");
  const prompt = input.prompt ?? "";
  if (
    typeof prompt !== "string" ||
    prompt.length > 24_000 ||
    typeof (input.negative_prompt ?? "") !== "string" ||
    (input.negative_prompt || "").length > 24_000
  )
    throw new Error("描述长度无效");
  const out: PayloadBase & {
    tool: EditMode; init_image: string; negative_prompt: string;
    noise_schedule: WireNoiseSchedule; cfg_rescale?: number;
  } = {
    model: model.id,
    tool: input.tool,
    init_image: size.image,
    prompt: prompt.trim() ? prompt : "best quality",
    negative_prompt: input.negative_prompt || "",
    cache: false,
    transform_prompt: false,
    transform_mode: "off",
    noise_schedule: "karras",
  };
  function number(key: keyof EditNumbers | "cfgRescale", min: number, max: number, fallback: number): number {
    const n = Number(input[key] ?? fallback);
    if (
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (["steps", "seed"].includes(key) && !Number.isInteger(n))
    )
      throw new Error(`参数 ${key} 超出范围`);
    return n;
  }
  const official = model.profileId === "nai-official-v1";
  const range = editStrengthRange(official, input.tool === "inpaint");
  const fields = Object.assign(out, {
    steps: naiCapabilities(model.id).medium ? 14 : number("steps", 1, 50, 25),
    scale: number("scale", 0, Infinity, 5),
    seed: number("seed", -1, 4294967295, -1),
    strength: number("strength", range.min, range.max, input.tool === "inpaint" ? 1 : 0.5),
    noise: number("noise", 0, official ? .99 : 1, 0),
    sampler: naiCapabilities(model.id).medium ? "k_euler_ancestral" : input.sampler || "k_euler_ancestral",
  });
  fields.noise_schedule = official ? naiNoiseSchedule(model.id, fields.sampler, input.noiseSchedule) : "karras";
  if (input.noiseSchedule !== undefined) Object.assign(fields, { noiseSchedule: input.noiseSchedule });
  if (input.varietyPlus !== undefined) Object.assign(fields, { varietyPlus: input.varietyPlus });
  if (enhancedSize) Object.assign(fields, { ...(input.enhanceScale === "max" ? { width: size.width, height: size.height } : enhancedSize), enhance: true, enhanceScale: input.enhanceScale,
    enhanceMagnitude: input.enhanceMagnitude ?? null });
  if (focus) Object.assign(fields, { inpaintFocus: focus });
  if (!naiCapabilities(model.id).medium) fields.cfg_rescale = number("cfgRescale", 0, 1, 0);
  if (official) validateNaiParameters({ ...fields, noiseSchedule: input.noiseSchedule });
  if (!naiCapabilities(model.id).medium && !catalog.samplers.includes(fields.sampler)) throw new Error("采样器无效");
  let payload: NAIEditPayload;
  if (input.tool === "inpaint") {
    const mask = checkImage(input.mask_image, "蒙版", true);
    if (mask.width !== size.width || mask.height !== size.height)
      throw new Error("蒙版尺寸必须与底图一致");
    payload = Object.assign(fields, { tool: input.tool, mask_image: mask.image });
  } else if (input.mask_image)
    throw new Error("图生图不接受蒙版，请切换局部重绘");
  else payload = Object.assign(fields, { tool: input.tool });
  if (execution) {
    if (
      typeof input.max_cost !== "number" ||
      !Number.isFinite(input.max_cost) ||
      input.max_cost < 0
    )
      throw new Error("缺少有效的费用上限，请先获取报价");
    payload.max_cost = input.max_cost;
  }
  return payload;
}

/** The image editor's three modes share one base image. */
export const EDITOR_MODES: EditorMode[] = ["img2img", "inpaint", "upscale"];
export function editorModels(catalog: ModelCatalog, mode: EditorMode): CatalogModel[] {
  const available = mode === "upscale"
    ? upscaleModels(catalog)
    : naiEditModels(catalog, mode);
  return available.filter((m, i) => available.findIndex(other => other.id === m.id) === i);
}

/** Explains why a base cannot be sent, before any re-encoding or mask allocation. */
export function validateEditorSource(
  mode: EditorMode,
  model: CatalogModel | undefined,
  { width, height, bytes = 0 }: { width: number; height: number; bytes?: number },
): string | null {
  if (!model) return null;
  const pixels = width * height,
    format = (n: number) => n.toLocaleString("en-US");
  if (bytes > MAX_INPUT_BYTES) return "底图超过 8MB";
  if (mode === "upscale") {
    if (model.provider === "novelai" && pixels > naiUpscaleLimit(model)) {
      return `${width}×${height} 超过 NAI 放大上限 ${format(naiUpscaleLimit(model))} 像素，请换专用放大模型`;
    }
    return pixels > model.sourceMaxPixels
      ? `超过此模型上限 ${format(model.sourceMaxPixels)} 像素`
      : null;
  }
  const official = model.profileId === "nai-official-v1";
  if (official && (width % 64 || height % 64)) return "NovelAI 编辑底图宽高须为 64 的倍数，请先调整图片尺寸";
  const limit = Math.min(model.maxPixels, model.sourceMaxPixels, official ? NAI_OFFICIAL_EDIT_MAX_PIXELS : Infinity);
  return !official && Math.max(width, height) > 2048 ||
    Math.min(width, height) < 64 ||
    pixels > limit
    ? `${width}×${height} 超出编辑范围：${official ? "边长至少 64" : "边长 64–2048"}，面积 ≤ ${format(limit)} 像素`
    : null;
}

/** Upscale sends the untouched original; img2img and inpaint send the
    orientation-normalized PNG so a mask lines up with what the user painted.
    The edit prompt never reaches an upscaler: fal reads `detail` only. */
export function buildEditorPayload(
  mode: EditorMode,
  model: CatalogModel,
  source: { original?: string; png?: string },
  fields: EditorFields = {},
  mask: string | null = null,
  samplers?: readonly string[],
): EditorPayload {
  if (mode === "upscale") {
    return buildUpscalePayload(
      model,
      source.original,
      fields.options || {},
      model.provider === "novelai" ? "" : fields.detail || "",
    );
  }
  if (mode === "inpaint" && !mask) throw new Error("请先涂抹需要重绘的区域");
  const compiled = compileNaiPrompt({ ...fields, prompt: fields.prompt ?? "", negative: fields.negative_prompt ?? "" }, model);
  const medium = naiCapabilities(model.id).medium;
  const {
    sampler,
    steps,
    scale,
    cfgRescale,
    noiseSchedule,
    varietyPlus,
    seed,
    strength,
    noise,
    enhance,
    enhanceScale,
    enhanceMagnitude,
    inpaintFocus,
  } = fields;
  return buildNAIEditPayload(
    model,
    mode,
    source.png,
    { prompt: enhance ? naiEnhancePrompt(compiled.prompt, enhanceScale) : compiled.prompt, negative_prompt: compiled.negative_prompt, sampler: medium ? "k_euler_ancestral" : sampler, steps: medium ? 14 : steps, scale, cfgRescale, noiseSchedule, varietyPlus, seed, strength, noise,
      ...(enhance ? { enhance, enhanceScale, enhanceMagnitude } : {}), ...(inpaintFocus ? { inpaintFocus } : {}) },
    mode === "inpaint" ? mask : null,
    samplers,
  );
}
