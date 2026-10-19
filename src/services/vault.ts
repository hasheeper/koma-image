import { names } from "../storage/names.ts";
import type { Locks } from "./locks.ts";
import type { Writer } from "./data-lease.ts";
import { object } from "../domain/value.ts";
export const PBKDF2_ITERATIONS = 210_000;
type Table = Record<string, string>;
type Sealed = {
  v: 2;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ct: string;
};
type VaultEvent = "unlock" | "change" | "lock" | "forget";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const encode = new TextEncoder(),
  decode = new TextDecoder();
const to64 = (value: ArrayBuffer | Uint8Array<ArrayBuffer>) => {
  let out = "";
  for (const b of new Uint8Array(value)) out += String.fromCharCode(b);
  return btoa(out);
};
const from64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const clean = (value: unknown): Table =>
  Object.fromEntries(
    Object.entries(object(value)).filter(
      ([id, key]) =>
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) &&
        !["__proto__", "constructor", "prototype"].includes(id) &&
        typeof key === "string" &&
        key.trim(),
    ),
  ) as Table;

export function createVault({
  local,
  session,
  write,
  locks,
  channel,
  askMs = 200,
}: {
  local: Store;
  session: Store;
  write: Writer;
  locks?: Locks;
  channel?: BroadcastChannel;
  askMs?: number;
}) {
  let keys: Table | null = null,
    dk: CryptoKey | null = null,
    dkRaw = "",
    sealed: Sealed | null = null;
  let lockId = "",
    disposed = false,
    blockedShare = false,
    queue: Promise<unknown> = Promise.resolve();
  let asking: ((answer: boolean) => void) | undefined;
  let resumePromise: Promise<boolean> | undefined;
  const lifetime = new AbortController();
  const alive = () => {
    if (disposed) throw new DOMException("凭据服务已关闭", "AbortError");
  };
  const listeners = new Set<(event: VaultEvent) => void>();
  const emit = (event: VaultEvent) => {
    if (!disposed) for (const fn of listeners) fn(event);
  };
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(() => {
      if (disposed) throw new Error("凭据服务已关闭");
      return fn();
    });
    queue = next.catch(() => {});
    return next;
  };
  const mutate = <T>(fn: () => Promise<T>) => write(() => serial(fn));
  function saved(): Sealed | null {
    try {
      const record = JSON.parse(local.getItem(names.vault) || "null");
      return record?.v === 2 &&
        record.kdf === "PBKDF2-SHA256" &&
        record.iterations === PBKDF2_ITERATIONS &&
        [record.salt, record.iv, record.ct].every((v) => typeof v === "string")
        ? record
        : null;
    } catch {
      return null;
    }
  }
  async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
    if (!crypto?.subtle)
      throw new Error("当前环境不支持 Web Crypto，请使用 HTTPS 或 localhost");
    const base = await crypto.subtle.importKey(
      "raw",
      encode.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
      base,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  }
  async function open(key: CryptoKey, record = saved()) {
    if (!record) throw new Error("本地没有已保存的 Key");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: from64(record.iv) },
      key,
      from64(record.ct),
    );
    return { table: clean(JSON.parse(decode.decode(plain))), record };
  }
  async function seal(
    table: Table,
    key: CryptoKey,
    salt: string,
  ): Promise<Sealed> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encode.encode(JSON.stringify(table)),
    );
    const record: Sealed = {
      v: 2,
      kdf: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      salt,
      iv: to64(iv),
      ct: to64(ct),
    };
    alive();
    local.setItem(names.vault, JSON.stringify(record));
    return record;
  }
  async function adoptKey(
    key: CryptoKey,
    opened: { table: Table; record: Sealed },
    accept = () => true,
  ) {
    const raw = to64(await crypto.subtle.exportKey("raw", key));
    alive();
    if (!accept()) return;
    session.setItem(names.sessionDerivedKey, raw);
    session.removeItem(names.sessionKeys);
    keys = opened.table;
    dk = key;
    dkRaw = raw;
    sealed = opened.record;
  }
  function adoptSession(table: Table) {
    alive();
    session.setItem(names.sessionKeys, JSON.stringify(table));
    session.removeItem(names.sessionDerivedKey);
    keys = table;
    dk = null;
    dkRaw = "";
    sealed = null;
  }
  async function create(table: Table, passphrase: string) {
    if (passphrase.length < 4) throw new Error("口令至少 4 个字符");
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      key = await derive(passphrase, salt);
    const record = await seal(table, key, to64(salt));
    await adoptKey(key, { table, record });
  }
  function post(message: Record<string, unknown>) {
    if (!disposed) channel?.postMessage(message);
  }
  function announce(explicit = false) {
    if (keys && !blockedShare)
      post(
        dk
          ? {
              type: "vault/share",
              mode: "encrypted",
              dk: dkRaw,
              record: sealed,
              explicit,
              lockId,
            }
          : { type: "vault/share", mode: "session", keys, explicit, lockId },
      );
  }
  function drop() {
    keys = null;
    dk = null;
    dkRaw = "";
    sealed = null;
    session.removeItem(names.sessionKeys);
    session.removeItem(names.sessionDerivedKey);
  }
  /** Keeps the current save mode and shares the new table with other pages. */
  async function replace(table: Table) {
    if (dk && sealed) {
      sealed = await seal(table, dk, sealed.salt);
      keys = table;
      post({ type: "vault/changed", record: sealed });
    } else {
      adoptSession(table);
      announce();
    }
    emit("change");
  }
  async function afterTask(fn: () => Promise<void>) {
    if (locks?.request)
      await locks.request(
        names.taskGate,
        { mode: "exclusive", signal: lifetime.signal },
        fn,
      );
    else await fn();
  }
  async function lockLocal(event: "lock" | "forget", id: string) {
    lockId = id;
    blockedShare = true;
    asking?.(false);
    await afterTask(() =>
      mutate(async () => {
        if (event === "forget") local.removeItem(names.vault);
        drop();
        emit(event);
      }),
    );
  }
  async function receive(event: MessageEvent) {
    const message = object(event.data);
    if (message.type === "vault/hello") {
      announce();
      return;
    }
    if (message.type === "vault/lock" || message.type === "vault/forget") {
      await lockLocal(
        message.type === "vault/lock" ? "lock" : "forget",
        String(message.lockId),
      );
      return;
    }
    const accepted = () =>
      !disposed &&
      (!blockedShare ||
        (message.explicit === true && message.lockId === lockId));
    const revision = lockId;
    if (
      !accepted() ||
      !["vault/share", "vault/changed"].includes(String(message.type))
    )
      return;
    await mutate(async () => {
      if (!accepted() || revision !== lockId) return;
      const was = Boolean(keys);
      try {
        if (message.type === "vault/changed") {
          if (!dk) return;
          const opened = await open(dk, message.record as Sealed);
          alive();
          if (blockedShare) return;
          keys = opened.table;
          sealed = opened.record;
          emit("change");
          return;
        }
        if (message.mode === "session") {
          const table = clean(message.keys);
          if (!dk && keys && JSON.stringify(table) === JSON.stringify(keys))
            return;
          adoptSession(table);
        } else if (
          message.mode === "encrypted" &&
          typeof message.dk === "string"
        ) {
          if (
            keys &&
            dkRaw === message.dk &&
            sealed?.ct === object(message.record).ct
          )
            return;
          const key = await crypto.subtle.importKey(
            "raw",
            from64(message.dk),
            "AES-GCM",
            true,
            ["encrypt", "decrypt"],
          );
          await adoptKey(
            key,
            await open(key, message.record as Sealed),
            () => accepted() && revision === lockId,
          );
        } else return;
        if (!accepted() || revision !== lockId) return;
        blockedShare = false;
        if (asking) asking(Boolean(keys));
        else emit(was ? "change" : "unlock");
      } catch {
        if (message.type === "vault/changed") {
          drop();
          emit("lock");
        }
      }
    });
  }
  const onMessage = (event: MessageEvent) => {
    void receive(event).catch(() => {});
  };
  channel?.addEventListener("message", onMessage);
  return {
    mode: (): "encrypted" | "session" | "empty" =>
      keys
        ? dk
          ? "encrypted"
          : "session"
        : saved()
          ? "encrypted"
          : session.getItem(names.sessionKeys)
            ? "session"
            : "empty",
    isUnlocked: () => Boolean(keys),
    key: (id: string) => keys?.[id] ?? null,
    ids: () => Object.keys(keys ?? {}),
    subscribe(fn: (event: VaultEvent) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    resume() {
      return (resumePromise ??= (async () => {
        if (keys) return true;
        blockedShare = false;
        const restored = await mutate(async () => {
          try {
            const table = session.getItem(names.sessionKeys),
              raw = session.getItem(names.sessionDerivedKey);
            if (table) {
              adoptSession(clean(JSON.parse(table)));
              return true;
            }
            if (raw && saved()) {
              const key = await crypto.subtle.importKey(
                "raw",
                from64(raw),
                "AES-GCM",
                true,
                ["encrypt", "decrypt"],
              );
              await adoptKey(key, await open(key), () => !blockedShare);
              return Boolean(keys);
            }
          } catch {
            alive();
            session.removeItem(names.sessionDerivedKey);
            session.removeItem(names.sessionKeys);
          }
          return false;
        });
        if (restored) return true;
        if (blockedShare || disposed) return false;
        if (!channel) return false;
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => asking?.(false), askMs);
          asking = (answer) => {
            clearTimeout(timer);
            asking = undefined;
            resolve(answer);
          };
          post({ type: "vault/hello" });
        });
      })().finally(() => {
        resumePromise = undefined;
      }));
    },
    saveEncrypted(id: string, value: string, passphrase: string) {
      return mutate(async () => {
        if (!value.trim()) throw new Error("请填写 API Key");
        if (saved() && !keys) throw new Error("请先解锁已有 Key");
        await create({ ...keys, [id]: value.trim() }, passphrase);
        blockedShare = false;
        announce(true);
        emit("unlock");
      });
    },
    saveSession(id: string, value: string) {
      return mutate(async () => {
        if (!value.trim()) throw new Error("请填写 API Key");
        if (saved() && !keys) throw new Error("请先解锁已有 Key");
        const table = { ...keys, [id]: value.trim() };
        local.removeItem(names.vault);
        adoptSession(table);
        blockedShare = false;
        announce(true);
        emit("unlock");
      });
    },
    unlock(passphrase: string) {
      return mutate(async () => {
        const record = saved();
        if (!record) throw new Error("本地没有已保存的 Key");
        let opened, key: CryptoKey;
        try {
          key = await derive(passphrase, from64(record.salt));
          opened = await open(key, record);
        } catch {
          throw new Error("口令不正确");
        }
        await adoptKey(key, opened);
        blockedShare = false;
        announce(true);
        emit("unlock");
      });
    },
    setKey(id: string, value: string) {
      return mutate(async () => {
        if (!keys) throw new Error("请先解锁");
        if (!value.trim()) return;
        await replace({ ...keys, [id]: value.trim() });
      });
    },
    removeKey(id: string) {
      return mutate(async () => {
        if (!keys) throw new Error("请先解锁");
        if (!Object.hasOwn(keys, id)) return;
        const table = { ...keys };
        delete table[id];
        await replace(table);
      });
    },
    changePassphrase(passphrase: string) {
      return mutate(async () => {
        if (!keys) throw new Error("请先解锁");
        await create(keys, passphrase);
        announce();
        emit("change");
      });
    },
    lock() {
      const id = crypto.randomUUID();
      post({ type: "vault/lock", lockId: id });
      return lockLocal("lock", id);
    },
    async forget() {
      const id = crypto.randomUUID();
      post({ type: "vault/forget", lockId: id });
      await lockLocal("forget", id);
    },
    dispose() {
      disposed = true;
      lifetime.abort();
      asking?.(false);
      channel?.removeEventListener("message", onMessage);
      listeners.clear();
      keys = null;
      dk = null;
      dkRaw = "";
      sealed = null;
    },
  };
}
export type Vault = ReturnType<typeof createVault>;
