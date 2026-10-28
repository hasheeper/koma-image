import { readInpaintFocus } from "../domain/inpaint-focus.ts";
import { naiCapabilities, naiOfficialInpaintModel, NAI_OFFICIAL_UPSCALE, NAI_OFFICIAL_EDIT_MAX_PIXELS } from "../domain/nai.ts";
import { referenceOperation } from "../domain/nai-references.ts";
import { imageDimensions } from "../native/image-dimensions.ts";
import { toNativePayload } from "./routes.ts";
import type { ImagePayload } from "./routes.ts";
import { novelaiProfile, profilePath } from "./profile.ts";
import { editStrengthRange } from "../domain/nai-parameters.ts";
import { naiEnhanceSize, naiEnhancePrompt, isEnhanceScale } from "../domain/nai-enhance.ts";
import { directorRequest } from "../domain/director-tools.ts";

function image(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`缺少${label}`);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length * .75 > 8 * 1024 * 1024 + 2) throw new Error(`${label}格式无效或超过 8MB`);
  return { mime: match[1], data: match[2], ...imageDimensions(value) };
}
function unit(value: unknown, fallback: number, min: number, max: number) {
  const number = value ?? fallback;
  if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) throw new Error(`编辑强度与噪声须在 ${min}–${max} 之间`);
  return number;
}

/** Operation variants stay on the wire, not in the user's generation model list. */
export function novelaiRequest(payload: ImagePayload) {
  if (payload.tool === "director") return { path: profilePath(novelaiProfile, "augment"), body: directorRequest(payload), native: true };
  if (payload.inpaintFocus !== undefined && (payload.tool !== "inpaint" || payload.enhance || !readInpaintFocus(payload.inpaintFocus))) throw new Error("聚焦重绘参数或操作无效");
  if (payload.upscaled_enhance !== undefined) throw new Error("Max 须通过 Enhance 倍率选择，不能直接传入上游标记");
  if (payload.enhance && payload.tool !== "img2img") throw new Error("Enhance 仅支持图生图");
  if (!naiCapabilities(payload.model).supported) throw new Error("此 NovelAI 型号尚未适配编辑协议");
  if (payload.tool && !["img2img", "inpaint", "upscale"].includes(payload.tool)) throw new Error("此协议尚未支持本次编辑操作");
  const inpaintModel = payload.tool === "inpaint" ? naiOfficialInpaintModel(payload.model) : undefined;
  if (payload.tool === "inpaint" && !inpaintModel) throw new Error("当前型号没有独立的官方重绘接口，请选择 V4.5 或 V5 Full");
  if (payload.additional_images !== undefined && (!Array.isArray(payload.additional_images) || payload.additional_images.length)) throw new Error("NovelAI 编辑只接受一张底图");
  const references = payload.referencePlan ?? payload.preparedReferences;
  if (references && !referenceOperation(payload.model, references.kind, payload.tool)) throw new Error("当前操作不支持已启用的参考，配置已保留");
  if (payload.tool !== "inpaint" && payload.mask_image) throw new Error("此操作不接受蒙版，请切换局部重绘");
  const source = payload.tool ? image(payload.init_image, "底图") : undefined;
  if (payload.tool === "upscale" && source) {
    if (source.width * source.height > NAI_OFFICIAL_UPSCALE.maxPixels) throw new Error("NovelAI 放大源图最多 3,145,728 像素");
    const form = new FormData();
    form.append("image", new Blob([Uint8Array.from(atob(source.data), c => c.charCodeAt(0))], { type: source.mime }), `image.${source.mime.split("/")[1]}`);
    form.append("request", new Blob([JSON.stringify({ image: "image", model: NAI_OFFICIAL_UPSCALE.model, declared_blur_sigma: 0 })], { type: "application/json" }));
    return { path: profilePath(novelaiProfile, "upscale"), body: form, native: true };
  }
  if (source && Math.min(source.width, source.height) < 64) throw new Error("编辑底图边长至少 64 像素");
  if (source && (source.width % 64 || source.height % 64 || source.width * source.height > NAI_OFFICIAL_EDIT_MAX_PIXELS)) throw new Error("NovelAI 编辑底图须 64 像素对齐且不超过 3,145,728 像素");
  if (payload.inpaintFocus !== undefined) {
    const focus = readInpaintFocus(payload.inpaintFocus);
    if (!focus || payload.tool !== "inpaint" || !inpaintModel || payload.enhance || source?.width !== focus.targetWidth || source?.height !== focus.targetHeight)
      throw new Error("聚焦重绘参数或预处理尺寸无效");
  }
  const enhancedSize = source && payload.enhance ? naiEnhanceSize(source, payload.enhanceScale, payload.model) : undefined;
  const size = enhancedSize && payload.enhanceScale !== "max" ? enhancedSize : source;
  if (payload.enhance && (!source || payload.width !== undefined && payload.width !== size?.width || payload.height !== undefined && payload.height !== size?.height))
    throw new Error("Enhance 输出尺寸与倍率不一致");
  const { max_cost: _cost, ...wire } = toNativePayload({ ...payload,
    ...(size ? { width: size.width, height: size.height } : {}),
    ...(payload.enhance && isEnhanceScale(payload.enhanceScale) ? { prompt: naiEnhancePrompt(String(payload.prompt || "best quality"), payload.enhanceScale) } : {}),
  }, Math.random, true);
  if (source) {
    const range = editStrengthRange(true, payload.tool === "inpaint");
    const strength = unit(payload.strength, payload.tool === "inpaint" ? 1 : .5, range.min, range.max);
    if (payload.tool === "inpaint") {
      const mask = image(payload.mask_image, "蒙版");
      if (mask.mime !== "image/png" || mask.width !== source.width || mask.height !== source.height) throw new Error("PNG 蒙版须与底图尺寸一致");
      wire.action = "infill";
      wire.model = inpaintModel!;
      Object.assign(wire.parameters, { image: source.data, mask: mask.data, add_original_image: false,
        ...(strength < 1 ? { img2img: { strength, color_correct: true } } : {}) });
    } else {
      wire.action = "img2img";
      Object.assign(wire.parameters, { image: source.data, strength, noise: unit(payload.noise, 0, 0, .99), color_correct: false,
        extra_noise_seed: (wire.parameters.seed + 0xffffffff) >>> 0 });
      if (payload.enhance && payload.enhanceScale === "max") Object.assign(wire.parameters, { upscaled_enhance: true });
    }
  }
  return { path: profilePath(novelaiProfile, "generate"), body: wire, native: true };
}
