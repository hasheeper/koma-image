import { normalizeOptions } from "./catalog.ts";
import { imageDimensions } from "../native/image-dimensions.js";
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const NAI_UPSCALE_MAX_PIXELS = 1_048_576;
const DEFAULT_UPSCALE_PROMPT =
  "Upscale the image while preserving the original composition, colors and details.";
export function chatModels(catalog) {
  return catalog.models.filter(
    (m) =>
      m.chat &&
      m.operations.includes("generate") &&
      m.operations.includes("edit"),
  );
}

export function isDedicatedUpscaler(model) {
  return (
    model?.provider === "fal" &&
    model.operations.includes("edit") &&
    model.tools.includes("image-edit") &&
    /upscal|super[-_ ]?resolution/i.test(`${model.id} ${model.name}`)
  );
}

export function upscaleModels(catalog) {
  return catalog.models.filter(
    (m) =>
      (m.provider === "novelai" && m.tools.includes("upscale")) ||
      isDedicatedUpscaler(m),
  );
}

export function buildUpscalePayload(model, image, options = {}, prompt = "") {
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

function validateUpscalePayload(input, catalog, { execution = false } = {}) {
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
  if (model.provider === "novelai" && pixels > NAI_UPSCALE_MAX_PIXELS)
    throw new Error(
      "NAI 原生放大源图面积最多 1,048,576 像素，请改用专用放大模型",
    );
  if (pixels > model.sourceMaxPixels)
    throw new Error(
      `源图超过模型上限 ${model.sourceMaxPixels.toLocaleString()} 像素`,
    );
  const prompt = input.prompt ?? "";
  if (typeof prompt !== "string" || prompt.length > 24_000)
    throw new Error("描述长度无效");
  const out = {
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
  if (model.provider !== "novelai") {
    const opts = input.image_options || {};
    for (const [key, value] of Object.entries(opts))
      if (!model.fields[key]?.options.includes(value))
        throw new Error(`参数 ${key} 不受模型支持`);
    out.image_options = normalizeOptions(model, opts);
  }
  if (execution) {
    if (
      typeof input.max_cost !== "number" ||
      !Number.isFinite(input.max_cost) ||
      input.max_cost < 0
    )
      throw new Error("缺少有效的费用上限，请先获取报价");
    out.max_cost = input.max_cost;
  }
  return out;
}

export function buildChatPayload(model, prompt, options, images = []) {
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
  const payload = {
    model: model.id,
    prompt,
    image_options,
    cache: false,
    transform_prompt: false,
    transform_mode: "off",
  };
  if (images.length)
    Object.assign(payload, {
      tool: "image-edit",
      init_image: images[0],
      additional_images: images.slice(1),
    });
  return payload;
}

export function naiEditModels(catalog, tool = "img2img") {
  return catalog.models.filter(
    (m) =>
      m.provider === "novelai" &&
      m.operations.includes("edit") &&
      m.tools.includes(tool),
  );
}

export function buildNAIEditPayload(model, tool, image, settings = {}, mask) {
  return validateNAIEditPayload(
    {
      ...settings,
      model: model.id,
      tool,
      init_image: image,
      ...(mask ? { mask_image: mask } : {}),
    },
    { models: [model], samplers: [settings.sampler || "k_euler_ancestral"] },
  );
}

function validateNAIEditPayload(input, catalog, { execution = false } = {}) {
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
  const checkImage = (image, label, mask = false) => {
    const pattern = mask
      ? /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
      : /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
    if (typeof image !== "string" || !pattern.test(image))
      throw new Error(
        `${label}须为${mask ? " PNG 蒙版" : " PNG、JPEG 或 WebP 图片数据"}`,
      );
    if ((image.length - image.indexOf(",") - 1) * 0.75 > MAX_INPUT_BYTES)
      throw new Error(`${label}不超过 8MB`);
    return imageDimensions(image);
  };
  const size = checkImage(input.init_image, "底图");
  if (
    size.width * size.height >
      Math.min(model.maxPixels, model.sourceMaxPixels) ||
    Math.max(size.width, size.height) > 2048 ||
    Math.min(size.width, size.height) < 64
  )
    throw new Error(
      "底图尺寸超出模型范围，请使用边长 64–2048 且在模型像素上限内的图片",
    );
  const prompt = input.prompt ?? "";
  if (
    typeof prompt !== "string" ||
    prompt.length > 24_000 ||
    typeof (input.negative_prompt ?? "") !== "string" ||
    (input.negative_prompt || "").length > 24_000
  )
    throw new Error("描述长度无效");
  const out = {
    model: model.id,
    tool: input.tool,
    init_image: input.init_image,
    prompt: prompt.trim() ? prompt : "best quality",
    negative_prompt: input.negative_prompt || "",
    cache: false,
    transform_prompt: false,
    transform_mode: "off",
    noise_schedule: "karras",
    cfg_rescale: 0,
  };
  for (const [key, min, max, fallback] of [
    ["steps", 1, 50, 25],
    ["scale", 0, 20, 5],
    ["seed", -1, 4294967295, -1],
    ["strength", 0, 1, input.tool === "inpaint" ? 1 : 0.5],
    ["noise", 0, 1, 0],
  ]) {
    const n = Number(input[key] ?? fallback);
    if (
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (["steps", "seed"].includes(key) && !Number.isInteger(n))
    )
      throw new Error(`参数 ${key} 超出范围`);
    out[key] = n;
  }
  out.sampler = input.sampler || "k_euler_ancestral";
  if (!catalog.samplers.includes(out.sampler)) throw new Error("采样器无效");
  if (input.tool === "inpaint") {
    const mask = checkImage(input.mask_image, "蒙版", true);
    if (mask.width !== size.width || mask.height !== size.height)
      throw new Error("蒙版尺寸必须与底图一致");
    out.mask_image = input.mask_image;
  } else if (input.mask_image)
    throw new Error("图生图不接受蒙版，请切换局部重绘");
  if (execution) {
    if (
      typeof input.max_cost !== "number" ||
      !Number.isFinite(input.max_cost) ||
      input.max_cost < 0
    )
      throw new Error("缺少有效的费用上限，请先获取报价");
    out.max_cost = input.max_cost;
  }
  return out;
}

/** The image editor's three modes share one base image. */
export const EDITOR_MODES = ["img2img", "inpaint", "upscale"];
export function editorModels(catalog, mode) {
  return mode === "upscale"
    ? upscaleModels(catalog)
    : naiEditModels(catalog, mode);
}

/** Explains why a base cannot be sent, before any re-encoding or mask allocation. */
export function validateEditorSource(
  mode,
  model,
  { width, height, bytes = 0 },
) {
  if (!model) return null;
  const pixels = width * height,
    format = (n) => n.toLocaleString("en-US");
  if (bytes > MAX_INPUT_BYTES) return "底图超过 8MB";
  if (mode === "upscale") {
    if (model.provider === "novelai" && pixels > NAI_UPSCALE_MAX_PIXELS) {
      return `${width}×${height} 超过 NAI 放大上限 ${format(NAI_UPSCALE_MAX_PIXELS)} 像素，请换专用放大模型`;
    }
    return pixels > model.sourceMaxPixels
      ? `超过此模型上限 ${format(model.sourceMaxPixels)} 像素`
      : null;
  }
  const limit = Math.min(model.maxPixels, model.sourceMaxPixels);
  return Math.max(width, height) > 2048 ||
    Math.min(width, height) < 64 ||
    pixels > limit
    ? `${width}×${height} 超出编辑范围：边长 64–2048，面积 ≤ ${format(limit)} 像素`
    : null;
}

/** Upscale sends the untouched original; img2img and inpaint send the
    orientation-normalized PNG so a mask lines up with what the user painted.
    The edit prompt never reaches an upscaler: fal reads `detail` only. */
export function buildEditorPayload(
  mode,
  model,
  source,
  fields = {},
  mask = null,
) {
  if (mode === "upscale") {
    return buildUpscalePayload(
      model,
      source.original,
      fields.options || {},
      model.provider === "novelai" ? "" : fields.detail || "",
    );
  }
  if (mode === "inpaint" && !mask) throw new Error("请先涂抹需要重绘的区域");
  const {
    prompt,
    negative_prompt,
    sampler,
    steps,
    scale,
    seed,
    strength,
    noise,
  } = fields;
  return buildNAIEditPayload(
    model,
    mode,
    source.png,
    { prompt, negative_prompt, sampler, steps, scale, seed, strength, noise },
    mode === "inpaint" ? mask : null,
  );
}
