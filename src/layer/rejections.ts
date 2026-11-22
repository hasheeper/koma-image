import { fitSize } from '../ask/vision.ts';
import { placeOnCanvas, png } from './images.ts';
import type { LayerProject, Raster } from './project.ts';
import type { SplitSource } from './recursive.ts';

type Reason = 'discarded_candidate' | 'deleted_layer';
export interface GenerationRound {
  number: number;
  source: SplitSource['kind'] | 'scalpel';
  target: string;
  model: string;
  candidateIds: string[];
  rejected: { id: string; name: string; width: number; height: number; reason: Reason; preview: Blob }[];
}

export function addGeneration(p: LayerProject, info: Omit<GenerationRound, 'number' | 'rejected'>) {
  const rounds = p.generationRounds ?? [];
  return [...rounds.slice(-2), { ...info, number: (rounds.at(-1)?.number ?? 0) + 1, rejected: [] }];
}

export interface RejectionChange {
  items: { id: string; name: string; preview: Raster }[];
  reason: Reason;
}

/** Always edit the original generation, including when a different batch is open or an action is redone. */
export function changeRejections(rounds: GenerationRound[] | undefined, change?: RejectionChange, undo = false) {
  if (!change?.items.length || !rounds?.length) return rounds;
  const byId = new Map(change.items.map(item => [item.id, item]));
  return rounds.map(round => {
    if (!round.candidateIds.some(id => byId.has(id))) return round;
    const rejected = round.rejected.filter(entry => !byId.has(entry.id));
    if (!undo) {
      for (const id of round.candidateIds) {
        const item = byId.get(id);
        if (!item) continue;
        const { width, height } = item.preview;
        const size = fitSize(width, height, 512);
        const preview = placeOnCanvas(item.preview, { x: 0, y: 0, ...size }, size.width, size.height);
        rejected.push({ id, name: item.name, width, height, reason: change.reason, preview: png(preview) });
      }
    }
    return { ...round, rejected };
  });
}
