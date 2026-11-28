import { readPsd, type Layer, type PixelData, type Psd } from 'ag-psd';
import type { Raster, StackLayer } from './project.ts';
import { compositeLayers } from './stack.ts';

export interface ImportedPsd {
  reference: Raster;
  layers: StackLayer[];
}

function raster(image: PixelData): Raster {
  const { width, height, data } = image;
  if (data.BYTES_PER_ELEMENT !== 1 || data.length !== width * height * 4)
    throw new Error('PSD 图层缺少完整的 8 位 RGBA 像素');
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

function unsupported(layer: Layer, feature: string): never {
  throw new Error(`「${layer.name || '未命名图层'}」含${feature}。请在 Photoshop 或 Photopea 中将相关图层合并为普通像素层，再导入 PSD。`);
}

function checkAppearance(layer: Layer) {
  if (layer.adjustment) unsupported(layer, '调整层');
  if (layer.clipping) unsupported(layer, '剪贴蒙版');
  if (layer.effects && !layer.effects.disabled) unsupported(layer, '图层样式');
  if (layer.vectorMask || layer.vectorFill || layer.realMask) unsupported(layer, '矢量或复合蒙版');
  if (layer.blendMode !== 'normal' && !(layer.children && layer.blendMode === 'pass through'))
    unsupported(layer, `「${layer.blendMode}」混合模式`);
  if (layer.children && (layer.opacity !== 1 || (layer.fillOpacity ?? 1) !== 1 || (layer.mask && !layer.mask.disabled)))
    unsupported(layer, '组不透明度或组蒙版');
  if (!layer.mask?.disabled && (layer.mask?.userMaskFeather || layer.mask?.fromVectorData || layer.mask?.positionRelativeToLayer))
    unsupported(layer, '羽化、矢量或相对定位蒙版');
  const blend = layer.blendingRanges;
  if (layer.knockout || layer.channelBlendingRestrictions?.length || (blend && [
    blend.compositeGrayBlendSource, blend.compositeGraphBlendDestinationRange,
    ...blend.ranges.flatMap(range => [range.sourceRange, range.destRange]),
  ].some(range => range.join(',') !== '0,0,255,255'))) unsupported(layer, '高级混合选项');
}

/** Bake normal pixel-layer opacity and a bitmap mask into straight alpha, in document coordinates. */
function layerRaster(layer: Layer): Raster {
  if (!layer.imageData) {
    if (layer.text || layer.placedLayer || ((layer.right ?? 0) > (layer.left ?? 0) && (layer.bottom ?? 0) > (layer.top ?? 0)))
      unsupported(layer, '缺少栅格预览的内容');
    return { width: 1, height: 1, data: new Uint8Array(4) };
  }
  const image = raster(layer.imageData);
  const opacity = (layer.opacity ?? 1) * (layer.fillOpacity ?? 1);
  const mask = layer.mask?.disabled ? undefined : layer.mask;
  if (!mask && opacity === 1) return image;
  const bitmap = mask?.imageData;
  const density = mask?.userMaskDensity ?? 1;
  const left = (layer.left ?? 0) - (mask?.left ?? 0), top = (layer.top ?? 0) - (mask?.top ?? 0);
  for (let y = 0, i = 3; y < image.height; y++) {
    for (let x = 0; x < image.width; x++, i += 4) {
      let alpha = opacity;
      if (mask) {
        const mx = x + left, my = y + top;
        const value = bitmap && mx >= 0 && mx < bitmap.width && my >= 0 && my < bitmap.height
          ? bitmap.data[(my * bitmap.width + mx) * 4] : (mask.defaultColor ?? 0);
        alpha *= 1 - density * (1 - value / 255);
      }
      image.data[i] = Math.round(image.data[i] * alpha);
    }
  }
  return image;
}

function isKomaReference(layer: Layer, psd: Psd, header: DataView) {
  // Older Koma PSDs have no producer metadata. Match their record encoding as
  // well as the decoded name, so an ordinary layer named 锁定原图 stays editable.
  return header.getUint16(12) === 4 && header.getUint32(26) === 0 && header.getUint32(30) === 0 &&
    layer.id === 1 && layer.name === '锁定原图' && layer.protected?.all && layer.transparencyProtected &&
    !layer.children && layer.left === 0 && layer.top === 0 && layer.right === psd.width && layer.bottom === psd.height &&
    new TextDecoder().decode(new Uint8Array(header.buffer, 0, Math.min(128, header.byteLength))).includes('\x07Layer 18BIMluni');
}

export function decodeLayerPsd(buffer: ArrayBuffer): ImportedPsd {
  const header = new DataView(buffer);
  if (buffer.byteLength < 38 || header.getUint32(0) !== 0x38425053) throw new Error('文件不是有效的 PSD');
  if (header.getUint16(4) !== 1) throw new Error('请另存为标准 PSD 文件，当前不支持 PSB');
  if (header.getUint16(22) !== 8 || header.getUint16(24) !== 3)
    throw new Error('请在 Photoshop 或 Photopea 中将文档转换为 RGB 颜色、8 位/通道，再另存为 PSD');
  const area = header.getUint32(14) * header.getUint32(18);
  if (!area || area > 32_000_000) throw new Error('PSD 画布须在 EDIT 的 3200 万像素上限以内');
  let compositeOffset = 26;
  for (let i = 0; i < 3; i++) {
    if (compositeOffset + 4 > buffer.byteLength) throw new Error('PSD 文件不完整');
    compositeOffset += 4 + header.getUint32(compositeOffset);
  }
  if (compositeOffset > buffer.byteLength) throw new Error('PSD 文件不完整');
  const psd = readPsd(buffer, {
    useImageData: true, strict: true, throwForMissingFeatures: true,
    skipCompositeImageData: compositeOffset === buffer.byteLength, skipThumbnail: true, skipLinkedFilesData: true,
    imageResourcesWhitelist: ['versionInfo'],
  });
  const layers: StackLayer[] = [];
  let reference: Raster | undefined;
  function visit(nodes: Layer[], groups: string[], groupIds: string[], mutedGroups: string[], parentLocked: boolean) {
    for (const node of nodes) {
      checkAppearance(node);
      const name = node.name?.trim() ? node.name : (node.children ? '未命名组' : '未命名图层');
      const locked = parentLocked || !!(node.transparencyProtected || node.protected?.transparency ||
        node.protected?.all || node.protected?.composite || node.protected?.position);
      if (node.children) {
        const keys = [...groupIds, crypto.randomUUID()];
        visit(node.children, [...groups, name], keys, node.hidden ? [...mutedGroups, keys.join('\0')] : mutedGroups, locked);
      } else {
        const image = layerRaster(node);
        if (node === psd.children?.[0] && isKomaReference(node, psd, header)) {
          reference = image;
          continue;
        }
        layers.push({
          id: crypto.randomUUID(), name, x: node.left ?? 0, y: node.top ?? 0,
          width: image.width, height: image.height, pixels: image.data, visible: !node.hidden, locked,
          ...(groupIds.length ? { groups, groupIds, mutedGroups } : {}),
        });
      }
    }
  }
  visit(psd.children ?? [], [], [], [], false);
  if (!reference && psd.imageData && psd.imageResources?.versionInfo?.hasRealMergedData !== false)
    reference = raster(psd.imageData);
  if (!reference) {
    if (!layers.length) throw new Error('PSD 缺少可读取的合成图或像素图层');
    reference = compositeLayers(layers, psd.width, psd.height);
  }
  return { reference, layers };
}
