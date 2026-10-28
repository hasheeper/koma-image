import type { ApplicationServices } from "../services/application.ts";
import type { Editor } from "../services/editor.ts";
import type { Drawing } from "../services/drawing.ts";
import type { Chat } from "../services/chat.ts";
import type { AppRouter } from "../app/router.ts";
import type { createSlates } from "../slate/service.ts";
import { names } from "../storage/names.ts";
import { imageLine, imageOrigin } from "../domain/image-origin.ts";
import type { LineId } from "../domain/image-origin.ts";
import { createHomeStore } from "./store.ts";
import { deriveHome } from "./derive.ts";
import type { HomeActivity, HomeDelivery, HomeLine } from "./derive.ts";

export function createHome(deps: { services: ApplicationServices; drawing: Drawing; chat: Chat; editor?: Editor; slates: ReturnType<typeof createSlates>; router: AppRouter; onError?: (error: unknown) => void }) {
  const { services, drawing, chat, slates, router, editor } = deps;
  const store = createHomeStore(services, deps.onError);
  const listeners = new Set<() => void>();
  let extraActivity: readonly HomeActivity[] = [];
  let disposed = false, deliveries: HomeDelivery[] = [], deliveryRevision = 0;
  const emit = () => { if (!disposed) for (const fn of listeners) fn(); };
  function validCover(line: LineId, id: string) {
    const d = drawing.snapshot(), c = chat.snapshot();
    return (line.startsWith("image:") ? d.boards.some(b => line === `image:${b.id}`) : c.conversations.some(c => line === `chat:${c.id}`))
      && d.favorites.some(f => f.id === id && imageLine(f.params) === line);
  }
  function prune() {
    if (disposed || services.data.phase !== "ready" || drawing.snapshot().favoritesLoading || drawing.snapshot().favoritesError || !chat.snapshot().loaded) return;
    void store.pruneCovers(validCover).catch(deps.onError ?? (() => {}));
  }
  async function syncDeliveries() {
    const token = ++deliveryRevision;
    const next = await Promise.all(slates.list.value.flatMap(s => s.todos.flatMap((todo, order) => todo.binding ? [(async (): Promise<HomeDelivery | null> => {
      const asset = await slates.asset(todo.binding!.assetId);
      return asset ? { slateId: s.id, slateTitle: s.title, todoId: todo.id, title: todo.title, order, active: slates.activeId.value === s.id,
        sourceId: asset.sourceId, params: imageOrigin(asset.params) } : null;
    })()] : [])));
    if (disposed || token !== deliveryRevision) return;
    deliveries = next.filter((d): d is HomeDelivery => !!d); emit();
  }
  const stops = [editor?.subscribe(emit) ?? (() => {}), store.subscribe(emit), drawing.onImage(store.capture), drawing.subscribe(() => { prune(); emit(); }),
    chat.subscribe(() => { prune(); emit(); }), slates.subscribe(() => { void syncDeliveries().catch(deps.onError ?? (() => {})); }),
    services.preferences.subscribe(key => { if (!key || key === names.preferences) prune(); }),
    router.beforeChange((previous, next) => {
      if (previous.workspace !== "home" && previous.workspace !== next.workspace)
        void store.remember(previous.workspace).catch(deps.onError ?? (() => {}));
    })];
  const ready = Promise.all([store.ready, chat.readStored(), slates.restored]).then(async () => { prune(); await syncDeliveries(); });
  void ready.catch(deps.onError ?? (() => {}));
  return {
    store, ready,
    editVersion(boardId: string, versionId: number) { return editor?.board(boardId)?.versions.find(v => v.id === versionId); },
    updateActivity(value: readonly HomeActivity[]) {
      if (JSON.stringify(value) === JSON.stringify(extraActivity)) return;
      extraActivity = value; emit();
    },
    snapshot(activity: readonly HomeActivity[] = []) {
      const d = drawing.snapshot(), c = chat.snapshot(), saved = store.snapshot();
      const running: HomeActivity[] = d.busy && d.pending?.boardId ? [{ line: `image:${d.pending.boardId}`, kind: "generation", text: `正在生成 ${d.pending.index}／${d.pending.total}` }] : [];
      if (c.busy) running.push({ line: `chat:${c.busy.cId}`, kind: "generation", text: c.busy.phase });
      const edits: HomeLine[] = (editor?.boards() ?? []).filter(s => s.versions.length).map(s => {
        const picture = (v: typeof s.versions[number]) => ({ kind: "edit" as const, boardId: s.id, versionId: v.id, width: v.width, height: v.height });
        const shown = s.versions.find(v => v.id === s.viewId) ?? s.versions.at(-1)!;
        return { id: ("edit:" + s.id) as HomeLine["id"], workspace: "edit", sourceId: s.id, title: s.name, face: picture(shown),
          recent: s.versions.filter(v => v !== shown).slice(-6).reverse().map(picture), excerpt: s.fields.prompt.slice(0, 160),
          updatedAt: s.updatedAt, count: s.versions.length, status: editor?.snapshot().runningBoardId === s.id ? "正在编辑" : "", delivery: null };
      });
      return { ...deriveHome({ edits, activeEditId: editor?.session.id, boards: d.boards, activeBoardId: d.activeBoardId, history: d.history, favorites: d.favorites,
        conversations: c.conversations, currentConversationId: c.current.id, assets: chat.assets.assets,
        previews: saved.previews, preferences: saved.preferences, deliveries, activity: [...running, ...extraActivity, ...activity] }),
        preferences: saved.preferences, error: saved.error };
    },
    async setCover(line: LineId, favoriteId: string | null) {
      if (favoriteId && !validCover(line, favoriteId)) throw new Error("只能将这条创作线的收藏设为封面");
      await store.setCover(line, favoriteId);
    },
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
    async dispose() { disposed = true; deliveryRevision++; stops.forEach(stop => stop()); listeners.clear(); await store.dispose(); },
  };
}
export type Home = ReturnType<typeof createHome>;
