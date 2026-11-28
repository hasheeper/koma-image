import type { ApplicationServices } from '../services/application.ts';
import type { CatalogModel } from '../domain/catalog.ts';
import { supportsLayerDecomposition } from '../domain/catalog.ts';
import { buildUpscalePayload, MAX_INPUT_BYTES } from '../domain/media.ts';
import { NAI_OFFICIAL_UPSCALE } from '../domain/nai.ts';
import { SEEDREAM_55, SEEDREAM_MIN_SPLIT_PIXELS } from '../domain/seedream.ts';
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

const splitSizes = ['2K', '1.5K', '1K', 'auto'] as const;
export type DecomposeSize = typeof splitSizes[number];
export function decomposeSizes(model?: CatalogModel): readonly DecomposeSize[] {
  if (!model?.splitLimits) return splitSizes;
  const field = (model.splitFields ?? model.fields).size;
  return splitSizes.filter(size => size === 'auto' || field?.options.includes(size));
}
type ImageSize = Pick<Raster, 'width' | 'height'>;
export type SplitInputUpscale = 'local' | CatalogModel;
export interface SmallSplitInput {
  name: string;
  source: ImageSize;
  target: ImageSize;
  minPixels: number;
}
type ChooseSplitUpscale = (input: SmallSplitInput, signal: AbortSignal) => Promise<SplitInputUpscale>;

export const routeLabel = (m: CatalogModel) =>
  m.profileId ? (profileFor(m.profileId).label ?? '图像编辑连接') : '图像编辑连接';

export { supportsLayerDecomposition as decomposeCapable };

export function supportsMissingComponent(model: CatalogModel) {
  return supportsLayerDecomposition(model) && (model.templateId ?? model.id) === SEEDREAM_55;
}

export function preferredDecomposeModel(models: readonly CatalogModel[]): CatalogModel | undefined {
  const eligible = models.filter(supportsLayerDecomposition);
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

function sizeForPixels({ width, height }: ImageSize, pixels: number): ImageSize {
  const scale = Math.sqrt(pixels / (width * height));
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale) };
}

function resizeInput(source: Raster, size: ImageSize): Raster {
  return placeOnCanvas(source, { ...size, x: 0, y: 0 }, size.width, size.height);
}

async function prepareInputBlob(
  source: Raster,
  minPixels: number,
): Promise<{ blob: Blob; width: number; height: number; downscaled: boolean }> {
  if (source.width * source.height < minPixels) throw new Error('拆层送图仍低于模型的最小像素要求');
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
  const smaller = [0.9, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4].map(factor => ({
    width: Math.max(1, Math.round(source.width * factor)),
    height: Math.max(1, Math.round(source.height * factor)),
  }));
  if (minPixels > 0) smaller.push(sizeForPixels(source, minPixels));
  for (const { width, height } of smaller) {
    if (width * height < minPixels || width >= source.width && height >= source.height) continue;
    const fitted = await encodeCanvasPng(src, width, height);
    if (fitted.size <= MAX_INPUT_BYTES) {
      return { blob: fitted, width, height, downscaled: true };
    }
  }
  throw new Error(minPixels > 0
    ? '拆层送图无法同时满足最小像素与单图 8MB 上限'
    : '输入图像 PNG 超过单图 8MB 上传上限，请缩小画幅后再拆层');
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
  options: { prompt: string; maxImages?: number; size?: DecomposeSize; source: SplitSource; componentName?: string },
  signal: AbortSignal,
  notice: (s: string) => void,
  chooseUpscale: ChooseSplitUpscale,
): Promise<DecomposeBatch> {
  const sizes = decomposeSizes(model);
  const requestedSize = options.size && sizes.includes(options.size) ? options.size : sizes[0];
  const source = options.source;
  const componentName = options.componentName?.trim();
  if (options.componentName !== undefined) {
    if (!componentName || source.kind === 'region' || source.kind === 'layers' && !source.members.length)
      throw new Error('请填写缺失部件名称并选择母版或参考图层');
    if (!supportsMissingComponent(model)) throw new Error('补缺失件需要支持拆层的 Seedream 5.5 来源');
  }
  const limit = componentName ? 2 : options.maxImages;
  const maxImages = limit === undefined ? undefined : Math.max(2, Math.min(99, Math.round(limit)));
  const prompt = componentName ? [
    (source.kind === 'master' ? '以整张母版原图为参考。' : `参考图由「${source.name}」按原位合成。`) +
      `请生成一个新的独立图层「${componentName}」。`,
    '参照合成图的朝向、比例、线条、颜色与光照，在原画面对应的位置画出完整部件。即使部件完全被遮住，也请推断其轮廓，画全藏在前景下的连接端，留出可供转动的重叠区。目标层只含该部件，其余像素透明。参考图层留在底图。',
    options.prompt.trim(),
  ].filter(Boolean).join('\n') : options.prompt.trim();
  const inputRaster = splitInput(p, source);
  if (componentName && !alphaBounds(inputRaster)) throw new Error('所选补画底图完全透明');
  const targetRect = source.rect;
  const targetName = componentName ? `补缺失件「${componentName}」` : source.kind === 'master' ? '整图总拆' : `细拆「${source.name}」`;
  const needsMinimum = !!model.splitLimits || (model.templateId ?? model.id) === SEEDREAM_55;
  const minPixels = needsMinimum ? SEEDREAM_MIN_SPLIT_PIXELS : 0;
  const upscaleTarget = inputRaster.width * inputRaster.height < minPixels
    ? sizeForPixels(inputRaster, minPixels) : undefined;
  const method = upscaleTarget
    ? await chooseUpscale({ name: targetName, source: targetRect, target: upscaleTarget, minPixels }, signal)
    : undefined;
  signal.throwIfAborted();

  const run = await services.runTask(
    {
      id: crypto.randomUUID(),
      workspace: 'editor',
      sessionId: p.id,
      snapshot: {
        model: model.id,
        mode: componentName ? 'missing-component' : 'decompose',
        ...(componentName ? { componentName } : {}),
        maxImages,
        size: requestedSize,
        sourceLayerIds: source.members.map((m) => m.id),
      },
    },
    async (task) => {
      let prepared = inputRaster;
      if (upscaleTarget && method) {
        const local = resizeInput(inputRaster, upscaleTarget);
        prepared = local;
        if (method !== 'local') {
          notice(`正在用「${method.name}」放大送图…`);
          // Undersized Seedream inputs fit within the single-image byte limit even as lossless RGBA PNG.
          const payload = buildUpscalePayload(method, await dataUrl(png(inputRaster)));
          const expected = method.profileId === 'nai-official-v1' ? {
            width: inputRaster.width * NAI_OFFICIAL_UPSCALE.factor,
            height: inputRaster.height * NAI_OFFICIAL_UPSCALE.factor,
          } : undefined;
          const reply = await task.execute(method, payload, async (response, native, s) => {
            const images = (await consumeMedia(response, native, s, { ...payload, ...expected })).filter(block => block.type === 'image');
            if (images.length !== 1) throw new Error('放大模型须返回一张图像');
            const [image] = images;
            const { width, height } = image.size;
            if (width * height > 32_000_000) throw new Error('放大回图超过 EDIT 的 3200 万像素上限');
            if (expected && (width !== expected.width || height !== expected.height))
              throw new Error('NovelAI 放大回图尺寸异常');
            const expectedWidth = height * inputRaster.width / inputRaster.height;
            if (
              width < inputRaster.width || height < inputRaster.height ||
              width === inputRaster.width && height === inputRaster.height ||
              Math.abs(width - expectedWidth) > Math.max(1, expectedWidth * 0.01)
            ) throw new Error('放大模型回图未保持原图比例或尺寸，请改用本地放大');
            s.throwIfAborted();
            return decodeLayerBlob(image.blob);
          }, { onlyConnection: method.connection, onNotice: notice });
          task.signal.throwIfAborted();
          prepared = resizeInput(reply.value, upscaleTarget);
          for (let i = 3; i < prepared.data.length; i += 4) prepared.data[i] = local.data[i];
        }
      }
      notice(`正在提交 ${targetName}（${routeLabel(model)} · ${requestedSize === 'auto' ? '自动分辨率' : requestedSize}）…`);
      const inputBlob = await prepareInputBlob(prepared, minPixels);
      const inputUrl = await dataUrl(inputBlob.blob);
      const image_options: Record<string, string> = {};
      const fields = model.splitFields ?? model.fields;
      if (fields.output_format?.options.includes('png')) image_options.output_format = 'png';
      if (fields.watermark?.options.includes('false')) image_options.watermark = 'false';
      if (fields.nsfw_checker && model.fields.nsfw_checker?.default) image_options.nsfw_checker = model.fields.nsfw_checker.default;
      const sizeOptions = fields.size?.options ?? [];
      if (requestedSize !== 'auto') {
        image_options.size = !sizeOptions.length || sizeOptions.includes(requestedSize)
          ? requestedSize : fields.size?.default || '';
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
          onlyConnection: p.decomposeConnection,
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
        const isBase =
          !item.meta?.box &&
          !item.meta?.normalizedBox &&
          (item.meta?.zIndex === 0 ||
            (index === 0 && item.meta?.background === 'opaque') ||
            (index === 0 && item.meta?.zIndex === undefined && !hasTransparency(rawRaster)));
        if (componentName && (isBase || item.meta?.zIndex === 0)) continue;
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
        if (componentName && !tight) continue;
        const pixels = tight ? crop(image, tight) : image;
        const box = {
          x: placement.x + (tight?.x ?? 0),
          y: placement.y + (tight?.y ?? 0),
          width: pixels.width,
          height: pixels.height,
        };
        const zIndex = item.meta?.zIndex ?? index;
        const fallbackName = componentName || (isBase
          ? '残余底图'
          : source.kind !== 'master'
            ? `${source.name} · 子层 #${index}`
            : `部件 #${index + 1}`);
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
      if (componentName && !layers.length) throw new Error(`模型未返回「${componentName}」的独立有效图层，本次未添加部件。`);
      layers.sort((a, b) => a.zIndex - b.zIndex);
      return {
        id: crypto.randomUUID(),
        model: actualModel,
        projectId: p.id,
        sentSize: { width: inputBlob.width, height: inputBlob.height },
        requestedSize: image_options.size,
        inputDownscaled: inputBlob.downscaled,
        inputUpscale: method === 'local' ? '本地放大' : method?.name,
        responseSize: baseSize && { width: baseSize.width, height: baseSize.height },
        route,
        prompt,
        maxImages,
        targetName,
        componentName,
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
