import { onBeforeUnmount, ref, shallowRef } from "vue";
import type { Ref } from "vue";
import { useServices } from "../../app/services";
import { message } from "../../app/ui";
import { novelaiConnectionLabel } from "../../gateway/native-protocols";
import type { Routing } from "../../config/connections";

export type ConnectionStatus = { s: string; text: string };
export function useConnectionCatalogs(options: {
  isOpen: () => boolean; showCatalogs: () => boolean;
  listConnection: Ref<string | null>; askList: Ref<string | null>;
}) {
  const services = useServices(), { connections } = services;
  const { listConnection, askList } = options;
  const routing = shallowRef<Routing>(connections.configuration);
  const raw = shallowRef<Record<string, unknown>>({});
  const balances = shallowRef<Record<string, Record<string, unknown>>>({});
  const statuses = ref<Record<string, ConnectionStatus>>({});
  type ConnectionCheck = { controller: AbortController; contextKey: string; promise: Promise<void> };
  const checks = new Map<string, ConnectionCheck>(), queuedChecks = new Set<string>();
  let catalogKeys = new Map(Object.keys(routing.value.connections).map(id => [id, connections.catalogKey(id)]));
  let loadQueued = false, disposed = false;
  function stopChecks(ids: Iterable<string> = checks.keys()) {
    for (const id of ids) { checks.get(id)?.controller.abort(); checks.delete(id); }
  }
  function queueLoad(ids: Iterable<string>) {
    for (const id of ids) queuedChecks.add(id);
    if (loadQueued || disposed || !queuedChecks.size) return;
    loadQueued = true;
    queueMicrotask(() => {
      loadQueued = false;
      const ids = [...queuedChecks];
      queuedChecks.clear();
      if (!disposed) void load(false, ids);
    });
  }
  async function loadConnection(id: string, force = false) {
    const c = routing.value.connections[id], key = connections.catalogKey(id);
    if (!c) return;
    if (!key) {
      statuses.value[id] = { s: "wait", text: "未配置 Key" };
      return;
    }
    const contextKey = connections.context(id).cacheKey, previous = checks.get(id);
    if (!force && previous?.contextKey === contextKey) return previous.promise;
    previous?.controller.abort();
    const controller = new AbortController(), { signal } = controller;
    const check: ConnectionCheck = { controller, contextKey, promise: Promise.resolve() };
    checks.set(id, check);
    if (!raw.value[id]) statuses.value[id] = { s: "wait", text: "检查中…" };
    check.promise = (async () => {
      try {
        const gateway = services.gateway(id);
        const results = await Promise.allSettled([
          gateway.rawCatalog(force, signal), gateway.quota(undefined, signal),
        ]);
        if (disposed || signal.aborted || checks.get(id) !== check || connections.catalogKey(id) !== key) return;
        // A local source edit invalidates execution contexts, but must not replace a live list with an error.
        if (connections.context(id).cacheKey !== contextKey) { queueLoad([id]); return; }
        if (results[0].status === "fulfilled") {
          raw.value = { ...raw.value, [id]: results[0].value };
          statuses.value[id] = { s: "ok", text: gateway.profile.protocol === "novelai" ? novelaiConnectionLabel(results[0].value) : gateway.profile.reasoning ? "可用 · 推理尚未实测" : "可用 · 刚刚检查" };
        } else statuses.value[id] = { s: "err", text: message(results[0].reason) };
        if (results[1].status === "fulfilled") balances.value = { ...balances.value, [id]: results[1].value.media };
      } catch (error) {
        if (!disposed && !signal.aborted && checks.get(id) === check)
          statuses.value[id] = { s: "err", text: message(error) };
      } finally { if (checks.get(id) === check) checks.delete(id); }
    })();
    return check.promise;
  }
  async function load(force = false, ids = Object.keys(routing.value.connections)) {
    if (!options.isOpen()) return;
    const shown = options.showCatalogs() ? ids : ids.filter(id => id === askList.value);
    await Promise.all(shown.map(id => loadConnection(id, force)));
  }
  const unconnections = connections.subscribe((_kind, change) => {
    routing.value = connections.configuration;
    const nextKeys = new Map(Object.keys(routing.value.connections).map(id => [id, connections.catalogKey(id)]));
    const changed = [...new Set([...catalogKeys.keys(), ...nextKeys.keys()])]
      .filter(id => change.refresh || catalogKeys.get(id) !== nextKeys.get(id));
    if (changed.length) {
      stopChecks(changed);
      const nextRaw = { ...raw.value }, nextBalances = { ...balances.value };
      for (const id of changed) { delete nextRaw[id]; delete nextBalances[id]; delete statuses.value[id]; }
      raw.value = nextRaw;
      balances.value = nextBalances;
    }
    catalogKeys = nextKeys;
    if (listConnection.value && !routing.value.connections[listConnection.value]) listConnection.value = null;
    if (askList.value && !routing.value.connections[askList.value]) askList.value = null;
    if (options.isOpen()) queueLoad(changed);
  });
  onBeforeUnmount(() => { disposed = true; stopChecks(); unconnections(); });
  return { routing, raw, balances, statuses, load, loadConnection, stopChecks };
}
