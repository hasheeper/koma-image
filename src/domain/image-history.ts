import { hasOriginal } from './drawing.ts';
import type { HistoryRecord } from './drawing.ts';

/** Newest first. A failed thumbnail must never discard the only usable image. */
export function releaseHistoryOriginals(records: readonly HistoryRecord[], limit: number, protectedIds: ReadonlySet<string>): HistoryRecord[] {
  return records.map((record, index) => {
    if (!limit || index < limit || protectedIds.has(record.id) || !hasOriginal(record) || !record.thumbBlob?.size) return record;
    const { blob, ...metadata } = record;
    return { ...metadata, thumbBlob: record.thumbBlob, originalMime: blob.type };
  });
}
