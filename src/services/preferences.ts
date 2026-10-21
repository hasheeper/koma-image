import { names } from "../storage/names.ts";
import type { DataLease } from "./data-lease.ts";
export function createPreferences(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  data: DataLease,
) {
  const allowed = new Set<string>([
    names.preferences,
    names.chatSettings,
    names.chatCurrent,
    names.chatRail,
    names.tagCategories,
    names.tagCart,
    names.tagHandoff,
    names.ask,
    names.askAdult,
  ]);
  const listeners = new Set<(key?: string) => void>();
  const changed = (key?: string) => {
    for (const fn of listeners) fn(key);
  };
  const unregister = data.register({
    async flush() {},
    async reload() {
      changed();
    },
  });
  return {
    get<T>(key: string, fallback: T): T {
      if (!allowed.has(key)) throw new Error("偏好字段无效");
      try {
        return JSON.parse(storage.getItem(key) || "null") ?? fallback;
      } catch {
        return fallback;
      }
    },
    async set(key: string, value: unknown) {
      if (!allowed.has(key)) throw new Error("偏好字段无效");
      const text = JSON.stringify(value);
      await data.write(() => storage.setItem(key, text));
      changed(key);
    },
    async take<T>(key: string): Promise<T | null> {
      if (!allowed.has(key)) throw new Error("偏好字段无效");
      return data.write(() => {
        const text = storage.getItem(key);
        if (text) storage.removeItem(key);
        changed(key);
        try {
          return JSON.parse(text || "null") as T | null;
        } catch {
          return null;
        }
      });
    },
    changed(key?: string) {
      if (!key || allowed.has(key)) changed(key);
    },
    subscribe(fn: (key?: string) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      unregister();
      listeners.clear();
    },
  };
}
