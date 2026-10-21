import { makeContactSheet } from "../native/comparison.ts";
import type { AskImage } from "./messages.ts";
import type { Picture } from "./library.ts";
import { LIMITS } from "./session.ts";
import type { Budget } from "./session.ts";

export type VisionSpec = "glance" | "look" | "crop";
export type Region = readonly [number, number, number, number];
export function cropRect(width: number, height: number, region: Region) {
  const [x, y, w, h] = region;
  if (![width, height, ...region].every(Number.isFinite) || width <= 0 || height <= 0 ||
    x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 100 || y + h > 100)
    throw new Error("裁切区域须为图内的 0–100 百分比 [x, y, w, h]");
  const left = Math.max(0, Math.floor((x - w * .25) * width / 100));
  const top = Math.max(0, Math.floor((y - h * .25) * height / 100));
  return {
    x: left, y: top,
    width: Math.min(width, Math.ceil((x + w * 1.25) * width / 100)) - left,
    height: Math.min(height, Math.ceil((y + h * 1.25) * height / 100)) - top,
  };
}
export function fitSize(width: number, height: number, edge: number) {
  const ratio = Math.min(1, edge / width, edge / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
export function chargeVision(budget: Budget["vision"], pixels: number, bytes: number) {
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(bytes) || pixels < 1 || bytes < 1)
    throw new Error("视觉结果尺寸或字节数无效");
  const cap = LIMITS.vision;
  if (budget.calls + 1 > cap.calls || budget.pixels + pixels > cap.pixels || budget.bytes + bytes > cap.bytes)
    throw new Error("本轮视觉预算已达上限（4 次、1.5MP、400KB），请基于已有信息回答");
  budget.calls++; budget.pixels += pixels; budget.bytes += bytes;
}
interface Rendered { readonly image: AskImage; readonly bytes: number; readonly pixels: number }
export interface VisionContext {
  readonly signal: AbortSignal;
  readonly metadataOnly: boolean;
  readonly budget: Budget["vision"];
  /** Successful full-image views from committed turns plus this turn. */
  readonly viewed: Set<string>;
}
async function encode(canvas: OffscreenCanvas): Promise<Rendered> {
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: .82 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  const mime = blob.type === "image/webp" ? "image/webp" : "image/png";
  return { image: { type: "image", mime, data: btoa(binary) }, bytes: blob.size, pixels: canvas.width * canvas.height };
}
/** Bounded page cache of derived pixels only. Object identity prevents stale results after restore. */
export function createVision() {
  const cache = new Map<string, Rendered>();
  const blobs = new WeakMap<Blob, number>();
  let sequence = 0, disposed = false;
  function identity(picture: Picture) {
    if (!blobs.has(picture.blob)) blobs.set(picture.blob, ++sequence);
    return `${picture.id}:${blobs.get(picture.blob)}`;
  }
  function allowed(context: VisionContext) {
    context.signal.throwIfAborted();
    if (disposed) throw new Error("ASK 视觉会话已关闭");
    if (context.metadataOnly) throw new Error("本轮仅发送元数据，未发送图片");
    if (context.budget.calls >= LIMITS.vision.calls) throw new Error("本轮视觉调用已达 4 次上限");
  }
  async function result(key: string, render: () => Promise<OffscreenCanvas>, context: VisionContext, labels: readonly string[], spec: string) {
    allowed(context);
    let value = cache.get(key);
    if (!value) {
      value = await encode(await render());
      allowed(context);
      // Oversize encodings are never retained or sent; no quiet quality reduction.
      if (value.bytes <= LIMITS.vision.bytes) {
        cache.set(key, value);
        while (cache.size > 16) cache.delete(cache.keys().next().value!);
      }
    } else { cache.delete(key); cache.set(key, value); }
    chargeVision(context.budget, value.pixels, value.bytes);
    return {
      ...value,
      image: { ...value.image, viewed: { ids: [...labels], spec, bytes: value.bytes } },
    };
  }
  return {
    async image(picture: Picture, spec: VisionSpec, region: Region | undefined, context: VisionContext) {
      allowed(context);
      if (spec === "crop" && !context.viewed.has(picture.id)) throw new Error("裁切前请先用 glance 或 look 查看该图全图");
      if (spec === "crop" && !region) throw new Error("crop 需要百分比 region");
      if (spec !== "crop" && region) throw new Error("只有 crop 接受 region");
      const key = `${identity(picture)}:${spec}:${region?.join(",") ?? ""}`;
      const value = await result(key, async () => {
        const bitmap = await createImageBitmap(picture.blob);
        try {
          context.signal.throwIfAborted();
          if (bitmap.width * bitmap.height > 40_000_000) throw new Error("图片超过 4000 万像素");
          const box = spec === "crop" ? cropRect(bitmap.width, bitmap.height, region!) : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
          const size = fitSize(box.width, box.height, spec === "glance" ? 384 : 768);
          const canvas = new OffscreenCanvas(size.width, size.height), g = canvas.getContext("2d");
          if (!g) throw new Error("当前浏览器不支持 Canvas");
          g.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, size.width, size.height);
          return canvas;
        } finally { bitmap.close(); }
      }, context, [picture.label], spec);
      if (spec !== "crop") context.viewed.add(picture.id);
      return value;
    },
    async sheet(pictures: readonly Picture[], spec: "glance" | "look", context: VisionContext) {
      if (pictures.length < 2 || pictures.length > 6 || new Set(pictures.map((p) => p.id)).size !== pictures.length)
        throw new Error("拼图需要 2–6 张不同图片");
      return result(`sheet:${spec}:${pictures.map((p) => `${identity(p)}:${p.label}`).join("|")}`,
        () => makeContactSheet(pictures.map((p) => ({ blob: p.blob, label: p.label })), spec === "glance" ? 384 : 768, context.signal),
        context, pictures.map((p) => p.label), "sheet");
    },
    dispose() { disposed = true; cache.clear(); },
  };
}
export type Vision = ReturnType<typeof createVision>;
