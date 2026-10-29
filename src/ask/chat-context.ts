import { chatImageId, chatImageOrigin } from "../domain/image-origin.ts";
import { ancestry, chatDraftKey, chatSelection, contextSnapshot } from "../domain/conversation.ts";
import type { ChatSelection } from "../domain/conversation.ts";
import type { ConversationVersion, Fields } from "../storage/records.ts";
import { normalizeOptions } from "../domain/catalog.ts";
import type { CatalogModel } from "../domain/catalog.ts";
import { chatReadOnlyKeys, chatSizeKeys } from "../domain/chat-options.ts";
import { object } from "../domain/value.ts";
import type { Chat } from "../services/chat.ts";
import type { Picture } from "./library.ts";
import type { ChatModelDraft } from "./draft/types.ts";

export interface ChatSource {
  /** `#cN.M` of the selected version. */
  readonly label: string;
  readonly turnId: string;
  /** First image of the selected version, once it finished. */
  readonly assetId: string | null;
  readonly prompt: string;
  /** Finished images of every version; absent in drafts saved before `#cN.M.K`. */
  readonly versions?: readonly (readonly string[])[];
}
export interface ChatDraftSnapshot {
  readonly key: string;
  readonly selection: ChatSelection;
  readonly sources: readonly ChatSource[];
}
const finished = (v: ConversationVersion | undefined) => v?.status === "done" ? v.blocks.flatMap((b) => b.type === "image" ? [b.assetId] : []) : [];
export function chatSnapshot(state: ReturnType<Chat["snapshot"]>): ChatDraftSnapshot {
  const c = state.current;
  return { key: chatDraftKey(c), selection: chatSelection(c), sources: ancestry(c).map((t, i) => ({
    label: `#c${i + 1}.${t.selectedVersion + 1}`, turnId: t.id, prompt: t.prompt,
    assetId: finished(t.versions[t.selectedVersion])[0] ?? null, versions: t.versions.map(finished),
  })) };
}
const chatId = /^#c([1-9]\d*)\.([1-9]\d*)(?:([a-z])|\.([1-9]\d*))?$/;
/** `#cN.M[a-z]`: branch turn N, version M, image letter; also reads legacy numeric `.K`. */
export function chatImage(snapshot: Pick<ChatDraftSnapshot, "sources">, label: string) {
  const m = chatId.exec(label), source = m ? snapshot.sources[Number(m[1]) - 1] : undefined;
  if (!m || !source) return null;
  const version = Number(m[2]) - 1, index = m[3] ? m[3].charCodeAt(0) - 97 : Number(m[4] ?? 1) - 1, selected = source.label === `#c${m[1]}.${m[2]}`,
    assetId = source.versions ? source.versions[version]?.[index] : selected && !index ? source.assetId : null;
  return assetId ? { source, version, index, assetId, selected } : null;
}
/** Any `#cN.*` names turn N, whichever version or image follows. */
export const chatTurn = (snapshot: Pick<ChatDraftSnapshot, "sources">, label: string) =>
  chatId.test(label) ? snapshot.sources[Number(chatId.exec(label)![1]) - 1] ?? null : null;
/** Every finished image on the current branch; `#cN.M` stays the label of single-image versions. */
export function chatImages(state: ReturnType<Chat["snapshot"]>) {
  const c = state.current;
  return ancestry(c).flatMap((turn, i) => turn.versions.flatMap((version, j) => {
    const ids = finished(version), base = `#c${i + 1}.${j + 1}`;
    return ids.map((assetId, k) => ({ turn, version, assetId, index: k, number: j, selected: j === turn.selectedVersion,
      label: ids.length > 1 ? k < 26 ? `${base}${String.fromCharCode(97+k)}` : `${base}.${k + 1}` : base, aliases: [...new Set([...(k < 26 ? [`${base}${String.fromCharCode(97+k)}`] : []), ids.length > 1 ? `${base}.${k + 1}` : base, `${base}.${k + 1}`, ...(k ? [] : [base])])] }));
  }));
}
export interface ChatOptionState { readonly value: string; readonly options: readonly string[] }
export type ChatModelState = { readonly ready: false } | {
  readonly ready: true; readonly name: string; readonly max_images: number;
  readonly writable: Readonly<Record<string, ChatOptionState>>; readonly read_only: Readonly<Record<string, ChatOptionState>>;
};
/** Display name, image limit and the known option keys only: no connection, upstream ID or other settings. */
export function chatModelState(state: ReturnType<Chat["snapshot"]>): ChatModelState {
  const m = state.model;
  if (!state.ready || !m) return { ready: false };
  const values = normalizeOptions(m, object(state.current.settings.options) as Record<string, string>),
    pick = (keys: readonly string[]) => Object.fromEntries(keys.filter((k) => m.fields[k]).map((k) => [k, { value: values[k], options: [...m.fields[k].options] }]));
  return { ready: true, name: m.name, max_images: m.maxImages, writable: pick(chatSizeKeys), read_only: pick(chatReadOnlyKeys) };
}
/** The draft-side copy keeps the model ID locally so a later model switch can be detected; it is never sent. */
export function chatDraftModel(state: ReturnType<Chat["snapshot"]>): ChatModelDraft | null {
  const s = chatModelState(state);
  return s.ready ? { id: state.model!.id, name: s.name, maxImages: s.max_images, writable: s.writable } : null;
}
export function chatContext(state: ReturnType<Chat["snapshot"]>) {
  const c = state.current, snapshot = contextSnapshot(c, c.prompt, state.model?.maxImages ?? Infinity), sources = chatSnapshot(state).sources, images = chatImages(state);
  return {
    scope: "当前会话的当前分支；其他分支不自动发送", title: c.title,
    turns: sources.map((s, i) => ({ id: s.label, text: s.prompt, included: snapshot.turnIds.includes(s.turnId), has_image: !!s.assetId,
      versions: ancestry(c)[i].versions.map((v, j) => ({ id: `#c${i + 1}.${j + 1}`, status: v.status, selected: s.label === `#c${i + 1}.${j + 1}`,
        images: images.filter((p) => p.version === v).map((p) => p.label) })) })),
    base: images.find((p) => p.assetId === snapshot.base)?.label ?? (snapshot.base ? "用户参考图" : null),
    base_follows: c.baseFollows, images: { sent: snapshot.imageIds.length, refs: snapshot.refs.length, dropped: snapshot.dropped.length, limit: state.model?.maxImages ?? null },
    quota: state.quota ? { images: state.quota.image ? { remaining: state.quota.image.remaining, limit: state.quota.image.limit } : null, temporary: state.quota.temporary } : null, actual_text: snapshot.text, composer: c.prompt,
    chat_model: chatModelState(state), available_models: state.ready ? [...new Set(state.models.map((m) => m.name))] : [],
  };
}
/** Turn settings as ASK may read them: the display name and known option values only. */
function turnParams(settings: Fields, models: readonly CatalogModel[]) {
  const name = models.find((m) => m.id === settings.model)?.name, options = object(settings.options);
  const known = Object.fromEntries([...chatSizeKeys, ...chatReadOnlyKeys].flatMap((k) => typeof options[k] === "string" ? [[k, options[k]]] : []));
  return { ...(name ? { modelName: name } : {}), ...(Object.keys(known).length ? { chat_options: known } : {}) };
}
export function chatPictures(state: ReturnType<Chat["snapshot"]>, chat: Chat): Picture[] {
  let order = 0;
  return chatImages(state).flatMap((p) => {
    const asset = chat.assets.assets.get(p.assetId);
    return asset ? [{ id: chatImageId(state.current.id, p.turn.id, p.version.id, p.assetId), entity_key: `sha256:${asset.id}`, lineage: asset.lineage ?? { via: "chat" as const },
      scope: { kind: "chat", id: state.current.id, turn_id: p.turn.id, version_id: p.version.id, asset_id: asset.id }, label: p.label, aliases: p.aliases, createdAt: 0,
      origins: [{ source: "chat" as const, label: p.label, order: ++order }],
      params: { ...chatImageOrigin(state.current,p.turn,p.version,p.assetId), basePrompt: p.turn.prompt, ...turnParams(p.turn.settings, state.models), version: p.number + 1, image_index: p.index + 1, selected: p.selected },
      size: { width: asset.width, height: asset.height }, blob: asset.blob }] : [];
  });
}
