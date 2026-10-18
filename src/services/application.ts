import { createScheduler } from "./scheduler.ts";
import type { TaskSpec, TaskContext } from "./scheduler.ts";
import { createDataLease } from "./data-lease.ts";
import { createConnections } from "./connections.ts";
import { createGateway } from "../gateway/client.ts";
import { openDatabases } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import type { Locks } from "./locks.ts";

export function createApplicationServices(deps: {
  storage: Pick<Storage, "getItem" | "setItem">; indexedDB: IDBFactory; locks?: Locks;
  fetch?: typeof fetch; events?: Pick<Window, "addEventListener" | "removeEventListener">;
  channel?: BroadcastChannel;
}) {
  const scheduler = createScheduler(deps.locks);
  scheduler.pause();
  const data = createDataLease(deps.locks, scheduler);
  const connections = createConnections(deps.storage, data.write);
  const clients = new Map<string, ReturnType<typeof createGateway>>();
  let databases: Awaited<ReturnType<typeof openDatabases>> | undefined;
  let initialization: Promise<void> | undefined;
  let disposed = false;
  const unsubscribe = connections.subscribe(() => clients.clear());
  const unregister = data.register({ flush: async () => {}, reload: async () => { connections.reload(); } });
  function client(id: string) {
    if (data.phase !== "ready" || !databases || disposed) throw new Error("应用数据尚未就绪");
    const context = connections.context(id);
    let gateway = clients.get(context.cacheKey);
    if (!gateway) { gateway = createGateway(context, deps.fetch); clients.set(context.cacheKey, gateway); }
    return gateway;
  }
  function onStorage(event: Event) {
    if ((event as StorageEvent).key !== names.routing || data.phase !== "ready") return;
    connections.reload();
  }
  // A data-change notification carries no keys, images or private connection values.
  function onMessage(event: MessageEvent) {
    if (event.data?.type === "routing-changed" && data.phase === "ready") connections.reload();
  }
  deps.events?.addEventListener("storage", onStorage);
  deps.channel?.addEventListener("message", onMessage);
  return {
    scheduler, data, connections,
    get databases() { if (!databases) throw new Error("存储尚未就绪"); return databases; },
    start() {
      return initialization ??= (async () => {
        try {
          await data.start();
          if (disposed) throw new DOMException("应用已关闭", "AbortError");
          databases = await openDatabases(deps.indexedDB);
          if (disposed) throw new DOMException("应用已关闭", "AbortError");
          connections.reload();
          if (!disposed) scheduler.resume();
        } catch (error) { scheduler.pause(); databases?.close(); await data.dispose(); throw error; }
      })();
    },
    gateway(id: string) {
      const gateway = client(id);
      return { profile: gateway.profile, catalog: gateway.catalog, estimate: gateway.estimate, quota: gateway.quota };
    },
    /** Drawing batches, chat turns and editor work all enter here exactly once. */
    runTask<T, R>(spec: TaskSpec<T>, work: (context: TaskContext<T> & {
      gateway: (id: string) => ReturnType<typeof createGateway>;
    }) => Promise<R>, signal?: AbortSignal) {
      return scheduler.run(spec, async task => {
        let open = true;
        let submission: Promise<unknown> | undefined;
        try {
          return await work({ ...task, gateway: id => {
            const gateway = client(id);
            return { ...gateway, execute: (payload, consume, options) => {
              if (!open) return Promise.reject(new Error("任务已结束，不能继续提交"));
              if (submission) return Promise.reject(new Error("当前任务仍在生成，请等待本张完成"));
              const result = gateway.execute(payload, consume,
                { ...options, signal: options?.signal ? AbortSignal.any([task.signal, options.signal]) : task.signal });
              submission = result;
              void result.finally(() => { if (submission === result) submission = undefined; }).catch(() => {});
              return result;
            } };
          } });
        } finally {
          open = false;
          // Even an accidentally unawaited request cannot escape its task slot.
          await submission;
        }
      }, signal);
    },
    async dispose() {
      if (disposed) return;
      disposed = true; scheduler.dispose();
      deps.events?.removeEventListener("storage", onStorage);
      deps.channel?.removeEventListener("message", onMessage); deps.channel?.close();
      unsubscribe(); unregister(); clients.clear(); connections.dispose();
      try { await data.dispose(); } finally { databases?.close(); }
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
