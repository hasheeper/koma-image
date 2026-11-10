import { imageDimensions } from '../native/image-dimensions.ts';

export const MARKUP_MAX_PIXELS = 16_777_216;
/** Dedicated image input, never a scalar source parameter or a generic reference image. */
export function validateMarkupImage(source: unknown, markup: unknown): asserts markup is string {
  if (typeof source !== 'string' || typeof markup !== 'string' ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(markup)) throw new Error('原生标注需要独立的透明 PNG');
  if ((markup.length - markup.indexOf(',') - 1) * .75 > 50 * 1024 * 1024) throw new Error('原生标注文件超过 50MB');
  const base = imageDimensions(source), layer = imageDimensions(markup);
  if (base.width !== layer.width || base.height !== layer.height || !base.width || !base.height || base.width * base.height > MARKUP_MAX_PIXELS)
    throw new Error('原生标注须与首张原图同尺寸，且不超过 16777216 像素');
}
