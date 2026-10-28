import { ATTACHMENT_LIMITS, attachmentCapacity, attachmentPictures, prepareAttachment } from "./attachments.ts";
import type { Attachment, createAttachments } from "./attachments.ts";
import type { TextAttachmentLimits } from "./settings.ts";
import type { RefSnapshot } from "./reference-source.ts";
import type { ToolOutcome } from "./tools.ts";
import type { Vision, VisionContext } from "./vision.ts";
import { TEXT_PAGE_CHARS } from "./compact/archive.ts";
import { dataBlock, dataText } from "./prompts/index.ts";
import { canonical } from "./canonical.ts";

export function referenceByteLimit(kind: "text" | "image", limits: Readonly<TextAttachmentLimits>, pageBytes: number) {
  return Math.min(ATTACHMENT_LIMITS.pageBytes - pageBytes, kind === "text" ? limits.chars * 4 + 3 : ATTACHMENT_LIMITS.bytes);
}
/** Tool reads join the same resource pool, per-turn attachment limits and visual budget. */
export function createReferenceReader(deps: {
  source: RefSnapshot | null; pool: ReturnType<typeof createAttachments>; attached: Attachment[];
  limits: Readonly<TextAttachmentLimits>; pageBytes(): number; visual: VisionContext; vision: Vision;
  added(value: Attachment): void;
}) {
  const cache = new Map<string, Attachment>();
  return async (input: Readonly<Record<string, unknown>>): Promise<ToolOutcome> => {
    const { source, pool, attached, limits, visual, vision } = deps;
    if (!source) throw new Error("尚未挂载可读取的协同目录");
    if (typeof input.path !== "string" || !input.path || input.path.length > 1024) throw new Error("path 需要 refs/ 内的相对文件名");
    const path = source.resolve(input.path), offset = input.offset ?? 0;
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("offset 需为非负安全整数");
    const kind = source.kind(path);
    if (kind === "image" && visual.metadataOnly) throw new Error("本轮图片能力未启用，不能读取资料图片");
    if (kind === "image" && offset !== 0) throw new Error("图片不支持 offset");
    visual.signal.throwIfAborted();
    let item = cache.get(path), fresh = false;
    if (!item) {
      attachmentCapacity(attached, kind, 0, limits);
      const read = await source.read(path, visual.signal, referenceByteLimit(kind, limits, deps.pageBytes()));
      const prepared = await prepareAttachment(read.file, false, limits);
      visual.signal.throwIfAborted();
      attachmentCapacity(attached, prepared.kind, prepared.kind === "text" ? prepared.text.length : 0, limits);
      if (prepared.bytes + deps.pageBytes() > ATTACHMENT_LIMITS.pageBytes) throw new Error("本页附件已超过 200 MB");
      item = pool.add({ ...prepared, origin: read.origin, toolRead: true }); fresh = true;
    }
    try {
      let outcome: ToolOutcome;
      if (item.kind === "text") {
        if (offset > item.text.length) throw new Error(`offset 超过正文长度 ${item.text.length}`);
        const end = Math.min(item.text.length, offset + TEXT_PAGE_CHARS);
        const heading = dataText(canonical({ id: item.id, path, version: item.origin?.version, total_chars: item.text.length, offset, next_offset: end < item.text.length ? end : null }));
        outcome = { content: [{ type: "text", text: `${heading}\n${dataBlock(item.text.slice(offset, end))}`,
          source: { kind: "attachment", id: item.id, heading, offset, end } }], stat: `${end - offset} 字` };
      } else {
        const result = await vision.image(attachmentPictures([item])[0], "look", undefined, visual);
        outcome = { content: [{ type: "text", text: dataBlock(canonical({ id: item.id, path, version: item.origin?.version, ...(result.duplicate ? { already_viewed_this_turn: true } : {}), bytes: result.bytes, pixels: result.pixels })) }, ...(result.image ? [result.image] : [])], stat: result.duplicate ? "本轮已查看" : `${Math.ceil(result.bytes / 1024)} KB` };
      }
      visual.signal.throwIfAborted();
      if (fresh) { cache.set(path, item); attached.push(item); deps.added(item); }
      return outcome;
    } catch (e) { if (fresh) pool.release([item.id]); throw e; }
  };
}
