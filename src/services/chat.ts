import type { ApplicationServices } from "./application";
import type { Ui } from "../app/ui";
import { message } from "../app/ui";
import type { CatalogModel } from "../domain/catalog";
import { normalizeOptions, resolveModel } from "../domain/catalog";
import { buildChatPayload, chatModels } from "../domain/media.ts";
import * as conversation from "../domain/conversation.ts";
import { object } from "../domain/value";
import type { Quote } from "../domain/quote";
import { normalizeQuota } from "../domain/quota";
import type { QuotaStatus } from "../domain/quota";
import type {
  ConversationRecord,
  ConversationTurn,
  ConversationVersion,
  AssetRecord,
  Fields,
  MessageBlock,
} from "../storage/records";
import { assetRefs } from "../storage/records";
import { names } from "../storage/names";
import { idbRequest, transactionDone } from "../storage/databases";
import type { Writer } from "./data-lease";
import { AssetStore } from "./assets";
import { consumeMedia } from "./media-response";
import { createHandoff } from "./handoff";

export const chatOptions = (c: ConversationRecord) =>
  object(c.settings.options) as Record<string, string>;
export function createChat(services: ApplicationServices, ui: Ui) {
  const finished = new Map<string, number>();
  const assets = new AssetStore(),
    listeners = new Set<() => void>(),
    written = new Map<string, string>(),
    removed = new Set<string>();
  let conversations: ConversationRecord[] = [],
    current = conversation.newConversation(
      services.preferences.get<Fields>(names.chatSettings, {}),
    );
  let models: CatalogModel[] = [],
    ready = false,
    loaded = false,
    catalogError = "",
    error = "",
    quote: Quote | null = null,
    quota: QuotaStatus | null = null;
  let busy: {
    cId: string;
    version?: ConversationVersion;
    phase: string;
    startedAt: number;
    controller: AbortController;
  } | null = null;
  let uploading = 0,
    disposed = false,
    catalogRevision = 0,
    quoteRevision = 0,
    storageWarned = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined,
    quoteTimer: ReturnType<typeof setTimeout> | undefined,
    quoteAbort: AbortController | undefined,
    catalogAbort: AbortController | undefined;
  let saving = Promise.resolve(),
    loading: Promise<void> | undefined;
  const reads = new Set<Promise<unknown>>();
  const emit = () => {
    if (!disposed) for (const f of listeners) f();
  };
  const selected = (c = current) =>
    models.find((m) => m.id === c.settings.model);
  const snapshotFor = (c = current) =>
    conversation.contextSnapshot(
      c,
      c.prompt,
      selected(c)?.maxImages ?? Infinity,
    );
  const collect = () => {
    if (!busy && !uploading) assets.collect(conversations);
    for (const [id, at] of finished)
      if (Date.now() - at >= 2000) finished.delete(id);
  };
  const mutable = () => loaded && services.data.phase === "ready" && !disposed;
  function save() {
    if (!loaded || disposed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush().catch(() => {}), 400);
  }
  async function flush(write: Writer = services.data.write) {
    clearTimeout(saveTimer);
    await Promise.allSettled([...reads]);
    clearTimeout(saveTimer);
    const job = saving
      .catch(() => {})
      .then(async () => {
        if (!loaded) return;
        const put = conversations
          .filter((c) => written.get(c.id) !== JSON.stringify(c))
          .map((c) => structuredClone(c));
        const remove = [...removed];
        if (!put.length && !remove.length) return;
        try {
          await write(async () => {
            const tx = services.databases.transaction(
                names.databases.chat,
                ["conversations", "assets"],
                "readwrite",
              ),
              done = transactionDone(tx);
            void done.catch(() => {});
            const records = tx.objectStore("conversations"),
              images = tx.objectStore("assets");
            try {
              for (const id of remove) records.delete(id);
              for (const c of put) records.put(c);
              const [stored, keys] = await Promise.all([
                idbRequest<ConversationRecord[]>(records.getAll()),
                idbRequest(images.getAllKeys()),
              ]);
              const used = assetRefs(stored),
                have = new Set(keys);
              for (const id of used)
                if (!have.has(id) && assets.assets.has(id))
                  images.put(assets.record(id));
              for (const id of keys)
                if (!used.has(String(id))) images.delete(id);
              await done;
            } catch (e) {
              await done;
              throw e;
            }
          });
          for (const c of put) written.set(c.id, JSON.stringify(c));
          for (const id of remove) {
            removed.delete(id);
            written.delete(id);
          }
          storageWarned = false;
        } catch (e) {
          if (!storageWarned) ui.toast(`对话保存失败：${message(e)}`, "err");
          storageWarned = true;
          throw e;
        }
      });
    saving = job;
    return job;
  }
  async function restore() {
    const tx = services.databases.transaction(names.databases.chat, [
      "conversations",
      "assets",
    ]);
    const [records, images] = await Promise.all([
      idbRequest<ConversationRecord[]>(
        tx.objectStore("conversations").getAll(),
      ),
      idbRequest<AssetRecord[]>(tx.objectStore("assets").getAll()),
    ]);
    assets.clear();
    for (const a of images) assets.adopt(a);
    written.clear();
    removed.clear();
    conversations = records.map((c) => {
      written.set(c.id, JSON.stringify(c));
      return conversation.reviveConversation(c, (id) => assets.assets.has(id));
    });
    const id = services.preferences.get<string | null>(names.chatCurrent, null);
    current =
      conversations.find((c) => c.id === id) ||
      [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0] ||
      conversation.newConversation(
        services.preferences.get(names.chatSettings, {}),
      );
    if (!conversations.includes(current)) conversations.push(current);
    loaded = true;
    emit();
  }
  function normalize(c = current) {
    const m = resolveModel(models, String(c.settings.model || "")) || models[0];
    if (m)
      c.settings = {
        model: m.id,
        options: normalizeOptions(m, chatOptions(c)),
      };
  }
  async function refreshCatalog() {
    if (disposed || !loaded || services.data.phase !== "ready") return;
    const revision = ++catalogRevision;
    catalogAbort?.abort();
    catalogAbort = new AbortController();
    const signal = catalogAbort.signal;
    ready = false;
    cancelQuote();
    emit();
    const results = await Promise.allSettled(
      Object.keys(services.connections.configuration.connections).map(
        async (id) =>
          chatModels(await services.gateway(id).catalog(false, signal)),
      ),
    );
    if (disposed || revision !== catalogRevision || signal.aborted) return;
    models = [];
    catalogError = "";
    for (const r of results)
      if (r.status === "fulfilled") {
        for (const m of r.value)
          if (!models.some((v) => v.id === m.id)) models.push(m);
      } else catalogError = message(r.reason);
    normalize();
    ready = !!models.length;
    emit();
    scheduleQuote();
    void refreshQuota();
  }
  async function start() {
    return (loading ??= (async () => {
      try {
        await restore();
        await refreshCatalog();
        save();
      } catch (e) {
        error = message(e);
        emit();
      }
    })());
  }
  function cancelQuote() {
    ++quoteRevision;
    clearTimeout(quoteTimer);
    quoteAbort?.abort();
    quote = null;
  }
  async function prepare(c: ConversationRecord, turn?: ConversationTurn) {
    const settings = structuredClone(turn?.settings || c.settings),
      model = resolveModel(models, String(settings.model || ""));
    if (!model) throw new Error("请选择可用模型");
    const snapshot = turn
      ? structuredClone(turn.snapshot)
      : conversation.contextSnapshot(c, c.prompt, model.maxImages);
    const prompt = turn ? turn.prompt : c.prompt.trim();
    if (!prompt) throw new Error("请填写描述或修改要求");
    if (snapshot.imageIds.length > model.maxImages)
      throw new Error(`该模型最多使用 ${model.maxImages} 张图（含底图）`);
    const images = await assets.encode(snapshot.imageIds);
    return {
      payload: buildChatPayload(
        model,
        snapshot.text,
        object(settings.options) as Record<string, string>,
        images,
      ),
      snapshot,
      prompt,
      settings,
      model,
    };
  }
  function scheduleQuote() {
    cancelQuote();
    error = "";
    emit();
    const c = current,
      rev = quoteRevision;
    if (!mutable() || !ready || !c.prompt.trim() || busy || uploading) return;
    quoteTimer = setTimeout(async () => {
      const controller = (quoteAbort = new AbortController());
      try {
        const p = await prepare(c);
        controller.signal.throwIfAborted();
        const gateway = services.gateway(p.model.connection);
        if (!gateway.profile.quote.supported && !gateway.profile.costCeiling) return;
        const q = await gateway.estimate(p.payload, controller.signal);
        if (rev !== quoteRevision || current !== c || disposed) return;
        quote = q;
        if (q.quota)
          quota = {
            ...normalizeQuota(
              gateway.profile,
              q.quota,
              {},
              quota?.temporaryChecked ?? false,
              p.model.quotaGroup,
            ),
            temporary: quota?.temporary ?? null,
          };
      } catch (e) {
        if (rev === quoteRevision && !controller.signal.aborted)
          error = message(e);
      }
      if (rev === quoteRevision) emit();
    }, 650);
  }
  async function refreshQuota() {
    const m = selected();
    if (!m || !ready || services.data.phase !== "ready") return;
    try {
      const q = await services.gateway(m.connection).quota(m.quotaGroup);
      if (selected() === m) {
        quota = q;
        emit();
      }
    } catch {
      if (selected() === m) {
        quota = null;
        emit();
      }
    }
  }
  function changed(context = false) {
    if (context) current.selectionRevision++;
    save();
    scheduleQuote();
    collect();
    emit();
  }
  function switchConversation(c: ConversationRecord) {
    if (!mutable() || !conversations.includes(c)) return;
    current = c;
    normalize();
    void services.preferences
      .set(names.chatCurrent, c.id)
      .catch((e) => ui.toast(message(e), "err"));
    scheduleQuote();
    emit();
  }
  function addConversation() {
    if (!mutable()) return;
    let c = conversations.find(conversation.isBlank);
    if (c) c.updatedAt = Date.now();
    else {
      c = conversation.newConversation(current.settings);
      conversations.push(c);
    }
    switchConversation(c);
    save();
  }
  async function execute(existing?: ConversationTurn) {
    if (
      !mutable() ||
      !ready ||
      busy ||
      uploading ||
      (!existing && !current.prompt.trim())
    )
      return;
    const c = current,
      shownCost = existing ? null : (quote?.cost ?? null),
      controller = new AbortController();
    busy = { cId: c.id, phase: "校验报价", startedAt: Date.now(), controller };
    cancelQuote();
    emit();
    let turn: ConversationTurn | undefined,
      version: ConversationVersion | undefined;
    const timer = setTimeout(
      () => controller.abort(new DOMException("请求超时", "TimeoutError")),
      240_000,
    );
    try {
      const p = await prepare(c, existing);
      controller.signal.throwIfAborted();
      const result = await services.runTask(
        {
          id: crypto.randomUUID(),
          workspace: "chat",
          sessionId: c.id,
          snapshot: p.payload,
        },
        async (task) => {
          if (existing) {
            turn = existing;
            version = conversation.beginVersion(turn);
          } else {
            ({ turn, version } = conversation.beginTurn(
              c,
              p.snapshot,
              p.prompt,
              p.settings,
            ));
            c.prompt = "";
          }
          const revision = c.selectionRevision;
          Object.assign(busy!, {
            version,
            phase: "生成中",
            startedAt: Date.now(),
          });
          save();
          emit();
          const gateway = task.gateway(p.model.connection);
          await gateway.catalog();
          const output = await gateway.execute(
            p.payload,
            (response, native, signal) => {
              if (busy) busy.phase = "图片加载中";
              emit();
              return consumeMedia(response, native, signal, p.payload);
            },
            {
              shownCost,
              onNotice: (notice) => ui.toast(notice),
              signal: controller.signal,
            },
          );
          const blocks: MessageBlock[] = [];
          for (const block of output.value) {
            if (block.type === "text") {
              blocks.push(block);
              continue;
            }
            const a = await assets.add(
              block.blob,
              `Koma-${c.turns.indexOf(turn!) + 1}-v${turn!.versions.indexOf(version!) + 1}`,
              block.size,
            );
            blocks.push({ type: "image", assetId: a.id });
          }
          task.signal.throwIfAborted();
          conversation.completeVersion(
            c,
            turn!,
            version!,
            blocks,
            output.quote as Fields,
            revision,
          );
          version!.via = output.via;
          finished.set(version!.id, Date.now());
          save();
          emit();
        },
        controller.signal,
      );
      if (result.status !== "completed")
        ui.toast(
          result.status === "busy"
            ? "另一个绘图任务正在进行"
            : "数据维护中，请稍后再试",
          "warn",
        );
    } catch (e) {
      if (version) {
        version.status =
          e instanceof DOMException && e.name === "AbortError"
            ? "cancelled"
            : "error";
        version.error =
          version.status === "cancelled"
            ? "已取消；上游可能仍在处理或计费。"
            : message(e);
      } else ui.toast(message(e), "err");
    } finally {
      clearTimeout(timer);
      busy = null;
      collect();
      save();
      emit();
      scheduleQuote();
      void refreshQuota();
    }
  }
  async function upload(files: File[]) {
    if (!mutable() || !files.length) return;
    const c = current;
    uploading++;
    cancelQuote();
    emit();
    const work = (async () => {
      try {
        const m = selected(c);
        if (!m) throw new Error("请先连接并选择模型");
        if (snapshotFor(c).imageIds.length + files.length > m.maxImages)
          throw new Error(`该模型最多使用 ${m.maxImages} 张图（含底图）`);
        const added = [];
        for (const f of files)
          added.push(await assets.add(f, f.name || "粘贴图片"));
        if (!conversations.includes(c)) return;
        for (const a of added) conversation.attachUpload(c, a.id);
        c.selectionRevision++;
      } catch (e) {
        ui.toast(message(e), "err");
      } finally {
        uploading--;
        collect();
        save();
        scheduleQuote();
        emit();
      }
    })();
    reads.add(work);
    try {
      await work;
    } finally {
      reads.delete(work);
    }
  }
  async function claim(ticket: string) {
    await start();
    if (!ready || !mutable()) return false;
    uploading++;
    emit();
    const work = (async () => {
      try {
        const item = await createHandoff(services).take(ticket);
        if (!item) {
          ui.toast("图片已失效，请从绘图页重新发送", "warn");
          return;
        }
        const a = await assets.add(item.blob, item.name, undefined, "image");
        addConversation();
        conversation.attachUpload(current, a.id);
        current.selectionRevision++;
        save();
        emit();
      } catch (e) {
        ui.toast(`图片导入失败：${message(e)}`, "err");
      } finally {
        uploading--;
        scheduleQuote();
      }
    })();
    reads.add(work);
    try {
      await work;
    } finally {
      reads.delete(work);
    }
    await flush().catch(() => {});
    return true;
  }
  const unregister = services.data.register({
    flush,
    async reload() {
      if (loaded) await restore();
    },
    ready() {
      if (loaded && !disposed) void refreshCatalog();
    },
  });
  const unconnect = services.connections.subscribe(() => {
    if (loaded && services.data.phase === "ready") void refreshCatalog();
  });
  const hide = () => {
    if (document.visibilityState === "hidden") void flush().catch(() => {});
  };
  const leave = (e: BeforeUnloadEvent) => {
    if (busy || uploading) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  const pagehide = () => void flush().catch(() => {});
  window.addEventListener("beforeunload", leave);
  window.addEventListener("pagehide", pagehide);
  document.addEventListener("visibilitychange", hide);
  return {
    assets,
    isFresh(id: string) {
      return Date.now() - (finished.get(id) || 0) < 2000;
    },
    start,
    flush,
    refreshCatalog,
    refreshQuota,
    execute,
    upload,
    claim,
    snapshot: () => ({
      conversations: conversation.sortConversations(conversations),
      current: {
        ...current,
        settings: { ...current.settings },
        turns: [...current.turns],
        attachments: [...current.attachments],
        keepIds: [...current.keepIds],
        skipTurnIds: [...current.skipTurnIds],
      },
      models,
      model: selected(),
      ready,
      loaded,
      error,
      catalogError,
      quote,
      quota,
      busy: busy
        ? {
            cId: busy.cId,
            versionId: busy.version?.id,
            phase: busy.phase,
            startedAt: busy.startedAt,
          }
        : null,
      uploading,
      context: snapshotFor(),
    }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    cancel() {
      busy?.controller.abort(new DOMException("已取消", "AbortError"));
    },
    setPrompt(text: string) {
      if (!mutable()) return;
      current.prompt = text;
      changed();
    },
    setModel(id: string) {
      if (!mutable()) return;
      const m = models.find((m) => m.id === id);
      if (!m) return;
      current.settings = {
        model: m.id,
        options: normalizeOptions(m, chatOptions(current)),
      };
      void services.preferences
        .set(names.chatSettings, current.settings)
        .catch(() => {});
      changed();
      void refreshQuota();
      const cut = snapshotFor().dropped.length;
      if (cut)
        ui.toast(
          `${m.name} 每轮最多使用 ${m.maxImages} 张图，其余 ${cut} 张不会发送，可在上下文中调整顺序`,
          "warn",
        );
    },
    setOption(key: string, value: string) {
      if (!mutable()) return;
      current.settings.options = { ...chatOptions(current), [key]: value };
      void services.preferences
        .set(names.chatSettings, current.settings)
        .catch(() => {});
      changed();
    },
    addConversation,
    switchConversation,
    rename(c: ConversationRecord, title: string) {
      if (mutable()) {
        conversation.renameConversation(c, title);
        save();
        emit();
      }
    },
    pin(c: ConversationRecord) {
      if (mutable()) {
        c.pinned = !c.pinned;
        save();
        emit();
      }
    },
    duplicate(c: ConversationRecord) {
      if (!mutable()) return;
      if (busy?.cId === c.id) {
        ui.toast("正在生成，请完成后再复制");
        return;
      }
      const copy = conversation.duplicateConversation(c);
      conversations.push(copy);
      switchConversation(copy);
      save();
    },
    async remove(c: ConversationRecord) {
      if (!mutable()) return;
      if (busy?.cId === c.id) {
        ui.toast("正在生成，请先停止再删除");
        return;
      }
      if (
        !(await ui.confirm({
          title: `删除「${c.title}」？`,
          message: "对话和其中的图片会一起删除，无法撤销。",
          confirmLabel: "删除",
          tone: "danger",
        }))
      )
        return;
      if (!mutable() || busy?.cId === c.id) return;
      removed.add(c.id);
      conversations = conversations.filter((v) => v !== c);
      if (current === c) {
        const next = conversation.sortConversations(conversations)[0];
        if (next) switchConversation(next);
        else addConversation();
      }
      collect();
      save();
      emit();
    },
    mutate(fn: (c: ConversationRecord) => void, selection = false) {
      if (!mutable()) return;
      fn(current);
      changed(selection);
    },
    setBase(id: string) {
      if (!mutable()) return;
      const old = current.mainId;
      current.mainId = id;
      if (old && old !== id && (selected()?.maxImages ?? Infinity) > 1)
        conversation.retainImage(current, old);
      changed(true);
    },
    removeReference(id: string) {
      if (mutable()) {
        conversation.forgetImage(current, id);
        changed(true);
      }
    },
    placeRef(id: string, to: number) {
      if (!mutable()) return;
      const full = conversation.contextSnapshot(current),
        order = full.refs.filter((x) => x !== id);
      order.splice(Math.max(0, Math.min(to, order.length)), 0, id);
      conversation.retainImage(current, id);
      conversation.reorderRefs(
        current,
        !current.mainId && full.base ? [full.base, ...order] : order,
      );
      changed();
    },
    async useEditorResult(
      cId: string,
      result: {
        blob: Blob;
        name: string;
        size: { width: number; height: number };
      },
    ) {
      if (!mutable() || !ready) throw new Error("请先连接或解锁 API Key");
      if (busy) throw new Error("请等待当前绘图任务完成");
      const c = conversations.find((v) => v.id === cId);
      if (!c) throw new Error("来源对话已删除");
      if (selected(c)?.maxImages === 1 && snapshotFor(c).imageIds.length)
        throw new Error("该模型每轮仅支持 1 张图，请先移除已有底图");
      if (result.blob.size > 8 * 1024 * 1024)
        throw new Error("结果超过参考图的 8MB 限制，请下载后缩小再上传");
      const a = await assets.add(result.blob, result.name, result.size);
      conversation.retainImage(c, a.id);
      c.selectionRevision++;
      save();
      scheduleQuote();
      emit();
    },
    dispose() {
      disposed = true;
      busy?.controller.abort();
      catalogAbort?.abort();
      cancelQuote();
      clearTimeout(saveTimer);
      unregister();
      unconnect();
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("visibilitychange", hide);
      assets.dispose();
      finished.clear();
      listeners.clear();
    },
  };
}
export type Chat = ReturnType<typeof createChat>;
