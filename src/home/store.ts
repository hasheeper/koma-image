import type { ApplicationServices } from "../services/application.ts";
import type { Writer } from "../services/data-lease.ts";
import type { ImageRecord } from "../domain/drawing.ts";
import { readBoards } from "../domain/drawing.ts";
import { imageLine } from "../domain/image-origin.ts";
import type { LineId } from "../domain/image-origin.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import { readHomePreferences } from "./model.ts";
import type { HomePreferences, HomePreview, HomeLocation, FinalLayout } from "./model.ts";

async function thumbnail(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/webp", quality: .88 });
  } finally { bitmap.close(); }
}

export function createHomeStore(services: ApplicationServices, onError: (error: unknown) => void = () => {}) {
  let previews = new Map<string, HomePreview>(), disposed = false, closing = false, revision = 0, error = "";
  let timer: ReturnType<typeof setTimeout> | undefined, saving = Promise.resolve();
  const pending = new Map<string, ImageRecord>(), removed = new Set<string>(), preferenceJobs = new Set<Promise<void>>();
  const listeners = new Set<() => void>(), urls = new Map<string, { blob: Blob; url: string }>();
  const channel = new BroadcastChannel(names.sync);
  const preferences = () => readHomePreferences(services.preferences.get(names.home, null));
  // Other tabs may update the persisted destination, but not this page's return location.
  let lastLocation = preferences().lastLocation;
  const boards = () => new Set(readBoards(services.preferences.get(names.preferences, null)).items.map(b => b.id));
  const emit = () => { if (!disposed) for (const fn of listeners) fn(); };
  function pruneUrls() {
    for (const [id, item] of urls) if (previews.get(id)?.blob !== item.blob) { URL.revokeObjectURL(item.url); urls.delete(id); }
  }
  function failed(value: unknown) {
    error = value instanceof Error ? value.message : String(value);
    if (!disposed) { onError(value); emit(); }
  }
  async function reload() {
    const token = ++revision, tx = services.databases.transaction(names.databases.home, "previews"), done = transactionDone(tx);
    const rows = await idbRequest<HomePreview[]>(tx.objectStore("previews").getAll());
    await done;
    if (disposed || token !== revision) return;
    const valid = boards();
    previews = new Map(rows.filter(p => valid.has(p.boardId)).map(p => [p.boardId, p]));
    for (const row of rows) if (!valid.has(row.boardId)) removed.add(row.boardId);
    pruneUrls(); emit();
  }
  const ready = reload().catch(failed);
  function flush(write: Writer = services.data.write): Promise<void> {
    clearTimeout(timer);
    const task = saving.catch(() => {}).then(async () => {
      await ready;
      while ((pending.size || removed.size) && !disposed) {
        const deleting = [...removed]; removed.clear();
        const batch = [...pending]; pending.clear();
        try { await write(async () => {
          for (const id of deleting) {
            if (boards().has(id)) continue;
            const tx = services.databases.transaction(names.databases.home, "previews", "readwrite"), done = transactionDone(tx);
            tx.objectStore("previews").delete(id); await done;
            previews.delete(id);
          }
          for (const [id, record] of batch) {
            if (!boards().has(id)) continue;
            const blob = await thumbnail(record.blob);
            if (!boards().has(id) || pending.has(id)) continue;
            const row: HomePreview = { boardId: id, sourceId: record.id, createdAt: record.createdAt,
              width: record.size.width, height: record.size.height, prompt: String(record.params.basePrompt ?? record.params.prompt ?? "").slice(0, 160), blob };
            const tx = services.databases.transaction(names.databases.home, "previews", "readwrite"), done = transactionDone(tx), store = tx.objectStore("previews");
            const existing = await idbRequest<HomePreview | undefined>(store.get(id));
            // A slow encoder in another tab cannot overwrite a more recent image.
            if (!existing || existing.createdAt <= row.createdAt) store.put(row);
            await done;
            previews.set(id, existing && existing.createdAt > row.createdAt ? existing : row);
          }
        }); } catch (cause) {
          for (const id of deleting) removed.add(id);
          for (const [id, record] of batch) if (boards().has(id) && (!pending.has(id) || pending.get(id)!.createdAt < record.createdAt)) pending.set(id, record);
          throw cause;
        }
        revision++; error = ""; pruneUrls(); emit();
        channel.postMessage({ type: "home-previews-changed" });
      }
      await Promise.all([...preferenceJobs]);
    });
    saving = task;
    return task;
  }
  function schedule() {
    if (disposed || closing || services.data.phase !== "ready") return;
    clearTimeout(timer); timer = setTimeout(() => void flush().catch(failed), 80);
  }
  function reconcileBoards() {
    const valid = boards();
    for (const id of new Set([...previews.keys(), ...pending.keys()])) if (!valid.has(id)) {
      pending.delete(id); previews.delete(id); removed.add(id);
    }
    pruneUrls(); emit();
    if (removed.size) schedule();
  }
  function updatePreferences(change: (value: HomePreferences) => void) {
    if (disposed || closing) return Promise.reject(new Error("首页数据已关闭"));
    // Admit before waiting for the preference lock, so maintenance drains this
    // entire write. The inner writer is covered by that existing data lease.
    const job = services.data.write(() => navigator.locks.request(names.homePreferencesLock, async () => {
      const value = preferences(); change(value);
      await services.preferences.set(names.home, value, work => Promise.resolve().then(work));
    }));
    preferenceJobs.add(job);
    void job.finally(() => preferenceJobs.delete(job)).catch(() => {});
    return job;
  }
  const stopPrefs = services.preferences.subscribe(key => {
    if (!key || key === names.preferences) reconcileBoards();
    if (!key || key === names.home) emit();
  });
  channel.onmessage = event => { if (event.data?.type === "home-previews-changed" && services.data.phase === "ready") void reload().then(schedule).catch(failed); };
  const unregister = services.data.register({ flush, reload, ready: schedule });
  const hide = () => { if (document.visibilityState === "hidden") void flush().catch(failed); };
  const leave = () => { void flush().catch(failed); };
  document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
  void ready.then(reconcileBoards);
  return {
    ready, flush,
    snapshot: () => ({ previews: [...previews.values()], preferences: { ...preferences(), lastLocation }, error }),
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
    capture(record: ImageRecord) {
      const line = imageLine(record.params);
      if (disposed || closing || !line?.startsWith("image:")) return;
      const id = line.slice(6), previous = pending.get(id) ?? previews.get(id);
      if (!boards().has(id) || previous && (previous.createdAt > record.createdAt || ("sourceId" in previous ? previous.sourceId : previous.id) === record.id)) return;
      pending.set(id, record); schedule();
    },
    setLayout(layout: FinalLayout | null) { return updatePreferences(value => { value.layout = layout; }); },
    setCover(line: LineId, favoriteId: string | null) { return updatePreferences(value => { if (favoriteId) value.covers[line] = favoriteId; else delete value.covers[line]; }); },
    pruneCovers(valid: (line: LineId, favoriteId: string) => boolean) {
      if (!Object.entries(preferences().covers).some(([line, id]) => id && !valid(line as LineId, id))) return Promise.resolve();
      return updatePreferences(value => { for (const [line, id] of Object.entries(value.covers)) if (id && !valid(line as LineId, id)) delete value.covers[line as LineId]; });
    },
    async remember(workspace: HomeLocation["workspace"]) {
      const next = { workspace, at: Date.now() };
      lastLocation = next; emit();
      await updatePreferences(value => { value.lastLocation = next; });
    },
    previewUrl(boardId: string) {
      const row = previews.get(boardId); if (!row) return null;
      const old = urls.get(boardId); if (old?.blob === row.blob) return old.url;
      if (old) URL.revokeObjectURL(old.url);
      const url = URL.createObjectURL(row.blob); urls.set(boardId, { blob: row.blob, url }); return url;
    },
    async dispose() {
      closing = true; clearTimeout(timer); stopPrefs(); unregister();
      document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave);
      try { await flush(); } catch (e) { failed(e); }
      disposed = true; revision++; channel.close(); pending.clear(); removed.clear(); previews.clear(); pruneUrls(); listeners.clear();
    },
  };
}
export type HomeStore = ReturnType<typeof createHomeStore>;
