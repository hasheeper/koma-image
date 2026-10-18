import { emptyRouting, validateRouting } from "../config/connections.ts";
import type { Routing, Connection } from "../config/connections.ts";
import { freeze } from "../domain/value.ts";
import { names } from "../storage/names.ts";
import type { Writer } from "./data-lease.ts";

export interface ConnectionContext {
  readonly connection: Readonly<Connection>;
  readonly routing: Readonly<Routing>;
  readonly cacheKey: string;
  readonly credentialRevision: string;
  key(): string;
  assertCurrent(): void;
}
export function createConnections(
  storage: Pick<Storage, "getItem" | "setItem">,
  write: Writer,
) {
  let routing = emptyRouting();
  let configurationEpoch = 0;
  // Credential material stays inside this service, never in Vue/configuration/cache keys.
  // M3's vault will supply unlocked material here and clear it on lock.
  const keys = new Map<string, { value: string; revision: string }>();
  const listeners = new Set<(kind: "configuration" | "keys") => void>();
  const emit = (kind: "configuration" | "keys" = "keys") =>
    listeners.forEach((fn) => fn(kind));
  function reload() {
    configurationEpoch++;
    try {
      const text = storage.getItem(names.routing);
      routing =
        text === null ? emptyRouting() : validateRouting(JSON.parse(text));
    } catch {
      // Corrupt settings must not leave a stale address/key context usable.
      routing = emptyRouting();
    }
    for (const ref of keys.keys())
      if (
        !Object.values(routing.connections).some((c) => c.credentialRef === ref)
      )
        keys.delete(ref);
    emit("configuration");
  }
  return {
    reload,
    get configuration() {
      return freeze(structuredClone(routing));
    },
    subscribe(fn: (kind: "configuration" | "keys") => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async save(value: unknown) {
      const next = validateRouting(value);
      // A new config revision isolates every catalog/quote cache after edits.
      for (const c of Object.values(next.connections))
        c.revision = crypto.randomUUID();
      await write(() => storage.setItem(names.routing, JSON.stringify(next)));
      reload();
    },
    supplyKey(credentialRef: string, value: string) {
      if (
        !Object.values(routing.connections).some(
          (c) => c.credentialRef === credentialRef,
        )
      )
        throw new Error("连接不存在");
      // An empty settings field must never erase an existing key.
      if (!value.trim()) return;
      if (keys.get(credentialRef)?.value === value.trim()) return;
      keys.set(credentialRef, {
        value: value.trim(),
        revision: crypto.randomUUID(),
      });
      emit();
    },
    clearKey(credentialRef: string) {
      if (keys.delete(credentialRef)) emit();
    },
    lock() {
      keys.clear();
      emit();
    },
    context(id: string): ConnectionContext {
      const c = Object.hasOwn(routing.connections, id)
        ? routing.connections[id]
        : undefined;
      if (!c) throw new Error("请先配置连接 URL 与 Key");
      const credential = keys.get(c.credentialRef);
      if (!credential) throw new Error("请先配置或解锁 API Key");
      const epoch = configurationEpoch;
      const connection = freeze(structuredClone(c)),
        snapshot = freeze(structuredClone(routing));
      const assertCurrent = () => {
        if (
          epoch !== configurationEpoch ||
          keys.get(c.credentialRef)?.revision !== credential.revision
        )
          throw new Error("连接或 Key 已改变，请重新操作");
      };
      return Object.freeze({
        connection,
        routing: snapshot,
        credentialRevision: credential.revision,
        cacheKey: JSON.stringify([
          c.id,
          c.revision,
          epoch,
          credential.revision,
        ]),
        assertCurrent,
        key() {
          assertCurrent();
          return credential.value;
        },
      });
    },
    dispose() {
      keys.clear();
      listeners.clear();
    },
  };
}
