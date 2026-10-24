import { readImageParams } from "../native/image-meta.ts";
import type { ImageMetadata } from "../native/image-meta.ts";
import { dataBlock, dataText } from "./prompts/index.ts";
import type { AskBlock, AskImage } from "./messages.ts";
import type { Picture } from "./library.ts";
import { fitSize } from "./vision.ts";
import { DEFAULT_TEXT_ATTACHMENT_LIMITS } from "./settings.ts";
import type { TextAttachmentLimits } from "./settings.ts";

export const ATTACHMENT_LIMITS = Object.freeze({ images: 4, texts: 4, paste: 2000, bytes: 20 * 1024 ** 2, pageBytes: 200 * 1024 ** 2, pixels: 40_000_000, edge: 1568, sentBytes: 1024 ** 2 });
export const attachmentAccept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/heic,image/heif,.txt,.md,.markdown,.json,.csv,.tsv,.yaml,.yml,.log";
const textExtensions = /\.(?:txt|md|markdown|json|csv|tsv|ya?ml|log)$/i;
const extension = (name: string) => name.match(/\.([a-z0-9]+)$/i)?.[1].toUpperCase() ?? "";
export const charLabel = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k 字` : `${n} 字`;
type Size = { readonly width: number; readonly height: number };
interface Base { readonly id: string; readonly name: string; readonly bytes: number; readonly mime: string }
export interface ImageAttachment extends Base {
  readonly kind: "image";
  readonly blob: Blob;
  readonly size: Size;
  readonly sent: AskImage;
  readonly sentSize: Size;
  readonly sentBytes: number;
  readonly url: string;
  readonly params: ImageMetadata | null;
}
export interface TextAttachment extends Base { readonly kind: "text"; readonly text: string; readonly pasted: boolean }
export type Attachment = ImageAttachment | TextAttachment;
export type SavedAttachment = Omit<ImageAttachment, "url"> | TextAttachment;
export type AttachmentView = Pick<Base, "id" | "name"> & { readonly kind: "image" | "text"; readonly meta: string; readonly url?: string; readonly pasted?: boolean };
export const attachmentView = (a: Attachment): AttachmentView => ({
  id: a.id, name: a.name, kind: a.kind,
  ...(a.kind === "image" ? { url: a.url, meta: `${a.size.width}×${a.size.height} → ${a.sentSize.width}×${a.sentSize.height} · ${Math.ceil(a.sentBytes / 1024)} KB` }
    : { pasted: a.pasted, meta: `${a.pasted ? "" : `${extension(a.name) || "文本"} · `}${charLabel(a.text.length)}` }),
});

const textLimitMessage = (name: string, limit: number) => `${name} 超过 ${limit.toLocaleString("zh-CN")} 字符`;
export function decodeText(bytes: ArrayBuffer, name: string, limits: Readonly<TextAttachmentLimits> = DEFAULT_TEXT_ATTACHMENT_LIMITS) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error(`无法读取 ${name}`); }
  if (text.includes("\0")) throw new Error(`无法读取 ${name}`);
  if (text.length > limits.chars) throw new Error(textLimitMessage(name, limits.chars));
  return text;
}
export function attachmentCapacity(existing: readonly Attachment[], kind: Attachment["kind"], chars = 0, limits: Readonly<TextAttachmentLimits> = DEFAULT_TEXT_ATTACHMENT_LIMITS) {
  if (existing.filter(a => a.kind === kind).length >= (kind === "image" ? ATTACHMENT_LIMITS.images : ATTACHMENT_LIMITS.texts))
    throw new Error(kind === "image" ? "每条最多 4 张图片" : "每条最多 4 个文本附件");
  if (kind === "text" && chars > limits.chars) throw new Error(textLimitMessage("文本附件", limits.chars));
  if (kind === "text" && existing.reduce((n, a) => n + (a.kind === "text" ? a.text.length : 0), chars) > limits.totalChars)
    throw new Error(`每条文本附件合计最多 ${limits.totalChars.toLocaleString("zh-CN")} 字符`);
}
export function sendOriginal(mime: string, size: Size, bytes: number) {
  return ["image/png", "image/jpeg", "image/webp"].includes(mime) && Math.max(size.width, size.height) <= ATTACHMENT_LIMITS.edge && bytes <= ATTACHMENT_LIMITS.sentBytes;
}
async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}
/** Decode first; a misleading filename or MIME never turns a non-image into an image. */
export async function prepareAttachment(file: File, pasted = false, limits: Readonly<TextAttachmentLimits> = DEFAULT_TEXT_ATTACHMENT_LIMITS): Promise<Omit<TextAttachment, "id"> | Omit<ImageAttachment, "id" | "url">> {
  const name = file.name || "图片", ext = extension(name), prefix = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (ext === "SVG" || file.type === "image/svg+xml") throw new Error("不支持 SVG");
  const text = pasted || textExtensions.test(name) || file.type.startsWith("text/");
  if (text) {
    // Reject oversized UTF-8 files before reading them; allow four bytes per character and a BOM.
    if (file.size > limits.chars * 4 + 3) throw new Error(textLimitMessage(name, limits.chars));
    return { kind: "text", name, mime: file.type, bytes: file.size, pasted, text: decodeText(await file.arrayBuffer(), name, limits) };
  }
  if (/<svg(?=[\s/>])/i.test(new TextDecoder().decode(prefix))) throw new Error("不支持 SVG");
  if (file.size > ATTACHMENT_LIMITS.bytes) throw new Error(`${name} 超过 20 MB`);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch {
    throw new Error(file.type.startsWith("image/") ? `无法读取 ${name}` : `不支持 ${ext || "此文件类型"}`);
  }
  try {
    const size = { width: bitmap.width, height: bitmap.height };
    if (size.width * size.height > ATTACHMENT_LIMITS.pixels) throw new Error(`${name} 超过 4000 万像素`);
    // Sniff the three formats sent as-is; other decodable images become first-frame WebP.
    const mime = prefix[0] === 137 && prefix[1] === 80 && prefix[2] === 78 && prefix[3] === 71 ? "image/png"
      : prefix[0] === 255 && prefix[1] === 216 ? "image/jpeg"
      : String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" && String.fromCharCode(...prefix.slice(8, 12)) === "WEBP" ? "image/webp" : "";
    const original = sendOriginal(mime, size, file.size), sentSize = original ? size : fitSize(size.width, size.height, ATTACHMENT_LIMITS.edge);
    let encoded: Blob = file;
    if (!original) {
      const canvas = new OffscreenCanvas(sentSize.width, sentSize.height), g = canvas.getContext("2d");
      if (!g) throw new Error("当前浏览器不支持 Canvas");
      g.drawImage(bitmap, 0, 0, sentSize.width, sentSize.height);
      encoded = await canvas.convertToBlob({ type: "image/webp", quality: .85 });
      if (encoded.size > ATTACHMENT_LIMITS.sentBytes) encoded = await canvas.convertToBlob({ type: "image/webp", quality: .7 });
    }
    if (encoded.size > ATTACHMENT_LIMITS.sentBytes) throw new Error(`${name} 压缩后仍超过 1 MB`);
    const params = await readImageParams(file).catch(() => null);
    return { kind: "image", name, mime: mime || file.type, bytes: file.size, blob: file, size, sentSize, sentBytes: encoded.size, params,
      sent: { type: "image", mime: original ? mime as AskImage["mime"] : encoded.type === "image/webp" ? "image/webp" : "image/png", data: await base64(encoded), size: sentSize } };
  } finally { bitmap.close(); }
}

/** Page-memory assets. A tray or a view turn owns one reference, including failed turns. */
export function createAttachments(onRelease: (id: string) => void = () => {}) {
  const items = new Map<string, { value: Attachment; refs: number }>();
  let imageSequence = 0, textSequence = 0, bytes = 0;
  return {
    get bytes() { return bytes; },
    get size() { return items.size; },
    get(id: string) { return items.get(id)?.value ?? null; },
    read(ids: readonly string[]): Attachment[] { return ids.flatMap(id => { const a = items.get(id); return a ? [a.value] : []; }); },
    snapshot(ids: readonly string[]): SavedAttachment[] {
      return [...new Set(ids)].flatMap<SavedAttachment>(id => {
        const a = items.get(id)?.value;
        if (!a) return [];
        if (a.kind === "text") return [a];
        const { url: _url, ...stored } = a;
        return [stored];
      });
    },
    restore(saved: readonly SavedAttachment[], references: readonly string[]) {
      for (const a of saved) {
        if (items.has(a.id)) continue;
        if (bytes + a.bytes > ATTACHMENT_LIMITS.pageBytes) throw new Error("收藏附件已超过 200 MB");
        const value: Attachment = a.kind === "image" ? { ...a, url: URL.createObjectURL(a.blob) } : a;
        items.set(a.id, { value, refs: 0 }); bytes += a.bytes;
        if (a.kind === "image") imageSequence = Math.max(imageSequence, Number(a.id.slice(2)));
        else textSequence = Math.max(textSequence, Number(a.id.slice(5)));
      }
      this.retain(references);
    },
    add(prepared: Awaited<ReturnType<typeof prepareAttachment>>): Attachment {
      if (bytes + prepared.bytes > ATTACHMENT_LIMITS.pageBytes) throw new Error("本页附件已超过 200 MB");
      const value: Attachment = prepared.kind === "image" ? { ...prepared, id: `#a${++imageSequence}`, url: URL.createObjectURL(prepared.blob) }
        : { ...prepared, id: `text-${++textSequence}` };
      items.set(value.id, { value, refs: 1 }); bytes += value.bytes;
      return value;
    },
    retain(ids: readonly string[]) { for (const id of ids) { const item = items.get(id); if (item) item.refs++; } },
    release(ids: readonly string[]) {
      for (const id of ids) {
        const item = items.get(id);
        if (!item || --item.refs > 0) continue;
        if (item.value.kind === "image") URL.revokeObjectURL(item.value.url);
        onRelease(id);
        bytes -= item.value.bytes; items.delete(id);
      }
    },
    dispose() { for (const { value } of items.values()) if (value.kind === "image") URL.revokeObjectURL(value.url); items.clear(); bytes = 0; },
  };
}
export function attachmentBlocks(items: readonly Attachment[], metadataOnly: boolean): AskBlock[] {
  return [...items.filter(a => a.kind === "image"), ...items.filter(a => a.kind === "text")].flatMap<AskBlock>(a => {
    if (a.kind === "text") return [{ type: "text", source: { kind: "attachment", id: a.id }, text: `${dataText(`附件 ${a.id} · ${a.name} · ${a.text.length} 字`)}\n${dataBlock(a.text)}` }];
    return [
      { type: "text", text: dataText(`附件 ${a.id} · ${a.name} · ${a.size.width}×${a.size.height} → ${a.sentSize.width}×${a.sentSize.height}${metadataOnly ? " · 本轮仅元数据，未发送图片" : ""}`) },
      ...(!metadataOnly ? [{ ...a.sent, viewed: { ids: [a.id], spec: "attachment", bytes: a.sentBytes } }] : []),
      ...(a.params ? [{ type: "text" as const, text: dataBlock(JSON.stringify(a.params)) }] : []),
    ];
  });
}
export function attachmentPictures(items: readonly Attachment[]): Picture[] {
  return items.flatMap(a => a.kind === "image" ? [{ id: a.id, label: a.id, aliases: [a.id], createdAt: 0, blob: a.blob, size: a.size,
    origins: [{ source: "attachment" as const, label: a.id, order: Number(a.id.slice(2)) }], params: { ...a.params?.fields },
    attachment: { name: a.name, type: a.mime, original_size: a.size, sent_size: a.sentSize, original_bytes: a.bytes, sent_bytes: a.sentBytes, params: a.params },
  }] : []);
}
