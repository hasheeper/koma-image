import { ancestry, chatDraftKey, chatSelection, contextSnapshot } from "../domain/conversation.ts";
import type { ChatSelection } from "../domain/conversation.ts";
import type { Chat } from "../services/chat.ts";
import type { Picture } from "./library.ts";

export interface ChatSource { readonly label: string; readonly turnId: string; readonly assetId: string | null; readonly prompt: string }
export interface ChatDraftSnapshot {
  readonly key: string;
  readonly selection: ChatSelection;
  readonly sources: readonly ChatSource[];
}
export function chatSnapshot(state: ReturnType<Chat["snapshot"]>): ChatDraftSnapshot {
  const c = state.current;
  return { key: chatDraftKey(c), selection: chatSelection(c), sources: ancestry(c).map((t, i) => ({
    label: `#c${i + 1}.${t.selectedVersion + 1}`, turnId: t.id, prompt: t.prompt,
    assetId: t.versions[t.selectedVersion]?.status === "done" ? t.versions[t.selectedVersion].blocks.find((b) => b.type === "image")?.assetId ?? null : null,
  })) };
}
export function chatContext(state: ReturnType<Chat["snapshot"]>) {
  const c = state.current, snapshot = contextSnapshot(c, c.prompt, state.model?.maxImages ?? Infinity), sources = chatSnapshot(state).sources;
  return {
    scope: "当前会话的当前分支；其他分支不自动发送", title: c.title,
    turns: sources.map((s) => ({ id: s.label, text: s.prompt, included: snapshot.turnIds.includes(s.turnId), has_image: !!s.assetId })),
    base: sources.find((s) => s.assetId === snapshot.base)?.label ?? (snapshot.base ? "用户参考图" : null),
    base_follows: c.baseFollows, images: { sent: snapshot.imageIds.length, refs: snapshot.refs.length, dropped: snapshot.dropped.length, limit: state.model?.maxImages ?? null },
    quota: state.quota ? { images: state.quota.image ? { remaining: state.quota.image.remaining, limit: state.quota.image.limit } : null, temporary: state.quota.temporary } : null, actual_text: snapshot.text, composer: c.prompt,
  };
}
export function chatPictures(state: ReturnType<Chat["snapshot"]>, chat: Chat): Picture[] {
  return chatSnapshot(state).sources.flatMap((s, i) => {
    const asset = s.assetId ? chat.assets.assets.get(s.assetId) : null;
    return asset ? [{ id: `chat:${state.current.id}:${s.turnId}`, label: s.label, aliases: [s.label], createdAt: 0,
      origins: [{ source: "chat" as const, label: s.label, order: i + 1 }],
      params: { basePrompt: s.prompt }, size: { width: asset.width, height: asset.height }, blob: asset.blob }] : [];
  });
}
