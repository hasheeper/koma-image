import { createMaskEditor } from "./mask-editor.ts";
import type { MaskState } from "./mask-editor.ts";
import type { MaskBitmap } from "./edit-input.ts";
import { decodeMask } from "./edit-input.ts";

export async function maskStateBitmap(state: MaskState): Promise<MaskBitmap> {
  const renderer = createMaskEditor(document.createElement("canvas"), () => {});
  try {
    renderer.restore(state);
    const encoded = renderer.getMask(true);
    return encoded ? decodeMask(await (await fetch(encoded)).blob(), "alpha", state)
      : { width: state.width, height: state.height, bits: new Uint8Array(Math.ceil(state.width * state.height / 8)) };
  } finally { renderer.dispose(); }
}

export async function photopeaInput(image: Blob, state?: MaskState) {
  const bitmap = await createImageBitmap(image);
  let normalized: Blob;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器不支持图片处理");
    if (state && (state.width !== bitmap.width || state.height !== bitmap.height)) throw new Error("蒙版尺寸与当前图像不一致");
    ctx.drawImage(bitmap, 0, 0);
    normalized = await canvas.convertToBlob({ type: "image/png" });
  } finally { bitmap.close(); }
  let mask: Blob | undefined;
  if (state) {
    const renderer = createMaskEditor(document.createElement("canvas"), () => {});
    try {
      renderer.restore(state);
      const encoded = renderer.getMask(true);
      if (encoded) mask = await (await fetch(encoded)).blob();
    } finally { renderer.dispose(); }
  }
  return { image: normalized, mask };
}

/** Grayscale 0..255 is transported as transparency so Reveal Selection creates
 * a soft layer mask. This must never pass through binary decodeMask. */
export async function photopeaSoftMask(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width,bitmap.height), ctx=canvas.getContext('2d',{willReadFrequently:true});
    if (!ctx) throw new Error('当前浏览器不支持图片处理');
    ctx.drawImage(bitmap,0,0); const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height);
    for (let i=0;i<pixels.data.length;i+=4) { pixels.data[i+3]=pixels.data[i];pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255; }
    ctx.putImageData(pixels,0,0);return await canvas.convertToBlob({type:'image/png'});
  } finally { bitmap.close(); }
}
