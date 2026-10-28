import { draftFilePort } from "./draft-files.ts";
import type { Slates } from "../slate/service.ts";
import { createSlateSync } from "../slate/sync.ts";
import { externalEdit, SLATE_SCHEMA } from "../slate/documents.ts";
import { shallowRef, watch } from "vue";
import type { Ask } from "../ask/service.ts";
import type { Drawing } from "../services/drawing.ts";
import type { ApplicationServices } from "../services/application.ts";
import type { AppRouter } from "../app/router.ts";
import type { Writer } from "../services/data-lease.ts";
import { message } from "../app/ui.ts";
import type { Ui } from "../app/ui.ts";
import { names } from "../storage/names.ts";
import { download } from "../shared/files.ts";
import { canonical } from "../ask/canonical.ts";
import { stateHash } from "../ask/draft/validate.ts";
import { bridgeStorage } from "./storage.ts";
import type { Mount, Received } from "./storage.ts";
import { directoryPicker, fileDriver, readInbox } from "./fs-driver.ts";
import { inboxObject, inboxId, inboxDigest, receiveDraft, INBOX_LIMIT, InvalidInbox } from "./protocol.ts";
import type { BridgeSnapshot, InboxReceipt, ExternalOrigin } from "./protocol.ts";
import { liveState, previewPictures } from "./state.ts";
import { previewCache } from "./previews.ts";
import { protocolDocument } from "./protocol-doc.ts";
import { scanRefs, refIndex, referenceSnapshot } from "./refs.ts";
import type { RefCatalog } from "./refs.ts";
import { emptyRefs } from "../ask/reference-source.ts";


export function createBridge(deps: { services: ApplicationServices; ask: Ask; drawing: Drawing; router: AppRouter; ui: Pick<Ui, "toast">; slates?: Slates }) {
  const { services, ask, drawing, router } = deps, storage = bridgeStorage(services), cache = previewCache();
  const phase = shallowRef<"off" | "permission" | "occupied" | "active" | "error">("off"), directory = shallowRef(""), error = shallowRef("");
  const receipt = shallowRef<InboxReceipt | null>(null), busy = shallowRef(false), mountRevision = shallowRef(0);
  const refs = shallowRef(emptyRefs()), refFiles = shallowRef<RefCatalog["files"]>([]);
  let catalog: RefCatalog = { files: [], limited: false };
  const pageScope = crypto.randomUUID();
  let mount: Mount | null = null, active: { id: string; root: FileSystemDirectoryHandle; driver: ReturnType<typeof fileDriver>; signal: AbortSignal; abort: AbortController; release: () => Promise<void> } | null = null;
  let disposed = false, revision = 0, lastSignature = "", lastInbox = "", requested = false;
  let cycle: Promise<void> | null = null, receiving = Promise.resolve(), saving = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  const fileJobs = new Set<Promise<unknown>>();
  const snapshots = new Map<string, BridgeSnapshot>(), pending = new Map<string, { context: string; record: Received }>();
  const context = () => mount?.id ?? pageScope;
  const slateSync = deps.slates ? createSlateSync(deps.slates, storage, { accept, focus: ask.reviewExternal,
    receipt: (context, id) => { const record = ask.externalRecord(context, id); return record ? { draft_id: id, status: record.status, ...(record.error ? { error: record.error } : {}) } : null; } }) : null;
  const disconnectSlates = deps.slates?.connectSync((slate, id, required, created) => slateSync!.deliver(slate, id, required, created));
  function setRefs(value?: RefCatalog) {
    catalog = value ?? { files: [], limited: false };
    const index = value ? refIndex(value) : emptyRefs();
    if (canonical(refs.value) !== canonical(index)) { refs.value = index; ask.referencesChanged(); }
    if (canonical(refFiles.value) !== canonical(catalog.files)) refFiles.value = catalog.files;
  }
  const exports = draftFilePort({ context: () => { void mountRevision.value; return { id: mount?.id ?? null, directory: directory.value, available: phase.value === "active" && !!active }; }, session: () => active, ready: () => services.data.phase === "ready", storage, changed: schedule });
  const disconnectFiles = ask.connectFileExports({ context: exports.context,
    apply(files, undo, commit) {
      if (busy.value) return Promise.reject(new Error('协同目录正在切换，请稍后应用'));
      busy.value = true;
      const job = services.data.write(() => exports.apply(files, undo, commit));
      fileJobs.add(job);
      return job.finally(() => { fileJobs.delete(job); busy.value = false; resumeMaintenance(); });
    },
  });
  const disconnectRefs = ask.connectReferences({ index: () => refs.value,
    snapshot: () => active && refs.value.available ? referenceSnapshot(active.root, catalog, active.signal) : null });
  function remember(snapshot: BridgeSnapshot) {
    const key = `${snapshot.pictureScope}:${stateHash(snapshot.base)}`;
    snapshots.delete(key); snapshots.set(key, snapshot);
    while (snapshots.size > 16) snapshots.delete(snapshots.keys().next().value!);
  }
  function flush(write: Writer = services.data.write) {
    const batch = [...pending];
    const next = saving.catch(() => {}).then(async () => {
      for (const [key, entry] of batch) {
        await storage.receipt(entry.context, entry.record.receipt, entry.record.digest, write);
        if (pending.get(key) === entry) pending.delete(key);
      }
    });
    saving = next; return next;
  }
  function record(origin: ExternalOrigin, value: InboxReceipt) {
    const key = `${origin.context}:${origin.draftId}`;
    pending.set(key, { context: origin.context, record: { digest: origin.digest, receipt: value } });
    void flush().catch(e => { error.value = `回执保存失败：${message(e)}`; });
    if (origin.context === context() && receipt.value?.draft_id === value.draft_id) { receipt.value = value; schedule(); }
  }
  const unsubscribe = ask.onExternal(record);
  async function receive(input: unknown, where: string, current: ReturnType<Ask["externalSnapshot"]>) {
    await ask.restored;
    if (disposed) throw new Error("协同已关闭");
    const value = inboxObject(input), id = inboxId(value);
    if (!id) throw new InvalidInbox("draft_id 无效");
    // Freeze before hashing/storage awaits. Receipt ownership survives a later conversation switch.
    const owner = current.ownerId;
    const digest = await inboxDigest(value), known = pending.get(`${where}:${id}`)?.record ?? await storage.received(where, id);
    const live = ask.externalRecord(where, id);
    const repeated = (value: InboxReceipt) => {
      if (where === context() && (!receipt.value || receipt.value.draft_id === id)) receipt.value = value;
      return value;
    };
    if (live || known) {
      const priorDigest = live?.origin.digest ?? known!.digest;
      if (priorDigest !== digest) throw new InvalidInbox("draft_id 已使用且正文不同，请使用新 ID");
      if (live) return repeated({ draft_id: id, status: live.status, ...(live.error ? { error: live.error } : {}) });
      if (known!.receipt.status !== "pending") return repeated(known!.receipt);
      const invalid: InboxReceipt = { draft_id: id, status: "invalid", error: "原会话上下文已失效，请以新 ID 重新投递" };
      await storage.receipt(where, invalid, digest);
      if (where === context()) receipt.value = invalid;
      return invalid;
    }
    let outcome: InboxReceipt;
    try {
      let snapshot: BridgeSnapshot = current;
      if (Object.hasOwn(value, "base_hash")) {
        const candidates = [...snapshots.values()].filter(s => stateHash(s.base) === value.base_hash && (value.picture_scope_id === undefined || value.picture_scope_id === s.pictureScope));
        if (!candidates.length || new Set(candidates.map(s => s.pictureScope)).size !== 1) throw new Error("base_hash 已过期或无法识别，请重新导出状态");
        snapshot = candidates.at(-1)!;
      }
      const draft = receiveDraft(value, snapshot, current.edit?.active_board_id), origin: ExternalOrigin = { context: where, draftId: id, digest, label: typeof value.source_label === "string" ? value.source_label : "外部草稿" };
      outcome = { draft_id: id, status: "pending" };
      // Durable dedup before enqueuing. A crash cannot silently replay an applied draft.
      await storage.receipt(where, outcome, digest);
      const slateStep = draft.steps.find(s => s.kind === "slate_edit");
      if (slateStep) await storage.put(`slate-target:${where}:${id}`, slateStep.change.id);
      ask.receiveExternal(draft, origin, owner);
      try { await ask.flushFavorites(); } catch (e) { outcome = { ...outcome, error: `草稿已接收，收藏保存待重试：${message(e)}` }; await storage.receipt(where, outcome, digest); }
    } catch (e) {
      outcome = { draft_id: id, status: "invalid", error: message(e) };
      await storage.receipt(where, outcome, digest);
    }
    if (where === context()) { receipt.value = outcome; schedule(); }
    return outcome;
  }
  function accept(input: unknown, where = context()) {
    const snapshot = ask.externalSnapshot();
    if (deps.slates && input && typeof input === "object") {
      const step = (input as { steps?: { kind?: string; slate_id?: string }[] }).steps?.find(s => s.kind === "slate_edit");
      if (step?.slate_id) snapshot.base.slate = deps.slates.get(step.slate_id);
    }
    const job = receiving.catch(() => {}).then(() => receive(input, where, snapshot));
    receiving = job.then(() => {}, () => {}); return job;
  }
  function capture(previews?: ReadonlyMap<string, string>) {
    const snapshot = ask.externalSnapshot(), d = drawing.snapshot();
    remember(snapshot);
    return { snapshot, state: liveState(snapshot, { boards: structuredClone(d.boards), workspace: router.route.value.workspace,
      selectedId: d.current?.id ?? null, scope: pageScope, revision: ++revision, receipt: receipt.value, previews, refs: refs.value }) };
  }
  async function synchronize(session: NonNullable<typeof active>) {
    session.signal.throwIfAborted();
    await slateSync?.scan(session);
    const files = await scanRefs(session.root, session.signal);
    session.signal.throwIfAborted(); setRefs(files);
    const raw = await session.driver.read("draft.inbox.json");
    if (raw && raw.text !== lastInbox) {
      let inbox: Awaited<ReturnType<typeof readInbox>> = null;
      try { inbox = await readInbox(session.driver, session.signal); }
      catch (e) {
        session.signal.throwIfAborted();
        if (!(e instanceof SyntaxError)) throw e;
        lastInbox = raw.text; error.value = `草稿读取失败：${message(e)}`;
      }
      session.signal.throwIfAborted();
      if (inbox) {
        try { const result = await accept(inbox.value); error.value = result.error ?? ""; }
        catch (e) { if (!(e instanceof InvalidInbox)) throw e; error.value = message(e); }
        lastInbox = inbox.text;
      }
    }
    const { snapshot, state } = capture();
    const signature = canonical({ ...state, updated_at: "", revision: 0 });
    if (signature === lastSignature) return;
    const saveOwned = (paths: readonly string[]) => storage.put(`previews:${session.id}`, paths);
    const paths = await cache.prepare(previewPictures(snapshot.library, state.selected_image?.id ?? null).pictures, session.driver, session.signal, saveOwned);
    session.signal.throwIfAborted();
    // If the form or selection changed during encoding, let the next cycle publish it.
    if (requested) return;
    const withPreview = { ...state,
      selected_image: state.selected_image ? { ...state.selected_image, preview: paths.get(state.selected_image.id) ?? null } : null,
      recent_history: state.recent_history.map(p => ({ ...p, preview: paths.get(p.id) ?? null })) };
    await session.driver.write("state.live.json", JSON.stringify(withPreview, null, 2), session.signal);
    lastSignature = signature;
    await cache.commit(paths, session.driver, session.signal, saveOwned);
  }
  function sync() {
    if (!active || disposed || document.visibilityState === "hidden" || services.data.phase !== "ready") return Promise.resolve();
    requested = true;
    if (!cycle) {
      cycle = (async () => {
        while (requested && active && !disposed && document.visibilityState !== "hidden") {
          requested = false; const session = active;
          try { await synchronize(session); }
          catch (e) {
            if (!session.signal.aborted) {
              error.value = message(e); phase.value = e instanceof DOMException && e.name === "NotAllowedError" ? "permission" : "error";
              clearInterval(heartbeat); session.abort.abort(); active = null; setRefs();
              await Promise.allSettled([...fileJobs]); await session.release(); cache.clear(); lastSignature = "";
            }
            break;
          }
        }
      })().finally(() => { cycle = null; });
    }
    return cycle;
  }
  function schedule() { clearTimeout(timer); if (active && !disposed) timer = setTimeout(() => void sync(), 300); }
  async function stop() {
    clearTimeout(timer); clearInterval(heartbeat); requested = false;
    const previous = active; active = null; mountRevision.value++;
    setRefs();
    previous?.abort.abort(new DOMException("协同已暂停", "AbortError"));
    await cycle; await Promise.allSettled([...fileJobs]); await slateSync?.detach(); await previous?.release(); cache.clear(); lastSignature = ""; lastInbox = "";
  }
  async function activate(entry: Mount) {
    if (disposed) return;
    if (services.data.phase !== "ready") throw new Error("数据维护期间暂不能恢复同步");
    await stop();
    mount = entry; directory.value = entry.handle.name; receipt.value = null; snapshots.clear();
    if (await entry.handle.queryPermission({ mode: "readwrite" }) !== "granted") { phase.value = "permission"; return; }
    let acquired!: (held: boolean) => void, release!: () => void;
    const ready = new Promise<boolean>(resolve => { acquired = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const lock = navigator.locks.request(names.bridgeWriter(entry.id), { ifAvailable: true }, async value => { acquired(!!value); if (value) await held; });
    void lock.catch(() => acquired(false));
    if (!await ready) { phase.value = "occupied"; return; }
    const abort = new AbortController(), session = { id: entry.id, root: entry.handle, driver: fileDriver(entry.handle), signal: abort.signal, abort, release: async () => { release(); await lock; } };
    active = session; mountRevision.value++;
    try {
      await slateSync?.attach(session);
      cache.adopt(await storage.read<string[]>(`previews:${entry.id}`) ?? []);
      const previous = await session.driver.read("state.live.json", 16 * INBOX_LIMIT);
      if (previous) {
        try {
          const saved = inboxObject(JSON.parse(previous.text)), id = inboxId(saved.last_inbox_receipt);
          if (id) receipt.value = (await storage.received(entry.id, id))?.receipt ?? null;
        } catch { /* A damaged previous state is replaced by a fresh snapshot. */ }
      }
      await session.driver.write("PROTOCOL.md", protocolDocument(), session.signal);
      phase.value = "active"; error.value = "";
      heartbeat = setInterval(() => void sync(), 1500);
      await sync();
    } catch (e) { await stop(); phase.value = "error"; throw e; }
  }
  const restored = (async () => {
    await ask.restored;
    const saved = await storage.read<Mount | null>("active");
    if (saved && !disposed) await activate(saved);
  })().catch(e => { error.value = message(e); phase.value = "error"; });
  async function operation(work: () => Promise<void>) {
    if (busy.value || disposed) return;
    busy.value = true; error.value = "";
    try { await work(); } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) error.value = message(e); }
    finally { busy.value = false; resumeMaintenance(); }
  }
  function visibility() { if (document.visibilityState === "visible") void sync(); else clearTimeout(timer); }
  document.addEventListener("visibilitychange", visibility); window.addEventListener("focus", visibility);
  const stops = [...(deps.slates ? [deps.slates.subscribe(schedule)] : []), drawing.subscribe(schedule), watch([ask.conversationId, router.route], schedule)];
  let resumeAfterMaintenance = false;
  function resumeMaintenance() {
    if (!resumeAfterMaintenance || !mount || busy.value || disposed || services.data.phase !== "ready") return;
    resumeAfterMaintenance = false;
    const entry = mount;
    void operation(() => activate(entry));
  }
  const unregister = services.data.register({
    async flush(write) {
      if (services.data.phase === "maintenance" && active) { resumeAfterMaintenance = true; await stop(); }
      await receiving; await flush(write);
    },
    async reload() { snapshots.clear(); lastSignature = ""; },
    ready() {
      resumeMaintenance(); schedule();
    },
  });
  return { slateMappings: slateSync?.mappings ?? shallowRef([]),
    mapSlate(id: string) { return operation(async () => { await slateSync?.map(id); }); },
    resolveSlate(id: string, mode: "local" | "review") { return operation(async () => { await slateSync?.resolve(id, mode); }); },
    phase, directory, error, receipt, busy, restored, refs, refFiles, supported: !!directoryPicker(),
    mount() {
      // Invoke picker in the click stack, before any await consumes user activation.
      const picker = directoryPicker(); if (!picker) { error.value = "浏览器不支持目录挂载，请使用 JSON 导入导出"; return Promise.resolve(); }
      return operation(async () => { const handle = await picker({ mode: "readwrite", id: "koma-bridge" }); await restored; const entry = await storage.register(handle); await storage.put("active", entry); await activate(entry); });
    },
    resume() { return operation(async () => { if (!mount) return; if (await mount.handle.requestPermission({ mode: "readwrite" }) !== "granted") { phase.value = "permission"; return; } await activate(mount); }); },
    unmount() { return operation(async () => { await restored; resumeAfterMaintenance = false; await stop(); mount = null; snapshots.clear(); directory.value = ""; phase.value = "off"; receipt.value = null; await storage.put("active", null); }); },
    importFile(file: File) { return operation(async () => {
      await restored;
      if (file.size > INBOX_LIMIT) throw new Error("草稿 JSON 超过 1 MB");
      let value: unknown = JSON.parse(await file.text());
      if (value && typeof value === "object" && (value as { schema?: string }).schema === SLATE_SCHEMA) {
        const id = (value as { slate?: { id?: string } }).slate?.id;
        const step = externalEdit(value, id ? deps.slates?.get(id) ?? null : null);
        value = { schema: "koma.bridge.draft.v1", draft_id: `slate-import-${crypto.randomUUID()}`, source_label: "任务 JSON 导入", draft_title: "导入任务板", steps: [step] };
      }
      // A paused mount shares dedup state, so manual reception needs the same directory lock.
      const result = mount && !active ? await navigator.locks.request(names.bridgeWriter(mount.id), { ifAvailable: true }, lock => {
        if (!lock) throw new Error("目录正由其他页面同步，请在该页面导入，或先卸载目录");
        return accept(value);
      }) : await accept(value);
      if (result.status === "invalid") error.value = result.error ?? "草稿无效";
    }); },
    exportState() { return operation(async () => { await restored; const { state } = capture(); download(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), "state.live.json"); }); },
    exportProtocol() { download(new Blob([protocolDocument()], { type: "text/markdown" }), "PROTOCOL.md"); },
    async dispose() { disposed = true; disconnectFiles(); disconnectSlates?.(); disconnectRefs(); unsubscribe(); stops.forEach(stop => stop()); unregister(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", visibility); await restored; await stop(); await receiving; await flush(); snapshots.clear(); },
  };
}
export type Bridge = ReturnType<typeof createBridge>;
