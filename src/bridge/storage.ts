import type { ApplicationServices } from "../services/application.ts";
import type { Writer } from "../services/data-lease.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import type { Directory } from "./fs-driver.ts";
import type { InboxReceipt } from "./protocol.ts";
export interface Mount { readonly id: string; readonly handle: Directory }
export interface Received { readonly digest: string; readonly receipt: InboxReceipt }
export function bridgeStorage(services: ApplicationServices) {
  async function read<T>(key: string): Promise<T | undefined> {
    return idbRequest<T | undefined>(services.databases.transaction(names.databases.bridge, "state").objectStore("state").get(key));
  }
  function put(key: string, value: unknown, write: Writer = services.data.write) {
    return write(async () => {
      const tx = services.databases.transaction(names.databases.bridge, "state", "readwrite"), done = transactionDone(tx);
      tx.objectStore("state").put(value, key); await done;
    });
  }
  return { read, put,
    async register(handle: Directory): Promise<Mount> {
      return navigator.locks.request(names.bridgeRegistry, async () => {
        const all = await read<Mount[]>("directories") ?? [];
        for (const entry of all) if (await entry.handle.isSameEntry(handle).catch(() => false)) return entry;
        const entry = { id: crypto.randomUUID(), handle };
        await put("directories", [...all, entry]); return entry;
      });
    },
    received: (context: string, id: string) => read<Received>(`receipt:${context}:${id}`),
    receipt: (context: string, receipt: InboxReceipt, digest: string, write?: Writer) => put(`receipt:${context}:${receipt.draft_id}`, { digest, receipt } satisfies Received, write),
  };
}
