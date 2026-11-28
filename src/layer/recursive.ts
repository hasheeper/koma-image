import {
  crop,
  type LayerProject,
  type PoolLayer,
  type Raster,
  type Rect,
  type StackLayer,
} from './project.ts';
import { admitPoolLayers, compositeLayers } from './stack.ts';

export interface SplitSource {
  kind: 'master' | 'layers' | 'region';
  name: string;
  rect: Rect;
  members: { id: string; signature: string }[];
}

export interface DecomposeBatch {
  id: string;
  projectId?: string;
  sentSize?: { width: number; height: number };
  requestedSize?: string;
  inputDownscaled?: boolean;
  inputUpscale?: string;
  responseSize?: { width: number; height: number };
  model: string;
  route: string;
  prompt: string;
  maxImages?: number;
  targetName: string;
  /** A single new part inferred from these references, inserted behind the frontmost one. */
  componentName?: string;
  insertAbove?: string;
  groupName?: string;
  source: SplitSource;
  layers: PoolLayer[];
  /** Bottom-to-top candidate IDs, including parts already admitted from this batch. */
  order?: string[];
}

export function candidateOrder(batch: DecomposeBatch, stack: readonly StackLayer[]): string[] {
  if (batch.order) return batch.order;
  // Older checkpoints only contain provider depths and the remaining candidate rasters.
  const admitted = stack.filter(l => l.batchId === batch.id && l.candidateId && !l.archived)
    .map(l => ({ id: l.candidateId!, zIndex: l.candidateZ ?? 0 }));
  return [...admitted, ...batch.layers].sort((a, b) => a.zIndex - b.zIndex).map(l => l.id);
}

export function moveCandidate(order: string[], from: string, to: string): string[] {
  const start = order.indexOf(from), end = order.indexOf(to);
  if (start < 0 || end < 0 || start === end) return order;
  const next = order.slice();
  next.splice(start, 1);
  next.splice(end, 0, from);
  return next;
}

/** Insert into the existing stack without re-sorting manually arranged formal layers. */
export function insertSplitCandidates(stack: StackLayer[], incoming: StackLayer[], batch: DecomposeBatch, slot: number) {
  const rank = new Map(candidateOrder(batch, stack).map((id, i) => [id, i]));
  const depth = (l: StackLayer) => rank.get(l.candidateId ?? '') ?? l.candidateZ ?? 0;
  const siblings = stack.filter(l => l.batchId === batch.id && !l.archived && l.candidateId);
  const end = siblings.length ? stack.indexOf(siblings[siblings.length - 1]) + 1 : slot;
  const result = stack.slice();
  // Insert front-to-back so original insertion indices stay valid.
  for (const layer of [...incoming].sort((a, b) => depth(a) - depth(b)).reverse()) {
    const above = siblings.find(l => depth(l) > depth(layer));
    result.splice(above ? stack.indexOf(above) : end, 0, layer);
  }
  return result;
}

function signature(l: StackLayer) {
  let hash = 2166136261;
  for (const byte of l.pixels) hash = Math.imul(hash ^ byte, 16777619);
  return JSON.stringify([l.x, l.y, l.width, l.height, l.groups, l.groupIds, hash]);
}

export function splitSource(p: LayerProject, ids: string[] = [], region?: Rect): SplitSource {
  const layers = p.layers.filter((l) => ids.includes(l.id));
  if (layers.length !== new Set(ids).size || layers.some((l) => l.archived))
    throw new Error('请重新选择要细拆的正式层');
  let rect: Rect = { x: 0, y: 0, width: p.reference.width, height: p.reference.height };
  if (region) {
    const x = Math.max(0, Math.round(region.x)),
      y = Math.max(0, Math.round(region.y));
    rect = {
      x,
      y,
      width: Math.min(rect.width, Math.round(region.x + region.width)) - x,
      height: Math.min(rect.height, Math.round(region.y + region.height)) - y,
    };
    if (rect.width <= 0 || rect.height <= 0) throw new Error('请在母版上框选要细拆的部位');
  } else if (layers.length) {
    const x = Math.min(...layers.map((l) => l.x)),
      y = Math.min(...layers.map((l) => l.y));
    rect = {
      x,
      y,
      width: Math.max(...layers.map((l) => l.x + l.width)) - x,
      height: Math.max(...layers.map((l) => l.y + l.height)) - y,
    };
  }
  return {
    kind: region ? 'region' : layers.length ? 'layers' : 'master',
    name: region ? '母版局部' : layers.map((l) => l.name).join(' + ') || '全身',
    rect,
    members: layers.map((l) => ({ id: l.id, signature: signature(l) })),
  };
}

export function splitInput(p: LayerProject, source: SplitSource): Raster {
  if (source.kind === 'master') return p.reference;
  if (source.kind === 'region') return crop(p.reference, source.rect);
  const selected = source.members.map((m) => p.layers.find((l) => l.id === m.id)!);
  if (selected.length === 1)
    return { width: selected[0].width, height: selected[0].height, data: selected[0].pixels };
  const local = selected.map((l) => ({ ...l, x: l.x - source.rect.x, y: l.y - source.rect.y }));
  return compositeLayers(local, source.rect.width, source.rect.height, { includeHidden: true });
}

export function insertMissingComponent(stack: StackLayer[], part: StackLayer, source: SplitSource) {
  if (source.kind === 'master') return [...stack, part];
  const index = stack.findIndex(l => l.id === source.members.at(-1)?.id);
  if (index < 0) throw new Error('参考图层已变化，请重新选择');
  const { groups, groupIds, mutedGroups } = stack[index];
  return [...stack.slice(0, index), { ...part, groups, groupIds, mutedGroups }, ...stack.slice(index)];
}

export function admitSplit(
  p: LayerProject,
  batch: DecomposeBatch,
  picked: readonly PoolLayer[],
  archive: boolean,
): LayerProject {
  if (batch.projectId && batch.projectId !== p.id) throw new Error('候选属于另一个分件项目');
  if (picked.some((l) => l.needsPosition)) throw new Error('请先确认待定位裁片的原画布坐标');
  const fresh = picked.filter((l) => !p.layers.some((existing) => existing.candidateId === l.id));
  if (!fresh.length) throw new Error('这些候选已经收纳');
  const source = batch.source;
  const parents = p.layers.filter((l) => source.members.some((m) => m.id === l.id));
  if (
    parents.length !== source.members.length ||
    parents.some(
      (l, i) =>
        l.id !== source.members[i].id ||
        (!l.archived && signature(l) !== source.members[i].signature) ||
        (l.archived && l.batchId !== batch.id),
    )
  )
    throw new Error('来源层已变化，请重新选择来源并细拆。候选仍保留。');
  if (batch.componentName) {
    if (fresh.length !== 1 || fresh[0].isBase || parents.some(l => l.archived))
      throw new Error('请选择一个独立部件候选，并保留参考图层');
    const [part] = admitPoolLayers({ ...p, layers: [] }, [{ ...fresh[0], name: batch.componentName }]).layers;
    return { ...p, layers: insertMissingComponent(p.layers, part, source), activeLayerId: part.id };
  }
  if (archive && parents.some((l) => l.locked && !l.archived))
    throw new Error('来源层已锁定，可选仅添加或先解锁');
  const accepted = admitPoolLayers({ ...p, layers: [] }, fresh).layers;
  const anchor =
    parents.at(-1) ??
    (source.kind === 'region' && batch.insertAbove
      ? p.layers.find((l) => l.id === batch.insertAbove && !l.archived)
      : undefined);
  if (source.kind === 'region' && batch.insertAbove && !anchor)
    throw new Error('入栈位置已变化，请重新指定结果组位置');
  const group = source.kind !== 'master';
  const existing = p.layers.find((l) => l.batchId === batch.id && !l.archived);
  const path = existing?.groups ?? [...(anchor?.groups ?? []), batch.groupName?.trim() || source.name];
  const keys = existing?.groupIds ?? [...(anchor?.groupIds ?? anchor?.groups ?? []), batch.id];
  const incoming: StackLayer[] = accepted.map((l) => ({
    ...l,
    batchId: batch.id,
    ...(group
      ? { groups: path, groupIds: keys, mutedGroups: existing?.mutedGroups ?? anchor?.mutedGroups }
      : {}),
  }));
  const updated = p.layers.map((l) =>
    parents.includes(l) && archive && !l.archived
      ? {
          ...l,
          visible: false,
          archived: true,
          archiveOrigin: {
            batchId: l.batchId,
            groups: l.groups,
            groupIds: l.groupIds,
            visible: l.visible,
            index: p.layers.indexOf(l),
          },
          batchId: batch.id,
          groups: path,
          groupIds: keys,
        }
      : l,
  );
  const siblings = updated.filter((l) => l.batchId === batch.id && !l.archived);
  let slot = anchor ? updated.findIndex((l) => l.id === anchor.id) + 1 : updated.length;
  if (siblings.length) slot = updated.indexOf(siblings[0]);
  const originals = updated.filter((l) => l.archived && l.batchId === batch.id);
  const stationary = (l: StackLayer) => !originals.includes(l);
  const before = updated.slice(0, slot).filter(stationary);
  const after = updated.slice(slot).filter(stationary);
  const layers = insertSplitCandidates([...before, ...originals, ...after], incoming, batch, before.length + originals.length);
  return {
    ...p,
    layers,
    activeLayerId: layers.filter(l => incoming.includes(l)).at(-1)?.id,
  };
}
