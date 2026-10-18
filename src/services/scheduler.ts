import { names } from "../storage/names.ts";
import { freeze } from "../domain/value.ts";
import { requireLocks } from "./locks.ts";
import type { Locks } from "./locks.ts";

export interface TaskSpec<T> { id: string; workspace: "image" | "chat" | "editor"; sessionId?: string; snapshot: T }
export interface TaskContext<T> { readonly task: Readonly<TaskSpec<T>>; readonly signal: AbortSignal; readonly slot: number }
export type TaskResult<T> = { status: "completed"; value: T } | { status: "busy" | "maintenance" };

/** Future reservation boundary. No balance ledger or pre-debit is enabled. */
export interface ReservationPort {
  reserve(request: { taskId: string; requestId: string; connectionId: string; credentialRevision: string;
    pool: string; maxCost: number; signal: AbortSignal }): Promise<{
      finish(outcome: "not-submitted" | "acknowledged" | "uncertain"): Promise<void>;
    }>;
}

export function createScheduler(locks?: Locks) {
  // The slot algorithm is 1..N; this release exposes no capacity setter.
  const capacity = 1;
  const active = new Map<string, AbortController>();
  let accepting = true, disposed = false;
  return {
    capacity,
    get activeCount() { return active.size; },
    get accepting() { return accepting && !disposed; },
    pause() { accepting = false; },
    resume() { if (!disposed) accepting = true; },
    cancel(id: string) { active.get(id)?.abort(new DOMException("已取消", "AbortError")); },
    async run<T, R>(spec: TaskSpec<T>, work: (context: TaskContext<T>) => Promise<R>, signal?: AbortSignal): Promise<TaskResult<R>> {
      if (!accepting || disposed) return { status: "maintenance" };
      if (active.size >= capacity || active.has(spec.id)) return { status: "busy" };
      const manager = requireLocks(locks);
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      active.set(spec.id, controller);
      try {
        const task = freeze(structuredClone(spec));
        controller.signal.throwIfAborted();
        return await manager.request(names.taskGate, { mode: capacity === 1 ? "exclusive" : "shared", ifAvailable: true }, async gate => {
          if (!gate) return { status: "busy" };
          for (let slot = 1; slot <= capacity; slot++) {
            const result = await manager.request(names.taskSlot(slot), { mode: "exclusive", ifAvailable: true }, async lock => {
              if (!lock) return null;
              controller.signal.throwIfAborted();
              return { status: "completed", value: await work({ task, signal: controller.signal, slot }) } as TaskResult<R>;
            });
            if (result) return result;
          }
          return { status: "busy" };
        });
      } finally {
        signal?.removeEventListener("abort", abort);
        active.delete(spec.id);
      }
    },
    dispose() {
      disposed = true; accepting = false;
      for (const controller of active.values()) controller.abort(new DOMException("应用已关闭", "AbortError"));
    },
  };
}
export type Scheduler = ReturnType<typeof createScheduler>;
