import type { DrawingBoard } from "../domain/drawing.ts";
import type { ConversationRecord, FavoriteRecord } from "../storage/records.ts";
import type { DigestImage } from "../ask/digest/index.ts";
import { imageLine, canReuseDrawingParams, chatImageId } from "../domain/image-origin.ts";
import type { LineId } from "../domain/image-origin.ts";
import type { HomePreferences, HomePreview } from "./model.ts";

type Dimensions = { width: number; height: number };
export type HomePicture = Dimensions & (
  | { kind: "history" | "favorite"; recordId: string }
  | { kind: "chat"; conversationId: string; turnId: string; versionId: string; assetId: string }
  | { kind: "preview"; boardId: string }
  | { kind: "edit"; boardId: string; versionId: number }
);
export interface HomeDelivery {
  slateId: string; slateTitle: string; todoId: string; title: string; order: number; active: boolean;
  sourceId: string; params: Readonly<Record<string, unknown>>;
}
export interface HomeActivity { line: LineId; kind: "generation" | "draft" | "mask" | "photopea"; text: string }
export interface HomeLine {
  id: LineId; workspace: "image" | "chat" | "edit"; sourceId: string; title: string; color?: string;
  face: HomePicture | null; excerpt: string; recent: HomePicture[]; updatedAt: number; count: number | null;
  status: string; delivery: HomeDelivery | null;
}
export interface HomeInput {
  edits?: readonly HomeLine[]; activeEditId?: string;
  boards: readonly DrawingBoard[]; activeBoardId: string;
  history: readonly DigestImage[]; favorites: readonly FavoriteRecord[];
  conversations: readonly ConversationRecord[]; currentConversationId: string;
  assets: ReadonlyMap<string, Dimensions>;
  previews: readonly HomePreview[]; preferences: HomePreferences;
  deliveries?: readonly HomeDelivery[]; activity?: readonly HomeActivity[];
}
const newest = <T extends { createdAt: number }>(items: readonly T[]) => [...items].sort((a, b) => b.createdAt - a.createdAt);
const recordPicture = (record: DigestImage, kind: "history" | "favorite"): HomePicture => ({ kind, recordId: record.id, width: record.size.width, height: record.size.height });
const pictureId = (p: HomePicture) => "recordId" in p ? p.recordId : p.kind === "chat"
  ? chatImageId(p.conversationId, p.turnId, p.versionId, p.assetId) : null;
const samePicture = (a: HomePicture, b: HomePicture | null) => !!b && pictureId(a) !== null && pictureId(a) === pictureId(b);

function chatPictures(conversation: ConversationRecord, assets: HomeInput["assets"]): HomePicture[] {
  const versions = [...conversation.turns].reverse().flatMap(turn => [...turn.versions].reverse().map(version => ({ turn, version })))
    .filter(({ version }) => version.status === "done")
    // Older records have no completion timestamp; stable sorting retains their
    // existing turn/version order. A later retry of an earlier turn still wins.
    .sort((a, b) => (b.version.completedAt ?? 0) - (a.version.completedAt ?? 0));
  return versions.flatMap(({ turn, version }) => version.blocks.flatMap((block): HomePicture[] => {
      if (block.type !== "image") return [];
      const size = assets.get(block.assetId);
      return size ? [{ kind: "chat", conversationId: conversation.id, turnId: turn.id, versionId: version.id, assetId: block.assetId, width: size.width, height: size.height }] : [];
    }));
}
export function sourceTrail(params: Readonly<Record<string, unknown>>, boards: readonly DrawingBoard[], conversations: readonly ConversationRecord[]): string {
  const line = imageLine(params);
  let source = "";
  if (line?.startsWith("chat:")) {
    const conversation = conversations.find(c => c.id === params.chatConversationId);
    source = conversation?.title ?? String(params.chatConversationTitle || "已删除的对话");
    if (params.chatTurnNumber) source += ` · 第 ${params.chatTurnNumber} 轮`;
  } else if (line) source = boards.find(b => b.id === params.boardId)?.name ?? "已删除的画板";
  else if (typeof params.boardName === "string") source = params.boardName;
  const tool = params.enhance === true ? params.enhanceScale === "max" ? "Enhance Max" : "Enhance" : ({ img2img: "图生图", inpaint: "重绘", upscale: "放大", "manual-edit": "手动修图" } as Record<string, string>)[String(params.tool)];
  return [source, tool].filter(Boolean).join(" → ");
}

/** Pure projection; it contains IDs and display metadata, never decoded images or service state. */
export function deriveHome(input: HomeInput) {
  const { boards, conversations, history, preferences } = input;
  const favorites = [...input.favorites].sort((a, b) => b.favoritedAt - a.favoritedAt || b.createdAt - a.createdAt);
  const cover = (id: LineId) => favorites.find(f => f.id === preferences.covers[id] && imageLine(f.params) === id);
  const delivery = (id: LineId) => input.deliveries?.filter(d => d.active && imageLine(d.params) === id).sort((a, b) => a.order - b.order)[0] ?? null;
  const status = (id: LineId) => [...(input.activity ?? [])].filter(a => a.line === id)
    .sort((a, b) => ["generation", "draft", "mask", "photopea"].indexOf(a.kind) - ["generation", "draft", "mask", "photopea"].indexOf(b.kind))[0]?.text ?? "";
  const imageLines: HomeLine[] = boards.map(board => {
    const id: LineId = `image:${board.id}`, pinned = cover(id), records = newest(history.filter(r => imageLine(r.params) === id));
    const cached = input.previews.find(p => p.boardId === board.id), latest = records[0];
    const face: HomePicture | null = pinned ? recordPicture(pinned, "favorite") : latest ? recordPicture(latest, "history")
      : cached ? { kind: "preview", boardId: board.id, width: cached.width, height: cached.height } : null;
    const recent = records.length ? records.map(r => recordPicture(r, "history")) : favorites.filter(f => imageLine(f.params) === id).map(f => recordPicture(f, "favorite"));
    return { id, workspace: "image", sourceId: board.id, title: board.name, color: board.color, face,
      excerpt: String(board.form.prompt).slice(0, 160), recent: recent.filter(p => !samePicture(p, face)).slice(0, 6),
      updatedAt: Math.max(latest?.createdAt ?? 0, cached?.createdAt ?? 0), count: records.length || null, status: status(id), delivery: delivery(id) };
  });
  const chatLines: HomeLine[] = conversations.filter(c => c.turns.length || c.id === input.currentConversationId).map(c => {
    const id: LineId = `chat:${c.id}`, pinned = cover(id), pictures = chatPictures(c, input.assets);
    const face = pinned ? recordPicture(pinned, "favorite") : pictures[0] ?? null;
    return { id, workspace: "chat", sourceId: c.id, title: c.title, face, excerpt: (c.prompt || c.turns.at(-1)?.prompt || "").slice(0, 160),
      recent: pictures.filter(p => !samePicture(p, face)).slice(0, 6), updatedAt: c.updatedAt, count: c.turns.length,
      status: status(id) || (c.turns.length ? `第 ${c.turns.length} 轮` : ""), delivery: delivery(id) };
  });
  const editLines = (input.edits ?? []).map(line => ({ ...line, status: status(line.id) || line.status }));
  const all = [...imageLines, ...chatLines, ...editLines];
  const current = (preferences.lastLocation?.workspace === "edit" ? editLines.find(e => e.sourceId === input.activeEditId) : undefined)
    ?? (preferences.lastLocation?.workspace === "chat" ? chatLines.find(c => c.sourceId === input.currentConversationId) : undefined)
    ?? imageLines.find(b => b.sourceId === input.activeBoardId) ?? all[0] ?? null;
  const recentChat = new Set(chatLines.filter(c => conversations.find(v => v.id === c.sourceId)?.turns.length)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map(c => c.id));
  const others = all.filter(line => line !== current && line.face && (line.workspace !== "chat" || recentChat.has(line.id)))
    .sort((a, b) => (a.delivery?.order ?? Infinity) - (b.delivery?.order ?? Infinity) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const firstUse = !favorites.length && !all.some(line => line.face) && !conversations.some(c => c.turns.length);
  const lines = firstUse ? [] : [...(current ? [current] : []), ...others];
  const finals = favorites.map(f => ({ recordId: f.id, size: { ...f.size }, line: imageLine(f.params),
    source: sourceTrail(f.params, boards, conversations), canRestore: f.params.tool !== "upscale" && canReuseDrawingParams(f.params),
    deliveries: (input.deliveries ?? []).filter(d => d.sourceId === f.id) }));
  return { firstUse, current: firstUse ? null : current, lines, allLines: all, finals };
}
