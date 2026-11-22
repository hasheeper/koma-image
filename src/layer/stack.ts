import { layerVisible } from './project.ts';
import {
  alphaBounds,
  crop,
  type LayerProject,
  type PoolLayer,
  type Raster,
  type Rect,
  type RGB,
  type StackLayer,
  type ToneMatch,
} from './project.ts';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const quantile = (sorted: number[], q: number) => sorted[Math.floor((sorted.length - 1) * q)];

/** Concentric radial soft/hard brush coverage in [0, 1]. */
export function brushCoverage(distance: number, radius: number, hardness: number): number {
  const edge = clamp(radius - distance + 0.5, 0, 1);
  if (hardness >= 1) return edge;
  const denom = Math.max(0.001, radius * (1 - hardness));
  const t = clamp((radius - distance) / denom, 0, 1);
  return edge * t * t * (3 - 2 * t);
}

/** Trim transparent borders of a StackLayer while keeping its canvas coordinates and auxiliary planes aligned. */
export function trimLayer(layer: StackLayer): StackLayer | null {
  const box = alphaBounds({ width: layer.width, height: layer.height, data: layer.pixels });
  if (!box) return null;
  if (box.x === 0 && box.y === 0 && box.width === layer.width && box.height === layer.height) {
    return layer;
  }
  const trimPlane = (plane: Uint8Array, channels: number) => {
    const out = new Uint8Array(box.width * box.height * channels);
    for (let y = 0; y < box.height; y++) {
      const src = ((box.y + y) * layer.width + box.x) * channels;
      out.set(plane.subarray(src, src + box.width * channels), y * box.width * channels);
    }
    return out;
  };
  return {
    ...layer,
    x: layer.x + box.x,
    y: layer.y + box.y,
    width: box.width,
    height: box.height,
    pixels: trimPlane(layer.pixels, 4),
    rawPixels: layer.rawPixels ? trimPlane(layer.rawPixels, 4) : undefined,
    restoredMask: layer.restoredMask ? trimPlane(layer.restoredMask, 1) : undefined,
  };
}

/** Expand a layer's bounding box to cover `target` (in reference coordinates) without losing existing pixels. */
function expandLayerTo(layer: StackLayer, target: Rect): StackLayer {
  const left = Math.min(layer.x, target.x);
  const top = Math.min(layer.y, target.y);
  const right = Math.max(layer.x + layer.width, target.x + target.width);
  const bottom = Math.max(layer.y + layer.height, target.y + target.height);
  const width = right - left;
  const height = bottom - top;
  if (left === layer.x && top === layer.y && width === layer.width && height === layer.height) {
    return layer;
  }
  const ox = layer.x - left;
  const oy = layer.y - top;
  const grow = (plane: Uint8Array, channels: number) => {
    const out = new Uint8Array(width * height * channels);
    for (let y = 0; y < layer.height; y++) {
      const src = y * layer.width * channels;
      out.set(plane.subarray(src, src + layer.width * channels), ((oy + y) * width + ox) * channels);
    }
    return out;
  };
  return {
    ...layer,
    x: left,
    y: top,
    width,
    height,
    pixels: grow(layer.pixels, 4),
    rawPixels: layer.rawPixels ? grow(layer.rawPixels, 4) : undefined,
    restoredMask: layer.restoredMask ? grow(layer.restoredMask, 1) : undefined,
  };
}

/** Admit selected candidate pool items into the formal Layer Stack without overwriting existing layers. */
export function admitPoolLayers(p: LayerProject, items: readonly PoolLayer[]): LayerProject {
  if (!items.length) throw new Error('请先勾选至少一个候选图层');
  const added: StackLayer[] = [];
  for (const item of items) {
    const trimmed = item.local ? item.raster : crop(item.raster, item.box);
    const layer = trimLayer({
      id: crypto.randomUUID(),
      name: item.name,
      candidateId: item.id,
      candidateZ: item.zIndex,
      x: item.box.x,
      y: item.box.y,
      width: trimmed.width,
      height: trimmed.height,
      pixels: trimmed.data,
      visible: true,
      locked: false,
      ...(item.width > 0 && item.height > 0 ? { rawSize: { width: item.width, height: item.height } } : {}),
      ...(item.rawScale !== undefined ? { rawScale: item.rawScale } : {}),
    });
    if (layer) added.push(layer);
  }
  if (!added.length) throw new Error('选中的候选图层全部透明，无可收纳像素');
  return {
    ...p,
    layers: [...p.layers, ...added],
    activeLayerId: added.at(-1)!.id,
  };
}

/** Import external raster images as new formal layers (explicit x/y, or centered when smaller / 1:1 when matching canvas). */
export function importImageLayers(
  p: LayerProject,
  items: readonly {
    name: string;
    raster: Raster;
    x?: number;
    y?: number;
    rawSize?: { width: number; height: number };
    rawScale?: number;
  }[],
): { project: LayerProject; added: StackLayer[] } {
  if (!items.length) throw new Error('请选择至少一张图像');
  const added: StackLayer[] = [];
  for (const item of items) {
    const cleanName = item.name.replace(/\.[^.]+$/, '').trim() || `导入图层 #${p.layers.length + added.length + 1}`;
    const x = item.x ?? Math.floor((p.reference.width - item.raster.width) / 2);
    const y = item.y ?? Math.floor((p.reference.height - item.raster.height) / 2);
    const layer = trimLayer({
      id: crypto.randomUUID(),
      name: cleanName,
      x,
      y,
      width: item.raster.width,
      height: item.raster.height,
      pixels: item.raster.data,
      visible: true,
      locked: false,
      ...(item.rawSize ? { rawSize: item.rawSize } : {}),
      ...(item.rawScale !== undefined ? { rawScale: item.rawScale } : {}),
    });
    if (layer) added.push(layer);
  }
  if (!added.length) throw new Error('导入的图像全部透明，无可添加像素');
  return {
    project: {
      ...p,
      layers: [...p.layers, ...added],
      activeLayerId: added.at(-1)!.id,
    },
    added,
  };
}

/** Update a formal layer's position, size, and resampled pixels. */
export function transformLayer(
  layers: readonly StackLayer[],
  id: string,
  rect: Rect,
  pixels: Uint8Array,
): StackLayer[] {
  const target = layers.find((l) => l.id === id);
  if (!target) throw new Error('找不到要调整的图层');
  if (target.locked || target.archived) throw new Error('该图层已锁定或归档，无法调整位置与尺寸');
  const next = trimLayer({
    ...target,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    pixels,
    rawPixels: undefined,
    restoredMask: undefined,
    toneMatch: undefined,
    masterRestored: undefined,
    rawScale:
      Math.round(
        (target.rawScale ?? 1) *
          Math.max(rect.width / Math.max(1, target.width), rect.height / Math.max(1, target.height)) *
          100,
      ) / 100,
  });
  if (!next) throw new Error('调整后的图层全部透明');
  return layers.map((l) => (l.id === id ? next : l));
}

/** Reorder a layer in the bottom-to-top stack (move `fromId` to the position of `toId`). */
export function reorderLayer(layers: readonly StackLayer[], fromId: string, toId: string): StackLayer[] {
  if (fromId === toId) return [...layers];
  const from = layers.findIndex((l) => l.id === fromId);
  const to = layers.findIndex((l) => l.id === toId);
  if (from < 0 || to < 0 || layers[from].archived || layers[from].locked) return [...layers];
  const next = layers.slice();
  const [moved] = next.splice(from, 1);
  const target = layers[to];
  const sameGroup =
    groupKey(moved.groupIds ?? moved.groups) === groupKey(target.groupIds ?? target.groups);
  next.splice(
    to,
    0,
    sameGroup
      ? moved
      : { ...moved, groups: target.groups, groupIds: target.groupIds, mutedGroups: target.mutedGroups },
  );
  return next;
}

export function toggleLayerVisible(layers: readonly StackLayer[], id: string): StackLayer[] {
  return layers.map((l) => (l.id === id && !l.archived ? { ...l, visible: !l.visible } : l));
}

export function groupKey(groups: readonly string[] | undefined): string {
  return groups?.length ? groups.join('\0') : '';
}

export function layerInGroup(
  layer: Pick<StackLayer, 'groups' | 'groupIds'>,
  prefix: readonly string[],
): boolean {
  const groups = layer.groupIds ?? layer.groups;
  if (!prefix.length || !groups || groups.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (groups[i] !== prefix[i]) return false;
  return true;
}

/** Toggle visibility for every layer inside a group folder (if any is visible, hide all; else show all). */
export function toggleGroupVisible(
  layers: readonly StackLayer[],
  prefix: readonly string[],
): StackLayer[] {
  if (!prefix.length) return [...layers];
  const key = groupKey(prefix);
  const muted = layers.some((l) => l.mutedGroups?.includes(key));
  return layers.map((l) => {
    if (!layerInGroup(l, prefix)) return l;
    const groups = l.mutedGroups ?? [];
    return { ...l, mutedGroups: muted ? groups.filter((g) => g !== key) : [...groups, key] };
  });
}

/** Rename a group folder at depth `prefix.length - 1` across all of its member layers. */
export function renameGroup(
  layers: readonly StackLayer[],
  prefix: readonly string[],
  name: string,
): StackLayer[] {
  const clean = name.trim();
  if (!prefix.length || !clean) return [...layers];
  const depth = prefix.length - 1;
  return layers.map((l) => {
    if (!layerInGroup(l, prefix) || !l.groups || depth >= l.groups.length) return l;
    const nextGroups = l.groups.slice();
    nextGroups[depth] = clean;
    return { ...l, groups: nextGroups };
  });
}

/** Dissolve a group folder while preserving every member layer (lifting them up one level). */
export function ungroupLayers(
  layers: readonly StackLayer[],
  prefix: readonly string[],
): StackLayer[] {
  if (!prefix.length) return [...layers];
  const depth = prefix.length - 1;
  const dissolvedKey = groupKey(prefix);
  const dissolvedChildPrefix = dissolvedKey + '\0';
  const parentPrefix = depth > 0 ? groupKey(prefix.slice(0, depth)) + '\0' : '';
  return layers.map((l) => {
    if (!layerInGroup(l, prefix)) return l;
    const nextGroups = l.groups ? l.groups.filter((_, i) => i !== depth) : undefined;
    const nextGroupIds = l.groupIds ? l.groupIds.filter((_, i) => i !== depth) : undefined;
    const nextMuted = l.mutedGroups
      ?.filter((k) => k !== dissolvedKey)
      .map((k) => (k.startsWith(dissolvedChildPrefix) ? parentPrefix + k.slice(dissolvedChildPrefix.length) : k));
    return {
      ...l,
      groups: nextGroups?.length ? nextGroups : undefined,
      groupIds: nextGroupIds?.length ? nextGroupIds : undefined,
      mutedGroups: nextMuted?.length ? nextMuted : undefined,
    };
  });
}

/** Delete an entire group folder and all layers inside it (blocks if any active member is locked). */
export function deleteGroup(
  layers: readonly StackLayer[],
  prefix: readonly string[],
): StackLayer[] {
  if (!prefix.length) return [...layers];
  const members = layers.filter((l) => layerInGroup(l, prefix));
  if (!members.length) return [...layers];
  if (members.some((l) => !l.archived && l.locked)) {
    throw new Error('分组内包含已锁定图层，请先解锁再删除');
  }
  return layers.filter((l) => !layerInGroup(l, prefix));
}

function pixelsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Reconcile layers returned from Photopea with the previous stack to identify new and modified layers. */
export function applyPhotopeaReturn(
  previous: readonly StackLayer[],
  incoming: readonly {
    photopeaId: number;
    name: string;
    groups?: string[];
    visible: boolean;
    locked: boolean;
    raster: Raster;
  }[],
): { layers: StackLayer[]; changes: Record<string, 'new' | 'updated'> } {
  const byPhotopeaId = new Map<number, StackLayer>();
  const byName = new Map<string, StackLayer[]>();
  for (const prev of previous) {
    if (prev.photopeaId !== undefined) byPhotopeaId.set(prev.photopeaId, prev);
    const list = byName.get(prev.name) ?? [];
    list.push(prev);
    byName.set(prev.name, list);
  }
  const used = new Set<string>();
  const layers: StackLayer[] = [];
  const changes: Record<string, 'new' | 'updated'> = {};

  for (const item of incoming) {
    const cleanGroups = item.groups?.map((g) => g.trim()).filter(Boolean);
    const trimmed = trimLayer({
      id: crypto.randomUUID(),
      name: item.name.trim() || '图层',
      groups: cleanGroups?.length ? cleanGroups : undefined,
      photopeaId: item.photopeaId,
      x: 0,
      y: 0,
      width: item.raster.width,
      height: item.raster.height,
      pixels: item.raster.data,
      visible: item.visible,
      locked: item.locked,
    });
    if (!trimmed) continue;

    let match = byPhotopeaId.get(item.photopeaId);
    if (match && used.has(match.id)) match = undefined;
    if (!match) {
      const candidates = byName.get(trimmed.name);
      match = candidates?.find((c) => !used.has(c.id));
    }

    if (match) {
      used.add(match.id);
      const next: StackLayer = {
        ...trimmed,
        candidateId: match.candidateId,
        candidateZ: match.candidateZ,
        batchId: match.batchId,
        archived: match.archived,
        archiveOrigin: match.archiveOrigin,
        ...(groupKey(trimmed.groups) === groupKey(match.groups)
          ? { groupIds: match.groupIds, mutedGroups: match.mutedGroups }
          : {}),
        visible: match.archived ? false : item.visible,
        id: match.id,
      };
      const samePixels =
        match.x === next.x &&
        match.y === next.y &&
        match.width === next.width &&
        match.height === next.height &&
        pixelsEqual(match.pixels, next.pixels);
      const sameMeta =
        match.name === next.name &&
        groupKey(match.groups) === groupKey(next.groups) &&
        match.visible === next.visible &&
        match.locked === next.locked;
      if (!samePixels || !sameMeta) changes[next.id] = 'updated';
      layers.push(next);
    } else {
      changes[trimmed.id] = 'new';
      layers.push(trimmed);
    }
  }
  return { layers, changes };
}

export function toggleLayerLock(layers: readonly StackLayer[], id: string): StackLayer[] {
  return layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l));
}

export function renameLayer(layers: readonly StackLayer[], id: string, name: string): StackLayer[] {
  const clean = name.trim();
  if (!clean) return [...layers];
  return layers.map((l) => (l.id === id ? { ...l, name: clean } : l));
}

export function duplicateLayer(
  layers: readonly StackLayer[],
  id: string,
): { layers: StackLayer[]; created: StackLayer } {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx < 0) throw new Error('找不到要复制的图层');
  const src = layers[idx];
  if (src.archived) throw new Error('请先恢复归档原件再复制');
  const copy: StackLayer = {
    ...src,
    id: crypto.randomUUID(),
    name: `${src.name} 副本`,
    groups: src.groups ? [...src.groups] : undefined,
    photopeaId: undefined,
    candidateId: undefined,
    batchId: undefined,
    candidateZ: undefined,
    locked: false,
    pixels: src.pixels.slice(),
    rawPixels: src.rawPixels?.slice(),
    restoredMask: src.restoredMask?.slice(),
    toneMatch: src.toneMatch
      ? { ...src.toneMatch, gain: [...src.toneMatch.gain], offset: [...src.toneMatch.offset] }
      : undefined,
  };
  const next = layers.slice();
  next.splice(idx + 1, 0, copy);
  return { layers: next, created: copy };
}

export function deleteLayer(layers: readonly StackLayer[], id: string): StackLayer[] {
  const target = layers.find((l) => l.id === id);
  if (target?.locked) throw new Error('该图层已锁定，请先解锁再删除');
  return layers.filter((l) => l.id !== id);
}

/** Merge layer `id` down into the layer immediately below it (index - 1 in bottom-to-top order). */
export function mergeDownLayer(
  layers: readonly StackLayer[],
  id: string,
): { layers: StackLayer[]; merged: StackLayer } {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx <= 0) throw new Error('已在最底层，无法向下合并');
  const top = layers[idx];
  const bottom = layers[idx - 1];
  if (top.archived || bottom.archived) throw new Error('请先恢复归档原件再合并');
  if (top.locked || bottom.locked) throw new Error('锁定图层不可合并，请先解锁');
  const left = Math.min(top.x, bottom.x);
  const topY = Math.min(top.y, bottom.y);
  const right = Math.max(top.x + top.width, bottom.x + bottom.width);
  const bottomY = Math.max(top.y + top.height, bottom.y + bottom.height);
  const width = right - left;
  const height = bottomY - topY;
  const out = new Uint8Array(width * height * 4);

  const put = (layer: StackLayer, over: boolean) => {
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const s = (y * layer.width + x) * 4;
        const sa = layer.pixels[s + 3] / 255;
        if (!sa) continue;
        const d = ((layer.y - topY + y) * width + (layer.x - left + x)) * 4;
        if (!over || !out[d + 3]) {
          out.set(layer.pixels.subarray(s, s + 4), d);
          continue;
        }
        const da = out[d + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++) {
          out[d + c] = Math.round((layer.pixels[s + c] * sa + out[d + c] * da * (1 - sa)) / oa);
        }
        out[d + 3] = Math.round(oa * 255);
      }
    }
  };
  put(bottom, false);
  put(top, true);

  const merged = trimLayer({
    id: bottom.id,
    name: bottom.name,
    groups: bottom.groups ? [...bottom.groups] : undefined,
    groupIds: bottom.groupIds,
    mutedGroups: bottom.mutedGroups,
    x: left,
    y: topY,
    width,
    height,
    pixels: out,
    visible: bottom.visible || top.visible,
    locked: false,
  }) ?? {
    id: bottom.id,
    name: bottom.name,
    groups: bottom.groups ? [...bottom.groups] : undefined,
    x: left,
    y: topY,
    width: 1,
    height: 1,
    pixels: new Uint8Array(4),
    visible: bottom.visible || top.visible,
    locked: false,
  };

  const next = layers.slice();
  next.splice(idx - 1, 2, merged);
  return { layers: next, merged };
}

/** Shift a layer's canvas coordinates permanently. */
export function offsetLayer(
  layers: readonly StackLayer[],
  id: string,
  dx: number,
  dy: number,
): StackLayer[] {
  if (!dx && !dy) return [...layers];
  return layers.map((l) => (l.id === id && !l.locked ? { ...l, x: l.x + dx, y: l.y + dy } : l));
}

/** Split one layer into two non-overlapping layers using a boolean selection predicate in reference coordinates. */
export function splitLayerByPredicate(
  layers: readonly StackLayer[],
  id: string,
  inside: (rx: number, ry: number) => boolean,
  suffix = '拆分',
): { layers: StackLayer[]; created: StackLayer } {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx < 0) throw new Error('请先选择一个图层');
  const layer = layers[idx];
  if (layer.locked) throw new Error('该图层已锁定，请先解锁再拆分');

  const picked = new Uint8Array(layer.pixels.length);
  const rest = new Uint8Array(layer.pixels.length);
  const pickedRaw = layer.rawPixels ? new Uint8Array(layer.rawPixels.length) : undefined;
  const restRaw = layer.rawPixels ? new Uint8Array(layer.rawPixels.length) : undefined;
  const pickedMask = layer.restoredMask ? new Uint8Array(layer.restoredMask.length) : undefined;
  const restMask = layer.restoredMask ? new Uint8Array(layer.restoredMask.length) : undefined;

  let pickedCount = 0,
    restCount = 0;
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const i = y * layer.width + x;
      const k = i * 4;
      if (!layer.pixels[k + 3]) continue;
      if (inside(layer.x + x + 0.5, layer.y + y + 0.5)) {
        picked.set(layer.pixels.subarray(k, k + 4), k);
        if (pickedRaw && layer.rawPixels) pickedRaw.set(layer.rawPixels.subarray(k, k + 4), k);
        if (pickedMask && layer.restoredMask) pickedMask[i] = layer.restoredMask[i];
        pickedCount++;
      } else {
        rest.set(layer.pixels.subarray(k, k + 4), k);
        if (restRaw && layer.rawPixels) restRaw.set(layer.rawPixels.subarray(k, k + 4), k);
        if (restMask && layer.restoredMask) restMask[i] = layer.restoredMask[i];
        restCount++;
      }
    }
  }
  if (!pickedCount) throw new Error('选区内没有属于当前图层的可见像素');
  if (!restCount) throw new Error('选区包含了整个图层，请只圈选需要分离的一侧');

  const upper = trimLayer({
    ...layer,
    id: crypto.randomUUID(),
    name: `${layer.name} · ${suffix}`,
    candidateId: undefined,
    batchId: undefined,
    candidateZ: undefined,
    groups: layer.groups ? [...layer.groups] : undefined,
    photopeaId: undefined,
    pixels: picked,
    rawPixels: pickedRaw,
    restoredMask: pickedMask,
  })!;
  const lower = trimLayer({
    ...layer,
    pixels: rest,
    rawPixels: restRaw,
    restoredMask: restMask,
  })!;

  const next = layers.slice();
  next.splice(idx, 1, lower, upper);
  return { layers: next, created: upper };
}

export function splitLayerByRect(layers: readonly StackLayer[], id: string, rect: Rect) {
  const x0 = Math.min(rect.x, rect.x + rect.width);
  const x1 = Math.max(rect.x, rect.x + rect.width);
  const y0 = Math.min(rect.y, rect.y + rect.height);
  const y1 = Math.max(rect.y, rect.y + rect.height);
  return splitLayerByPredicate(layers, id, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

export function pointInPolygon(
  px: number,
  py: number,
  poly: readonly { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function splitLayerByLasso(
  layers: readonly StackLayer[],
  id: string,
  polygon: readonly { x: number; y: number }[],
) {
  if (polygon.length < 3) throw new Error('请画出一个闭合套索区域');
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const pt of polygon) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  return splitLayerByPredicate(
    layers,
    id,
    (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY && pointInPolygon(x, y, polygon),
  );
}

/** Paint a continuous brush stroke (eraser or restore-from-reference) directly onto a StackLayer. */
export function applyBrushStroke(
  layer: StackLayer,
  reference: Raster,
  mode: 'erase' | 'restore',
  points: readonly { x: number; y: number }[],
  diameter: number,
  hardness: number,
): StackLayer | null {
  if (layer.locked || !points.length) return layer;
  const radius = Math.max(0.5, diameter / 2);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pt of points) {
    minX = Math.min(minX, Math.floor(pt.x - radius - 1));
    minY = Math.min(minY, Math.floor(pt.y - radius - 1));
    maxX = Math.max(maxX, Math.ceil(pt.x + radius + 1));
    maxY = Math.max(maxY, Math.ceil(pt.y + radius + 1));
  }
  const strokeRect: Rect = {
    x: clamp(minX, 0, reference.width - 1),
    y: clamp(minY, 0, reference.height - 1),
    width: Math.max(1, clamp(maxX, 0, reference.width) - clamp(minX, 0, reference.width - 1)),
    height: Math.max(1, clamp(maxY, 0, reference.height) - clamp(minY, 0, reference.height - 1)),
  };

  let target = mode === 'restore' ? expandLayerTo(layer, strokeRect) : { ...layer };
  const pixels = target.pixels.slice();
  const rawPixels = target.rawPixels?.slice();
  const restoredMask =
    mode === 'restore'
      ? (target.restoredMask?.slice() ?? new Uint8Array(target.width * target.height))
      : target.restoredMask?.slice();

  const x0 = Math.max(target.x, strokeRect.x);
  const y0 = Math.max(target.y, strokeRect.y);
  const x1 = Math.min(target.x + target.width, strokeRect.x + strokeRect.width);
  const y1 = Math.min(target.y + target.height, strokeRect.y + strokeRect.height);

  // Compute maximum coverage across all stroke segments for each touched pixel.
  const step = Math.max(1, radius * 0.25);
  const stamps: { x: number; y: number }[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      stamps.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  for (let ry = y0; ry < y1; ry++) {
    for (let rx = x0; rx < x1; rx++) {
      let best = 0;
      for (let s = 0; s < stamps.length; s++) {
        const d = Math.hypot(rx + 0.5 - stamps[s].x, ry + 0.5 - stamps[s].y);
        if (d > radius + 0.5) continue;
        const cov = brushCoverage(d, radius, hardness);
        if (cov > best) {
          best = cov;
          if (best >= 1) break;
        }
      }
      if (best <= 0) continue;
      const li = (ry - target.y) * target.width + (rx - target.x);
      const lk = li * 4;
      if (mode === 'erase') {
        const nextAlpha = Math.round(pixels[lk + 3] * (1 - best));
        pixels[lk + 3] = nextAlpha;
        if (rawPixels) rawPixels[lk + 3] = Math.round(rawPixels[lk + 3] * (1 - best));
        if (!nextAlpha) {
          pixels[lk] = pixels[lk + 1] = pixels[lk + 2] = 0;
          if (restoredMask) restoredMask[li] = 0;
        } else if (restoredMask) {
          restoredMask[li] = Math.round(restoredMask[li] * (1 - best));
        }
      } else {
        const rk = (ry * reference.width + rx) * 4;
        const refA = reference.data[rk + 3];
        if (!refA) continue;
        // Blend 100% lossless reference RGB + Alpha over the layer according to brush coverage.
        const curA = pixels[lk + 3] / 255;
        const topA = (refA / 255) * best;
        const outA = topA + curA * (1 - best);
        if (outA > 0) {
          for (let c = 0; c < 3; c++) {
            pixels[lk + c] = Math.round(
              (reference.data[rk + c] * topA + pixels[lk + c] * curA * (1 - best)) / outA,
            );
          }
          pixels[lk + 3] = Math.round(clamp(outA * 255, 0, 255));
        }
        if (restoredMask) {
          restoredMask[li] = Math.max(restoredMask[li], Math.round(best * 255));
        }
      }
    }
  }

  target = {
    ...target,
    pixels,
    rawPixels,
    restoredMask,
  };
  return trimLayer(target);
}

/** Reusable premultiplied-RGBA smudge brush state shared between live canvas preview and committed strokes. */
export interface SmudgeState {
  radius: number;
  rad: number;
  size: number;
  step: number;
  mask: Float32Array;
  pickup: Float32Array;
  lastX: number;
  lastY: number;
  seeded: boolean;
}

export function createSmudgeState(diameter: number, hardness = 0.35): SmudgeState {
  const radius = Math.max(0.5, diameter / 2);
  const rad = Math.ceil(radius);
  const size = rad * 2 + 1;
  const mask = new Float32Array(size * size);
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= radius + 0.5) {
        mask[(dy + rad) * size + (dx + rad)] = brushCoverage(d, radius, hardness);
      }
    }
  }
  return {
    radius,
    rad,
    size,
    step: Math.max(1, radius * 0.22),
    mask,
    pickup: new Float32Array(size * size * 4),
    lastX: 0,
    lastY: 0,
    seeded: false,
  };
}

/** Initialize the smudge pickup buffer in premultiplied RGBA space at the stroke start point. */
export function seedSmudgeState(
  state: SmudgeState,
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  originX: number,
  originY: number,
  x: number,
  y: number,
): void {
  const { rad, size, pickup } = state;
  const cx = Math.round(x);
  const cy = Math.round(y);
  pickup.fill(0);
  for (let dy = -rad; dy <= rad; dy++) {
    const ly = cy + dy - originY;
    if (ly < 0 || ly >= height) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const lx = cx + dx - originX;
      if (lx < 0 || lx >= width) continue;
      const dk = (ly * width + lx) * 4;
      const pk = ((dy + rad) * size + (dx + rad)) * 4;
      const a = data[dk + 3] / 255;
      pickup[pk] = data[dk] * a;
      pickup[pk + 1] = data[dk + 1] * a;
      pickup[pk + 2] = data[dk + 2] * a;
      pickup[pk + 3] = a;
    }
  }
  state.lastX = x;
  state.lastY = y;
  state.seeded = true;
}

/**
 * Advance a smudge stroke to `(x1, y1)` using premultiplied-RGBA pickup blending so pulling opaque edges
 * into transparent space never introduces dark fringes. Returns the dirty rect in local buffer coordinates.
 */
export function smudgeSegment(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  originX: number,
  originY: number,
  state: SmudgeState,
  x1: number,
  y1: number,
  strength: number,
  clip?: Pick<Raster, 'width' | 'height'>,
): Rect | undefined {
  if (!state.seeded) {
    seedSmudgeState(state, data, width, height, originX, originY, x1, y1);
    return undefined;
  }
  const s = clamp(strength, 0.05, 0.99);
  const dxSeg = x1 - state.lastX;
  const dySeg = y1 - state.lastY;
  const dist = Math.hypot(dxSeg, dySeg);
  if (dist < state.step) return undefined;

  const { rad, size, mask, pickup, step } = state;
  const steps = Math.floor(dist / step);
  const ux = dxSeg / dist;
  const uy = dySeg / dist;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let touched = false;

  for (let n = 1; n <= steps; n++) {
    const sx = state.lastX + ux * step * n;
    const sy = state.lastY + uy * step * n;
    const cx = Math.round(sx);
    const cy = Math.round(sy);
    for (let dy = -rad; dy <= rad; dy++) {
      const py = cy + dy;
      if (clip && (py < 0 || py >= clip.height)) continue;
      const ly = py - originY;
      if (ly < 0 || ly >= height) continue;
      const rowOff = (dy + rad) * size;
      const dstRow = ly * width;
      for (let dx = -rad; dx <= rad; dx++) {
        const m = mask[rowOff + (dx + rad)];
        if (m <= 0) continue;
        const px = cx + dx;
        if (clip && (px < 0 || px >= clip.width)) continue;
        const lx = px - originX;
        if (lx < 0 || lx >= width) continue;
        const w = m * s;
        const inv = 1 - w;
        const dk = (dstRow + lx) * 4;
        const pk = (rowOff + (dx + rad)) * 4;

        const curA = data[dk + 3] / 255;
        const outPR = data[dk] * curA * inv + pickup[pk] * w;
        const outPG = data[dk + 1] * curA * inv + pickup[pk + 1] * w;
        const outPB = data[dk + 2] * curA * inv + pickup[pk + 2] * w;
        const outPA = curA * inv + pickup[pk + 3] * w;

        pickup[pk] = outPR;
        pickup[pk + 1] = outPG;
        pickup[pk + 2] = outPB;
        pickup[pk + 3] = outPA;

        const aByte = Math.round(clamp(outPA * 255, 0, 255));
        if (aByte === 0) {
          data[dk] = data[dk + 1] = data[dk + 2] = data[dk + 3] = 0;
        } else {
          data[dk] = Math.round(clamp(outPR / outPA, 0, 255));
          data[dk + 1] = Math.round(clamp(outPG / outPA, 0, 255));
          data[dk + 2] = Math.round(clamp(outPB / outPA, 0, 255));
          data[dk + 3] = aByte;
        }
        if (lx < minX) minX = lx;
        if (ly < minY) minY = ly;
        if (lx + 1 > maxX) maxX = lx + 1;
        if (ly + 1 > maxY) maxY = ly + 1;
        touched = true;
      }
    }
  }

  state.lastX += ux * step * steps;
  state.lastY += uy * step * steps;
  return touched ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : undefined;
}

/**
 * Smudge/extend pixels of a StackLayer along `points`, dynamically expanding the layer's pixel buffer
 * and `rect` bounding box within master canvas bounds `[0..reference.width, 0..reference.height]`.
 */
export function applySmudgeStroke(
  layer: StackLayer,
  reference: Pick<Raster, 'width' | 'height'>,
  points: readonly { x: number; y: number }[],
  diameter: number,
  strength: number,
): StackLayer | null {
  if (layer.locked || points.length < 2) return layer;
  const state = createSmudgeState(diameter);
  const pad = Math.ceil(state.radius + 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    minX = Math.min(minX, Math.floor(pt.x - pad));
    minY = Math.min(minY, Math.floor(pt.y - pad));
    maxX = Math.max(maxX, Math.ceil(pt.x + pad));
    maxY = Math.max(maxY, Math.ceil(pt.y + pad));
  }
  const left = clamp(minX, 0, reference.width);
  const top = clamp(minY, 0, reference.height);
  const right = clamp(maxX, 0, reference.width);
  const bottom = clamp(maxY, 0, reference.height);
  if (right <= left || bottom <= top) return layer;

  const strokeRect: Rect = { x: left, y: top, width: right - left, height: bottom - top };
  const expanded = expandLayerTo(layer, strokeRect);
  const pixels = expanded.pixels.slice();

  seedSmudgeState(state, pixels, expanded.width, expanded.height, expanded.x, expanded.y, points[0].x, points[0].y);
  let changed = false;
  for (let i = 1; i < points.length; i++) {
    const dirty = smudgeSegment(
      pixels,
      expanded.width,
      expanded.height,
      expanded.x,
      expanded.y,
      state,
      points[i].x,
      points[i].y,
      strength,
      reference,
    );
    if (dirty) changed = true;
  }
  if (!changed) return layer;

  return trimLayer({
    ...expanded,
    pixels,
    rawPixels: undefined,
    toneMatch: undefined,
    restoredMask: undefined,
  });
}

/** Estimate channel gain/offset between this layer's AI pixels and the locked reference over reliable overlaps. */
export function estimateLayerToneMatch(layer: StackLayer, reference: Raster): ToneMatch | undefined {
  const basePixels = layer.rawPixels ?? layer.pixels;
  const n = layer.width * layer.height;
  const stride = Math.max(1, Math.ceil(n / 60000));
  const pairs: { r: number; l: number }[] = [];

  for (let i = 0; i < n; i += stride) {
    const lx = i % layer.width;
    const ly = Math.floor(i / layer.width);
    const rx = layer.x + lx;
    const ry = layer.y + ly;
    if (rx < 0 || rx >= reference.width || ry < 0 || ry >= reference.height) continue;
    const lk = i * 4;
    const rk = (ry * reference.width + rx) * 4;
    if (basePixels[lk + 3] < 240 || reference.data[rk + 3] < 240) continue;
    if ([0, 1, 2].some((c) => Math.abs(reference.data[rk + c] - basePixels[lk + c]) > 68)) continue;
    pairs.push({ r: rk, l: lk });
  }
  if (pairs.length < 16) return;

  const channels = [0, 1, 2];
  const medians = channels.map((c) =>
    quantile(
      pairs.map(({ r, l }) => reference.data[r + c] - basePixels[l + c]).sort((a, b) => a - b),
      0.5,
    ),
  );
  const tolerances = channels.map((c) =>
    clamp(
      3 *
        quantile(
          pairs
            .map(({ r, l }) => Math.abs(reference.data[r + c] - basePixels[l + c] - medians[c]))
            .sort((a, b) => a - b),
          0.5,
        ),
      6,
      22,
    ),
  );
  const stable = pairs.filter(({ r, l }) =>
    channels.every(
      (c) => Math.abs(reference.data[r + c] - basePixels[l + c] - medians[c]) <= tolerances[c],
    ),
  );
  if (stable.length < 16 || stable.length < pairs.length * 0.45) return;

  const gain: RGB = [1, 1, 1];
  const offset: RGB = [0, 0, 0];
  for (const c of channels) {
    let sumR = 0,
      sumL = 0,
      sqR = 0,
      sqL = 0;
    for (const { r, l } of stable) {
      const rv = reference.data[r + c],
        lv = basePixels[l + c];
      sumR += rv;
      sumL += lv;
      sqR += rv * rv;
      sqL += lv * lv;
    }
    const count = stable.length;
    const meanR = sumR / count,
      meanL = sumL / count;
    const sigR = Math.sqrt(Math.max(0, sqR / count - meanR ** 2));
    const sigL = Math.sqrt(Math.max(0, sqL / count - meanL ** 2));
    if (sigL >= 4 && sigR >= 4) gain[c] = clamp(sigR / sigL, 0.75, 1.33);
    offset[c] = meanR - gain[c] * meanL;
  }
  return {
    gain,
    offset,
    strength: layer.toneMatch?.strength ?? 1,
    samples: stable.length,
  };
}

/** Apply reversible tone match to a layer's AI pixels (preserving pixels brushed from reference). */
export function applyLayerToneMatch(
  layer: StackLayer,
  reference: Raster,
  strength?: number,
): StackLayer {
  if (layer.locked) throw new Error('该图层已锁定，请先解锁');
  const raw = layer.rawPixels ?? layer.pixels.slice();
  const baseLayer = { ...layer, rawPixels: raw };
  const match = estimateLayerToneMatch(baseLayer, reference);
  if (!match) throw new Error('与原画重合样本不足，暂无法自动对色');
  const nextStrength = strength !== undefined ? clamp(strength, 0, 1) : match.strength;
  const toneMatch: ToneMatch = { ...match, strength: nextStrength };
  const out = raw.slice();
  const n = layer.width * layer.height;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if (!out[k + 3]) continue;
    // Do not shift pixels already restored 100% from reference.
    const restored = (layer.restoredMask?.[i] ?? 0) / 255;
    const weight = nextStrength * (1 - restored);
    if (weight > 0) {
      for (let c = 0; c < 3; c++) {
        const v = raw[k + c];
        const aligned = clamp(v * toneMatch.gain[c] + toneMatch.offset[c], 0, 255);
        out[k + c] = Math.round(v + (aligned - v) * weight);
      }
    }
    if (restored > 0) {
      const rx = layer.x + (i % layer.width);
      const ry = layer.y + Math.floor(i / layer.width);
      if (rx >= 0 && rx < reference.width && ry >= 0 && ry < reference.height) {
        const rk = (ry * reference.width + rx) * 4;
        for (let c = 0; c < 3; c++) {
          out[k + c] = Math.round(out[k + c] * (1 - restored) + reference.data[rk + c] * restored);
        }
      }
    }
  }
  return { ...baseLayer, pixels: out, toneMatch };
}

/**
 * Losslessly restore sharp 1:1 pixels from the locked master `reference` onto the unoccluded visible surface
 * of a single formal layer, while preserving AI-reconstructed occluded regions behind upper visible layers
 * (with a 2px hard guard + 5px feather) and guarding against unseparated occluders via a 7x7 local color gate.
 */
export function restoreLayerUnoccludedMaster(
  layers: readonly StackLayer[],
  id: string,
  reference: Raster,
): { layer: StackLayer; restoredPixels: number; restoredRatio: number } {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx < 0) throw new Error('找不到目标图层');
  const layer = layers[idx];
  if (layer.locked || layer.archived) throw new Error('该图层已锁定或已归档，请先解锁');

  const W = layer.width;
  const H = layer.height;
  const N = W * H;
  const INF = 65535;
  const dist = new Uint16Array(N);
  dist.fill(INF);

  // 1. Mark all pixels covered by any visible layer strictly above `idx`.
  for (let j = idx + 1; j < layers.length; j++) {
    const upper = layers[j];
    if (!layerVisible(upper)) continue;
    const ox0 = Math.max(layer.x, upper.x);
    const oy0 = Math.max(layer.y, upper.y);
    const ox1 = Math.min(layer.x + W, upper.x + upper.width);
    const oy1 = Math.min(layer.y + H, upper.y + upper.height);
    if (ox1 <= ox0 || oy1 <= oy0) continue;
    for (let ry = oy0; ry < oy1; ry++) {
      const ly = ry - layer.y;
      const uy = ry - upper.y;
      const lRow = ly * W;
      const uRow = uy * upper.width;
      for (let rx = ox0; rx < ox1; rx++) {
        if (upper.pixels[(uRow + (rx - upper.x)) * 4 + 3] >= 16) {
          dist[lRow + (rx - layer.x)] = 0;
        }
      }
    }
  }

  // Two-pass Manhattan distance transform around upper occluders (O(W*H)).
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x > 0 && dist[i - 1] + 1 < d) d = dist[i - 1] + 1;
      if (y > 0 && dist[i - W] + 1 < d) d = dist[i - W] + 1;
      dist[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W;
    for (let x = W - 1; x >= 0; x--) {
      const i = row + x;
      let d = dist[i];
      if (x + 1 < W && dist[i + 1] + 1 < d) d = dist[i + 1] + 1;
      if (y + 1 < H && dist[i + W] + 1 < d) d = dist[i + W] + 1;
      dist[i] = d;
    }
  }

  // 2. Build 2D summed-area tables of `reference` over the layer bbox (+3px pad) for O(1) 7x7 local average.
  const PAD = 3;
  const rx0 = Math.max(0, layer.x - PAD);
  const ry0 = Math.max(0, layer.y - PAD);
  const rx1 = Math.min(reference.width, layer.x + W + PAD);
  const ry1 = Math.min(reference.height, layer.y + H + PAD);
  const bw = rx1 - rx0;
  const bh = ry1 - ry0;
  if (bw <= 0 || bh <= 0) return { layer, restoredPixels: 0, restoredRatio: 0 };

  const stride = bw + 1;
  const satSize = stride * (bh + 1);
  const satR = new Float64Array(satSize);
  const satG = new Float64Array(satSize);
  const satB = new Float64Array(satSize);
  const satW = new Float64Array(satSize);

  for (let by = 0; by < bh; by++) {
    const refRow = (ry0 + by) * reference.width + rx0;
    const prevRow = by * stride;
    const curRow = (by + 1) * stride;
    let runR = 0,
      runG = 0,
      runB = 0,
      runW = 0;
    for (let bx = 0; bx < bw; bx++) {
      const rk = (refRow + bx) * 4;
      const a = reference.data[rk + 3] / 255;
      runR += reference.data[rk] * a;
      runG += reference.data[rk + 1] * a;
      runB += reference.data[rk + 2] * a;
      runW += a;
      const c = curRow + bx + 1;
      const p = prevRow + bx + 1;
      satR[c] = satR[p] + runR;
      satG[c] = satG[p] + runG;
      satB[c] = satB[p] + runB;
      satW[c] = satW[p] + runW;
    }
  }

  const query = (sat: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    sat[y1 * stride + x1] - sat[y0 * stride + x1] - sat[y1 * stride + x0] + sat[y0 * stride + x0];

  // 3. Restore unoccluded, color-consistent pixels from `reference` at 100% native master sharpness.
  const out = layer.pixels.slice();
  let totalVisible = 0;
  let restoredPixels = 0;

  for (let ly = 0; ly < H; ly++) {
    const ry = layer.y + ly;
    if (ry < 0 || ry >= reference.height) continue;
    const lRow = ly * W;
    const rRow = ry * reference.width;
    const qy0 = Math.max(0, ry - PAD - ry0);
    const qy1 = Math.min(bh, ry + PAD + 1 - ry0);
    for (let lx = 0; lx < W; lx++) {
      const li = lRow + lx;
      const lk = li * 4;
      if (!layer.pixels[lk + 3]) continue;
      totalVisible++;

      const rx = layer.x + lx;
      if (rx < 0 || rx >= reference.width) continue;
      const d = dist[li];
      if (d <= 2) continue;
      const occlKeep = d >= 7 ? 1 : (d - 2) / 5;

      const rk = (rRow + rx) * 4;
      if (reference.data[rk + 3] < 16) continue;

      const lR = layer.pixels[lk];
      const lG = layer.pixels[lk + 1];
      const lB = layer.pixels[lk + 2];
      const rR = reference.data[rk];
      const rG = reference.data[rk + 1];
      const rB = reference.data[rk + 2];

      const directDiff = Math.max(Math.abs(lR - rR), Math.abs(lG - rG), Math.abs(lB - rB));
      const qx0 = Math.max(0, rx - PAD - rx0);
      const qx1 = Math.min(bw, rx + PAD + 1 - rx0);
      const sumW = query(satW, qx0, qy0, qx1, qy1);
      let diff = directDiff;
      if (sumW > 0.01) {
        const avgR = query(satR, qx0, qy0, qx1, qy1) / sumW;
        const avgG = query(satG, qx0, qy0, qx1, qy1) / sumW;
        const avgB = query(satB, qx0, qy0, qx1, qy1) / sumW;
        const localDiff = Math.max(Math.abs(lR - avgR), Math.abs(lG - avgG), Math.abs(lB - avgB));
        if (localDiff < diff) diff = localDiff;
      }
      if (diff >= 96) continue;
      const colorMatch = diff <= 48 ? 1 : (96 - diff) / 48;
      const w = occlKeep * colorMatch;
      if (w <= 0) continue;

      out[lk] = Math.round(lR + (rR - lR) * w);
      out[lk + 1] = Math.round(lG + (rG - lG) * w);
      out[lk + 2] = Math.round(lB + (rB - lB) * w);
      if (w >= 0.5) restoredPixels++;
    }
  }

  const restoredRatio = totalVisible ? restoredPixels / totalVisible : 0;
  return {
    layer:
      restoredPixels > 0
        ? {
            ...layer,
            pixels: out,
            rawPixels: undefined,
            toneMatch: undefined,
            restoredMask: undefined,
            masterRestored: true,
          }
        : layer,
    restoredPixels,
    restoredRatio,
  };
}

/** Batch-restore unoccluded master sharpness across all visible unlocked layers in the stack. */
export function restoreAllLayersUnoccludedMaster(
  layers: readonly StackLayer[],
  reference: Raster,
): { layers: StackLayer[]; updatedCount: number } {
  let updatedCount = 0;
  const next = layers.map((l) => {
    if (!layerVisible(l) || l.locked) return l;
    const res = restoreLayerUnoccludedMaster(layers, l.id, reference);
    if (res.restoredPixels > 0) {
      updatedCount++;
      return res.layer;
    }
    return l;
  });
  return { layers: next, updatedCount };
}

/** Composite a list of StackLayers onto a full-canvas raster (for previews, export, or occluder references). */
export function compositeLayers(
  layers: readonly StackLayer[],
  width: number,
  height: number,
  options: {
    soloId?: string;
    includeHidden?: boolean;
    drag?: { id: string; dx: number; dy: number };
  } = {},
): Raster {
  const out = new Uint8Array(width * height * 4);
  const row = new Float32Array(width * 4);
  const active = layers.filter((l) =>
    options.soloId ? l.id === options.soloId : options.includeHidden || layerVisible(l),
  );
  for (let y = 0; y < height; y++) {
    row.fill(0);
    for (const layer of active) {
      const dx = options.drag?.id === layer.id ? options.drag.dx : 0;
      const dy = options.drag?.id === layer.id ? options.drag.dy : 0;
      const ly = y - (layer.y + dy);
      if (ly < 0 || ly >= layer.height) continue;
      for (let x = 0; x < layer.width; x++) {
        const dstX = layer.x + dx + x;
        if (dstX < 0 || dstX >= width) continue;
        const s = (ly * layer.width + x) * 4;
        const a = layer.pixels[s + 3] / 255;
        if (!a) continue;
        const o = dstX * 4;
        for (let c = 0; c < 3; c++) row[o + c] = (layer.pixels[s + c] / 255) * a + (1 - a) * row[o + c];
        row[o + 3] = a + (1 - a) * row[o + 3];
      }
    }
    const dest = y * width * 4;
    for (let x = 0; x < width; x++) {
      const o = x * 4;
      const a = row[o + 3];
      if (!a) continue;
      for (let c = 0; c < 3; c++) out[dest + o + c] = Math.round((row[o + c] / a) * 255);
      out[dest + o + 3] = Math.round(a * 255);
    }
  }
  return { width, height, data: out };
}
