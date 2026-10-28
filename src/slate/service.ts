import { imageEntity } from "../domain/image-identity.ts";
import type { Editor } from "../services/editor.ts";
import { shallowRef } from "vue";
import type { ApplicationServices } from "../services/application.ts";
import type { Drawing } from "../services/drawing.ts";
import type { DrawingForm, DrawingBoard } from "../domain/drawing.ts";
import { canonical } from "../ask/canonical.ts";
import { imageParameters } from "../domain/image-parameters.ts";
import { names } from "../storage/names.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import { contentKey, sha256 } from "./model.ts";
import type { Slate, SlateAsset, SlateChange } from "./model.ts";
import { captionText } from "./captions.ts";

export interface BoardWrite { id: string; before: Partial<DrawingForm>; after: Partial<DrawingForm>; created?: DrawingBoard; remove?: boolean }
interface Journal { id: string; change: SlateChange; board?: BoardWrite }
interface Stored { versions?: Record<string, number>; active: string | null; slates: Slate[]; journal: Journal | null }
const blank = (): Stored => ({ active: null, slates: [], journal: null });
export function createSlates(services: ApplicationServices, drawing: Drawing, editor?: Pick<Editor, "records">) {
  const list = shallowRef<readonly Slate[]>([]), activeId = shallowRef<string | null>(null), visible = shallowRef(false), error = shallowRef("");
  const ready = shallowRef(false), busy = shallowRef(false), recovery = shallowRef(false);
  const listeners = new Set<() => void>(), pageId = crypto.randomUUID();
  let deliveryErrorId: string | null = null;
  let disposed = false, syncDelivery: ((s: Slate | null, id: string, required: boolean, created: boolean) => Promise<void>) | null = null;
  const jobs = new Set<Promise<unknown>>();
  let releaseOwner!: () => void, acquiredOwner!: () => void;
  const ownerReady = new Promise<void>(resolve => { acquiredOwner = resolve; });
  const ownerLifetime = new Promise<void>(resolve => { releaseOwner = resolve; });
  const ownerLock = navigator.locks.request(names.slateOwner(pageId), async () => { acquiredOwner(); await ownerLifetime; });
  const channel = new BroadcastChannel(names.slateSync);
  const tx = (mode: IDBTransactionMode = "readonly") => services.databases.transaction(names.databases.slate, ["state", "assets"], mode);
  async function read(): Promise<Stored> { return await idbRequest<Stored | undefined>(tx().objectStore("state").get("workspace")) ?? blank(); }
  const publish = (state: Stored) => { list.value = state.slates; activeId.value = state.active; recovery.value = !!state.journal; listeners.forEach(fn => fn()); };
  async function persist(state: Stored, assets: readonly SlateAsset[] = [], retainIds?: readonly string[]) {
    const t = tx("readwrite"), done = transactionDone(t);
    try {
      t.objectStore("state").put(state, "workspace");
      if (retainIds) t.objectStore("state").put(retainIds, `retain:${pageId}`);
      for (const asset of assets) t.objectStore("assets").put(asset);
      await done;
    } catch (e) { try { t.abort(); } catch { /* Already completed/aborted. */ } await done.catch(() => {}); throw e; }
  }
  async function asset(id: string): Promise<SlateAsset | undefined> { return idbRequest(tx().objectStore("assets").get(id)); }
  async function boardWrite(board: BoardWrite, inverse = false) {
    if (board.created) {
      if (!!board.remove !== inverse) await drawing.removeBoardDraft(board.created.id, board.created, board.id);
      else await drawing.insertBoardDraft(board.created, board.id);
    } else if (Object.keys(board.after).length) await drawing.writeDraft(inverse ? board.before : board.after, inverse ? board.after : board.before, board.id);
  }
  function boardMatches(board: BoardWrite, side: "before" | "after") {
    if (board.created) {
      const found = drawing.board(board.created.id), exists = (side === "after") !== !!board.remove;
      return exists ? !!found && canonical(found.form) === canonical(board.created.form) : !found;
    }
    const form = drawing.board(board.id)?.form;
    return !!form && Object.entries(board[side]).every(([k, v]) => canonical(form[k as keyof typeof form]) === canonical(v));
  }
  async function recover(state: Stored) {
    const journal = state.journal;
    if (!journal) return state;
    // A journal is removed in the same transaction as the local Slate commit.
    // An interrupted journal therefore always rolls back only our untouched board write.
    if (journal.board && !boardMatches(journal.board, "before")) {
      if (!boardMatches(journal.board, "after")) throw new Error("上次复合应用中断，画板后来有修改；请保留现场并手动恢复后重试恢复");
      await boardWrite(journal.board, true);
    }
    const result = { ...state, journal: null };
    await persist(result); return result;
  }
  function run<T>(work: () => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error("任务服务已关闭"));
    const pending = services.data.write(() => navigator.locks.request(names.slateWriter, work));
    jobs.add(pending); busy.value = true;
    void pending.finally(() => { jobs.delete(pending); busy.value = jobs.size > 0; }).catch(() => {});
    return pending;
  }
  const restored = run(async () => { await ownerReady; const state = await read(); publish(state); try { publish(await recover(state)); } catch (e) { error.value = String(e instanceof Error ? e.message : e); } ready.value = true; });
  async function commit(change: SlateChange, board?: BoardWrite, retainUndo = false) {
    await restored;
    return run(async () => {
      let state = await read();
      if (state.journal) throw new Error("请先恢复上次中断的任务操作");
      const current = state.slates.find(s => s.id === change.id) ?? null;
      if (contentKey(current) !== contentKey(change.before) || current?.version !== change.before?.version) { publish(state); throw new Error("任务板已变化，请重新核对草稿"); }
      if (board && !boardMatches(board, "before")) throw new Error("画板已变化，组合未应用");
      if (change.directoryRequired && !syncDelivery) throw new Error("此草稿要求目录交付，请先挂载协同目录");
      const prepared: SlateAsset[] = [];
      // Resolve all sources and copy metadata before any async hashing lets a history change intervene.
      const records = [...drawing.snapshot().history, ...drawing.snapshot().favorites, ...editor?.records() ?? []];
      for (const request of change.bindings) {
        const known = await asset(request.assetId);
        if (known) { prepared.push(known); continue; }
        const record = records.find(r => r.id === request.ref);
        if (!record || request.entity_key && record.entity_key!==request.entity_key) throw new Error(`${request.label} 已移除，组合未应用`);
        const params = imageParameters(record.params);
        if (canonical({ params, size: record.size, type: record.blob.type, bytes: record.blob.size }) !== request.metadata) throw new Error(`${request.label} 参数已变化`);
        const blob = record.blob.slice(0, record.blob.size, record.blob.type);
        prepared.push({ id: request.assetId, blob, entity_key: await imageEntity(blob), source_ref:request.source_ref, sha256: await sha256(blob), width: record.size.width, height: record.size.height, mime: blob.type, sourceId: record.id, params, boundAt: new Date().toISOString() });
      }
      for (const todo of change.after?.todos ?? []) if (todo.binding) {
        const frozen = prepared.find(a => a.id === todo.binding!.assetId) ?? await asset(todo.binding.assetId);
        if (!frozen) throw new Error("任务成果已失效");
        captionText(frozen, todo.binding.caption);
        const extension = todo.binding.target_path.split(".").at(-1);
        if (!(frozen.mime === "image/png" && extension === "png" || frozen.mime === "image/webp" && extension === "webp" || frozen.mime === "image/jpeg" && (extension === "jpg" || extension === "jpeg"))) throw new Error("成果扩展名与原图格式不一致");
      }
      if (board && !boardMatches(board, "before")) throw new Error("画板已变化，组合未应用");
      const version = Math.max(current?.version ?? 0, state.versions?.[change.id] ?? 0) + 1;
      const after = change.after ? { ...structuredClone(change.after), version } : null;
      const created = !!after && !current && !state.versions?.[change.id];
      const journal: Journal = { id: crypto.randomUUID(), change: { ...change, after }, ...(board ? { board } : {}) };
      const retained = retainUndo ? [...await idbRequest<string[] | undefined>(tx().objectStore("state").get(`retain:${pageId}`)) ?? [], ...[change.before, change.after].flatMap(s => s?.todos.flatMap(t => t.binding?.assetId ?? []) ?? [])] : undefined;
      state = { ...state, journal }; await persist(state, prepared, retained);
      try {
        if (change.directoryRequired) await syncDelivery!(after, change.id, true, created);
        if (board) await boardWrite(board);
        const slates = state.slates.filter(s => s.id !== change.id);
        if (after) slates.push(after);
        state = { versions: { ...state.versions, [change.id]: version }, slates, active: after?.id ?? (state.active === change.id ? slates[0]?.id ?? null : state.active), journal: null };
        await persist(state);
      } catch (e) {
        try { state = await recover(await read()); publish(state); }
        catch (recoveryError) { publish(await read()); error.value = String(recoveryError instanceof Error ? recoveryError.message : recoveryError); throw new Error(`保存中断，恢复记录已保留：${error.value}`); }
        throw e;
      }
      publish(state); channel.postMessage("changed"); error.value = "";
      if (!change.directoryRequired && syncDelivery) {
        try { await syncDelivery(after, change.id, false, created); }
        catch (e) { deliveryErrorId = change.id; error.value = `本机已保存，目录待同步：${e instanceof Error ? e.message : String(e)}`; }
      }
    });
  }
  async function reload() { if (!disposed) publish(await read()); }
  channel.onmessage = () => { if (services.data.phase === "ready") void reload().catch(e => { error.value = String(e); }); };
  const unregister = services.data.register({ async flush() { await Promise.allSettled([...jobs]); if (recovery.value) throw new Error("任务有待恢复记录，请先处理后再维护数据"); }, reload, ready() { void reload(); } });
  return {
    list, activeId, visible, error, ready, busy, recovery, restored, asset, commit,
    deliverySucceeded(id: string) { if (deliveryErrorId === id) { deliveryErrorId = null; error.value = ""; } },
    snapshot: () => structuredClone(list.value.find(s => s.id === activeId.value) ?? null),
    get: (id: string) => structuredClone(list.value.find(s => s.id === id) ?? null),
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
    connectSync(fn: NonNullable<typeof syncDelivery>) { syncDelivery = fn; return () => { if (syncDelivery === fn) syncDelivery = null; }; },
    async select(id: string) { await restored; await run(async () => { const state = await read(); if (!state.slates.some(s => s.id === id)) throw new Error("任务板不存在"); state.active = id; await persist(state); publish(state); channel.postMessage("changed"); }); },
    async retryRecovery() { await run(async () => { publish(await recover(await read())); error.value = ""; }); },
    /** Page undo owners retain only asset IDs; blobs stay out of Vue/draft history. */
    async retain(ids: readonly string[]) { await run(async () => { const t = tx("readwrite"), done = transactionDone(t); t.objectStore("state").put([...new Set(ids)], `retain:${pageId}`); await done; }); },
    async cleanAssets() { await run(async () => {
      const state = await read(); if (state.journal) return;
      const store = tx().objectStore("state"), keys = await idbRequest(store.getAllKeys());
      const retained = new Set(state.slates.flatMap(s => s.todos.flatMap(todo => todo.binding?.assetId ?? []))), stale: IDBValidKey[] = [];
      for (const key of keys) if (String(key).startsWith("retain:")) {
        const owner = String(key).slice(7);
        const alive = await navigator.locks.request(names.slateOwner(owner), { ifAvailable: true }, lock => !lock);
        if (!alive) stale.push(key);
        else for (const id of await idbRequest<string[]>(tx().objectStore("state").get(key))) retained.add(id);
      }
      const t = tx("readwrite"), done = transactionDone(t), assets = t.objectStore("assets");
      for (const key of stale) t.objectStore("state").delete(key);
      for (const key of await idbRequest(assets.getAllKeys())) if (!retained.has(String(key))) assets.delete(key);
      await done;
    }); },
    async dispose() { await Promise.allSettled([...jobs]); unregister(); channel.close(); listeners.clear(); syncDelivery = null; visible.value = false;
      await services.data.write(async () => { const t = tx("readwrite"), done = transactionDone(t); t.objectStore("state").delete(`retain:${pageId}`); await done; }).catch(() => {}); releaseOwner(); await ownerLock; disposed = true;
    },
  };
}
export type Slates = ReturnType<typeof createSlates>;
