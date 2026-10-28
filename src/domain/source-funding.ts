import { readInpaintFocus, supportsFocusedInpaint } from "./inpaint-focus.ts";
import { referenceModel, referenceOperation, referenceSurcharge } from "./nai-references.ts";
import type { CatalogModel } from "./catalog.ts";
import type { QuotaStatus } from "./quota.ts";
import { novelaiUsage } from "./quota.ts";
import type { Quote } from "./quote.ts";
import { object, finite } from "./value.ts";
import { usesNative } from "../gateway/routes.ts";
import type { ImagePayload } from "../gateway/routes.ts";
import { imageDimensions } from "../native/image-dimensions.ts";
import { validateEditorSource } from "./media.ts";
import { supportsNaiEnhance, naiEnhanceSize } from "./nai-enhance.ts";
import { directorRequest } from "./director-tools.ts";

/** Only positive evidence of insufficient funds may advance the priority list. */
export function insufficientFunds(model: CatalogModel, quota: QuotaStatus | null, quote: Quote | null, payload?: ImagePayload): string | null {
  if (!quota) return null;
  const credits = finite(object(quota.media.credits).remaining);
  if (quota.profile.protocol === "novelai") {
    if (payload?.tool === "director") {
      if (credits !== null && quote && credits < quote.cost) return "Anlas 不足以支付本次预计费用";
      return null;
    }
    const minimum = Math.max(referenceSurcharge(payload?.referencePlan), Number(payload?.referenceMinimum) || 0);
    if (credits !== null && minimum > credits) return "Anlas 不足以支付本次参考费用";
    if (quote?.estimated && credits !== null && quote.cost > credits) return "Anlas 不足以支付本次预计费用";
    if (credits !== 0) return null;
    const subscription = object(quota.media.subscription), usage = novelaiUsage(subscription);
    if (model.id.startsWith("nai-diffusion-5") && (usage?.purchasedPercent ?? 0) > 0) return null;
    if (subscription.active === false) return "未订阅且 Anlas 已用尽";
    if (model.id.startsWith("nai-diffusion-5") && usage?.unavailable === true && usage.purchasedPercent === 0)
      return "V5 额度暂不可用且 Anlas 已用尽";
    // Rounded percentages and the remaining Anlas do not quote this exact image.
    return null;
  }
  if (quota.profile.protocol && quota.profile.protocol !== "standard") return null;
  if (quote && quote.cost > 0 && credits !== null && credits < quote.cost)
    return "积分不足以支付本次报价";
  if (payload && quote && !usesNative(payload, quote) && quota.temporary?.isTemp && quota.temporary.limited &&
      quota.temporary.remaining !== null && quota.temporary.remaining <= 0)
    return "当前 Key 的日请求额度已用尽";
  return null;
}

/** Fallback keeps the exact payload; it never trims images, changes options or shrinks the canvas. */
export function supportsSourcePayload(model: CatalogModel, payload?: ImagePayload): boolean {
  if (!payload) return true;
  if (payload.tool === "director") {
    if (model.profileId !== "nai-official-v1" || !model.tools.includes("director")) return false;
    // Operation-only capability checks have no encoded source yet.
    if (payload.init_image === undefined) return true;
    try { directorRequest(payload); return true; } catch { return false; }
  }
  if (payload.inpaintFocus !== undefined) {
    const focus = readInpaintFocus(payload.inpaintFocus);
    if (!focus || payload.tool !== "inpaint" || payload.enhance || !supportsFocusedInpaint(model) || typeof payload.init_image !== "string") return false;
    const size = imageDimensions(payload.init_image);
    if (size.width !== focus.targetWidth || size.height !== focus.targetHeight) return false;
  }
  if (payload.enhance) {
    if (!supportsNaiEnhance(model) || payload.tool !== "img2img" || typeof payload.init_image !== "string") return false;
    try { naiEnhanceSize(imageDimensions(payload.init_image), payload.enhanceScale, model.id); } catch { return false; }
  }
  if ((payload.referencePlan || payload.preparedReferences) && (model.profileId !== "nai-official-v1" || !referenceModel(model.id) || model.upstreamId && model.upstreamId.replace(/@local$/, "") !== model.id.replace(/@local$/, ""))) return false;
  const references = payload.referencePlan ?? payload.preparedReferences;
  if (references && !referenceOperation(model.id, references.kind, payload.tool)) return false;
  if (model.operations.length && !model.operations.includes(payload.tool ? "edit" : "generate")) return false;
  if (payload.tool && payload.tool !== "image-edit" && !model.tools.includes(payload.tool)) return false;
  const width = finite(payload.width), height = finite(payload.height);
  if (width !== null && height !== null && width * height > model.maxPixels) return false;
  const images = (payload.init_image ? 1 : 0) + (Array.isArray(payload.additional_images) ? payload.additional_images.length : 0);
  if (images > model.maxImages) return false;
  if (typeof payload.init_image === "string" && ["img2img", "inpaint", "upscale"].includes(payload.tool ?? "")) {
    const mode = payload.tool as "img2img" | "inpaint" | "upscale";
    if (validateEditorSource(mode, model, imageDimensions(payload.init_image))) return false;
  }
  return Object.entries(object(payload.image_options)).every(([key, value]) =>
    !model.fields[key] || model.fields[key].options.includes(String(value)));
}
