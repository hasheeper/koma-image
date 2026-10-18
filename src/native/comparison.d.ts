import type { ImageRecord, DrawingParams } from "../domain/drawing";
export function makeComparison(
  records: ImageRecord[],
  base: DrawingParams,
  signal?: AbortSignal,
): Promise<{ blob: Blob; size: { width: number; height: number } }>;
