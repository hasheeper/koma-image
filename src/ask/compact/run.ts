import type { Session, SessionData } from "../session.ts";
import type { AskRequest, AskStop, AskUsage } from "../messages.ts";
import { ProviderError } from "../messages.ts";
import type { createProvider, ProviderTrace } from "../provider.ts";
import type { Codec } from "../codec.ts";
import type { AttachmentReader } from "./archive.ts";
import { attachmentIndex } from "./archive.ts";
import { archiveCount, DEFAULT_HIGH_WATER } from "./trigger.ts";
import { compactionTail } from "./layout.ts";
import { extractCompletedMemo } from "./validate.ts";

export interface CompactionOptions {
  readonly session: Session;
  readonly provider: Pick<ReturnType<typeof createProvider>, "stream">;
  readonly request: Pick<AskRequest, "model" | "system" | "tools">;
  readonly codec?: Codec;
  readonly signal: AbortSignal;
  readonly attachments: AttachmentReader;
  readonly metadataOnly?: boolean;
  readonly highWaterTokens?: number;
  readonly observe?: (event: ProviderTrace) => void;
  /** Must honor cancellation until its durable commit. Resolution is the commit point. */
  readonly persist?: (candidate: SessionData, signal: AbortSignal) => Promise<void>;
}

/** One model call, no tool execution/retry, no pending input or workspace write ports. */
export async function runCompaction(options: CompactionOptions) {
  const { session, signal } = options;
  signal.throwIfAborted();
  const count = archiveCount(session.retained, options.highWaterTokens ?? DEFAULT_HIGH_WATER,
    session.ledger.filter(e => e.draft?.status === "pending").map(e => e.turnId));
  if (!count) return { status: "skipped" as const };
  const tx = session.beginCompaction(options.metadataOnly);
  let observedUsage: AskUsage | null = null, charged = false;
  try {
    const archived = [...tx.archive, ...tx.retained.slice(0, count)];
    const tail = compactionTail(archived, tx.retained.slice(count), tx.ledger, attachmentIndex(archived, options.attachments));
    const request: AskRequest = { model: options.request.model, tools: options.request.tools, system: options.request.system,
      maxTokens: 8192, messages: [...tx.messages, tail] };
    let text = "", stop: AskStop = "other", completed = false, hasTools = false;
    for await (const event of options.provider.stream(request, { codec: options.codec, signal, allowEmpty: true, observe(event) {
      if (event.type === "response") observedUsage = event.usage;
      options.observe?.(event);
    } })) {
      if (event.type === "done") {
        session.recordUsage(event.usage); charged = true; stop = event.stop; completed = true;
      } else if (event.type === "text") text += event.text;
      else hasTools = true;
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
    if (!completed) throw new ProviderError("network", "压缩响应未完整结束");
    // The provider has already decoded the memo using this request's codec.
    const memo = extractCompletedMemo(text, stop, hasTools);
    const candidate = tx.candidate(count, memo, options.attachments);
    signal.throwIfAborted();
    if (options.persist) await options.persist(candidate, signal);
    // A durable save that completed before a late stop is already committed.
    // No await or cancellation boundary may split durable and in-memory state.
    tx.commit(candidate);
    return { status: "compacted" as const, memory: candidate.memory, archived: candidate.archive.length };
  } catch (error) {
    tx.rollback();
    throw error;
  } finally {
    // Refusals/transport failures can be observed before the provider throws,
    // without yielding a done event. Their reported bill still belongs here.
    if (!charged) session.recordUsage(observedUsage);
  }
}
