import { names } from "./names.ts";

export const schemas = [
  { name: names.databases.slate, version: 1, stores: [{ name: "state", keyPath: undefined }, { name: "assets", keyPath: "id" }] },
  { name: names.databases.favorites, version: 2, stores: [{ name: "favorites", keyPath: "id" }, { name: "referenceAssets", keyPath: "id" }, { name: "vibeEncodings", keyPath: "id" }] },
  { name: names.databases.chat, version: 1, stores: [{ name: "conversations", keyPath: "id" }, { name: "assets", keyPath: "id" }] },
  { name: names.databases.handoff, version: 1, stores: [{ name: "items", keyPath: undefined }] },
  { name: names.databases.ask, version: 1, stores: [{ name: "conversations", keyPath: "id" }] },
  { name: names.databases.bridge, version: 1, stores: [{ name: "state", keyPath: undefined }] },
] as const;
export const idbRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export const transactionDone = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error ?? new DOMException("保存被中断", "AbortError"));
});
async function open(factory: IDBFactory, schema: typeof schemas[number]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(schema.name, schema.version);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const store of schema.stores) if (!request.result.objectStoreNames.contains(store.name)) {
        request.result.createObjectStore(store.name, store.keyPath ? { keyPath: store.keyPath } : undefined);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close(); else resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("存储正被其他页面占用，请关闭后重试")); };
  });
}
export async function openDatabases(factory: IDBFactory) {
  const handles = new Map<string, IDBDatabase>();
  try {
    for (const schema of schemas) handles.set(schema.name, await open(factory, schema));
  } catch (error) { for (const db of handles.values()) db.close(); throw error; }
  return {
    /** Keep related chat records and image assets inside one transaction. */
    transaction(database: typeof schemas[number]["name"], stores: string | string[], mode: IDBTransactionMode = "readonly") {
      const db = handles.get(database);
      if (!db) throw new Error("数据存储已关闭");
      return db.transaction(stores, mode);
    },
    close() { for (const db of handles.values()) db.close(); handles.clear(); },
  };
}
