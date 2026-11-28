import type { ApplicationServices } from '../services/application.ts';
import { normalizeOptions, supportsLayerDecomposition, type CatalogModel } from '../domain/catalog.ts';
import { buildChatPayload, MAX_INPUT_BYTES, MAX_TOTAL_BYTES } from '../domain/media.ts';
import { SEEDREAM_55 } from '../domain/seedream.ts';
import type { ImagePayload } from '../gateway/routes.ts';
import { dataUrl } from '../services/assets.ts';
import { fitReference } from '../services/handoff.ts';
import { consumeMedia } from '../services/media-response.ts';
import { decodeLayerBlob, routeLabel } from './decompose.ts';
import {
  alphaBounds,
  crop,
  type LayerProject,
  type Raster,
  type Rect,
  type RerollCandidate,
  type StackLayer,
} from './project.ts';
import { compositeLayers } from './stack.ts';
import { layerPictureId, referenceBlob, referenceSources, scalpelInputs, scalpelSource } from './scalpel-references.ts';
import {
  closestAspectOption,
  placeScalpelReply,
  restoreScalpelSurface,
  scalpelFrame,
  scalpelResolution,
  type ScalpelFraming,
} from './scalpel-resolution.ts';
export { scalpelFrame, type ScalpelFraming };
import { png } from './images.ts';

export function rerollCapable(m: CatalogModel): boolean {
  return (
    m.provider !== 'novelai' &&
    m.operations.includes('edit') &&
    m.tools.includes('image-edit') &&
    m.maxImages >= 1
  );
}

export function preferredRerollModel(models: readonly CatalogModel[], activeId?: string): CatalogModel | undefined {
  const eligible = models.filter(rerollCapable);
  return (
    eligible.find((m) => (m.templateId ?? m.id) === SEEDREAM_55 && supportsLayerDecomposition(m)) ??
    eligible.find((m) => (m.templateId ?? m.id) === SEEDREAM_55) ??
    eligible.find((m) => !!m.fields.background?.options.includes('transparent')) ??
    eligible.find((m) => m.id === activeId) ??
    eligible[0]
  );
}

export function editRect(frame: Rect, reference: Raster): Rect {
  const x = Math.max(0, frame.x),
    y = Math.max(0, frame.y);
  return {
    x,
    y,
    width: Math.min(reference.width, frame.x + frame.width) - x,
    height: Math.min(reference.height, frame.y + frame.height) - y,
  };
}

function saveChannel(channel: Uint8Array, rect: Rect, width: number): Uint8Array {
  const local = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const start = (y + rect.y) * width + rect.x;
    local.set(channel.subarray(start, start + rect.width), y * rect.width);
  }
  return local;
}

function compositeTint(
  out: Uint8Array,
  k: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
  tr: number,
  tg: number,
  tb: number,
  ta: number,
) {
  const ba = (sa / 255) * (1 - ta);
  const outA = ta + ba;
  if (outA <= 0) return;
  out[k] = Math.round((tr * ta + sr * ba) / outA);
  out[k + 1] = Math.round((tg * ta + sg * ba) / outA);
  out[k + 2] = Math.round((tb * ta + sb * ba) / outA);
  out[k + 3] = Math.round(outA * 255);
}

/** Build a rough visual guide overlay on top of the intact local artwork (never hard-cuts along brush edges). */
export function buildTransparentWorkspace(
  cleanLocal: Raster,
  blue: Uint8Array,
  orange: Uint8Array | undefined,
): Raster {
  const { width: w, height: h, data } = cleanLocal;
  const out = new Uint8Array(data.length);
  const isEdge = (ch: Uint8Array, i: number, x: number, y: number) =>
    (x > 0 && ch[i - 1] < 128) ||
    (x + 1 < w && ch[i + 1] < 128) ||
    (y > 0 && ch[i - w] < 128) ||
    (y + 1 < h && ch[i + w] < 128);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = i * 4;
      const sr = data[k];
      const sg = data[k + 1];
      const sb = data[k + 2];
      const sa = data[k + 3];
      const o = orange?.[i] ?? 0;
      const b = blue[i];
      if (o > 0) {
        const edge = o >= 128 && orange !== undefined && isEdge(orange, i, x, y);
        const ta = edge ? 0.78 : (o / 255) * 0.48;
        compositeTint(out, k, sr, sg, sb, sa, 255, 140, 20, ta);
      } else if (b > 0) {
        const edge = b >= 128 && isEdge(blue, i, x, y);
        const ta = edge ? 0.7 : (b / 255) * 0.4;
        compositeTint(out, k, sr, sg, sb, sa, 30, 120, 255, ta);
      } else {
        out[k] = sr;
        out[k + 1] = sg;
        out[k + 2] = sb;
        out[k + 3] = sa;
      }
    }
  }
  return { width: w, height: h, data: out };
}

export function rerollRequestOptions(model: CatalogModel, frame: Pick<Rect, 'width' | 'height'>) {
  const options = normalizeOptions(model);
  const resolution = scalpelResolution(model, frame);
  if (resolution) options[resolution.key] = resolution.value;
  if (model.fields.aspect_ratio) {
    options.aspect_ratio =
      resolution?.aspectRatio ??
      closestAspectOption(model.fields.aspect_ratio.options, frame.width / Math.max(1, frame.height))?.value ??
      '1:1';
  }
  if (model.fields.output_format?.options.includes('png')) options.output_format = 'png';
  if (model.fields.watermark?.options.includes('false')) options.watermark = 'false';
  if (model.fields.background?.options.includes('transparent')) options.background = 'transparent';
  return { resolution, options };
}

export function targetedRerollPrompt(
  p: Pick<LayerProject, 'scalpelName' | 'scalpelInstruction'>,
  options: {
    layout: ReturnType<typeof scalpelInputs>;
    occluderNames: readonly string[];
    references: readonly { name: string; usage: string }[];
    hasBlue?: boolean;
    hasOrange?: boolean;
    sourceLayers?: readonly string[];
  },
): string {
  const name = p.scalpelName.trim();
  const target = name ? `"${name}"` : options.sourceLayers?.length ? 'selected artwork' : 'the indicated component';
  const note = p.scalpelInstruction.trim();
  const lines: string[] = [];

  const { workspaceIndex: guide, occluderIndex, firstReference, context } = options.layout;
  const sourceRef = context ? 'Image 1' : `Image ${guide}`;
  if (options.sourceLayers?.length) {
    lines.push(`The source artwork contains only the selected layers (${options.sourceLayers.join(', ')}), composited in their original positions and stacking order. Preserve their relative placement.`);
  }
  if (context) {
    lines.push(
      'Image 1 is the clean, unmarked original artwork crop at exact 1:1 position and scale. Use Image 1 as the authoritative source for all linework, colors, shading, and natural object boundaries.',
    );
  }
  const guideMarks: string[] = [];
  if (options.hasBlue !== false) {
    guideMarks.push('translucent BLUE highlighter strokes roughly point to the visible target component');
  }
  if (options.hasOrange) {
    guideMarks.push('translucent ORANGE highlighter strokes roughly mark occluded or missing areas to reconstruct');
  }
  if (guideMarks.length) lines.push(
    `Image ${guide} is ONLY a rough, imprecise human brush annotation overlaid on the intact artwork (${guideMarks.join('; ')}). IMPORTANT: Human brush strokes are loose and approximate—they frequently spill past the true edge onto neighboring hair, clothes, limbs, or background, or stop slightly short. Treat Image ${guide} strictly as a semantic region hint, NEVER as a literal pixel cutout mask.`,
  );
  else lines.push(`Image ${guide} is the unmarked selected artwork. Complete it as one transparent component using its existing silhouette.`);
  if (occluderIndex) {
    lines.push(
      `Image ${occluderIndex} shows the exact already-separated foreground occluder layers (${options.occluderNames.join(', ')}) at the same 1:1 position. Everything shown in Image ${occluderIndex} is an occluder and MUST be completely excluded from your output.`,
    );
  }
  for (const [i, ref] of options.references.entries()) {
    lines.push(
      `Image ${firstReference + i} is a positive visual reference (${ref.name}). Use it for: ${ref.usage.trim() || 'appearance and structure of the target component'}. Do not copy its framing, position, background, or unrelated objects.`,
    );
  }
  lines.push(
    '',
    `Task: Extract and complete ONLY the clean, continuous ${target} on a fully transparent RGBA PNG background at the exact same 1:1 position, scale, linework, and shading as ${sourceRef}. Follow the true natural silhouette and linework in ${sourceRef}` +
      (guideMarks.length ? `—do NOT follow the rough brush outline of Image ${guide}, do NOT retain jagged spillover fragments from adjacent parts or background, seamlessly reconstruct any occluded sections, and leave zero blue or orange guide tint.` : '. Seamlessly reconstruct occluded sections.'),
  );
  if (note) lines.push('', `Artist note: ${note}`);
  return lines.join('\n');
}

async function renderLocalPng(image: Raster, width: number, height: number): Promise<Blob> {
  if (width === image.width && height === image.height) return png(image);
  const src = new OffscreenCanvas(image.width, image.height);
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const dst = new OffscreenCanvas(width, height);
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return dst.convertToBlob({ type: 'image/png' });
}

async function encodeLocalInputs(images: Raster[], frame: Rect, maxPixels: number, signal: AbortSignal) {
  const initialScale = Math.min(1, Math.sqrt(Math.max(1, maxPixels) / Math.max(1, frame.width * frame.height)));
  let width = Math.max(1, Math.round(frame.width * initialScale));
  let height = Math.max(1, Math.round(frame.height * initialScale));
  while (true) {
    const blobs = [];
    for (const image of images) {
      signal.throwIfAborted();
      const blob = await renderLocalPng(image, width, height);
      if (blob.size > MAX_INPUT_BYTES) break;
      blobs.push(blob);
    }
    if (blobs.length === images.length) return { width, height, blobs };
    // Keep every spatial guide at the same natural aspect ratio when a PNG exceeds the route byte limit.
    width = Math.max(1, Math.floor(width * 0.8));
    height = Math.max(1, Math.floor(height * 0.8));
  }
}

/** Generate in a canvas-clamped frame (full canvas or local crop) preserving natural aspect ratio. */
export async function requestTargetedReroll(
  services: ApplicationServices,
  p: LayerProject,
  model: CatalogModel,
  occluders: readonly StackLayer[],
  signal: AbortSignal,
  notice: (s: string) => void,
  framing: ScalpelFraming = 'auto',
  source = scalpelSource(p.reference, p.layers, p.scalpelLayerIds),
): Promise<RerollCandidate> {
  const { raster: reference, layers } = source;
  if (layers && !layers.length) throw new Error('请先选择补画图层');
  if (layers?.some(l => occluders.some(o => o.id === l.id))) throw new Error('补画底图与排除遮挡不能使用同一图层');
  const unmarkedLayers = !!layers && !p.alpha.some(Boolean) && !p.occluded?.some(Boolean);
  const layerBounds = unmarkedLayers ? alphaBounds(reference) : undefined;
  if (unmarkedLayers && !layerBounds) throw new Error('所选图层在画布内没有可补画的像素');
  const frame = scalpelFrame(p, { mode: framing, model, layerBounds });
  const rect = editRect(frame, reference);
  const isFullCanvas =
    frame.x === 0 &&
    frame.y === 0 &&
    frame.width === p.reference.width &&
    frame.height === p.reference.height;
  const sources = new Map(referenceSources(p).map(s => [s.picture, s]));
  const excluded = new Set(occluders.map(l => layerPictureId(l.id)));
  const references = (p.scalpelReferences ?? []).map(({ picture, usage }) => {
    const source = sources.get(picture);
    if (!source) throw new Error('参考图已移除，请重新选择');
    if (excluded.has(picture)) throw new Error(`「${source.name}」同时被设为参考和排除遮挡，请选择一种用途`);
    return { source, name: source.name, usage };
  });
  const layout = scalpelInputs(model.maxImages, references.length, occluders.length > 0, unmarkedLayers);
  if (layout.issue) throw new Error(layout.issue);
  const run = await services.runTask(
    {
      id: crypto.randomUUID(),
      workspace: 'editor',
      sessionId: p.id,
      snapshot: { model: model.id, mode: 'targeted-reroll', framing, sourceLayers: layers?.map(l => l.id), occluders: occluders.map((l) => l.id), references: p.scalpelReferences ?? [] },
    },
    async (task) => {
      notice(isFullCanvas ? '正在按整图原比例编码并提交生成…' : '正在编码局部选区并提交生成…');
      const { resolution, options } = rerollRequestOptions(model, rect);
      const cleanLocal = crop(reference, rect);
      const blue = saveChannel(p.alpha, rect, p.reference.width);
      const orange = p.occluded ? saveChannel(p.occluded, rect, p.reference.width) : undefined;
      const workspace = unmarkedLayers ? cleanLocal : buildTransparentWorkspace(cleanLocal, blue, orange);

      const job = targetedRerollPrompt(p, {
        layout,
        occluderNames: occluders.map((l) => l.name),
        references,
        sourceLayers: layers?.map(l => [...(l.groups ?? []), l.name].join(' / ')),
        hasBlue: blue.some(Boolean),
        hasOrange: !!orange?.some(Boolean),
      });

      const spatial = layout.context ? [cleanLocal, workspace] : [workspace];
      if (occluders.length) {
        const occFull = compositeLayers(occluders, p.reference.width, p.reference.height, { includeHidden: true });
        spatial.push(crop(occFull, rect));
      }
      const { width: inputWidth, height: inputHeight, blobs } = await encodeLocalInputs(
        spatial,
        rect,
        model.sourceMaxPixels,
        task.signal,
      );
      for (const { source } of references) {
        task.signal.throwIfAborted();
        blobs.push((await fitReference(referenceBlob(source), source.name, { preserveAlpha: true })).blob);
      }

      if (blobs.reduce((sum, b) => sum + b.size, 0) > MAX_TOTAL_BYTES) {
        throw new Error('补画参考图合计超过连接上限');
      }
      const inputs = await Promise.all(blobs.map(dataUrl));
      const payload: ImagePayload = buildChatPayload(model, job, options, inputs);
      task.signal.throwIfAborted();

      let route = routeLabel(model),
        actualModel = model.name;
      const output = await task.execute(
        model,
        payload,
        async (r, native, s) => {
          notice('已收到结果，正在解码透明图层…');
          const blocks = await consumeMedia(r, native, s, payload);
          const image = blocks.find((b) => b.type === 'image');
          if (!image) throw new Error('模型响应中没有图片');
          return image;
        },
        {
          signal: task.signal,
          onlyConnection: p.rerollConnection,
          onNotice: notice,
          onSource: (source) => {
            route = routeLabel(source.model);
            actualModel = source.model.name;
          },
        },
      );
      task.signal.throwIfAborted();
      const decoded = await decodeLayerBlob(output.value.blob);
      const fullCanvas = placeScalpelReply(decoded, rect, reference);
      const box = alphaBounds(fullCanvas) ?? rect;
      const preview = crop(fullCanvas, box);
      let transparent = false;
      for (let i = 3; i < preview.data.length; i += 4) {
        if (preview.data[i] < 250) {
          transparent = true;
          break;
        }
      }
      let overlayRaster: Raster | undefined;
      let overlayPreview: Raster | undefined;
      let overlayBox: Rect | undefined;
      if (p.alpha.some(Boolean)) {
        overlayRaster = {
          width: fullCanvas.width,
          height: fullCanvas.height,
          data: fullCanvas.data.slice(),
        };
        restoreScalpelSurface(overlayRaster, { reference, alpha: p.alpha, occluded: p.occluded }, rect);
        overlayBox = alphaBounds(overlayRaster) ?? box;
        overlayPreview = crop(overlayRaster, overlayBox);
      }
      return {
        id: crypto.randomUUID(),
        model: actualModel,
        route,
        sourceReference: layers ? reference : undefined,
        prompt: job,
        raster: fullCanvas,
        preview,
        box,
        overlayRaster,
        overlayPreview,
        overlayBox,
        blob: output.value.blob,
        resolution: {
          frameWidth: rect.width,
          frameHeight: rect.height,
          inputWidth,
          inputHeight,
          requested: resolution?.value,
          width: decoded.width,
          height: decoded.height,
          framing: isFullCanvas ? ('full' as const) : ('local' as const),
        },
        transparent,
      };
    },
    signal,
  );
  if (run.status !== 'completed') {
    throw new Error(
      run.status === 'busy'
        ? '其他图像任务正在运行，完成后可在这里生成。'
        : '应用正在维护数据，请稍后重试。',
    );
  }
  return run.value;
}
