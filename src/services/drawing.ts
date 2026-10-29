import { naiQuoteKey } from "./nai-awareness.ts";
import { imageEntity } from "../domain/image-identity.ts";
import { assignFavorite, retireFavorite, identityStores, readFavoriteIdentity } from "./image-identities.ts";
import { validateNaiText } from "../domain/nai-input.ts";
import { readReferences, referenceModel, referencePlan, referenceSurcharge, activeReferences } from "../domain/nai-references.ts";
import { insufficientFunds } from "../domain/source-funding.ts";
import type { PreparedReferences } from "../domain/nai-references.ts";
import type { ImagePayload } from "../gateway/routes.ts";
import type { ApplicationServices } from "./application.ts";
import {
  DEFAULTS,
  collect,
  count,
  batchParams,
  drawingPayload,
  sizeProblem,
  prepareDrawingFields,
  rollbackDrawingEdit,
} from "../domain/drawing.ts";
import type { DrawingForm, DrawingParams, ImageRecord } from "../domain/drawing.ts";
import type { CatalogModel } from "../domain/catalog.ts";
import { resolveModel, selectCatalogSources } from "../domain/catalog.ts";
import type { SourceSelection } from "./source-priority.ts";
import { object } from "../domain/value.ts";
import type { QuotaStatus } from "../domain/quota.ts";
import { createCostNotice } from "../domain/quote.ts";
import { createQuotePreview } from "./quote-preview.ts";
import type { QuoteState } from "./quote-preview.ts";
import { consumeImage, makeThumb } from "./image-response.ts";
import { makeComparison } from "../native/comparison.ts";
import { names } from "../storage/names.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import type { FavoriteRecord, Fields } from "../storage/records.ts";
import type { Ui } from "../app/ui.ts";
import type { AppRouter } from "../app/router.ts";
import { message } from "../app/ui.ts";
import { boardForm, boardKeys, readBoards, boardColors } from "../domain/drawing.ts";
import type { DrawingBoard } from "../domain/drawing.ts";
import { characterCapability, nextCharacterId, sameValue } from "../domain/characters.ts";
import type { Character } from "../domain/characters.ts";
import { imageConnections } from "../config/connections.ts";
import { naiCapabilities } from "../domain/nai.ts";
import { modelSamplers, naiNoiseSchedule, supportsNaiVariety } from "../domain/nai-parameters.ts";

export function createDrawing(
  services: ApplicationServices,
  ui: Ui,
  router: Pick<AppRouter, "openOverlay">,
) {
  const listeners = new Set<() => void>(),
    urls = new Map<string, { blob: Blob; url: string }>();
  const imageListeners = new Set<(record: ImageRecord) => void>();
  let boards = readBoards(services.preferences.get(names.preferences, {}));
  const activeBoard = () => boards.items.find(b => b.id === boards.activeId)!;
  let form: DrawingForm = {
    ...DEFAULTS,
    ...Object.fromEntries(Object.entries(object(services.preferences.get(names.preferences, {}))).filter(([k]) => k in DEFAULTS)),
    ...activeBoard().form,
  };
  // Persistent values are small JSON; records and binary resources stay plain.
  form.seed = String(form.seed ?? "");
  form.naiReferences = readReferences(form.naiReferences);
  let models: CatalogModel[] = [],
    samplers = [DEFAULTS.sampler],
    model: CatalogModel | undefined;
  let history: ImageRecord[] = [],
    favorites: FavoriteRecord[] = [],
    current: ImageRecord | null = null;
  let state: "empty" | "busy" | "done" | "error" = "empty",
    busy = false,
    browsing = false,
    error = "",
    title = "就绪",
    subtitle = "",
    label = "生成";
  let pending: {
    boardId?: string;
    width: number;
    height: number;
    index: number;
    total: number;
    done: number;
    composing?: boolean;
  } | null = null;
  let quota: QuotaStatus | null = null,
    quotaLoading = false,
    quotaAt = 0,
    quoteAt = 0,
    quoteKey = "",
    quote: QuoteState = { status: "idle", quote: null };
  let favoritesLoading = true,
    favoritesError = "",
    catalogLoading = false,
    catalogError = "",
    disposed = false,
    revision = 0,
    draftQuotePaused = false;
  let preview:
    | ReturnType<typeof createQuotePreview<ReturnType<typeof drawingPayload>>>
    | undefined;
  let refreshAbort: AbortController | undefined,
    quotaAbort: AbortController | undefined,
    taskAbort: AbortController | undefined;
  let reveal: ((record: ImageRecord) => Promise<void>) | undefined;
  const favoritePending = new Set<string>();
  const referenceModels = new Set<string>();
  const connectionSamplers = new Map<string, string[]>();
  let catalogFingerprint = "",
    catalogQueued = false,
    catalogNotice: number | undefined;
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(names.sync)
      : undefined;
  const syncBoard = () => { activeBoard().form = boardForm(form); activeBoard().nextCharacterId = Math.max(activeBoard().nextCharacterId, nextCharacterId(form.characters)); };
  const save = async () => {
    syncBoard();
    const root = { ...object(services.preferences.get(names.preferences, {})), ...form };
    for (const key of boardKeys) delete root[key];
    await services.preferences.set(names.preferences, { ...root, boards });
  };
  const emit = () => {
    syncBoard();
    if (!disposed) for (const fn of listeners) fn();
  };
  const notify = (
    text: string,
    tone = "info",
    action?: Parameters<Ui["toast"]>[2],
  ) => {
    if (!disposed) ui.toast(text, tone, action);
  };
  const batchCount = () => count(form.batchCount);
  const url = (item: ImageRecord, thumb = false) => {
    // Existing JPEG previews may have flattened alpha to black. Read the
    // original for those records; keep stored images and thumbnails untouched.
    const preview = item.thumbBlob?.type === "image/jpeg" && item.blob.type !== "image/jpeg" ? item.blob : item.thumbBlob;
    const blob = thumb ? preview || item.blob : item.blob,
      key = item.id + (thumb ? ":thumb" : ":full"),
      old = urls.get(key);
    if (old?.blob === blob) return old.url;
    if (old) URL.revokeObjectURL(old.url);
    const next = URL.createObjectURL(blob);
    urls.set(key, { blob, url: next });
    return next;
  };
  function prune() {
    const keep = new Set(
      [...history, ...favorites, ...(current ? [current] : [])].map(
        (r) => r.id,
      ),
    );
    for (const [key, value] of urls)
      if (!keep.has(key.replace(/:(thumb|full)$/, ""))) {
        URL.revokeObjectURL(value.url);
        urls.delete(key);
      }
  }
  function trim() {
    const limit = form.localCache ? count(form.historyLimit, 0) : 1;
    if (limit) history = history.slice(0, limit);
    prune();
  }
  function show(item: ImageRecord, viaUser = false) {
    current = item;
    browsing = viaUser && !!pending;
    state = "done";
    title = String(item.params.modelName || "结果");
    subtitle = [
      `${item.size.width}×${item.size.height}`,
      item.params.seed != null ? `seed ${item.params.seed}` : "",
      Number.isFinite(item.ms) ? `${(item.ms! / 1000).toFixed(1)}s` : "",
    ]
      .filter(Boolean)
      .join("  ·  ");
    prune();
    emit();
  }
  function live() {
    browsing = false;
    state = pending ? "busy" : current ? "done" : "empty";
    if (pending) {
      title = pending.composing
        ? "正在整理批次"
        : `生成中${pending.total > 1 ? ` ${pending.index}/${pending.total}` : ""}`;
      subtitle = pending.done ? `已完成 ${pending.done}/${pending.total}` : "";
    }
    emit();
  }
  function scheduleQuote() {
    if (disposed || draftQuotePaused) return;
    if (busy) {
      preview?.pause();
      quote = { status: "loading", quote: quote.quote };
      return;
    }
    if (
      !model ||
      sizeProblem(Number(form.width), Number(form.height), model.maxPixels)
        .fatal
    ) {
      preview?.update(null);
      return;
    }
    const cap = characterCapability(form.model);
    if (cap.max && form.characters.filter(c => c.on).length > cap.max) { preview?.update(null); return; }
    try { preview?.update(drawingPayload(collect(form, model, batchCount()))); }
    catch { preview?.update(null); }
  }
  async function refreshQuota(
    force = false,
    selected = model,
    signal?: AbortSignal,
    detached = false,
  ) {
    if (!selected) return null;
    if (detached || selected !== model) {
      try {
        return await services
          .gateway(selected.connection)
          .quota(selected.quotaGroup, signal);
      } catch {
        signal?.throwIfAborted();
        return null;
      }
    }
    if (!force && Date.now() - quotaAt < 60000) return quota;
    const token = revision;
    quotaAbort?.abort();
    const abort = new AbortController();
    quotaAbort = abort;
    quotaLoading = true;
    emit();
    try {
      const source = await services.selectSource(selected, signal ? AbortSignal.any([signal, abort.signal]) : abort.signal, activeReferences(form.naiReferences).length ? drawingPayload(collect(form, selected, batchCount())) : undefined);
      if (token === revision && model === selected) {
        const changed = model.connection !== source.model.connection;
        applySource(source);
        if (changed && !busy) bindPreview();
        quotaAt = Date.now();
      }
      return source.quota;
    } catch (e) {
      signal?.throwIfAborted();
      if (token === revision && model === selected && !abort.signal.aborted) {
        quotaAt = 0;
      }
      return null;
    } finally {
      if (token === revision && quotaAbort === abort) {
        quotaLoading = false;
        emit();
      }
    }
  }
  function applySource(source: SourceSelection) {
    models = models.map(m => m.id === source.model.id ? source.model : m);
    if (model?.id === source.model.id) {
      model = source.model;
      quota = source.quota;
      quotaAt = Date.now();
    }
  }
  function bindPreview() {
    preview?.dispose();
    if (!model) { preview = undefined; return; }
    const wanted = model;
    preview = createQuotePreview(services.gateway(wanted.connection).profile, "image", async (payload, signal) => {
      const source = await services.selectSource(wanted, signal, payload);
      signal.throwIfAborted();
      applySource(source);
      if (source.insufficient) throw new Error("所有可用来源的额度均不足");
      return source.quote;
    }, s => {
      quote = s.status === "error" ? { ...s, quote: null } : s;
      if(s.status === "ready") {quoteAt=Date.now();quoteKey=naiQuoteKey(form,model);}
      emit();
    });
    scheduleQuote();
  }
  function bindModel() {
    if (services.data.phase !== "ready") {
      preview?.dispose();
      preview = undefined;
      return;
    }
    preview?.dispose();
    quotaAbort?.abort();
    quota = null;
    quotaAt = 0;
    quote = { status: "idle", quote: null };
    revision++;
    model = resolveModel(models, form.model) ?? (naiCapabilities(form.model).medium ? undefined : resolveModel(models, DEFAULTS.model) ?? models[0]);
    if (model) {
      samplers = modelSamplers(model, connectionSamplers.get(model.connection) ?? [DEFAULTS.sampler]);
      form = {
        ...form,
        model: model.id,
        sampler: naiCapabilities(form.model).medium || samplers.includes(form.sampler)
          ? form.sampler
          : samplers.includes(DEFAULTS.sampler)
            ? DEFAULTS.sampler
            : samplers[0],
      };
      bindPreview();
      if (!draftQuotePaused) void refreshQuota(true);
    } else preview = undefined;
    emit();
  }
  async function refreshCatalog() {
    if (disposed || services.data.phase !== "ready") return;
    refreshAbort?.abort();
    refreshAbort = new AbortController();
    const signal = refreshAbort.signal;
    catalogLoading = true;
    catalogError = "";
    preview?.dispose();
    preview = undefined;
    quotaAbort?.abort();
    quota = null;
    quotaAt = 0;
    quote = { status: "idle", quote: null };
    revision++;
    emit();
    const configuration = services.connections.configuration;
    const configured = imageConnections(configuration),
      available = configured.filter((c) =>
        services.connections.hasCredential(c.credentialRef),
      ),
      availableIds = new Set(available.map((c) => c.id));
    // Model-source edits and renames still refresh the catalog silently.
    // Only a new address/profile/credential, or an unfinished check, needs feedback.
    const fingerprint = JSON.stringify(
      [...configured].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [
        c.id, c.baseUrl, c.profileId, c.credentialRef,
        availableIds.has(c.id)
          ? services.connections.context(c.id).credentialRevision
          : null,
      ]),
    );
    const announce =
      fingerprint !== catalogFingerprint || catalogNotice !== undefined;
    catalogFingerprint = fingerprint;
    if (announce && available.length) {
      catalogNotice = ui.toast(
        available.length === 1
          ? `正在连接 ${available[0]!.name}…`
          : `正在连接 ${available.length} 个供应商…`,
        "load",
        undefined,
        catalogNotice,
      );
    } else if (catalogNotice !== undefined) {
      ui.dismissNotice(catalogNotice);
      catalogNotice = undefined;
    }
    const notice = catalogNotice;
    const results = await Promise.allSettled(
      configured.map(
        async (c) => ({
          catalog: await services.gateway(c.id).catalog(false, signal),
          id: c.id,
        }),
      ),
    );
    if (signal.aborted || disposed) return;
    if (services.data.phase !== "ready") {
      catalogLoading = false;
      if (catalogNotice !== undefined) ui.dismissNotice(catalogNotice);
      catalogNotice = undefined;
      catalogFingerprint = "";
      emit();
      return;
    }
    const next: CatalogModel[] = [];
    connectionSamplers.clear();
    referenceModels.clear();
    for (const result of results)
      if (result.status === "fulfilled") {
        for (const m of result.value.catalog.models) {
          next.push(m);
          if (m.profileId === "nai-official-v1" && referenceModel(m.id) && m.upstreamId.replace(/@local$/, "") === m.id.replace(/@local$/, "")) referenceModels.add(m.id);
        }
        connectionSamplers.set(result.value.id, result.value.catalog.samplers);
      } else catalogError = message(result.reason);
    models = selectCatalogSources(configuration, next).filter(m => m.provider === "novelai").sort((a, b) =>
      b.id.localeCompare(a.id, undefined, { numeric: true }),
    );
    catalogLoading = false;
    bindModel();
    if (notice !== undefined && catalogNotice === notice) {
      const connected = results.filter((r) => r.status === "fulfilled"),
        failed = results.filter(
          (r, i): r is PromiseRejectedResult =>
            r.status === "rejected" && availableIds.has(configured[i]!.id),
        ),
        missing = configured.length - available.length;
      const settings = {
        label: "设置",
        run: async () => {
          router.openOverlay("settings", "connections");
        },
      };
      let text: string;
      if (connected.length) {
        text =
          configured.length === 1
            ? `已连接 ${configured[0]!.name} · ${connected[0]!.value.catalog.models.length} 个模型`
            : `已连接 ${connected.length} 个供应商`;
        if (failed.length) text += ` · ${failed.length} 个连接失败`;
        if (missing) text += ` · ${missing} 个待配置 Key`;
      } else {
        const reason = failed[0]?.reason,
          detail = message(reason);
        const hint =
          /401|unauthorized|invalid.*key|key.*invalid/i.test(detail)
            ? "Key 无效"
            : reason instanceof DOMException && reason.name === "TimeoutError"
              ? "连接超时"
              : detail.includes("报价保护")
                ? "网关协议不兼容"
                : detail.slice(0, 160) || "请检查地址、Key 或网络";
        text =
          available.length === 1
            ? `连接 ${available[0]!.name} 失败 · ${hint}`
            : `连接失败 · ${hint}`;
      }
      const incomplete = failed.length > 0 || missing > 0;
      ui.toast(
        text,
        connected.length ? (incomplete ? "warn" : "ok") : "err",
        incomplete || !connected.length ? settings : undefined,
        notice,
      );
      catalogNotice = undefined;
    }
  }
  function queueCatalog() {
    if (catalogQueued || disposed) return;
    catalogQueued = true;
    queueMicrotask(() => {
      catalogQueued = false;
      if (!disposed) void refreshCatalog();
    });
  }
  let favoritesScopeId = "";
  async function reloadFavorites() {
    favoritesLoading = true;
    emit();
    try {
      const tx = services.databases.transaction(
          names.databases.favorites,
          "favorites",
        ),
        done = transactionDone(tx);
      const records = (await idbRequest(
        tx.objectStore("favorites").getAll(),
      )) as FavoriteRecord[];
      await done;
      favoritesScopeId = (await readFavoriteIdentity(services.databases)).state.libraryId;
      favorites = records.sort(
        (a, b) => b.favoritedAt - a.favoritedAt || b.createdAt - a.createdAt,
      );
      favoritesError = "";
      prune();
    } catch (e) {
      favoritesError = message(e);
    } finally {
      favoritesLoading = false;
      emit();
    }
  }
  async function saveFavorite(item: ImageRecord, restore = false) {
    let record: FavoriteRecord = {
      entity_key: await imageEntity(item.blob),
      ...(restore && item.favSeq ? { favSeq: item.favSeq } : {}),
      ...(item.lineage ? { lineage: item.lineage } : {}),
      id: item.id,
      createdAt: item.createdAt,
      favoritedAt: item.favoritedAt ?? Date.now(),
      blob: item.blob,
      thumbBlob: item.thumbBlob,
      params: structuredClone(item.params),
      size: { ...item.size },
      quote: item.quote ?? null,
      ms: item.ms,
    };
    await services.data.write(async () => {
      const tx = services.databases.transaction(
        names.databases.favorites,
        identityStores,
        "readwrite",
      );
      const done = transactionDone(tx);
      record = await assignFavorite(tx, record, restore);
      await done;
    });
    favorites = [record, ...favorites.filter((r) => r.id !== record.id)].sort(
      (a, b) => b.favoritedAt - a.favoritedAt || b.createdAt - a.createdAt,
    );
    channel?.postMessage({ type: "favorites-changed" });
    emit();
  }
  async function toggleFavorite(item = current) {
    if (!item || favoritePending.has(item.id)) return;
    favoritePending.add(item.id);
    emit();
    try {
      const old = favorites.find((r) => r.id === item.id);
      if (old) {
        await services.data.write(async () => {
          const tx = services.databases.transaction(
            names.databases.favorites,
            identityStores,
            "readwrite",
          );
          const done = transactionDone(tx);
          await retireFavorite(tx, item.id);
          await done;
        });
        favorites = favorites.filter((r) => r.id !== item.id);
        channel?.postMessage({ type: "favorites-changed" });
        ui.toast(
          history.some((r) => r.id === item.id)
            ? "已取消收藏"
            : "已取消收藏，此图已不在历史记录中",
          "ok",
          {
            label: "撤销",
            run: async () => {
              if (favoritePending.has(old.id)) return false;
              favoritePending.add(old.id);
              emit();
              try {
                await saveFavorite(old, true);
              } catch (e) {
                notify(message(e), "err");
                return false;
              } finally {
                favoritePending.delete(old.id);
                emit();
              }
            },
          },
        );
      } else {
        await saveFavorite(item);
        notify("已收藏", "ok");
      }
    } catch (e) {
      notify(
        e instanceof DOMException && e.name === "QuotaExceededError"
          ? "存储空间不足，收藏失败"
          : `收藏失败：${message(e)}`,
        "err",
      );
    } finally {
      favoritePending.delete(item.id);
      prune();
      emit();
    }
  }
  async function patch(values: Partial<DrawingForm>) {
    draftQuotePaused = false;
    form = { ...form, ...values };
    trim();
    if (values.model !== undefined) bindModel();
    else scheduleQuote();
    emit();
    try {
      await save();
    } catch (e) {
      notify(message(e), "err");
    }
  }
  function apply(fields: Record<string, unknown>) {
    const { changes, applied } = prepareDrawingFields(fields, models, samplers);
    if (changes.characters) {
      let next = activeBoard().nextCharacterId;
      changes.characters = changes.characters.map(c => ({ ...c, id: `c${next++}` }));
      activeBoard().nextCharacterId = next;
    }
    void patch(changes);
    return applied;
  }
  async function addImage(
    blob: Blob,
    size: ImageRecord["size"],
    params: Fields,
    ms: number | undefined,
    quoteValue: Fields | null = null,
  ) {
    const [thumbBlob, entity_key] = await Promise.all([makeThumb(blob), imageEntity(blob)]);
    const record: ImageRecord = {
      id: crypto.randomUUID(),
      entity_key, lineage: { via: "image" },
      createdAt: Date.now(),
      blob,
      thumbBlob,
      size,
      params,
      ...(ms === undefined ? {} : { ms }),
      quote: quoteValue,
    };
    history = [record, ...history];
    trim();
    emit();
    for (const listener of imageListeners) listener(record);
    return record;
  }
  async function run() {
    if (busy) {
      notify("正在生成，请稍候或先取消");
      return;
    }
    if (!model) {
      notify(catalogError || "请先配置供应商和 API Key", "warn", {
        label: "设置",
        run: async () => {
          router.openOverlay("settings", "connections");
        },
      });
      return;
    }
    if (
      sizeProblem(Number(form.width), Number(form.height), model.maxPixels)
        .fatal
    )
      return;
    const sourceBoardId = boards.activeId;
    let selected = model;
    // Keep the price the user saw, including during a pending preview refresh.
    // A later board switch must not replace this batch's comparison baseline.
    let shownCost = quote.quote?.cost ?? null;
    let base: DrawingParams;
    try { base = collect(form, selected, batchCount()); } catch (e) { notify(message(e), "warn"); return; }
    let completed = 0;
    const records: ImageRecord[] = [];
    taskAbort = new AbortController();
    const signal = taskAbort.signal;
    busy = true;
    preview?.pause();
    browsing = false;
    state = "busy";
    title = "检查额度";
    subtitle = "";
    label = "检查额度…";
    error = "";
    pending = {
      boardId: sourceBoardId,
      width: base.width,
      height: base.height,
      index: 1,
      total: base.batchCount,
      done: 0,
    };
    emit();
    try {
      let preflightSource = await services.selectSource(selected, signal, activeReferences(base.naiReferences).length ? drawingPayload(base) : undefined);
      selected = preflightSource.model;
      signal.throwIfAborted();
      // Preflight may observe edits on its source board, never another board.
      let source = boards.items.find(b => b.id === sourceBoardId);
      if (!source) throw new Error("来源画板已删除，本次生成已取消");
      const sourceModel = resolveModel(models, source.form.model);
      if (!sourceModel) throw new Error("来源画板的模型已不可用，请重新选择模型");
      if (sizeProblem(source.form.width, source.form.height, sourceModel.maxPixels).fatal) throw new Error("来源画板的画幅超出模型限制，请调整后重新生成");
      if (selected.id !== sourceModel.id) {
        shownCost = null;
        preflightSource = await services.selectSource(sourceModel, signal, activeReferences(source.form.naiReferences).length ? drawingPayload(collect({ ...form, ...source.form }, sourceModel, count(source.form.batchCount))) : undefined);
        selected = preflightSource.model;
      }
      signal.throwIfAborted();
      source = boards.items.find(b => b.id === sourceBoardId);
      if (!source) throw new Error("来源画板已删除，本次生成已取消");
      if (source.form.model !== sourceModel.id) throw new Error("预检期间模型已再次变化，请重新生成");
      base = collect({ ...form, ...source.form }, selected, count(source.form.batchCount));
      validateNaiText(drawingPayload(base));
      const provenance = { boardId: source.id, boardName: source.name, boardColor: source.color };
      pending = {
        boardId: sourceBoardId,
        width: base.width,
        height: base.height,
        index: 1,
        total: base.batchCount,
        done: 0,
      };
      emit();
      const result = await services.runTask(
        { id: crypto.randomUUID(), workspace: "image", snapshot: { ...base, ...provenance } },
        async (task) => {
          const plan = referencePlan(base.naiReferences);
          let prepared: PreparedReferences | undefined;
          let referenceGateway: ReturnType<typeof task.gateway> | undefined;
          if (plan) {
            const pendingCost = await services.references.pendingCost(plan, selected.id);
            const source = await services.selectSource(selected, task.signal, { ...drawingPayload(base), referenceMinimum:referenceSurcharge(plan) + pendingCost });
            if (source.insufficient) throw new Error(source.insufficient);
            selected = source.model;
            if (boards.activeId === sourceBoardId) { applySource(source); emit(); }
            const client = task.gateway(selected.connection);
            referenceGateway = client;
            label = plan.kind === "vibe" ? "准备 Vibe…" : "准备 Precise…"; emit();
            prepared = await services.references.prepare(plan, selected.id, task.signal, async (image, information) => {
              const balance = await client.quota(selected.quotaGroup, task.signal).catch(() => { task.signal.throwIfAborted(); return null; });
              const reason = insufficientFunds(selected, balance, null, { ...drawingPayload(base), referenceMinimum:2 + referenceSurcharge(plan) });
              if (reason) throw new Error(reason);
              return client.encodeVibe(selected.id, image, information, task.signal);
            });
          }
          // The batch owns one slot through its requests, decoding, reveal and comparison.
          const notice = createCostNotice(
            shownCost,
            base.batchCount > 1,
          );
          for (let index = 0; index < base.batchCount; index++) {
            task.signal.throwIfAborted();
            pending = {
              ...pending!,
              index: index + 1,
              total: base.batchCount,
              done: completed,
            };
            label =
              base.batchCount > 1
                ? `生成中 ${index + 1}/${base.batchCount}`
                : "生成中";
            if (!browsing) live();
            else emit();
            const params = batchParams(base, index),
              payload: ImagePayload = { ...drawingPayload(params), ...(prepared ? { preparedReferences:prepared } : {}) };
            const consume = (response: Response, native: boolean, s: AbortSignal) => consumeImage(response, native, s, payload, params.optimize);
            const options = { notice, onNotice: (text: string) => notify(text), signal:task.signal };
            const result = await (prepared ? referenceGateway!.execute(payload, consume, {
              ...options, beforeSubmit: async (freshQuote) => {
                const balance = await referenceGateway!.quota(selected.quotaGroup, task.signal).catch(() => { task.signal.throwIfAborted(); return null; });
                const reason = insufficientFunds(selected, balance, freshQuote, payload);
                if (reason) throw new Error(reason);
              },
            }) : task.execute(
              selected, payload,
              (response, native, s) =>
                consumeImage(response, native, s, payload, params.optimize),
              { notice, onNotice: (text) => notify(text), signal: task.signal,
                onSource: source => {
                  selected = source.model;
                  if (boards.activeId === sourceBoardId) {
                    applySource(source);
                    quote = source.quote ? { status: "ready", quote: source.quote } : { status: "unsupported", quote: null };
                    emit();
                  }
                },
              },
            ));
            const record = await addImage(
              result.value.blob,
              result.value.size,
              { ...params, ...provenance, varietyPlus: supportsNaiVariety(selected) && params.varietyPlus, noise_schedule: selected.profileId === "nai-official-v1" ? naiNoiseSchedule(selected.id, params.sampler, payload.noiseSchedule ?? payload.noise_schedule) : "karras", via: result.via },
              result.ms,
              JSON.parse(JSON.stringify(result.quote)) as Fields,
            );
            completed++;
            records.push(record);
            pending = { ...pending!, done: completed };
            // The landed picture takes the placeholder's slot while the stage reveals it.
            emit();
            if (!browsing) {
              await reveal?.(record);
              if (!browsing) show(record);
            }
            if (completed === base.batchCount)
              void refreshQuota(true, selected);
          }
          if (base.batchCount > 1) {
            task.signal.throwIfAborted();
            label = "合成对比图…";
            pending = { ...pending!, composing: true };
            if (!browsing) live();
            else emit();
            try {
              const comparison = await makeComparison(
                records,
                base,
                task.signal,
              );
              task.signal.throwIfAborted();
              const record = await addImage(
                comparison.blob,
                comparison.size,
                {
                  ...base,
                  ...provenance,
                  modelName: `串行对比 · ${records.length} 张`,
                  seed: null,
                  seedStart: base.randomSeed ? null : base.seed,
                  randomSeed: false,
                  isComparison: true,
                  comparisonTotal: records.length,
                  batchTotal: records.length,
                },
                records.reduce((s, r) => s + (r.ms || 0), 0),
              );
              pending = { ...pending!, composing: false };
              if (!browsing) show(record);
              notify(`批量生成完成，共 ${completed} 张，已生成对比图`, "ok");
            } catch (e) {
              task.signal.throwIfAborted();
              if (!browsing) show(records.at(-1)!);
              notify("对比图生成失败，图片已保存到历史", "warn");
            }
          }
        },
        signal,
      );
      if (result.status !== "completed") {
        state = current ? "done" : "empty";
        notify(
          result.status === "busy"
            ? "其他工作区或标签页正在生成，请稍后再试"
            : "数据维护中，请稍后重试",
          "warn",
        );
      }
    } catch (e) {
      browsing = false;
      if (
        signal.aborted ||
        (e instanceof DOMException && e.name === "AbortError")
      ) {
        state = current ? "done" : "empty";
        notify(
          base.batchCount > 1
            ? `已取消，已完成 ${completed}/${base.batchCount} 张`
            : "已取消",
        );
      } else {
        state = "error";
        error = `${base.batchCount > 1 ? `第 ${completed + 1}/${base.batchCount} 张失败，队列已停止。` : ""}${message(e)}`;
        title = base.batchCount > 1 ? "批量中止" : "失败";
        subtitle = completed ? `已完成 ${completed}/${base.batchCount}` : "";
      }
    } finally {
      busy = false;
      pending = null;
      browsing = false;
      taskAbort = undefined;
      label = "生成";
      prune();
      emit();
      bindPreview();
    }
  }
  const stopReferences = services.references.subscribe(emit);
  void services.references.ready().catch(e=>notify(message(e), "err"));
  const stopConnections = services.connections.subscribeImages(queueCatalog);
  const stopPrefs = services.preferences.subscribe((key) => {
    if (!key || key === names.preferences) {
      const saved = services.preferences.get(names.preferences, {});
      const nextBoards = readBoards(saved);
      const next = { ...DEFAULTS, ...Object.fromEntries(Object.entries(object(saved)).filter(([k]) => k in DEFAULTS)), ...nextBoards.items.find(b => b.id === nextBoards.activeId)!.form };
      next.seed = String(next.seed ?? "");
      if (!sameValue(next, form) || !sameValue(nextBoards, boards)) {
        const changed = next.model !== form.model || nextBoards.activeId !== boards.activeId;
        if (changed && pending) { browsing = true; state = current ? "done" : "empty"; }
        boards = nextBoards;
        form = next;
        trim();
        if (changed) bindModel();
        else scheduleQuote();
        emit();
      }
    }
  });
  const unregister = services.data.register({
    async flush() {},
    async reload() {
      await reloadFavorites();
    },
    ready() {
      queueCatalog();
    },
  });
  const changed = (e: MessageEvent) => {
    if (e.data?.type === "favorites-changed" && services.data.phase === "ready")
      void reloadFavorites();
  };
  channel?.addEventListener("message", changed);
  void reloadFavorites();
  void refreshCatalog();
  function selectBoard(id: string) {
    const target = boards.items.find(b => b.id === id);
    if (!target) throw new Error("画板不存在");
    syncBoard();
    boards.activeId = id;
    form = { ...form, ...structuredClone(target.form) };
    if (pending) { browsing = true; state = current ? "done" : "empty"; }
    bindModel();
    emit();
  }
  async function createBoard(copy = false) {
    syncBoard();
    const source = activeBoard();
    const next: DrawingBoard = { id: crypto.randomUUID(), name: copy ? `${source.name} 副本`.slice(0, 80) : `画板 ${boards.items.length + 1}`, color: boardColors[boards.items.length % boardColors.length], nextCharacterId: copy ? source.nextCharacterId : 1,
      form: copy ? structuredClone(source.form) : boardForm({ ...DEFAULTS, characters: [] }) };
    boards.items.push(next);
    selectBoard(next.id);
    await save();
    return next.id;
  }
  async function removeBoard(id: string) {
    if (boards.items.length === 1) throw new Error("至少保留一个画板");
    const index = boards.items.findIndex(b => b.id === id);
    if (index < 0) return;
    if (boards.activeId === id) selectBoard(boards.items[index === 0 ? 1 : index - 1].id);
    boards.items = boards.items.filter(b => b.id !== id);
    emit(); await save();
  }
  return {
    get favoritesScopeId() { return favoritesScopeId; },
    snapshot: () => ({
      form,
      boards: boards.items,
      activeBoardId: boards.activeId,
      referenceSupported: referenceModels.has(form.model),
      referenceProblem: form.naiReferences.active && form.naiReferences[form.naiReferences.active].some(r=>r.on) && !referenceModels.has(form.model) ? "当前模型或来源不支持已启用的参考，配置已保留" : "",
      characterCapability: characterCapability(form.model),
      characterProblem: characterCapability(form.model).max > 0 && form.characters.filter(c => c.on).length > characterCapability(form.model).max,
      models,
      samplers,
      model,
      history,
      favorites,
      current,
      state,
      busy,
      browsing,
      pending,
      error,
      title,
      subtitle,
      label,
      quota,
      quotaLoading,
      quotaAt,
      quoteAt, quoteKey,
      quote,
      batchCount: batchCount(),
      favoritesLoading,
      favoritesError,
      catalogLoading,
      catalogError,
      favoritePending: [...favoritePending],
    }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onImage(fn: (record: ImageRecord) => void) {
      imageListeners.add(fn);
      return () => imageListeners.delete(fn);
    },
    patch,
    async editReferences(value: DrawingForm["naiReferences"], boardId = boards.activeId) {
      const target = boards.items.find(b=>b.id === boardId); if (!target) throw new Error("来源画板已删除");
      const next = readReferences(value);
      if (boardId === boards.activeId) await patch({ naiReferences:next });
      else { target.form.naiReferences = next; await save(); emit(); }
    },
    board: (id: string) => { syncBoard(); return boards.items.find(b => b.id === id); },
    async switchBoard(id: string) { draftQuotePaused = false; selectBoard(id); await save(); },
    createBoard,
    async renameBoard(id: string, name: string) {
      const b = boards.items.find(b => b.id === id); if (!b) return;
      const before = b.name, next = name.trim().slice(0, 80) || before;
      b.name = next; emit();
      try { await save(); }
      catch (error) { if (b.name === next) { b.name = before; emit(); } throw error; }
    },
    removeBoard,
    async editCharacters(chars: Character[], placement = form.placement, boardId = boards.activeId) {
      if (boardId !== boards.activeId) return;
      await patch({ characters: structuredClone(chars), placement });
    },
    async addCharacter(prompt = "") {
      const cap = characterCapability(form.model);
      if (!cap.max || form.characters.length >= cap.max) return;
      const id = `c${activeBoard().nextCharacterId++}`;
      await patch({ characters: [...form.characters, { id, on: true, prompt, negative: "", centers: [{ x: (form.characters.length + 1) / (form.characters.length + 2), y: 0.5 }] }] });
      return id;
    },
    async insertBoardDraft(board: DrawingBoard, sourceId: string) {
      if (!boards.items.some(b => b.id === sourceId) || boards.items.some(b => b.id === board.id)) throw new Error("来源画板已删除或目标画板已存在");
      const previousId = boards.activeId;
      draftQuotePaused = true; boards.items.push(structuredClone(board)); selectBoard(board.id);
      try { await save(); } catch (error) {
        syncBoard();
        const created = boards.items.find(b => b.id === board.id);
        const fallback = boards.items.find(b => b.id === previousId) ?? boards.items.find(b => b.id !== board.id);
        // Only discard our untouched copy; preserve edits made while saving.
        if (created && fallback && sameValue(created, board)) {
          if (boards.activeId === board.id) selectBoard(fallback.id);
          boards.items = boards.items.filter(b => b.id !== board.id);
        }
        emit(); throw error;
      }
    },
    async removeBoardDraft(id: string, expected: DrawingBoard, sourceId: string) {
      const target = boards.items.find(b => b.id === id);
      if (!target || !sameValue(target.form, expected.form) || !boards.items.some(b => b.id === sourceId)) throw new Error("画板已变化或来源已删除");
      const removed = structuredClone(target), index = boards.items.indexOf(target), previousId = boards.activeId;
      draftQuotePaused = true; selectBoard(sourceId); boards.items = boards.items.filter(b => b.id !== id); emit();
      try { await save(); } catch (error) {
        syncBoard();
        if (!boards.items.some(b => b.id === id)) boards.items.splice(Math.min(index, boards.items.length), 0, removed);
        if (boards.activeId === sourceId && boards.items.some(b => b.id === previousId)) selectBoard(previousId);
        emit(); throw error;
      }
    },
    samplersFor(modelId: string) {
      const selected = resolveModel(models, modelId);
      return selected ? modelSamplers(selected, connectionSamplers.get(selected.connection) ?? [DEFAULTS.sampler]) : [...samplers];
    },
    /** User-confirmed ASK writes invalidate the quote without scheduling network work. */
    async writeDraft(values: Partial<DrawingForm>, expected: Record<string, unknown>, boardId = boards.activeId) {
      const target = boards.items.find(b => b.id === boardId);
      if (!target) throw new Error("来源画板已删除");
      if (boardId !== boards.activeId) { draftQuotePaused = true; selectBoard(boardId); }
      if (disposed || services.data.phase !== "ready") throw new Error("数据尚未就绪，草稿未写入");
      if (Object.entries(expected).some(([key, value]) => !sameValue(form[key as keyof DrawingForm], value))) throw new Error("表单已变化，草稿未写入");
      const targetModel = resolveModel(models, values.model ?? form.model);
      if (values.model !== undefined && !targetModel) throw new Error("目标模型已不可用");
      const allowedSamplers = targetModel ? modelSamplers(targetModel, connectionSamplers.get(targetModel.connection) ?? [DEFAULTS.sampler]) : samplers;
      if ((values.model !== undefined || values.sampler !== undefined) && !allowedSamplers.includes(values.sampler ?? form.sampler)) throw new Error("目标模型不支持此采样器，草稿未写入");
      const before = form;
      draftQuotePaused = true;
      form = { ...form, ...values };
      if (values.model !== undefined) bindModel();
      else preview?.update(null);
      const written = { ...form };
      emit();
      try {
        await save();
      } catch (error) {
        // Model, sampler and size must remain a valid group after a manual edit.
        syncBoard();
        const owner = boards.items.find(b => b.id === boardId);
        if (owner) {
          const restored = rollbackDrawingEdit(before, written, { ...form, ...owner.form }, Object.keys(values) as (keyof DrawingForm)[]);
          owner.form = boardForm(restored);
          if (boards.activeId === boardId) {
            const previousModel = form.model;
            form = restored;
            if (form.model !== previousModel) bindModel();
          }
          emit();
        }
        throw error;
      }
    },
    apply,
    run,
    cancel: () => taskAbort?.abort(new DOMException("已取消", "AbortError")),
    show,
    live,
    url,
    reloadFavorites,
    refreshQuota,
    setReveal(fn: typeof reveal) {
      reveal = fn;
    },
    toggleFavorite,
    remove(id: string) {
      history = history.filter((r) => r.id !== id);
      if (current?.id === id && !favorites.some((r) => r.id === id)) {
        current = null;
        live();
      }
      prune();
      emit();
    },
    async clear() {
      if (
        history.length &&
        !(await ui.confirm({
          title: `清空 ${history.length} 张历史图片？`,
          message: "清空后无法恢复未收藏的图片。已收藏的图片仍会保留。",
          confirmLabel: "清空",
          tone: "danger",
        }))
      )
        return;
      history = [];
      if (!current || !favorites.some((r) => r.id === current!.id)) {
        current = null;
        live();
      }
      prune();
      emit();
    },
    hasUnsaved: () =>
      busy ||
      favoritePending.size > 0 ||
      [...history, ...(current ? [current] : [])].some(
        (r) => !favorites.some((f) => f.id === r.id),
      ),
    dispose() {
      disposed = true;
      taskAbort?.abort();
      refreshAbort?.abort();
      if (catalogNotice !== undefined) ui.dismissNotice(catalogNotice);
      quotaAbort?.abort();
      preview?.dispose();
      stopReferences();
      stopConnections();
      stopPrefs();
      unregister();
      channel?.close();
      for (const v of urls.values()) URL.revokeObjectURL(v.url);
      urls.clear();
      listeners.clear();
      imageListeners.clear();
      reveal = undefined;
    },
  };
}
export type Drawing = ReturnType<typeof createDrawing>;
