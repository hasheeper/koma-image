import type { AskText } from "../messages.ts";
import type { SavedAttachment } from "../attachments.ts";
import { dataBlock, dataText } from "../prompts/index.ts";
import { dehydrate } from "../session.ts";
import type { CommittedTurn, TurnId } from "./ledger.ts";
import { replyText } from "./ledger.ts";
import { canonical } from "../canonical.ts";

export type AttachmentReader = (id: string) => SavedAttachment | null;
export interface AttachmentIndex {
  readonly id: string;
  readonly name: string;
  readonly kind: "text" | "image";
  readonly turnId: TurnId;
  readonly total_chars?: number;
  readonly size?: { readonly width: number; readonly height: number };
}
export function attachmentIndex(turns: readonly CommittedTurn[], read: AttachmentReader): AttachmentIndex[] {
  const seen = new Set<string>(), out: AttachmentIndex[] = [];
  for (const turn of turns) for (const id of turn.attachments) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = read(id);
    if (!a) throw new Error(`附件 ${id} 已不可用`);
    out.push({ id, name: a.name, kind: a.kind, turnId: turn.turnId,
      ...(a.kind === "text" ? { total_chars: a.text.length } : { size: a.size }) });
  }
  return out;
}
function textBlock(block: AskText, read: AttachmentReader, restore: boolean): AskText {
  // get_turn results are our own canonical envelope. Keep their records, but
  // extract recalled attachment pages too, so full recall cannot bypass paging.
  if (block.source?.kind === "recall") {
    const value: ReturnType<typeof getTurn> = JSON.parse(block.text.slice(7, -8));
    const attachments = value.attachments.map(page => {
      if (page.kind !== "text") return page;
      const a = read(page.id);
      if (!a || a.kind !== "text") throw new Error(`文本附件 ${page.id} 已不可用`);
      return { ...page, text: restore ? a.text.slice(page.offset, page.next_offset ?? page.total_chars)
        : `[正文见 get_turn attachments=["${page.id}"] offset=${page.offset}]` };
    });
    return { type: "text", text: dataBlock(canonical({ ...value, attachments })),
      source: { kind: "recall", ...(!restore ? { archived: true } : {}) } };
  }
  if (block.source?.kind !== "attachment") return block;
  const a = read(block.source.id);
  if (!a || a.kind !== "text") throw new Error(`文本附件 ${block.source.id} 已不可用`);
  const heading = block.source.heading ?? dataText(`附件 ${a.id} · ${a.name} · ${a.text.length} 字`);
  const { archived: _archived, ...source } = block.source;
  return { type: "text", source: { ...source, ...(!restore ? { archived: true } : {}) },
    text: restore ? `${heading}\n${dataBlock(a.text.slice(source.offset ?? 0, source.end))}`
      : `${heading} · 正文见 get_turn attachments=["${a.id}"]${source.offset !== undefined ? ` offset=${source.offset}` : ""}` };
}
/** No body matching: only locally attributed blocks can become placeholders. */
export function archiveTurn(turn: CommittedTurn, read: AttachmentReader): CommittedTurn {
  return { ...turn, messages: dehydrate(turn.messages).map(m => ({ ...m, content: m.content.map(b =>
    b.type === "text" ? textBlock(b, read, false) : b.type === "result"
      ? { ...b, content: b.content.map(p => p.type === "text" ? textBlock(p, read, false) : p) } : b) })) };
}
/** The existing resource pool owns bodies; the candidate carries the exact referenced records. */
export function archiveTurns(turns: readonly CommittedTurn[], read: AttachmentReader) {
  const index = attachmentIndex(turns, read);
  return { turns: turns.map(t => archiveTurn(t, read)), index,
    texts: index.flatMap(a => { const value = read(a.id); return value?.kind === "text" ? [value] : []; }) };
}
export function restoreTurn(turn: CommittedTurn, read: AttachmentReader): CommittedTurn {
  const restore = (b: AskText) => b.source && "archived" in b.source && b.source.archived ? textBlock(b, read, true) : b;
  return { ...turn, messages: turn.messages.map(m => ({ ...m, content: m.content.map(b =>
    b.type === "text" ? restore(b) : b.type === "result" ? { ...b, content: b.content.map(p => p.type === "text" ? restore(p) : p) } : b) })) };
}
const ids = (value: unknown, name: string, pattern: RegExp, limit: number): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.length > limit || !value.every(v => typeof v === "string" && pattern.test(v))
    || new Set(value).size !== value.length) throw new Error(`${name} 需为 1–${limit} 个不同的有效编号`);
  return value;
};
export const TEXT_PAGE_CHARS = 8000;
/** Only successful records supplied by this conversation grant access to pooled attachments. */
export function getTurn(input: Readonly<Record<string, unknown>>, turns: readonly CommittedTurn[], read: AttachmentReader) {
  const turnIds = ids(input.turns, "turns", /^T[1-9]\d*$/, 3);
  const attachments = ids(input.attachments, "attachments", /^(?:text-[1-9]\d*|#a[1-9]\d*)$/, 2);
  if (!turnIds.length && !attachments.length) throw new Error("请提供 turns 或 attachments");
  const include = input.include === undefined ? "draft" : input.include, offset = input.offset === undefined ? 0 : input.offset;
  if (include !== "draft" && include !== "full") throw new Error("include 需为 draft 或 full");
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("offset 需为非负安全整数");
  if (input.offset !== undefined && (attachments.length !== 1 || !attachments[0].startsWith("text-")))
    throw new Error("传入 offset 时只能读取 1 个文本附件");
  const allowed = new Set(turns.flatMap(t => t.attachments));
  const found = turnIds.map(id => {
    const t = turns.find(t => t.turnId === id);
    if (!t) throw new Error(`${id} 不在本会话的成功轮次中`);
    return t;
  });
  return {
    turns: found.map(t => ({ turnId: t.turnId, question: t.question, reply: replyText(t),
      draft: t.draft ?? null, attachments: t.attachments, ...(t.pictureRefs ? {picture_refs:t.pictureRefs} : {}),
      // This includes exactly the initial state text, never a reconstructed workspace snapshot.
      ...(include === "full" ? { messages: archiveTurn(t, read).messages.map(m => ({ ...m, content: m.content.map(b =>
        b.type === "text" ? { type: b.type, text: b.text } : b.type === "result" ? { ...b,
          content: b.content.map(p => p.type === "text" ? { type: p.type, text: p.text } : p) } : b) })) } : {}) })),
    attachments: attachments.map(id => {
      if (!allowed.has(id)) throw new Error(`${id} 不在本会话的成功轮次中`);
      const a = read(id);
      if (!a) throw new Error(`附件 ${id} 已不可用`);
      if (a.kind === "image") return { id, name: a.name, kind: a.kind, size: a.size, mime: a.mime, ...(a.origin ? { origin: a.origin } : {}) };
      if (offset > a.text.length) throw new Error(`${id} 的 offset 超过正文长度 ${a.text.length}`);
      const end = Math.min(a.text.length, offset + TEXT_PAGE_CHARS);
      return { id, name: a.name, kind: a.kind, ...(a.origin ? { origin: a.origin } : {}), text: a.text.slice(offset, end), total_chars: a.text.length, offset,
        next_offset: end < a.text.length ? end : null };
    }),
  };
}
