import type { ImageTagBinding } from './image-identity.ts';

export type AnnotationAreaShape = 'rect' | 'ellipse' | 'polygon';
export type AnnotationShape = AnnotationAreaShape | 'point';
export interface UnitPoint { x: number; y: number }
export interface UnitRect extends UnitPoint { w: number; h: number }
/** A point has an exact x/y anchor and zero w/h; it never implies an editing area. */
export interface RegionAnnotation { key: string; shape: AnnotationShape; bbox: UnitRect; points?: UnitPoint[]; comment: string }
export interface ImageAnnotations { image: ImageTagBinding; width: number; height: number; regions: RegionAnnotation[] }
export interface AnnotationEdges { dilate: number; feather: number }
export interface AnnotationSnapshot extends ImageAnnotations { edges: AnnotationEdges }
export const defaultAnnotationEdges: AnnotationEdges = { dilate: .006, feather: .003 };
export const annotationLimits = { regions: 32, points: 128, comment: 2000 } as const;
export const clampUnit = (n: number) => Math.max(0, Math.min(1, n));
export function pointsBox(points: readonly UnitPoint[]): UnitRect {
  if (!points.length) throw new Error('选区没有顶点');
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function regionUnion(regions: readonly RegionAnnotation[]): UnitRect {
  validateAnnotationAreas(regions);
  return pointsBox(regions.flatMap(r => [r.bbox, { x: r.bbox.x + r.bbox.w, y: r.bbox.y + r.bbox.h }]));
}
export function moveRegion(region: RegionAnnotation, dx: number, dy: number): RegionAnnotation {
  const { bbox: b } = region;
  dx = Math.max(-b.x, Math.min(1 - b.x - b.w, dx)); dy = Math.max(-b.y, Math.min(1 - b.y - b.h, dy));
  return { ...region, bbox: { ...b, x: b.x + dx, y: b.y + dy }, ...(region.points ? { points: region.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {}) };
}
export function resizeRegion(region: RegionAnnotation, box: UnitRect): RegionAnnotation {
  if (region.shape === 'point') throw new Error('点批注只能移动，不能缩放选区');
  const old = region.bbox;
  const points = region.points?.map(p => ({ x: box.x + (p.x - old.x) / old.w * box.w, y: box.y + (p.y - old.y) / old.h * box.h }));
  return { ...region, bbox: points ? pointsBox(points) : box, ...(points ? { points } : {}) };
}
const cross = (a: UnitPoint, b: UnitPoint, c: UnitPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function validateRegions(regions: readonly RegionAnnotation[], allowEmpty = false): void {
  if ((!allowEmpty && !regions.length) || regions.length > annotationLimits.regions) throw new Error('请选择 1～32 个区域');
  const keys = new Set<string>();
  for (const r of regions) {
    if (!r.key || keys.has(r.key)) throw new Error('选区身份无效');
    keys.add(r.key);
    const b = r.bbox;
    if (!['point', 'rect', 'ellipse', 'polygon'].includes(r.shape) || !b || ![b.x,b.y,b.w,b.h].every(Number.isFinite) || b.x < 0 || b.y < 0 || b.x > 1 || b.y > 1 || b.w < 0 || b.h < 0 || b.x + b.w > 1 + 1e-8 || b.y + b.h > 1 + 1e-8) throw new Error('批注坐标超出图片');
    if (r.shape === 'point' ? b.w !== 0 || b.h !== 0 || r.points !== undefined : b.w === 0 || b.h === 0) throw new Error('点批注不包含选区面积，形状选区的面积不能为空');
    if (typeof r.comment !== 'string' || r.comment.length > annotationLimits.comment) throw new Error('每处批注最多 2000 字');
    if (r.shape !== 'polygon') continue;
    const p = r.points;
    if (!p || p.length < 3 || p.length > annotationLimits.points || p.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1)) throw new Error('多边形需要 3～128 个有效顶点');
    const actual = pointsBox(p);
    if (Object.keys(actual).some(k => Math.abs(actual[k as keyof UnitRect] - b[k as keyof UnitRect]) > 1e-8)) throw new Error('多边形坐标不一致');
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], z = p[(i + 1) % p.length];
      area += a.x * z.y - z.x * a.y;
      if (a.x === z.x && a.y === z.y) throw new Error('多边形有重复顶点');
      for (let j = i + 2; j < p.length; j++) {
        if (i === 0 && j === p.length - 1) continue;
        const c = p[j], d = p[(j + 1) % p.length];
        if (cross(a,z,c) * cross(a,z,d) <= 0 && cross(c,d,a) * cross(c,d,z) <= 0 && Math.max(Math.min(a.x,z.x),Math.min(c.x,d.x)) <= Math.min(Math.max(a.x,z.x),Math.max(c.x,d.x)) && Math.max(Math.min(a.y,z.y),Math.min(c.y,d.y)) <= Math.min(Math.max(a.y,z.y),Math.max(c.y,d.y))) throw new Error('多边形边不能相交');
      }
    }
    if (Math.abs(area) < 1e-10) throw new Error('多边形面积为空');
  }
}
export const canMaskAnnotations = (regions: readonly RegionAnnotation[]) => regions.length > 0 && regions.every(r => r.shape !== 'point');
export function validateAnnotationAreas(regions: readonly RegionAnnotation[]): void {
  validateRegions(regions);
  if (!canMaskAnnotations(regions)) throw new Error('点批注没有选区范围，无法转为蒙版或局部回贴');
}
export function validateAnnotationSnapshot(value: AnnotationSnapshot): void {
  if (!value || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width <= 0 || value.height <= 0 || value.width * value.height > 32_000_000) throw new Error('批注图片尺寸无效');
  if (!value.image?.entity_key || !value.image.record_id || !value.image.scope?.id) throw new Error('批注来源无效');
  if (!value.edges || ![value.edges.dilate,value.edges.feather].every(n => Number.isFinite(n) && n >= 0 && n <= .025)) throw new Error('外扩和羽化需在短边的 0～2.5% 内');
  validateRegions(value.regions);
}
/** Same display direction; a near-square rounding discrepancy is still square. */
export function annotationAlignment(base: { width: number; height: number }, result: { width: number; height: number }) {
  if (![base.width, base.height, result.width, result.height].every(n => Number.isFinite(n) && n > 0)) return null;
  const ratio = base.width / base.height, other = result.width / result.height;
  const roundingSquare = Math.abs(ratio - 1) <= .015 + 1e-10 && Math.abs(other - 1) <= .015 + 1e-10;
  if (!roundingSquare && Math.sign(ratio-1) !== Math.sign(other-1) || Math.abs(other / ratio - 1) > .015 + 1e-10) return null;
  // A uniform cover transform absorbs only the accepted pixel-rounding margin.
  const scale = Math.max(base.width / result.width, base.height / result.height);
  return { scale, x: (base.width - result.width * scale) / 2, y: (base.height - result.height * scale) / 2, width: result.width * scale, height: result.height * scale };
}
/** Shared display/model projection; full geometry remains local for crop and masks. */
export function annotationSummary(regions: readonly RegionAnnotation[]) {
  const n3 = (n: number) => Math.round(n * 1000) / 1000;
  return regions.map((r, i) => ({ n: i + 1, shape: r.shape, x: n3(r.bbox.x), y: n3(r.bbox.y),
    ...(r.shape === 'point' ? {} : { w: n3(r.bbox.w), h: n3(r.bbox.h) }), comment: r.comment }));
}
export function annotationCrop(value: ImageAnnotations, n: number): [number, number, number, number] {
  if (!Number.isSafeInteger(n) || n < 1 || n > value.regions.length) throw new Error('批注编号不存在');
  const r = value.regions[n - 1];
  if (r.shape !== 'point') return [r.bbox.x * 100, r.bbox.y * 100, r.bbox.w * 100, r.bbox.h * 100];
  const side = Math.min(value.width, value.height) * .2, w = side / value.width, h = side / value.height;
  return [Math.max(0, Math.min(1 - w, r.bbox.x - w / 2)) * 100, Math.max(0, Math.min(1 - h, r.bbox.y - h / 2)) * 100, w * 100, h * 100];
}
export function annotationAnchor(r: RegionAnnotation): UnitPoint {
  if (r.shape === 'polygon') return r.points!.reduce((a, p) => p.y < a.y || p.y === a.y && p.x < a.x ? p : a);
  return { x: r.bbox.x + (r.shape === 'ellipse' ? r.bbox.w / 2 : 0), y: r.bbox.y };
}
/** Screen/image pixel tag geometry, shared by the live overlay and model guide. */
export function annotationTag(r: RegionAnnotation, n: number, width: number, height: number, unit = 1) {
  const a = annotationAnchor(r), w = (n > 9 ? 26 : 20) * unit, h = 20 * unit, gap = (r.shape === 'point' ? 16 : 5) * unit;
  let x = a.x * width - (r.shape === 'rect' ? unit : w / 2), y = a.y * height - gap - h;
  const below = y < 3 * unit;
  if (below) y = a.y * height + gap;
  x = Math.max(3 * unit, Math.min(width - w - 3 * unit, x));
  y = Math.max(3 * unit, Math.min(height - h - 3 * unit, y));
  return { x, y, w, h, below };
}
const percent = (n: number) => `${Math.round(n * 100)}%`;
const location = (b: UnitRect) => ['左上', '上方', '右上', '左侧', '中央', '右侧', '左下', '下方', '右下'][Math.min(2, Math.floor((b.y + b.h / 2) * 3)) * 3 + Math.min(2, Math.floor((b.x + b.w / 2) * 3))];
const bounds = (b: UnitRect) => `横向 ${percent(b.x)}–${percent(b.x+b.w)}，纵向 ${percent(b.y)}–${percent(b.y+b.h)}`;
export function annotationPrompt(regions: readonly RegionAnnotation[], dual = true, extra = '', painted?: UnitRect): string {
  validateRegions(regions, true);
  if (!regions.length && !painted) return extra;
  const point = regions.some(r => r.shape === 'point');
  const lines = dual
    ? [regions.length ? '图 1 是要修改的原图；图 2 是同尺寸的定位图，紫色线框和编号标出要改的位置，编号对应下面的批注。' : '图 1 是要修改的原图；图 2 是同尺寸的定位图，半透明紫色标出修改范围。', regions.length ? '请以图 1 为底，按批注修改：' : '请以图 1 为底，只修改紫色范围内的内容：']
    : ['请以输入图为底，按以下要求修改。位置按画面宽高的百分比给出，原点在左上角：'];
  lines.push(...regions.map((r, i) => `${i+1}. ${r.shape === 'point' ? '位置点' : `${r.shape === 'rect' ? '矩形' : r.shape === 'ellipse' ? '椭圆' : '多边形'}区域`}${dual ? '' : `，画面${location(r.bbox)}`}（${r.shape === 'point' ? `横向 ${percent(r.bbox.x)}，纵向 ${percent(r.bbox.y)}` : bounds(r.bbox)}）：${r.comment.trim() || (extra.trim() ? '按用户补充修改此处' : dual ? '按定位图修改此处' : '修改此处')}`));
  if (point) lines.push('点只标示位置，不代表修改范围，按文字判断要改的对象。');
  if (extra.trim()) lines.push(extra);
  if (painted) lines.push(`${regions.length ? '另有手绘修改范围' : '修改范围'}：${bounds(painted)}。`);
  lines.push(`除${regions.length ? '批注涉及' : '修改范围内'}的内容外，人物、构图、比例、分格和画风保持不变；画面方向与宽高比和${dual ? '图 1' : '原图'}一致，输出完整画面。`);
  if (dual) lines.push('图 2 仅用于定位，结果中不得出现紫色线框、填充或编号。');
  const text = lines.join('\n');
  if (text.length > 24_000) throw new Error('批注改图说明超过 24000 字符，请精简后再交接');
  return text;
}
const xml = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]!));
export function serializeAnnotations(value: ImageAnnotations, image = value.image.tag, guide?: string): string {
  validateRegions(value.regions);
  const num = (n: number) => n.toFixed(3);
  return [`<image_annotations version="2" image="${xml(image)}"${guide ? ` guide="${xml(guide)}"` : ''} units="0-1">`, ...annotationSummary(value.regions).map(r => r.shape === 'point'
    ? `  <point n="${r.n}" x="${num(r.x)}" y="${num(r.y)}">${xml(r.comment)}</point>`
    : `  <region n="${r.n}" shape="${r.shape}" x="${num(r.x)}" y="${num(r.y)}" w="${num(r.w!)}" h="${num(r.h!)}">${xml(r.comment)}</region>`), '</image_annotations>'].join('\n');
}
