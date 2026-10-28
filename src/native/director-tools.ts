import { directorSize, directorVariants } from "../domain/director-tools.ts";
import type { DirectorTool, DirectorVariant } from "../domain/director-tools.ts";
import { decodeNativeImageEntries } from "./native-images.ts";
import { decodeImage } from "../services/image-response.ts";
import { dataUrl } from "../services/assets.ts";

export async function prepareDirectorImage(blob: Blob, size: { width: number; height: number }) {
  const target = directorSize(size), bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== size.width || bitmap.height !== size.height) throw new Error("图片方向或尺寸已变化，请重新打开");
    const canvas = new OffscreenCanvas(target.width, target.height), ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    return { ...target, init_image: await dataUrl(await canvas.convertToBlob({ type: "image/png" })) };
  } finally { bitmap.close(); }
}

/** Decode all outputs before committing any. Numeric ZIP identity, rather
 * than directory order, determines Masked / Generated / Blend. */
export async function consumeDirector(response: Response, tool: DirectorTool, signal: AbortSignal) {
  const entries = await decodeNativeImageEntries(await response.arrayBuffer());
  signal.throwIfAborted();
  if (entries.length !== (tool === "bg-removal" ? 3 : 1)) throw new Error("Director Tools 返回数量不符，未写入版本，请勿重复提交");
  if (tool === "bg-removal") {
    const index = (name: string) => /^image[_-]?(\d+)\.png$/i.exec(name)?.[1];
    if (new Set(entries.map(e => index(e.name))).size !== 3 || entries.some(e => !["0", "1", "2"].includes(index(e.name) ?? "")))
      throw new Error("无法识别去背景的三种结果，未写入版本，请勿重复提交");
    entries.sort((a, b) => Number(index(a.name)) - Number(index(b.name)));
  }
  const output: { blob: Blob; width: number; height: number; variant?: DirectorVariant }[] = [];
  for (const [i, entry] of entries.entries()) {
    const size = await decodeImage(entry.blob);
    signal.throwIfAborted();
    if (size.width * size.height > 3_145_728 || size.width === 512 && size.height === 256)
      throw new Error("Director Tools 返回无效图片，未写入版本，请勿重复提交");
    output.push({ blob: entry.blob, ...size, ...(tool === "bg-removal" ? { variant: directorVariants[i] } : {}) });
  }
  if (output.some(b => b.width !== output[0].width || b.height !== output[0].height)) throw new Error("去背景结果尺寸不一致，未写入版本");
  return output;
}
