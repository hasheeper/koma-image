import type { ApplicationServices } from '../services/application.ts';
import type { CatalogModel } from '../domain/catalog.ts';
import { MAX_INPUT_BYTES } from '../domain/media.ts';
import { SEEDREAM_55 } from '../domain/seedream.ts';
import { profileFor } from '../gateway/profile.ts';
import type { ImagePayload } from '../gateway/routes.ts';
import { dataUrl } from '../services/assets.ts';
import { consumeMedia } from '../services/media-response.ts';
import { resolveLayerPlacement, responseFrame } from './placement.ts';
import { placeOnCanvas, png, readRaster } from './images.ts';
import {
  crop,
  alphaBounds,
  type LayerProject,
  type PoolLayer,
  type Raster,
} from './project.ts';

import { splitInput, type SplitSource, type DecomposeBatch } from './recursive.ts';
export { placeOnCanvas } from './images.ts';
export type { DecomposeBatch } from './recursive.ts';

export type DecomposeSize = '2K' | '1.5K' | '1K' | 'auto';

export const routeLabel = (m: CatalogModel) =>
  m.profileId ? (profileFor(m.profileId).label ?? '图像编辑连接') : '图像编辑连接';

export function decomposeCapable(m: CatalogModel): boolean {
  return (
    m.profileId === 'seedream-v1' && m.operations.includes('edit') && m.tools.includes('image-edit')
  );
}

export function preferredDecomposeModel(models: readonly CatalogModel[]): CatalogModel | undefined {
  const eligible = models.filter(decomposeCapable);
  return eligible.find((m) => (m.templateId ?? m.id) === SEEDREAM_55) ?? eligible[0];
}

async function encodeCanvasPng(src: OffscreenCanvas, width: number, height: number): Promise<Blob> {
  if (src.width === width && src.height === height) {
    return src.convertToBlob({ type: 'image/png' });
  }
  const dst = new OffscreenCanvas(width, height);
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return dst.convertToBlob({ type: 'image/png' });
}

async function prepareInputBlob(
  source: Raster,
): Promise<{ blob: Blob; width: number; height: number; downscaled: boolean }> {
  const fast = png(source, 3);
  if (fast.size <= MAX_INPUT_BYTES) {
    return { blob: fast, width: source.width, height: source.height, downscaled: false };
  }
  // Try higher lossless PNG compression at exact 1:1 resolution before scaling down a single pixel.
  const tight = png(source, 9);
  if (tight.size <= MAX_INPUT_BYTES) {
    return { blob: tight, width: source.width, height: source.height, downscaled: false };
  }
  const src = new OffscreenCanvas(source.width, source.height);
  src
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(source.data), source.width, source.height), 0, 0);
  const nativeFull = await encodeCanvasPng(src, source.width, source.height);
  if (nativeFull.size <= MAX_INPUT_BYTES) {
    return { blob: nativeFull, width: source.width, height: source.height, downscaled: false };
  }
  // Gradually step down preserving natural aspect ratio instead of chopping straight to 2048px.
  for (const factor of [0.9, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4]) {
    const w = Math.max(64, Math.round(source.width * factor));
    const h = Math.max(64, Math.round(source.height * factor));
    const fitted = await encodeCanvasPng(src, w, h);
    if (fitted.size <= MAX_INPUT_BYTES) {
      return { blob: fitted, width: w, height: h, downscaled: true };
    }
  }
  throw new Error('输入图像 PNG 超过单图 8MB 上传上限，请缩小画幅后再拆层');
}

export async function decodeLayerBlob(blob: Blob): Promise<Raster> {
  return readRaster(blob).catch(async () => {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法解码返回图层');
      ctx.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: new Uint8Array(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data.buffer),
      };
    } finally {
      bitmap.close();
    }
  });
}

/** Extract a concise PS-style layer name from Seedream's verbose `description` (e.g. "黑色百褶裙，含双层黑皮带…" -> "黑色百褶裙"). */
export function shortLayerName(raw: string | undefined, fallback: string): string {
  const clean = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  const lead = clean
    .split(/[，,。；;：:（(\n]/)[0]
    .replace(/[、\s]+$/g, '')
    .trim();
  const base = lead || clean;
  return base.length > 16 ? base.slice(0, 16).trim() : base;
}

function hasTransparency(raster: Raster): boolean {
  for (let i = 3; i < raster.data.length; i += 4) if (raster.data[i] < 250) return true;
  return false;
}

/** Run Seedream 5.5 layer_decomposition on either the locked master reference OR a single admitted StackLayer (recursive split). */
export async function requestLayerDecompose(
  services: ApplicationServices,
  p: LayerProject,
  model: CatalogModel,
  options: { prompt: string; maxImages?: number; size?: DecomposeSize; source: SplitSource },
  signal: AbortSignal,
  notice: (s: string) => void,
): Promise<DecomposeBatch> {
  const maxImages =
    options.maxImages !== undefined
      ? Math.max(2, Math.min(99, Math.round(options.maxImages)))
      : undefined;
  const requestedSize: DecomposeSize = options.size ?? '2K';
  const prompt = options.prompt.trim();
  const source = options.source;
  const inputRaster = splitInput(p, source);
  const targetRect = source.rect;
  const targetName = source.kind === 'master' ? '整图总拆' : `细拆「${source.name}」`;

  const run = await services.runTask(
    {
      id: crypto.randomUUID(),
      workspace: 'editor',
      sessionId: p.id,
      snapshot: {
        model: model.id,
        mode: 'decompose',
        maxImages,
        size: requestedSize,
        sourceLayerIds: source.members.map((m) => m.id),
      },
    },
    async (task) => {
      notice(`正在提交 ${targetName}（Seedream 原生拆层 · ${requestedSize === 'auto' ? '自动分辨率' : requestedSize}）…`);
      const inputBlob = await prepareInputBlob(inputRaster);
      const inputUrl = await dataUrl(inputBlob.blob);
      const image_options: Record<string, string> = {};
      if (model.fields.output_format?.options.includes('png')) image_options.output_format = 'png';
      if (model.fields.watermark?.options.includes('false')) image_options.watermark = 'false';
      const sizeOptions = model.fields.size?.options ?? [];
      if (requestedSize === 'auto') {
        image_options.size = 'auto';
      } else if (!sizeOptions.length || sizeOptions.includes(requestedSize)) {
        image_options.size = requestedSize;
      } else {
        image_options.size = model.fields.size?.default || 'auto';
      }
      const payload: ImagePayload = {
        model: model.id,
        prompt,
        tool: 'image-edit',
        init_image: inputUrl,
        additional_images: [],
        layerDecomposition: maxImages !== undefined ? { maxImages } : {},
        image_options,
        cache: false,
        transform_prompt: false,
        transform_mode: 'off',
      };
      task.signal.throwIfAborted();
      let route = routeLabel(model),
        actualModel = model.name;
      const output = await task.execute(
        model,
        payload,
        async (r, native, s) => {
          notice('已收到拆层响应，正在逐层解码透明图…');
          const blocks = await consumeMedia(r, native, s, payload);
          const images = blocks.filter((b) => b.type === 'image');
          if (!images.length) throw new Error('响应中没有返回任何拆层图片');
          return images;
        },
        {
          signal: task.signal,
          onNotice: notice,
          onSource: (source) => {
            route = routeLabel(source.model);
            actualModel = source.model.name;
          },
        },
      );
      task.signal.throwIfAborted();
      const baseSize = responseFrame(output.value, inputBlob);
      const layers: PoolLayer[] = [];
      for (const [index, item] of output.value.entries()) {
        task.signal.throwIfAborted();
        notice(`正在解码候选图层 ${index + 1} / ${output.value.length}…`);
        const rawRaster = await decodeLayerBlob(item.blob);
        const mapped = resolveLayerPlacement(rawRaster, baseSize, targetRect, item.meta);
        const placement = mapped ?? {
          x: targetRect.x,
          y: targetRect.y,
          width: rawRaster.width,
          height: rawRaster.height,
        };
        const image =
          rawRaster.width === placement.width && rawRaster.height === placement.height
            ? rawRaster
            : placeOnCanvas(rawRaster, { ...placement, x: 0, y: 0 }, placement.width, placement.height);
        const tight = alphaBounds(image);
        const pixels = tight ? crop(image, tight) : image;
        const box = {
          x: placement.x + (tight?.x ?? 0),
          y: placement.y + (tight?.y ?? 0),
          width: pixels.width,
          height: pixels.height,
        };
        const isBase =
          !item.meta?.box &&
          !item.meta?.normalizedBox &&
          (item.meta?.zIndex === 0 ||
            (index === 0 && item.meta?.background === 'opaque') ||
            (index === 0 && item.meta?.zIndex === undefined && !hasTransparency(rawRaster)));
        const zIndex = item.meta?.zIndex ?? index;
        const fallbackName = isBase
          ? '残余底图'
          : source.kind !== 'master'
            ? `${source.name} · 子层 #${index}`
            : `部件 #${index + 1}`;
        const fullDesc = item.meta?.name?.trim();
        const shortName = shortLayerName(fullDesc, fallbackName);
        const rawScale =
          Math.round(
            Math.max(
              placement.width / Math.max(1, rawRaster.width),
              placement.height / Math.max(1, rawRaster.height),
            ) * 100,
          ) / 100;
        layers.push({
          id: crypto.randomUUID(),
          name: shortName,
          description: fullDesc && fullDesc !== shortName ? fullDesc : undefined,
          preview: pixels,
          raster: pixels,
          local: true,
          needsPosition: !mapped,
          providerPlacement: { absolute: item.meta?.box, normalized: item.meta?.normalizedBox, mapped },
          box,
          zIndex,
          isBase,
          width: rawRaster.width,
          height: rawRaster.height,
          rawScale,
          source: 'decompose',
        });
      }
      layers.sort((a, b) => a.zIndex - b.zIndex);
      return {
        id: crypto.randomUUID(),
        model: actualModel,
        projectId: p.id,
        sentSize: { width: inputBlob.width, height: inputBlob.height },
        requestedSize: image_options.size,
        inputDownscaled: inputBlob.downscaled,
        responseSize: baseSize && { width: baseSize.width, height: baseSize.height },
        route,
        prompt,
        maxImages,
        targetName,
        source,
        layers,
        order: layers.map(l => l.id),
      };
    },
    signal,
  );
  if (run.status !== 'completed') {
    throw new Error(
      run.status === 'busy'
        ? '其他图像任务正在运行，完成后可在这里拆层。'
        : '应用正在维护数据，请稍后重试。',
    );
  }
  return run.value;
}
