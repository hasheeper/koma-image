import { placeOnCanvas } from './images.ts';
import { alphaBounds, crop, type PoolLayer, type Raster, type Rect } from './project.ts';

export function localPixels(item: PoolLayer): Raster {
  return item.local ? item.raster : crop(item.raster, item.box);
}

export function fitCandidate(item: PoolLayer, box: Rect, canvas: { width: number; height: number }): PoolLayer {
  const { x, y, width, height } = box;
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 ||
      width * height > 32_000_000 || x >= canvas.width || y >= canvas.height || x + width <= 0 || y + height <= 0)
    throw new Error('请输入与画布相交的整数矩形，宽高须大于零且面积不能超过 3200 万像素');
  const source = item.fitSource ?? localPixels(item);
  const raster = placeOnCanvas(source, { x: 0, y: 0, width, height }, width, height);
  return { ...item, local: true, needsPosition: false, box, raster, preview: raster, fitSource: source };
}

/** Bake one static copy; both inputs retain their full original pixels for rigging. */
export function clippedCandidate(item: PoolLayer, mask: Raster, maskBox: Rect): PoolLayer {
  if (item.needsPosition) throw new Error('请先确认组件的画布位置');
  const source = localPixels(item), box = item.box;
  const x = Math.max(box.x, maskBox.x), y = Math.max(box.y, maskBox.y);
  const width = Math.min(box.x + source.width, maskBox.x + mask.width) - x;
  const height = Math.min(box.y + source.height, maskBox.y + mask.height) - y;
  if (width <= 0 || height <= 0) throw new Error('两个图层没有可见重叠');
  const overlap = crop(source, { x: x - box.x, y: y - box.y, width, height });
  for (let row = 0; row < height; row++) {
    let alpha = (row * width) * 4 + 3;
    let stencil = ((y - maskBox.y + row) * mask.width + x - maskBox.x) * 4 + 3;
    for (let col = 0; col < width; col++, alpha += 4, stencil += 4)
      overlap.data[alpha] = Math.round(overlap.data[alpha] * mask.data[stencil] / 255);
  }
  const tight = alphaBounds(overlap);
  if (!tight) throw new Error('两个图层没有可见重叠');
  const raster = crop(overlap, tight);
  return {
    id: crypto.randomUUID(), name: item.name + ' · 可见裁片', zIndex: item.zIndex,
    local: true, raster, preview: raster, box: { ...tight, x: x + tight.x, y: y + tight.y },
    width: raster.width, height: raster.height, isBase: false, source: item.source,
  };
}
