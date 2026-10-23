import { idbRequest, transactionDone } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import type { ApplicationServices } from "../services/application.ts";
import type { Writer } from "../services/data-lease.ts";
import type { ConversationOrigin } from "./conversations.ts";
import type { SavedAttachment } from "./attachments.ts";
import type { IdSnapshot } from "./ids.ts";
import type { SessionSnapshot } from "./session.ts";
import type { AskEntry } from "./service.ts";
import type { Draft } from "./draft/types.ts";

/** No credentials, call-debug bodies, live object URLs or undo receipts. */
export interface SavedConversation {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly named: boolean;
  readonly origin: ConversationOrigin | null;
  readonly createdAt: number;
  readonly scope: { readonly id: string; readonly labels: IdSnapshot };
  readonly session: SessionSnapshot;
  readonly entries: readonly AskEntry[];
  readonly input: string;
  readonly anchor: string | null;
  readonly tray: readonly string[];
  readonly attachments: readonly SavedAttachment[];
  readonly draft: { readonly value: Draft; readonly off: readonly string[]; readonly turnId: number } | null;
}

/** Per-record writes: changing one favorite must not replace another tab's collection. */
export function createAskFavorites(services: ApplicationServices) {
  return {
    async read(): Promise<SavedConversation[]> {
      const tx = services.databases.transaction(names.databases.ask, "conversations");
      const rows = await idbRequest<SavedConversation[]>(tx.objectStore("conversations").getAll());
      if (rows.some(row => row.version !== 1)) throw new Error("收藏会话版本不受支持");
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },
    async write(records: readonly SavedConversation[], remove: readonly string[], write: Writer = services.data.write) {
      if (!records.length && !remove.length) return;
      await write(async () => {
        const tx = services.databases.transaction(names.databases.ask, "conversations", "readwrite");
        const done = transactionDone(tx), store = tx.objectStore("conversations");
        for (const id of remove) store.delete(id);
        for (const record of records) store.put(record);
        await done;
      });
    },
  };
}
