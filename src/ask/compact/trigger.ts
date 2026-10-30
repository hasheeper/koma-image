import type { AskUsage, AskMessage } from "../messages.ts";
import type { TurnId } from "./ledger.ts";
import { estimateRequest } from "../session.ts";

export const DEFAULT_HIGH_WATER = 220_000;
export const highWater = (value?: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_HIGH_WATER;
/** Normalized input already includes Anthropic cache read/creation counts. */
export const validInputTokens = (usage: AskUsage | null) => usage && Number.isFinite(usage.input) && usage.input > 0 ? usage.input : null;
type SizedTurn = { readonly turnId: TurnId; readonly messages: readonly AskMessage[] };
/** A contiguous prefix only: a pending draft protects its entire suffix. */
export function archiveCount(turns: readonly SizedTurn[], threshold = DEFAULT_HIGH_WATER, pending: readonly TurnId[] = []) {
  let keep = Math.min(3, turns.length);
  const estimate = (n: number) => estimateRequest({ tools: [], system: ["", ""], messages: turns.slice(-n).flatMap(t => t.messages) });
  while (keep > 1 && estimate(keep) > highWater(threshold) * .4) keep--;
  let boundary = Math.max(0, turns.length - keep);
  turns.forEach((t, i) => { if (pending.includes(t.turnId)) boundary = Math.min(boundary, i); });
  return boundary;
}
export function shouldCompact(input: {
  readonly lastInputTokens: number | null;
  readonly totalTurns: number;
  readonly turnsSinceCompaction: number;
  readonly archiveCount: number;
  readonly highWaterTokens?: number;
  readonly manual?: boolean;
  /** Supplied once, only after an archive-area edit/fork reconstructed raw history. */
  readonly archiveRebuild?: { readonly estimatedTokens: number };
}) {
  if (input.archiveCount < 1) return false;
  if (input.archiveRebuild) return Number.isFinite(input.archiveRebuild.estimatedTokens)
    && input.archiveRebuild.estimatedTokens > highWater(input.highWaterTokens);
  if (input.totalTurns < 4) return false;
  if (input.manual) return true;
  return input.turnsSinceCompaction >= 4 && input.lastInputTokens !== null
    && Number.isFinite(input.lastInputTokens) && input.lastInputTokens >= highWater(input.highWaterTokens);
}
