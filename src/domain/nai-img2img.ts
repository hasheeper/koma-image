import type { CatalogModel } from "./catalog.ts";
import { naiCapabilities } from "./nai.ts";
import { NAI_OFFICIAL_MAX_PIXELS } from "./nai-parameters.ts";
import { STANDARD_PROFILE_ID } from "../gateway/profile.ts";

export function supportsOfficialNaiImg2Img(model?: Pick<CatalogModel, "id" | "upstreamId" | "profileId" | "operations" | "tools">) {
  return !!model && model.profileId === "nai-official-v1" && naiCapabilities(model.id).supported &&
    (!model.upstreamId || model.upstreamId === model.id) && model.operations.includes("edit") && model.tools.includes("img2img");
}

export function supportsStandardNaiImg2ImgScale(model?: CatalogModel) {
  return !!model &&
    (model.profileId ?? STANDARD_PROFILE_ID) === STANDARD_PROFILE_ID && model.provider === "novelai" &&
    model.operations.includes("edit") && model.tools.includes("img2img");
}

export function supportsNaiImg2ImgScale(model?: CatalogModel) {
  return supportsOfficialNaiImg2Img(model) || supportsStandardNaiImg2ImgScale(model);
}

export function naiImg2ImgPixelLimit(model: CatalogModel) {
  return supportsStandardNaiImg2ImgScale(model) ? Math.min(model.maxPixels, model.sourceMaxPixels) : model.maxPixels;
}

export function isImg2ImgScale(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}

export function naiImg2ImgSize(base: { width: number; height: number }, scale: unknown, maxPixels = NAI_OFFICIAL_MAX_PIXELS) {
  if (!isImg2ImgScale(scale)) throw new Error("图生图分辨率倍率须为 1× 或以上的有限数值");
  const width = Math.round(base.width * scale / 64) * 64, height = Math.round(base.height * scale / 64) * 64;
  const limit = Math.min(maxPixels, NAI_OFFICIAL_MAX_PIXELS);
  if (width * height > limit) throw new Error(`图生图输出最多 ${limit.toLocaleString()} 像素，请降低倍率`);
  return { width, height };
}
