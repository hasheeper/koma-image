import type { CatalogModel } from '../domain/catalog.ts';
import { buildChatPayload } from '../domain/media.ts';
import { annotationPrompt, canMaskAnnotations, defaultAnnotationEdges, validateAnnotationSnapshot } from '../domain/region-annotation.ts';
import type { AnnotationEdges, AnnotationSnapshot } from '../domain/region-annotation.ts';
import { annotationMask, annotationPreview, unionMasks } from '../native/annotation-canvas.ts';
import type { MaskBitmap } from '../native/edit-input.ts';
import { fitReference } from './handoff.ts';
import { dataUrl } from './assets.ts';

/** Page-local editing state. It never becomes a CHAT attachment or API mask. */
export interface EditorComparison {
  sourceId: number;
  rawId?: number;
  compositeId?: number;
  mask?: MaskBitmap;
  edges: AnnotationEdges;
}
export interface ImageEditSettings { edges: AnnotationEdges; textOnly: boolean }
export const imageEditSettings = (): ImageEditSettings => ({ edges: { ...defaultAnnotationEdges }, textOnly: false });


async function maskGuide(source: Blob, mask: MaskBitmap) {
  const bitmap = await createImageBitmap(source);
  try {
    const { width, height } = mask, canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height);
    for (let p = 0; p < width * height; p++) if (mask.bits[p >> 3] & 1 << (p & 7)) {
      const at = p * 4;
      for (let c = 0; c < 3; c++) pixels.data[at + c] = pixels.data[at + c] * .72 + [124, 58, 237][c] * .28;
    }
    ctx.putImageData(pixels, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally { bitmap.close(); }
}
function maskLocation(mask: MaskBitmap) {
  let x1 = mask.width, y1 = mask.height, x2 = 0, y2 = 0;
  for (let p = 0; p < mask.width * mask.height; p++) if (mask.bits[p >> 3] & 1 << (p & 7)) {
    const x = p % mask.width, y = Math.floor(p / mask.width);
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + 1); y2 = Math.max(y2, y + 1);
  }
  return { x: x1/mask.width, y: y1/mask.height, w: (x2-x1)/mask.width, h: (y2-y1)/mask.height };
}
export async function prepareEditorImageEdit(source: { id: number; entity_key: string; blob: Blob; width: number; height: number; name: string }, model: CatalogModel,
  prompt: string, options: Record<string, string>, settings: ImageEditSettings, painted?: MaskBitmap, annotation?: AnnotationSnapshot) {
  const snapshot = annotation?.regions.length ? structuredClone(annotation) : undefined;
  if (snapshot) {
    validateAnnotationSnapshot(snapshot);
    if (snapshot.image.entity_key !== source.entity_key || snapshot.width !== source.width || snapshot.height !== source.height) throw new Error('批注与本轮底图不一致');
  }
  if (!prompt.trim() && !snapshot?.regions.some(r => r.comment.trim())) throw new Error('请填写修改要求或批注');
  let mask = painted?.bits.some(Boolean) ? structuredClone(painted) : undefined;
  if (mask && (mask.width !== source.width || mask.height !== source.height)) throw new Error('蒙版与本轮底图尺寸不一致');
  // A point alone has no coverage. Never invent a circle or omit a point's edit from an automatic region mask.
  if (snapshot && canMaskAnnotations(snapshot.regions)) {
    const regions = annotationMask(snapshot); mask = mask ? unionMasks(mask, regions) : regions;
  }
  const needsGuide = !!mask || !!snapshot, useGuide = needsGuide && !(settings.textOnly && model.maxImages < 2);
  if (useGuide && model.maxImages < 2) throw new Error('此来源仅支持单图；请明确选择“仅方位文字”，或切换支持双图的来源');
  const clean = await fitReference(source.blob, source.name), images = [await dataUrl(clean.blob)];
  if (useGuide) {
    let guide = mask ? await maskGuide(source.blob, mask) : source.blob;
    if (snapshot) guide = await annotationPreview(guide, snapshot);
    images.push(await dataUrl((await fitReference(guide, '修改区域指示图.png')).blob));
  }
  const instructions = annotationPrompt(snapshot?.regions ?? [], useGuide, prompt, painted?.bits.some(Boolean) ? maskLocation(painted) : undefined);
  return { request: buildChatPayload(model, instructions, options, images),
    comparison: { sourceId: source.id, mask, edges: { ...settings.edges } } satisfies EditorComparison };
}
