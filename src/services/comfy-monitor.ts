import { COMFY_PROFILE_ID } from "../domain/comfy-workflow.ts";
import type { ComfySystemStatus } from "../domain/comfy-system.ts";
import { readComfySystem } from "../gateway/comfy-system.ts";
import type { createConnections } from "./connections.ts";

export type ComfyMonitorState = { source: string; loading: boolean; error: string; updatedAt: number; data?: ComfySystemStatus };
const empty = (source = "ComfyUI"): ComfyMonitorState => ({ source, loading: false, error: "", updatedAt: 0 });
/** UI-only reads: no task slot, persistence, generation retries or background polling. */
export function createComfyMonitor(connections: ReturnType<typeof createConnections>, changed: () => void,
  fetcher: typeof fetch = fetch, timing = { pollMs: 5000, readMs: 5000 }) {
  let id: string | undefined, key: string | null = null, active = false, disposed = false;
  let state = empty(), abort: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    clearTimeout(timer); timer = undefined;
    abort?.abort(); abort = undefined;
    state = { ...state, loading: false };
  }
  function reset() {
    stop();
    const c = id ? connections.configuration.connections[id] : undefined;
    key = c?.profileId === COMFY_PROFILE_ID ? connections.catalogKey(c.id) : null;
    state = empty(c?.name); changed();
    if (active) void refresh();
  }
  async function refresh() {
    if (disposed || !active || !id || abort) return;
    clearTimeout(timer); timer = undefined;
    if (!key) { state = { ...state, error: "连接未就绪" }; changed(); return; }
    const target = id, expected = key, controller = new AbortController(); abort = controller;
    state = { ...state, loading: true }; changed();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timing.readMs)]);
    const current = () => !disposed && active && abort === controller && id === target && key === expected && connections.catalogKey(target) === expected;
    try {
      const data = await readComfySystem(connections.context(target), signal, fetcher);
      if (current()) state = { ...state, data, updatedAt: Date.now(), error: "" };
    } catch (error) {
      if (current() && !controller.signal.aborted) state = { ...state, error: signal.aborted ? "读取超时" : error instanceof TypeError ? "连接中断或浏览器无法读取响应" : error instanceof Error ? error.message : "读取运行状态失败" };
    } finally {
      if (current()) {
        abort = undefined; state = { ...state, loading: false }; changed();
        timer = setTimeout(() => { timer = undefined; void refresh(); }, timing.pollMs);
      }
    }
  }
  const unsubscribe = connections.subscribe(() => {
    if (id && connections.catalogKey(id) !== key) reset();
  });
  return {
    snapshot: () => state,
    setSource(value?: string) { if (value !== id) { id = value; reset(); } },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      if (active) void refresh(); else { stop(); changed(); }
    },
    refresh,
    dispose() { disposed = true; active = false; stop(); unsubscribe(); },
  };
}
