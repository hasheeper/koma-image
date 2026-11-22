import { fileDriver } from '../bridge/fs-driver.ts';
import { png } from './images.ts';
import { layerVisible } from './project.ts';
import type { LayerProject, Rect, StackLayer } from './project.ts';

export interface ExportSlice extends Rect {
  id: string;
  name: string;
  groups?: string[];
  groupIds?: string[];
  mutedGroups?: string[];
  data: Uint8Array;
  visible: boolean;
  locked?: boolean;
}

/** Ordered layers for PSD export (bottom locked reference + formal Layer Stack in Z-Order). */
export function psdLayers(p: LayerProject, includeReference = true): ExportSlice[] {
  const stack: ExportSlice[] = p.layers.map((l: StackLayer) => ({
    id: l.id,
    name: l.name,
    groups: l.groups?.length ? [...l.groups] : undefined,
    x: l.x,
    y: l.y,
    width: l.width,
    height: l.height,
    data: l.pixels,
    groupIds: l.groupIds,
    mutedGroups: l.mutedGroups,
    visible: l.visible && !l.archived,
    locked: l.locked,
  }));
  if (!includeReference) return stack;
  return [
    {
      id: 'reference',
      name: '锁定原图',
      x: 0,
      y: 0,
      width: p.reference.width,
      height: p.reference.height,
      data: p.reference.data,
      visible: stack.length === 0,
      locked: true,
    },
    ...stack,
  ];
}

/** Export Koma Rig Slices v2 package directly from the formal Layer Stack in current Z-Order. */
export function packageFiles(p: LayerProject): [string, Blob][] {
  const exported = p.layers.filter(layerVisible);
  if (!exported.length) throw new Error('图层栈没有可导出的可见图层，请先收纳并显示至少一个图层');
  const texture = (index: number) => 'textures/' + index + '.png';
  const groupTree = new Map<
    string,
    {
      groupId: string;
      parentGroupId: string | null;
      name: string;
      index: number;
      visible: boolean;
      idSource: 'mapped';
    }
  >();
  function groupFor(layer: StackLayer) {
    let parent: string | null = null;
    for (const [i, name] of (layer.groups ?? []).entries()) {
      // Qualify by the entire identity path so legacy name-only folders also remain unambiguous.
      const key = JSON.stringify((layer.groupIds ?? layer.groups!).slice(0, i + 1));
      if (!groupTree.has(key))
        groupTree.set(key, {
          groupId: key,
          parentGroupId: parent,
          name,
          index: groupTree.size,
          visible: true,
          idSource: 'mapped',
        });
      parent = key;
    }
    return parent ?? undefined;
  }
  const manifest = {
    format: 'koma-rig.slices.v2',
    sourceId: p.id,
    blendSpace: 'srgb',
    reference: 'reference.png',
    canvas: { width: p.reference.width, height: p.reference.height },
    layers: exported.map((l, i) => ({
      layerId: l.id,
      groupId: groupFor(l),
      name: l.name,
      groups: l.groups ? [...l.groups] : [],
      rect: [l.x, l.y, l.width, l.height],
      texture: texture(i),
      visible: l.visible,
      opacity: 1,
    })),
    groupTree: [...groupTree.values()],
  };
  return [
    ['manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })],
    ['reference.png', png(p.reference)],
    ...exported.map((l, i): [string, Blob] => [
      texture(i),
      png({ width: l.width, height: l.height, data: l.pixels }),
    ]),
  ];
}

/** Create a fresh child in the chosen parent. A failed write never exposes a partial manifest. */
export async function writePackage(parent: FileSystemDirectoryHandle, files: [string, Blob][]) {
  const name = 'koma-layer-' + crypto.randomUUID(),
    dir = await parent.getDirectoryHandle(name, { create: true });
  try {
    const driver = fileDriver(dir),
      signal = new AbortController().signal;
    for (const [path, blob] of [...files.slice(1), files[0]]) await driver.write(path, blob, signal);
    return name;
  } catch (e) {
    await parent.removeEntry(name, { recursive: true }).catch(() => {});
    throw e;
  }
}
