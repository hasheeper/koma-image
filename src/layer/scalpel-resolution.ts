import type { CatalogModel } from '../domain/catalog.ts';
import { seedreamLimits } from '../domain/seedream.ts';
import { alignRasterToReference } from './align.ts';
import { placeOnCanvas } from './images.ts';
import { crop, bounds, type LayerProject, type Raster, type Rect } from './project.ts';

export type ScalpelFraming = 'auto' | 'full' | 'local';

/** Expand a rect inside [0, maxW] x [0, maxH] to approach `targetRatio` without ever leaving the canvas. */
function fitAspectInsideCanvas(rect: Rect, targetRatio: number, maxW: number, maxH: number): Rect {
  let { x, y, width, height } = rect;
  const curRatio = width / Math.max(1, height);
  if (curRatio < targetRatio) {
    const desiredW = Math.min(maxW, Math.round(height * targetRatio));
    const cx = x + width / 2;
    x = Math.max(0, Math.min(maxW - desiredW, Math.round(cx - desiredW / 2)));
    width = desiredW;
  } else if (curRatio > targetRatio) {
    const desiredH = Math.min(maxH, Math.round(width / targetRatio));
    const cy = y + height / 2;
    y = Math.max(0, Math.min(maxH - desiredH, Math.round(cy - desiredH / 2)));
    height = desiredH;
  }
  return { x, y, width, height };
}

/**
 * Compute the send frame strictly inside the master canvas (ZERO out-of-bounds transparent padding).
 * - `'full'` or large painted region in `'auto'` uses the full canvas at its natural aspect ratio.
 * - `'local'` or small painted region in `'auto'` uses a tightly clamped local crop inside the canvas.
 */
export function scalpelFrame(
  p: Pick<LayerProject, 'alpha' | 'occluded' | 'reference'>,
  options?: { mode?: ScalpelFraming; model?: CatalogModel; layerBounds?: Rect },
): Rect {
  const refW = p.reference.width;
  const refH = p.reference.height;
  const visible = bounds(p.alpha, refW);
  const extend = p.occluded && bounds(p.occluded, refW);
  let box = visible ?? extend ?? options?.layerBounds;
  if (visible && extend) {
    const x = Math.min(visible.x, extend.x),
      y = Math.min(visible.y, extend.y);
    box = {
      x,
      y,
      width: Math.max(visible.x + visible.width, extend.x + extend.width) - x,
      height: Math.max(visible.y + visible.height, extend.y + extend.height) - y,
    };
  }
  if (!box) throw new Error('请先涂抹需要局部补画的区域');

  const mode = options?.mode ?? 'auto';
  const coversMajorCanvas =
    box.width >= refW * 0.45 ||
    box.height >= refH * 0.45 ||
    box.width * box.height >= refW * refH * 0.25;
  if (mode === 'full' || (mode === 'auto' && coversMajorCanvas)) {
    return { x: 0, y: 0, width: refW, height: refH };
  }

  const marginX = Math.max(48, Math.round(box.width * 0.35));
  const marginY = Math.max(48, Math.round(box.height * 0.35));
  const left = Math.max(0, box.x - marginX);
  const top = Math.max(0, box.y - marginY);
  const right = Math.min(refW, box.x + box.width + marginX);
  const bottom = Math.min(refH, box.y + box.height + marginY);
  let local: Rect = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };

  const model = options?.model;
  const supportsCustomSeedream =
    !!model &&
    (model.family === 'seedream' || model.provider === 'seedream') &&
    !!model.fields.size?.allowCustom;

  if (supportsCustomSeedream) {
    const ratio = local.width / Math.max(1, local.height);
    if (ratio < 0.25) local = fitAspectInsideCanvas(local, 0.25, refW, refH);
    else if (ratio > 4) local = fitAspectInsideCanvas(local, 4, refW, refH);
    return local;
  }

  const naturalRatio = local.width / Math.max(1, local.height);
  const presetChoice =
    closestAspectOption(model?.fields.aspect_ratio?.options, naturalRatio) ??
    closestAspectOption(model?.fields.size?.options, naturalRatio);
  if (presetChoice) {
    local = fitAspectInsideCanvas(local, presetChoice.ratio, refW, refH);
  }
  return local;
}

function parseDimensions(value: string): { width: number; height: number } | undefined {
  const px = /^(\d+)x(\d+)$/i.exec(value);
  if (px) return { width: Number(px[1]), height: Number(px[2]) };
  const tier = /^(\d+(?:\.\d+)?)K$/i.exec(value);
  if (tier) {
    const side = Math.round(Number(tier[1]) * 1024);
    return { width: side, height: side };
  }
  return undefined;
}

export function parseAspectRatio(value: string): number | undefined {
  const ratio = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (ratio) {
    const a = Number(ratio[1]);
    const b = Number(ratio[2]);
    if (a > 0 && b > 0) return a / b;
  }
  const dims = parseDimensions(value);
  if (dims && dims.width > 0 && dims.height > 0) return dims.width / dims.height;
  return undefined;
}

export function closestAspectOption(
  options: readonly string[] | undefined,
  targetRatio: number,
): { value: string; ratio: number } | undefined {
  if (!options?.length || !(targetRatio > 0)) return undefined;
  let best: { value: string; ratio: number; diff: number } | undefined;
  for (const value of options) {
    const ratio = parseAspectRatio(value);
    if (!ratio) continue;
    const diff = Math.abs(Math.log(ratio / targetRatio));
    if (!best || diff < best.diff) best = { value, ratio, diff };
  }
  return best ? { value: best.value, ratio: best.ratio } : undefined;
}

export interface ScalpelResolutionChoice {
  key: string;
  value: string;
  width: number;
  height: number;
  side: number;
  aspectRatio?: string;
}

/** Pick an output resolution matching the frame's natural aspect ratio (never forces portrait/landscape into 1:1). */
export function scalpelResolution(
  model: CatalogModel,
  frame: number | Pick<Rect, 'width' | 'height'>,
): ScalpelResolutionChoice | undefined {
  const frameW = typeof frame === 'number' ? frame : Math.max(1, frame.width);
  const frameH = typeof frame === 'number' ? frame : Math.max(1, frame.height);
  const targetRatio = frameW / frameH;
  const fields = model.fields;
  const key = ['image_size', 'output_size', 'size'].find((k) => fields[k]);
  const aspectChoice = closestAspectOption(fields.aspect_ratio?.options, targetRatio);
  if (!key) return undefined;

  const field = fields[key];
  const seedream = model.family === 'seedream' || model.provider === 'seedream';
  const limits = seedream ? seedreamLimits(model.templateId ?? model.id) : undefined;

  // Custom WxH Seedream route (e.g. Seedream 5.5): preserve exact frame aspect ratio within pixel budget.
  if (key === 'size' && field.allowCustom && seedream) {
    const tierSides = [...new Set([...field.options, field.default])]
      .map((v) => parseDimensions(v))
      .filter((d): d is { width: number; height: number } => !!d && d.width === d.height && d.width > 0)
      .map((d) => d.width);
    const maxTierSide = tierSides.length ? Math.max(...tierSides) : 2048;
    const maxArea = limits?.maxPixels ?? maxTierSide * maxTierSide;
    const minArea = limits?.minPixels ?? 1024 * 1024;
    const clampedRatio = Math.max(1 / 16, Math.min(16, targetRatio));
    const frameArea = frameW * frameH;
    const targetArea = Math.max(minArea, Math.min(maxArea, frameArea));
    const idealW = Math.sqrt(targetArea * clampedRatio);
    const idealH = Math.sqrt(targetArea / clampedRatio);

    let w = Math.max(64, Math.round(idealW / 16) * 16);
    let h = Math.max(64, Math.round(idealH / 16) * 16);
    while (w * h > maxArea && (w > 64 || h > 64)) {
      if (w >= h && w > 64) w -= 16;
      else if (h > 64) h -= 16;
      else break;
    }
    while (w * h < minArea) {
      if (w / h <= clampedRatio) w += 16;
      else h += 16;
    }
    if (w * h > maxArea) {
      if (w >= h && w > 64) w -= 16;
      else if (h > 64) h -= 16;
    }
    return { key, value: `${w}x${h}`, width: w, height: h, side: Math.max(w, h) };
  }

  // Discrete WxH preset options (e.g. OpenAI Images 1024x1024, 1024x1536, 1536x1024): match closest aspect ratio.
  const explicit = [...new Set([...field.options, field.default])]
    .map((value) => ({ value, dims: parseDimensions(value), isExplicitPx: /^\d+x\d+$/i.test(value) }))
    .filter((c): c is { value: string; dims: { width: number; height: number }; isExplicitPx: boolean } =>
      !!c.dims && c.dims.width > 0 && c.dims.height > 0 &&
      (!limits || (c.dims.width * c.dims.height >= limits.minPixels && c.dims.width * c.dims.height <= limits.maxPixels)),
    );

  if (explicit.some((c) => c.isExplicitPx)) {
    const pxChoices = explicit.filter((c) => c.isExplicitPx);
    pxChoices.sort((a, b) => {
      const diffA = Math.abs(Math.log(a.dims.width / a.dims.height / targetRatio));
      const diffB = Math.abs(Math.log(b.dims.width / b.dims.height / targetRatio));
      if (Math.abs(diffA - diffB) > 0.02) return diffA - diffB;
      return b.dims.width * b.dims.height - a.dims.width * a.dims.height;
    });
    const best = pxChoices[0];
    return {
      key,
      value: best.value,
      width: best.dims.width,
      height: best.dims.height,
      side: Math.max(best.dims.width, best.dims.height),
      ...(aspectChoice ? { aspectRatio: aspectChoice.value } : {}),
    };
  }

  // Tiered K-sizes (e.g. Gemini 1K / 2K / 4K): pick smallest tier covering longest frame side, preserving higher default.
  const defaultSide = parseDimensions(field.default)?.width ?? 0;
  const targetSide = Math.max(frameW, frameH, defaultSide, 1024);
  const tiers = explicit
    .map((c) => ({ value: c.value, side: Math.max(c.dims.width, c.dims.height) }))
    .sort((a, b) => a.side - b.side);
  const chosen = tiers.find((c) => c.side >= targetSide) ?? tiers.at(-1);
  if (!chosen) return undefined;
  return {
    key,
    value: chosen.value,
    width: chosen.side,
    height: chosen.side,
    side: chosen.side,
    ...(aspectChoice ? { aspectRatio: aspectChoice.value } : {}),
  };
}

/**
 * Map a model reply onto the full reference canvas WITHOUT non-uniform X/Y stretching.
 * - Native 1:1 dimensions preserve exact straight RGBA bytes.
 * - Aspect-matched replies map directly to `frame`.
 * - Aspect-mismatched replies auto-align uniformly against the reference (fallback: uniform centered fit).
 */
export function placeScalpelReply(reply: Raster, frame: Rect, reference: Raster): Raster {
  if (reply.width === frame.width && reply.height === frame.height) {
    return crop(reply, { x: -frame.x, y: -frame.y, width: reference.width, height: reference.height });
  }
  const replyRatio = reply.width / Math.max(1, reply.height);
  const frameRatio = frame.width / Math.max(1, frame.height);
  const aspectDiff = Math.abs(replyRatio - frameRatio) / Math.max(replyRatio, frameRatio);
  if (aspectDiff <= 0.025) {
    return placeOnCanvas(reply, frame, reference.width, reference.height);
  }
  // Never stretch X and Y non-uniformly when the model returns a different aspect ratio.
  const refClip: Rect = {
    x: Math.max(0, frame.x),
    y: Math.max(0, frame.y),
    width: Math.min(reference.width, frame.x + frame.width) - Math.max(0, frame.x),
    height: Math.min(reference.height, frame.y + frame.height) - Math.max(0, frame.y),
  };
  if (refClip.width > 0 && refClip.height > 0) {
    const aligned = alignRasterToReference(reply, crop(reference, refClip));
    if (aligned.matched) {
      const tight = crop(reply, aligned.sourceBox);
      return placeOnCanvas(
        tight,
        {
          x: refClip.x + aligned.rect.x,
          y: refClip.y + aligned.rect.y,
          width: aligned.rect.width,
          height: aligned.rect.height,
        },
        reference.width,
        reference.height,
      );
    }
  }
  // Uniform fit centered inside frame (preserves true reply aspect ratio).
  const scale = Math.min(frame.width / reply.width, frame.height / reply.height);
  const fitW = Math.max(1, Math.round(reply.width * scale));
  const fitH = Math.max(1, Math.round(reply.height * scale));
  return placeOnCanvas(
    reply,
    {
      x: frame.x + Math.floor((frame.width - fitW) / 2),
      y: frame.y + Math.floor((frame.height - fitH) / 2),
      width: fitW,
      height: fitH,
    },
    reference.width,
    reference.height,
  );
}

/** The blue guide protects existing details inside the AI cutout. Orange has priority at overlapping strokes. */
export function restoreScalpelSurface(
  result: Raster,
  p: Pick<LayerProject, 'reference' | 'alpha' | 'occluded'>,
  area: Rect,
) {
  const src = p.reference.data, dst = result.data;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const i = y * result.width + x, k = i * 4;
      const keep = p.alpha[i];
      if (!keep || !src[k + 3] || !dst[k + 3] || p.occluded?.[i]) continue;
      const srcA = Math.min(src[k + 3], dst[k + 3]);
      if (keep === 255) {
        dst[k] = src[k];
        dst[k + 1] = src[k + 1];
        dst[k + 2] = src[k + 2];
        dst[k + 3] = srcA;
        continue;
      }
      // Crossfade in premultiplied alpha to retain coverage on antialiased hair without expanding past AI cutout.
      const original = srcA * keep, generated = dst[k + 3] * (255 - keep);
      const sum = original + generated;
      for (let c = 0; c < 3; c++) dst[k + c] = Math.round((src[k + c] * original + dst[k + c] * generated) / sum);
      dst[k + 3] = Math.round(sum / 255);
    }
  }
}
