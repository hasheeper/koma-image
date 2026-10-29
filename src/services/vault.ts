import { names } from "../storage/names.ts";
import type { Locks } from "./locks.ts";
import type { Writer } from "./data-lease.ts";
import { object } from "../domain/value.ts";
import { validId } from "../config/connections.ts";

type Table = Record<string, string>;
type CredentialRecord = { version: 1; epoch: string; keys: Table };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type VaultEvent = "change" | "forget";
const clean = (value: unknown): Table => Object.fromEntries(
  Object.entries(object(value)).filter(([id, key]) => validId(id) && typeof key === "string" && key.trim())
    .map(([id, key]) => [id, (key as string).trim()]),
);
const parse = (text: string | null): CredentialRecord => {
  try {
    const value = object(JSON.parse(text || "null"));
    return value.version === 1 && typeof value.epoch === "string"
      ? { version: 1, epoch: value.epoch, keys: clean(value.keys) }
      : { version: 1, epoch: "", keys: {} };
  } catch { return { version: 1, epoch: "", keys: {} }; }
};

/** Credentials stay outside Vue state, configuration exports and ordinary backups. */
export function createVault({ local, session, write, locks, channel, askMs = 200 }: {
  local: Store;
  session: Store;
  write: Writer;
  locks?: Locks;
  channel?: BroadcastChannel;
  askMs?: number;
}) {
  let saved = parse(local.getItem(names.credentials)), temporary: Table = {}, disposed = false;
  let queue: Promise<unknown> = Promise.resolve(), resumePromise: Promise<boolean> | undefined;
  let asking: { nonce: string; finish: (answer: boolean) => void } | undefined;
  const lifetime = new AbortController(), listeners = new Set<(event: VaultEvent) => void>();
  const alive = () => { if (disposed) throw new DOMException("凭据服务已关闭", "AbortError"); };
  const emit = (event: VaultEvent = "change") => { if (!disposed) for (const fn of listeners) fn(event); };
  const post = (message: object) => { if (!disposed) channel?.postMessage(message); };
  const table = () => ({ ...saved.keys, ...temporary });
  function reload() {
    const next = parse(local.getItem(names.credentials));
    if (next.epoch !== saved.epoch) temporary = {};
    for (const id of Object.keys(next.keys)) if (next.keys[id] !== saved.keys[id]) delete temporary[id];
    saved = next;
  }
  function mutate<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = queue.then(() => write(async () => {
      alive();
      const run = async () => { alive(); reload(); return fn(); };
      return locks?.request
        ? locks.request(names.credentialsLock, { mode: "exclusive", signal: lifetime.signal }, run)
        : run();
    }));
    queue = result.catch(() => {});
    return result;
  }
  // A failed local write restores the session snapshot; publish only after both stores succeed.
  function persist(next: CredentialRecord, sessionKeys: Table) {
    const beforeLocal = local.getItem(names.credentials), beforeSession = session.getItem(names.sessionKeys);
    const localText = JSON.stringify(next), sessionText = JSON.stringify({ version: 1, epoch: next.epoch, keys: sessionKeys });
    try {
      if (sessionText !== beforeSession) session.setItem(names.sessionKeys, sessionText);
      if (localText !== beforeLocal && (beforeLocal || next.epoch || Object.keys(next.keys).length))
        local.setItem(names.credentials, localText);
    } catch (error) {
      if (session.getItem(names.sessionKeys) !== beforeSession) {
        if (beforeSession === null) session.removeItem(names.sessionKeys); else session.setItem(names.sessionKeys, beforeSession);
      }
      throw error;
    }
    saved = next;
    temporary = sessionKeys;
  }
  function change(id: string, value: string, remember: boolean) {
    if (!validId(id)) return Promise.reject(new Error("Key 标识无效"));
    if (!value.trim()) return Promise.resolve();
    return mutate(() => {
      const next = { ...saved, keys: { ...saved.keys } }, nextSession = { ...temporary };
      delete next.keys[id]; delete nextSession[id];
      if (remember) next.keys[id] = value.trim(); else nextSession[id] = value.trim();
      persist(next, nextSession);
      post({ type: "credentials/change", epoch: saved.epoch, id, ...(remember ? {} : { value: value.trim() }) });
      emit();
    });
  }
  async function receive(event: MessageEvent) {
    const message = object(event.data);
    if (message.type === "credentials/hello" && typeof message.nonce === "string") {
      await mutate(() => post({ type: "credentials/share", nonce: message.nonce, epoch: saved.epoch, keys: temporary }));
      return;
    }
    if (message.type === "credentials/forget") {
      await mutate(() => {
        if (message.epoch !== saved.epoch) return;
        persist(saved, temporary);
        if (!Object.keys(table()).length) asking?.finish(false);
        emit("forget");
      });
      return;
    }
    if (!["credentials/change", "credentials/share"].includes(String(message.type))) return;
    await mutate(() => {
      if (message.epoch !== saved.epoch) return;
      if (message.type === "credentials/share") {
        if (!asking || message.nonce !== asking.nonce) return;
        const shared = clean(message.keys);
        for (const id of Object.keys(saved.keys)) delete shared[id];
        persist(saved, { ...shared, ...temporary });
      } else {
        if (!validId(message.id)) return;
        const nextSession = { ...temporary };
        delete nextSession[message.id];
        if (typeof message.value === "string" && message.value.trim() && !Object.hasOwn(saved.keys, message.id))
          nextSession[message.id] = message.value.trim();
        persist(saved, nextSession);
      }
      emit();
    });
  }
  const onMessage = (event: MessageEvent) => { void receive(event).catch(() => {}); };
  channel?.addEventListener("message", onMessage);
  return {
    mode: (): "saved" | "session" | "empty" => Object.keys(saved.keys).length ? "saved" : Object.keys(temporary).length ? "session" : "empty",
    remembered: (id: string) => Object.hasOwn(saved.keys, id),
    key: (id: string) => validId(id)
      ? Object.hasOwn(temporary, id) ? temporary[id]! : Object.hasOwn(saved.keys, id) ? saved.keys[id]! : null
      : null,
    ids: () => Object.keys(table()),
    subscribe(fn: (event: VaultEvent) => void) { listeners.add(fn); return () => listeners.delete(fn); },
    reload() {
      return mutate(() => { persist(saved, temporary); emit(); });
    },
    resume() {
      return (resumePromise ??= (async () => {
        await mutate(() => {
          try {
            const raw = object(JSON.parse(session.getItem(names.sessionKeys) || "null"));
            // Current Koma session-only tables remain readable; no password or ciphertext conversion.
            temporary = raw.version === 1
              ? raw.epoch === saved.epoch ? clean(raw.keys) : {}
              : saved.epoch === "" ? clean(raw) : {};
            for (const id of Object.keys(saved.keys)) delete temporary[id];
          } catch { temporary = {}; }
          emit();
        });
        if (!channel || disposed) return Object.keys(table()).length > 0;
        return new Promise<boolean>((resolve) => {
          const nonce = crypto.randomUUID(), timer = setTimeout(() => asking?.finish(Object.keys(table()).length > 0), askMs);
          asking = { nonce, finish: answer => { clearTimeout(timer); asking = undefined; resolve(answer); } };
          post({ type: "credentials/hello", nonce });
        });
      })().finally(() => { resumePromise = undefined; }));
    },
    setKey: (id: string, value: string, remember = true) => change(id, value, remember),
    saveSession: (id: string, value: string) => change(id, value, false),
    removeKey(id: string) {
      return mutate(() => {
        const next = { ...saved, keys: { ...saved.keys } }, nextSession = { ...temporary };
        delete next.keys[id]; delete nextSession[id];
        persist(next, nextSession);
        post({ type: "credentials/change", epoch: saved.epoch, id });
        emit();
      });
    },
    async forget() {
      const clear = () => mutate(() => {
        persist({ version: 1, epoch: crypto.randomUUID(), keys: {} }, {});
        asking?.finish(false);
        post({ type: "credentials/forget", epoch: saved.epoch });
        emit("forget");
      });
      if (locks?.request) await locks.request(names.taskGate, { mode: "exclusive", signal: lifetime.signal }, clear);
      else await clear();
    },
    dispose() {
      disposed = true; lifetime.abort(); asking?.finish(false);
      channel?.removeEventListener("message", onMessage); listeners.clear();
      saved = { version: 1, epoch: "", keys: {} }; temporary = {};
    },
  };
}
export type Vault = ReturnType<typeof createVault>;
