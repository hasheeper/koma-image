import type { ApplicationServices } from "../services/application.ts";
import type { Writer } from "../services/data-lease.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import { readWhileMounted, type Directory } from "./fs-driver.ts";
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
    clearActive(id: string) {
      return services.data.write(async () => {
        const tx = services.databases.transaction(names.databases.bridge, "state", "readwrite"), done = transactionDone(tx);
        const state = tx.objectStore("state"), request = state.get("active");
        request.onsuccess = () => { if ((request.result as Mount | undefined)?.id === id) state.delete("active"); };
        await done;
      });
    },
    async register(handle: Directory, signal: AbortSignal): Promise<Mount> {
      return navigator.locks.request(names.bridgeRegistry, { signal }, async () => {
        const all = await readWhileMounted(signal, () => read<Mount[]>("directories")) ?? [];
        // A broken old handle must not delay a positive match from another one.
        // Only an explicit mismatch from every handle permits a new identity.
        const different = Symbol("different directory");
        const known = await readWhileMounted(signal, () => Promise.any(all.map(async entry => {
          if (await entry.handle.isSameEntry(handle)) return entry;
          throw different;
        })).catch((e: unknown) => {
          if (e instanceof AggregateError && e.errors.every(reason => reason === different)) return null;
          throw e;
        }));
        const entry = { id: known?.id ?? crypto.randomUUID(), handle };
        await services.data.write(async () => {
          signal.throwIfAborted();
          const tx = services.databases.transaction(names.databases.bridge, "state", "readwrite"), done = transactionDone(tx);
          const cancel = () => {
            try { tx.abort(); } catch (e) {
              if (!(e instanceof DOMException && e.name === "InvalidStateError")) throw e;
            }
          };
          signal.addEventListener("abort", cancel, { once: true });
          try {
            const state = tx.objectStore("state");
            if (!known) state.put([...all, entry], "directories");
            state.put(entry, "active");
            await done;
          } finally { signal.removeEventListener("abort", cancel); }
        });
        return entry;
      });
    },
    received: (context: string, id: string) => read<Received>(`receipt:${context}:${id}`),
    receipt: (context: string, receipt: InboxReceipt, digest: string, write?: Writer) => put(`receipt:${context}:${receipt.draft_id}`, { digest, receipt } satisfies Received, write),
  };
}
