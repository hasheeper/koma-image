import type { ApplicationServices } from "./application.ts";
import {
  DEFAULTS,
  collect,
  count,
  batchParams,
  drawingPayload,
  reuseFields,
  sizeProblem,
} from "../domain/drawing.ts";
import type { DrawingForm, ImageRecord } from "../domain/drawing.ts";
import type { CatalogModel } from "../domain/catalog.ts";
import { resolveModel } from "../domain/catalog.ts";
import { object } from "../domain/value.ts";
import { quotaPolicy } from "../domain/quota.ts";
import type { QuotaStatus } from "../domain/quota.ts";
import { createCostNotice } from "../domain/quote.ts";
import { usesNative } from "../gateway/routes.ts";
import { createQuotePreview } from "./quote-preview.ts";
import type { QuoteState } from "./quote-preview.ts";
import { consumeImage, makeThumb } from "./image-response.ts";
import { makeComparison } from "../native/comparison.js";
import { names } from "../storage/names.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import type { FavoriteRecord, Fields } from "../storage/records.ts";
import type { Ui } from "../app/ui.ts";
import { message } from "../app/ui.ts";

export function createDrawing(services: ApplicationServices, ui: Ui) {
  const listeners = new Set<() => void>(),
    urls = new Map<string, { blob: Blob; url: string }>();
  let form: DrawingForm = {
    ...DEFAULTS,
    ...object(services.preferences.get(names.preferences, {})),
  };
  // Persistent values are small JSON; records and binary resources stay plain.
  form.seed = String(form.seed ?? "");
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
    quote: QuoteState = { status: "idle", quote: null };
  let favoritesLoading = true,
    favoritesError = "",
    catalogLoading = false,
    catalogError = "",
    disposed = false,
    revision = 0;
  let preview:
    | ReturnType<typeof createQuotePreview<ReturnType<typeof drawingPayload>>>
    | undefined;
  let refreshAbort: AbortController | undefined,
    quotaAbort: AbortController | undefined,
    taskAbort: AbortController | undefined;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let reveal: ((record: ImageRecord) => Promise<void>) | undefined;
  const favoritePending = new Set<string>();
  const connectionSamplers = new Map<string, string[]>();
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(names.sync)
      : undefined;
  const emit = () => {
    if (!disposed) for (const fn of listeners) fn();
  };
  const notify = (text: string, tone = "info") => {
    if (!disposed) ui.toast(text, tone);
  };
  const policy = () =>
    quotaPolicy(
      quota,
      !usesNative(
        { model: form.model, cache: form.serverCache },
        quote.status === "ready" ? quote.quote : null,
      ),
    );
  const batchCount = () =>
    policy().serialDisabled ? 1 : count(form.batchCount);
  const url = (item: ImageRecord, thumb = false) => {
    const blob = thumb ? item.thumbBlob || item.blob : item.blob,
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
    if (disposed) return;
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
    preview?.update(drawingPayload(collect(form, model, batchCount())));
  }
  function scheduleReset() {
    clearTimeout(resetTimer);
    if (disposed) return;
    const seconds = policy().resetSeconds;
    if (policy().serialDisabled && seconds != null && seconds > 0)
      resetTimer = setTimeout(
        () => void refreshQuota(true),
        Math.min(2147483647, (seconds + 2) * 1000),
      );
  }
  async function refreshQuota(
    force = false,
    selected = model,
    signal?: AbortSignal,
  ) {
    if (!selected) return null;
    if (selected !== model) {
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
      const next = await services
        .gateway(selected.connection)
        .quota(
          selected.quotaGroup,
          signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
        );
      if (token === revision && model === selected) {
        quota = next;
        quotaAt = Date.now();
      }
      return next;
    } catch (e) {
      signal?.throwIfAborted();
      if (token === revision && model === selected && !abort.signal.aborted) {
        quota = quota ? { ...quota, temporaryChecked: false } : null;
        quotaAt = 0;
      }
      return null;
    } finally {
      if (token === revision && quotaAbort === abort) {
        quotaLoading = false;
        scheduleReset();
        emit();
      }
    }
  }
  function bindModel() {
    if (services.data.phase !== "ready") {
      preview?.dispose();
      preview = undefined;
      return;
    }
    preview?.dispose();
    quotaAbort?.abort();
    clearTimeout(resetTimer);
    quota = null;
    quotaAt = 0;
    quote = { status: "idle", quote: null };
    revision++;
    model =
      resolveModel(models, form.model) ??
      resolveModel(models, DEFAULTS.model) ??
      models[0];
    if (model) {
      samplers = connectionSamplers.get(model.connection) ?? [DEFAULTS.sampler];
      form = {
        ...form,
        model: model.id,
        sampler: samplers.includes(form.sampler)
          ? form.sampler
          : samplers.includes(DEFAULTS.sampler)
            ? DEFAULTS.sampler
            : samplers[0],
      };
      const gateway = services.gateway(model.connection);
      preview = createQuotePreview(
        gateway.profile,
        "image",
        gateway.estimate,
        (s) => {
          quote = s.status === "error" ? { ...s, quote: null } : s;
          scheduleReset();
          emit();
        },
      );
      scheduleQuote();
      void refreshQuota(true);
    } else preview = undefined;
    emit();
  }
  async function refreshCatalog() {
    if (disposed) return;
    refreshAbort?.abort();
    refreshAbort = new AbortController();
    const signal = refreshAbort.signal;
    catalogLoading = true;
    catalogError = "";
    emit();
    const results = await Promise.allSettled(
      Object.values(services.connections.configuration.connections).map(
        async (c) => ({
          catalog: await services.gateway(c.id).catalog(false, signal),
          id: c.id,
        }),
      ),
    );
    if (signal.aborted || disposed) return;
    const next: CatalogModel[] = [];
    connectionSamplers.clear();
    for (const result of results)
      if (result.status === "fulfilled") {
        for (const m of result.value.catalog.models)
          if (m.provider === "novelai" && !next.some((v) => v.id === m.id))
            next.push(m);
        connectionSamplers.set(result.value.id, result.value.catalog.samplers);
      } else catalogError = message(result.reason);
    models = next.sort((a, b) =>
      b.id.localeCompare(a.id, undefined, { numeric: true }),
    );
    catalogLoading = false;
    bindModel();
  }
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
  async function saveFavorite(item: ImageRecord) {
    const record: FavoriteRecord = {
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
        "favorites",
        "readwrite",
      );
      tx.objectStore("favorites").put(record);
      await transactionDone(tx);
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
            "favorites",
            "readwrite",
          );
          tx.objectStore("favorites").delete(item.id);
          await transactionDone(tx);
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
                await saveFavorite(old);
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
    form = { ...form, ...values };
    trim();
    if (values.model !== undefined) bindModel();
    else scheduleQuote();
    emit();
    try {
      await services.preferences.set(names.preferences, {
        ...object(services.preferences.get(names.preferences, {})),
        ...form,
      });
    } catch (e) {
      notify(message(e), "err");
    }
  }
  function apply(fields: Record<string, unknown>) {
    const changes: Partial<DrawingForm> = {};
    const applied: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const target = key === "negative_prompt" ? "negative" : key;
      if (key === "model") {
        const resolved = resolveModel(models, String(value));
        if (resolved) {
          changes.model = resolved.id;
          applied.push(key);
        }
        continue;
      }
      if (key === "sampler" && !samplers.includes(String(value))) continue;
      if (["prompt", "negative", "sampler", "seed"].includes(target)) {
        Object.assign(changes, { [target]: String(value ?? "") });
        applied.push(key);
      }
      if (
        ["width", "height", "steps", "scale", "cfg", "batchCount"].includes(
          target,
        ) &&
        Number.isFinite(Number(value))
      ) {
        const range = (
          {
            steps: [1, 50, 1],
            scale: [0, 20, 0.5],
            cfg: [0, 30, 0.5],
          } as Record<string, number[]>
        )[target];
        const numeric = range
          ? Math.max(
              range[0],
              Math.min(
                range[1],
                Math.round(Number(value) / range[2]) * range[2],
              ),
            )
          : Number(value);
        Object.assign(changes, { [target]: numeric });
        applied.push(key);
      }
    }
    void patch(changes);
    return applied;
  }
  async function addImage(
    blob: Blob,
    size: ImageRecord["size"],
    params: Fields,
    ms: number,
    quoteValue: Fields | null = null,
  ) {
    const thumbBlob = await makeThumb(blob);
    const record: ImageRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      blob,
      thumbBlob,
      size,
      params,
      ms,
      quote: quoteValue,
    };
    history = [record, ...history];
    trim();
    emit();
    return record;
  }
  async function run() {
    if (busy) {
      notify("正在生成，请稍候或先取消");
      return;
    }
    if (!model) {
      notify(catalogError || "请先配置连接并解锁 Key", "warn");
      return;
    }
    if (
      sizeProblem(Number(form.width), Number(form.height), model.maxPixels)
        .fatal
    )
      return;
    let selected = model;
    const before = state;
    let batchQuote = quote.status === "ready" ? quote.quote : null;
    let base = collect(form, selected, batchCount());
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
      width: base.width,
      height: base.height,
      index: 1,
      total: base.batchCount,
      done: 0,
    };
    emit();
    try {
      await refreshQuota(true, selected, signal);
      signal.throwIfAborted();
      // Like the baseline, the preflight can finish after the user edits the form.
      // Capture the actual submission only now; later edits cannot alter this batch.
      if (
        !model ||
        sizeProblem(Number(form.width), Number(form.height), model.maxPixels)
          .fatal
      ) {
        if (!browsing) state = before;
        if (!model) notify("模型列表加载中，请稍候");
        return;
      }
      selected = model;
      base = collect(form, selected, batchCount());
      batchQuote = quote.status === "ready" ? quote.quote : null;
      pending = {
        width: base.width,
        height: base.height,
        index: 1,
        total: base.batchCount,
        done: 0,
      };
      emit();
      const result = await services.runTask(
        { id: crypto.randomUUID(), workspace: "image", snapshot: base },
        async (task) => {
          const gateway = task.gateway(selected.connection);
          await gateway.catalog(false, task.signal);
          // The batch owns one slot through its quota checks, decoding, reveal and comparison.
          const notice = createCostNotice(
            quote.quote?.cost ?? null,
            base.batchCount > 1,
          );
          let quotaStopped = false;
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
              payload = drawingPayload(params);
            if (index > 0) {
              const status = await refreshQuota(true, selected, task.signal);
              if (
                quotaPolicy(status, !usesNative(payload, batchQuote))
                  .serialDisabled
              ) {
                quotaStopped = true;
                break;
              }
            }
            const result = await gateway.execute(
              payload,
              (response, native, s) =>
                consumeImage(response, native, s, payload),
              { notice, onNotice: (text) => notify(text), signal: task.signal },
            );
            batchQuote = result.quote;
            const record = await addImage(
              result.value.blob,
              result.value.size,
              { ...params, via: result.via },
              result.ms,
              JSON.parse(JSON.stringify(result.quote)) as Fields,
            );
            completed++;
            records.push(record);
            pending = { ...pending!, done: completed };
            if (!browsing) {
              await reveal?.(record);
              if (!browsing) show(record);
            } else emit();
            if (completed === base.batchCount)
              void refreshQuota(true, selected);
          }
          if (quotaStopped) {
            if (records.length) show(records.at(-1)!);
            title = "额度保护已停止串行";
            subtitle = `已完成 ${completed}/${base.batchCount}`;
            notify("额度不足或暂不可用，未再提交后续请求", "warn");
            emit();
            return;
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
              show(record);
              notify(`批量生成完成，共 ${completed} 张，已生成对比图`, "ok");
            } catch (e) {
              task.signal.throwIfAborted();
              show(records.at(-1)!);
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
      scheduleQuote();
    }
  }
  const stopConnections = services.connections.subscribe(() => {
    void refreshCatalog();
  });
  const stopPrefs = services.preferences.subscribe((key) => {
    if (!key || key === names.preferences) {
      const next = {
        ...DEFAULTS,
        ...object(services.preferences.get(names.preferences, {})),
      };
      next.seed = String(next.seed ?? "");
      if (JSON.stringify(next) !== JSON.stringify(form)) {
        const changed = next.model !== form.model;
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
      if (!disposed) void refreshCatalog();
    },
  });
  const changed = (e: MessageEvent) => {
    if (e.data?.type === "favorites-changed" && services.data.phase === "ready")
      void reloadFavorites();
  };
  channel?.addEventListener("message", changed);
  void reloadFavorites();
  void refreshCatalog();
  return {
    snapshot: () => ({
      form,
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
      quote,
      policy: policy(),
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
    async addExternal(
      blob: Blob,
      size: ImageRecord["size"],
      params: Fields,
      quote: Fields | null,
      ms = 0,
    ) {
      const record = await addImage(blob, size, params, ms, quote);
      if (disposed) throw new DOMException("工作区已关闭", "AbortError");
      show(record);
      return record;
    },
    patch,
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
    reuse() {
      if (current) {
        apply(reuseFields(current));
        notify("已填入参数", "ok");
      }
    },
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
      quotaAbort?.abort();
      preview?.dispose();
      clearTimeout(resetTimer);
      stopConnections();
      stopPrefs();
      unregister();
      channel?.close();
      for (const v of urls.values()) URL.revokeObjectURL(v.url);
      urls.clear();
      listeners.clear();
      reveal = undefined;
    },
  };
}
export type Drawing = ReturnType<typeof createDrawing>;
