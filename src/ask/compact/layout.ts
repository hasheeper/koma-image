import type { AskMessage } from "../messages.ts";
import type { CommittedTurn, LedgerEntry, TurnId } from "./ledger.ts";
import type { AttachmentIndex } from "./archive.ts";
import { canonical } from "../canonical.ts";
import { dataText } from "../prompts/index.ts";
import { compactionPrompt } from "../prompts/compaction.ts";

export interface SessionMemory {
  readonly through: TurnId;
  readonly memo: string;
  /** Frozen sending bytes, rebuilt only after a successful compaction. */
  readonly text: string;
}
const block = (name: string, value: unknown) => `<${name}>\n${dataText(typeof value === "string" ? value : canonical(value))}\n</${name}>`;
const recentUser = (archived: readonly CommittedTurn[]) => block("recent_user", archived.slice(-3).map(t => ({ turnId: t.turnId, text: t.question })));
function boundaryData(archived: readonly CommittedTurn[], ledger: readonly LedgerEntry[], attachments: readonly AttachmentIndex[]) {
  if (!archived.length) throw new Error("没有可归档的成功轮次");
  const ids = new Set(archived.map(t => t.turnId));
  return [block("ledger", ledger.filter(e => ids.has(e.turnId))),
    block("attachments", attachments.filter(a => ids.has(a.turnId))), recentUser(archived)].join("\n");
}
export function buildMemory(archived: readonly CommittedTurn[], ledger: readonly LedgerEntry[], attachments: readonly AttachmentIndex[], memo: string): SessionMemory {
  const content = boundaryData(archived, ledger, attachments);
  return { through: archived.at(-1)!.turnId, memo,
    text: `<session_memory>\n${content}\n${block("memo", memo)}\n</session_memory>` };
}
export function memoryMessages(memory: SessionMemory | null): AskMessage[] {
  return memory ? [{ role: "user", kind: "session_memory", content: [{ type: "text", text: memory.text }] },
    { role: "assistant", content: [{ type: "text", text: "已接续。" }] }] : [];
}
/** Appended after unchanged history. Pending input/attachments are not accepted here. */
export function compactionTail(archived: readonly CommittedTurn[], retained: readonly CommittedTurn[], ledger: readonly LedgerEntry[], attachments: readonly AttachmentIndex[]): AskMessage {
  const data = boundaryData(archived, ledger, attachments);
  return { role: "user", content: [{ type: "text", text: [compactionPrompt.instruction,
    block("archive_boundary", { through: archived.at(-1)!.turnId, archive: archived.map(t => t.turnId), retained_verbatim: retained.map(t => t.turnId) }), data].join("\n\n") }] };
}
