import { draftFilePort } from "./draft-files.ts";
import type { Slates } from "../slate/service.ts";
import { createSlateSync } from "../slate/sync.ts";
import { externalEdit, SLATE_SCHEMA } from "../slate/documents.ts";
import { computed, shallowRef, watch } from "vue";
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
import { directoryPicker, fileDriver, readInbox, readWhileMounted } from "./fs-driver.ts";
import type { Directory } from "./fs-driver.ts";
import { inboxObject, inboxId, inboxDigest, receiveDraft, INBOX_LIMIT, InvalidInbox } from "./protocol.ts";
import type { BridgeSnapshot, InboxReceipt, ExternalOrigin } from "./protocol.ts";
import { liveState, previewPictures } from "./state.ts";
import { previewCache } from "./previews.ts";
import { protocolDocument } from "./protocol-doc.ts";
import { scanRefs, refIndex, referenceSnapshot } from "./refs.ts";
import type { RefCatalog } from "./refs.ts";
import type { MetadataCache } from "./project/scan.ts";
import { emptyRefs } from "../ask/reference-source.ts";

type DirectoryReader = { id: string; root: FileSystemDirectoryHandle; signal: AbortSignal; abort: AbortController };
const registryWaitMs = 1500;

export function createBridge(deps: { services: ApplicationServices; ask: Ask; drawing: Drawing; router: AppRouter; ui: Pick<Ui, "toast">; slates?: Slates }) {
  const { services, ask, drawing, router } = deps, storage = bridgeStorage(services), cache = previewCache();
  const phase = shallowRef<"off" | "permission" | "readonly" | "occupied" | "active" | "error">("off"), directory = shallowRef(""), error = shallowRef("");
  const receipt = shallowRef<InboxReceipt | null>(null), busy = shallowRef(false), mountRevision = shallowRef(0);
  const cancelLookup = shallowRef<() => void>();
  const mountStep = shallowRef("");
  const canUnmount = computed(() => !!directory.value && (!busy.value || !!cancelLookup.value));
  let currentOperation = Promise.resolve();
  const refs = shallowRef(emptyRefs()), refFiles = shallowRef<RefCatalog["files"]>([]);
  let catalog: RefCatalog = { files: [], limited: false };
  const project = shallowRef<RefCatalog["project"]>(), projectOpen = shallowRef(false), metadataCache: MetadataCache = new Map();
  const pageScope = crypto.randomUUID();
  let mount: Mount | null = null, active: (DirectoryReader & { driver: ReturnType<typeof fileDriver>; release: () => Promise<void> }) | null = null;
  let reader: DirectoryReader | null = null;
  const unregistered = shallowRef<Directory | null>(null);
  let disposed = false, revision = 0, lastSignature = "", lastInbox = "", requested = false;
  let cycle: Promise<void> | null = null, receiving = Promise.resolve(), saving = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  const fileJobs = new Set<Promise<unknown>>();
  const snapshots = new Map<string, BridgeSnapshot>(), pending = new Map<string, { context: string; record: Received }>();
  const context = () => mount?.id ?? pageScope;
  const slateSync = deps.slates ? createSlateSync(deps.slates, storage, { accept, focus: ask.reviewExternal,
    receipt: (context, id) => { const record = ask.externalRecord(context, id); return record ? { draft_id: id, status: record.status, ...(record.error ? { error: record.error } : {}) } : null; } }) : null;
  const disconnectSlates = deps.slates?.connectSync((slate, id, required, created, directoryId) => slateSync!.deliver(slate, id, required, created, directoryId), () => active?.id ?? null);
  function setRefs(value?: RefCatalog) {
    catalog = value ?? { files: [], limited: false };
    const index = value ? refIndex(value) : emptyRefs();
    if (canonical(project.value ?? null) !== canonical(catalog.project ?? null)) project.value = catalog.project;
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
  function readSnapshot() {
    const source = active ?? reader;
    return source && refs.value.available ? referenceSnapshot(source.root, catalog, source.signal, source.id) : null;
  }
  const disconnectRefs = ask.connectReferences({ index: () => refs.value, snapshot: readSnapshot });
  function remember(snapshot: BridgeSnapshot) {
    const key = `${snapshot.pictureScope}:${stateHash(snapshot.base)}`;
    // Old form snapshots only need recipes. Do not pin all IMAGE originals in 16 exported states.
    snapshots.delete(key); snapshots.set(key, { ...snapshot, library: snapshot.library.map(p =>
      p.previewBlob && p.origins.some(o => o.source === 'history') ? { ...p, blob:p.previewBlob, thumbnailOnly:true } : p) });
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
      snapshot = { ...snapshot, library: snapshot.library.map(p => {
        if (!p.origins.some(o => o.source === 'history')) return p;
        const live = current.library.find(r => r.id === p.id && r.entity_key === p.entity_key);
        return { ...p, blob:live?.blob ?? p.blob, thumbnailOnly:live?.thumbnailOnly ?? !live };
      }) };
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
    const files = await readWhileMounted(session.signal, () => scanRefs(session.root, session.signal, metadataCache));
    session.signal.throwIfAborted(); setRefs(files);
    const raw = await readWhileMounted(session.signal, () => session.driver.read("draft.inbox.json"));
    if (raw && raw.text !== lastInbox) {
      let inbox: Awaited<ReturnType<typeof readInbox>> = null;
      try { inbox = await readWhileMounted(session.signal, () => readInbox(session.driver, session.signal)); }
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
    if (!active || phase.value !== "active" || disposed || document.visibilityState === "hidden" || services.data.phase !== "ready") return Promise.resolve();
    requested = true;
    if (!cycle) {
      cycle = (async () => {
        while (requested && active && !disposed && document.visibilityState !== "hidden") {
          requested = false; const session = active;
          try { await synchronize(session); }
          catch (e) {
            if (!session.signal.aborted) {
              directoryError(e);
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
    reader?.abort.abort(); reader = null;
    setRefs(); metadataCache.clear();
    previous?.abort.abort(new DOMException("协同已暂停", "AbortError"));
    await cycle; await Promise.allSettled([...fileJobs]); await slateSync?.detach(); await previous?.release(); cache.clear(); lastSignature = ""; lastInbox = "";
  }
  function directoryError(e: unknown) {
    phase.value = e instanceof DOMException && e.name === "NotAllowedError" ? "permission" : "error";
    error.value = e instanceof DOMException && e.name === "NotFoundError"
      ? "找不到企划目录，可能已移动或删除。"
      : message(e);
  }
  async function waitForConnection<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    cancelLookup.value = () => abort.abort();
    try { return await readWhileMounted(abort.signal, () => work(abort.signal)); }
    finally { cancelLookup.value = undefined; }
  }
  async function scanReader(source: DirectoryReader) {
    try {
      const files = await readWhileMounted(source.signal, () => scanRefs(source.root, source.signal, metadataCache));
      if (reader === source) { setRefs(files); phase.value = "readonly"; error.value = ""; }
    } catch (e) {
      if (reader !== source || source.signal.aborted) return;
      source.abort.abort(); reader = null; setRefs(); directoryError(e);
    }
  }
  async function openReader(handle: Directory, id = "") {
    const abort = new AbortController();
    const source = { id, root: handle, signal: abort.signal, abort };
    reader = source;
    await waitForConnection(() => scanReader(source));
  }
  async function identify(handle: Directory): Promise<Mount | null> {
    return waitForConnection(async signal => {
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(registryWaitMs)]);
      try { return await readWhileMounted(bounded, () => storage.register(handle, bounded)); }
      catch {
        signal.throwIfAborted();
        // Permissions to browse come from the selected handle. Only sync needs a durable ID.
        return null;
      }
    });
  }
  async function browseUnregistered(handle: Directory) {
    const previous = mount;
    await stop();
    mount = null; unregistered.value = handle; directory.value = handle.name;
    phase.value = "permission"; receipt.value = null; snapshots.clear();
    if (previous) await storage.clearActive(previous.id);
    await openReader(handle);
  }
  async function activate(entry: Mount) {
    if (disposed) return;
    if (services.data.phase !== "ready") throw new Error("数据维护期间暂不能恢复同步");
    await stop();
    mount = entry; unregistered.value = null; directory.value = entry.handle.name; phase.value = "permission"; receipt.value = null; snapshots.clear();
    if (await waitForConnection(() => entry.handle.queryPermission({ mode: "readwrite" })) !== "granted") {
      if (await waitForConnection(() => entry.handle.queryPermission({ mode: "read" })) === "granted") {
        await openReader(entry.handle, entry.id);
      }
      return;
    }
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
      const previous = await waitForConnection(() => session.driver.read("state.live.json", 16 * INBOX_LIMIT));
      if (previous) {
        try {
          const saved = inboxObject(JSON.parse(previous.text)), id = inboxId(saved.last_inbox_receipt);
          if (id) receipt.value = (await storage.received(entry.id, id))?.receipt ?? null;
        } catch { /* A damaged previous state is replaced by a fresh snapshot. */ }
      }
      await session.driver.write("PROTOCOL.md", protocolDocument(), session.signal);
      phase.value = "active"; error.value = "";
      heartbeat = setInterval(() => void sync(), 1500);
      await waitForConnection(sync);
    } catch (e) { await stop(); throw e; }
  }
  const restored = operation(async () => {
    await ask.restored;
    const saved = await storage.read<Mount | null>("active");
    if (saved && !disposed) await activate(saved);
  }, directoryError);
  function operation(work: () => Promise<void>, failed: (e: unknown) => void = e => { error.value = message(e); }) {
    if (busy.value || disposed) return Promise.resolve();
    busy.value = true; error.value = "";
    currentOperation = (async () => {
      try { await work(); } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) failed(e); }
      finally { busy.value = false; resumeMaintenance(); }
    })();
    return currentOperation;
  }
  function visibility() { if (document.visibilityState === "visible") void sync(); else clearTimeout(timer); }
  document.addEventListener("visibilitychange", visibility); window.addEventListener("focus", visibility);
  const stops = [...(deps.slates ? [deps.slates.subscribe(schedule)] : []), drawing.subscribe(schedule), watch([ask.conversationId, router.route], schedule)];
  let resumeAfterMaintenance = false;
  function resumeMaintenance() {
    if (!resumeAfterMaintenance || !mount || busy.value || disposed || services.data.phase !== "ready") return;
    resumeAfterMaintenance = false;
    const entry = mount;
    void operation(() => activate(entry), directoryError);
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
    project, projectOpen, projectEpoch: mountRevision,
    openProject() { projectOpen.value = true; void sync(); },
    closeProject() { projectOpen.value = false; },
    refreshProject() { metadataCache.clear(); return reader ? scanReader(reader) : sync(); },
    referenceSnapshot: readSnapshot,
    phase, directory, error, receipt, busy, canUnmount, mountStep, restored, refs, refFiles,
    temporaryReader: computed(() => !!unregistered.value), supported: !!directoryPicker(),
    cancelMount() {
      if (!mountStep.value || !cancelLookup.value) return Promise.resolve();
      cancelLookup.value();
      return currentOperation;
    },
    async mount(dropped?: Directory, showProject = false) {
      // Invoke picker in the click stack, before any await consumes user activation.
      const picker = directoryPicker();
      if (!dropped && !picker) { error.value = "浏览器不支持目录挂载，请使用 JSON 导入导出"; return false; }
      let selected = false, stage = "选择企划目录";
      await operation(async () => {
        let handle: Directory, entry: Mount | null;
        try {
          mountStep.value = "等待选择目录";
          handle = dropped ?? await waitForConnection(() => picker!({ mode: "read", id: "koma-bridge" }));
          stage = "识别企划目录"; mountStep.value = stage;
          entry = await identify(handle);
        } finally { mountStep.value = ""; }
        stage = "读取企划目录";
        selected = true;
        if (showProject) projectOpen.value = true;
        try {
          if (entry) await activate(entry);
          else await browseUnregistered(handle);
        } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) directoryError(e); }
      }, e => {
        error.value = `${stage}失败：${message(e)}`;
        deps.ui.toast(error.value, "err");
      });
      return selected;
    },
    resume() { return operation(async () => {
      const handle = mount?.handle ?? unregistered.value;
      if (!handle) return;
      const mode = reader ? "readwrite" : "read";
      if (await waitForConnection(() => handle.requestPermission({ mode })) !== "granted") {
        phase.value = reader ? "readonly" : "permission"; return;
      }
      const entry = mount ?? await identify(handle);
      if (entry) await activate(entry);
      else if (!reader) await openReader(handle);
      else throw new Error("历史目录身份暂时无法核对。企划可继续只读浏览，稍后可重试同步。");
    }, e => { if (reader) { error.value = message(e); deps.ui.toast(error.value, "err"); } else directoryError(e); }); },
    async unmount() {
      if (!canUnmount.value) return;
      resumeAfterMaintenance = false;
      if (cancelLookup.value) {
        cancelLookup.value();
        await currentOperation;
      }
      return operation(async () => {
        if (mount) await storage.clearActive(mount.id);
        await stop();
        mount = null; unregistered.value = null; projectOpen.value = false; snapshots.clear(); directory.value = ""; phase.value = "off"; receipt.value = null;
      });
    },
    importFile(file: File) { return operation(async () => {
      await restored;
      if (unregistered.value) throw new Error("目录身份尚未确认。请先启用读写同步，或卸载目录后导入草稿。");
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
    async dispose() { disposed = true; cancelLookup.value?.(); disconnectFiles(); disconnectSlates?.(); disconnectRefs(); unsubscribe(); stops.forEach(stop => stop()); unregister(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", visibility); await restored; await stop(); await receiving; await flush(); snapshots.clear(); },
  };
}
export type Bridge = ReturnType<typeof createBridge>;
