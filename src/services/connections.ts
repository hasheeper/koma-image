import {
  emptyRouting,
  validateRouting,
  validateModelLinks,
  LOCAL_CONNECTION_ID,
  imageConnections,
} from "../config/connections.ts";
import { STANDARD_PROFILE_ID } from "../gateway/profile.ts";
import type { LocalGateway } from "../config/runtime.ts";
import type { Routing, Connection } from "../config/connections.ts";
import { freeze } from "../domain/value.ts";
import { names } from "../storage/names.ts";
import type { Writer } from "./data-lease.ts";

export interface ConnectionContext {
  readonly connection: Readonly<Connection>;
  readonly routing: Readonly<Routing>;
  readonly cacheKey: string;
  readonly credentialRevision: string;
  readonly localToken?: string;
  key(): string;
  assertCurrent(): void;
}
export interface ConnectionChange { refresh: boolean }
const endpointIdentity = (c: Connection) => JSON.stringify([c.id, c.baseUrl, c.profileId, c.credentialRef]);
export function createConnections(
  storage: Pick<Storage, "getItem" | "setItem">,
  write: Writer,
  local?: LocalGateway,
) {
  let routing = emptyRouting();
  let configurationEpoch = 0;
  // Credential material stays inside this service, never in Vue/configuration/cache keys.
  // M3's vault will supply unlocked material here and clear it on lock.
  const keys = new Map<string, { value: string; revision: string }>();
  const managed: Connection[] = local ? [
    ...(local.image !== false ? [{ id: LOCAL_CONNECTION_ID, name: "本地网关", baseUrl: local.baseUrl, profileId: STANDARD_PROFILE_ID, credentialRef: "local-server", revision: "local-runtime-v1" }] : []),
    ...(local.reasoning ?? []).map((profileId) => {
      const protocol = profileId === "openai-chat-v1" ? "openai" : "anthropic";
      return { id: `local-ask-${protocol}`, name: `本地 ASK · ${protocol === "openai" ? "OpenAI Chat" : "Anthropic Messages"}`, baseUrl: `${local.baseUrl}/ask/${protocol}`, profileId, credentialRef: `local-ask-${protocol}-server`, revision: "local-runtime-v1" };
    }),
  ].map((c) => Object.freeze(c)) : [];
  const managedConnections = () => Object.fromEntries(managed.map((c) => [c.id, c]));
  const listeners = new Set<(kind: "configuration" | "keys", change: ConnectionChange) => void>();
  const emit = (kind: "configuration" | "keys" = "keys", refresh = false) =>
    listeners.forEach((fn) => fn(kind, { refresh }));
  function catalogKey(id: string): string | null {
    const c = routing.connections[id];
    if (!c || (!local && !keys.has(c.credentialRef))) return null;
    return JSON.stringify([endpointIdentity(c), keys.get(c.credentialRef)?.revision ?? "local-runtime-v1"]);
  }
  const imageSignature = () => JSON.stringify(imageConnections(routing).map(c => [
    c.id, catalogKey(c.id), routing.links[c.id] ?? {},
  ]));
  function reload(refresh = true) {
    configurationEpoch++;
    try {
      if (local) {
        routing = {
          version: 1,
          connections: managedConnections(),
          links: {
            [LOCAL_CONNECTION_ID]: validateModelLinks(
              JSON.parse(storage.getItem(names.localModels) || "{}"),
            ),
          },
        };
      } else {
        const text = storage.getItem(names.routing);
        routing =
          text === null ? emptyRouting() : validateRouting(JSON.parse(text));
      }
    } catch {
      // Corrupt settings must not leave a stale address/key context usable.
      routing = local
        ? { version: 1, connections: managedConnections(), links: {} }
        : emptyRouting();
    }
    for (const ref of keys.keys())
      if (
        !Object.values(routing.connections).some((c) => c.credentialRef === ref)
      )
        keys.delete(ref);
    emit("configuration", refresh);
  }
  return {
    local: Boolean(local),
    hasCredential(credentialRef: string) {
      return (
        managed.some((c) => c.credentialRef === credentialRef) || keys.has(credentialRef)
      );
    },
    reload,
    catalogKey,
    get configuration() {
      return freeze(structuredClone(routing));
    },
    subscribe(fn: (kind: "configuration" | "keys", change: ConnectionChange) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Image work ignores text-only edits and display-name changes. */
    subscribeImages(fn: () => void) {
      let previous = imageSignature();
      const listener = (_kind: "configuration" | "keys", change: ConnectionChange) => {
        const next = imageSignature();
        if (change.refresh || next !== previous) {
          previous = next;
          fn();
        }
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async save(value: unknown) {
      const next = validateRouting(value);
      if (local) {
        if (
          Object.keys(next.connections).length !== managed.length ||
          managed.some((c) => (Object.keys(c) as (keyof Connection)[]).some((key) => next.connections[c.id]?.[key] !== c[key]))
        )
          throw new Error("本地连接由服务端环境变量管理");
        await write(() =>
          storage.setItem(
            names.localModels,
            JSON.stringify(next.links[LOCAL_CONNECTION_ID] || {}),
          ),
        );
        reload(false);
        return;
      }
      // Model availability, order and labels do not change an upstream catalog.
      // The configuration epoch still invalidates old execution snapshots.
      for (const c of Object.values(next.connections)) {
        const previous = routing.connections[c.id];
        c.revision = previous && endpointIdentity(previous) === endpointIdentity(c)
          ? previous.revision : crypto.randomUUID();
      }
      if (JSON.stringify(next) === JSON.stringify(routing)) return;
      await write(() => storage.setItem(names.routing, JSON.stringify(next)));
      reload(false);
    },
    supplyKey(credentialRef: string, value: string) {
      if (local) throw new Error("本地 Key 由服务端环境变量管理");
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
      if (!credential && !local) throw new Error("请先配置或解锁 API Key");
      const epoch = configurationEpoch;
      const connection = freeze(structuredClone(c)),
        snapshot = freeze(structuredClone(routing));
      const assertCurrent = () => {
        if (
          epoch !== configurationEpoch ||
          (!local &&
            keys.get(c.credentialRef)?.revision !== credential?.revision)
        )
          throw new Error("连接或 Key 已改变，请重新操作");
      };
      return Object.freeze({
        connection,
        routing: snapshot,
        credentialRevision: credential?.revision ?? "local-runtime-v1",
        ...(local ? { localToken: local.token } : {}),
        cacheKey: JSON.stringify([
          c.id,
          c.revision,
          epoch,
          credential?.revision ?? "local-runtime-v1",
        ]),
        assertCurrent,
        key() {
          assertCurrent();
          if (!credential) throw new Error("本地 Key 不向浏览器提供");
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
