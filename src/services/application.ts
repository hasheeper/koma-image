import { createNaiReferences } from "./nai-references.ts";
import { createScheduler } from "./scheduler.ts";
import type { TaskSpec, TaskContext } from "./scheduler.ts";
import { createDataLease } from "./data-lease.ts";
import { createConnections } from "./connections.ts";
import { createGateway } from "../gateway/client.ts";
import { openDatabases } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import type { Locks } from "./locks.ts";
import { createVault } from "./vault.ts";
import { createPreferences } from "./preferences.ts";
import { createBackupService } from "./backup.ts";
import { createTagSearch } from "./tag-search.ts";
import { normalizeCategories } from "../domain/tags.ts";
import type { LocalGateway } from "../config/runtime.ts";
import { createSourcePriority } from "./source-priority.ts";
import type { SourceOptions } from "./source-priority.ts";
import type { CatalogModel } from "../domain/catalog.ts";
import type { ImagePayload } from "../gateway/routes.ts";

export function createApplicationServices(deps: {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  indexedDB: IDBFactory;
  locks?: Locks;
  session?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetch?: typeof fetch;
  events?: Pick<Window, "addEventListener" | "removeEventListener">;
  channel?: BroadcastChannel;
  local?: LocalGateway;
}) {
  const scheduler = createScheduler(deps.locks);
  scheduler.pause();
  const data = createDataLease(deps.locks, scheduler);
  const connections = createConnections(deps.storage, data.write, deps.local);
  const vault = createVault({
    local: deps.storage,
    session: deps.session ?? sessionStorage,
    write: data.write,
    locks: deps.locks,
    channel: deps.local ? undefined : deps.channel,
  });
  const preferences = createPreferences(deps.storage, data);
  const tags = createTagSearch(
    () => normalizeCategories(preferences.get(names.tagCategories, null)),
    deps.fetch,
  );
  const clients = new Map<string, ReturnType<typeof createGateway>>();
  const catalogs = new Map<string, import("../gateway/client.ts").GatewayCatalogCache>();
  let databases: Awaited<ReturnType<typeof openDatabases>> | undefined;
  const references = createNaiReferences(() => { if (!databases) throw new Error("数据未就绪"); return databases; }, data);
  const backup = createBackupService({
    databases: () => {
      if (!databases) throw new Error("数据未就绪");
      return databases;
    },
    data,
    storage: deps.storage,
  });
  let initialization: Promise<void> | undefined;
  let disposed = false;
  function syncKeys() {
    if (connections.local) return;
    for (const c of Object.values(connections.configuration.connections)) {
      const value = vault.key(c.credentialRef);
      if (value) connections.supplyKey(c.credentialRef, value);
      else connections.clearKey(c.credentialRef);
    }
  }
  const unsubscribe = connections.subscribe((kind, change) => {
    clients.clear();
    if (change.refresh) catalogs.clear();
    else {
      const current = new Set(Object.keys(connections.configuration.connections).map(connections.catalogKey));
      for (const key of catalogs.keys()) if (!current.has(key)) catalogs.delete(key);
    }
    if (kind === "configuration") syncKeys();
  });
  const unvault = vault.subscribe(syncKeys);
  const unregister = data.register({
    flush: async () => {},
    reload: async () => {
      connections.reload();
    },
  });
  function client(id: string) {
    if (data.phase !== "ready" || !databases || disposed)
      throw new Error("应用数据尚未就绪");
    const context = connections.context(id);
    let gateway = clients.get(context.cacheKey);
    if (!gateway) {
      const key = connections.catalogKey(id)!;
      let cache = catalogs.get(key);
      if (!cache) catalogs.set(key, cache = {});
      gateway = createGateway(context, deps.fetch, undefined, cache);
      clients.set(context.cacheKey, gateway);
    }
    return gateway;
  }
  function onStorage(event: Event) {
    if (data.phase !== "ready") return;
    const key = (event as StorageEvent).key;
    if (key === names.routing || key === names.localModels || key === null)
      connections.reload(false);
    preferences.changed(key ?? undefined);
  }
  const priority = createSourcePriority(connections, client);
  deps.events?.addEventListener("storage", onStorage);
  return {
    scheduler,
    data,
    connections,
    vault,
    preferences,
    backup,
    tags,
    references,
    selectSource: priority.select,
    get databases() {
      if (!databases) throw new Error("存储尚未就绪");
      return databases;
    },
    start() {
      return (initialization ??= (async () => {
        try {
          await data.start();
          if (disposed) throw new DOMException("应用已关闭", "AbortError");
          databases = await openDatabases(deps.indexedDB);
          if (disposed) throw new DOMException("应用已关闭", "AbortError");
          connections.reload();
          if (!connections.local) await vault.resume();
          syncKeys();
          if (!disposed) scheduler.resume();
        } catch (error) {
          scheduler.pause();
          databases?.close();
          await data.dispose();
          throw error;
        }
      })());
    },
    gateway(id: string) {
      const gateway = client(id);
      return {
        profile: gateway.profile,
        catalog: gateway.catalog,
        rawCatalog: gateway.rawCatalog,
        fetchedAt: gateway.fetchedAt,
        estimate: gateway.estimate,
        quota: gateway.quota,
      };
    },
    /** Drawing batches, chat turns and editor work all enter here exactly once. */
    runTask<T, R>(
      spec: TaskSpec<T>,
      work: (
        context: TaskContext<T> & {
          gateway: (id: string) => ReturnType<typeof createGateway>;
          execute: <V>(model: CatalogModel, payload: ImagePayload, consume: (response: Response, native: boolean, signal: AbortSignal) => Promise<V>, options?: SourceOptions) => ReturnType<typeof priority.execute<V>>;
        },
      ) => Promise<R>,
      signal?: AbortSignal,
    ) {
      return scheduler.run(
        spec,
        async (task) => {
          let open = true;
          let submission: Promise<unknown> | undefined;
          try {
            const taskGateway = (id: string): ReturnType<typeof createGateway> => {
                const gateway = client(id);
                return {
                  ...gateway,
                  encodeVibe: (model, image, information, signal) => {
                    if (!open || submission) return Promise.reject(new Error("任务已结束或仍有请求在执行"));
                    const result = gateway.encodeVibe(model, image, information, AbortSignal.any([task.signal, signal]));
                    submission = result;
                    void result.finally(() => { if (submission === result) submission = undefined; }).catch(() => {});
                    return result;
                  },
                  execute: (payload, consume, options) => {
                    if (!open)
                      return Promise.reject(
                        new Error("任务已结束，不能继续提交"),
                      );
                    if (submission)
                      return Promise.reject(
                        new Error("当前任务仍在生成，请等待本张完成"),
                      );
                    const result = gateway.execute(payload, consume, {
                      ...options,
                      signal: options?.signal
                        ? AbortSignal.any([task.signal, options.signal])
                        : task.signal,
                    });
                    submission = result;
                    void result
                      .finally(() => {
                        if (submission === result) submission = undefined;
                      })
                      .catch(() => {});
                    return result;
                  },
                };
              };
            return await work({
              ...task,
              gateway: taskGateway,
              execute: (model, payload, consume, options) => priority.execute(model, payload, consume, {
                ...options,
                signal: options?.signal ? AbortSignal.any([task.signal, options.signal]) : task.signal,
              }, taskGateway),
            });
          } finally {
            open = false;
            // Even an accidentally unawaited request cannot escape its task slot.
            await submission;
          }
        },
        signal,
      );
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
      deps.events?.removeEventListener("storage", onStorage);
      deps.channel?.close();
      unsubscribe();
      unvault();
      vault.dispose();
      preferences.dispose();
      references.dispose();
      unregister();
      clients.clear();
      catalogs.clear();
      connections.dispose();
      try {
        await data.dispose();
      } finally {
        databases?.close();
      }
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
