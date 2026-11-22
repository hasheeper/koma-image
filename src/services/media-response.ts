import { object } from "../domain/value";
import type { ImagePayload } from "../gateway/routes";
import { decodeImage } from "./image-response";
import { decodeNativeImages } from "../native/native-images.ts";
import type { NativeImageLimits } from "../native/native-images.ts";
export interface MediaImageMeta {
  name?: string;
  zIndex?: number;
  background?: string;
  /** Native Seedream bounding_box uses per-thousand normalized integers. */
  seedreamBox?: boolean;
  /** Absolute [left, top, right, bottom] in the provider's base output pixel space. */
  box?: [number, number, number, number];
  /** Normalized [left, top, right, bottom] (0..1000 or 0..1) relative to canvas. */
  normalizedBox?: [number, number, number, number];
}
export type MediaBlock =
  | { type: "text"; text: string }
  | { type: "image"; blob: Blob; size: { width: number; height: number }; meta?: MediaImageMeta };
/** Preserve ordered text and every embedded image; never fetch remote output URLs with credentials. */
export async function consumeMedia(
  response: Response,
  native: boolean,
  signal: AbortSignal,
  payload: ImagePayload,
  nativeLimits?: NativeImageLimits,
): Promise<MediaBlock[]> {
  const blocks: (
    | { type: "text"; text: string }
    | { type: "image"; blob: Blob; meta?: MediaImageMeta }
  )[] = [];
  const type = response.headers.get("content-type") || "";
  if (native && !type.includes("json"))
    for (const blob of await decodeNativeImages(await response.arrayBuffer(), nativeLimits))
      blocks.push({ type: "image", blob });
  else if (type.startsWith("image/"))
    blocks.push({ type: "image", blob: await response.blob() });
  else {
    const data = object(await response.json());
    if (data.error)
      throw new Error(String(object(data.error).message || data.error));
    const entries =
      object(object((data.candidates as unknown[])?.[0]).content).parts ||
      data.data ||
      (native ? data.images : null) ||
      [];
    for (const raw of Array.isArray(entries) ? entries : []) {
      const part = object(raw),
        inline = object(part.inlineData || part.inline_data);
      if (part.text) blocks.push({ type: "text", text: String(part.text) });
      const encoded =
          part.b64_json || inline.data || (native ? part.image : null),
        format = object(payload.image_options).output_format;
      const mime = String(
        inline.mimeType ||
          inline.mime_type ||
          (["jpg", "jpeg"].includes(String(format))
            ? "image/jpeg"
            : `image/${format || "png"}`),
      );
      if (
        typeof encoded === "string" &&
        /^image\/(png|jpeg|webp)$/.test(mime)
      ) {
        const bytes = Uint8Array.from(
          atob(encoded.replace(/^data:image\/(?:png|jpeg|webp);base64,/, "")),
          (c) => c.charCodeAt(0),
        );
        const tuple4 = (v: unknown): [number, number, number, number] | undefined =>
          Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n))
            ? (v as [number, number, number, number])
            : undefined;
        const bboxObj = object(part.bounding_box);
        const box = tuple4(bboxObj.absolute) ?? tuple4(part.box) ?? tuple4(part.bbox);
        const normalizedBox = tuple4(bboxObj.normalized);
        const rawZ =
          typeof part.z_index === "number" && Number.isFinite(part.z_index)
            ? part.z_index
            : typeof part.layer_index === "number" && Number.isFinite(part.layer_index)
              ? part.layer_index
              : undefined;
        const rawName =
          typeof part.name === "string" && part.name.trim()
            ? part.name.trim()
            : typeof part.description === "string" && part.description.trim()
              ? part.description.trim()
              : undefined;
        const meta: MediaImageMeta | undefined =
          rawName || rawZ !== undefined || typeof part.background === "string" || box || normalizedBox
            ? {
                ...(rawName ? { name: rawName } : {}),
                ...(rawZ !== undefined ? { zIndex: rawZ } : {}),
                ...(typeof part.background === "string" ? { background: part.background } : {}),
                ...(payload.layerDecomposition && (tuple4(bboxObj.absolute) || normalizedBox) ? { seedreamBox: true } : {}),
                ...(box ? { box } : {}),
                ...(normalizedBox ? { normalizedBox } : {}),
              }
            : undefined;
        blocks.push({
          type: "image",
          blob: native
            ? (await decodeNativeImages(bytes.buffer, nativeLimits))[0]
            : new Blob([bytes], { type: mime }),
          ...(meta ? { meta } : {}),
        });
      }
    }
  }
  if (!blocks.some((b) => b.type === "image"))
    throw new Error(
      blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") ||
        "上游没有返回图片（异步任务或远程图片链接暂不支持），请勿重复提交",
    );
  const result: MediaBlock[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      result.push(b);
      continue;
    }
    if (!b.blob.size) throw new Error("上游返回空图片");
    const size = await decodeImage(b.blob);
    if (
      payload.model.startsWith("nai-") &&
      size.width === 512 &&
      size.height === 256 &&
      !(payload.width === 512 && payload.height === 256)
    )
      throw new Error("上游返回 Generation Failed 占位图");
    result.push({ ...b, size });
  }
  signal.throwIfAborted();
  return result;
}
