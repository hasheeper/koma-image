import type { MaskBitmap } from '../native/edit-input.ts';

export const BOUNDARY_COLOR_VERSION = 1;
export interface BoundaryMatchSummary { regions: number; matched: number }
const linear = Float64Array.from({ length: 256 }, (_, n) => n / 255 <= .04045 ? n / 3294.6 : ((n / 255 + .055) / 1.055) ** 2.4);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const encoded = (n: number) => 255 * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055);

/** Mutates only the replacement, never the source. Two bounded raster passes
 * assign disjoint boundary rings; nearby regions never receive two corrections. */
export function matchBoundaryColor(source: Uint8ClampedArray, result: Uint8ClampedArray,
  mask: MaskBitmap, alpha: Uint8ClampedArray, band: number): BoundaryMatchSummary {
  const { width: w, height: h, bits } = mask, n = w * h;
  if (source.length !== n * 4 || result.length !== n * 4 || alpha.length !== n) throw new Error('色彩对齐尺寸不一致');
  const labels = new Uint16Array(n), parents = [0];
  const selected = (p: number) => !!(bits[p >> 3] & 1 << (p & 7));
  const root = (id: number): number => { while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id]; } return id; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!selected(p)) continue;
    const left = x ? labels[p - 1] : 0, up = y ? labels[p - w] : 0;
    if (left && up) { const a = root(left), b = root(up); parents[b] = a; labels[p] = a; }
    else if (left || up) labels[p] = left || up;
    else {
      // Highly fragmented masks degrade conservatively rather than allocating
      // unbounded per-component objects or silently merging unrelated regions.
      if (parents.length >= 4096) return { regions: parents.length - 1, matched: 0 };
      labels[p] = parents.length; parents.push(parents.length);
    }
  }
  const regions = new Set<number>();
  for (let p = 0; p < n; p++) if (labels[p]) { labels[p] = root(labels[p]); regions.add(labels[p]); }
  const distance = new Uint16Array(n); distance.fill(65535);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!labels[p]) continue;
    // Canvas edges alone are not evidence of a background boundary (full masks).
    if (x && !selected(p - 1) || x + 1 < w && !selected(p + 1) || y && !selected(p - w) || y + 1 < h && !selected(p + w)) distance[p] = 0;
    else labels[p] = 0;
  }
  band = clamp(Math.ceil(band), 3, 64);
  const extent = band * 4;
  const visit = (p: number, q: number) => {
    const d = distance[q] + 1;
    if (d < distance[p] && d <= extent) { distance[p] = d; labels[p] = labels[q]; }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (x) visit(p, p - 1); if (y) visit(p, p - w); }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const p = y * w + x; if (x + 1 < w) visit(p, p + 1); if (y + 1 < h) visit(p, p + w); }
  const stats = new Map<number, { count: number; sums: Float64Array; squares: Float64Array }>();
  for (let p = 0; p < n; p++) {
    if (!labels[p] || distance[p] > band) continue;
    const at = p * 4;
    if (source[at + 3] < 250 || result[at + 3] < 250) continue;
    const extreme = (a: Uint8ClampedArray) => Math.max(a[at], a[at + 1], a[at + 2]) < 3 || Math.min(a[at], a[at + 1], a[at + 2]) > 252;
    if (extreme(source) || extreme(result)) continue;
    let s = stats.get(labels[p]);
    if (!s) { s = { count: 0, sums: new Float64Array(6), squares: new Float64Array(6) }; stats.set(labels[p], s); }
    s.count++;
    for (let c = 0; c < 6; c++) { const value = linear[(c < 3 ? source : result)[at + c % 3]]; s.sums[c] += value; s.squares[c] += value * value; }
  }
  const corrections = new Map<number, { gain: number[]; offset: number[] }>();
  for (const [id, s] of stats) {
    if (s.count < 12) continue;
    const gain: number[] = [], offset: number[] = [];
    for (let c = 0; c < 3; c++) {
      const a = s.sums[c] / s.count, b = s.sums[c + 3] / s.count;
      const sa = Math.sqrt(Math.max(0, s.squares[c] / s.count - a * a));
      const sb = Math.sqrt(Math.max(0, s.squares[c + 3] / s.count - b * b));
      gain[c] = sa < .008 || sb < .008 ? 1 : clamp(sa / sb, .8, 1.25);
      offset[c] = clamp(a - b * gain[c], -.12, .12);
    }
    corrections.set(id, { gain, offset });
  }
  for (let p = 0; p < n; p++) {
    if (!alpha[p] || !result[p * 4 + 3]) continue;
    const c = corrections.get(labels[p]); if (!c) continue;
    const strength = Math.max(0, 1 - distance[p] / extent), at = p * 4;
    for (let channel = 0; channel < 3; channel++) {
      const before = linear[result[at + channel]], after = clamp(before * c.gain[channel] + c.offset[channel], 0, 1);
      result[at + channel] = encoded(before + (after - before) * strength);
    }
  }
  return { regions: regions.size, matched: corrections.size };
}
