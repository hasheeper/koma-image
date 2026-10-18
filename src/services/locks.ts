export type Locks = Pick<LockManager, "request">;
export function requireLocks(locks?: Locks): Locks {
  if (!locks?.request) throw new Error("浏览器不支持安全数据与生成锁，请使用新版浏览器和 HTTPS 或 localhost");
  return locks;
}
/** Resolve only after acquisition; release resolves only after the callback exits. */
export async function holdLock(locks: Locks, name: string, mode: LockMode, signal?: AbortSignal) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let acquired!: () => void, failed!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
  const finished = locks.request(name, { mode, signal }, async () => { acquired(); await held; });
  void finished.catch(failed);
  await ready;
  return async () => { release(); await finished; };
}
