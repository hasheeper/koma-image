import type { CatalogModel } from "./catalog.ts";
import type { Character } from "./characters.ts";
import { naiOfficialInpaintModel } from "./nai.ts";
import { NAI_OFFICIAL_MAX_PIXELS } from "./nai-parameters.ts";

export interface FocusRect { x: number; y: number; width: number; height: number }
export interface InpaintFocus extends FocusRect { sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number }
type Size = { width: number; height: number };
export const supportsFocusedInpaint = (m: Pick<CatalogModel, "id" | "profileId" | "upstreamId" | "tools" | "operations">) =>
  m.profileId === "nai-official-v1" && !!naiOfficialInpaintModel(m.id) && (!m.upstreamId || m.upstreamId === m.id) && m.tools.includes("inpaint") && m.operations.includes("edit");

/** The public client selects in the mask's 1/8-scale coordinate space. */
export function snapFocusRect(size: Size, rect: FocusRect): FocusRect {
  const left = Math.max(0, Math.min(size.width - 8, Math.floor(rect.x / 8) * 8));
  const top = Math.max(0, Math.min(size.height - 8, Math.floor(rect.y / 8) * 8));
  return { x: left, y: top,
    width: Math.max(8, Math.min(size.width, Math.ceil((rect.x + rect.width) / 8) * 8) - left),
    height: Math.max(8, Math.min(size.height, Math.ceil((rect.y + rect.height) / 8) * 8) - top) };
}
export function inpaintFocusPlan(size: Size, rect: FocusRect): InpaintFocus {
  if ([size.width, size.height].some(n => !Number.isInteger(n) || n < 64 || n % 64) || size.width * size.height > NAI_OFFICIAL_MAX_PIXELS)
    throw new Error("聚焦底图须 64 像素对齐且不超过 3,145,728 像素");
  if ([rect.x, rect.y, rect.width, rect.height].some(n => !Number.isInteger(n) || n < 0 || n % 8) ||
    rect.width < 8 || rect.height < 8 || rect.x + rect.width > size.width || rect.y + rect.height > size.height)
    throw new Error("聚焦框须位于底图内并对齐 8 像素");
  // Match largestValidWithinPixelCount: keep regions already at least 0.8MP;
  // otherwise enlarge to about 1MP and round both sides down to 64px.
  const factor = rect.width * rect.height >= .8 * 1_048_576 ? 1 : Math.sqrt(1_048_576 / (rect.width * rect.height));
  const targetWidth = factor === 1 ? Math.round(rect.width / 64) * 64 : Math.floor(rect.width * factor / 64) * 64;
  const targetHeight = factor === 1 ? Math.round(rect.height / 64) * 64 : Math.floor(rect.height * factor / 64) * 64;
  if (targetWidth < 64 || targetHeight < 64 || targetWidth * targetHeight > NAI_OFFICIAL_MAX_PIXELS)
    throw new Error("聚焦框比例过于狭长，请重新框选");
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    sourceWidth: size.width, sourceHeight: size.height, targetWidth, targetHeight };
}
export function readInpaintFocus(value: unknown): InpaintFocus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as InpaintFocus;
  try {
    const plan = inpaintFocusPlan({ width: v.sourceWidth, height: v.sourceHeight }, v);
    return plan.targetWidth === v.targetWidth && plan.targetHeight === v.targetHeight ? plan : null;
  } catch { return null; }
}
export const focusContains = (outer: FocusRect, inner: FocusRect) => inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
export function focusedCharacters(characters: Character[], focus: InpaintFocus) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return characters.map(c => ({ ...c, centers: c.centers.map(p => ({
    x: clamp((p.x * focus.sourceWidth - focus.x) / focus.width), y: clamp((p.y * focus.sourceHeight - focus.y) / focus.height),
  })) }));
}
