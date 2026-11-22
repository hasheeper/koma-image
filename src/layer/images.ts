import { encode } from 'fast-png';
import type { Raster, Rect } from './project.ts';

/** Read unassociated sRGB bytes without the Canvas2D premultiply/unpremultiply round trip. */
export async function readRaster(blob: Blob): Promise<Raster> {
  const image = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'default',
    imageOrientation: 'from-image',
  });
  const { width, height } = image;
  let gl: WebGLRenderingContext | null = null;
  try {
    if (width * height > 32_000_000) throw new Error('图像超过 EDIT 的 3200 万像素上限');
    gl = new OffscreenCanvas(1, 1).getContext('webgl');
    if (!gl) throw new Error('读取无损 RGBA 需要 WebGL');
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      data = new Uint8Array(width * height * 4);
    if (max <= 0) throw new Error('无法读取设备纹理尺寸');
    for (let y = 0; y < height; y += max)
      for (let x = 0; x < width; x += max) {
        const w = Math.min(max, width - x),
          h = Math.min(max, height - y);
        const tile =
          w === width && h === height
            ? image
            : await createImageBitmap(image, x, y, w, h, { premultiplyAlpha: 'none' });
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error('无法读取原尺寸像素');
          const buffer =
            w === width ? data.subarray(y * width * 4, (y + h) * width * 4) : new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
          if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('无损像素读取失败');
          if (w !== width)
            for (let j = 0; j < h; j++)
              data.set(buffer.subarray(j * w * 4, (j + 1) * w * 4), ((y + j) * width + x) * 4);
        } finally {
          if (tile !== image) tile.close();
        }
      }
    return { width, height, data };
  } finally {
    image.close();
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
export function placeOnCanvas(
  layer: Raster,
  placement: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Raster {
  if (
    placement.x === 0 &&
    placement.y === 0 &&
    placement.width === canvasWidth &&
    placement.height === canvasHeight &&
    layer.width === canvasWidth &&
    layer.height === canvasHeight
  ) {
    return layer;
  }
  const src = new OffscreenCanvas(layer.width, layer.height);
  src
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.width, layer.height), 0, 0);
  const dst = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, placement.x, placement.y, placement.width, placement.height);
  return {
    width: canvasWidth,
    height: canvasHeight,
    data: new Uint8Array(ctx.getImageData(0, 0, canvasWidth, canvasHeight).data.buffer),
  };
}

export function png(image: Raster, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 3): Blob {
  const bytes = encode({ ...image, channels: 4, depth: 8 }, { zlib: { level } });
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}
export function grayscale(image: Raster, size: Raster): Uint8Array {
  if (image.width !== size.width || image.height !== size.height)
    throw new Error('蒙版须与定稿尺寸相同');
  const values = new Uint8Array(image.width * image.height);
  for (let i = 0; i < values.length; i++) {
    const j = i * 4,
      v = image.data[j];
    if (v !== image.data[j + 1] || v !== image.data[j + 2]) throw new Error('请导入灰度蒙版');
    values[i] = Math.round((v * image.data[j + 3]) / 255);
  }
  return values;
}
