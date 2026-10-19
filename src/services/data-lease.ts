import { names } from "../storage/names.ts";
import { holdLock, requireLocks } from "./locks.ts";
import type { Locks } from "./locks.ts";
import type { Scheduler } from "./scheduler.ts";

export type Writer = <T>(work: () => Promise<T> | T) => Promise<T>;
export interface DataParticipant {
  /** Cancel pending save timers and persist all pending edits through this writer. */
  flush(write: Writer): Promise<void>;
  /** Drop stale caches and reload after regaining the shared lease. */
  reload(): Promise<void>;
  /** Refresh network contexts only after every cache has reloaded and admission resumes. */
  ready?(): void;
}
export function createDataLease(
  locks: Locks | undefined,
  scheduler: Scheduler,
) {
  let release: (() => Promise<void>) | undefined;
  let phase: "cold" | "ready" | "maintenance" | "error" | "disposed" = "cold";
  let starting: Promise<void> | undefined;
  const lifetime = new AbortController();
  const writes = new Set<Promise<unknown>>(),
    participants = new Set<DataParticipant>();
  const track: Writer = async (work) => {
    const pending = Promise.resolve().then(work);
    writes.add(pending);
    try {
      return await pending;
    } finally {
      writes.delete(pending);
    }
  };
  const drain = async () => {
    while (writes.size) await Promise.all([...writes]);
  };
  async function acquire() {
    release = await holdLock(
      requireLocks(locks),
      names.dataLock,
      "shared",
      lifetime.signal,
    );
    if (lifetime.signal.aborted) {
      await release();
      release = undefined;
      lifetime.signal.throwIfAborted();
    }
  }
  return {
    get phase() {
      return phase;
    },
    register(participant: DataParticipant) {
      participants.add(participant);
      return () => participants.delete(participant);
    },
    start() {
      return (starting ??= (async () => {
        try {
          await acquire();
          phase = "ready";
        } catch (error) {
          if (!lifetime.signal.aborted) phase = "error";
          scheduler.pause();
          throw error;
        }
      })());
    },
    write: (<T>(work: () => T | Promise<T>) => {
      if (phase !== "ready")
        return Promise.reject(new Error("数据维护期间暂不能写入"));
      return track(work);
    }) as Writer,
    async export<T>(read: () => Promise<T>): Promise<T> {
      if (phase !== "ready") throw new Error("数据尚未就绪");
      const alreadyWriting = [...writes];
      // Track the entire export so an import cannot release its lease underneath it.
      return track(async () => {
        await Promise.all(alreadyWriting);
        for (const participant of participants) await participant.flush(track);
        return read();
      });
    },
    async import<T>(work: () => Promise<T>): Promise<T> {
      if (phase !== "ready") throw new Error("数据尚未就绪或正在维护");
      scheduler.pause();
      if (scheduler.activeCount) {
        scheduler.resume();
        throw new Error("当前仍在生成图片，请结束后再导入");
      }
      phase = "maintenance";
      let released = false;
      try {
        // New writes are frozen before flush, including writes from cached workspaces.
        for (const participant of participants) await participant.flush(track);
        await drain();
        await release?.();
        release = undefined;
        released = true;
        return await requireLocks(locks).request(
          names.dataLock,
          { mode: "exclusive", ifAvailable: true },
          async (data) => {
            if (!data) throw new Error("请先关闭本站的其他标签页，再导入备份");
            return requireLocks(locks).request(
              names.taskGate,
              { mode: "exclusive", ifAvailable: true },
              async (gate) => {
                if (!gate) throw new Error("当前仍在生成图片，请结束后再导入");
                return work();
              },
            );
          },
        );
      } finally {
        try {
          if (released) {
            await acquire();
            for (const participant of participants) await participant.reload();
          }
          lifetime.signal.throwIfAborted();
          phase = "ready";
          scheduler.resume();
          for (const participant of participants) participant.ready?.();
        } catch (error) {
          // Never re-enable writes with stale caches after a partial import.
          if (!lifetime.signal.aborted) phase = "error";
          scheduler.pause();
          throw error;
        }
      }
    },
    async dispose() {
      phase = "disposed";
      scheduler.pause();
      lifetime.abort(new DOMException("应用已关闭", "AbortError"));
      await starting?.catch(() => {});
      try {
        await drain();
      } finally {
        await release?.();
        release = undefined;
        participants.clear();
      }
    },
  };
}
export type DataLease = ReturnType<typeof createDataLease>;
