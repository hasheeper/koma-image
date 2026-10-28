import { idbRequest, transactionDone } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import type { ApplicationServices } from "../services/application.ts";
import type { Writer } from "../services/data-lease.ts";
import type { ConversationOrigin } from "./conversations.ts";
import type { SavedAttachment } from "./attachments.ts";
import type { IdSnapshot } from "./ids.ts";
import type { SessionSnapshot } from "./session.ts";
import { createSession } from "./session.ts";
import type { AskUsage } from "./messages.ts";
import { dataText } from "./prompts/index.ts";
import type { AskEntry } from "./service.ts";
import type { Draft } from "./draft/types.ts";

/** No credentials, call-debug bodies, live object URLs or undo receipts. */
export interface SavedConversation {
  readonly version: 1;
  readonly slateId?: string | null;
  readonly id: string;
  readonly title: string;
  readonly named: boolean;
  readonly origin: ConversationOrigin | null;
  readonly createdAt: number;
  readonly scope: { readonly id: string; readonly labels: IdSnapshot; readonly attachmentCounters?: { images:number; texts:number } };
  readonly session: SessionSnapshot;
  readonly entries: readonly AskEntry[];
  readonly input: string;
  readonly anchor: string | null;
  readonly tray: readonly string[];
  readonly attachments: readonly SavedAttachment[];
  readonly externalQueue?: readonly { readonly value: Draft; readonly turnId: number }[];
  readonly draft: { readonly value: Draft; readonly off: readonly string[]; readonly turnId: number } | null;
}

/** Missing CP1 fields in existing Koma favorites come from their saved UI rows.
 * The old composer had a fixed layout: state, images, text attachments, question.
 * Attribute those slots without matching filenames or searching body substrings.
 */
export function restoreSavedSession(record: SavedConversation, total?: (usage: AskUsage) => void) {
  const turns = record.session.turns.map((turn, i) => {
    if (turn.attachments !== undefined) return turn;
    const entry = record.entries.find(e => e.type === "turn" && e.turn.committed === (record.session.archive?.length ?? 0) + i + 1);
    if (entry?.type !== "turn") return turn;
    const ids = entry.turn.attachments.map(a => a.id), texts = ids.flatMap(id => {
      const a = record.attachments.find(a => a.id === id); return a?.kind === "text" ? [a] : [];
    });
    const first = turn.messages[0], start = first.content.length - texts.length - 1;
    return { ...turn, question: entry.turn.question, attachments: ids,
      messages: [{ ...first, content: first.content.map((b, index) => {
        const a = texts[index - start];
        return b.type === "text" && a ? { ...b, source: { kind: "attachment" as const, id: a.id,
          heading: dataText(`附件 · ${a.name} · ${a.text.length} 字`) } } : b;
      }) }, ...turn.messages.slice(1)] };
  });
  return createSession(total, turns, record.session.usage, record.session.nextTurnId, record.session);
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
    async write(records: readonly SavedConversation[], remove: readonly string[], write: Writer = services.data.write, signal?: AbortSignal) {
      if (!records.length && !remove.length) return;
      signal?.throwIfAborted();
      await write(async () => {
        signal?.throwIfAborted();
        const tx = services.databases.transaction(names.databases.ask, "conversations", "readwrite");
        const done = transactionDone(tx), store = tx.objectStore("conversations");
        const abort = () => { try { tx.abort(); } catch { /* Already durably completed. */ } };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          for (const id of remove) store.delete(id);
          for (const record of records) store.put(record);
          await done;
        } catch (error) {
          abort(); await done.catch(() => {});
          throw signal?.aborted ? signal.reason : error;
        } finally { signal?.removeEventListener("abort", abort); }
      });
    },
  };
}
