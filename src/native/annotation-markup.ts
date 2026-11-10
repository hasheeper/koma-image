import { MARKUP_MAX_PIXELS } from '../domain/image-markup.ts';
import { MAX_INPUT_BYTES } from '../domain/media.ts';
import { validateAnnotationSnapshot } from '../domain/region-annotation.ts';
import type { AnnotationSnapshot } from '../domain/region-annotation.ts';
import type { MaskBitmap } from './edit-input.ts';
import { drawAnnotationLayer } from './annotation-canvas.ts';

/** Orient and resize the pair together. The full original and local mask stay with the caller. */
export async function prepareAnnotationMarkup(source: Blob, annotation?: AnnotationSnapshot, painted?: MaskBitmap) {
  if (annotation) validateAnnotationSnapshot(annotation);
  const bitmap = await createImageBitmap(source);
  try {
    const { width: originalWidth, height: originalHeight } = bitmap;
    for (const value of [annotation, painted]) if (value && (value.width !== originalWidth || value.height !== originalHeight))
      throw new Error('原生标注与底图尺寸不一致');
    if (painted && painted.bits.length !== Math.ceil(originalWidth * originalHeight / 8)) throw new Error('标注范围数据无效');
    if (!annotation && !painted?.bits.some(Boolean)) throw new Error('请先添加批注或涂抹修改区域');
    const initial = Math.min(1, Math.sqrt(MARKUP_MAX_PIXELS / (originalWidth * originalHeight)));
    for (let scale = initial; scale > initial * .1; scale *= .8) {
      const width = Math.max(1, Math.floor(originalWidth * scale)), height = Math.max(1, Math.floor(originalHeight * scale));
      const image = new OffscreenCanvas(width, height), layer = new OffscreenCanvas(width, height);
      const ctx = image.getContext('2d')!, overlay = layer.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (painted) {
        const pixels = overlay.createImageData(width, height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const p = Math.floor(y * originalHeight / height) * originalWidth + Math.floor(x * originalWidth / width);
          if (painted.bits[p >> 3] & 1 << (p & 7)) pixels.data.set([124, 58, 237, 72], (y * width + x) * 4);
        }
        overlay.putImageData(pixels, 0, 0);
      }
      if (annotation) drawAnnotationLayer(overlay, annotation.regions, width, height);
      const alpha = overlay.getImageData(0, 0, width, height).data;
      let transparent = false, marked = false;
      for (let i = 3; i < alpha.length; i += 4) { transparent ||= alpha[i] < 255; marked ||= alpha[i] > 0; }
      if (!transparent || !marked) throw new Error('标注层需包含可见标记和透明像素');
      const [input, markup] = await Promise.all([image.convertToBlob({ type: 'image/png' }), layer.convertToBlob({ type: 'image/png' })]);
      if (input.size <= MAX_INPUT_BYTES && markup.size <= MAX_INPUT_BYTES) return { input, markup, width, height };
    }
    throw new Error('原图与标注层超过发送限制，请缩小图片后重试');
  } finally { bitmap.close(); }
}
