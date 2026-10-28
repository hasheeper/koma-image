import { readInpaintFocus } from "../domain/inpaint-focus.ts";
import type { InpaintFocus } from "../domain/inpaint-focus.ts";
import { dataUrl } from "../services/assets.ts";
import { composeInpaint } from "./inpaint-result.ts";

async function decode(url: string) {
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), c => c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: "image/png" }));
}
/** Retain full-size source/mask in the caller; only the crop leaves the browser. */
export async function prepareFocusedInpaint(source: string, mask: string, focus: InpaintFocus) {
  if (!readInpaintFocus(focus)) throw new Error("聚焦范围无效，请重新框选");
  const bitmaps: ImageBitmap[] = [];
  try {
    const base = await decode(source); bitmaps.push(base);
    const selection = await decode(mask); bitmaps.push(selection);
    if ([base, selection].some(b => b.width !== focus.sourceWidth || b.height !== focus.sourceHeight)) throw new Error("聚焦底图或蒙版尺寸已变化");
    const full = new OffscreenCanvas(base.width, base.height), pixels = full.getContext("2d", { willReadFrequently: true })!;
    pixels.drawImage(selection, 0, 0);
    const data = pixels.getImageData(0, 0, base.width, base.height).data;
    let covered = false;
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
      const i = (y * base.width + x) * 4;
      if (data[i] < 128 || data[i + 3] < 128) continue;
      covered = true;
      if (x < focus.x || y < focus.y || x >= focus.x + focus.width || y >= focus.y + focus.height)
        throw new Error("聚焦框需包含全部蒙版，请扩大范围或擦除框外蒙版");
    }
    if (!covered) throw new Error("请先涂抹需要重绘的区域");
    const canvas = new OffscreenCanvas(focus.targetWidth, focus.targetHeight), context = canvas.getContext("2d")!;
    const crop = async (bitmap: ImageBitmap, smooth: boolean) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = smooth; context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, focus.x, focus.y, focus.width, focus.height, 0, 0, canvas.width, canvas.height);
      return dataUrl(await canvas.convertToBlob({ type: "image/png" }));
    };
    return { png: await crop(base, true), mask: await crop(selection, false) };
  } finally { for (const bitmap of bitmaps) bitmap.close(); }
}

export async function composeFocusedInpaint(source: string, mask: string, result: Blob, focus: InpaintFocus, signal: AbortSignal) {
  const image = await createImageBitmap(result);
  try {
    signal.throwIfAborted();
    if (!readInpaintFocus(focus) || image.width !== focus.targetWidth || image.height !== focus.targetHeight)
      throw new Error("聚焦重绘结果尺寸不一致，未写入编辑版本，请勿重复提交");
    const canvas = new OffscreenCanvas(focus.sourceWidth, focus.sourceHeight), context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    context.drawImage(image, focus.x, focus.y, focus.width, focus.height);
    return await composeInpaint(source, mask, await canvas.convertToBlob({ type: "image/png" }), signal);
  } finally { image.close(); }
}
