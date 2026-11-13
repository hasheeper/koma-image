import { object } from "../domain/value.ts";
import type { CallRecord } from "./debug.ts";

export type CallExportMode = "compact" | "raw";
const encoder = new TextEncoder();
const sections = new Set(["tools", "system", "systemInstruction", "messages", "contents"]);
const sequences = new Set(["system", "messages", "contents"]);

/** Transform only the downloaded copy. In-memory dispatch bodies remain byte-for-byte intact. */
export function exportCallLog(records: readonly CallRecord[], dropped: number, mode: CallExportMode = "compact") {
  if (mode === "raw") return JSON.stringify({ app: "koma-ask", kind: "call-debug", version: 1, dropped, calls: records }, null, 2);

  const images: Record<string, { mime: string; bytes: number; base64_chars: number; occurrences: number }> = {};
  const imageIds = new Map<string, string>();
  function omitImage(mime: string, data: string) {
    const key = `${mime}:${data}`;
    let id = imageIds.get(key);
    if (!id) {
      id = `image${imageIds.size + 1}`;
      imageIds.set(key, id);
      const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
      images[id] = { mime, bytes: Math.max(0, Math.floor(data.length * .75) - padding), base64_chars: data.length, occurrences: 0 };
    }
    images[id].occurrences++;
    return `[${id}: Base64 已省略，图片信息见 images.${id}]`;
  }
  function foldImages(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(foldImages);
    if (!value || typeof value !== "object") return value;
    const item = object(value);
    return Object.fromEntries(Object.entries(item).map(([key, child]) => {
      if (typeof child === "string") {
        const url = key === "url" ? /^data:(image\/[\w.+-]+);base64,([\s\S]*)$/i.exec(child) : null;
        if (url) return [key, omitImage(url[1], url[2])];
        const mime = key === "data" ? item.type === "base64" ? item.media_type : item.mimeType : null;
        if (typeof mime === "string" && mime.startsWith("image/")) return [key, omitImage(mime, child)];
      }
      return [key, foldImages(child)];
    }));
  }
  // Only whole wire messages / system blocks / tool definitions are pooled. Their contents,
  // including tool arguments, result text and native JSON Schema $refs, are left verbatim.
  function mapSections(body: Record<string, unknown>, map: (value: unknown) => unknown) {
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key,
      !sections.has(key) ? value : sequences.has(key) && Array.isArray(value) ? value.map(map) : map(value),
    ]));
  }
  const prepared = records.map(({ body, ...summary }) => ({ ...summary, body: object(foldImages(JSON.parse(body))) }));
  const counts = new Map<string, number>();
  for (const call of prepared) mapSections(call.body, value => {
    const key = JSON.stringify(value);
    if (encoder.encode(key).length >= 256) counts.set(key, (counts.get(key) ?? 0) + 1);
    return value;
  });
  const blocks: Record<string, unknown> = {}, blockIds = new Map<string, string>();
  const calls = prepared.map(call => ({ ...call, body: mapSections(call.body, value => {
    const key = JSON.stringify(value);
    if ((counts.get(key) ?? 0) < 2) return value;
    let id = blockIds.get(key);
    if (!id) { id = `b${blockIds.size + 1}`; blockIds.set(key, id); blocks[id] = value; }
    return { $ref: `#/blocks/${id}` };
  }) }));
  return JSON.stringify({
    app: "koma-ask", kind: "call-debug", version: 2, format: "compact", dropped,
    note: "精简调试导出：calls[].body 为请求对象；其 tools/system/systemInstruction 及 messages/contents 中的整块 $ref 指向 blocks，按原顺序展开即可读取完整文本。图片 Base64 用标记替代，images 保留类型、大小与重复次数。bytes 仍为实际请求字节数。此文件不是可直接重放的原始请求；需要图片数据时选择完整导出。",
    images, blocks, calls,
  }, null, 2);
}
