import { decodeNativeImages } from "../native/native-images.ts";
import { object } from "../domain/value.ts";
import type { ImagePayload } from "../gateway/routes.ts";
export async function decodeImage(blob: Blob) {
  const url = URL.createObjectURL(blob),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("上游未返回有效图片");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    throw new Error("上游未返回有效图片");
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function consumeImage(
  response: Response,
  native: boolean,
  signal: AbortSignal,
  payload: ImagePayload,
) {
  const type = response.headers.get("content-type") || "";
  const blobs: Blob[] = [];
  if (native && !type.includes("json"))
    blobs.push(...(await decodeNativeImages(await response.arrayBuffer())));
  else if (type.startsWith("image/")) blobs.push(await response.blob());
  else {
    const data = object(await response.json()),
      parts = object(object((data.candidates as unknown[])?.[0]).content).parts;
    const entries = parts || data.data || (native ? data.images : null) || [];
    const texts: string[] = [];
    if (data.error)
      throw new Error(String(object(data.error).message || data.error));
    for (const raw of Array.isArray(entries) ? entries : []) {
      const part = object(raw),
        inline = object(part.inlineData || part.inline_data);
      if (part.text) texts.push(String(part.text));
      const encoded =
          part.b64_json || inline.data || (native ? part.image : null),
        mime = String(inline.mimeType || inline.mime_type || "image/png");
      if (
        typeof encoded === "string" &&
        /^image\/(png|jpeg|webp)$/.test(mime)
      ) {
        const bytes = Uint8Array.from(
          atob(encoded.replace(/^data:image\/(?:png|jpeg|webp);base64,/, "")),
          (c) => c.charCodeAt(0),
        );
        blobs.push(
          native
            ? (await decodeNativeImages(bytes.buffer))[0]
            : new Blob([bytes], { type: mime }),
        );
      }
    }
    if (!blobs.length)
      throw new Error(
        texts.join("\n") ||
          "上游没有返回图片（异步任务或远程图片链接暂不支持），请勿重复提交",
      );
  }
  let result:
    | { blob: Blob; size: { width: number; height: number } }
    | undefined;
  for (let blob of blobs) {
    if (!blob.size) throw new Error("上游返回空图片");
    const size = await decodeImage(blob);
    if (
      payload.model.startsWith("nai-") &&
      size.width === 512 &&
      size.height === 256 &&
      !(payload.width === 512 && payload.height === 256)
    )
      throw new Error("上游返回 Generation Failed 占位图");
    if (native && payload.optimize) {
      const bitmap = await createImageBitmap(blob);
      try {
        const canvas = new OffscreenCanvas(size.width, size.height);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        blob = await canvas.convertToBlob({
          type: "image/jpeg",
          quality: 0.95,
        });
      } finally {
        bitmap.close();
      }
    }
    result ??= { blob, size };
  }
  signal.throwIfAborted();
  if (!result) throw new Error("上游未返回有效图片");
  return result;
}
export async function makeThumb(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height)),
        canvas = new OffscreenCanvas(
          Math.max(1, Math.round(bitmap.width * scale)),
          Math.max(1, Math.round(bitmap.height * scale)),
        );
      const context = canvas.getContext("2d")!;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
