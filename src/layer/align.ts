import { alphaBounds, crop, type Raster, type Rect } from './project.ts';

export interface AlignmentResult {
  /** Tight non-transparent crop inside the source raster that was matched. */
  sourceBox: Rect;
  /** Target integer rectangle on the reference canvas. */
  rect: Rect;
  /** Combined match score in [0, 1]. */
  confidence: number;
  /** True when the template matched a distinct location on the reference. */
  matched: boolean;
}

interface SamplePoint {
  /** Normalized position in [0, 1] across the tight template width/height. */
  u: number;
  v: number;
  /** Offset in template pixels for integer grid evaluation. */
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  dr: number;
  dg: number;
  db: number;
}

interface TemplateSamples {
  points: SamplePoint[];
  norm: number;
  textured: boolean;
}

/** Fast area-sampled downsample (pure TS, straight RGBA). */
function downsample(src: Raster, width: number, height: number): Raster {
  if (src.width === width && src.height === height) return src;
  const out = new Uint8Array(width * height * 4);
  const sx = src.width / width;
  const sy = src.height / height;
  const srcData = src.data;
  const sw = src.width;

  for (let oy = 0; oy < height; oy++) {
    const y0 = oy * sy;
    const y1 = Math.min(src.height, (oy + 1) * sy);
    const ySteps = Math.max(1, Math.min(4, Math.ceil(y1 - y0)));
    for (let ox = 0; ox < width; ox++) {
      const x0 = ox * sx;
      const x1 = Math.min(sw, (ox + 1) * sx);
      const xSteps = Math.max(1, Math.min(4, Math.ceil(x1 - x0)));
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
      for (let iy = 0; iy < ySteps; iy++) {
        const py = Math.min(src.height - 1, Math.floor(y0 + ((iy + 0.5) * (y1 - y0)) / ySteps));
        const row = py * sw;
        for (let ix = 0; ix < xSteps; ix++) {
          const px = Math.min(sw - 1, Math.floor(x0 + ((ix + 0.5) * (x1 - x0)) / xSteps));
          const k = (row + px) * 4;
          const a = srcData[k + 3];
          sumA += a;
          sumR += srcData[k] * a;
          sumG += srcData[k + 1] * a;
          sumB += srcData[k + 2] * a;
          count++;
        }
      }
      const dstK = (oy * width + ox) * 4;
      const avgA = Math.round(sumA / count);
      if (avgA > 0 && sumA > 0) {
        out[dstK] = Math.round(sumR / sumA);
        out[dstK + 1] = Math.round(sumG / sumA);
        out[dstK + 2] = Math.round(sumB / sumA);
        out[dstK + 3] = avgA;
      }
    }
  }
  return { width, height, data: out };
}

function fitMaxSide(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const s = maxSide / longest;
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Extract evenly distributed opaque sample points from a tight raster, favoring textured/edge points. */
function extractSamples(tpl: Raster, maxSamples: number): TemplateSamples {
  const { width: w, height: h, data } = tpl;
  const total = w * h;
  let alphaThreshold = 192;
  let opaqueCount = 0;
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] >= alphaThreshold) opaqueCount++;
  }
  if (opaqueCount < Math.min(16, total)) {
    alphaThreshold = 32;
    opaqueCount = 0;
    for (let i = 0; i < total; i++) {
      if (data[i * 4 + 3] >= alphaThreshold) opaqueCount++;
    }
  }
  if (!opaqueCount) return { points: [], norm: 0, textured: false };

  const grid = Math.max(2, Math.round(Math.sqrt(maxSamples)));
  const cellW = w / grid;
  const cellH = h / grid;
  const chosen: { x: number; y: number; r: number; g: number; b: number }[] = [];

  if (opaqueCount <= maxSamples) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        if (data[k + 3] >= alphaThreshold) {
          chosen.push({ x, y, r: data[k], g: data[k + 1], b: data[k + 2] });
        }
      }
    }
  } else {
    for (let gy = 0; gy < grid; gy++) {
      const y0 = Math.floor(gy * cellH);
      const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((gy + 1) * cellH)));
      for (let gx = 0; gx < grid; gx++) {
        const x0 = Math.floor(gx * cellW);
        const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((gx + 1) * cellW)));
        let bestX = -1, bestY = -1, bestScore = -1;
        const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
        const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
        for (let y = y0; y < y1; y += stepY) {
          for (let x = x0; x < x1; x += stepX) {
            const k = (y * w + x) * 4;
            if (data[k + 3] < alphaThreshold) continue;
            // Local color gradient highlights edges and interior details.
            let grad = 0;
            if (x + 1 < w && data[k + 7] >= alphaThreshold) {
              grad += Math.abs(data[k] - data[k + 4]) + Math.abs(data[k + 1] - data[k + 5]) + Math.abs(data[k + 2] - data[k + 6]);
            }
            if (y + 1 < h && data[k + w * 4 + 3] >= alphaThreshold) {
              const down = k + w * 4;
              grad += Math.abs(data[k] - data[down]) + Math.abs(data[k + 1] - data[down + 1]) + Math.abs(data[k + 2] - data[down + 2]);
            }
            if (grad > bestScore) {
              bestScore = grad;
              bestX = x;
              bestY = y;
            }
          }
        }
        if (bestX >= 0) {
          const k = (bestY * w + bestX) * 4;
          chosen.push({ x: bestX, y: bestY, r: data[k], g: data[k + 1], b: data[k + 2] });
        }
      }
    }
  }

  const n = chosen.length;
  if (!n) return { points: [], norm: 0, textured: false };

  let meanR = 0, meanG = 0, meanB = 0;
  for (const pt of chosen) {
    meanR += pt.r;
    meanG += pt.g;
    meanB += pt.b;
  }
  meanR /= n;
  meanG /= n;
  meanB /= n;

  let varSum = 0;
  const denomX = Math.max(1, w - 1);
  const denomY = Math.max(1, h - 1);
  const points: SamplePoint[] = chosen.map((pt) => {
    const dr = pt.r - meanR;
    const dg = pt.g - meanG;
    const db = pt.b - meanB;
    varSum += dr * dr + dg * dg + db * db;
    return {
      u: pt.x / denomX,
      v: pt.y / denomY,
      x: pt.x,
      y: pt.y,
      r: pt.r,
      g: pt.g,
      b: pt.b,
      dr,
      dg,
      db,
    };
  });
  const norm = Math.sqrt(varSum);
  // Treat a template as textured when RMS per-channel contrast exceeds ~4 / 255.
  const rms = Math.sqrt(varSum / (n * 3));
  return { points, norm, textured: rms >= 4 };
}

/**
 * Evaluate template match on `ref` at `(ox, oy)` scaled to `(tw, th)`.
 * Uses occlusion-tolerant robust inlier similarity combined with 3-channel RGB ZNCC.
 */
function scorePlacement(
  ref: Raster,
  samples: TemplateSamples,
  ox: number,
  oy: number,
  tw: number,
  th: number,
  useRobust: boolean,
  directGrid = false,
): number {
  const pts = samples.points;
  const n = pts.length;
  if (!n) return -1;
  const rw = ref.width;
  const rh = ref.height;
  const refData = ref.data;
  const spanW = Math.max(1, tw - 1);
  const spanH = Math.max(1, th - 1);

  let dot = 0;
  let sumR = 0, sumG = 0, sumB = 0;
  let sumSq = 0;
  let inlierSum = 0;
  let l1Sum = 0;
  let inBounds = 0;
  let opaqueHits = 0;

  for (let i = 0; i < n; i++) {
    const pt = pts[i];
    const px = directGrid ? ox + pt.x : Math.round(ox + pt.u * spanW);
    const py = directGrid ? oy + pt.y : Math.round(oy + pt.v * spanH);
    if (px < 0 || px >= rw || py < 0 || py >= rh) continue;
    inBounds++;
    const k = (py * rw + px) * 4;
    const ra = refData[k + 3];
    if (ra < 32) continue;
    opaqueHits++;
    const rr = refData[k];
    const rg = refData[k + 1];
    const rb = refData[k + 2];
    sumR += rr;
    sumG += rg;
    sumB += rb;
    sumSq += rr * rr + rg * rg + rb * rb;
    if (samples.textured) {
      dot += pt.dr * rr + pt.dg * rg + pt.db * rb;
    }
    const d = Math.abs(pt.r - rr) + Math.abs(pt.g - rg) + Math.abs(pt.b - rb);
    l1Sum += d;
    if (useRobust) {
      // Saturates at 0 beyond ~56/255 average channel diff so occluded regions exert zero pull.
      const sim = 1 - d / 168;
      if (sim > 0) inlierSum += sim;
    }
  }

  if (inBounds < n * 0.7 || opaqueHits < n * 0.45) return -1;
  const coverage = opaqueHits / n;

  if (!samples.textured) {
    const avgDist = l1Sum / (opaqueHits * 765);
    const colorSim = Math.max(0, 1 - avgDist);
    return colorSim * coverage;
  }

  // Exact ZNCC when all samples hit; approximate closely when partially cropped/transparent.
  const meanR = sumR / opaqueHits;
  const meanG = sumG / opaqueHits;
  const meanB = sumB / opaqueHits;
  const refVar = Math.max(0, sumSq - opaqueHits * (meanR * meanR + meanG * meanG + meanB * meanB));
  if (refVar < 1e-3) return -1;
  // Scale template norm proportionally if a few points fell outside bounds.
  const effTplNorm = samples.norm * Math.sqrt(coverage);
  const zncc = Math.max(-1, Math.min(1, dot / (effTplNorm * Math.sqrt(refVar))));

  if (!useRobust) {
    // Include a gentle color-consistency tie-breaker so inverted/wrong-hue patches never win.
    const colorCloseness = Math.max(0, 1 - l1Sum / (opaqueHits * 765));
    return (0.72 * Math.max(0, zncc) + 0.28 * colorCloseness) * coverage;
  }

  const robustSim = inlierSum / n;
  return (0.52 * Math.max(0, zncc) + 0.48 * robustSim) * coverage;
}

interface Peak {
  x: number;
  y: number;
  w: number;
  score: number;
}

function insertPeak(peaks: Peak[], candidate: Peak, limit: number) {
  // Suppress near-duplicates within the same coarse neighborhood & scale.
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i];
    const dist = Math.hypot(p.x - candidate.x, p.y - candidate.y);
    const scaleRatio = Math.max(p.w, candidate.w) / Math.max(1, Math.min(p.w, candidate.w));
    if (dist < Math.max(8, p.w * 0.25) && scaleRatio < 1.2) {
      if (candidate.score > p.score) peaks[i] = candidate;
      return;
    }
  }
  peaks.push(candidate);
  peaks.sort((a, b) => b.score - a.score);
  if (peaks.length > limit) peaks.length = limit;
}

/**
 * Automatically locate and scale `imported` onto `reference` using a 3-stage coarse-to-fine
 * masked RGB ZNCC + occlusion-tolerant inlier search.
 */
export function alignRasterToReference(imported: Raster, reference: Raster): AlignmentResult {
  const sourceBox = alphaBounds(imported) ?? { x: 0, y: 0, width: imported.width, height: imported.height };
  const tight = crop(imported, sourceBox);
  const refW = reference.width;
  const refH = reference.height;
  const aspect = tight.height / Math.max(1, tight.width);

  const fallbackRect: Rect = {
    x: Math.floor((refW - tight.width) / 2),
    y: Math.floor((refH - tight.height) / 2),
    width: tight.width,
    height: tight.height,
  };

  // Stage 1: Coarse multi-scale search on max 160px pyramid.
  const dim1 = fitMaxSide(refW, refH, 160);
  const ref1 = downsample(reference, dim1.width, dim1.height);
  const s1 = ref1.width / refW;

  const maxFitW1 = Math.min(ref1.width, Math.floor(ref1.height / aspect));
  const minW1 = Math.max(8, Math.round(Math.min(ref1.width, ref1.height) * 0.08));
  const maxW1 = Math.max(minW1, Math.round(maxFitW1 * 1.04));

  const widths1 = new Set<number>();
  for (let w = minW1; w <= maxW1; w = Math.max(w + 1, Math.round(w * 1.1))) {
    widths1.add(w);
  }
  widths1.add(maxFitW1);

  // Explicitly include exact 1:1 native scale and exact same-aspect full-canvas scale.
  const nativeW1 = Math.round(tight.width * s1);
  if (nativeW1 >= 6 && nativeW1 <= Math.round(ref1.width * 1.08)) widths1.add(nativeW1);
  const impAspect = imported.width / Math.max(1, imported.height);
  const refAspect = refW / Math.max(1, refH);
  const aspectDiff = Math.abs(impAspect - refAspect) / Math.max(impAspect, refAspect);
  const fullFrameScale = refW / Math.max(1, imported.width);
  if (aspectDiff <= 0.05) {
    const fullW1 = Math.max(6, Math.round(tight.width * fullFrameScale * s1));
    if (fullW1 <= Math.round(ref1.width * 1.08)) widths1.add(fullW1);
  }

  const peaks: Peak[] = [];
  let scoreSum = 0;
  let scoreCount = 0;
  let templateTextured = false;

  for (const tw of widths1) {
    const th = Math.max(1, Math.round(tw * aspect));
    if (tw < 4 || th < 4 || tw > ref1.width * 1.1 || th > ref1.height * 1.1) continue;
    const tpl1 = downsample(tight, tw, th);
    const samples1 = extractSamples(tpl1, 120);
    if (!samples1.points.length) continue;
    if (samples1.textured) templateTextured = true;

    const padX = Math.min(Math.round(tw * 0.08), 8);
    const padY = Math.min(Math.round(th * 0.08), 8);
    const minX = -padX;
    const maxX = Math.max(minX, ref1.width - tw + padX);
    const minY = -padY;
    const maxY = Math.max(minY, ref1.height - th + padY);
    const step = Math.max(2, Math.min(4, Math.round(Math.min(tw, th) / 10)));

    for (let oy = minY; oy <= maxY; oy += step) {
      for (let ox = minX; ox <= maxX; ox += step) {
        const sc = scorePlacement(ref1, samples1, ox, oy, tw, th, false, true);
        if (sc >= 0) {
          scoreSum += sc;
          scoreCount++;
          insertPeak(peaks, { x: ox, y: oy, w: tw, score: sc }, 6);
        }
      }
    }

    // Always test the exact full-frame position when aspect matches.
    if (aspectDiff <= 0.05 && Math.abs(tw - Math.round(tight.width * fullFrameScale * s1)) <= 1) {
      const fx = Math.round(sourceBox.x * fullFrameScale * s1);
      const fy = Math.round(sourceBox.y * fullFrameScale * s1);
      const sc = scorePlacement(ref1, samples1, fx, fy, tw, th, false, true);
      if (sc >= 0) insertPeak(peaks, { x: fx, y: fy, w: tw, score: sc }, 6);
    }
  }

  if (!peaks.length) {
    return { sourceBox, rect: fallbackRect, confidence: 0, matched: false };
  }

  const avgCoarse = scoreCount ? scoreSum / scoreCount : 0;

  // Stage 2: Medium refinement on max 480px pyramid with occlusion-tolerant scoring.
  const dim2 = fitMaxSide(refW, refH, 480);
  const ref2 = downsample(reference, dim2.width, dim2.height);
  const s2 = ref2.width / refW;
  const s1To2 = ref2.width / ref1.width;

  const midSamplesCache = new Map<number, TemplateSamples>();
  const getMidSamples = (tw: number, th: number) => {
    const key = tw * 65536 + th;
    let cached = midSamplesCache.get(key);
    if (!cached) {
      cached = extractSamples(downsample(tight, tw, th), 260);
      midSamplesCache.set(key, cached);
    }
    return cached;
  };

  let best2: Peak = {
    x: peaks[0].x * s1To2,
    y: peaks[0].y * s1To2,
    w: peaks[0].w * s1To2,
    score: -1,
  };

  for (const peak of peaks.slice(0, 5)) {
    const baseW = Math.max(6, Math.round(peak.w * s1To2));
    const baseX = Math.round(peak.x * s1To2);
    const baseY = Math.round(peak.y * s1To2);
    const radius = Math.max(4, Math.ceil(s1To2 * 3.5));

    for (const mul of [0.91, 0.94, 0.97, 1.0, 1.03, 1.06, 1.09]) {
      const tw = Math.max(6, Math.round(baseW * mul));
      const th = Math.max(6, Math.round(tw * aspect));
      if (tw > ref2.width * 1.15 || th > ref2.height * 1.15) continue;
      const samples2 = getMidSamples(tw, th);
      if (!samples2.points.length) continue;
      const cx = baseX - Math.round((tw - baseW) / 2);
      const cy = baseY - Math.round((th - Math.round(baseW * aspect)) / 2);

      // Coarse step-2 scan around the peak, then step-1 around the local winner.
      let localBest: Peak = { x: cx, y: cy, w: tw, score: -1 };
      for (let dy = -radius; dy <= radius; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          const sc = scorePlacement(ref2, samples2, cx + dx, cy + dy, tw, th, true, true);
          if (sc > localBest.score) localBest = { x: cx + dx, y: cy + dy, w: tw, score: sc };
        }
      }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sc = scorePlacement(ref2, samples2, localBest.x + dx, localBest.y + dy, tw, th, true, true);
          if (sc > localBest.score) localBest = { x: localBest.x + dx, y: localBest.y + dy, w: tw, score: sc };
        }
      }
      if (localBest.score > best2.score) best2 = localBest;
    }
  }

  // Stage 3: Full-resolution coordinate descent directly against `reference` (zero large buffer allocations).
  const fullSamples = extractSamples(tight, 420);
  let fx = Math.round(best2.x / s2);
  let fy = Math.round(best2.y / s2);
  let fw = Math.max(1, Math.round(best2.w / s2));
  let fh = Math.max(1, Math.round(fw * aspect));
  let bestScore = scorePlacement(reference, fullSamples, fx, fy, fw, fh, true, false);

  // Also check exact full-frame alignment directly at full resolution when aspect matches.
  if (aspectDiff <= 0.03) {
    const ex = Math.round(sourceBox.x * fullFrameScale);
    const ey = Math.round(sourceBox.y * fullFrameScale);
    const ew = Math.max(1, Math.round(tight.width * fullFrameScale));
    const eh = Math.max(1, Math.round(tight.height * fullFrameScale));
    const exactScore = scorePlacement(reference, fullSamples, ex, ey, ew, eh, true, false);
    if (exactScore >= bestScore - 0.015) {
      fx = ex;
      fy = ey;
      fw = ew;
      fh = eh;
      bestScore = exactScore;
    }
  }

  const maxStep = Math.max(4, Math.min(24, Math.ceil(1 / s2) * 3));
  for (let step = maxStep; step >= 1; step = step > 2 ? Math.floor(step / 2) : step - 1) {
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 8) {
      improved = false;
      // Refine translation (x, y)
      for (const [dx, dy] of [
        [-step, 0],
        [step, 0],
        [0, -step],
        [0, step],
      ]) {
        const sc = scorePlacement(reference, fullSamples, fx + dx, fy + dy, fw, fh, true, false);
        if (sc > bestScore + 1e-4) {
          fx += dx;
          fy += dy;
          bestScore = sc;
          improved = true;
        }
      }
      // Refine scale (width, keeping center fixed)
      for (const dw of [-step * 2, step * 2]) {
        const nw = fw + dw;
        if (nw < 4 || nw > refW * 1.15) continue;
        const nh = Math.max(1, Math.round(nw * aspect));
        const nx = fx - Math.round((nw - fw) / 2);
        const ny = fy - Math.round((nh - fh) / 2);
        const sc = scorePlacement(reference, fullSamples, nx, ny, nw, nh, true, false);
        if (sc > bestScore + 1e-4) {
          fx = nx;
          fy = ny;
          fw = nw;
          fh = nh;
          bestScore = sc;
          improved = true;
        }
      }
    }
  }

  const confidence = Math.max(0, Math.min(1, bestScore));
  const distinctness = peaks[0].score - avgCoarse;
  const matched = templateTextured
    ? confidence >= 0.45
    : confidence >= 0.93 && distinctness >= 0.08;

  return {
    sourceBox,
    rect: matched ? { x: fx, y: fy, width: fw, height: fh } : fallbackRect,
    confidence,
    matched,
  };
}
