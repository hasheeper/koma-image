import { naiCapabilities } from "./nai.ts";
import { referenceSurcharge } from "./nai-references.ts";
import { naiEnhanceSize } from "./nai-enhance.ts";
import { imageDimensions } from "../native/image-dimensions.ts";
import { object } from "./value.ts";
import type { ImagePayload } from "../gateway/routes.ts";
import type { Quote } from "./quote.ts";
import { directorCost } from "./director-tools.ts";

/** Public NovelAI client pricing, audited 2026-10-28. This is a local estimate,
 * never a server quote or a max_cost guarantee. Usage % has only a published
 * baseline, so its estimate is explicitly approximate. */
export function naiCost(payload: ImagePayload, account: unknown): Quote | null {
  if (payload.tool === "director") return directorCost(payload, account);
  const cap = naiCapabilities(payload.model);
  if (!cap.supported) return null;
  let width = Number(payload.width), height = Number(payload.height);
  if (payload.tool && typeof payload.init_image === "string") {
    try {
      const source = imageDimensions(payload.init_image);
      const effective = payload.enhance && payload.enhanceScale !== "max" ? naiEnhanceSize(source, payload.enhanceScale, payload.model) : source;
      ({ width, height } = effective);
    } catch { return null; }
  }
  if (![width, height].every(n => Number.isInteger(n) && n >= (payload.tool === "upscale" ? 1 : 64)) || width * height > 3145728) return null;
  if (payload.tool === "upscale") {
    const limits = [1048576, 1747627, 2446678, 3145728];
    const cost = limits.findIndex(n => width * height <= n) + 1;
    return cost ? { cost, unit: "Anlas", estimated: true, encodingCost: 0 } : null;
  }
  const steps = cap.medium ? 14 : Number(payload.steps ?? 23);
  if (!Number.isInteger(steps) || steps < 1 || steps > 50) return null;
  const reference = payload.referencePlan ?? payload.preparedReferences;
  const count = reference ? "items" in reference ? reference.items.length : reference.images.length : 0;
  const surcharge = reference?.kind === "precise" ? count * 5 : Math.max(0, count - 4) * 2;
  // referenceMinimum includes the per-image surcharge; the remainder is a
  // one-time encoding fee. Prepared references have already paid that fee.
  const encodingCost = payload.preparedReferences ? 0 : payload.referencePlan
    ? typeof payload.referenceMinimum === "number" && Number.isFinite(payload.referenceMinimum)
      ? Math.max(0, payload.referenceMinimum - referenceSurcharge(payload.referencePlan)) : null
    : 0;
  if (encodingCost === null) return null;
  const subscription = object(account), usage = object(subscription.usage);
  const candidate = width * height <= 1048576 && steps <= 28 && reference?.kind !== "precise";
  const privileged = typeof subscription.accountType === "number" && [1, 2, 3, 4].includes(subscription.accountType);
  const active = privileged ? true : typeof subscription.expiresAt === "number"
    ? subscription.expiresAt > Date.now() / 1000 && Number(subscription.tier) > 0 : subscription.active;
  let free = false;
  if (candidate) {
    if (active === true && typeof subscription.tier === "number") {
      if (subscription.tier >= 3) {
        if (cap.v5 && typeof usage.isNegative !== "boolean") return null;
        free = !cap.v5 || usage.isNegative === false;
      }
    } else if (active !== false) return null;
  }
  const strength = payload.tool === "img2img" || payload.tool === "inpaint" ? Number(payload.strength ?? (payload.tool === "inpaint" ? 1 : .5)) : 1;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) return null;
  // Medium uses the official 14-step model and its client-side step factor.
  let base = Math.ceil(2.951823174884865e-6 * width * height + 5.753298233447344e-7 * width * height * steps * (cap.medium ? 1 / 1.06521739 : 1));
  if (cap.v5) base *= 1.5;
  base = Math.max(Math.ceil(base * strength), 2);
  if (base > 140) return null;
  return { cost: (free ? 0 : base) + surcharge + encodingCost, unit: "Anlas", estimated: true,
    encodingCost, opusFree: free,
    // FAQ: 100% ≈ 1,730 images at 23 steps / 1MP; Medium ≈42% less.
    usagePercent: free && cap.v5 ? 100 / 1730 * (width * height / 1048576) * (steps / 23) * (cap.medium ? 1 / 1.06521739 : 1) * strength : undefined,
  };
}
