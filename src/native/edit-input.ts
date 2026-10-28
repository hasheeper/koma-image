import { decodeImage } from "../services/image-response.ts";
import { MAX_INPUT_BYTES } from "../domain/media.ts";

export type MaskFormat = "grayscale" | "alpha";
/** Immutable, packed binary coverage. One bit per source pixel, shared by undo snapshots. */
export interface MaskBitmap { width: number; height: number; bits: Uint8Array }

export async function validateEditImage(blob: Blob) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type))
    throw new Error("仅支持 PNG、JPEG、WebP");
  if (!blob.size || blob.size > MAX_INPUT_BYTES) throw new Error("图片需在 8MB 以内");
  const size = await decodeImage(blob);
  if (size.width * size.height > 32_000_000) throw new Error("图片最多 3200 万像素");
  return size;
}

async function pixels(blob: Blob) {
  const size = await validateEditImage(blob);
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== size.width || bitmap.height !== size.height) throw new Error("图片方向无法确认");
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("当前浏览器不支持图片处理");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, size.width, size.height);
  } finally { bitmap.close(); }
}

export async function editPixelHash(blob: Blob) {
  const image = await pixels(blob);
  const hash = await crypto.subtle.digest("SHA-256", image.data);
  return `${image.width}x${image.height}:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")}`;
}

/** A selection copied from this carrier is exact only where the carrier is opaque. */
export async function validateMaskCarrier(blob: Blob, size: {width:number;height:number}, bounds: number[]) {
  const image = await pixels(blob);
  if (image.width !== size.width || image.height !== size.height) throw new Error("选区辅助层尺寸不一致");
  for (let y=Math.max(0,Math.floor(bounds[1]));y<Math.min(size.height,Math.ceil(bounds[3]));y++)
    for (let x=Math.max(0,Math.floor(bounds[0]));x<Math.min(size.width,Math.ceil(bounds[2]));x++)
      if (image.data[(y*size.width+x)*4+3] !== 255) throw new Error("选区辅助层覆盖不完整，请撤销修改或画布扩展后重试");
}

export async function decodeMask(blob: Blob, format: MaskFormat, size: { width: number; height: number }, allowEmpty = false): Promise<MaskBitmap> {
  if (format !== "grayscale" && format !== "alpha") throw new Error("请选择蒙版覆盖格式");
  const image = await pixels(blob);
  if (image.width !== size.width || image.height !== size.height) throw new Error("蒙版尺寸必须与底图一致");
  const bits = new Uint8Array(Math.ceil(image.width * image.height / 8));
  let painted = false;
  for (let p = 0; p < image.width * image.height; p++) {
    const i = p * 4, r = image.data[i], g = image.data[i + 1], b = image.data[i + 2], a = image.data[i + 3];
    if (format === "grayscale" && a && (r !== g || g !== b)) throw new Error("请导入黑白或灰度蒙版，彩色图不能作为蒙版");
    const coverage = format === "alpha" ? a : r * a / 255;
    if (coverage > 32) { bits[p >> 3] |= 1 << (p & 7); painted = true; }
  }
  if (!painted && !allowEmpty) throw new Error("蒙版没有重绘区域；如需清空，请使用清空蒙版");
  return { width: image.width, height: image.height, bits };
}

export function maskBitmapPixels(bitmap: MaskBitmap): ImageData {
  const image = new ImageData(bitmap.width, bitmap.height);
  for (let p = 0; p < bitmap.width * bitmap.height; p++) {
    if (!(bitmap.bits[p >> 3] & 1 << (p & 7))) continue;
    image.data.fill(255, p * 4, p * 4 + 4);
  }
  return image;
}
