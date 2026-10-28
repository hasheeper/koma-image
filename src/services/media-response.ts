import { object } from "../domain/value";
import type { ImagePayload } from "../gateway/routes";
import { decodeImage } from "./image-response";
import { decodeNativeImages } from "../native/native-images.ts";
import type { NativeImageLimits } from "../native/native-images.ts";
export type MediaBlock =
  | { type: "text"; text: string }
  | { type: "image"; blob: Blob; size: { width: number; height: number } };
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
    | { type: "image"; blob: Blob }
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
        blocks.push({
          type: "image",
          blob: native
            ? (await decodeNativeImages(bytes.buffer, nativeLimits))[0]
            : new Blob([bytes], { type: mime }),
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
