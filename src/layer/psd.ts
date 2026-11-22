import { psdLayers, type ExportSlice } from './export.ts';
import type { LayerProject } from './project.ts';
import { compositeLayers } from './stack.ts';

const ascii = (text: string) => new TextEncoder().encode(text);
function u16(n: number) {
  return Uint8Array.of((n >>> 8) & 0xff, n & 0xff);
}
function u32(n: number) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
function channels(rgba: Uint8Array, whiteMatte = false) {
  const result = Array.from({ length: 4 }, () => new Uint8Array(rgba.length / 4));
  // PSD's merged RGB preview is stored over white. Editable layer channels are straight RGBA.
  for (let i = 0; i < result[0].length; i++) {
    const a = rgba[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const v = rgba[i * 4 + c];
      result[c][i] = whiteMatte ? Math.round(255 - ((255 - v) * a) / 255) : v;
    }
    result[3][i] = a;
  }
  return result;
}
function layerExtra(name: string, index: number, locked: boolean, dividerType?: 1 | 3) {
  const latin = ascii(dividerType === 3 ? '</Layer group>' : 'Layer ' + index),
    pascal = new Uint8Array(Math.ceil((latin.length + 1) / 4) * 4);
  pascal[0] = latin.length;
  pascal.set(latin, 1);
  const unicode = new Uint8Array(4 + 2 * name.length);
  unicode.set(u32(name.length));
  for (let i = 0; i < name.length; i++) unicode.set(u16(name.charCodeAt(i)), 4 + 2 * i);
  return new Blob([
    u32(0),
    u32(0),
    pascal,
    ascii('8BIMluni'),
    u32(unicode.length),
    unicode,
    ascii('8BIMlyid'),
    u32(4),
    u32(index),
    ...(locked ? [ascii('8BIMlspf'), u32(4), u32(0x80000000)] : []),
    ...(dividerType
      ? [
          ascii('8BIMlsct'),
          u32(dividerType === 1 ? 12 : 4),
          u32(dividerType),
          ...(dividerType === 1 ? [ascii('8BIMpass')] : []),
        ]
      : []),
  ]);
}

type PsdEntry =
  | { kind: 'layer'; slice: ExportSlice }
  | { kind: 'divider'; name: string; dividerType: 1 | 3; visible: boolean };

/** Expand bottom-to-top slices with nested `groups` into PSD records (bottom divider type=3, top folder type=1). */
function buildPsdEntries(stack: readonly ExportSlice[]): PsdEntry[] {
  const entries: PsdEntry[] = [];
  const open: { key: string; name: string; visible: boolean }[] = [];

  for (const slice of stack) {
    const groups = slice.groups ?? [];
    const keys = slice.groupIds ?? groups;
    let common = 0;
    while (common < open.length && common < groups.length && open[common].key === keys[common]) {
      common++;
    }
    while (open.length > common) {
      const closed = open.pop()!;
      entries.push({ kind: 'divider', name: closed.name, dividerType: 1, visible: closed.visible });
    }
    for (let i = common; i < groups.length; i++) {
      open.push({
        key: keys[i],
        name: groups[i],
        visible: !slice.mutedGroups?.includes(keys.slice(0, i + 1).join('\0')),
      });
      entries.push({ kind: 'divider', name: '</Layer group>', dividerType: 3, visible: false });
    }
    entries.push({ kind: 'layer', slice });
  }
  while (open.length) {
    const closed = open.pop()!;
    entries.push({ kind: 'divider', name: closed.name, dividerType: 1, visible: closed.visible });
  }
  return entries;
}

/** Standard 8-bit RGB PSD, normal unassociated RGBA pixel layers + nested 8BIMlsct layer groups. */
export function layeredPsd(p: LayerProject, allowEmpty = false) {
  if (!allowEmpty && !p.layers.length) throw new Error('图层栈为空，请先收纳至少一个图层');
  if (p.reference.width > 30000 || p.reference.height > 30000 || p.layers.length >= 16000)
    throw new Error('超过标准 PSD 的图幅或层数上限，请导出切片包');
  const stack = psdLayers(p, true);
  const entries = buildPsdEntries(stack);
  const merged = p.layers.length
    ? compositeLayers(p.layers, p.reference.width, p.reference.height).data
    : p.reference.data;
  const records: Blob[] = [],
    planes: Blob[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === 'divider') {
      const extra = layerExtra(entry.name, index + 1, false, entry.dividerType);
      const info = new Blob([0, 1, 2, -1].flatMap((id) => [u16(id), u32(2)]));
      const flags = entry.dividerType === 3 ? 2 : entry.visible ? 0 : 2;
      records.push(
        new Blob([
          u32(0),
          u32(0),
          u32(0),
          u32(0),
          u16(4),
          info,
          ascii(entry.dividerType === 1 ? '8BIMpass' : '8BIMnorm'),
          Uint8Array.of(255, 0, flags, 0),
          u32(extra.size),
          extra,
        ]),
      );
      for (let c = 0; c < 4; c++) planes.push(new Blob([u16(0)]));
      return;
    }
    const layer = entry.slice;
    const locked = !!layer.locked;
    const extra = layerExtra(layer.name, index + 1, locked),
      count = layer.width * layer.height;
    const info = new Blob([0, 1, 2, -1].flatMap((id) => [u16(id), u32(count + 2)]));
    // Layer flags bit 0 = transparency protected, bit 1 = hidden (not visible).
    const flags = (locked ? 1 : 0) | (layer.visible ? 0 : 2);
    records.push(
      new Blob([
        u32(layer.y),
        u32(layer.x),
        u32(layer.y + layer.height),
        u32(layer.x + layer.width),
        u16(4),
        info,
        ascii('8BIMnorm'),
        Uint8Array.of(255, 0, flags, 0),
        u32(extra.size),
        extra,
      ]),
    );
    for (const ch of channels(layer.data)) planes.push(new Blob([u16(0), ch]));
  });
  const info = new Blob([u16(-entries.length), ...records, ...planes]);
  const section = new Blob([
    u32(info.size + (info.size % 2)),
    info,
    new Uint8Array(info.size % 2),
    u32(0),
  ]);
  const doc = new Blob(
    [
      ascii('8BPS'),
      u16(1),
      new Uint8Array(6),
      u16(4),
      u32(p.reference.height),
      u32(p.reference.width),
      u16(8),
      u16(3),
      u32(0),
      u32(0),
      u32(section.size),
      section,
      u16(0),
      ...channels(merged, true),
    ],
    { type: 'image/vnd.adobe.photoshop' },
  );
  if (doc.size >= 2 ** 31) throw new Error('分层 PSD 超过 2 GiB，请导出切片包');
  return doc;
}
